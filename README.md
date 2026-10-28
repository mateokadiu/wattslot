# wattslot

Plans when to use electricity — EV charging, heat pumps, dishwashers — using the price you actually pay and the grid's CO₂ forecast, at 15-minute resolution.

The price you pay isn't the spot price. In Denmark it's spot + your grid company's time-of-use tariff + Energinet's tariffs + electricity tax + VAT, and the grid tariff alone can be 9× higher at 17–21 than at night. wattslot computes the full price per 15-minute slot and plans around it.

> **Status:** Phase 0 — pricing core and data client. See [PLAN.md](./PLAN.md) for the full design and roadmap.

## Packages

| Package                                         | What it does                                                                                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@wattslot/eds-client`](./packages/eds-client) | Typed client for [Energi Data Service](https://www.energidataservice.dk): day-ahead prices, CO₂ emissions and forecasts, DataHub tariffs. Zod-validated, rate-limit aware. |
| [`@wattslot/pricing`](./packages/pricing)       | Pure functions: all-in price per 15-minute slot with a per-component breakdown, integer money maths, DST-correct local time.                                               |
| [`@wattslot/db`](./packages/db)                 | Postgres schema (Drizzle) and migrations.                                                                                                                                  |

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
```

Tests run against recorded API responses in [`fixtures/eds`](./fixtures/eds), including both daylight-saving days (92 and 100 slots) and a negative-price day.

## Data

Price, CO₂ and tariff data: **Source: Energinet ([www.energidataservice.dk](https://www.energidataservice.dk))**, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). All-in prices are calculated by wattslot from that data and are not published by Energinet. Energinet does not endorse this project.

wattslot is not affiliated with Energinet, any grid company, evcc, Home Assistant or any device vendor mentioned in the docs.

## License

[MIT](./LICENSE)
