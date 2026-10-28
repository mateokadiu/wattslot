import { describe, expect, it } from 'vitest';
import {
  createEdsClient,
  EdsHttpError,
  EdsRateLimitError,
  retryAfterSeconds,
} from '../src/index.js';
import { fixtureText } from './fixtures.js';

function fakeFetch(status: number, body: string, headers: Record<string, string> = {}) {
  const calls: URL[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    calls.push(new URL(input instanceof Request ? input.url : String(input)));
    return new Response(body, { status, headers });
  };
  return { fetch, calls };
}

describe('createEdsClient', () => {
  it('requests a dataset with range, area filter, sort and a high limit', async () => {
    const { fetch, calls } = fakeFetch(200, fixtureText('dayahead-2026-10-28.json'));
    const client = createEdsClient({ fetch });

    const prices = await client.dayAheadPrices({
      start: '2026-10-28',
      end: '2026-10-29',
      priceAreas: ['DK1', 'DK2'],
    });

    expect(prices).toHaveLength(192);
    const url = calls[0];
    expect(url?.pathname).toBe('/dataset/DayAheadPrices');
    expect(url?.searchParams.get('start')).toBe('2026-10-28');
    expect(url?.searchParams.get('end')).toBe('2026-10-29');
    expect(JSON.parse(url?.searchParams.get('filter') ?? '')).toEqual({
      PriceArea: ['DK1', 'DK2'],
    });
    expect(url?.searchParams.get('sort')).toBe('TimeUTC asc');
    expect(Number(url?.searchParams.get('limit'))).toBeGreaterThan(100_000);
  });

  it('omits the filter when no areas are given', async () => {
    const { fetch, calls } = fakeFetch(200, fixtureText('dayahead-2026-10-28.json'));
    await createEdsClient({ fetch }).dayAheadPrices({ start: '2026-10-28', end: '2026-10-29' });
    expect(calls[0]?.searchParams.has('filter')).toBe(false);
  });

  it('filters the pricelist by owner and charge code', async () => {
    const { fetch, calls } = fakeFetch(200, fixtureText('datahub-pricelist-radius-energinet.json'));
    const charges = await createEdsClient({ fetch }).datahubPricelist({
      start: '2025-01-01',
      ownerGlns: ['5790000705689'],
      codes: ['DT_C_01'],
    });
    expect(charges.length).toBeGreaterThan(0);
    expect(JSON.parse(calls[0]?.searchParams.get('filter') ?? '')).toEqual({
      GLN_Number: ['5790000705689'],
      ChargeTypeCode: ['DT_C_01'],
    });
  });

  it('turns HTTP 429 into a rate-limit error with the wait from the body', async () => {
    const { fetch } = fakeFetch(429, fixtureText('error-429.json'));
    const error = await createEdsClient({ fetch })
      .dayAheadPrices({ start: '2026-10-28', end: '2026-10-29' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EdsRateLimitError);
    expect((error as EdsRateLimitError).retryAfterSeconds).toBe(295);
    expect((error as EdsRateLimitError).dataset).toBe('DayAheadPrices');
  });

  it('reports other HTTP failures with status and body', async () => {
    const { fetch } = fakeFetch(503, 'maintenance');
    const error = await createEdsClient({ fetch })
      .co2Emission({ start: '2026-10-28', end: '2026-10-29' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EdsHttpError);
    expect((error as EdsHttpError).status).toBe(503);
    expect((error as EdsHttpError).body).toBe('maintenance');
  });
});

describe('retryAfterSeconds', () => {
  it('prefers the Retry-After header', () => {
    expect(retryAfterSeconds('12', 'Try again in 295 seconds.')).toBe(12);
  });

  it('falls back to the message, then to a default', () => {
    expect(retryAfterSeconds(null, 'Rate limit is exceeded. Try again in 7 seconds.')).toBe(7);
    expect(retryAfterSeconds(null, 'nope')).toBe(60);
  });
});
