import type { MetadataRoute } from 'next';
import { LOCALES, type Locale } from '@/lib/i18n';
import { buildPrices } from '@/lib/load-facts';
import { languageAlternates, pageUrl } from '@/lib/site';

export const dynamic = 'force-static';

/** Every page in every language, each listing all its translations. */
export default function sitemap(): MetadataRoute.Sitemap {
  // Pages change with each day's prices, so they're as new as the prices they were built with.
  const lastModified = new Date(buildPrices().generatedAt);
  const languages = languageAlternates();
  return (Object.keys(LOCALES) as Locale[]).map((locale) => ({
    url: pageUrl(locale),
    lastModified,
    alternates: { languages },
  }));
}
