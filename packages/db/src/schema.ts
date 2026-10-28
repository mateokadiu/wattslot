/**
 * D1 (SQLite) schema. SQLite has no decimal, timestamp or array types, so:
 * - money is integer micro-units (1e-6 of the currency), matching @wattslot/pricing;
 * - instants are integer epoch milliseconds (UTC);
 * - tariff validity is Danish local wall-clock text, exactly as DataHub publishes it;
 * - energy and power are integer Wh and W.
 */
import { sql } from 'drizzle-orm';
import {
  blob,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core';

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const nowMs = sql`(cast(unixepoch('subsec') * 1000 as integer))`;
const createdAt = () => integer('created_at_ms').notNull().default(nowMs);
const bool = (name: string) => integer(name, { mode: 'boolean' });
/**
 * Format checks via strftime round-trips: a value is valid only if SQLite re-formats it to the
 * same string, which also rejects impossible dates. (D1 rejects long GLOB patterns.)
 */
const isWallClock = (column: string) =>
  sql.raw(`"${column}" = strftime('%Y-%m-%dT%H:%M:%S', "${column}")`);
const isDate = (column: string) => sql.raw(`"${column}" = date("${column}")`);

// Reference data -----------------------------------------------------------------------------

export const priceZones = sqliteTable('price_zones', {
  code: text('code').primaryKey(),
  currency: text('currency').notNull(),
  timeZone: text('time_zone').notNull(),
  /** True once a tariff provider exists for the zone; otherwise spot-only pricing. */
  fullPrice: bool('full_price').notNull().default(false),
});

export const gridCompanies = sqliteTable(
  'grid_companies',
  {
    gln: text('gln').primaryKey(),
    name: text('name').notNull(),
    zone: text('zone')
      .notNull()
      .references(() => priceZones.code),
    /** Connected consumption metering points (DataHub statistics) — roughly, customers. */
    meteringPoints: integer('metering_points'),
    /** `unsupported` companies fall back to spot-only pricing until their tariff is understood. */
    support: text('support', { enum: ['supported', 'unsupported'] }).notNull(),
    supportNote: text('support_note'),
    /** Set by the nightly tariff-mapping check when tariff data looks stale or changed. */
    degradedAtMs: integer('degraded_at_ms'),
  },
  (t) => [check('grid_companies_support', sql`${t.support} in ('supported', 'unsupported')`)],
);

/**
 * The DataHub charge codes that make up a grid company's household tariff. Usually one
 * `tariff`; some companies add a regional tariff (also `tariff`) or a time-limited `discount`,
 * which counts as zero once it ends.
 */
export const tariffMappings = sqliteTable(
  'tariff_mappings',
  {
    gln: text('gln')
      .notNull()
      .references(() => gridCompanies.gln),
    customerType: text('customer_type').notNull(),
    chargeCode: text('charge_code').notNull(),
    role: text('role', { enum: ['tariff', 'discount'] }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.gln, t.customerType, t.chargeCode] }),
    check('tariff_mappings_role', sql`${t.role} in ('tariff', 'discount')`),
  ],
);

// Market data --------------------------------------------------------------------------------

export const spotPrices = sqliteTable(
  'spot_prices',
  {
    zone: text('zone')
      .notNull()
      .references(() => priceZones.code),
    slotStartMs: integer('slot_start_ms').notNull(),
    /** Micro-units of the zone currency per kWh. */
    priceMicro: integer('price_micro').notNull(),
    priceEurMicro: integer('price_eur_micro').notNull(),
    source: text('source').notNull(),
    ingestedAtMs: integer('ingested_at_ms').notNull().default(nowMs),
  },
  (t) => [
    primaryKey({ columns: [t.zone, t.slotStartMs] }),
    check('spot_prices_slot_aligned', sql`${t.slotStartMs} % 900000 = 0`),
  ],
);

export const co2Intensity = sqliteTable(
  'co2_intensity',
  {
    zone: text('zone')
      .notNull()
      .references(() => priceZones.code),
    timeMs: integer('time_ms').notNull(),
    kind: text('kind', { enum: ['forecast', 'actual'] }).notNull(),
    gPerKwh: real('g_per_kwh').notNull(),
    issuedAtMs: integer('issued_at_ms').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.zone, t.timeMs, t.kind] }),
    check('co2_intensity_kind', sql`${t.kind} in ('forecast', 'actual')`),
    check('co2_intensity_aligned', sql`${t.timeMs} % 300000 = 0`),
  ],
);

/** DataHub charges: grid tariffs, Energinet tariffs and electricity tax (code EA-001). */
export const charges = sqliteTable(
  'charges',
  {
    ownerGln: text('owner_gln').notNull(),
    chargeCode: text('charge_code').notNull(),
    chargeType: text('charge_type').notNull(),
    validFrom: text('valid_from').notNull(),
    validTo: text('valid_to'),
    /** 24 micro-unit prices by local hour; flat charges repeat the same value. */
    hourlyMicro: text('hourly_micro', { mode: 'json' }).$type<number[]>().notNull(),
    isTax: bool('is_tax').notNull().default(false),
    note: text('note'),
    ingestedAtMs: integer('ingested_at_ms').notNull().default(nowMs),
  },
  (t) => [
    // Charge type is part of the key: some grid companies reuse one code for a tariff (D03)
    // and a subscription (D01), which would otherwise overwrite each other.
    primaryKey({ columns: [t.ownerGln, t.chargeType, t.chargeCode, t.validFrom] }),
    check('charges_type', sql`${t.chargeType} in ('D01', 'D02', 'D03')`),
    check('charges_24_hours', sql`json_array_length(${t.hourlyMicro}) = 24`),
    check('charges_valid_from_format', isWallClock('valid_from')),
    check('charges_valid_to_format', sql`${t.validTo} is null or ${isWallClock('valid_to')}`),
    check('charges_valid_range', sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`),
  ],
);

/** VAT isn't published by DataHub, so it lives here as dated rows instead of a constant. */
export const vatRates = sqliteTable(
  'vat_rates',
  {
    zone: text('zone')
      .notNull()
      .references(() => priceZones.code),
    validFrom: text('valid_from').notNull(),
    validTo: text('valid_to'),
    basisPoints: integer('basis_points').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.zone, t.validFrom] }),
    check('vat_rates_range', sql`${t.basisPoints} between 0 and 10000`),
    check('vat_rates_date_format', isDate('valid_from')),
  ],
);

/** Per scheduled task: when it last worked and when it may run again after a 429. */
export const ingestState = sqliteTable('ingest_state', {
  task: text('task').primaryKey(),
  lastSuccessAtMs: integer('last_success_at_ms'),
  nextAttemptAtMs: integer('next_attempt_at_ms'),
  lastError: text('last_error'),
  updatedAtMs: integer('updated_at_ms').notNull().default(nowMs),
});

// Sites --------------------------------------------------------------------------------------

export const sites = sqliteTable('sites', {
  id: id(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  zone: text('zone')
    .notNull()
    .references(() => priceZones.code),
  /** Null → spot-only pricing. Never a street address. */
  gridGln: text('grid_gln').references(() => gridCompanies.gln),
  supplierMarkupMicro: integer('supplier_markup_micro').notNull().default(0),
  /** CO₂ shadow price in micro-units per kg; default 1.0 DKK/kg. */
  co2PriceMicroPerKg: integer('co2_price_micro_per_kg').notNull().default(1_000_000),
  /** SHA-256 of the capability token used by the evcc, iCal and Home Assistant feeds. */
  feedTokenHash: blob('feed_token_hash', { mode: 'buffer' }).notNull().unique(),
  createdAtMs: createdAt(),
});

// Jobs & plans -------------------------------------------------------------------------------

export const jobs = sqliteTable(
  'jobs',
  {
    id: id(),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['ev', 'appliance', 'heat_boost', 'custom'] }).notNull(),
    energyWh: integer('energy_wh').notNull(),
    maxPowerW: integer('max_power_w').notNull(),
    earliestMs: integer('earliest_ms').notNull(),
    deadlineMs: integer('deadline_ms').notNull(),
    contiguous: bool('contiguous').notNull().default(false),
    minRunSlots: integer('min_run_slots').notNull().default(1),
    objective: text('objective', { enum: ['cheapest', 'balanced', 'greenest'] })
      .notNull()
      .default('balanced'),
    status: text('status', {
      enum: ['planned', 'running', 'done', 'cancelled', 'failed'],
    }).notNull(),
    workflowId: text('workflow_id').notNull().unique(),
    createdAtMs: createdAt(),
  },
  (t) => [
    index('jobs_site_status').on(t.siteId, t.status),
    check('jobs_kind', sql`${t.kind} in ('ev', 'appliance', 'heat_boost', 'custom')`),
    check('jobs_objective', sql`${t.objective} in ('cheapest', 'balanced', 'greenest')`),
    check('jobs_status', sql`${t.status} in ('planned', 'running', 'done', 'cancelled', 'failed')`),
    check('jobs_window', sql`${t.deadlineMs} > ${t.earliestMs}`),
    check('jobs_positive', sql`${t.energyWh} > 0 and ${t.maxPowerW} > 0`),
  ],
);

export const plans = sqliteTable(
  'plans',
  {
    id: id(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    reason: text('reason', {
      enum: ['created', 'prices_published', 'co2_updated', 'user_edit'],
    }).notNull(),
    provisional: bool('provisional').notNull(),
    costMicro: integer('cost_micro').notNull(),
    co2Grams: real('co2_grams').notNull(),
    baselineNowMicro: integer('baseline_now_micro').notNull(),
    baselineMidnightMicro: integer('baseline_midnight_micro').notNull(),
    createdAtMs: createdAt(),
  },
  (t) => [
    unique('plans_job_version').on(t.jobId, t.version),
    check(
      'plans_reason',
      sql`${t.reason} in ('created', 'prices_published', 'co2_updated', 'user_edit')`,
    ),
  ],
);

export const planSlots = sqliteTable(
  'plan_slots',
  {
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    slotStartMs: integer('slot_start_ms').notNull(),
    energyWh: integer('energy_wh').notNull(),
    priceMicro: integer('price_micro').notNull(),
    co2GPerKwh: real('co2_g_per_kwh').notNull(),
    estimated: bool('estimated').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.planId, t.slotStartMs] }),
    check('plan_slots_aligned', sql`${t.slotStartMs} % 900000 = 0`),
  ],
);

// Integrations & delivery --------------------------------------------------------------------

export const integrations = sqliteTable(
  'integrations',
  {
    id: id(),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['webpush', 'webhook', 'evcc', 'ha_feed', 'easee'] }).notNull(),
    /** Non-secret settings only. */
    config: text('config', { mode: 'json' }).notNull().default({}),
    /** AES-256-GCM ciphertext, its wrapped data key, and the associated data it is bound to. */
    secretCiphertext: blob('secret_ciphertext', { mode: 'buffer' }),
    secretWrappedKey: blob('secret_wrapped_key', { mode: 'buffer' }),
    secretAad: text('secret_aad'),
    enabled: bool('enabled').notNull().default(true),
    createdAtMs: createdAt(),
  },
  (t) => [
    check(
      'integrations_kind',
      sql`${t.kind} in ('webpush', 'webhook', 'evcc', 'ha_feed', 'easee')`,
    ),
    check(
      'integrations_secret_complete',
      sql`(${t.secretCiphertext} is null) = (${t.secretWrappedKey} is null)`,
    ),
  ],
);

export const deliveries = sqliteTable(
  'deliveries',
  {
    id: id(),
    integrationId: text('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    action: text('action', { enum: ['notify', 'start', 'stop', 'push_plan'] }).notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    status: text('status', { enum: ['pending', 'ok', 'failed'] }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAtMs: createdAt(),
  },
  (t) => [
    check('deliveries_action', sql`${t.action} in ('notify', 'start', 'stop', 'push_plan')`),
    check('deliveries_status', sql`${t.status} in ('pending', 'ok', 'failed')`),
  ],
);

// Verified savings (Phase 4, deploy-your-own only) --------------------------------------------

export const meterReadings = sqliteTable(
  'meter_readings',
  {
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    slotStartMs: integer('slot_start_ms').notNull(),
    energyWh: integer('energy_wh').notNull(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.slotStartMs] })],
);
