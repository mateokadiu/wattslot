// Minimal Worker that prices one DK2 / Radius day with the real packages, so the test can run
// them inside workerd (Cloudflare's runtime) instead of Node.
import { parseDatahubPricelist, parseDayAheadPrices } from '@wattslot/eds-client';
import {
  chargeFromDkk,
  DK_TIME_ZONE,
  DK_VAT_BASIS_POINTS,
  ELECTRICITY_TAX_CODE,
  ENERGINET_CONSUMER_TARIFF_CODES,
  ENERGINET_GLN,
  perMwhToMicroPerKwh,
  priceSlot,
  slotsForLocalDate,
  toOre,
} from '../../src/index.ts';

interface Body {
  date: string;
  dayAhead: unknown;
  pricelist: unknown;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const { date, dayAhead, pricelist } = (await request.json()) as Body;
    const charges = parseDatahubPricelist(pricelist);
    const pick = (gln: string, codes: readonly string[]) =>
      charges
        .filter((c) => c.ownerGln === gln && codes.includes(c.code))
        .map((c) => chargeFromDkk(c));
    const ctx = {
      timeZone: DK_TIME_ZONE,
      gridTariffs: pick('5790000705689', ['DT_C_01']),
      tsoTariffs: pick(ENERGINET_GLN, ENERGINET_CONSUMER_TARIFF_CODES),
      electricityTax: pick(ENERGINET_GLN, [ELECTRICITY_TAX_CODE]),
      vatBasisPoints: DK_VAT_BASIS_POINTS,
      supplierMarkup: 0,
    };
    const spots = new Map(
      parseDayAheadPrices(dayAhead)
        .filter((p) => p.priceArea === 'DK2' && p.dkkPerMwh !== null)
        .map((p) => [p.slotStartMs, perMwhToMicroPerKwh(p.dkkPerMwh as number)]),
    );
    const totals = slotsForLocalDate(date, DK_TIME_ZONE).map((slot) => {
      const spot = spots.get(slot);
      if (spot === undefined) throw new Error(`missing spot price for ${slot}`);
      return toOre(priceSlot(slot, spot, ctx).total);
    });
    return Response.json({ slots: totals.length, totalsOre: totals });
  },
};
