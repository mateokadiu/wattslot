'use client';

import { MapPin } from 'lucide-react';
import { displayName } from '@/lib/companies';
import { dictionaries, LOCALES, type Locale } from '@/lib/i18n';
import { isCurrent, useOutages } from '@/lib/outages';
import { usePlace } from '@/lib/place';

/** The visitor's chosen grid company (or area), linking to their prices. Hidden until chosen. */
export function PlaceChip({ locale, className = '' }: { locale: Locale; className?: string }) {
  const place = usePlace();
  // Shows a dot while the visitor's grid company has an outage; one cached request per minute.
  const outages = useOutages(place?.gln ? `/v1/outages?gln=${place.gln}` : null);
  if (!place) return null;
  const t = dictionaries[locale];
  const outage =
    outages?.state === 'ready' && outages.data.enabled && outages.data.outages.some(isCurrent);
  const label =
    (place.name ? t.place.label(displayName(place.name)) : t.place.area(place.zone)) +
    (outage ? t.place.outage : '');
  return (
    <a
      href={LOCALES[locale].path}
      aria-label={label}
      title={label}
      className={`items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--foreground)] hover:border-[var(--accent)] ${className}`}
    >
      <MapPin aria-hidden="true" className="h-3.5 w-3.5 text-[var(--accent)]" />
      {outage && <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[var(--expensive)]" />}
      <span className="max-w-[10rem] truncate">
        {place.name ? displayName(place.name) : place.zone}
      </span>
    </a>
  );
}
