import { type Charge, sumCharges } from './charges.ts';
import { applyRate, type Micro } from './money.ts';
import { localTime } from './time.ts';

export interface PricingContext {
  timeZone: string;
  /** All validity periods of the site's grid-company tariff. */
  gridTariffs: readonly Charge[];
  /** Transmission system operator tariffs every consumer pays (Energinet in Denmark). */
  tsoTariffs: readonly Charge[];
  electricityTax: readonly Charge[];
  vatBasisPoints: number;
  /** Supplier's per-kWh markup, excluding VAT. 0 if unknown. */
  supplierMarkup: Micro;
}

export interface PriceBreakdown {
  slotStartMs: number;
  mode: 'full' | 'spot-only';
  spot: Micro;
  gridTariff: Micro;
  tsoTariffs: Micro;
  electricityTax: Micro;
  supplierMarkup: Micro;
  /** Everything above, before VAT. */
  subtotal: Micro;
  vat: Micro;
  /** What a kWh in this slot actually costs. */
  total: Micro;
}

export function priceSlot(slotStartMs: number, spot: Micro, ctx: PricingContext): PriceBreakdown {
  const at = localTime(slotStartMs, ctx.timeZone);
  const gridTariff = sumCharges(ctx.gridTariffs, at);
  const tsoTariffs = sumCharges(ctx.tsoTariffs, at);
  const electricityTax = sumCharges(ctx.electricityTax, at);
  const subtotal = spot + gridTariff + tsoTariffs + electricityTax + ctx.supplierMarkup;
  const vat = applyRate(subtotal, ctx.vatBasisPoints);
  return {
    slotStartMs,
    mode: 'full',
    spot,
    gridTariff,
    tsoTariffs,
    electricityTax,
    supplierMarkup: ctx.supplierMarkup,
    subtotal,
    vat,
    total: subtotal + vat,
  };
}

/** Zones without a tariff provider yet: the raw day-ahead price, no taxes or VAT. */
export function priceSlotSpotOnly(slotStartMs: number, spot: Micro): PriceBreakdown {
  return {
    slotStartMs,
    mode: 'spot-only',
    spot,
    gridTariff: 0,
    tsoTariffs: 0,
    electricityTax: 0,
    supplierMarkup: 0,
    subtotal: spot,
    vat: 0,
    total: spot,
  };
}
