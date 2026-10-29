import { describe, expect, it } from 'vitest';
import type { GridCompany } from '../src/lib/api';
import { displayName, groupCompanies, slugify } from '../src/lib/companies';
import { tariffPeriods, tariffShape } from '../src/lib/tariffs';

const company = (gln: string, name: string, meteringPoints: number, supported = true) =>
  ({ gln, name, zone: 'DK1', meteringPoints, supported, note: null }) as GridCompany;

describe('grid company names', () => {
  it('drops legal suffixes and grid area numbers', () => {
    expect(displayName('Radius Elnet A/S')).toBe('Radius Elnet');
    expect(displayName('N1 A/S - 131')).toBe('N1');
    expect(displayName('Midtfyns Elforsyning A.m.b.A')).toBe('Midtfyns Elforsyning');
    expect(displayName('Hjerting Transformatorforening')).toBe('Hjerting Transformatorforening');
  });

  it('makes ASCII slugs, spelling out æ, ø and å', () => {
    expect(slugify('TREFOR El-net Øst A/S')).toBe('trefor-el-net-oest');
    expect(slugify('Netselskabet Elværk A/S')).toBe('netselskabet-elvaerk');
    expect(slugify('Sunds Net A.m.b.a')).toBe('sunds-net');
  });
});

describe('groupCompanies', () => {
  const list = [
    company('1', 'N1 A/S - 131', 483_978),
    company('2', 'Konstant Net A/S - 151', 191_197),
    company('3', 'N1 A/S - 016', 871),
    company('4', 'N1 A/S - 344', 335_345),
    company('5', 'Konstant Net A/S - 245', 65_367),
    company('6', 'Kimbrer Elnet A/S', 10_000, false),
  ];

  it('gives each company one page, whatever its number of grid areas', () => {
    const groups = groupCompanies(list);
    expect(groups.map((g) => g.slug)).toEqual(['n1', 'konstant-net']);
    const n1 = groups[0];
    expect(n1?.areas.map((a) => a.code)).toEqual(['131', '344', '016']);
    expect(n1?.meteringPoints).toBe(483_978 + 335_345 + 871);
    expect(n1?.legalName).toBe('N1 A/S');
  });

  it('leaves out companies whose tariff isn’t supported', () => {
    expect(groupCompanies(list).some((g) => g.slug === 'kimbrer-elnet')).toBe(false);
  });
});

const flat = (v: number) => Array.from({ length: 24 }, () => v);
const bands = (low: number, high: number, peak: number) =>
  Array.from({ length: 24 }, (_, h) => (h < 6 ? low : h >= 17 && h < 21 ? peak : high));

describe('tariffShape', () => {
  it('recognises Tarifmodel 3.0, a flat tariff and anything else', () => {
    expect(tariffShape(bands(0.1, 0.3, 0.9))).toEqual({
      kind: 'bands',
      low: 0.1,
      high: 0.3,
      peak: 0.9,
    });
    expect(tariffShape(flat(0.2))).toEqual({ kind: 'flat', price: 0.2 });
    const odd = bands(0.1, 0.3, 0.9).map((v, h) => (h === 12 ? 0.5 : v));
    expect(tariffShape(odd).kind).toBe('hourly');
  });
});

describe('tariffPeriods', () => {
  const body = (tariffs: Parameters<typeof tariffPeriods>[0]['tariffs']) => ({
    gridCompany: { gln: '1', name: 'X', zone: 'DK1' },
    tariffs,
  });

  it('keeps one charge’s periods as they are', () => {
    const periods = tariffPeriods(
      body([
        {
          chargeCode: 'T',
          role: 'tariff',
          periods: [
            {
              validFrom: '2026-10-01T00:00:00',
              validTo: '2027-04-01T00:00:00',
              hourly: bands(1, 2, 3),
            },
            { validFrom: '2027-04-01T00:00:00', validTo: null, hourly: bands(1, 1, 2) },
          ],
        },
      ]),
    );
    expect(periods.map((p) => [p.validFrom, p.validTo])).toEqual([
      ['2026-10-01T00:00:00', '2027-04-01T00:00:00'],
      ['2027-04-01T00:00:00', null],
    ]);
  });

  it('adds a discount only while it lasts', () => {
    const periods = tariffPeriods(
      body([
        {
          chargeCode: 'T',
          role: 'tariff',
          periods: [{ validFrom: '2026-10-01T00:00:00', validTo: null, hourly: flat(0.3) }],
        },
        {
          chargeCode: 'D',
          role: 'discount',
          periods: [
            {
              validFrom: '2026-10-01T00:00:00',
              validTo: '2027-01-01T00:00:00',
              hourly: flat(-0.1),
            },
          ],
        },
      ]),
    );
    expect(periods).toHaveLength(2);
    expect(periods[0]?.hourly[0]).toBeCloseTo(0.2);
    expect(periods[0]?.validTo).toBe('2027-01-01T00:00:00');
    expect(periods[1]?.hourly[0]).toBeCloseTo(0.3);
    expect(periods[1]?.validTo).toBeNull();
  });
});
