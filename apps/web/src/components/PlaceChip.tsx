'use client';

import { MapPin, X } from 'lucide-react';
import { displayName } from '@/lib/companies';
import { dictionaries, LOCALES, type Locale } from '@/lib/i18n';
import { isCurrent, useOutages } from '@/lib/outages';
import { forgetPlace, usePlace } from '@/lib/place';

/** The visitor's chosen grid company (or area), linking to their prices. Hidden until chosen. */
export function PlaceChip({
  locale,
  compact = false,
  className = '',
}: {
  locale: Locale;
  /** Pin and × only (phones); the name stays in the accessible label and tooltip. */
  compact?: boolean;
  className?: string;
}) {
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
    <span
      className={`items-center rounded-full border border-[var(--border)] text-xs text-[var(--foreground)] ${className}`}
    >
      <a
        href={LOCALES[locale].path}
        aria-label={label}
        title={label}
        className="flex items-center gap-1 rounded-l-full py-1 pr-1 pl-2.5 hover:text-[var(--accent)]"
      >
        <MapPin aria-hidden="true" className="h-3.5 w-3.5 text-[var(--accent)]" />
        {outage && (
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[var(--expensive)]" />
        )}
        {!compact && (
          <span className="max-w-[10rem] truncate">
            {place.name ? displayName(place.name) : place.zone}
          </span>
        )}
      </a>
      <button
        type="button"
        onClick={forgetPlace}
        aria-label={t.place.forgetLabel}
        title={t.place.forgetLabel}
        className="flex h-6 w-6 items-center justify-center rounded-r-full text-[var(--muted)] hover:text-[var(--foreground)]"
      >
        <X aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
