import type { Metadata, Viewport } from 'next';
import { dictionaries, LOCALES, type Locale } from './i18n';

/** Absolute base for canonical and language links; set at build time for other hosts. */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wattslot.mateokadiu.com';

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f6f3' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0d0f' },
  ],
};

const languages = {
  ...Object.fromEntries(Object.entries(LOCALES).map(([lang, l]) => [lang, l.path])),
  'x-default': LOCALES.en.path,
};

export function metadataFor(locale: Locale): Metadata {
  const t = dictionaries[locale];
  const { path, og } = LOCALES[locale];
  return {
    title: t.metaTitle,
    description: t.lede,
    metadataBase: new URL(SITE_URL),
    manifest: '/manifest.webmanifest',
    icons: { icon: '/icon.svg' },
    alternates: { canonical: path, languages },
    openGraph: { type: 'website', siteName: 'wattslot', locale: og, url: path },
  };
}
