import type { MetadataRoute } from 'next';
import { LOCALES, type Locale } from '@/lib/i18n';
import { languageAlternates, pageUrl } from '@/lib/site';

export const dynamic = 'force-static';

/** Every page in every language, each listing all its translations. */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const languages = languageAlternates();
  return (Object.keys(LOCALES) as Locale[]).map((locale) => ({
    url: pageUrl(locale),
    lastModified,
    alternates: { languages },
  }));
}
