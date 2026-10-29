import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dayFacts, nextDate, type Quarter } from '../src/lib/facts';
import { clock } from '../src/lib/format';

const TZ = 'Europe/Copenhagen';
const QUARTER = 15 * 60_000;

const recorded = (zone: string): Quarter[] =>
  (
    JSON.parse(
      readFileSync(new URL(`../e2e/fixtures/prices/${zone}.json`, import.meta.url), 'utf8'),
    ) as { slots: { start: string; total: number }[] }
  ).slots.map((s) => ({ startMs: Date.parse(s.start), total: s.total }));

/** `count` quarter hours from `startIso`, priced by `price(i)`. */
const day = (startIso: string, count: number, price = (i: number) => 1 + (i % 7) / 10) =>
  Array.from({ length: count }, (_, i) => ({
    startMs: Date.parse(startIso) + i * QUARTER,
    total: price(i),
  }));

describe('dayFacts', () => {
  it('summarises the worked example day (DK2, Radius, 28 Oct 2026)', () => {
    const facts = dayFacts(recorded('DK2'), '2026-10-28', TZ);
    expect(facts?.hours).toHaveLength(24);
    expect(clock(facts?.cheapest2h?.startMs ?? 0, TZ)).toBe('00:00');
    expect(clock(facts?.cheapest2h?.endMs ?? 0, TZ)).toBe('02:00');
    expect(facts?.cheapest2h?.average).toBeCloseTo(1.7048, 3);
    expect(clock(facts?.priciestHour?.startMs ?? 0, TZ)).toBe('18:00');
    expect(facts?.priciestHour?.average).toBeCloseTo(4.2081, 3);
  });

  it('splits two published days at local midnight', () => {
    const quarters = recorded('DK1');
    expect(dayFacts(quarters, '2026-10-28', TZ)?.hours).toHaveLength(24);
    expect(dayFacts(quarters, '2026-10-29', TZ)?.hours).toHaveLength(24);
    expect(dayFacts(quarters, '2026-10-30', TZ)).toBeNull();
  });

  it('marks a third of the hours cheap and a third expensive', () => {
    const levels = dayFacts(recorded('DK2'), '2026-10-28', TZ)?.hours.map((h) => h.level) ?? [];
    expect(levels.filter((l) => l === 'cheap')).toHaveLength(8);
    expect(levels.filter((l) => l === 'expensive')).toHaveLength(8);
  });

  it('waits for a day to be published in full', () => {
    expect(dayFacts(day('2026-10-27T23:00:00Z', 50), '2026-10-28', TZ)).toBeNull();
  });

  it('has 25 hours when the clocks go back and 23 when they go forward', () => {
    expect(dayFacts(day('2026-10-24T22:00:00Z', 100), '2026-10-25', TZ)?.hours).toHaveLength(25);
    expect(dayFacts(day('2026-03-28T23:00:00Z', 92), '2026-03-29', TZ)?.hours).toHaveLength(23);
  });
});

describe('nextDate', () => {
  it('rolls over months and years', () => {
    expect(nextDate('2026-10-28')).toBe('2026-10-29');
    expect(nextDate('2026-10-31')).toBe('2026-11-01');
    expect(nextDate('2026-12-31')).toBe('2027-01-01');
  });
});
