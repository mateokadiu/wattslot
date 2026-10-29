import type { Metadata, Viewport } from 'next';
import { dictionaries, LOCALES, type Locale } from './i18n';
import { alternates, type Route } from './routes';
import { languageAlternates, ogImagePath, SITE_URL } from './site';

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f6f3' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0d0f' },
  ],
};

export function metadataFor(locale: Locale): Metadata {
  const t = dictionaries[locale];
  const { path, og } = LOCALES[locale];
  const image = { url: ogImagePath(locale), width: 1200, height: 630, alt: t.tagline };
  return {
    title: t.metaTitle,
    description: t.metaDescription,
    metadataBase: new URL(SITE_URL),
    manifest: '/manifest.webmanifest',
    icons: {
      icon: { url: '/icon.svg', type: 'image/svg+xml' },
      apple: '/icons/apple-touch-icon.png',
    },
    alternates: { canonical: path, languages: languageAlternates() },
    openGraph: {
      type: 'website',
      siteName: 'wattslot',
      title: t.metaTitle,
      description: t.metaDescription,
      locale: og,
      alternateLocale: Object.values(LOCALES)
        .map((l) => l.og)
        .filter((o) => o !== og),
      url: path,
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title: t.metaTitle,
      description: t.metaDescription,
      images: [image],
    },
  };
}

/** Metadata for a page below a home page: its own title, canonical and language twins. */
export function pageMetadata(
  locale: Locale,
  route: Route,
  title: string,
  description: string,
  type: 'website' | 'article' = 'website',
): Metadata {
  const path = route.paths[locale] ?? LOCALES[locale].path;
  const image = {
    url: ogImagePath(locale),
    width: 1200,
    height: 630,
    alt: dictionaries[locale].tagline,
  };
  return {
    title,
    description,
    alternates: { canonical: path, languages: alternates(route) },
    openGraph: {
      type,
      siteName: 'wattslot',
      title,
      description,
      locale: LOCALES[locale].og,
      url: path,
      images: [image],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}
