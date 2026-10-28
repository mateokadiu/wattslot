# wattslot

Plans when to use electricity — EV charging, heat pumps, dishwashers — using the price you actually pay and the grid's CO₂ forecast, at 15-minute resolution. Runs on Cloudflare's free plan.

The price you pay isn't the spot price. In Denmark it's spot + your grid company's time-of-use tariff + Energinet's tariffs + electricity tax + VAT, and the grid tariff alone can be 9× higher at 17–21 than at night. wattslot computes the full price per 15-minute slot and plans around it.

> **Status:** Phase 0 — pricing core and data client. See [PLAN.md](./PLAN.md) for the full design and roadmap.

## Workspace

| Package                                         | What it does                                                                                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@wattslot/eds-client`](./packages/eds-client) | Typed client for [Energi Data Service](https://www.energidataservice.dk): day-ahead prices, CO₂ emissions and forecasts, DataHub tariffs. Zod-validated, rate-limit aware. |
| [`@wattslot/pricing`](./packages/pricing)       | Pure functions: all-in price per 15-minute slot with a per-component breakdown, integer money maths, DST-correct local time. Tested in Node and inside `workerd`.          |
| [`@wattslot/planner`](./packages/planner)       | Pure functions: cheapest contiguous window and cheapest individual slots, property-tested against brute force.                                                             |
| [`@wattslot/db`](./packages/db)                 | D1 (SQLite) schema with Drizzle, migrations, and household tariffs for 35 Danish grid companies (31 supported, 99.7% of metering points).                                  |
| [`@wattslot/api`](./apps/api)                   | Cloudflare Worker: Hono REST API with OpenAPI at `/openapi.json`. AGPL-3.0.                                                                                                |
| [`@wattslot/web`](./apps/web)                   | The website: a Next.js static export served by the same Worker — price chart, cheapest window, English and Danish. AGPL-3.0.                                               |

## Example

DK2, Radius grid area, 28 October 2026 — from the golden tests on real data:

|                                    | 00:00    | 18:00    |
| ---------------------------------- | -------- | -------- |
| Spot                               | 1.10     | 2.40     |
| Grid tariff                        | 0.11     | 0.96     |
| Energinet tariffs                  | 0.12     | 0.12     |
| Electricity tax                    | 0.01     | 0.01     |
| **All-in incl. 25% VAT (DKK/kWh)** | **1.66** | **4.35** |

## Development

Requires Node 24 and pnpm 10.

```bash
pnpm install
pnpm check        # biome + typecheck + tests
pnpm test         # tests only
pnpm lint:fix     # format and fix with Biome
pnpm db:generate  # generate a migration after changing packages/db/src/schema.ts

# run the whole site locally (Cloudflare's runtime, local D1)
pnpm --filter @wattslot/web build
pnpm --filter @wattslot/api db:migrate:local
pnpm --filter @wattslot/api dev   # http://localhost:8787 (website) and /v1/… (API)
curl 'http://localhost:8787/__scheduled?cron=*/5+*+*+*+*'   # run the ingestion cron now
```

## API

| Endpoint                                                    | What it returns                                                                                                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /v1/prices?zone=DK2&gln=5790000705689&date=2026-10-29` | All-in price per 15-minute slot with the breakdown (spot, grid tariff, Energinet, tax, VAT). Spot-only — with a `note` saying why — for zones or grid companies without tariff data. |
| `GET /v1/cheapest?zone=DK2&gln=…&hours=2`                   | The cheapest 2-hour window (or `contiguous=false` for loads that can pause), compared with starting now.                                                                             |
| `GET /v1/co2?zone=DK2`                                      | Forecast and measured grid CO₂ intensity per 15 minutes.                                                                                                                             |
| `GET /v1/zones`, `/v1/grid-companies?zone=DK2`              | Reference data: 6 zones, 35 Danish grid companies (31 supported).                                                                                                                    |
| `GET /v1/status`                                            | When each dataset was last ingested.                                                                                                                                                 |

Full schema: `/openapi.json`. Every `/v1` response carries `X-Data-Source: Energinet (www.energidataservice.dk), CC BY 4.0`, is readable from any website (CORS), and is cached at Cloudflare's edge.

Tests run against recorded API responses in [`fixtures/eds`](./fixtures/eds), including both daylight-saving days (92 and 100 slots) and a negative-price day. The pricing tests also run inside `workerd` (Cloudflare's runtime) through Miniflare.

## Architecture

One Cloudflare Worker ingests prices on a 5-minute cron, stores them in D1, serves the API, and serves the website — a Next.js static export — as static assets from the edge. Cloudflare Workflows will run the per-job schedules. See [PLAN.md §4](./PLAN.md#4-architecture).

## Data

Price, CO₂ and tariff data: **Source: Energinet ([www.energidataservice.dk](https://www.energidataservice.dk))**, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). All-in prices are calculated by wattslot from that data and are not published by Energinet. Energinet does not endorse this project.

wattslot is not affiliated with Energinet, any grid company, evcc, Home Assistant or any device vendor mentioned in the docs.

## License

| Part                                                                          | License                                                                                                                                                 |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Libraries in `packages/` (`eds-client`, `pricing`, `db`, and later `planner`) | [Apache-2.0](./LICENSE) — use them anywhere, including commercially; includes a patent grant                                                            |
| Applications in `apps/` (API, worker, web — from Phase 1)                     | [AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html) — free to self-host and modify; if you run a modified version as a service, publish your changes |
| Recorded data in `fixtures/eds`                                               | CC BY 4.0, Source: Energinet — see [fixtures/eds/README.md](./fixtures/eds/README.md)                                                                   |

See [NOTICE](./NOTICE). The first published commits (up to `38549a8`) were released under MIT.
