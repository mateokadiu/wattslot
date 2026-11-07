import { describe, expect, it } from 'vitest';
import {
  createEdsClient,
  EdsHttpError,
  EdsRateLimitError,
  retryAfterSeconds,
} from '../src/index.ts';
import { fixtureText } from './fixtures.ts';

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
      chargeTypes: ['D03'],
    });
    expect(charges.length).toBeGreaterThan(0);
    expect(JSON.parse(calls[0]?.searchParams.get('filter') ?? '')).toEqual({
      GLN_Number: ['5790000705689'],
      ChargeTypeCode: ['DT_C_01'],
      ChargeType: ['D03'],
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

  it('waits out short rate limits when asked to retry', async () => {
    const statuses = [429, 429, 200];
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async () => {
      const status = statuses[calls.length] ?? 200;
      calls.push(String(status));
      return status === 429
        ? new Response('{}', { status, headers: { 'retry-after': '5' } })
        : new Response(fixtureText('dayahead-2026-10-28.json'));
    };
    const waits: number[] = [];
    const client = createEdsClient({
      fetch,
      rateLimitRetries: 3,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    const prices = await client.dayAheadPrices({ start: '2026-10-28', end: '2026-10-29' });
    expect(prices).toHaveLength(192);
    expect(calls).toEqual(['429', '429', '200']);
    expect(waits).toEqual([5500, 5500]);
  });

  it('gives up after the retries, or at once when the wait is long', async () => {
    const short = fakeFetch(429, '{}', { 'retry-after': '5' });
    const sleep = async () => {};
    const error = await createEdsClient({ fetch: short.fetch, rateLimitRetries: 2, sleep })
      .dayAheadPrices({ start: '2026-10-28', end: '2026-10-29' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EdsRateLimitError);
    expect(short.calls).toHaveLength(3);

    const long = fakeFetch(429, fixtureText('error-429.json'));
    await createEdsClient({ fetch: long.fetch, rateLimitRetries: 2, sleep })
      .dayAheadPrices({ start: '2026-10-28', end: '2026-10-29' })
      .catch(() => {});
    expect(long.calls).toHaveLength(1);
  });

  it('shares one waiting budget between requests', async () => {
    const limited = fakeFetch(429, '{}', { 'retry-after': '40' });
    const waits: number[] = [];
    const client = createEdsClient({
      fetch: limited.fetch,
      rateLimitRetries: 3,
      retryWaitBudgetSeconds: 100,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    const query = { start: '2026-10-28', end: '2026-10-29' };
    await client.dayAheadPrices(query).catch(() => {});
    await client.co2Emission(query).catch(() => {});
    // 40 + 40 fit in 100; the third wait doesn't, and the second request gets none at all.
    expect(waits).toEqual([40_500, 40_500]);
    expect(limited.calls).toHaveLength(4);
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
