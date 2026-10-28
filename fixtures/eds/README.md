# Energi Data Service fixtures

Real API responses used by the tests. **Source: Energinet (www.energidataservice.dk)**, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Recorded 2026-10-28 from `https://api.energidataservice.dk`. Changes from the raw responses are listed per file.

| File | Request | Changes |
|---|---|---|
| `dayahead-2026-10-28.json` | `DayAheadPrices`, DK1+DK2 | Sliced to one local day from a single range request (2026-03-29 → 2026-10-29); `total` set to the slice size |
| `dayahead-2026-03-29-dst-spring.json` | same | same — clocks spring forward, 92 slots per area |
| `dayahead-2026-10-25-dst-fall.json` | same | same — clocks fall back, 100 slots per area |
| `dayahead-2026-04-05-negative.json` | same | same — 50 negative DK1 slots, 36 in DK2 |
| `datahub-pricelist-radius-energinet.json` | `DatahubPricelist`, GLN 5790000705689 (Radius) + 5790000432752 (Energinet), from 2025-01-01 | Filtered to charge codes `DT_C_01`, `40000`, `41000`, `EA-001`; `total` set accordingly; pretty-printed |
| `co2-forecast-2026-10-28-dk2-night.json` | `CO2EmisProg`, DK2, 00:00–06:00 | None |
| `error-429.json` | Body of a rate-limited response observed from the API | None |

To refresh a fixture, re-run the request with `limit` high enough to get every row, and keep the response envelope (`total`, `dataset`, `records`).
