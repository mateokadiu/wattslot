import type { Metadata, Viewport } from 'next';
import { dictionaries, type Locale } from './i18n';

/** Absolute base for canonical and language links; set at build time for other hosts. */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wattslot.mateokadiu.com';

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f6f3' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0d0f' },
  ],
};

export function metadataFor(locale: Locale): Metadata {
  const t = dictionaries[locale];
  return {
    title:
      locale === 'da'
        ? 'wattslot – elpris kvarter for kvarter'
        : 'wattslot – electricity prices every 15 minutes',
    description: t.lede,
    metadataBase: new URL(SITE_URL),
    manifest: '/manifest.webmanifest',
    icons: { icon: '/icon.svg' },
    alternates: {
      canonical: locale === 'da' ? '/da/' : '/',
      languages: { en: '/', da: '/da/', 'x-default': '/' },
    },
    openGraph: {
      type: 'website',
      siteName: 'wattslot',
      locale: locale === 'da' ? 'da_DK' : 'en_GB',
      url: locale === 'da' ? '/da/' : '/',
    },
  };
}
