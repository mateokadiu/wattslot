import type { GridCompany } from './api';

/** One grid area of a company (N1 has three, each with its own GLN and tariff). */
export interface CompanyArea {
  gln: string;
  /** DataHub grid area number from the name ("N1 A/S - 131" → "131"); null for one-area companies. */
  code: string | null;
  meteringPoints: number;
}

/** A grid company as people know it: one page, however many grid areas it runs. */
export interface Company {
  slug: string;
  name: string;
  legalName: string;
  zone: string;
  meteringPoints: number;
  /** Largest first; the first area's tariff and prices represent the company. */
  areas: CompanyArea[];
}

const AREA = /\s+-\s+(\d+)$/;
const LEGAL = /\s+(a\/s|a\.m\.b\.a\.?|aps)$/i;

/** "N1 A/S - 131" → "N1 A/S". */
export const legalName = (name: string): string => name.replace(AREA, '').trim();

/** "Midtfyns Elforsyning A.m.b.A" → "Midtfyns Elforsyning". */
export const displayName = (name: string): string => legalName(name).replace(LEGAL, '').trim();

/** "TREFOR El-net Øst A/S" → "trefor-el-net-oest". */
export const slugify = (name: string): string =>
  displayName(name)
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/å/g, 'aa')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Supported grid companies, one entry per company, largest first. */
export function groupCompanies(list: readonly GridCompany[]): Company[] {
  const bySlug = new Map<string, Company>();
  for (const g of list) {
    if (!g.supported) continue;
    const slug = slugify(g.name);
    const area = {
      gln: g.gln,
      code: AREA.exec(g.name)?.[1] ?? null,
      meteringPoints: g.meteringPoints ?? 0,
    };
    const company = bySlug.get(slug);
    if (company) {
      company.areas.push(area);
      company.meteringPoints += area.meteringPoints;
    } else {
      bySlug.set(slug, {
        slug,
        name: displayName(g.name),
        legalName: legalName(g.name),
        zone: g.zone,
        meteringPoints: area.meteringPoints,
        areas: [area],
      });
    }
  }
  const companies = [...bySlug.values()];
  for (const c of companies) {
    c.areas.sort((a, b) => b.meteringPoints - a.meteringPoints);
    c.zone = list.find((g) => g.gln === c.areas[0]?.gln)?.zone ?? c.zone;
  }
  return companies.sort(
    (a, b) => b.meteringPoints - a.meteringPoints || a.name.localeCompare(b.name),
  );
}
