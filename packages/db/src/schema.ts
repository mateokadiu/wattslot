import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Uint8Array }>({ dataType: () => 'bytea' });

/** Per-kWh amounts: 6 decimals = whole micro-units, matching the integer maths in @wattslot/pricing. */
const perKwh = (name: string) => numeric(name, { precision: 14, scale: 6 });
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
/** Danish local wall-clock time, exactly as DataHub publishes tariff validity. */
const localWallClock = (name: string) => timestamp(name, { withTimezone: false, mode: 'string' });

// Reference data -----------------------------------------------------------------------------

export const priceZones = pgTable('price_zones', {
  code: text('code').primaryKey(),
  currency: text('currency').notNull(),
  timeZone: text('time_zone').notNull(),
  /** True once a tariff provider exists for the zone; otherwise spot-only pricing. */
  fullPrice: boolean('full_price').notNull().default(false),
});

export const gridCompanies = pgTable('grid_companies', {
  gln: text('gln').primaryKey(),
  name: text('name').notNull(),
  zone: text('zone')
    .notNull()
    .references(() => priceZones.code),
  /** Set by the nightly tariff-mapping check when tariff data looks stale or changed. */
  degradedAt: instant('degraded_at'),
});

/** Which DataHub charge code is the household tariff for each grid company. */
export const tariffMappings = pgTable(
  'tariff_mappings',
  {
    gln: text('gln')
      .notNull()
      .references(() => gridCompanies.gln),
    customerType: text('customer_type').notNull(),
    chargeCode: text('charge_code').notNull(),
  },
  (t) => [primaryKey({ columns: [t.gln, t.customerType] })],
);

// Market data --------------------------------------------------------------------------------

export const spotPrices = pgTable(
  'spot_prices',
  {
    zone: text('zone')
      .notNull()
      .references(() => priceZones.code),
    slotStart: instant('slot_start').notNull(),
    pricePerKwh: perKwh('price_per_kwh').notNull(),
    priceEurPerKwh: perKwh('price_eur_per_kwh').notNull(),
    source: text('source').notNull(),
    ingestedAt: instant('ingested_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.zone, t.slotStart] }),
    check('spot_prices_slot_aligned', sql`extract(epoch from ${t.slotStart})::bigint % 900 = 0`),
  ],
);

export const co2Intensity = pgTable(
  'co2_intensity',
  {
    zone: text('zone')
      .notNull()
      .references(() => priceZones.code),
    time: instant('time').notNull(),
    kind: text('kind').notNull(),
    gPerKwh: numeric('g_per_kwh', { precision: 8, scale: 2 }).notNull(),
    issuedAt: instant('issued_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.zone, t.time, t.kind] }),
    check('co2_intensity_kind', sql`${t.kind} in ('forecast', 'actual')`),
  ],
);

/** DataHub charges: grid tariffs, Energinet tariffs and electricity tax (code EA-001). */
export const charges = pgTable(
  'charges',
  {
    ownerGln: text('owner_gln').notNull(),
    chargeCode: text('charge_code').notNull(),
    chargeType: text('charge_type').notNull(),
    validFrom: localWallClock('valid_from').notNull(),
    validTo: localWallClock('valid_to'),
    /** 24 prices by local hour; flat charges repeat the same value. */
    hourlyPerKwh: perKwh('hourly_per_kwh').array().notNull(),
    isTax: boolean('is_tax').notNull().default(false),
    note: text('note'),
    ingestedAt: instant('ingested_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerGln, t.chargeCode, t.validFrom] }),
    check('charges_24_hours', sql`array_length(${t.hourlyPerKwh}, 1) = 24`),
    check('charges_valid_range', sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`),
  ],
);

/** VAT isn't published by DataHub, so it lives here as dated rows instead of a constant. */
export const vatRates = pgTable(
  'vat_rates',
  {
    zone: text('zone')
      .notNull()
      .references(() => priceZones.code),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    basisPoints: integer('basis_points').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.zone, t.validFrom] }),
    check('vat_rates_range', sql`${t.basisPoints} between 0 and 10000`),
  ],
);

// Sites --------------------------------------------------------------------------------------

export const sites = pgTable('sites', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  name: text('name').notNull(),
  zone: text('zone')
    .notNull()
    .references(() => priceZones.code),
  /** Null → spot-only pricing. Never a street address. */
  gridGln: text('grid_gln').references(() => gridCompanies.gln),
  supplierMarkupPerKwh: perKwh('supplier_markup_per_kwh').notNull().default('0'),
  co2PricePerKg: numeric('co2_price_per_kg', { precision: 8, scale: 2 }).notNull().default('1'),
  /** SHA-256 of the capability token used by the evcc and iCal feeds. */
  feedTokenHash: bytea('feed_token_hash').notNull().unique(),
  createdAt: instant('created_at').notNull().defaultNow(),
});

// Jobs & plans -------------------------------------------------------------------------------

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    energyKwh: numeric('energy_kwh', { precision: 8, scale: 3 }).notNull(),
    maxPowerKw: numeric('max_power_kw', { precision: 6, scale: 2 }).notNull(),
    earliest: instant('earliest').notNull(),
    deadline: instant('deadline').notNull(),
    contiguous: boolean('contiguous').notNull().default(false),
    minRunSlots: integer('min_run_slots').notNull().default(1),
    objective: text('objective').notNull().default('balanced'),
    status: text('status').notNull(),
    workflowId: text('workflow_id').notNull().unique(),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('jobs_site_status').on(t.siteId, t.status),
    check('jobs_kind', sql`${t.kind} in ('ev', 'appliance', 'heat_boost', 'custom')`),
    check('jobs_objective', sql`${t.objective} in ('cheapest', 'balanced', 'greenest')`),
    check('jobs_status', sql`${t.status} in ('planned', 'running', 'done', 'cancelled', 'failed')`),
    check('jobs_window', sql`${t.deadline} > ${t.earliest}`),
    check('jobs_positive', sql`${t.energyKwh} > 0 and ${t.maxPowerKw} > 0`),
  ],
);

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    reason: text('reason').notNull(),
    provisional: boolean('provisional').notNull(),
    cost: perKwh('cost').notNull(),
    co2Grams: numeric('co2_grams', { precision: 14, scale: 2 }).notNull(),
    baselineNowCost: perKwh('baseline_now_cost').notNull(),
    baselineMidnightCost: perKwh('baseline_midnight_cost').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('plans_job_version').on(t.jobId, t.version),
    check(
      'plans_reason',
      sql`${t.reason} in ('created', 'prices_published', 'co2_updated', 'user_edit')`,
    ),
  ],
);

export const planSlots = pgTable(
  'plan_slots',
  {
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    slotStart: instant('slot_start').notNull(),
    energyKwh: numeric('energy_kwh', { precision: 8, scale: 4 }).notNull(),
    pricePerKwh: perKwh('price_per_kwh').notNull(),
    co2GPerKwh: numeric('co2_g_per_kwh', { precision: 8, scale: 2 }).notNull(),
    estimated: boolean('estimated').notNull(),
  },
  (t) => [primaryKey({ columns: [t.planId, t.slotStart] })],
);

// Integrations & delivery --------------------------------------------------------------------

export const integrations = pgTable(
  'integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** Non-secret settings only. */
    config: jsonb('config').notNull().default({}),
    /** AES-256-GCM ciphertext, its wrapped data key, and the associated data it is bound to. */
    secretCiphertext: bytea('secret_ciphertext'),
    secretWrappedKey: bytea('secret_wrapped_key'),
    secretAad: text('secret_aad'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'integrations_kind',
      sql`${t.kind} in ('webpush', 'webhook', 'evcc', 'ha_mqtt', 'easee')`,
    ),
    check(
      'integrations_secret_complete',
      sql`(${t.secretCiphertext} is null) = (${t.secretWrappedKey} is null)`,
    ),
  ],
);

export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('deliveries_action', sql`${t.action} in ('notify', 'start', 'stop', 'push_plan')`),
    check('deliveries_status', sql`${t.status} in ('pending', 'ok', 'failed')`),
  ],
);

// Verified savings (Phase 4, self-host only) ------------------------------------------------

export const meterReadings = pgTable(
  'meter_readings',
  {
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    slotStart: instant('slot_start').notNull(),
    kwh: numeric('kwh', { precision: 10, scale: 4 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.slotStart] })],
);
