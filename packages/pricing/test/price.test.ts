import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyRate,
  chargeFromDkk,
  DK_TIME_ZONE,
  localTime,
  type PricingContext,
  priceSlot,
  priceSlotSpotOnly,
  SLOT_MS,
} from '../src/index.ts';

const hourly = fc.array(fc.integer({ min: 0, max: 3_000_000 }), { minLength: 24, maxLength: 24 });

function context(grid: number[], tso: number, tax: number, markup: number): PricingContext {
  const charge = (code: string, values: number[]) =>
    chargeFromDkk({
      ownerGln: 'G',
      code,
      validFrom: '2000-01-01T00:00:00',
      validTo: null,
      hourlyDkkPerKwh: values.map((v) => v / 1e6),
    });
  return {
    timeZone: DK_TIME_ZONE,
    gridTariffs: [charge('grid', grid)],
    tsoTariffs: [charge('tso', Array(24).fill(tso))],
    electricityTax: [charge('tax', Array(24).fill(tax))],
    vatBasisPoints: 2500,
    supplierMarkup: markup,
  };
}

// Any 15-minute slot between 2020 and 2035.
const slot = fc
  .integer({ min: Date.UTC(2020, 0, 1) / SLOT_MS, max: Date.UTC(2035, 0, 1) / SLOT_MS })
  .map((n) => n * SLOT_MS);
const spot = fc.integer({ min: -5_000_000, max: 20_000_000 });
const small = fc.integer({ min: 0, max: 1_000_000 });

describe('priceSlot', () => {
  it('breaks down exactly: components sum to the subtotal, plus VAT to the total', () => {
    fc.assert(
      fc.property(slot, spot, hourly, small, small, small, (t, s, grid, tso, tax, markup) => {
        const p = priceSlot(t, s, context(grid, tso, tax, markup));
        expect(p.subtotal).toBe(p.spot + p.gridTariff + p.tsoTariffs + p.electricityTax + markup);
        expect(p.vat).toBe(applyRate(p.subtotal, 2500));
        expect(p.total).toBe(p.subtotal + p.vat);
        expect(p.mode).toBe('full');
      }),
    );
  });

  it('charges the grid tariff of the local hour', () => {
    fc.assert(
      fc.property(slot, spot, hourly, (t, s, grid) => {
        const p = priceSlot(t, s, context(grid, 0, 0, 0));
        expect(p.gridTariff).toBe(grid[localTime(t, DK_TIME_ZONE).hour]);
      }),
    );
  });

  it('never gets cheaper when the spot price goes up', () => {
    fc.assert(
      fc.property(slot, spot, spot, hourly, (t, a, b, grid) => {
        const ctx = context(grid, 115_000, 8_000, 0);
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(priceSlot(t, lo, ctx).total).toBeLessThanOrEqual(priceSlot(t, hi, ctx).total);
      }),
    );
  });
});

describe('deeply negative spot prices', () => {
  it('make the subtotal, VAT and total negative together', () => {
    // -1.5 DKK/kWh spot outweighs 0.106 + 0.115 + 0.008 of tariffs and tax.
    const p = priceSlot(
      Date.UTC(2026, 3, 5, 10),
      -1_500_000,
      context(Array(24).fill(106_175), 115_000, 8_000, 0),
    );
    expect(p.subtotal).toBe(-1_270_825);
    expect(p.vat).toBe(-317_706);
    expect(p.total).toBe(-1_588_531);
  });
});

describe('priceSlotSpotOnly', () => {
  it('is just the spot price, with nothing added', () => {
    const p = priceSlotSpotOnly(0, 1_234_567);
    expect(p).toMatchObject({ mode: 'spot-only', subtotal: 1_234_567, vat: 0, total: 1_234_567 });
  });
});
