'use client';

import { type ReactNode, useState } from 'react';
import { OUTAGES_TEXT } from '@/content/outages';
import type { Outage } from '@/lib/api';
import { type Loaded, useOutages, when } from '@/lib/outages';
import { setPostcode, usePlace, usePostcode } from '@/lib/place';
import { OutageItem } from './OutageItem';

/** A grid company as the board needs it: name, page and every grid area's GLN. */
export interface BoardCompany {
  name: string;
  glns: string[];
}

const SHOWN = 12;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

/** The live outage lists: by postcode, for your grid company, all of Denmark, and planned work. */
export function OutageBoard({
  locale,
  companies,
}: {
  locale: 'en' | 'da';
  companies: BoardCompany[];
}) {
  const x = OUTAGES_TEXT[locale];
  const place = usePlace();
  const postcode = usePostcode();
  const [draft, setDraft] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const company = place?.gln ? companies.find((c) => c.glns.includes(place.gln)) : undefined;

  const active = useOutages('/v1/outages');
  const planned = useOutages(
    postcode
      ? `/v1/outages?list=planned&postcode=${postcode}`
      : company
        ? `/v1/outages?list=planned&gln=${company.glns.join(',')}`
        : null,
  );

  const list = (loaded: Loaded | null, filter: (o: Outage) => boolean, empty: string) => {
    if (!loaded || loaded.state === 'loading') {
      return <p className="mt-3 text-sm text-[var(--muted)]">{x.loading}</p>;
    }
    if (loaded.state === 'error') return <p className="mt-3 text-sm">{x.error}</p>;
    if (!loaded.data.enabled) return <p className="mt-3 text-sm">{x.paused}</p>;
    const items = loaded.data.outages.filter(filter);
    if (items.length === 0) return <p className="mt-3 text-sm text-[var(--muted)]">{empty}</p>;
    return (
      <ul className="mt-2 divide-y divide-[var(--border)]">
        {items.map((o) => (
          <OutageItem key={o.id} outage={o} locale={locale} text={x} />
        ))}
      </ul>
    );
  };

  const field = draft ?? postcode ?? '';
  const data = active?.state === 'ready' ? active.data : null;
  const all = data?.outages ?? [];

  return (
    <div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (/^\d{4}$/.test(field)) setPostcode(field);
        }}
      >
        <label className="block">
          <span className="label mb-1.5 block">{x.postcodeLabel}</span>
          <input
            value={field}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 4);
              setDraft(v);
              if (v.length === 4) setPostcode(v);
              if (v.length === 0) setPostcode(null);
            }}
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder={x.postcodeHint}
            className="h-11 w-32 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3.5 font-mono"
          />
        </label>
        <p className="pb-3 text-xs text-[var(--muted)]">{x.postcodeHelp}</p>
      </form>

      {/* Always takes its line, so nothing moves when the time arrives. */}
      <p className="mt-4 min-h-4 text-xs text-[var(--muted)]" role="status">
        {data?.stale && data.updatedAt
          ? x.stale(when(data.updatedAt, locale))
          : data?.updatedAt
            ? x.updated(when(data.updatedAt, locale))
            : null}
      </p>

      {postcode && (
        <Section title={x.postcode(postcode)}>
          {list(active, (o) => o.postcodes.includes(postcode), x.noneFor)}
        </Section>
      )}
      {company && (
        <Section title={x.yours(company.name)}>
          {list(
            active,
            (o) => o.gridCompany !== null && company.glns.includes(o.gridCompany.gln),
            x.noneFor,
          )}
        </Section>
      )}
      <Section title={x.all}>
        {/* The lists load after first paint. Reserving most of a screen keeps what follows
            (planned work, the advice, the fault-line table) below the fold until they arrive,
            so nothing visible jumps. */}
        <div className="min-h-[70vh]">
          {list(active, (o) => expanded || all.indexOf(o) < SHOWN, x.none)}
        </div>
        {!expanded && all.length > SHOWN && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-2 text-sm underline underline-offset-2"
          >
            {x.more(all.length - SHOWN)}
          </button>
        )}
      </Section>
      <Section title={x.planned}>
        {planned ? (
          list(planned, () => true, x.plannedNone)
        ) : (
          <p className="mt-3 text-sm text-[var(--muted)]">{x.plannedHint}</p>
        )}
      </Section>
    </div>
  );
}
