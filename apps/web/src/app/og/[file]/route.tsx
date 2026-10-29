import { ImageResponse } from 'next/og';
import { LOCALES, type Locale } from '@/lib/i18n';
import { ogFonts, ShareCard } from '@/lib/og';

export const dynamic = 'force-static';

export function generateStaticParams() {
  return Object.keys(LOCALES).map((locale) => ({ file: `${locale}.png` }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const locale = (await params).file.replace(/\.png$/, '') as Locale;
  return new ImageResponse(<ShareCard locale={locale} />, {
    width: 1200,
    height: 630,
    fonts: await ogFonts(),
  });
}
