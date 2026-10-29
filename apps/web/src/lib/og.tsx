import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PriceSlot } from './chart';
import { dictionaries, type Locale } from './i18n';
import { priceLevels } from './insights';

// Build-time images (share cards and PNG icons). Rendered by next/og during `next build`;
// nothing here runs in the browser or the Worker.

const COLORS = {
  background: '#0c0d0f',
  foreground: '#fafafa',
  muted: '#a1a1a1',
  cheap: '#2fc183',
  normal: '#eba941',
  expensive: '#f4514f',
};

/** All-in DK2 prices with Radius Elnet's tariff, 28 Oct 2026: a typical day's shape. */
const SAMPLE_DAY = [
  1.6578, 1.6703, 1.6923, 1.7025, 1.717, 1.7182, 1.7239, 1.7564, 1.7338, 1.7563, 1.8024, 1.8098,
  1.8021, 1.8085, 1.8175, 1.858, 1.8589, 1.9009, 1.8973, 1.9021, 1.806, 1.8587, 1.9264, 1.9805,
  2.4846, 2.5654, 2.6525, 2.8953, 3.0533, 3.0983, 3.0262, 3.1031, 3.2038, 3.2162, 3.1101, 2.8745,
  2.9495, 2.7964, 2.6464, 2.5569, 2.6865, 2.6226, 2.4802, 2.3846, 2.5379, 2.5364, 2.4252, 2.3722,
  2.4114, 2.3781, 2.3645, 2.3484, 2.3546, 2.3407, 2.3336, 2.2933, 2.2828, 2.3482, 2.4345, 2.4908,
  2.3517, 2.4854, 2.7797, 3.1115, 2.75, 3.0711, 3.3468, 3.4565, 4.0373, 4.1075, 4.1372, 4.1462,
  4.3457, 4.3191, 4.1106, 4.0575, 4.1106, 4.1154, 3.9696, 3.8821, 4.1347, 4.1365, 4.0834, 3.7492,
  3.26, 3.037, 2.827, 2.6602, 2.8538, 2.7605, 2.6551, 2.5832, 2.6268, 2.5616, 2.6158, 2.5587,
];

const font = (file: string) =>
  readFile(join(process.cwd(), 'node_modules/geist/dist/fonts', file)).then((b) => b.buffer);

export async function ogFonts() {
  const [sans, mono] = await Promise.all([
    font('geist-sans/Geist-SemiBold.ttf'),
    font('geist-mono/GeistMono-SemiBold.ttf'),
  ]);
  return [
    { name: 'Geist', data: sans as ArrayBuffer, weight: 600 as const, style: 'normal' as const },
    {
      name: 'Geist Mono',
      data: mono as ArrayBuffer,
      weight: 600 as const,
      style: 'normal' as const,
    },
  ];
}

/** 1200 × 630 share card: name, the language's tagline, what's added up, and a day's prices. */
export function ShareCard({ locale }: { locale: Locale }) {
  const t = dictionaries[locale];
  const slots: PriceSlot[] = SAMPLE_DAY.map((total, i) => ({
    startMs: i,
    spot: 0,
    gridTariff: 0,
    tsoTariffs: 0,
    electricityTax: 0,
    vat: 0,
    total,
  }));
  const levels = priceLevels(slots);
  const max = Math.max(...SAMPLE_DAY);
  const parts = [
    t.series.spot,
    t.series.gridTariff,
    t.series.tsoTariffs,
    t.series.electricityTax,
    t.series.vat,
  ];
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: COLORS.background,
        color: COLORS.foreground,
        padding: '64px 72px 56px',
        fontFamily: 'Geist',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', fontFamily: 'Geist Mono', fontSize: 40 }}>
          watt<span style={{ color: COLORS.cheap }}>slot</span>
        </div>
        <div
          style={{ display: 'flex', fontFamily: 'Geist Mono', fontSize: 24, color: COLORS.muted }}
        >
          wattslot.mateokadiu.com
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: 48,
          fontSize: 62,
          lineHeight: 1.1,
          letterSpacing: -1.5,
          maxWidth: 1000,
        }}
      >
        {t.tagline}
      </div>
      <div style={{ display: 'flex', marginTop: 20, fontSize: 26, color: COLORS.muted }}>
        {parts.join(' + ')}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 2,
          marginTop: 'auto',
          height: 170,
        }}
      >
        {SAMPLE_DAY.map((total, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed sample, one bar per quarter hour
            key={i}
            style={{
              flex: 1,
              height: `${(total / max) * 100}%`,
              borderRadius: 2,
              background: COLORS[levels.get(i) ?? 'normal'],
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** The SVG favicon on a square, opaque background (iOS fills transparent corners with black). */
export async function iconCard(size: number, padding: number) {
  const svg = await readFile(join(process.cwd(), 'public/icon.svg'));
  const src = `data:image/svg+xml;base64,${svg.toString('base64')}`;
  const inner = size - padding * 2;
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: COLORS.background,
      }}
    >
      {/* biome-ignore lint/performance/noImgElement: rendered to a PNG at build time, not a page */}
      <img src={src} width={inner} height={inner} alt="" />
    </div>
  );
}
