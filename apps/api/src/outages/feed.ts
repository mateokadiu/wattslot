import { z } from '@hono/zod-openapi';
import { DK_TIME_ZONE, wallClockToUtc } from '@wattslot/pricing';
import { glnForSupplier } from './suppliers.ts';

/** Green Power Denmark's public outage portal (the API behind the grid companies' own maps). */
export const OUTAGE_API = 'https://api.elnet.greenpowerdenmark.dk/api/incidents';
export const OUTAGE_SOURCE = 'Netselskaberne via Green Power Denmark (elnet.dk)';

export type OutageList = 'active' | 'planned';
/** `showType` per list: 2 = current unplanned/announced/notices, 3 = planned work. */
export const SHOW_TYPE: Record<OutageList, number> = { active: 2, planned: 3 };

const KINDS = { 1: 'unplanned', 2: 'announced', 3: 'planned', 4: 'notice' } as const;
export type OutageKind = (typeof KINDS)[keyof typeof KINDS];

const text = z.string().nullish();
const Incident = z.object({
  id: z.number().int(),
  supplierId: z.number().int(),
  supplierName: z.string(),
  incidentTypeId: z.number().int(),
  title: z.string(),
  cause: text,
  comment: text,
  effectedCustomers: z.number().nullish(),
  /** Danish local wall-clock time, without an offset (unlike `created`, which is UTC). */
  startDate: text,
  endDate: text,
  expectedDowntime: text,
  zipcodes: text,
  centerLat: z.number().nullish(),
  centerLng: z.number().nullish(),
  radius: z.number().nullish(),
});

export interface OutageRow {
  id: number;
  list: OutageList;
  supplierId: number;
  supplierName: string;
  gln: string | null;
  kind: OutageKind;
  title: string;
  cause: string | null;
  comment: string | null;
  customers: number | null;
  startMs: number | null;
  endMs: number | null;
  expectedEndMs: number | null;
  postcodes: string[];
  lat: number | null;
  lng: number | null;
  radiusM: number | null;
  hash: string;
}

const WALL = /^(\d{4}-\d{2}-\d{2}T\d{2})(?::(\d{2}))?(?::(\d{2}))?/;

/**
 * Wall-clock → UTC, converting each local hour once. Zone offsets only change on the hour, and
 * the portal's ~900 timestamps fall in ~140 distinct hours. Measured on the real planned list
 * (≈200 KB, 296 incidents): ~3 ms of CPU for the whole parse instead of ~7, well inside the free
 * plan's 10 ms per invocation.
 */
function localTimes() {
  const hours = new Map<string, number>();
  return (wall: string | null | undefined): number | null => {
    const m = wall ? WALL.exec(wall) : null;
    if (!m) return null;
    const hour = m[1] as string;
    let base = hours.get(hour);
    if (base === undefined) {
      base = wallClockToUtc(`${hour}:00:00`, DK_TIME_ZONE);
      hours.set(hour, base);
    }
    return base + Number(m[2] ?? 0) * 60_000 + Number(m[3] ?? 0) * 1000;
  };
}

const clean = (s: string | null | undefined) => {
  const t = s?.replace(/\s+/g, ' ').trim();
  return t ? t : null;
};

/** 32-bit FNV-1a: enough to tell whether a row changed, and cheap on the CPU budget. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * The portal's incidents as rows. Malformed incidents and unknown kinds are skipped (and
 * counted) rather than failing the whole list.
 */
export function toOutageRows(
  body: unknown,
  list: OutageList,
): { rows: OutageRow[]; skipped: number } {
  if (!Array.isArray(body)) throw new Error('Outage portal: expected a list of incidents');
  const local = localTimes();
  const rows: OutageRow[] = [];
  let skipped = 0;
  for (const item of body) {
    const parsed = Incident.safeParse(item);
    const kind = parsed.success
      ? KINDS[parsed.data.incidentTypeId as keyof typeof KINDS]
      : undefined;
    if (!parsed.success || !kind) {
      skipped++;
      continue;
    }
    const i = parsed.data;
    const row = {
      id: i.id,
      list,
      supplierId: i.supplierId,
      supplierName: i.supplierName.trim(),
      gln: glnForSupplier(i.supplierId),
      kind,
      title: clean(i.title) ?? '',
      cause: clean(i.cause),
      comment: clean(i.comment),
      customers: i.effectedCustomers ?? null,
      startMs: local(i.startDate),
      endMs: local(i.endDate),
      expectedEndMs: local(i.expectedDowntime),
      postcodes: (i.zipcodes ?? '').split(/[^0-9]+/).filter((z) => z.length === 4),
      lat: i.centerLat ?? null,
      lng: i.centerLng ?? null,
      radiusM: i.radius == null ? null : Math.round(i.radius),
    };
    rows.push({ ...row, hash: fnv1a(JSON.stringify(row)) });
  }
  return { rows, skipped };
}
