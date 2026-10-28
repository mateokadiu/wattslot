# @wattslot/db

D1 (SQLite) schema, migrations and reference data.

## Schema changes

Edit [`src/schema.ts`](./src/schema.ts), then generate a migration:

```bash
pnpm db:generate
```

CI fails if the schema and the migrations drift apart.

## Grid companies and household tariffs

Danish grid companies publish their tariffs in DataHub, but nothing says which charge code is the household ("C") tariff. [`scripts/discover-grid-companies.ts`](./scripts/discover-grid-companies.ts) works it out with explicit rules and records the evidence in [`seed/grid-companies.json`](./seed/grid-companies.json):

1. Grid companies and their price zone come from `DatahubMeasuringPointStatistics` (connected consumption metering points, latest month); tariffs from `DatahubPricelist` (charge type D03). The two are joined by company name.
2. The household tariff is the charge whose note is `Nettarif C` (or `Nettarif C time`, `C-Kunde Nettarif`) valid at the reference time. Identical duplicates collapse to one code.
3. A `Regional nettarif C` is added as a second tariff; `Rabat … Nettarif C` codes are added as **discounts**, which count as zero once they end.
4. The tariff must be Tarifmodel 3.0 (low 00–06, high, peak 17–21) or a flat price. Anything else, a 0.00 tariff, or no match at all makes the company **unsupported** — it falls back to spot-only pricing rather than a guess. `OVERRIDES` in the script lists hand-reviewed exceptions with reasons.

To refresh:

```bash
pnpm --filter @wattslot/db discover          # fetches from Energi Data Service, caches in .cache/
# review the diff of seed/grid-companies.json
pnpm --filter @wattslot/db build:reference   # rewrites migrations/0001_reference_data.sql
```

Once `0001_reference_data.sql` has been applied anywhere, put changes in a new migration instead of rewriting it.

Data: Source: Energinet (www.energidataservice.dk), CC BY 4.0.
