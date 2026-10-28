const timeFormats = new Map<string, Intl.DateTimeFormat>();

/** HH:mm in the price zone's own time zone, whatever the viewer's clock says. */
export function clock(ms: number, timeZone: string): string {
  let f = timeFormats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    timeFormats.set(timeZone, f);
  }
  return f.format(ms);
}

/** A per-kWh price, two decimals, in the locale's style: 2.32 / 2,32. */
export function price(value: number, locale: 'en' | 'da'): string {
  return value.toLocaleString(locale === 'da' ? 'da-DK' : 'en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** "2 hours", "1 hour 30 min", "45 min". */
export function duration(hours: number, words: { hour: string; hours: string; min: string }) {
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  const h = whole === 0 ? '' : `${whole} ${whole === 1 ? words.hour : words.hours}`;
  const m = minutes === 0 ? '' : `${minutes} ${words.min}`;
  return [h, m].filter(Boolean).join(' ');
}

/** Energy in kWh with at most one decimal: 1.1, 0.9, 20 (or 1,1 in Danish). */
export function kwh(value: number, locale: 'en' | 'da'): string {
  return value.toLocaleString(locale === 'da' ? 'da-DK' : 'en-GB', { maximumFractionDigits: 1 });
}
