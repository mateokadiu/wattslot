import type { Locale } from '@/lib/i18n';
import { dictionaries } from '@/lib/i18n';
import { buildPrices, factsFor } from '@/lib/load-facts';
import { homeRoute } from '@/lib/routes';
import { structuredData } from '@/lib/structured-data';
import { Dashboard } from './Dashboard';
import { DayFacts } from './DayFacts';
import { SiteFrame } from './SiteFrame';

/** A language's home page: the live view, then the day's prices as plain HTML. */
export function Shell({ locale }: { locale: Locale }) {
  const t = dictionaries[locale];
  const { generatedAt } = buildPrices();
  return (
    <SiteFrame locale={locale} route={homeRoute} jsonLd={structuredData(locale, generatedAt)}>
      <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">{t.tagline}</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--muted)] sm:text-base">
        {t.lede}
      </p>
      <div className="mt-8">
        <Dashboard locale={locale} />
      </div>
      <DayFacts locale={locale} days={factsFor(locale)} generatedAt={generatedAt} />
    </SiteFrame>
  );
}
