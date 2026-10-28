# `wattslot` — Implementation Plan

> A self-hostable planning engine that tells you — or your charger, heat pump or Home Assistant — **when** to use electricity, using the price you actually pay (spot + grid tariff + taxes + VAT) and the grid's CO₂ forecast, at 15-minute resolution.

**Status:** Decisions confirmed 2026-10-28 (§13). Phase 0 done (§15).
**Research date:** 2026-10-28. Every market number below has a source in §17; anything not verified is marked _(unverified)_.

---

## 1. Goals & non-goals

### Goals

- **Full-price engine.** For any 15-minute slot, return the all-in consumer price as a breakdown: spot + grid-company time-of-use tariff + Energinet tariffs + electricity tax + optional supplier markup + VAT. Resolved from the user's grid company, not typed in by hand.
- **Cost + CO₂ planner.** Given a job ("11 kWh, max 7.4 kW, done by 07:00"), pick the slots that minimise cost, CO₂, or a blend of both — and show the three options side by side.
- **Works for dumb appliances too.** A dishwasher without an API still benefits: the plan arrives as a push notification or calendar event ("start at 01:15").
- **Plays well with what people already run.** Feed evcc and Home Assistant instead of competing with their device libraries.
- **Honest savings.** Compare every plan against "start now" _and_ against a plain midnight timer, and (later) verify against real meter data.
- **Self-host first, $0 to run.** One `docker compose up` on a free ARM VM. No paid APIs.
- **Zone-agnostic core.** Denmark (DK1/DK2) gets full-price support first; other bidding zones in the same dataset (DE, NO, SE, FI) work in spot-only mode until a tariff provider exists.

### Non-goals (v1)

- Being an electricity supplier, aggregator or flexibility-market participant.
- Running an OCPP backend (CSMS) or shipping hardware.
- Direct vehicle APIs (Tesla Fleet API needs a card on file and bills per call — see §11).
- ML price forecasting beyond the published day-ahead horizon (Phase 4 at the earliest).
- Native iOS app in v1 (Apple Developer Program fee; the PWA covers iOS push).

---

## 2. Market research

### 2.1 Why now

| Signal                                   | Number                                                | Source              |
| ---------------------------------------- | ----------------------------------------------------- | ------------------- |
| BEVs on Danish roads (end Sep 2026)      | **718,317** (24.2% of all cars), +47.5% y/y           | DST BIL54           |
| BEV share of new cars                    | **68.5%** in 2025, **82%** 2026 YTD (Sep 2026: 88.8%) | FDM                 |
| Homes heated by a heat pump (1 Jan 2026) | **222,995** occupied dwellings                        | DST BOL102          |
| Households (1 Jan 2026)                  | 2,878,144                                             | DST FAM55N          |
| Customers on variable-price contracts    | **69%** (2023, latest verified)                       | Green Power Denmark |
| Day-ahead market resolution              | **15 minutes** since delivery day 2025-10-01          | EPEX / Nord Pool    |
| Meters able to settle per 15 min         | ~81% (May 2025)                                       | Forsyningstilsynet  |
| Electricity tax (elafgift)               | **0.008 DKK/kWh** in 2026–2027 (0.72 in 2025)         | Skat                |
| Negative-price hours, 2025               | DK1 441 h, DK2 265 h                                  | EDS analysis        |

Two changes in the last 13 months make the problem sharper:

1. **15-minute prices.** A planner that thinks in hours is now leaving money on the table and mis-reading the data (`Elspotprices` stopped on 2025-09-30; `DayAheadPrices` replaced it).
2. **The tax cut made grid tariffs the dominant price lever.** With elafgift at 0.008, the grid company's 17–21 peak tariff (e.g. Radius winter: 0.956 DKK/kWh vs 0.106 at night) is often larger than the spot price swing.

### 2.2 What a kWh actually costs (DK2, Radius area, 2026-10-28)

|                                               | Night slot 00:00 | Evening slot 18:00 |
| --------------------------------------------- | ---------------- | ------------------ |
| Spot (DayAheadPrices)                         | 1.097            | 2.398              |
| Grid tariff (Radius "Nettarif C", winter)     | 0.106            | 0.956              |
| Energinet (system 0.072 + transmission 0.043) | 0.115            | 0.115              |
| Electricity tax                               | 0.008            | 0.008              |
| **Incl. 25% VAT**                             | **1.66 DKK/kWh** | **4.35 DKK/kWh**   |

Supplier markup excluded (flat per kWh, doesn't change which slot is cheapest).

Grid tariffs for household ("C") customers, DKK/kWh excl. VAT, from `DatahubPricelist`:

| Grid company        | Winter low / high / **peak** | Summer low / high / peak |
| ------------------- | ---------------------------- | ------------------------ |
| Radius (DK2)        | 0.106 / 0.319 / **0.956**    | 0.106 / 0.159 / 0.414    |
| Cerius (DK2)        | 0.115 / 0.346 / **1.038**    | 0.115 / 0.173 / 0.450    |
| N1 (DK1)            | 0.088 / 0.264 / **0.791**    | 0.088 / 0.132 / 0.343    |
| TREFOR El-net (DK1) | 0.043 / 0.129 / **0.386**    | 0.043 / 0.064 / 0.167    |

Tarifmodel 3.0 periods: low 00–06, high 06–17 and 21–24, peak 17–21. Winter = Oct–Mar.

### 2.3 Economics — what the product can honestly claim

Simulated on real 15-minute prices, Oct 2025 – Sep 2026, real tariffs, VAT included:

| EV, 3,000 kWh/yr, 7.4 kW, plugged in 17:00, ready 07:00 | DK2 / Radius       | DK1 / N1           |
| ------------------------------------------------------- | ------------------ | ------------------ |
| Charge immediately                                      | 6,210 DKK/yr       | 5,630 DKK/yr       |
| Cheapest 15-min slots                                   | 3,217 DKK/yr       | 3,170 DKK/yr       |
| **Saving vs plug-and-charge**                           | **≈ 2,990 (−48%)** | **≈ 2,460 (−44%)** |
| Saving vs a plain 00:00 timer                           | ≈ 550              | ≈ 575              |

Heat pump (5,200 kWh/yr, 20–30% of daily load shiftable — an assumption, not a measurement): ≈ 880–1,500 DKK/yr.

**Does "full price" change the plan, or just the number?** Measured over 393 days of DK2 data (Radius tariffs), choosing the 6 cheapest slots:

| Scenario                       | Days where spot-only picks different slots | Extra cost of spot-only over the period |
| ------------------------------ | ------------------------------------------ | --------------------------------------- |
| EV window 17:00 → 07:00        | **73%**                                    | ~330 DKK                                |
| Appliance window 08:00 → 23:00 | 13%                                        | ~80 DKK                                 |

Takeaway, stated plainly in the product: **most of the money comes from staying out of 17–21; full-price accuracy makes the plan _right_ and the displayed numbers _true_, but it is not a big extra saving on its own.** The UI never inflates savings — it always shows the midnight-timer baseline next to the "start now" one.

### 2.4 Competitive landscape

| Product                 | Who                          | Full price (spot+tariff+tax)?                 | CO₂                      | Controls devices       | Open API                   | Adoption          |
| ----------------------- | ---------------------------- | --------------------------------------------- | ------------------------ | ---------------------- | -------------------------- | ----------------- |
| Min Strøm               | DK/NO/SE consumers, freemium | Displays both; optimiser basis _(unverified)_ | Footprint                | EV (via Enode)         | No                         | ~1M users claimed |
| Strømligning            | DK comparison site           | **Yes**, per supplier                         | No                       | No                     | Yes — non-commercial only  | —                 |
| elprisenligenu.dk       | DK devs                      | No (spot excl. VAT)                           | No                       | No                     | Yes, free; **hourly only** | —                 |
| Andel Energi / Norlys   | Own customers                | Shown; basis _(unverified)_                   | Mix                      | Norlys: EV             | No                         | Andel 44k ratings |
| Monta                   | Charger owners               | Partial (DSO pick + manual fees)              | Yes (slider)             | EV                     | Operator-only              | —                 |
| Clever                  | DK EV drivers                | _(unverified)_                                | Yes                      | EV                     | No                         | —                 |
| Easee / Zaptec          | Charger owners               | **Spot only**                                 | No                       | EV                     | Vendor APIs                | —                 |
| Homey                   | Smart-home owners            | Formula only                                  | No                       | Anything via Flows     | Yes                        | —                 |
| **evcc** (OSS, Go)      | Self-hosters                 | Manual `chargesZones`                         | Yes — cheap **or** green | EV, heat pump, battery | REST/MQTT                  | 7.4k ★            |
| HA `energidataservice`  | HA users                     | **Yes**, auto tariffs                         | Yes                      | Via HA                 | —                          | 284 ★             |
| EMHASS (OSS, Python LP) | HA power users               | User-supplied                                 | Yes                      | Via HA                 | Yes                        | 718 ★             |

### 2.5 Gaps this project fills

1. **Full price as a library/API, resolved automatically.** evcc needs hand-written tariff zones; chargers optimise on spot; Strømligning's API forbids commercial use; the HA integration only lives inside HA.
2. **Cost and CO₂ together.** evcc picks cheap _or_ green. A CO₂ shadow price (§8.3) gives a principled blend and a 3-option comparison.
3. **No smart home required.** Push notification / calendar event for appliances without an API.
4. **Verified savings** from Eloverblik meter data instead of claimed ones.
5. **A tested, documented planning core** others can embed (evcc custom tariff, HA MQTT, webhooks).

### 2.6 Risks

| Risk                                                                                 | Mitigation                                                                                                                       |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| evcc already controls devices well and could add a tariff resolver                   | Position as a **feed** for evcc (custom tariff + plan push), not a rival. Device control stays out of scope.                     |
| Grid companies change tariff code names / periods (regulator is reviewing ToU zones) | Curated `tariff_mappings` table with a nightly validation job that alerts when a mapped code disappears or a new period appears. |
| EDS rate limits (HTTP 429, ~300 s back-off) and the "don't proxy for all users" rule | One central ingester per dataset, cached in Postgres; users never hit EDS.                                                       |
| Tax/tariff policy changes (elafgift returns after 2027)                              | Taxes are dated rows, not constants.                                                                                             |
| Incumbent apps are free                                                              | Compete on openness, correctness and integrations, not on reach.                                                                 |

---

## 3. The problem, concretely

```
17:00  plug in EV ──► charger starts at full power ──► 17:00–18:30 at 4.35 DKK/kWh
                                                       (peak tariff + evening spot)

What the user wanted:  "11 kWh by 07:00, as cheap and clean as possible"
What it should do:      pick 6 quarter-hours between 00:00 and 06:00
                        → ~1.7–2.3 DKK/kWh, ~60% cheaper on recent days
```

Three things make this harder than "sort by price":

1. **The price you pay isn't the spot price** — it's 6 components, two of them hourly, one seasonal, with VAT on top.
2. **Tomorrow's prices arrive at ~13:00, CO₂ forecasts at ~15:00** — plans made in the morning must be provisional and re-plan when data lands.
3. **Time is hard**: 15-minute slots in UTC, tariffs in local hours, DST days with 92 or 100 slots.

---

## 4. Architecture

```
                         ┌───────────────────────────────────────────┐
  Energi Data Service ──►│  ingest workflows (Temporal schedules)    │
  (DayAheadPrices,       │  one fetch per dataset per update window  │
   CO2EmisProg, CO2Emis, │  429-aware, idempotent upserts            │
   DatahubPricelist)     └──────────────────┬────────────────────────┘
  ENTSO-E (fallback, P4)                    │
                                            ▼
                               ┌──────────────────────────┐
                               │   Postgres 16             │
                               │   spot / co2 / charges /  │
                               │   sites / jobs / plans    │
                               └──────┬────────────┬───────┘
                                      │            │
               ┌──────────────────────┘            └─────────────────────┐
               ▼                                                         ▼
  ┌──────────────────────────┐   signal: pricesUpdated    ┌──────────────────────────┐
  │  api (NestJS, REST +     │──────────────────────────► │  job workflows (Temporal)│
  │  OpenAPI)                │   start / cancel / update  │  plan → timers → actuate │
  │  • /prices  (breakdown)  │                            │  → re-plan → settle      │
  │  • /jobs    /plans       │                            └────────────┬─────────────┘
  │  • /evcc/tariff  (feed)  │                                         │ activities
  │  • /ical         (feed)  │                                         ▼
  └────────────┬─────────────┘            ┌─────────────────────────────────────────┐
               │                          │ web push · signed webhooks · evcc plan   │
               ▼                          │ push · HA MQTT discovery · Easee (P4)    │
  ┌──────────────────────────┐            └─────────────────────────────────────────┘
  │ web (Next.js PWA)        │
  │ price chart · jobs · 3-  │      packages/pricing  — pure: all-in price per slot
  │ option plan · settings   │      packages/planner  — pure: slot selection
  └──────────────────────────┘      (both property-tested, no I/O)
```

**Design rules**

- **Pure core, effectful shell.** `pricing` and `planner` are pure TypeScript packages with no I/O — the api and workflows call them. All the interesting logic is unit/property-testable without Docker.
- **Users never call upstream.** EDS asks vendors to cache and serve their own users; ingestion is centralised and the api reads only from Postgres.
- **Every plan is versioned.** Re-plans create a new `plan` row; the old one is kept for audit and for "why did it change?" in the UI.
- **REST + OpenAPI is the public surface.** No gRPC: there is one service boundary (api ↔ workers) and Temporal already is that boundary.

---

## 5. Tech stack

| Layer         | Choice                                                                                                              | Why                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Language      | TypeScript 6 (strict, `exactOptionalPropertyTypes`), Node 24, ESM                                                   | One language across api, workers, web. TS 6 rather than the new native TS 7 until NestJS decorator support is confirmed |
| Monorepo      | pnpm + Turborepo                                                                                                    | Shared `pricing`/`planner` packages                                                                                     |
| API           | NestJS 11                                                                                                           | Modules, DI, OpenAPI generation                                                                                         |
| Workflows     | Temporal (self-hosted, Postgres persistence + SQL visibility)                                                       | Durable timers per job, re-plan via signals, retries with back-off; no Elasticsearch                                    |
| DB            | Postgres 16 + Drizzle ORM                                                                                           | Data is small (≈35k price rows / zone / year; ≈105k CO₂ rows) — no Timescale needed                                     |
| Money         | Integer micro-DKK (1e-6 DKK) in code, `numeric(14,6)` in DB                                                         | No float drift when summing 96 slots × 6 components                                                                     |
| Validation    | Zod at every boundary (EDS responses, API input)                                                                    | Upstream schema changes fail loudly                                                                                     |
| Web           | Next.js 16 (App Router, RSC) + Tailwind + hand-rolled SVG chart                                                     | PWA with Web Push (works on iOS 16.4+ home-screen apps)                                                                 |
| Auth          | Better-Auth — passkeys + email magic link; single-user mode for self-host                                           | No passwords stored                                                                                                     |
| Secrets       | Envelope encryption: AES-256-GCM DEKs wrapped by OpenBao Transit (self-host) or OCI Vault (free)                    | Device tokens never stored in plaintext                                                                                 |
| Lint / format | Biome (single tool, CI-enforced)                                                                                    | Same setup as the other repos; no ESLint/Prettier                                                                       |
| Tests         | Vitest + fast-check (property), recorded EDS fixtures (golden days), Playwright (web), Testcontainers (integration) |                                                                                                                         |
| Infra         | Docker Compose on Oracle Cloud Always Free (ARM, 4 OCPU / 24 GB), Caddy for TLS, Pulumi for the VM + network        | $0/month                                                                                                                |
| CI            | GitHub Actions: lint, typecheck, unit, property, integration, e2e, image build                                      |                                                                                                                         |

---

## 6. Data sources

| Source                  | Dataset / endpoint                                                                              | Resolution            | When it updates                                          | Use                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| Energi Data Service     | `DayAheadPrices` (`TimeUTC`, `TimeDK`, `PriceArea`, `DayAheadPriceDKK/EUR`)                     | 15 min                | Prelim. results ~12:55 CET; poll every 5 min 13:00–14:00 | Spot prices, all zones in dataset                   |
|                         | `CO2EmisProg` (`Minutes5UTC`, `PriceArea`, `CO2Emission` g/kWh)                                 | 5 min                 | Next-day forecast ~15:00, adjusted intraday              | CO₂ planning                                        |
|                         | `CO2Emis`                                                                                       | 5 min                 | Every 5 min                                              | Actuals for settlement / "what actually happened"   |
|                         | `DatahubPricelist` (`GLN_Number`, `ChargeTypeCode`, `ChargeType`, `ValidFrom/To`, `Price1..24`) | Hourly per local hour | Daily; future periods pre-loaded                         | Grid + Energinet tariffs                            |
| Eloverblik customer API | `/api/token` (refresh → 24 h access), `/api/meterdata/gettimeseries/{from}/{to}/Quarter`        | 15 min                | —                                                        | Phase 4: verified savings, auto-detect grid company |
| ENTSO-E Transparency    | Day-ahead prices (free token)                                                                   | 15 min                | Daily                                                    | Phase 4: fallback if EDS is down                    |

**Licence:** EDS data is CC BY 4.0 — every page and API response that shows it carries "Source: Energinet (www.energidataservice.dk)".

**Gotchas already found**

- `Elspotprices` is frozen at 2025-09-30. Use `DayAheadPrices` only.
- In `DatahubPricelist`, a **flat** charge has only `Price1` set and `Price2..24 = null`; a time-of-use tariff fills all 24. Treat `null` as "same as Price1".
- Tariffs are hourly by **local** hour; prices are 15-min by UTC instant. Expansion happens in `pricing` (§8.1).
- **Electricity tax is in `DatahubPricelist` too:** Energinet GLN `5790000432752`, code `EA-001`, `TaxIndicator = 1` (0.72 DKK/kWh in 2025, 0.008 for 2026–2027). Taxes therefore update with the data; only VAT is configured (`vat_rates`).
- `ValidFrom`/`ValidTo` are Danish **local** wall-clock times. They're stored as `timestamp` (no zone) and compared against the slot's local wall clock, never converted.
- A negative spot price is not a negative bill: on 2026-04-05 DK2 had 36 negative slots (min −0.046 DKK/kWh) but every all-in price stayed positive because tariffs + tax add ~0.23 DKK/kWh.
- No price forecast dataset exists on EDS. Anything beyond the published day-ahead horizon is the project's own estimate and must be labelled as such.
- EDS rate limits are per dataset and unpublished; over the limit returns HTTP 429 with "try again in N seconds".
- Eloverblik limits: 2 token calls/min/IP, 120 calls/min/IP, ≤ 730 days per request.

---

## 7. Database schema (Postgres 16 + Drizzle)

```sql
-- Reference data ------------------------------------------------------------
create table price_zones (
  code        text primary key,              -- 'DK1', 'DK2', 'DE', 'SE3' …
  currency    text not null,                 -- 'DKK' | 'EUR' | 'SEK' | 'NOK'
  timezone    text not null,                 -- 'Europe/Copenhagen'
  full_price  boolean not null default false -- tariff provider available?
);

create table grid_companies (
  gln          text primary key,             -- '5790000705689' (Radius)
  name         text not null,
  zone         text not null references price_zones(code)
);

-- Which ChargeTypeCode is the household tariff for each grid company.
-- Curated, validated nightly (§10.4).
create table tariff_mappings (
  gln           text not null references grid_companies(gln),
  customer_type text not null,               -- 'C' (household) for v1
  charge_code   text not null,               -- e.g. 'DT_C_01'
  primary key (gln, customer_type)
);

-- Market data ----------------------------------------------------------------
create table spot_prices (
  zone         text not null references price_zones(code),
  slot_start   timestamptz not null,         -- UTC, 15-min aligned
  price_dkk    numeric(14,6) not null,       -- per kWh
  price_eur    numeric(14,6) not null,
  source       text not null,                -- 'eds' | 'entsoe'
  ingested_at  timestamptz not null default now(),
  primary key (zone, slot_start)
);

create table co2_intensity (
  zone         text not null,
  ts           timestamptz not null,         -- 5-min
  kind         text not null check (kind in ('forecast','actual')),
  g_per_kwh    numeric(8,2) not null,
  issued_at    timestamptz not null,         -- forecasts get revised
  primary key (zone, ts, kind)
);

create table charges (                    -- grid tariffs, Energinet tariffs, elafgift (EA-001)
  owner_gln      text not null,
  charge_code    text not null,
  charge_type    text not null,              -- D01 subscription | D02 fee | D03 tariff
  valid_from     timestamp not null,         -- Danish local wall clock, as published
  valid_to       timestamp,
  hourly_per_kwh numeric(14,6)[] not null check (array_length(hourly_per_kwh, 1) = 24),
  is_tax         boolean not null default false,
  note           text,
  primary key (owner_gln, charge_code, valid_from)
);

create table vat_rates (                   -- the only tax DataHub doesn't publish
  zone         text not null,
  valid_from   date not null,
  valid_to     date,
  basis_points int not null,                -- 2500 = 25%
  primary key (zone, valid_from)
);

-- Users & sites ----------------------------------------------------------------
create table sites (
  id               uuid primary key,
  user_id          uuid not null,
  name             text not null,
  zone             text not null references price_zones(code),
  grid_gln         text references grid_companies(gln),   -- null → spot-only mode
  supplier_markup  numeric(14,6) not null default 0,       -- DKK/kWh excl. VAT
  co2_price_dkk_kg numeric(8,2) not null default 0,        -- shadow price (§8.3)
  feed_token_hash  bytea not null,                         -- capability URL for evcc/iCal
  created_at       timestamptz not null default now()
);

-- Jobs & plans -----------------------------------------------------------------
create table jobs (
  id            uuid primary key,
  site_id       uuid not null references sites(id),
  kind          text not null,               -- 'ev' | 'appliance' | 'heat_boost' | 'custom'
  energy_kwh    numeric(8,3) not null,
  max_power_kw  numeric(6,2) not null,
  earliest      timestamptz not null,
  deadline      timestamptz not null,
  contiguous    boolean not null default false, -- dishwasher programs can't pause
  min_run_slots int not null default 1,          -- heat pumps: avoid short cycling
  objective     text not null default 'balanced', -- 'cheapest' | 'greenest' | 'balanced'
  status        text not null,               -- 'planned' | 'running' | 'done' | 'cancelled' | 'failed'
  workflow_id   text not null unique,
  created_at    timestamptz not null default now()
);

create table plans (
  id            uuid primary key,
  job_id        uuid not null references jobs(id),
  version       int not null,
  reason        text not null,               -- 'created' | 'prices_published' | 'co2_updated' | 'user_edit'
  provisional   boolean not null,            -- uses estimated slots beyond known prices
  cost_dkk      numeric(14,6) not null,
  co2_g         numeric(14,2) not null,
  baseline_now_dkk      numeric(14,6) not null,
  baseline_midnight_dkk numeric(14,6) not null,
  created_at    timestamptz not null default now(),
  unique (job_id, version)
);

create table plan_slots (
  plan_id     uuid not null references plans(id),
  slot_start  timestamptz not null,
  energy_kwh  numeric(8,4) not null,
  price_dkk   numeric(14,6) not null,        -- all-in, incl. VAT
  co2_g_kwh   numeric(8,2) not null,
  estimated   boolean not null,
  primary key (plan_id, slot_start)
);

-- Integrations & delivery ------------------------------------------------------
create table integrations (
  id            uuid primary key,
  site_id       uuid not null references sites(id),
  kind          text not null,               -- 'webpush' | 'webhook' | 'evcc' | 'ha_mqtt' | 'easee'
  config        jsonb not null,              -- non-secret settings only
  secret_ct     bytea,                       -- AES-256-GCM ciphertext
  secret_dek    bytea,                       -- wrapped DEK
  secret_aad    text,                        -- 'site:<id>|kind:<kind>'
  enabled       boolean not null default true
);

create table deliveries (
  id              uuid primary key,
  integration_id  uuid not null references integrations(id),
  plan_id         uuid not null references plans(id),
  action          text not null,             -- 'notify' | 'start' | 'stop' | 'push_plan'
  idempotency_key text not null unique,
  status          text not null,             -- 'pending' | 'ok' | 'failed'
  attempts        int not null default 0,
  last_error      text,
  created_at      timestamptz not null default now()
);

-- Phase 4: verified savings ------------------------------------------------------
create table meter_readings (
  site_id     uuid not null references sites(id),
  slot_start  timestamptz not null,
  kwh         numeric(10,4) not null,
  primary key (site_id, slot_start)
);
```

---

## 8. Core algorithms

### 8.1 All-in price per slot (`packages/pricing`)

```
allIn(slot) = ( spot(zone, slot)
              + Σ tariff(gln, code, localHour(slot), date(slot))   -- grid company, hourly
              + Σ energinetCharges(localHour(slot), date(slot))     -- flat today, but hourly-capable
              + elafgift(date)                                        -- DataHub EA-001
              + supplierMarkup ) × (1 + VAT)
```

- **Slot → local hour:** convert the UTC slot start to `Europe/Copenhagen`; the hour picks `Price{h+1}`.
- **DST spring-forward (23 h day):** local hour 02 doesn't exist → 92 slots; nothing to look up.
- **DST fall-back (25 h day):** local hour 02 occurs twice → both use `Price3`. Both are in the low-load band for every known tariff, so there's no ambiguity in practice; a test pins it.
- **Validity:** pick the charge row whose `[valid_from, valid_to)` contains the slot. A missing row is a hard error, not a zero.
- **Output:** a per-component breakdown, not just a total — the chart stacks it and users can see _why_ 18:00 is expensive.

### 8.2 Slot selection (`packages/planner`)

Input: candidate slots in `[earliest, deadline)`, each with `score`, `capacity_kwh = max_power_kw × 0.25`. Need `E` kWh.

| Job shape                                     | Algorithm                                                              | Complexity                     |
| --------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------ |
| Interruptible (EV, most heat boosts)          | Sort by score, take slots until `E` is met; last slot partially filled | O(n log n), optimal            |
| Contiguous (dishwasher, washing machine)      | Sliding window of `k = ceil(E / capacity)` slots, minimum sum          | O(n), optimal                  |
| Min run length (heat pump: ≥ 2 slots per run) | DP over slots with state = (energy filled, current run length)         | O(n · k · m), fine for n ≤ 200 |

n is at most ~192 slots (48 h × 4), so even the DP is trivial.

### 8.3 Cost + CO₂ in one objective

Instead of an arbitrary 0–1 slider, use a **CO₂ shadow price** the user can understand: "I value 1 kg of CO₂ at X DKK".

```
score(slot) = allIn_dkk_per_kwh + co2PriceDkkPerKg × co2_g_per_kwh / 1000
```

The plan view always computes three variants and shows the trade-off:

| Option   | λ (DKK/kg)                          | Cost      | CO₂    |
| -------- | ----------------------------------- | --------- | ------ |
| Cheapest | 0                                   | 18.40 DKK | 1.9 kg |
| Balanced | user setting (default 1.0)          | 18.90 DKK | 1.2 kg |
| Greenest | large (CO₂ only, cost as tie-break) | 21.30 DKK | 0.8 kg |

(Example numbers; real values come from the data.)

### 8.4 Provisional plans

Before ~13:00 tomorrow's prices don't exist. For slots past the known horizon:

- **Estimate** = tariff + taxes (known) + a spot estimate: the same weekday-and-slot median over the last 4 weeks.
- Mark those slots `estimated = true` and the plan `provisional = true`.
- The job workflow re-plans automatically when `DayAheadPrices` lands (and again when `CO2EmisProg` lands ~15:00).
- **Never move a slot that has already started.** Re-planning only touches slots strictly in the future.

### 8.5 Baselines (honest savings)

Every plan stores two comparisons:

- **Start now:** slots from `earliest` forward at full power.
- **Midnight timer:** slots from the first 00:00 after `earliest` at full power (or from `earliest` if it's already past midnight).

The UI headline is the saving vs the midnight timer; "vs start now" is secondary.

---

## 9. Key flows

### 9.1 Ingestion (Temporal schedules)

```
schedule  dayAheadIngest   every 5 min, 12:55–14:30 Europe/Copenhagen
  ├─ activity fetchDayAhead(zone=all, from=tomorrow)       -- one request for all zones
  ├─ if 429 → throw RetryableError(after = header/body seconds)
  ├─ validate (Zod), upsert spot_prices
  ├─ if tomorrow complete (92/96/100 slots per zone) → mark done for today
  └─ signal every active job workflow: pricesUpdated(zone)

schedule  co2ForecastIngest  every 15 min        → upsert co2_intensity(kind=forecast); signal co2Updated
schedule  co2ActualIngest    every 15 min        → upsert co2_intensity(kind=actual)
schedule  tariffIngest       daily 06:00         → upsert charges; run tariffMappingCheck (§10.4)
```

### 9.2 Job lifecycle (one workflow per job)

```
jobWorkflow(jobId)
  plan = activity buildPlan(jobId, reason='created')
  activity deliver(plan, action='notify')                -- "planned: 01:15–02:45, 17.80 DKK"
  loop
    next = earliest future boundary (slot start or stop)
    race:
      sleep(until next)            → activity deliver(start|stop), idempotency key = plan:slot:action
      signal pricesUpdated|co2Updated → plan = buildPlan(reason=…); if changed → deliver(notify)
      signal updateJob(fields)        → plan = buildPlan(reason='user_edit')
      signal cancel                   → deliver(stop if running); status=cancelled; return
  until all slots done
  activity settle(jobId)        -- final cost/CO₂ from actual CO2Emis; Phase 4: meter data
```

- Activities are idempotent; `deliveries.idempotency_key` is unique.
- The workflow never holds secrets: integration activities load and decrypt tokens themselves. A Temporal payload codec encrypts workflow history at rest anyway.
- Long-running jobs use `continueAsNew` after N re-plans to keep history small.

### 9.3 Feeds for other systems

| Feed               | Endpoint                                                                                                                       | Format                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| evcc custom tariff | `GET /v1/feeds/{token}/evcc?type=price\|co2`                                                                                   | `[{ "start": "…Z", "end": "…Z", "value": 2.31 }]` (15-min) — evcc's `type: custom`, `forecast: { source: http }` |
| evcc plan push     | outbound `POST {evcc}/api/loadpoints/{id}/plan/energy/{kWh}/{RFC3339}`                                                         | evcc REST API, bearer API key                                                                                    |
| Calendar           | `GET /v1/feeds/{token}/plans.ics`                                                                                              | iCal events per planned run — works for any appliance                                                            |
| Home Assistant     | outbound MQTT discovery: `homeassistant/sensor/wattslot_<site>/price_now/config`, `binary_sensor/…/cheap_now`, per-job `…/run` | User automations do the switching                                                                                |
| Webhooks           | outbound `POST` with `X-Signature: sha256=…` (HMAC), retries with back-off                                                     | JSON `plan.created/changed`, `slot.start/stop`                                                                   |

Feed tokens are **capability URLs**: 256-bit random, stored hashed, read-only, rotatable from settings.

---

## 10. Public API (REST, OpenAPI at `/docs`)

### 10.1 Public (no auth, cached, rate-limited)

```
GET  /v1/zones
GET  /v1/grid-companies?zone=DK2
GET  /v1/prices?zone=DK2&gln=5790000705689&from=…&to=…        → per-slot breakdown + all-in
GET  /v1/co2?zone=DK2&from=…&to=…&kind=forecast|actual
GET  /v1/cheapest?zone=DK2&gln=…&hours=2&within=24h&contiguous=true
```

### 10.2 Authenticated

```
POST   /v1/sites                     GET/PATCH/DELETE /v1/sites/:id
POST   /v1/sites/:id/feed-token/rotate
POST   /v1/jobs                      GET /v1/jobs/:id     PATCH /v1/jobs/:id    DELETE /v1/jobs/:id
GET    /v1/jobs/:id/plans            GET /v1/jobs/:id/plans/:version
POST   /v1/jobs/:id/preview          → the 3 options without committing
POST   /v1/integrations              PATCH/DELETE /v1/integrations/:id   POST /v1/integrations/:id/test
POST   /v1/push/subscribe            (Web Push VAPID subscription)
```

### 10.3 Feeds (capability token)

See §9.3.

### 10.4 Tariff mapping check

Nightly: for every `tariff_mappings` row, assert a `charges` row exists that covers today and the next 30 days, and that the 24 values match the Tarifmodel 3.0 band shape (low ≤ high ≤ peak, peak in 17–21). On failure: mark the grid company `degraded` (UI shows "tariff data out of date"), fall back to spot + flat charges, open a GitHub issue via webhook.

---

## 11. Integrations — what's in, what's later

| Route                                 | Verdict                | Why                                                                                                                             |
| ------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| evcc (custom tariff feed + plan push) | **v1**                 | evcc already controls 100s of chargers/vehicles; feeding it is the highest leverage, lowest risk                                |
| Home Assistant (MQTT discovery)       | **v1**                 | Turns plans into entities any automation can use                                                                                |
| Web Push (PWA)                        | **v1**                 | Free; works on iOS 16.4+ when installed to home screen                                                                          |
| iCal feed                             | **v1**                 | Covers every "dumb" appliance                                                                                                   |
| Signed webhooks                       | **v1**                 | Escape hatch for everything else                                                                                                |
| Easee cloud API                       | Phase 4                | Private users can authenticate; `dynamic-charger-current` with TTL; old schedule endpoints died 2026-09-01 — use `/schedules/*` |
| Eloverblik                            | Phase 4                | Verified savings + grid-company auto-detect; MitID-generated refresh token, 24 h access tokens                                  |
| Expo mobile app                       | Phase 4                | Android free; iOS needs a paid Apple account                                                                                    |
| ENTSO-E fallback                      | Phase 4                | Free token; other zones and redundancy                                                                                          |
| Zaptec                                | Later                  | Access via business rep; ROPC auth                                                                                              |
| Tesla Fleet API                       | Later, BYO credentials | Card required; polling costs ~$17/month at 5-min data                                                                           |
| Smartcar                              | Avoid                  | Paid beyond 1 vehicle                                                                                                           |
| Monta Public API                      | Avoid                  | Operator-only                                                                                                                   |
| Nord Pool API                         | Avoid                  | Licence forbids automated extraction; ~€1,250/yr                                                                                |
| OCPP CSMS                             | Not planned            | Large scope; evcc already speaks OCPP                                                                                           |

---

## 12. Security & legal

### 12.1 Security

- **No device passwords stored, ever.** Easee/Zaptec use password grants: exchange once, keep only the refresh token; recommend a dedicated API user.
- **Envelope encryption** for every stored secret: per-secret DEK (AES-256-GCM, AAD = `site|kind|integration id`), DEK wrapped by a KEK in OpenBao Transit (self-host) or OCI Vault (free tier). KEK never on the app host's disk.
- **Rotated refresh tokens persisted atomically** (Easee invalidates the previous one).
- **Temporal payload codec** (AES-GCM) so workflow history never contains plaintext job data or tokens; Temporal UI/gRPC not exposed publicly.
- **Capability URLs** for feeds: hashed at rest, read-only, rotatable, rate-limited per token.
- **Webhooks** signed with per-integration HMAC secrets; receivers documented to verify timestamp + signature.
- **Outbound MQTT/evcc calls** only to user-configured hosts; block private-range targets in SaaS mode (SSRF), allow them in self-host mode.
- **Auth:** passkeys + magic link; no password table. Strict CSP, no third-party scripts, no telemetry.
- **Logging:** structured logs with a redaction list (tokens, emails, addresses); never log request bodies of integration endpoints.

### 12.2 Licensing & legal (checked 2026-10-28 — not legal advice)

| Area                              | Status                                                                                                                                                                                                                     | What the project does                                                                                                                                                                                                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Energi Data Service data**      | CC BY 4.0 — copying, changing and redistributing allowed, including commercially. CC BY 4.0 also licenses EU database rights, so caching whole datasets is fine.                                                           | Every page/response showing it carries "Source: Energinet (www.energidataservice.dk)" + licence link. All-in prices are _derived_ data → labelled "calculated from Energinet data". Never imply Energinet endorses the project. Data is "as is" with no availability guarantee → fallback + stale-data banner. |
| **ENTSO-E** (Phase 4 fallback)    | Only data on ENTSO-E's "free re-use" list may be reused; the list page couldn't be fetched during research.                                                                                                                | Confirm day-ahead prices are on that list **before** Phase 4. Until then, not used.                                                                                                                                                                                                                            |
| **Nord Pool**                     | Website terms forbid automated extraction and redistribution.                                                                                                                                                              | Never used.                                                                                                                                                                                                                                                                                                    |
| **Strømligning API**              | Non-commercial only.                                                                                                                                                                                                       | Never used.                                                                                                                                                                                                                                                                                                    |
| **Eloverblik customer API**       | "Intended to be used by customers who want to access their own data." Services fetching other people's data must register as a DataHub third party and get powers of attorney.                                             | Eloverblik is enabled **only in self-host single-user mode** (your own token, your own data). A hosted multi-user version would need third-party registration — out of scope.                                                                                                                                  |
| **Device APIs** (Easee, Tesla, …) | Each has its own developer terms.                                                                                                                                                                                          | Official APIs only, no reverse engineering. Read each vendor's terms before its phase starts.                                                                                                                                                                                                                  |
| **Other projects' code**          | evcc (MIT), HA integrations (various).                                                                                                                                                                                     | Write our own implementation and tariff mappings from DatahubPricelist; copy nothing. If anything is ever copied, keep its licence notice. CI checks dependency licences against an allowlist.                                                                                                                 |
| **Our own licences**              | Libraries Apache-2.0 (patent grant, maximum adoption); apps AGPL-3.0 (a hosted copy must publish its changes); each app gets its own LICENSE file.                                                                         | Before accepting the first external pull request, add a contributor licence agreement so dual licensing (AGPL + commercial) stays possible.                                                                                                                                                                    |
| **Trademarks**                    | evcc, Home Assistant, Tesla, Easee, Energinet are others' marks.                                                                                                                                                           | Name them only to describe compatibility; no logos; README states the project isn't affiliated with any of them.                                                                                                                                                                                               |
| **Project name**                  | "Grid Slot" is used by a motorsport app (gridslot.app) and a GitHub org, so the working name was dropped. `wattslot`: free on GitHub, npm and .com/.dev/.io/.app; no app or trademark hits found (web search, 2026-10-28). | A formal trademark search (EUIPO/DKPTO) only if it ever goes commercial.                                                                                                                                                                                                                                       |
| **Patents**                       | Patents on price-based charge scheduling exist (e.g. US 11,390,183; US 9,112,382). Many open-source tools (evcc, Home Assistant) do this openly.                                                                           | Practical risk for a free, non-commercial OSS project is low. Get legal advice before any commercial launch.                                                                                                                                                                                                   |
| **Privacy (GDPR)**                | The public demo has no accounts. Self-host keeps every user's data on their own server.                                                                                                                                    | Demo stores no personal data beyond short-retention server logs. Sites store zone + grid company, never a street address. A future hosted mode needs a privacy policy, a DPA, and data-minimisation review.                                                                                                    |
| **Liability & claims**            | Apache-2.0 and AGPL-3.0 both disclaim warranties ("as is"). Savings are calculations, not guarantees.                                                                                                                      | UI states prices can differ from the actual bill (supplier markup, rounding) and always shows the baseline a saving is measured against.                                                                                                                                                                       |

---

## 13. Decisions (confirmed 2026-10-28)

All twelve confirmed as recommended.

| #   | Decision                 | Chosen                                                                                                        | Alternatives considered                                                                                                                                                       |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Name                     | `wattslot`                                                                                                    | `gridslot` (taken by a motorsport app), `quarterwatt`, `kwartr`                                                                                                               |
| 2   | Deployment model         | **Self-host first** (single-user mode), plus a public read-only demo (prices + cheapest windows, no accounts) | Multi-user hosted SaaS from day 1                                                                                                                                             |
| 3   | Workflow engine          | **Temporal** (durable per-job timers, signals for re-planning)                                                | BullMQ delayed jobs (lighter, but re-planning and cancellation get hand-rolled)                                                                                               |
| 4   | Mobile                   | **PWA + Web Push in v1**, Expo app in Phase 4                                                                 | Expo from day 1                                                                                                                                                               |
| 5   | Default CO₂ shadow price | **1.0 DKK/kg** ("balanced")                                                                                   | 0 (pure cost)                                                                                                                                                                 |
| 6   | Grid-company selection   | **User picks from list (filtered by zone)**; Eloverblik auto-detect in Phase 4                                | Address → grid area lookup (needs a dataset we haven't verified)                                                                                                              |
| 7   | Supplier markup          | **Optional user input, default 0, clearly labelled**                                                          | Pull supplier price lists (Strømligning — non-commercial licence)                                                                                                             |
| 8   | Zones at launch          | **DK1/DK2 full price; DE/SE/NO/FI spot-only**                                                                 | DK only                                                                                                                                                                       |
| 9   | UI language              | **English + Danish** (i18n from the start)                                                                    | English only                                                                                                                                                                  |
| 10  | Licence                  | **Libraries (`packages/`) Apache-2.0, apps (`apps/`) AGPL-3.0** — changed from MIT on 2026-10-28              | MIT everywhere (no patent grant, no protection for a hosted version); AGPL everywhere (blocks companies embedding the libraries); source-available FSL/BUSL (not open source) |
| 11  | Hosting                  | **Oracle Always Free ARM** + Caddy; backups to OCI Object Storage                                             | Home server / Raspberry Pi                                                                                                                                                    |
| 12  | Phase 4 device order     | **Eloverblik → Easee → Expo**                                                                                 | Easee first                                                                                                                                                                   |

---

## 14. Project structure

```
wattslot/
├── apps/
│   ├── api/                  NestJS: REST, OpenAPI, auth, feeds
│   │   └── src/{prices,sites,jobs,plans,integrations,feeds,push,auth}/
│   ├── worker/               Temporal worker: workflows + activities
│   │   └── src/{workflows/{ingest,job}.ts, activities/{eds,plan,deliver,settle}.ts, codec.ts}
│   └── web/                  Next.js PWA
│       └── src/app/{(public)/page.tsx, jobs/, settings/, integrations/}
├── packages/
│   ├── pricing/              pure: allIn(), breakdown(), tariff expansion, DST
│   ├── planner/              pure: greedy / window / DP selectors, baselines
│   ├── eds-client/           typed EDS client, Zod schemas, 429 handling
│   ├── db/                   Drizzle schema + migrations
│   ├── crypto/               envelope encryption, OpenBao / OCI adapters
│   └── contracts/            shared Zod schemas + OpenAPI types
├── fixtures/                 recorded EDS days (normal, DST spring, DST fall, negative-price day)
├── infra/
│   ├── docker-compose.yml    postgres, temporal, worker, api, web, caddy, openbao
│   └── pulumi/               OCI VM, VCN, firewall, object storage bucket
├── docs/
│   ├── adr/                  decision records (one per §13 row once confirmed)
│   └── integrations/{evcc,home-assistant,webhooks}.md
├── .github/workflows/ci.yml
├── PLAN.md
└── README.md
```

---

## 15. Build phases

| Phase                               | Scope                                                                                                                     | Definition of done                                                                                                                                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Foundations** ✅ 2026-10-28   | Monorepo (pnpm, Turborepo, Biome, CI), Drizzle schema + migration, `eds-client` with recorded fixtures, `pricing` package | Done: worked example reproduced to the øre (1.66 / 4.35); property tests for breakdown, monotonicity, local-hour tariffs and day tiling over 40 years; DST days priced at 92/100 slots; missing or overlapping charges throw; migration applied to Postgres 16 with constraint checks |
| **1 — Live prices** (weekend 2)     | Temporal + ingest schedules, public price/CO₂/cheapest API, Next.js public page with stacked 15-min chart                 | Running on the Oracle VM; tomorrow's prices appear within 10 min of publication; zero 429s in a week of logs; public page Lighthouse ≥ 95                                                                                                                                             |
| **2 — Jobs & plans** (weekends 3–4) | `planner` package, jobs API, job workflow (timers, re-plan signals, cancel), 3-option preview, Web Push, iCal             | Property tests: plan never leaves the window, delivers exactly E kWh, greedy = brute force for n ≤ 12, contiguous plans are contiguous; e2e: create job → provisional plan → prices land → plan v2 → notifications at slot boundaries                                                 |
| **3 — Integrations** (weekend 5)    | evcc tariff feed + plan push, HA MQTT discovery, signed webhooks, feed-token rotation, envelope encryption                | evcc instance in CI (docker) consumes the feed and shows the same cheapest window; HA test instance auto-discovers the sensors                                                                                                                                                        |
| **4 — Proof & reach**               | Eloverblik verified savings, Easee direct, Expo app, ENTSO-E fallback, provisional-price estimator evaluation             | Savings page shows planned vs actual cost from meter data; estimator error reported (MAE) on 3 months of history                                                                                                                                                                      |
| **5 — Hardening**                   | Multi-user mode, quotas, backups/restore drill, observability (OTel → Prometheus/Grafana), tariff-mapping alerts          | Restore from backup tested; tariff mapping check alerts on a simulated code change                                                                                                                                                                                                    |

---

## 16. Out of scope (explicit)

- Trading, bidding into flexibility markets, or acting as an independent aggregator (the Danish aggregator model is expected to go live around Q1 2027 — revisit then).
- Battery arbitrage / solar self-consumption optimisation (EMHASS covers it).
- Business ("A"/"B") customer tariffs.
- Paid data or device APIs of any kind.

---

## 17. Sources

**Data & APIs**
- Energi Data Service — DayAheadPrices metadata: https://api.energidataservice.dk/meta/dataset/DayAheadPrices
- Elspotprices (discontinued): https://api.energidataservice.dk/meta/dataset/Elspotprices
- CO2EmisProg: https://api.energidataservice.dk/meta/dataset/CO2EmisProg · DatahubPricelist: https://api.energidataservice.dk/meta/dataset/DatahubPricelist
- EDS API guide (caching rule, polling): https://www.energidataservice.dk/guides/api-guides · Terms (CC BY 4.0): https://www.energidataservice.dk/terms-and-conditions
- Eloverblik customer API: https://api.eloverblik.dk/customerapi/index.html · docs: https://docs.eloverblik.dk/en/
- ENTSO-E open data policy: https://www.entsoe.eu/news/2019/02/01/tsos-increase-number-of-open-data-available-through-entso-e-s-transparency-platform/
- Nord Pool terms: https://www.nordpoolgroup.com/en/About-us/terms-and-conditions-for-useofwebsite/
- 15-min MTU go-live: https://www.epexspot.com/en/news/market-coupling-steering-committee-confirms-go-live-15-minute-mtu-sdac-trading-day-30
- Day-ahead publication time: https://www.nordpoolgroup.com/en/trading/transition-to-15-minute-market-time-unit-mtu/faq/

**Market**
- EV stock (DST, Oct 2026): https://www.dst.dk/da/Statistik/udgivelser/NytHtml?cid=52649
- New-car BEV share 2025: https://fdm.dk/nyheder/nyt-om-trafik-og-biler/bilaaret-2025-slutter-ekstremt-elektrisk · 2026 YTD: https://fdm.dk/nyheder/nyt-om-trafik-og-biler/elbiler-paa-kurs-mod-100-procent
- Heat-pump sales 2025: https://www.tekniq.dk/nyheder/salget-af-varmepumper-steg-med-65-i-2025/
- Variable contracts: https://greenpowerdenmark.dk/nyheder/elkunder-flokkes-om-variable-priser
- 15-min meters: https://www.energinet.dk/om-nyheder/nyheder/2025/09/de-forste-700000-elmalere/
- Flexibility report (Forsyningstilsynet, Jun 2026): https://forsyningstilsynet.dk/Media/639178071318421925/Fleksibilitet%20i%20det%20danske%20elsystem%202026.pdf
- 15-min vs hourly settlement, little effect for passive customers: https://radiuselnet.dk/analyse-ingen-gevinst-ved-15-minuttersafregning-for-privatkunder/
- Elafgift 2026–27: https://skat.dk/erhverv/afgifter-paa-varer-og-ydelser-punktafgifter/nyhedsbrev-afgifter/midlertidig-nedsaettelse-af-elafgiften-i-2026-og-2027
- Energinet tariffs 2026: https://www.energinet.dk/media/ikylsqle/energinets-tarifkatalog-2026.pdf
- N1 winter tariffs: https://via.ritzau.dk/pressemeddelelse/15176319/n1-overgar-til-vintertariffer-1-oktober-brug-strommen-uden-for-myldretiden-og-fa-en-billigere-elregning

**Competitors**
- Min Strøm: https://minstroem.app · Strømligning API: https://stromligning.dk/api/docs · elprisenligenu.dk API: https://www.elprisenligenu.dk/elpris-api
- Monta SmartCharge: https://monta.com/uk/help-center/enable-and-set-up-smartcharge/
- evcc plans: https://docs.evcc.io/en/features/plans.md · Energinet tariff: https://docs.evcc.io/en/tariffs/energinet.md · custom tariffs: https://docs.evcc.io/en/user-defined-devices · REST API: https://docs.evcc.io/integrations/rest-api
- HA energidataservice: https://github.com/MTrab/energidataservice · EMHASS: https://github.com/davidusb-geek/emhass

**Integrations & hosting**
- Easee API: https://developer.easee.com/docs/authentication-1 · Tesla Fleet API billing: https://developer.tesla.com/docs/fleet-api/billing-and-limits
- Home Assistant MQTT discovery: https://www.home-assistant.io/integrations/mqtt/
- Web Push on iOS: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- Oracle Always Free: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Temporal self-hosting: https://docs.temporal.io/self-hosted-guide/deployment
- OpenBao Transit: https://openbao.org/docs/secrets/transit/ · OWASP secrets management: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html

Data attribution: Source: Energinet (www.energidataservice.dk), CC BY 4.0.
