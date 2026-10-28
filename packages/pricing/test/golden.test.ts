/**
 * Golden tests on real Energi Data Service data (fixtures/eds, CC BY 4.0, Source: Energinet).
 * The 28 Oct 2026 numbers are the worked example in PLAN.md §2.2.
 */
import { readFileSync } from 'node:fs';
import {
  type DayAheadPrice,
  parseDatahubPricelist,
  parseDayAheadPrices,
} from '@wattslot/eds-client';
import { describe, expect, it } from 'vitest';
import {
  chargeFromDkk,
  DK_TIME_ZONE,
  DK_VAT_BASIS_POINTS,
  ELECTRICITY_TAX_CODE,
  ENERGINET_CONSUMER_TARIFF_CODES,
  ENERGINET_GLN,
  localTime,
  type PricingContext,
  perMwhToMicroPerKwh,
  priceSlot,
  slotsForLocalDate,
  toOre,
} from '../src/index.ts';

const RADIUS_GLN = '5790000705689';
const RADIUS_HOUSEHOLD_TARIFF = 'DT_C_01';

const load = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../fixtures/eds/${name}`, import.meta.url), 'utf8'));

const charges = parseDatahubPricelist(load('datahub-pricelist-radius-energinet.json')).map((c) => ({
  ...c,
  charge: chargeFromDkk(c),
}));
const pick = (gln: string, codes: readonly string[]) =>
  charges.filter((c) => c.ownerGln === gln && codes.includes(c.code)).map((c) => c.charge);

const radiusDk2: PricingContext = {
  timeZone: DK_TIME_ZONE,
  gridTariffs: pick(RADIUS_GLN, [RADIUS_HOUSEHOLD_TARIFF]),
  tsoTariffs: pick(ENERGINET_GLN, ENERGINET_CONSUMER_TARIFF_CODES),
  electricityTax: pick(ENERGINET_GLN, [ELECTRICITY_TAX_CODE]),
  vatBasisPoints: DK_VAT_BASIS_POINTS,
  supplierMarkup: 0,
};

function dk2Day(fixture: string): Map<number, DayAheadPrice> {
  return new Map(
    parseDayAheadPrices(load(fixture))
      .filter((p) => p.priceArea === 'DK2')
      .map((p) => [p.slotStartMs, p]),
  );
}

function priceDay(date: string, fixture: string) {
  const spots = dk2Day(fixture);
  return slotsForLocalDate(date, DK_TIME_ZONE).map((slot) => {
    const p = spots.get(slot);
    if (!p || p.dkkPerMwh === null) throw new Error(`no DK2 price for slot ${slot}`);
    return priceSlot(slot, perMwhToMicroPerKwh(p.dkkPerMwh), radiusDk2);
  });
}

const hourOf = (slot: number) => localTime(slot, DK_TIME_ZONE).hour;

describe('worked example: DK2, Radius, 28 Oct 2026', () => {
  const day = priceDay('2026-10-28', 'dayahead-2026-10-28.json');

  it('prices every slot of the day', () => {
    expect(day).toHaveLength(96);
  });

  it('night slot 00:00 costs 1.66 DKK/kWh all-in', () => {
    const night = day[0];
    expect(night).toMatchObject({
      gridTariff: 106_175,
      tsoTariffs: 115_000,
      electricityTax: 8_000,
    });
    expect(toOre(night?.spot ?? 0)).toBe(110); // 1.097 DKK spot
    expect(toOre(night?.total ?? 0)).toBe(166);
  });

  it('evening slot 18:00 costs 4.35 DKK/kWh all-in', () => {
    const evening = day[18 * 4];
    expect(hourOf(evening?.slotStartMs ?? 0)).toBe(18);
    expect(evening).toMatchObject({ gridTariff: 955_573, tsoTariffs: 115_000 });
    expect(toOre(evening?.spot ?? 0)).toBe(240); // 2.398 DKK spot
    expect(toOre(evening?.total ?? 0)).toBe(435);
  });

  it('charges the peak tariff for exactly the 16 slots between 17:00 and 21:00', () => {
    const peak = day.filter((p) => p.gridTariff === 955_573);
    expect(peak).toHaveLength(16);
    expect(peak.every((p) => hourOf(p.slotStartMs) >= 17 && hourOf(p.slotStartMs) < 21)).toBe(true);
  });
});

describe('daylight saving days', () => {
  it('fall-back day: 100 slots, the repeated 02:00 hour is priced twice at the night rate', () => {
    const day = priceDay('2026-10-25', 'dayahead-2026-10-25-dst-fall.json');
    expect(day).toHaveLength(100);
    const twoAm = day.filter((p) => hourOf(p.slotStartMs) === 2);
    expect(twoAm).toHaveLength(8);
    expect(twoAm.every((p) => p.gridTariff === 106_175)).toBe(true);
    expect(day.filter((p) => p.gridTariff === 955_573)).toHaveLength(16);
  });

  it('spring-forward day: 92 slots, still on the 2025/26 winter tariff', () => {
    const day = priceDay('2026-03-29', 'dayahead-2026-03-29-dst-spring.json');
    expect(day).toHaveLength(92);
    expect(day.filter((p) => p.gridTariff === 878_800)).toHaveLength(16);
  });
});

describe('negative prices: DK2, 5 Apr 2026', () => {
  const day = priceDay('2026-04-05', 'dayahead-2026-04-05-negative.json');

  it('uses the summer tariff from 1 April', () => {
    expect(day.filter((p) => p.gridTariff === 414_082)).toHaveLength(16);
  });

  it('passes negative spot prices through, but tariffs and tax keep the bill positive', () => {
    const negativeSpot = day.filter((p) => p.spot < 0);
    // DK2 dipped to -0.046 DKK/kWh that day: 36 slots below zero, none below the ~0.23 DKK
    // of tariffs and tax. A negative market price is not a negative bill.
    expect(negativeSpot).toHaveLength(36);
    expect(Math.min(...negativeSpot.map((p) => p.spot))).toBe(-46_031);
    expect(negativeSpot.every((p) => p.total > 0)).toBe(true);
  });
});
