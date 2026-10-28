import { schema } from '@wattslot/db';
import {
  type Charge,
  ELECTRICITY_TAX_CODE,
  ENERGINET_CONSUMER_TARIFF_CODES,
  ENERGINET_GLN,
  localTime,
  type Micro,
  MissingChargeError,
  OverlappingChargeError,
  type PriceBreakdown,
  type PricingContext,
  priceSlot,
  priceSlotSpotOnly,
} from '@wattslot/pricing';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import type { Db } from '../ingest/store.js';

export class RequestError extends Error {
  constructor(
    readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
  }
}

export interface Zone {
  code: string;
  currency: string;
  timeZone: string;
  fullPrice: boolean;
}

export interface PricedRange {
  zone: Zone;
  gridCompany: { gln: string; name: string } | null;
  mode: 'full' | 'spot-only';
  /** Why prices are spot-only, in plain words; null for full prices. */
  note: string | null;
  slots: PriceBreakdown[];
}

export async function loadZone(db: Db, code: string): Promise<Zone> {
  const [zone] = await db.select().from(schema.priceZones).where(eq(schema.priceZones.code, code));
  if (!zone) throw new RequestError(404, `Unknown zone ${code}.`);
  return zone;
}

async function spotSlots(db: Db, zone: string, fromMs: number, toMs: number) {
  const t = schema.spotPrices;
  return db
    .select({ startMs: t.slotStartMs, price: t.priceMicro })
    .from(t)
    .where(and(eq(t.zone, zone), gte(t.slotStartMs, fromMs), lt(t.slotStartMs, toMs)))
    .orderBy(asc(t.slotStartMs));
}

const asCharge = (row: typeof schema.charges.$inferSelect, optional = false): Charge => ({
  ownerGln: row.ownerGln,
  code: row.chargeCode,
  validFrom: row.validFrom,
  validTo: row.validTo,
  hourly: row.hourlyMicro,
  ...(optional ? { optional: true } : {}),
});

/** The pricing context for a supported, healthy grid company — or why there isn't one. */
async function pricingContext(
  db: Db,
  zone: Zone,
  gln: string,
  fromMs: number,
  markup: Micro,
): Promise<{ context: PricingContext; name: string } | { note: string; name: string }> {
  const [company] = await db
    .select()
    .from(schema.gridCompanies)
    .where(eq(schema.gridCompanies.gln, gln));
  if (!company) throw new RequestError(404, `Unknown grid company ${gln}.`);
  if (company.zone !== zone.code) {
    throw new RequestError(400, `${company.name} is in ${company.zone}, not ${zone.code}.`);
  }
  if (company.support === 'unsupported') {
    return {
      name: company.name,
      note: `Spot prices only: ${company.supportNote ?? 'tariff not supported yet.'}`,
    };
  }
  if (company.degradedAtMs !== null) {
    return {
      name: company.name,
      note: `Spot prices only: ${company.name}'s tariff data is out of date.`,
    };
  }

  const mappings = await db
    .select()
    .from(schema.tariffMappings)
    .where(and(eq(schema.tariffMappings.gln, gln), eq(schema.tariffMappings.customerType, 'C')));
  const discountCodes = new Set(
    mappings.filter((m) => m.role === 'discount').map((m) => m.chargeCode),
  );
  const c = schema.charges;
  const [gridRows, energinetRows] = await Promise.all([
    db
      .select()
      .from(c)
      .where(
        and(
          eq(c.ownerGln, gln),
          eq(c.chargeType, 'D03'),
          inArray(
            c.chargeCode,
            mappings.map((m) => m.chargeCode),
          ),
        ),
      ),
    db
      .select()
      .from(c)
      .where(
        and(
          eq(c.ownerGln, ENERGINET_GLN),
          eq(c.chargeType, 'D03'),
          inArray(c.chargeCode, [...ENERGINET_CONSUMER_TARIFF_CODES, ELECTRICITY_TAX_CODE]),
        ),
      ),
  ]);

  const day = localTime(fromMs, zone.timeZone).date;
  const [vat] = (
    await db.select().from(schema.vatRates).where(eq(schema.vatRates.zone, zone.code))
  ).filter((v) => v.validFrom <= day && (v.validTo === null || day < v.validTo));
  if (!vat) return { name: company.name, note: 'Spot prices only: no VAT rate configured.' };

  return {
    name: company.name,
    context: {
      timeZone: zone.timeZone,
      gridTariffs: gridRows.map((r) => asCharge(r, discountCodes.has(r.chargeCode))),
      tsoTariffs: energinetRows
        .filter((r) => r.chargeCode !== ELECTRICITY_TAX_CODE)
        .map((r) => asCharge(r)),
      electricityTax: energinetRows
        .filter((r) => r.chargeCode === ELECTRICITY_TAX_CODE)
        .map((r) => asCharge(r)),
      vatBasisPoints: vat.basisPoints,
      supplierMarkup: markup,
    },
  };
}

/**
 * All-in prices for every stored slot in [fromMs, toMs). Falls back to spot prices — and says
 * why — whenever the full price can't be computed honestly.
 */
export async function priceRange(
  db: Db,
  params: { zone: Zone; gln?: string | undefined; fromMs: number; toMs: number; markup: Micro },
): Promise<PricedRange> {
  const { zone } = params;
  const spots = await spotSlots(db, zone.code, params.fromMs, params.toMs);
  const spotOnly = (note: string, gridCompany: PricedRange['gridCompany'] = null): PricedRange => ({
    zone,
    gridCompany,
    mode: 'spot-only',
    note,
    slots: spots.map((s) => priceSlotSpotOnly(s.startMs, s.price)),
  });

  if (!zone.fullPrice) {
    return spotOnly(
      `Spot prices only: grid tariffs and taxes aren't modelled for ${zone.code} yet.`,
    );
  }
  if (!params.gln) {
    return spotOnly('Spot prices only: choose a grid company to include grid tariffs and taxes.');
  }
  const resolved = await pricingContext(db, zone, params.gln, params.fromMs, params.markup);
  const gridCompany = { gln: params.gln, name: resolved.name };
  if ('note' in resolved) return spotOnly(resolved.note, gridCompany);

  try {
    return {
      zone,
      gridCompany,
      mode: 'full',
      note: null,
      slots: spots.map((s) => priceSlot(s.startMs, s.price, resolved.context)),
    };
  } catch (error) {
    if (error instanceof MissingChargeError || error instanceof OverlappingChargeError) {
      console.error(
        JSON.stringify({ event: 'pricing_gap', gln: params.gln, message: error.message }),
      );
      return spotOnly('Spot prices only: tariff data is incomplete for this period.', gridCompany);
    }
    throw error;
  }
}
