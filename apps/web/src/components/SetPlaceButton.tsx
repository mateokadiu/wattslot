'use client';

import { Check } from 'lucide-react';
import { dictionaries, type Locale } from '@/lib/i18n';
import { choosePlace, usePlace } from '@/lib/place';

/** "This is my grid company": remembers it in this browser for the live view and the header. */
export function SetPlaceButton({
  locale,
  zone,
  gln,
  name,
}: {
  locale: Locale;
  zone: string;
  gln: string;
  /** Legal name, as the live view stores it ("N1 A/S - 131"). */
  name: string;
}) {
  const t = dictionaries[locale];
  const place = usePlace();
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      {place?.gln === gln ? (
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Check aria-hidden="true" className="h-4 w-4 text-[var(--accent)]" />
          {t.place.saved}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => choosePlace({ zone, gln, name })}
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3.5 py-2 font-medium hover:border-[var(--accent)]"
        >
          {t.place.set}
        </button>
      )}
      <span className="text-xs text-[var(--muted)]">{t.place.note}</span>
    </div>
  );
}
