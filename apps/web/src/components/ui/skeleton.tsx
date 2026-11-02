// Loading placeholders shaped like the content they stand in for, so nothing moves when the data
// arrives. Hidden from assistive technology: each loading area also says "loading" in words.
// The pulse stops for visitors who ask for reduced motion.

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block rounded-md bg-[var(--skeleton)] motion-safe:animate-pulse ${className}`}
    />
  );
}

/** A price chart's worth of bars: a gentle day curve, the same on every render. */
const BAR_HEIGHTS = Array.from({ length: 24 }, (_, h) =>
  Math.max(
    15,
    35 + 25 * Math.sin(((h - 4) / 24) * 2 * Math.PI) + 15 * Math.sin((h / 24) * 6 * Math.PI),
  ),
);

export function ChartSkeleton({ label }: { label: string }) {
  return (
    <div className="flex h-[300px] flex-col justify-end" role="status">
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        className="flex h-full items-end gap-[3px] border-b border-[var(--border)] pb-px"
      >
        {BAR_HEIGHTS.map((height, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed decorative list
            key={i}
            className="flex-1 rounded-t-sm bg-[var(--skeleton)] motion-safe:animate-pulse"
            style={{ height: `${height}%`, animationDelay: `${(i % 6) * 120}ms` }}
          />
        ))}
      </div>
      <div aria-hidden="true" className="mt-2 flex justify-between">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-3 w-8" />
        ))}
      </div>
    </div>
  );
}
