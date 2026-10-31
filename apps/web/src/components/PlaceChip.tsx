'use client';

import { MapPin } from 'lucide-react';
import { displayName } from '@/lib/companies';
import { dictionaries, LOCALES, type Locale } from '@/lib/i18n';
import { usePlace } from '@/lib/place';

/** The visitor's chosen grid company (or area), linking to their prices. Hidden until chosen. */
export function PlaceChip({ locale, className = '' }: { locale: Locale; className?: string }) {
  const place = usePlace();
  if (!place) return null;
  const t = dictionaries[locale];
  const label = place.name ? t.place.label(displayName(place.name)) : t.place.area(place.zone);
  return (
    <a
      href={LOCALES[locale].path}
      aria-label={label}
      title={label}
      className={`items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--foreground)] hover:border-[var(--accent)] ${className}`}
    >
      <MapPin aria-hidden="true" className="h-3.5 w-3.5 text-[var(--accent)]" />
      <span className="max-w-[10rem] truncate">
        {place.name ? displayName(place.name) : place.zone}
      </span>
    </a>
  );
}
