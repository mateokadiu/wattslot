/**
 * Prices are integer micro-units per kWh (1 DKK = 1_000_000). Summing six components over
 * 96 slots in floating point drifts; integers don't.
 */
export type Micro = number;

export const MICRO_PER_UNIT = 1_000_000;
const MICRO_PER_ORE = 10_000;

/** Round half away from zero, so `round(-x) === -round(x)` and refunds mirror charges. */
export function roundHalfAwayFromZero(value: number): number {
  const rounded = Math.sign(value) * Math.round(Math.abs(value));
  return rounded === 0 ? 0 : rounded; // no -0
}

function checked(value: number): Micro {
  if (!Number.isSafeInteger(value)) throw new RangeError(`price out of range: ${value}`);
  return value;
}

/** DKK (or EUR) per kWh → micro-units per kWh. */
export function toMicro(perKwh: number): Micro {
  return checked(roundHalfAwayFromZero(perKwh * MICRO_PER_UNIT));
}

/** Day-ahead prices are published per MWh; 1 DKK/MWh = 1,000 micro-DKK/kWh. */
export function perMwhToMicroPerKwh(perMwh: number): Micro {
  return checked(roundHalfAwayFromZero(perMwh * 1000));
}

export function fromMicro(value: Micro): number {
  return value / MICRO_PER_UNIT;
}

/** Applies a rate in basis points (2500 = 25%), rounding to the nearest micro-unit. */
export function applyRate(amount: Micro, rateBasisPoints: number): Micro {
  if (!Number.isInteger(rateBasisPoints) || rateBasisPoints < 0 || rateBasisPoints > 10_000) {
    throw new RangeError(`rate must be 0–10000 basis points, got ${rateBasisPoints}`);
  }
  return checked(roundHalfAwayFromZero((amount * rateBasisPoints) / 10_000));
}

/** Whole øre (1/100 DKK) for display. */
export function toOre(value: Micro): number {
  return roundHalfAwayFromZero(value / MICRO_PER_ORE);
}
