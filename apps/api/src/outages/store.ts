// An explicit import (not the ambient Workers global) so tests type-check under Node too.
import type { D1Database } from '@cloudflare/workers-types';
import type { OutageList, OutageRow } from './feed.ts';

/**
 * Brings one list in line with the portal: inserts new incidents, rewrites only those whose
 * hash changed, and marks incidents that left the list as gone. Two statements, each with one
 * JSON parameter (see ingest/store.ts for why).
 */
export async function syncOutages(
  d1: D1Database,
  list: OutageList,
  rows: readonly OutageRow[],
  nowMs: number,
): Promise<{ written: number; gone: number }> {
  const payload = JSON.stringify(
    rows.map((r) => [
      r.id,
      r.supplierId,
      r.supplierName,
      r.gln,
      r.kind,
      r.title,
      r.cause,
      r.comment,
      r.customers,
      r.startMs,
      r.endMs,
      r.expectedEndMs,
      JSON.stringify(r.postcodes),
      r.lat,
      r.lng,
      r.radiusM,
      r.hash,
    ]),
  );
  const [upsert, gone] = await d1.batch([
    d1
      .prepare(
        `INSERT INTO outages (id, list, supplier_id, supplier_name, gln, kind, title, cause, comment,
           customers, start_ms, end_ms, expected_end_ms, postcodes, lat, lng, radius_m, hash,
           first_seen_ms, gone_ms)
         SELECT value ->> '$[0]', ?2, value ->> '$[1]', value ->> '$[2]', value ->> '$[3]',
           value ->> '$[4]', value ->> '$[5]', value ->> '$[6]', value ->> '$[7]', value ->> '$[8]',
           value ->> '$[9]', value ->> '$[10]', value ->> '$[11]', value ->> '$[12]',
           value ->> '$[13]', value ->> '$[14]', value ->> '$[15]', value ->> '$[16]', ?3, NULL
         FROM json_each(?1) WHERE true
         ON CONFLICT (id) DO UPDATE SET
           list = excluded.list, supplier_id = excluded.supplier_id,
           supplier_name = excluded.supplier_name, gln = excluded.gln, kind = excluded.kind,
           title = excluded.title, cause = excluded.cause, comment = excluded.comment,
           customers = excluded.customers, start_ms = excluded.start_ms, end_ms = excluded.end_ms,
           expected_end_ms = excluded.expected_end_ms, postcodes = excluded.postcodes,
           lat = excluded.lat, lng = excluded.lng, radius_m = excluded.radius_m,
           hash = excluded.hash, gone_ms = NULL
         WHERE outages.hash != excluded.hash OR outages.gone_ms IS NOT NULL
           OR outages.list != excluded.list`,
      )
      .bind(payload, list, nowMs),
    d1
      .prepare(
        `UPDATE outages SET gone_ms = ?3
         WHERE list = ?2 AND gone_ms IS NULL
           AND id NOT IN (SELECT value ->> '$[0]' FROM json_each(?1))`,
      )
      .bind(payload, list, nowMs),
  ]);
  return { written: upsert?.meta.changes ?? 0, gone: gone?.meta.changes ?? 0 };
}
