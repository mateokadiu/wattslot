import { LOCALES, type Locale } from './i18n';

/** Absolute base for canonical, language and share links; set at build time for other hosts. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wattslot.mateokadiu.com';

export const REPO_URL = 'https://github.com/mateokadiu/wattslot';

/** The author's site publishes the same Person node, so both sites describe one person. */
export const AUTHOR = {
  id: 'https://mateokadiu.com/#person',
  name: 'Mateo Kadiu',
  url: 'https://mateokadiu.com/',
};

export const absolute = (path: string): string => new URL(path, SITE_URL).toString();

export const pageUrl = (locale: Locale): string => absolute(LOCALES[locale].path);

/** Share image for a language, rendered at build time by app/og/[file]. */
export const ogImagePath = (locale: Locale): string => `/og/${locale}.png`;

/** hreflang → absolute URL for every language, plus the default. */
export const languageAlternates = (): Record<string, string> => ({
  ...Object.fromEntries(
    (Object.keys(LOCALES) as Locale[]).map((locale) => [locale, pageUrl(locale)]),
  ),
  'x-default': pageUrl('en'),
});
