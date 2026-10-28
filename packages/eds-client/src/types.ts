export interface DayAheadPrice {
  /** Start of the 15-minute slot, epoch milliseconds (UTC). */
  slotStartMs: number;
  priceArea: string;
  /** Null until EDS has converted the EUR price with the day's exchange rate. */
  dkkPerMwh: number | null;
  eurPerMwh: number;
}

export interface Co2Emission {
  /** Start of the 5-minute interval, epoch milliseconds (UTC). */
  timeMs: number;
  priceArea: string;
  gPerKwh: number;
}

export interface DatahubCharge {
  ownerGln: string;
  ownerName: string | null;
  /** D01 subscription, D02 fee, D03 tariff. */
  chargeType: string;
  code: string;
  note: string | null;
  /** Danish local wall-clock time as published, `YYYY-MM-DDTHH:mm:ss`. */
  validFrom: string;
  validTo: string | null;
  /** DKK/kWh for each local hour 00–23. Flat charges repeat `Price1` in every hour. */
  hourlyDkkPerKwh: number[];
  isTax: boolean;
}
