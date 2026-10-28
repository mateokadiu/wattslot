import { type Micro, toMicro } from './money.js';
import type { LocalTime } from './time.js';

/**
 * One validity period of one per-kWh charge (grid tariff, Energinet tariff, electricity tax).
 * Validity is local wall-clock time, exactly as DataHub publishes it.
 */
export interface Charge {
  ownerGln: string;
  code: string;
  /** Inclusive, `YYYY-MM-DDTHH:mm:ss` local time. */
  validFrom: string;
  /** Exclusive; null = open-ended. */
  validTo: string | null;
  /** Price for each local hour 00–23. */
  hourly: readonly Micro[];
  /**
   * Optional charges (time-limited discounts) count as zero when no period covers the slot.
   * Required charges throw instead, because a gap means our data is stale.
   */
  optional?: boolean;
}

export interface ChargeInDkk {
  ownerGln: string;
  code: string;
  validFrom: string;
  validTo: string | null;
  hourlyDkkPerKwh: readonly number[];
}

export interface ChargeOptions {
  optional?: boolean;
}

const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

export function chargeFromDkk(c: ChargeInDkk, options: ChargeOptions = {}): Charge {
  if (c.hourlyDkkPerKwh.length !== 24) {
    throw new RangeError(`${c.code}: expected 24 hourly prices, got ${c.hourlyDkkPerKwh.length}`);
  }
  for (const v of [c.validFrom, c.validTo]) {
    if (v !== null && !WALL_CLOCK.test(v)) throw new RangeError(`${c.code}: bad validity ${v}`);
  }
  if (c.validTo !== null && c.validTo <= c.validFrom) {
    throw new RangeError(`${c.code}: validTo ${c.validTo} is not after validFrom ${c.validFrom}`);
  }
  return {
    ownerGln: c.ownerGln,
    code: c.code,
    validFrom: c.validFrom,
    validTo: c.validTo,
    hourly: c.hourlyDkkPerKwh.map(toMicro),
    ...(options.optional ? { optional: true } : {}),
  };
}

export class MissingChargeError extends Error {
  constructor(
    readonly ownerGln: string,
    readonly code: string,
    readonly at: string,
  ) {
    super(`no ${ownerGln}/${code} charge valid at ${at}`);
    this.name = 'MissingChargeError';
  }
}

export interface Validity {
  validFrom: string;
  validTo: string | null;
}

/**
 * The period in force at a local wall-clock time. DataHub records a price change as a new
 * period that overrides earlier ones from its start, so periods can overlap (a yearly row plus
 * seasonal rows inside it): the one that started most recently wins.
 */
export function periodAt<T extends Validity>(periods: readonly T[], wallClock: string): T | null {
  let current: T | null = null;
  for (const p of periods) {
    if (p.validFrom <= wallClock && (p.validTo === null || wallClock < p.validTo)) {
      if (current === null || p.validFrom > current.validFrom) current = p;
    }
  }
  return current;
}

/**
 * Sum of every distinct charge (owner + code) at a local time, using the period in force for
 * each. A required charge with no period in force means our data is stale, which must never
 * silently price as zero. An optional charge (a discount that has ended) contributes zero.
 */
export function sumCharges(charges: readonly Charge[], at: LocalTime): Micro {
  const groups = new Map<string, Charge[]>();
  for (const c of charges) {
    const key = `${c.ownerGln}/${c.code}`;
    const group = groups.get(key);
    if (group) group.push(c);
    else groups.set(key, [c]);
  }

  let total = 0;
  for (const group of groups.values()) {
    const current = periodAt(group, at.wallClock);
    if (current === null) {
      const first = group[0] as Charge;
      if (group.every((c) => c.optional)) continue;
      throw new MissingChargeError(first.ownerGln, first.code, at.wallClock);
    }
    total += current.hourly[at.hour] as Micro;
  }
  return total;
}
