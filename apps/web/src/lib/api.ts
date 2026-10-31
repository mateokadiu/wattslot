/** Same-origin in production (the API Worker serves this site); set for `next dev`. */
const BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

export interface Zone {
  code: string;
  currency: string;
  timeZone: string;
  fullPrice: boolean;
}

export interface GridCompany {
  gln: string;
  name: string;
  zone: string;
  meteringPoints: number | null;
  supported: boolean;
  note: string | null;
  /** Fault line and outage page; `reports` is false for companies not on the shared portal. */
  outages?: { reports: boolean; phone: string; page: string | null } | null;
}

export type OutageKind = 'unplanned' | 'announced' | 'planned' | 'notice';

export interface Outage {
  id: number;
  list: 'active' | 'planned';
  kind: OutageKind;
  title: string;
  cause: string | null;
  customers: number | null;
  start: string | null;
  end: string | null;
  expectedEnd: string | null;
  restored: boolean;
  postcodes: string[];
  gridCompany: { gln: string; name: string } | null;
  supplierName: string;
}

export interface Outages {
  enabled: boolean;
  updatedAt: string | null;
  stale: boolean;
  source: string;
  outages: Outage[];
}

export interface ApiPriceSlot {
  start: string;
  spot: number;
  gridTariff: number;
  tsoTariffs: number;
  electricityTax: number;
  supplierMarkup: number;
  vat: number;
  total: number;
}

export interface Prices {
  zone: string;
  currency: string;
  gridCompany: { gln: string; name: string } | null;
  mode: 'full' | 'spot-only';
  note: string | null;
  slots: ApiPriceSlot[];
}

export interface Co2 {
  slots: { start: string; forecast: number | null; actual: number | null }[];
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${BASE}${path}`, signal ? { signal } : {});
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}
