import type { OutageText } from '@/content/outages';
import type { Outage } from '@/lib/api';
import { displayName } from '@/lib/companies';
import type { Locale } from '@/lib/i18n';
import { when } from '@/lib/outages';

const BADGE: Record<Outage['kind'] | 'restored', string> = {
  unplanned: 'bg-[var(--expensive)]/20 text-[var(--foreground)]',
  announced: 'bg-[var(--normal)]/20 text-[var(--foreground)]',
  planned: 'bg-[var(--border)] text-[var(--foreground)]',
  notice: 'bg-[var(--border)] text-[var(--foreground)]',
  restored: 'bg-[var(--cheap)]/15 text-[var(--foreground)]',
};

/** One outage: what, who, where and when. */
export function OutageItem({
  outage: o,
  locale,
  text: x,
}: {
  outage: Outage;
  locale: Locale;
  text: OutageText;
}) {
  const company = o.gridCompany ? displayName(o.gridCompany.name) : o.supplierName;
  // Planned work, and outages announced for later, show their window; others since when.
  const upcoming = o.start !== null && Date.parse(o.start) > Date.now();
  const time =
    (o.list === 'planned' || upcoming) && o.start
      ? x.window(when(o.start, locale), o.expectedEnd ? when(o.expectedEnd, locale) : '')
      : o.restored && o.end
        ? x.back(when(o.end, locale))
        : [
            o.start ? x.since(when(o.start, locale)) : null,
            o.expectedEnd ? x.expected(when(o.expectedEnd, locale)) : null,
          ]
            .filter(Boolean)
            .join(', ');
  return (
    <li className={`py-3 ${o.restored ? 'opacity-75' : ''}`}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${BADGE[o.restored ? 'restored' : o.kind]}`}
        >
          {o.restored ? x.restored : x.kinds[o.kind]}
        </span>
        <strong className="font-semibold">{o.title}</strong>
        <span className="text-[var(--muted)]">· {company}</span>
      </p>
      {o.cause && <p className="mt-1 line-clamp-2 text-sm text-[var(--muted)]">{o.cause}</p>}
      <p className="mt-1 text-xs text-[var(--muted)]">
        {[
          time,
          o.customers ? x.customers(o.customers) : null,
          o.postcodes.length > 0 ? o.postcodes.join(', ') : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </li>
  );
}
