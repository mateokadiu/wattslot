'use client';

import { localTime } from '@wattslot/pricing';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  niceTicks,
  type PriceSlot,
  SERIES,
  type Segment,
  stackSlot,
  valueExtent,
  yScale,
} from '@/lib/chart';
import { clock, price } from '@/lib/format';
import type { Dictionary, Locale } from '@/lib/i18n';
import { hourly, type Level, priceLevels, SLOT_MS } from '@/lib/insights';

const HEIGHT = 300;
const PAD = { top: 12, right: 40, bottom: 28, left: 40 };
/** Below this width, 96 quarter-hour bars get too thin to read or tap: show hours instead. */
const HOURLY_BELOW = 640;

export type ChartMode = 'level' | 'breakdown';

interface Props {
  slots: PriceSlot[];
  co2: ReadonlyMap<number, number>;
  highlighted: ReadonlySet<number>;
  nowMs: number;
  timeZone: string;
  unit: string;
  locale: Locale;
  mode: ChartMode;
  t: Dictionary;
}

const levelSegment = (slot: PriceSlot): Segment[] => [
  { series: 'spot', from: Math.min(0, slot.total), to: Math.max(0, slot.total) },
];

export function PriceChart({
  slots,
  co2,
  highlighted,
  nowMs,
  timeZone,
  unit,
  locale,
  mode,
  t,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(300, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const compact = width < HOURLY_BELOW;
  const span = compact ? 4 * SLOT_MS : SLOT_MS;

  const view = useMemo(() => {
    const bars = compact ? hourly(slots) : slots;
    const levels: Map<number, Level> = priceLevels(bars);
    const co2Bars = new Map<number, number>();
    for (const bar of bars) {
      const values = [0, 1, 2, 3]
        .slice(0, compact ? 4 : 1)
        .map((k) => co2.get(bar.startMs + k * SLOT_MS))
        .filter((v): v is number => v !== undefined);
      if (values.length > 0)
        co2Bars.set(bar.startMs, values.reduce((a, b) => a + b, 0) / values.length);
    }
    const lit = new Set(
      bars
        .filter((b) =>
          [0, 1, 2, 3]
            .slice(0, compact ? 4 : 1)
            .some((k) => highlighted.has(b.startMs + k * SLOT_MS)),
        )
        .map((b) => b.startMs),
    );
    const [min, max] = valueExtent(bars);
    const ticks = niceTicks(min, max);
    const y = yScale(ticks, PAD.top, HEIGHT - PAD.bottom);
    const step = (width - PAD.left - PAD.right) / Math.max(1, bars.length);
    const co2Values = [...co2Bars.values()];
    const co2Ticks = co2Values.length > 0 ? niceTicks(0, Math.max(...co2Values), 4) : [];
    const yCo2 = yScale(co2Ticks, PAD.top, HEIGHT - PAD.bottom);
    return { bars, levels, co2Bars, lit, ticks, y, step, co2Ticks, yCo2 };
  }, [slots, co2, highlighted, width, compact]);

  const { bars, levels, co2Bars, lit, ticks, y, step, co2Ticks, yCo2 } = view;
  const x = (i: number) => PAD.left + i * step;
  const nowIndex = bars.findIndex((b) => nowMs >= b.startMs && nowMs < b.startMs + span);
  const co2Points = bars
    .map((b, i) => {
      const value = co2Bars.get(b.startMs);
      return value === undefined
        ? null
        : `${(x(i) + step / 2).toFixed(1)},${yCo2(value).toFixed(1)}`;
    })
    .filter(Boolean)
    .join(' ');

  const onKey = (event: KeyboardEvent) => {
    if (bars.length === 0) return;
    const current = active ?? Math.max(0, nowIndex);
    if (event.key === 'ArrowRight') setActive(Math.min(bars.length - 1, current + 1));
    else if (event.key === 'ArrowLeft') setActive(Math.max(0, current - 1));
    else if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(bars.length - 1);
    else if (event.key === 'Escape') setActive(null);
    else return;
    event.preventDefault();
  };

  const pick = (clientX: number, rect: DOMRect) => {
    const i = Math.floor((clientX - rect.left - PAD.left) / step);
    setActive(i >= 0 && i < bars.length ? i : null);
  };

  const activeBar = active === null ? null : bars[active];
  const described = activeBar ?? bars[Math.max(0, nowIndex)];
  const range = (b: PriceSlot) =>
    `${clock(b.startMs, timeZone)}–${clock(b.startMs + span, timeZone)}`;
  const valueText = described
    ? `${range(described)}: ${price(described.total, locale)} ${unit}`
    : '';
  const summary = `${t.chartLabel}, ${bars.length} × ${compact ? '60' : '15'} min`;
  const fill = (bar: PriceSlot, segment: Segment) =>
    mode === 'level' ? `var(--${levels.get(bar.startMs) ?? 'normal'})` : `var(--${segment.series})`;

  return (
    <div className="relative">
      <div
        ref={box}
        role="slider"
        tabIndex={0}
        aria-label={t.chartLabel}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, bars.length - 1)}
        aria-valuenow={active ?? Math.max(0, nowIndex)}
        aria-valuetext={valueText}
        data-bars={bars.length}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
        onMouseMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onTouchStart={(e) => {
          const touch = e.touches[0];
          if (touch) pick(touch.clientX, e.currentTarget.getBoundingClientRect());
        }}
        className="touch-pan-y rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <svg width={width} height={HEIGHT} role="img" aria-label={summary} className="block">
          <title>{summary}</title>
          {bars.map((b, i) =>
            lit.has(b.startMs) ? (
              <rect
                key={`h${b.startMs}`}
                x={x(i)}
                y={PAD.top}
                width={step}
                height={HEIGHT - PAD.top - PAD.bottom}
                fill="var(--highlight)"
              />
            ) : null,
          )}
          {ticks.map((tick) => (
            <g key={`t${tick}`}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke={tick === 0 ? 'var(--axis)' : 'var(--grid)'}
              />
              <text
                x={PAD.left - 6}
                y={y(tick) + 4}
                textAnchor="end"
                className="fill-[var(--muted)] font-mono text-[10px]"
              >
                {price(tick, locale)}
              </text>
            </g>
          ))}
          {co2Ticks.slice(1).map((tick) => (
            <text
              key={`c${tick}`}
              x={width - PAD.right + 6}
              y={yCo2(tick) + 4}
              className="fill-[var(--co2)] font-mono text-[10px]"
            >
              {tick}
            </text>
          ))}
          {bars.map((b, i) =>
            (mode === 'level' ? levelSegment(b) : stackSlot(b)).map((segment) => (
              <rect
                // biome-ignore lint/suspicious/noArrayIndexKey: index keys let bars animate to new values when the day or company changes
                key={`${i}${segment.series}`}
                className="bar"
                x={x(i) + (compact ? 1.5 : 0.5)}
                y={y(segment.to)}
                width={Math.max(1, step - (compact ? 3 : 1))}
                height={Math.max(0.5, y(segment.from) - y(segment.to))}
                rx={compact ? 2 : 0.5}
                fill={fill(b, segment)}
                opacity={active === null || active === i ? 1 : 0.45}
              />
            )),
          )}
          {co2Points && (
            <polyline
              points={co2Points}
              fill="none"
              stroke="var(--co2)"
              strokeWidth={1.75}
              strokeLinejoin="round"
              strokeDasharray="4 3"
            />
          )}
          {nowIndex >= 0 && (
            <line
              x1={x(nowIndex) + ((nowMs - (bars[nowIndex]?.startMs ?? 0)) / span) * step}
              x2={x(nowIndex) + ((nowMs - (bars[nowIndex]?.startMs ?? 0)) / span) * step}
              y1={PAD.top - 4}
              y2={HEIGHT - PAD.bottom}
              stroke="var(--foreground)"
              strokeWidth={1.5}
            />
          )}
          {bars.map((b, i) => {
            const local = localTime(b.startMs, timeZone);
            return local.minute === 0 && local.hour % (compact ? 6 : 3) === 0 ? (
              <text
                key={`x${b.startMs}`}
                x={x(i)}
                y={HEIGHT - PAD.bottom + 16}
                className="fill-[var(--muted)] font-mono text-[10px]"
              >
                {String(local.hour).padStart(2, '0')}
              </text>
            ) : null;
          })}
        </svg>
      </div>
      {activeBar && active !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 w-56 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-xs shadow-xl"
          style={{ left: Math.min(width - 232, Math.max(0, x(active) + step + 8)) }}
        >
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono font-medium">{range(activeBar)}</span>
            <span
              className="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase"
              style={{
                background: `var(--${levels.get(activeBar.startMs) ?? 'normal'})`,
                color: 'var(--on-accent)',
              }}
            >
              {t.levels[levels.get(activeBar.startMs) ?? 'normal']}
            </span>
          </div>
          {SERIES.map((series) =>
            Math.abs(activeBar[series]) >= 0.005 ? (
              <div key={series} className="flex justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[var(--muted)]">
                  <span
                    className="inline-block size-2 rounded-sm"
                    style={{ background: `var(--${series})` }}
                  />
                  {t.series[series]}
                </span>
                <span className="font-mono tabular-nums">{price(activeBar[series], locale)}</span>
              </div>
            ) : null,
          )}
          <div className="mt-1 flex justify-between border-t border-[var(--border)] pt-1 font-medium">
            <span>{t.total}</span>
            <span className="font-mono tabular-nums">
              {price(activeBar.total, locale)} {unit}
            </span>
          </div>
          {co2Bars.get(activeBar.startMs) !== undefined && (
            <div className="mt-1 flex justify-between text-[var(--co2)]">
              <span>{t.series.co2}</span>
              <span className="font-mono tabular-nums">
                {Math.round(co2Bars.get(activeBar.startMs) ?? 0)}
              </span>
            </div>
          )}
        </div>
      )}
      {compact && <p className="mt-1 text-[11px] text-[var(--muted)]">{t.hourlyNote}</p>}
    </div>
  );
}
