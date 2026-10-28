/**
 * Finds every Danish grid company's household ("C") tariff in DataHub and writes
 * seed/grid-companies.json for review. Every decision is rule-based and recorded with its
 * evidence; companies whose tariff we can't interpret are marked unsupported, never guessed.
 *
 *   pnpm --filter @wattslot/db discover            # fetch from Energi Data Service
 *   pnpm --filter @wattslot/db discover --cached   # reuse .cache/ (no API calls)
 *   pnpm --filter @wattslot/db discover --at=2026-10-28T00:00:00
 *
 * Data: Source: Energinet (www.energidataservice.dk), CC BY 4.0.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { type DatahubCharge, parseDatahubPricelist } from '@wattslot/eds-client';
import {
  classifyTariffShape,
  DK_TIME_ZONE,
  fromMicro,
  localTime,
  periodAt,
  type TariffShapeKind,
  toMicro,
} from '@wattslot/pricing';
import { z } from 'zod';

const API = 'https://api.energidataservice.dk/dataset';
const CACHE = new URL('../.cache/', import.meta.url);
const OUT = new URL('../seed/grid-companies.json', import.meta.url);

const args = process.argv.slice(2);
const useCache = args.includes('--cached');
const at =
  args.find((a) => a.startsWith('--at='))?.slice(5) ??
  localTime(Date.now(), DK_TIME_ZONE).wallClock;

/** Household tariff notes, most specific first. */
const MAIN_NOTES = ['nettarif c', 'nettarif c time', 'c-kunde nettarif'];
const REGIONAL_NOTE = 'regional nettarif c';
const isDiscountNote = (note: string) =>
  /^rabat (på )?nettarif c\b/.test(note) && !note.includes('lokal');

/** Reviewed by hand; each one explains why the automatic rules aren't trusted. */
const OVERRIDES: Record<string, { support: 'unsupported'; note: string }> = {
  '5790001103460': {
    support: 'unsupported',
    note: 'Læsø Elnet also publishes "Nettarif - overliggende net" (0.01 DKK/kWh); unconfirmed whether households pay it.',
  },
};

const statsRecord = z.object({
  Month: z.string(),
  PriceArea: z.string(),
  GridCompany: z.string(),
  GridCompanyName: z.string(),
  MP_PhysicalStatus: z.string(),
  Number_MP: z.number(),
});
const statsEnvelope = z.object({ total: z.number(), records: z.array(statsRecord) });

async function fetchJson(name: string, url: string): Promise<unknown> {
  const file = new URL(`${name}.json`, CACHE);
  if (useCache) return JSON.parse(await readFile(file, 'utf8'));
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.text();
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status} ${body.slice(0, 200)}`);
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, body);
  return JSON.parse(body);
}

const normaliseName = (name: string) =>
  name
    .toLowerCase()
    .replace(/a\.?\s?m\.?\s?b\.?\s?a\.?/g, '')
    .replace(/\ba\/s\b/g, '')
    .replace(/[^a-z0-9æøå]/g, '');
const normaliseNote = (note: string | null) =>
  (note ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const micro = (c: DatahubCharge) => c.hourlyDkkPerKwh.map(toMicro);

interface Component {
  code: string;
  role: 'tariff' | 'discount';
  note: string | null;
}

function describeShape(shape: TariffShapeKind) {
  switch (shape.kind) {
    case 'tarifmodel3':
      return {
        shape: shape.kind,
        lowDkk: fromMicro(shape.low),
        highDkk: fromMicro(shape.high),
        peakDkk: fromMicro(shape.peak),
      };
    case 'flat':
      return { shape: shape.kind, priceDkk: fromMicro(shape.price) };
    default:
      return { shape: shape.kind };
  }
}

function classify(rows: DatahubCharge[]) {
  // Per code, only the period in force counts (later-starting periods override earlier ones).
  const byCode = new Map<string, DatahubCharge[]>();
  for (const r of rows) byCode.set(r.code, [...(byCode.get(r.code) ?? []), r]);
  const valid = [...byCode.values()]
    .map((periods) => periodAt(periods, at))
    .filter((r): r is DatahubCharge => r !== null);
  let main = valid.filter((r) => MAIN_NOTES.includes(normaliseNote(r.note)));
  for (const note of MAIN_NOTES) {
    const exact = main.filter((r) => normaliseNote(r.note) === note);
    if (exact.length > 0) {
      main = exact;
      break;
    }
  }
  const distinct = new Map(main.map((r) => [JSON.stringify(micro(r)), r]));
  if (distinct.size === 0) {
    return {
      support: 'unsupported' as const,
      note: 'No household tariff ("Nettarif C") valid now.',
    };
  }
  if (distinct.size > 1) {
    const codes = main.map((r) => r.code).join(', ');
    return {
      support: 'unsupported' as const,
      note: `Several different household tariffs (${codes}); can't tell which applies.`,
    };
  }
  const chosen = [...main].sort((a, b) => a.code.localeCompare(b.code))[0] as DatahubCharge;
  const shape = classifyTariffShape(micro(chosen));
  const evidence = {
    ...describeShape(shape),
    validFrom: chosen.validFrom,
    validTo: chosen.validTo,
  };
  if (shape.kind === 'flat' && shape.price === 0) {
    return {
      support: 'unsupported' as const,
      note: 'Household tariff is 0.00 DKK/kWh; the real price is likely published under another code.',
      evidence,
    };
  }
  if (shape.kind === 'other') {
    return {
      support: 'unsupported' as const,
      note: 'Household tariff is neither Tarifmodel 3.0 nor a flat price.',
      evidence,
    };
  }
  const components: Component[] = [{ code: chosen.code, role: 'tariff', note: chosen.note }];
  for (const r of valid.filter((v) => normaliseNote(v.note) === REGIONAL_NOTE)) {
    components.push({ code: r.code, role: 'tariff', note: r.note });
  }
  const discounts = new Map<string, DatahubCharge>();
  for (const r of rows) if (isDiscountNote(normaliseNote(r.note))) discounts.set(r.code, r);
  for (const r of discounts.values())
    components.push({ code: r.code, role: 'discount', note: r.note });
  return { support: 'supported' as const, note: null, components, evidence };
}

async function main() {
  const since = new Date(Date.now() - 100 * 86_400_000).toISOString().slice(0, 10);
  const statsJson = await fetchJson(
    'measuring-point-statistics',
    `${API}/DatahubMeasuringPointStatistics?start=${since}&filter=${encodeURIComponent(JSON.stringify({ MP_Type: ['E17'] }))}&limit=200000`,
  );
  const tariffJson = await fetchJson(
    'datahub-tariffs',
    `${API}/DatahubPricelist?start=2024-06-01&filter=${encodeURIComponent(JSON.stringify({ ChargeType: ['D03'] }))}&limit=200000`,
  );

  const stats = statsEnvelope.parse(statsJson).records;
  const latestMonth =
    stats
      .map((r) => r.Month)
      .sort()
      .at(-1) ?? '';
  const companies = new Map<
    string,
    { name: string; numbers: Set<string>; areas: Map<string, number> }
  >();
  for (const r of stats) {
    if (r.Month !== latestMonth || r.MP_PhysicalStatus !== 'E22') continue; // E22 = connected
    const key = normaliseName(r.GridCompanyName);
    const company = companies.get(key) ?? {
      name: r.GridCompanyName,
      numbers: new Set<string>(),
      areas: new Map<string, number>(),
    };
    company.numbers.add(r.GridCompany);
    company.areas.set(r.PriceArea, (company.areas.get(r.PriceArea) ?? 0) + r.Number_MP);
    companies.set(key, company);
  }

  // Statistics sometimes suffix the grid-area number ("Dinel A/S - 233") where the pricelist
  // doesn't. Fall back to the name without it, but only when exactly one company has it.
  const withoutSuffix = new Map<string, string[]>();
  for (const [key, company] of companies) {
    const base = normaliseName(company.name.replace(/\s+-\s+\d+$/, ''));
    withoutSuffix.set(base, [...(withoutSuffix.get(base) ?? []), key]);
  }
  const findCompany = (ownerName: string) => {
    const key = normaliseName(ownerName);
    if (companies.has(key)) return key;
    const candidates = withoutSuffix.get(key) ?? [];
    return candidates.length === 1 ? candidates[0] : undefined;
  };

  const tariffs = parseDatahubPricelist(tariffJson);
  const byOwner = new Map<string, { name: string | null; rows: DatahubCharge[] }>();
  for (const t of tariffs) {
    const owner = byOwner.get(t.ownerGln) ?? { name: t.ownerName, rows: [] };
    owner.rows.push(t);
    owner.name ??= t.ownerName;
    byOwner.set(t.ownerGln, owner);
  }

  const results = [];
  const ignoredOwners = [];
  const matched = new Set<string>();
  for (const [gln, owner] of byOwner) {
    const key = owner.name ? findCompany(owner.name) : undefined;
    const company = key ? companies.get(key) : undefined;
    if (!key || !company) {
      ignoredOwners.push({
        gln,
        name: owner.name,
        reason: 'no matching grid company in DataHub statistics',
      });
      continue;
    }
    matched.add(key);
    const [zone] = [...company.areas.entries()].sort((a, b) => b[1] - a[1])[0] as [string, number];
    const meteringPoints = [...company.areas.values()].reduce((a, b) => a + b, 0);
    const decision = classify(owner.rows);
    const override = OVERRIDES[gln];
    results.push({
      gln,
      name: owner.name as string,
      gridCompanyNumbers: [...company.numbers].sort(),
      zone,
      meteringPoints,
      support: override?.support ?? decision.support,
      supportNote: override?.note ?? decision.note,
      components: override ? [] : (decision.components ?? []),
      evidence: decision.evidence ?? null,
    });
  }
  results.sort((a, b) => b.meteringPoints - a.meteringPoints);

  const ignoredStatistics = [...companies.entries()]
    .filter(([key]) => !matched.has(key))
    .map(([, c]) => ({
      name: c.name,
      numbers: [...c.numbers],
      reason: 'no tariffs published (TSO, grid-loss or border metering point)',
    }));

  const total = results.reduce((s, r) => s + r.meteringPoints, 0);
  const supported = results.filter((r) => r.support === 'supported');
  const covered = supported.reduce((s, r) => s + r.meteringPoints, 0);
  const output = {
    generatedAt: new Date().toISOString(),
    referenceTime: at,
    statisticsMonth: latestMonth,
    source:
      'Energinet (www.energidataservice.dk), CC BY 4.0: DatahubPricelist, DatahubMeasuringPointStatistics',
    summary: {
      gridCompanies: results.length,
      supported: supported.length,
      meteringPointsCovered: `${covered} of ${total} (${((covered / total) * 100).toFixed(1)}%)`,
    },
    gridCompanies: results,
    ignoredOwners,
    ignoredStatistics,
  };
  await mkdir(new URL('.', OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(output.summary);
  for (const r of results.filter((x) => x.support === 'unsupported')) {
    console.log(`unsupported: ${r.name} (${r.meteringPoints}) — ${r.supportNote}`);
  }
}

await main();
