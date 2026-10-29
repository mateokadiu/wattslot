// Which price areas each language's page pre-renders, and the grid company used for the
// full price. Kept free of imports: scripts/fetch-prices.ts reads it with plain Node.

export interface FactZone {
  zone: string;
  /** Grid company for the full price (the largest in the area); none for spot-only areas. */
  gln?: string;
  timeZone: string;
}

export const FACT_ZONES: Record<string, FactZone> = {
  DK1: { zone: 'DK1', gln: '5790001089030', timeZone: 'Europe/Copenhagen' }, // N1
  DK2: { zone: 'DK2', gln: '5790000705689', timeZone: 'Europe/Copenhagen' }, // Radius Elnet
  DE: { zone: 'DE', timeZone: 'Europe/Berlin' },
  NO2: { zone: 'NO2', timeZone: 'Europe/Oslo' },
  SE3: { zone: 'SE3', timeZone: 'Europe/Stockholm' },
  SE4: { zone: 'SE4', timeZone: 'Europe/Stockholm' },
};

/** Areas shown in each language's "prices today" section, in column order. */
export const FACTS_BY_LOCALE: Record<string, string[]> = {
  en: ['DK1', 'DK2'],
  da: ['DK1', 'DK2'],
  de: ['DE'],
  nb: ['NO2'],
  sv: ['SE3', 'SE4'],
};
