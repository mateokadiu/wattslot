import { DIRECTORY } from '@/content/directory';
import { ore } from '@/lib/format';
import { tariffShape } from '@/lib/tariffs';

/** A 24-hour tariff as rows by time band (or by hour), excluding and including VAT. */
export function TariffTable({
  locale,
  hourly,
  caption,
}: {
  locale: 'en' | 'da';
  hourly: number[];
  caption: string;
}) {
  const d = DIRECTORY[locale];
  const shape = tariffShape(hourly);
  const rows: [string, number][] =
    shape.kind === 'flat'
      ? [[d.band.flat, shape.price]]
      : shape.kind === 'bands'
        ? [
            [d.band.low, shape.low],
            [d.band.high, shape.high],
            [d.band.peak, shape.peak],
          ]
        : shape.hourly.map((v, h) => [d.band.hour(h), v]);
  return (
    <table>
      <caption className="pb-2 text-left text-xs text-[var(--muted)]">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{d.timeOfDay}</th>
          <th scope="col" className="text-right">
            {d.exclVat}
          </th>
          <th scope="col" className="text-right">
            {d.inclVat}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td className="text-right font-mono tabular-nums">{ore(value, locale, false)}</td>
            <td className="text-right font-mono tabular-nums">{ore(value, locale, true)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
