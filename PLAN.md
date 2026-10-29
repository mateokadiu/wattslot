# `wattslot` — Implementation Plan

> An open-source planning engine, free to run on Cloudflare, that tells you — or your charger, heat pump or Home Assistant — **when** to use electricity, using the price you actually pay (spot + grid tariff + taxes + VAT) and the grid's CO₂ forecast, at 15-minute resolution.

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
- **Free to run, easy to own.** Deploys to Cloudflare's free plan with one command — no server, no card, no paid APIs. Anyone can deploy their own copy.
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

| Risk                                                                                                                 | Mitigation                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| evcc already controls devices well and could add a tariff resolver                                                   | Position as a **feed** for evcc (custom tariff + plan push), not a rival. Device control stays out of scope.                                                     |
| Grid companies change tariff code names / periods (regulator is reviewing ToU zones)                                 | Curated `tariff_mappings` table with a nightly validation job that alerts when a mapped code disappears or a new period appears.                                 |
| EDS rate limits (HTTP 429, ~300 s back-off) and the "don't proxy for all users" rule                                 | One central ingester per dataset, cached in D1; users never hit EDS. Back-off state is stored, so a 429 skips the next cron ticks instead of retrying in a loop. |
| Cloudflare Workers share outgoing IPs, so other people's EDS traffic could trigger rate limits for us _(unverified)_ | Few requests per day (one per dataset per update), stored back-off, cache; ENTSO-E fallback in Phase 4.                                                          |
| Cloudflare lock-in (D1, Workflows, Cron)                                                                             | `pricing`, `planner` and `eds-client` are runtime-agnostic and tested in both Node and `workerd`; D1 is SQLite and exports with one command.                     |
| Free-plan limits: 10 ms CPU per invocation, 100k requests/day, 100k D1 row writes/day                                | Small, filtered upstream queries; batched writes; CPU time checked in tests and logs; alerts before limits.                                                      |
| Tax/tariff policy changes (elafgift returns after 2027)                                                              | Taxes are dated rows, not constants.                                                                                                                             |
| Incumbent apps are free                                                                                              | Compete on openness, correctness and integrations, not on reach.                                                                                                 |

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

Everything runs on Cloudflare's free plan.

```
                    ┌──────────────────────────────────────────────────────────┐
 Energi Data ──────►│  apps/api — one Worker                                   │
 Service            │                                                          │
 (DayAheadPrices,   │  scheduled()  one cron, every 5 min, dispatches:         │
  CO2EmisProg,      │    • day-ahead prices   12:55–14:30 local, until complete │
  CO2Emis,          │    • CO₂ forecast/actual  every 15 min                     │
  DatahubPricelist) │    • tariffs + mapping check  nightly                      │
                    │    • then: sendEvent('prices_published') to live jobs     │
                    │                                                          │
                    │  fetch()   Hono REST + OpenAPI                           │
                    │    /v1/prices  /v1/co2  /v1/cheapest  /v1/jobs  /v1/feeds │
                    │                                                          │
                    │  JobWorkflow  (Cloudflare Workflows, Phase 2)            │
                    │    plan → sleep until boundary → act → re-plan on event   │
                    └──────────────┬───────────────────────────────┬───────────┘
                                   │                               │ outbound
                                   ▼                               ▼
                       ┌──────────────────────┐     web push · signed webhooks ·
                       │  D1 (SQLite)         │     evcc plan push (if reachable)
                       │  prices · co2 ·      │
                       │  charges · jobs ·    │     pulled by users' systems:
                       │  plans · ingest state│     evcc tariff feed · iCal · HA feed
                       └──────────┬───────────┘
                                  ▼
                       ┌──────────────────────┐   packages/pricing  — pure: all-in price per slot
                       │ apps/web — Next.js   │   packages/planner  — pure: slot selection
                       │ static export (edge) │   packages/eds-client — typed EDS access
                       │ chart · jobs · PWA   │   (all run in Node and in workerd)
                       └──────────────────────┘
```

**Design rules**

- **Pure core, thin shell.** `pricing`, `planner` and `eds-client` have no Cloudflare dependencies. They're tested in Node and inside `workerd`, so they'd move to any other runtime unchanged.
- **Users never call upstream.** EDS asks vendors to cache and serve their own users. One cron ingests; the API reads only from D1.
- **One cron trigger.** The free plan allows 5 per _account_, so a single 5-minute trigger dispatches every scheduled task by local time.
- **Every plan is versioned.** Re-plans create a new `plan` row; the old one is kept for audit and for "why did it change?" in the UI.
- **Pull over push.** A cloud Worker can't reach devices on a home network, so evcc, Home Assistant and calendars _pull_ feeds. Pushing to a home device needs the user to expose it (e.g. their own Cloudflare Tunnel). This is also the safer default.
- **REST + OpenAPI is the public surface.** One backend Worker; no internal RPC layer.

---

## 5. Tech stack

| Layer         | Choice                                                                                                                                                                                                                                      | Why                                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language      | TypeScript 6 (strict, `exactOptionalPropertyTypes`), ESM; Node 24 for tooling                                                                                                                                                               | One language everywhere. TS 6 until the native TS 7 toolchain settles                                                                                                                                                                                               |
| Monorepo      | pnpm + Turborepo                                                                                                                                                                                                                            | Shared packages across Workers and web                                                                                                                                                                                                                              |
| Runtime       | Cloudflare Workers (free plan)                                                                                                                                                                                                              | No server to run; 100k requests/day, 10 ms CPU per invocation, 64 MiB bundle                                                                                                                                                                                        |
| API           | Hono + `@hono/zod-openapi`                                                                                                                                                                                                                  | Built for Workers; Zod schemas generate the OpenAPI spec                                                                                                                                                                                                            |
| Scheduling    | One Cron Trigger (every 5 min)                                                                                                                                                                                                              | Free plan: 5 triggers per account                                                                                                                                                                                                                                   |
| Workflows     | Cloudflare Workflows (Phase 2)                                                                                                                                                                                                              | Durable steps, `sleepUntil`, `waitForEvent` for re-planning, retries — the Temporal role, free                                                                                                                                                                      |
| DB            | Cloudflare D1 (SQLite) + Drizzle ORM                                                                                                                                                                                                        | 5 GB free; data is small (≈35k price rows / zone / year)                                                                                                                                                                                                            |
| Money         | Integer micro-units (1e-6 DKK) in code **and** in the DB                                                                                                                                                                                    | No float drift; SQLite integers store them exactly                                                                                                                                                                                                                  |
| Validation    | Zod at every boundary (EDS responses, API input)                                                                                                                                                                                            | Upstream schema changes fail loudly                                                                                                                                                                                                                                 |
| Web           | Next.js 16 (App Router) as a **static export**, served as Workers Static Assets by the API Worker; Tailwind 4; hand-rolled SVG chart; English, Danish, German, Norwegian and Swedish pages                                                  | Server-rendering React within the free plan's 10 ms CPU per request is unreliable; static assets cost no CPU and come from the edge, and the page reads the same-origin, edge-cached API. Lighthouse 100 in all four categories, desktop and mobile, light and dark |
| Auth          | Better-Auth on D1 — passkeys + email magic link; single-user mode for deploy-your-own                                                                                                                                                       | No passwords stored                                                                                                                                                                                                                                                 |
| Secrets       | Envelope encryption with Web Crypto: AES-256-GCM data keys wrapped by a key-encryption key held as a Workers Secret                                                                                                                         | Device tokens never stored in plaintext; no paid KMS                                                                                                                                                                                                                |
| Lint / format | Biome (single tool, CI-enforced; also formats Markdown)                                                                                                                                                                                     | Same setup as the other repos                                                                                                                                                                                                                                       |
| Tests         | Vitest + fast-check (property), recorded EDS fixtures (golden days), Workers runtime tests via Miniflare, and Playwright end-to-end tests (desktop + phone, axe accessibility audit) against wrangler dev with a D1 seeded by the real cron |                                                                                                                                                                                                                                                                     |
| Deploy        | GitHub Actions → `wrangler deploy` and `wrangler d1 migrations apply`; scoped Cloudflare API token as a repo secret                                                                                                                         | $0/month                                                                                                                                                                                                                                                            |

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
- **D1 rejects long GLOB/LIKE patterns** ("pattern too complex"), which plain SQLite accepts. Format checks therefore use `strftime` round-trips (`valid_from = strftime('%Y-%m-%dT%H:%M:%S', valid_from)`), which also reject impossible dates. Found by running migrations in `workerd`, not `sqlite3`.
- **A grid company can reuse one code across charge types.** N1's `CD` is both its tariff (D03, ~0.09 DKK/kWh) and its monthly subscription (D01, ~27 DKK/month). Ingestion therefore requests D03 only and also filters in code, and `charge_type` is part of the `charges` key. Genuine tariff periods never overlap (0 of 913 D03 series), so pricing treats an overlap as corrupt data and falls back to spot prices. _Correction: an earlier version misread this as "overlapping periods by design" and let the latest-starting period win, which hid the bug; the strict rule caught it._
- **Withdrawn tariff periods are deleted.** The nightly sync fetches every period with `ValidFrom ≥` its start date (verified: that's exactly what EDS `start` filters on) and deletes stored periods in that range the response no longer has.
- Worker **compatibility date is `2026-07-01`** everywhere (wrangler config and tests): Miniflare 4 (stable) supports up to July 2026; Miniflare 5 is a beta with a new API.
- **Free-plan limits that shape the code** (verified 2026-10-28): 10 ms CPU per invocation, cron included, and not enforced by `wrangler dev` or Miniflare; 50 subrequests per invocation, where each D1 call counts but a `batch()` counts once. Building 72 insert statements through the query builder alone measured **~7 ms**, so every bulk write is now a single statement taking all rows as one JSON parameter (`json_each`), which brought a day-ahead run to **~0.8 ms**. A cron run makes ~17 D1/fetch calls.
- **Which code is the household tariff isn't published anywhere.** `packages/db/scripts/discover-grid-companies.ts` derives it with explicit rules (see `packages/db/README.md`). Result on 2026-10-28: 35 grid companies, **31 supported, covering 99.7% of metering points**. Findings: Konstant runs a real household discount (`C_FBTNTR_R`, up to −0.0996 DKK/kWh); Elinord, Grindsted and Ikast use flat tariffs; Forsyning Elnet adds a regional tariff; Kimbrer (0.00 tariff), Læsø (unclear extra charge), Aal (non-standard weekly tariff) and Hurup (no "Nettarif C") are unsupported and fall back to spot-only. Grid companies and zones come from `DatahubMeasuringPointStatistics`, joined to tariffs by name (statistics sometimes add a grid-area suffix).
- Besides DK1/DK2, `DayAheadPrices` covers DE, NO2, SE3 and SE4 — those become spot-only zones in EUR.
- No price forecast dataset exists on EDS. Anything beyond the published day-ahead horizon is the project's own estimate and must be labelled as such.
- EDS rate limits are per dataset and unpublished; over the limit returns HTTP 429 with "try again in N seconds".
- Eloverblik limits: 2 token calls/min/IP, 120 calls/min/IP, ≤ 730 days per request.

---

## 7. Database schema (D1 / SQLite + Drizzle)

Source of truth: [`packages/db/src/schema.ts`](./packages/db/src/schema.ts). Conventions, because SQLite has no rich types:

| Kind of value    | Stored as                                                                     | Example                     |
| ---------------- | ----------------------------------------------------------------------------- | --------------------------- |
| Money per kWh    | `integer`, micro-units (1e-6)                                                 | `955573` = 0.955573 DKK/kWh |
| Instants         | `integer`, epoch milliseconds (UTC); 15-min slots checked with `% 900000 = 0` | `slot_start_ms`             |
| Tariff validity  | `text`, Danish local wall clock `YYYY-MM-DDTHH:mm:ss`, as published           | `2026-10-01T00:00:00`       |
| 24 hourly prices | `text` JSON array of 24 integers, checked with `json_array_length`            | `[106175, …]`               |
| Booleans         | `integer` 0/1                                                                 |                             |
| IDs              | `text` UUIDs                                                                  |                             |
| Secrets          | `blob` ciphertext + wrapped data key + associated-data string                 |                             |

| Table                         | Purpose                                                                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `price_zones`                 | DK1, DK2 (full price); DE, SE3, … (spot-only)                                                                                                                                           |
| `grid_companies`              | GLN, name, zone, metering points (≈ customers), `supported`/`unsupported` with a reason, `degraded_at` set by the nightly mapping check                                                 |
| `tariff_mappings`             | Grid company → the charge codes of its household tariff: one or more `tariff` codes (e.g. a main and a regional tariff) plus optional `discount` codes that count as zero once they end |
| `spot_prices`                 | Zone × 15-min slot → price (micro-units per kWh)                                                                                                                                        |
| `co2_intensity`               | Zone × 5-min → g/kWh, `forecast` or `actual`                                                                                                                                            |
| `charges`                     | DataHub charges: grid tariffs, Energinet tariffs, electricity tax (`EA-001`)                                                                                                            |
| `vat_rates`                   | The only tax DataHub doesn't publish                                                                                                                                                    |
| `ingest_state`                | Per dataset: last success, next allowed attempt (429 back-off), last error                                                                                                              |
| `sites`                       | Zone, grid company (never an address), supplier markup, CO₂ shadow price, hashed feed token                                                                                             |
| `jobs`, `plans`, `plan_slots` | Phase 2 — jobs, versioned plans and their slots                                                                                                                                         |
| `integrations`, `deliveries`  | Phase 3 — encrypted credentials, idempotent outbound actions                                                                                                                            |
| `meter_readings`              | Phase 4 — Eloverblik data, deploy-your-own only                                                                                                                                         |

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

### 9.1 Ingestion (one cron, every 5 minutes)

```
scheduled(event)                     -- the only Cron Trigger: */5 * * * *
  now = local time in Europe/Copenhagen
  for task in due(now):              -- each task skipped while ingest_state.next_attempt_at > now
    dayAhead       12:55–14:30 local, until tomorrow has 92/96/100 slots per zone
    co2Forecast    every 30 min (:00, :30)      (CO2EmisProg, DK1+DK2)
    co2Actual      every 30 min (:15, :45)      (CO2Emis, DK1+DK2)
    tariffs        02:00 local       (DatahubPricelist for mapped GLNs + Energinet codes; mapping check §10.4)
  on success → upsert in D1 batches, ingest_state.last_success_at = now
  on 429     → ingest_state.next_attempt_at = now + retryAfterSeconds   (no retry loop)
  on new day-ahead prices → each running JobWorkflow: instance.sendEvent({ type: 'prices_published' })
```

Each task fetches only what it needs (filtered by zone, GLN and code) so parsing stays within the 10 ms CPU budget.

D1's free plan allows 100k row writes a day, so ingestion never rewrites what it has: day-ahead prices are fetched only for days still incomplete; CO₂ arrives every 5 minutes but is stored as **15-minute averages** (the slot size pricing and planning use) and only slots whose value changed are written; tariffs are upserted once a night. Verified against the live API on 2026-10-28: 1,152 day-ahead rows (6 zones × 2 days) in one request, 284 CO₂ forecast slots, 286 tariff rows, all 31 supported grid companies healthy, and a repeat tick made no request at all.

### 9.2 Job lifecycle (one Workflow instance per job)

```
JobWorkflow.run(event, step)
  plan = step.do('plan v1', () => buildPlan(jobId))                 -- reads D1, writes plan + slots
  step.do('notify planned', …)                                      -- "planned: 01:15–02:45, 17.80 DKK"
  loop until all slots done
    next = earliest future slot boundary
    try
      evt = step.waitForEvent('update', { type: 'job_update', timeout: until(next) })
      plan = step.do('re-plan', () => buildPlan(jobId, evt.reason)) -- prices_published | co2_updated | user_edit | cancel
      if evt.reason == cancel → step.do('stop', …); mark cancelled; return
    catch timeout
      step.do(`act ${next}`, () => deliver(start|stop, idempotencyKey = plan:slot:action))
  step.do('settle', …)                                              -- final cost/CO₂ from CO2Emis actuals
```

- Every step is idempotent; `deliveries.idempotency_key` is unique.
- **Step outputs are persisted by Cloudflare**, so steps never return tokens or other secrets — integration steps load and decrypt credentials themselves and return only results.
- A job is far below the 1,024-steps limit (an overnight EV job is ~20 steps); very long schedules start a fresh instance when they near it.

### 9.3 Feeds for other systems

| Feed               | Endpoint                                                                                                                                                                        | Format                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| evcc custom tariff | `GET /v1/feeds/{token}/evcc?type=price\|co2`                                                                                                                                    | `[{ "start": "…Z", "end": "…Z", "value": 2.31 }]` (15-min) — evcc's `type: custom`, `forecast: { source: http }` |
| evcc plan push     | outbound `POST {evcc}/api/loadpoints/{id}/plan/energy/{kWh}/{RFC3339}` — only if the user exposes evcc (e.g. their own Cloudflare Tunnel)                                       | evcc REST API, bearer API key                                                                                    |
| Calendar           | `GET /v1/feeds/{token}/plans.ics`                                                                                                                                               | iCal events per planned run — works for any appliance                                                            |
| Home Assistant     | pull: `GET /v1/feeds/{token}/ha.json` for HA REST/template sensors (price now, cheap now, per-job run). MQTT discovery only if the user's broker is reachable from the internet | User automations do the switching                                                                                |
| Webhooks           | outbound `POST` with `X-Signature: sha256=…` (HMAC), retries with back-off                                                                                                      | JSON `plan.created/changed`, `slot.start/stop`                                                                   |

Feed tokens are **capability URLs**: 256-bit random, stored hashed, read-only, rotatable from settings.

---

## 10. Public API (REST, OpenAPI at `/docs`)

### 10.1 Public (no auth, cached, rate-limited)

```
GET  /v1/zones
GET  /v1/grid-companies?zone=DK2
GET  /v1/prices?zone=DK2&gln=5790000705689&date=2026-10-29&days=1&markup=0
GET  /v1/co2?zone=DK2&date=2026-10-29&days=1
GET  /v1/cheapest?zone=DK2&gln=…&hours=2&from=<ISO>&to=<ISO>&contiguous=true
GET  /v1/status
```

All public GETs send CORS headers (any origin, no credentials), security headers, the Energinet attribution header, and `Cache-Control`; repeat requests are served from Cloudflare's edge cache on the custom domain (the Cache API is a no-op on `*.workers.dev`). Rate limiting: a Cloudflare WAF rate-limiting rule on the custom domain, set up in step 5.

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

Nightly, for every supported grid company: every mapped `tariff` code must have a period covering today and tomorrow (some companies publish weekly or monthly), and its 24 prices must still be Tarifmodel 3.0 or flat. Discount codes may lapse. On failure: set `degraded_at` (the UI says "tariff data out of date"), fall back to spot-only pricing for that company, and raise an alert. New companies or new household codes are picked up by re-running discovery and reviewing the diff.

---

## 11. Integrations — what's in, what's later

| Route                                               | Verdict                | Why                                                                                                                                  |
| --------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| evcc (custom tariff feed; plan push when reachable) | **v1**                 | evcc pulls the all-in price / CO₂ feed and runs its own planner and device control; pushing plans needs evcc exposed to the internet |
| Home Assistant (feed sensors)                       | **v1**                 | HA polls `ha.json` from the feed URL; MQTT discovery later, only for brokers reachable from the internet                             |
| Web Push (PWA)                                      | **v1**                 | Free; works on iOS 16.4+ when installed to home screen                                                                               |
| iCal feed                                           | **v1**                 | Covers every "dumb" appliance                                                                                                        |
| Signed webhooks                                     | **v1**                 | Escape hatch for everything else                                                                                                     |
| Easee cloud API                                     | Phase 4                | Private users can authenticate; `dynamic-charger-current` with TTL; old schedule endpoints died 2026-09-01 — use `/schedules/*`      |
| Eloverblik                                          | Phase 4                | Verified savings + grid-company auto-detect; MitID-generated refresh token, 24 h access tokens                                       |
| Expo mobile app                                     | Phase 4                | Android free; iOS needs a paid Apple account                                                                                         |
| ENTSO-E fallback                                    | Phase 4                | Free token; other zones and redundancy                                                                                               |
| Zaptec                                              | Later                  | Access via business rep; ROPC auth                                                                                                   |
| Tesla Fleet API                                     | Later, BYO credentials | Card required; polling costs ~$17/month at 5-min data                                                                                |
| Smartcar                                            | Avoid                  | Paid beyond 1 vehicle                                                                                                                |
| Monta Public API                                    | Avoid                  | Operator-only                                                                                                                        |
| Nord Pool API                                       | Avoid                  | Licence forbids automated extraction; ~€1,250/yr                                                                                     |
| OCPP CSMS                                           | Not planned            | Large scope; evcc already speaks OCPP                                                                                                |

---

## 12. Security & legal

### 12.1 Security

- **No device passwords stored, ever.** Easee/Zaptec use password grants: exchange once, keep only the refresh token; recommend a dedicated API user.
- **Envelope encryption** for every stored secret: a per-secret data key (AES-256-GCM via Web Crypto, associated data = `site|kind|integration id`), wrapped by a key-encryption key stored as a **Workers Secret** — never in D1, never in the repo. Rotating the key-encryption key re-wraps data keys only.
- **Rotated refresh tokens persisted atomically** (Easee invalidates the previous one).
- **Workflow state holds no secrets.** Cloudflare persists every step's output, so steps decrypt credentials internally and return only non-sensitive results.
- **Capability URLs** for feeds: 256-bit random, stored hashed, read-only, rotatable, rate-limited per token.
- **Webhooks** signed with per-integration HMAC secrets; receivers documented to verify timestamp + signature.
- **Pull over push.** The cloud never needs credentials for a user's home network; outbound calls go only to hosts the user configures, over HTTPS.
- **Deploy credentials:** a Cloudflare API token scoped to this account's Workers and D1, stored as a GitHub Actions secret.
- **Auth:** passkeys + magic link; no password table. Strict CSP, no third-party scripts, no telemetry.
- **Logging:** structured logs with a redaction list (tokens, emails, addresses); never log request bodies of integration endpoints.

### 12.2 Licensing & legal (checked 2026-10-28 — not legal advice)

| Area                              | Status                                                                                                                                                                                                                     | What the project does                                                                                                                                                                                                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Energi Data Service data**      | CC BY 4.0 — copying, changing and redistributing allowed, including commercially. CC BY 4.0 also licenses EU database rights, so caching whole datasets is fine.                                                           | Every page/response showing it carries "Source: Energinet (www.energidataservice.dk)" + licence link. All-in prices are _derived_ data → labelled "calculated from Energinet data". Never imply Energinet endorses the project. Data is "as is" with no availability guarantee → fallback + stale-data banner. |
| **ENTSO-E** (Phase 4 fallback)    | Only data on ENTSO-E's "free re-use" list may be reused; the list page couldn't be fetched during research.                                                                                                                | Confirm day-ahead prices are on that list **before** Phase 4. Until then, not used.                                                                                                                                                                                                                            |
| **Nord Pool**                     | Website terms forbid automated extraction and redistribution.                                                                                                                                                              | Never used.                                                                                                                                                                                                                                                                                                    |
| **Strømligning API**              | Non-commercial only.                                                                                                                                                                                                       | Never used.                                                                                                                                                                                                                                                                                                    |
| **Eloverblik customer API**       | "Intended to be used by customers who want to access their own data." Services fetching other people's data must register as a DataHub third party and get powers of attorney.                                             | Eloverblik is enabled **only in deploy-your-own single-user mode** (your own token in your own Cloudflare account, your own data). A hosted multi-user version would need third-party registration — out of scope.                                                                                             |
| **Device APIs** (Easee, Tesla, …) | Each has its own developer terms.                                                                                                                                                                                          | Official APIs only, no reverse engineering. Read each vendor's terms before its phase starts.                                                                                                                                                                                                                  |
| **Other projects' code**          | evcc (MIT), HA integrations (various).                                                                                                                                                                                     | Write our own implementation and tariff mappings from DatahubPricelist; copy nothing. If anything is ever copied, keep its licence notice. CI checks dependency licences against an allowlist.                                                                                                                 |
| **Our own licences**              | Libraries Apache-2.0 (patent grant, maximum adoption); apps AGPL-3.0 (a hosted copy must publish its changes); each app gets its own LICENSE file.                                                                         | Before accepting the first external pull request, add a contributor licence agreement so dual licensing (AGPL + commercial) stays possible.                                                                                                                                                                    |
| **Trademarks**                    | evcc, Home Assistant, Tesla, Easee, Energinet are others' marks.                                                                                                                                                           | Name them only to describe compatibility; no logos; README states the project isn't affiliated with any of them.                                                                                                                                                                                               |
| **Project name**                  | "Grid Slot" is used by a motorsport app (gridslot.app) and a GitHub org, so the working name was dropped. `wattslot`: free on GitHub, npm and .com/.dev/.io/.app; no app or trademark hits found (web search, 2026-10-28). | A formal trademark search (EUIPO/DKPTO) only if it ever goes commercial.                                                                                                                                                                                                                                       |
| **Patents**                       | Patents on price-based charge scheduling exist (e.g. US 11,390,183; US 9,112,382). Many open-source tools (evcc, Home Assistant) do this openly.                                                                           | Practical risk for a free, non-commercial OSS project is low. Get legal advice before any commercial launch.                                                                                                                                                                                                   |
| **Privacy (GDPR)**                | The public demo has no accounts. Deploy-your-own keeps each user's data in their own Cloudflare account.                                                                                                                   | Demo stores no personal data beyond Cloudflare's short-retention request logs. Sites store zone + grid company, never a street address. A future hosted mode needs a privacy policy, a DPA, and data-minimisation review.                                                                                      |
| **Liability & claims**            | Apache-2.0 and AGPL-3.0 both disclaim warranties ("as is"). Savings are calculations, not guarantees.                                                                                                                      | UI states prices can differ from the actual bill (supplier markup, rounding) and always shows the baseline a saving is measured against.                                                                                                                                                                       |

---

## 13. Decisions (confirmed 2026-10-28)

All twelve confirmed as recommended.

| #   | Decision                 | Chosen                                                                                                                                                                                                                       | Alternatives considered                                                                                                                                                       |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Name                     | `wattslot`                                                                                                                                                                                                                   | `gridslot` (taken by a motorsport app), `quarterwatt`, `kwartr`                                                                                                               |
| 2   | Deployment model         | **Deploy-your-own** (one command into your own free Cloudflare account, single-user) plus a public read-only demo (prices + cheapest windows, no accounts)                                                                   | Multi-user hosted SaaS from day 1                                                                                                                                             |
| 3   | Workflow engine          | **Cloudflare Workflows** — durable steps, `sleepUntil`, `waitForEvent` for re-planning. _Changed from Temporal on 2026-10-28 with the hosting decision._                                                                     | Temporal (needs an always-on server); Durable Object alarms (lower-level)                                                                                                     |
| 4   | Mobile                   | **PWA + Web Push in v1**, Expo app in Phase 4                                                                                                                                                                                | Expo from day 1                                                                                                                                                               |
| 5   | Default CO₂ shadow price | **1.0 DKK/kg** ("balanced")                                                                                                                                                                                                  | 0 (pure cost)                                                                                                                                                                 |
| 6   | Grid-company selection   | **User picks from list (filtered by zone)**; Eloverblik auto-detect in Phase 4                                                                                                                                               | Address → grid area lookup (needs a dataset we haven't verified)                                                                                                              |
| 7   | Supplier markup          | **Optional user input, default 0, clearly labelled**                                                                                                                                                                         | Pull supplier price lists (Strømligning — non-commercial licence)                                                                                                             |
| 8   | Zones at launch          | **DK1/DK2 full price; DE/SE/NO/FI spot-only**                                                                                                                                                                                | DK only                                                                                                                                                                       |
| 9   | UI language              | **English + Danish** (i18n from the start); German, Norwegian and Swedish added 2026-10-29 for the spot-price zones                                                                                                          | English only                                                                                                                                                                  |
| 10  | Licence                  | **Libraries (`packages/`) Apache-2.0, apps (`apps/`) AGPL-3.0** — changed from MIT on 2026-10-28                                                                                                                             | MIT everywhere (no patent grant, no protection for a hosted version); AGPL everywhere (blocks companies embedding the libraries); source-available FSL/BUSL (not open source) |
| 11  | Hosting                  | **Cloudflare free plan**: Workers, D1, Workflows, one Cron Trigger; the website is a static export served by the same Worker. _Changed from Oracle Always Free on 2026-10-28: no card, no server, no idle-reclamation risk._ | Oracle Always Free ARM; home machine + Cloudflare Tunnel; Hetzner (~€4–5/month)                                                                                               |
| 12  | Phase 4 device order     | **Eloverblik → Easee → Expo**                                                                                                                                                                                                | Easee first                                                                                                                                                                   |

---

## 14. Project structure

```
wattslot/
├── apps/                     AGPL-3.0, each with its own LICENSE
│   ├── api/                  one Worker: Hono REST + OpenAPI, scheduled() ingestion, JobWorkflow
│   │   ├── src/{routes,ingest,workflows,feeds,auth}/
│   │   └── wrangler.jsonc    D1 binding, cron, workflow binding, secrets
│   └── web/                  Next.js static export served by the api Worker: chart, jobs, settings, PWA
├── packages/                 Apache-2.0
│   ├── pricing/              pure: all-in price, breakdown, tariff expansion, DST
│   ├── planner/              pure: greedy / window / DP selectors, baselines
│   ├── eds-client/           typed EDS client, Zod schemas, 429 handling
│   ├── db/                   Drizzle schema (D1) + migrations
│   ├── crypto/               envelope encryption on Web Crypto
│   └── contracts/            shared Zod schemas + OpenAPI types
├── fixtures/                 recorded EDS days (normal, DST spring, DST fall, negative-price day)
├── docs/
│   ├── adr/                  decision records
│   └── integrations/{evcc,home-assistant,webhooks}.md
├── .github/workflows/        ci.yml, deploy.yml
├── PLAN.md
└── README.md
```

---

## 15. Build phases

| Phase                                                  | Scope                                                                                                                                                                                  | Definition of done                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Foundations** ✅ 2026-10-28                      | Monorepo (pnpm, Turborepo, Biome, CI), Drizzle schema + migration, `eds-client` with recorded fixtures, `pricing` package                                                              | Done: worked example reproduced to the øre (1.66 / 4.35); property tests for breakdown, monotonicity, local-hour tariffs and day tiling over 40 years; DST days priced at 92/100 slots; missing or overlapping charges throw; migration applied to Postgres 16 with constraint checks (schema ported to D1 when hosting moved to Cloudflare) |
| **1 — Live prices** ✅ live at wattslot.mateokadiu.com | D1 + reference data and tariff mappings, `apps/api` Worker (one cron for ingestion, public price/CO₂/cheapest API), `apps/web` Next.js page with stacked 15-min chart, deploy pipeline | Live on Cloudflare; tomorrow's prices appear within 10 min of publication; no unrecovered 429s in a week; every handler under the 10 ms CPU limit; public page Lighthouse ≥ 95                                                                                                                                                               |
| **2 — Jobs & plans**                                   | `planner` package, jobs API, `JobWorkflow` (sleep to boundaries, `waitForEvent` re-plans, cancel), 3-option preview, Web Push, iCal                                                    | Property tests: plan never leaves the window, delivers exactly E kWh, greedy = brute force for n ≤ 12, contiguous plans are contiguous; e2e (local `wrangler dev`): create job → provisional plan → prices land → plan v2 → notifications at slot boundaries                                                                                 |
| **3 — Integrations**                                   | evcc tariff feed (+ plan push when reachable), Home Assistant feed, signed webhooks, feed-token rotation, envelope encryption                                                          | evcc instance in CI (Docker) consumes the feed and shows the same cheapest window; HA test instance reads the feed sensors                                                                                                                                                                                                                   |
| **4 — Proof & reach**                                  | Eloverblik verified savings, Easee direct, Expo app, ENTSO-E fallback, provisional-price estimator evaluation                                                                          | Savings page shows planned vs actual cost from meter data; estimator error reported (MAE) on 3 months of history                                                                                                                                                                                                                             |
| **5 — Hardening**                                      | Multi-user mode, quotas, backups (D1 Time Travel + nightly `wrangler d1 export`), observability (Workers Logs + analytics), tariff-mapping alerts                                      | Restore from an export tested; tariff mapping check alerts on a simulated code change                                                                                                                                                                                                                                                        |

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
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/ · D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare Workflows limits: https://developers.cloudflare.com/workflows/reference/limits/ · events: https://developers.cloudflare.com/workflows/build/events-and-parameters/
- OWASP secrets management: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html

Data attribution: Source: Energinet (www.energidataservice.dk), CC BY 4.0.
