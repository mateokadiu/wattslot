import { LOCALES, type Locale } from './i18n';

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
export function price(value: number, locale: Locale): string {
  return value.toLocaleString(LOCALES[locale].intl, {
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
export function kwh(value: number, locale: Locale): string {
  return value.toLocaleString(LOCALES[locale].intl, { maximumFractionDigits: 1 });
}

/** Unit for a per-kWh price: "kr./kWh" on Danish pages, otherwise "DKK/kWh", "EUR/kWh". */
export function perKwh(currency: string, locale: Locale): string {
  return currency === 'DKK' && locale === 'da' ? 'kr./kWh' : `${currency}/kWh`;
}

/** "Thursday 29 October" / "torsdag den 29. oktober" for a YYYY-MM-DD date. */
export function longDate(date: string, locale: Locale): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(LOCALES[locale].intl, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(Date.UTC(y, m - 1, d, 12));
}
