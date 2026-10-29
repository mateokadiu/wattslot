import { clock, longDate, perKwh, price } from '@/lib/format';
import { dictionaries, type Locale } from '@/lib/i18n';
import type { Level } from '@/lib/insights';
import type { FactsDay } from '@/lib/load-facts';
import { DayHeading } from './DayHeading';

const LEVEL_DOT: Record<Level, string> = {
  cheap: 'var(--cheap)',
  normal: 'var(--normal)',
  expensive: 'var(--expensive)',
};

/**
 * Today's (and tomorrow's) prices as plain HTML, rendered at build time: what search engines
 * and AI crawlers read, and what shows before the live view loads.
 */
export function DayFacts({
  locale,
  days,
  generatedAt,
}: {
  locale: Locale;
  days: FactsDay[];
  generatedAt: string;
}) {
  const t = dictionaries[locale];
  const first = days[0];
  if (!first) return null;
  const timeZone = 'Europe/Copenhagen';
  const area = (zone: string) => (zone === 'DK1' || zone === 'DK2' ? t.areas[zone] : zone);
  const full = first.zones.filter((z) => z.mode === 'full');
  const updated = new Date(generatedAt);

  return (
    <div className="mt-12 grid gap-4 lg:grid-cols-2">
      {days.map((day) => {
        const id = `prices-${day.kind}`;
        const unit = perKwh(day.zones[0]?.currency ?? 'DKK', locale);
        const fmt = (value: number) => `${price(value, locale)} ${unit}`;
        const hours = day.zones[0]?.facts.hours ?? [];
        return (
          <section
            key={day.date}
            aria-labelledby={id}
            className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6"
          >
            <DayHeading
              id={id}
              date={day.date}
              timeZone={timeZone}
              built={day.kind}
              today={t.factsToday}
              tomorrow={t.factsTomorrow}
              dated={t.factsOn(longDate(day.date, locale))}
            />
            <p className="mt-1 text-xs text-[var(--muted)]">
              <time dateTime={day.date}>{longDate(day.date, locale)}</time> · {t.factsUpdated}{' '}
              <time dateTime={generatedAt}>{clock(updated.getTime(), timeZone)}</time>
            </p>
            {day.zones.map(({ zone, facts }) => (
              <p key={zone} className="mt-4 text-sm leading-relaxed">
                {day.zones.length > 1 && <strong className="font-semibold">{area(zone)}. </strong>}
                {facts.cheapest2h && facts.priciestHour
                  ? t.factsSummary(
                      clock(facts.cheapest2h.startMs, timeZone),
                      clock(facts.cheapest2h.endMs, timeZone),
                      fmt(facts.cheapest2h.average),
                      clock(facts.priciestHour.startMs, timeZone),
                      clock(facts.priciestHour.endMs, timeZone),
                      fmt(facts.priciestHour.average),
                      fmt(facts.average),
                    )
                  : null}
              </p>
            ))}
            <table className="mt-5 w-full text-sm tabular-nums">
              <caption className="pb-2 text-left text-xs text-[var(--muted)]">
                {t.factsTable(unit)}
              </caption>
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                  <th scope="col" className="py-1.5 font-normal">
                    {t.time}
                  </th>
                  {day.zones.map(({ zone }) => (
                    <th key={zone} scope="col" className="py-1.5 text-right font-normal">
                      {zone}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono">
                {hours.map((hour, i) => (
                  <tr key={hour.startMs} className="border-b border-[var(--border)] last:border-0">
                    <th scope="row" className="py-1 text-left font-normal">
                      {clock(hour.startMs, timeZone)}–{clock(hour.endMs, timeZone)}
                    </th>
                    {day.zones.map(({ zone, facts }) => {
                      const cell = facts.hours[i];
                      return (
                        <td key={zone} className="py-1 text-right">
                          {cell && (
                            <>
                              <span
                                aria-hidden="true"
                                className="mr-2 inline-block h-2 w-2 rounded-full"
                                style={{ background: LEVEL_DOT[cell.level] }}
                              />
                              {price(cell.average, locale)}
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
      <p className="text-xs leading-relaxed text-[var(--muted)] lg:col-span-2">
        {full.length > 0
          ? t.factsNoteFull(full.map((z) => `${z.company} (${z.zone})`).join(', '))
          : t.factsNoteSpot}
      </p>
    </div>
  );
}
