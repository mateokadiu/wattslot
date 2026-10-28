/** Denmark-specific identifiers from DataHub (Energi Data Service `DatahubPricelist`). */

export const DK_TIME_ZONE = 'Europe/Copenhagen';

export const ENERGINET_GLN = '5790000432752';

/** Per-kWh Energinet tariffs on every consumer bill: transmission net tariff and system tariff. */
export const ENERGINET_CONSUMER_TARIFF_CODES = ['40000', '41000'] as const;

/** Elafgift — published by Energinet in the same dataset, flat per kWh. */
export const ELECTRICITY_TAX_CODE = 'EA-001';

export const DK_VAT_BASIS_POINTS = 2500;
