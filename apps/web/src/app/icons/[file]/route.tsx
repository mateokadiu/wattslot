import { ImageResponse } from 'next/og';
import { iconCard } from '@/lib/og';

export const dynamic = 'force-static';

/** PNG icons for iOS and installed web apps; the maskable one keeps the mark inside the safe zone. */
const ICONS: Record<string, { size: number; padding: number }> = {
  'apple-touch-icon.png': { size: 180, padding: 0 },
  'icon-192.png': { size: 192, padding: 0 },
  'icon-512.png': { size: 512, padding: 0 },
  'icon-maskable-512.png': { size: 512, padding: 64 },
};

export function generateStaticParams() {
  return Object.keys(ICONS).map((file) => ({ file }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { size, padding } = ICONS[(await params).file] ?? { size: 512, padding: 0 };
  return new ImageResponse(await iconCard(size, padding), { width: size, height: size });
}
