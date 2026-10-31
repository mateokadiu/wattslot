'use client';

import { OUTAGES_TEXT } from '@/content/outages';
import { isCurrent, useOutages } from '@/lib/outages';
import { OutageItem } from './OutageItem';

const tel = (phone: string) => `tel:${phone.replace(/\s/g, '')}`;

/** "Power outages" on a grid company page: what's happening now, and who to call. */
export function CompanyOutages({
  locale,
  name,
  gln,
  phone,
  page,
  reports,
  outagesHref,
}: {
  locale: 'en' | 'da';
  name: string;
  gln: string;
  phone: string | null;
  page: string | null;
  reports: boolean;
  outagesHref: string;
}) {
  const x = OUTAGES_TEXT[locale];
  const loaded = useOutages(reports ? `/v1/outages?list=all&gln=${gln}` : null);
  const outages = loaded?.state === 'ready' ? loaded.data.outages : [];
  const current = outages.filter((o) => o.list === 'active');
  const planned = outages.filter((o) => o.list === 'planned');

  return (
    <section aria-labelledby="outages" className="rounded-2xl border border-[var(--border)] p-5">
      <h2 id="outages" className="!mt-0">
        {x.blockHeading}
        {current.some(isCurrent) && (
          <span
            aria-hidden="true"
            className="ml-2 inline-block h-2.5 w-2.5 rounded-full bg-[var(--expensive)] align-middle"
          />
        )}
      </h2>
      {!reports ? (
        <p>{x.silent(name)}</p>
      ) : loaded?.state === 'error' ? (
        <p>{x.error}</p>
      ) : loaded?.state === 'ready' && !loaded.data.enabled ? (
        <p>{x.paused}</p>
      ) : loaded?.state !== 'ready' ? (
        <p className="text-[var(--muted)]">{x.loading}</p>
      ) : (
        <>
          {current.length === 0 ? (
            <p className="text-[var(--muted)]">{x.noneFor}</p>
          ) : (
            <ul className="!mt-2 !list-none divide-y divide-[var(--border)] !pl-0">
              {current.map((o) => (
                <OutageItem key={o.id} outage={o} locale={locale} text={x} />
              ))}
            </ul>
          )}
          {planned.length > 0 && (
            <>
              <h3>{x.planned}</h3>
              <ul className="!mt-2 !list-none divide-y divide-[var(--border)] !pl-0">
                {planned.slice(0, 3).map((o) => (
                  <OutageItem key={o.id} outage={o} locale={locale} text={x} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <p className="text-sm">
        {phone && (
          <>
            {x.faultLine}: <a href={tel(phone)}>{phone}</a>
          </>
        )}
        {page && (
          <>
            {phone && ' · '}
            <a href={page} rel="noopener">
              {x.companyPage}
            </a>
          </>
        )}
        {' · '}
        <a href={outagesHref}>{x.allOutages}</a>
      </p>
    </section>
  );
}
