'use client';

import { localTime } from '@wattslot/pricing';
import { useEffect, useState } from 'react';
import { nextDate } from '@/lib/facts';

/**
 * "Prices today" as built — but if this page is older than a day (a missed rebuild), the
 * heading falls back to the date itself instead of calling yesterday "today".
 */
export function DayHeading({
  id,
  date,
  timeZone,
  today,
  tomorrow,
  dated,
  built,
}: {
  id: string;
  date: string;
  timeZone: string;
  today: string;
  tomorrow: string;
  dated: string;
  built: 'today' | 'tomorrow';
}) {
  const [label, setLabel] = useState(built === 'today' ? today : tomorrow);
  useEffect(() => {
    const now = localTime(Date.now(), timeZone).date;
    setLabel(date === now ? today : date === nextDate(now) ? tomorrow : dated);
  }, [date, timeZone, today, tomorrow, dated]);
  return (
    <h2 id={id} className="text-xl font-semibold tracking-tight">
      {label}
    </h2>
  );
}
