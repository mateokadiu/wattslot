import { localTime } from '@wattslot/pricing';
import type { DayFacts } from './facts';
import { areaFacts, buildPrices, companies, companyPeriods, readPrices } from './load-facts';
import { tariffShape } from './tariffs';

// Build-time numbers the guides quote, so they're as current as the page.

export interface Bands {
  name: string;
  slug: string;
  zone: string;
  low: number;
  high: number;
  peak: number;
}

export interface GuideData {
  date: string;
  today: { zone: 'DK1' | 'DK2'; facts: DayFacts }[];
  /** Current bands per company (DKK/kWh excl. VAT), largest first. */
  tariffs: Bands[];
  /** Companies charging one price around the clock. */
  flat: string[];
  /** The largest company's next period, if it changes the peak. */
  next: { from: string; low: number; high: number; peak: number } | null;
  /** Biggest price difference between quarter hours of the same hour today, DK2. */
  jump: { minAt: number; maxAt: number; min: number; max: number } | null;
}

const TZ = 'Europe/Copenhagen';

export function guideData(): GuideData {
  const { date } = buildPrices();
  const today = (['DK1', 'DK2'] as const).flatMap((zone) => {
    const day = areaFacts(zone).find((d) => d.kind === 'today');
    const facts = day?.zones[0]?.facts;
    return facts ? [{ zone, facts }] : [];
  });

  const start = `${date}T00:00:00`;
  const tariffs: Bands[] = [];
  const flat: string[] = [];
  for (const c of companies()) {
    const periods = companyPeriods(c.areas[0]?.gln ?? '');
    const current = periods.find(
      (p) => p.validFrom <= start && (p.validTo === null || p.validTo > start),
    );
    if (!current) continue;
    const shape = tariffShape(current.hourly);
    if (shape.kind === 'bands')
      tariffs.push({ name: c.name, slug: c.slug, zone: c.zone, ...shape });
    if (shape.kind === 'flat') {
      flat.push(c.name);
      tariffs.push({
        name: c.name,
        slug: c.slug,
        zone: c.zone,
        low: shape.price,
        high: shape.price,
        peak: shape.price,
      });
    }
  }

  const largest = companies()[0];
  const upcoming = largest
    ? companyPeriods(largest.areas[0]?.gln ?? '').find((p) => p.validFrom > start)
    : undefined;
  const nextShape = upcoming ? tariffShape(upcoming.hourly) : null;
  const next =
    upcoming && nextShape?.kind === 'bands'
      ? { from: upcoming.validFrom, low: nextShape.low, high: nextShape.high, peak: nextShape.peak }
      : null;

  const quarters = readPrices('DK2')
    .slots.map((s) => ({ startMs: Date.parse(s.start), total: s.total }))
    .filter((q) => localTime(q.startMs, TZ).date === date);
  let jump: GuideData['jump'] = null;
  for (let i = 0; i + 4 <= quarters.length; i += 4) {
    const hour = quarters.slice(i, i + 4);
    const lo = hour.reduce((a, b) => (b.total < a.total ? b : a));
    const hi = hour.reduce((a, b) => (b.total > a.total ? b : a));
    if (!jump || hi.total - lo.total > jump.max - jump.min) {
      jump = { minAt: lo.startMs, maxAt: hi.startMs, min: lo.total, max: hi.total };
    }
  }
  return { date, today, tariffs, flat, next, jump };
}
