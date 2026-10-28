'use client';

import { localTime } from '@wattslot/pricing';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { niceTicks, type PriceSlot, SERIES, stackSlot, valueExtent, yScale } from '@/lib/chart';
import { clock, price } from '@/lib/format';
import type { Dictionary, Locale } from '@/lib/i18n';

const HEIGHT = 300;
const PAD = { top: 12, right: 44, bottom: 28, left: 44 };

interface Props {
  slots: PriceSlot[];
  co2: ReadonlyMap<number, number>;
  highlighted: ReadonlySet<number>;
  nowMs: number;
  timeZone: string;
  unit: string;
  locale: Locale;
  t: Dictionary;
}

export function PriceChart({ slots, co2, highlighted, nowMs, timeZone, unit, locale, t }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(320, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => {
    const [min, max] = valueExtent(slots);
    const ticks = niceTicks(min, max);
    const y = yScale(ticks, PAD.top, HEIGHT - PAD.bottom);
    const plotWidth = width - PAD.left - PAD.right;
    const step = plotWidth / Math.max(1, slots.length);
    const co2Values = slots
      .map((s) => co2.get(s.startMs))
      .filter((v): v is number => v !== undefined);
    const co2Ticks = co2Values.length > 0 ? niceTicks(0, Math.max(...co2Values), 4) : [];
    const yCo2 = yScale(co2Ticks, PAD.top, HEIGHT - PAD.bottom);
    return { ticks, y, step, co2Ticks, yCo2 };
  }, [slots, co2, width]);

  const { ticks, y, step, co2Ticks, yCo2 } = geometry;
  const x = (i: number) => PAD.left + i * step;
  const nowIndex = slots.findIndex((s) => nowMs >= s.startMs && nowMs < s.startMs + 900_000);
  const co2Points = slots
    .map((s, i) => {
      const value = co2.get(s.startMs);
      return value === undefined
        ? null
        : `${(x(i) + step / 2).toFixed(1)},${yCo2(value).toFixed(1)}`;
    })
    .filter(Boolean)
    .join(' ');

  const onKey = (event: KeyboardEvent) => {
    if (slots.length === 0) return;
    const current = active ?? Math.max(0, nowIndex);
    if (event.key === 'ArrowRight') setActive(Math.min(slots.length - 1, current + 1));
    else if (event.key === 'ArrowLeft') setActive(Math.max(0, current - 1));
    else if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(slots.length - 1);
    else if (event.key === 'Escape') setActive(null);
    else return;
    event.preventDefault();
  };

  const activeSlot = active === null ? null : slots[active];
  const described = activeSlot ?? slots[Math.max(0, nowIndex)];
  const valueText = described
    ? `${clock(described.startMs, timeZone)}: ${price(described.total, locale)} ${unit}`
    : '';
  const cheapestCount = highlighted.size;
  const summary = `${t.chartLabel}: ${slots.length} × 15 min, ${clock(slots[0]?.startMs ?? 0, timeZone)}–${clock((slots.at(-1)?.startMs ?? 0) + 900_000, timeZone)}`;

  return (
    <div className="relative">
      <div
        ref={box}
        role="slider"
        tabIndex={0}
        aria-label={t.chartLabel}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, slots.length - 1)}
        aria-valuenow={active ?? Math.max(0, nowIndex)}
        aria-valuetext={valueText}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const i = Math.floor((event.clientX - rect.left - PAD.left) / step);
          setActive(i >= 0 && i < slots.length ? i : null);
        }}
        className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        aria-describedby="chart-help"
      >
        <svg width={width} height={HEIGHT} role="img" aria-label={summary} className="block">
          <title>{summary}</title>
          {slots.map((s, i) =>
            highlighted.has(s.startMs) ? (
              <rect
                key={`h${s.startMs}`}
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
                className="fill-[var(--muted)] text-[10px]"
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
              className="fill-[var(--co2)] text-[10px]"
            >
              {tick}
            </text>
          ))}
          {slots.map((s, i) =>
            stackSlot(s).map((segment) => (
              <rect
                key={`${s.startMs}${segment.series}`}
                x={x(i) + 0.5}
                y={y(segment.to)}
                width={Math.max(1, step - 1)}
                height={Math.max(0.5, y(segment.from) - y(segment.to))}
                fill={`var(--${segment.series})`}
                opacity={active === null || active === i ? 1 : 0.55}
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
            />
          )}
          {nowIndex >= 0 && (
            <line
              x1={x(nowIndex) + ((nowMs - (slots[nowIndex]?.startMs ?? 0)) / 900_000) * step}
              x2={x(nowIndex) + ((nowMs - (slots[nowIndex]?.startMs ?? 0)) / 900_000) * step}
              y1={PAD.top}
              y2={HEIGHT - PAD.bottom}
              stroke="var(--foreground)"
              strokeDasharray="3 3"
            />
          )}
          {slots.map((s, i) => {
            const local = localTime(s.startMs, timeZone);
            return local.minute === 0 && local.hour % 3 === 0 ? (
              <text
                key={`x${s.startMs}`}
                x={x(i)}
                y={HEIGHT - PAD.bottom + 16}
                className="fill-[var(--muted)] text-[10px]"
              >
                {String(local.hour).padStart(2, '0')}
              </text>
            ) : null;
          })}
        </svg>
      </div>
      <p id="chart-help" className="sr-only">
        {`${unit}. ${cheapestCount > 0 ? `${t.cheapest}: ${cheapestCount} × 15 min. ` : ''}Arrow keys move between quarter hours.`}
      </p>
      {activeSlot && active !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 w-52 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-xs shadow-lg"
          style={{ left: Math.min(width - 216, Math.max(0, x(active) + step + 8)) }}
          aria-live="polite"
        >
          <div className="mb-1 font-medium">
            {clock(activeSlot.startMs, timeZone)}–{clock(activeSlot.startMs + 900_000, timeZone)}
          </div>
          {SERIES.map((series) =>
            activeSlot[series] !== 0 ? (
              <div key={series} className="flex justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[var(--muted)]">
                  <span
                    className="inline-block size-2 rounded-sm"
                    style={{ background: `var(--${series})` }}
                  />
                  {t.series[series]}
                </span>
                <span className="tabular-nums">{price(activeSlot[series], locale)}</span>
              </div>
            ) : null,
          )}
          <div className="mt-1 flex justify-between border-t border-[var(--border)] pt-1 font-medium">
            <span>{t.total}</span>
            <span className="tabular-nums">
              {price(activeSlot.total, locale)} {unit}
            </span>
          </div>
          {co2.get(activeSlot.startMs) !== undefined && (
            <div className="mt-1 flex justify-between text-[var(--co2)]">
              <span>{t.series.co2}</span>
              <span className="tabular-nums">{Math.round(co2.get(activeSlot.startMs) ?? 0)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
