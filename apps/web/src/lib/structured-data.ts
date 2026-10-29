import { dictionaries, LOCALES, type Locale } from './i18n';
import { AUTHOR, absolute, ogImagePath, pageUrl } from './site';

const WEBSITE_ID = absolute('/#website');
const DATASET_ID = absolute('/#prices');

/**
 * schema.org graph for a language's page: the site, the app on this page, the price data it
 * publishes, and its author (the same Person node as on mateokadiu.com).
 */
export function structuredData(locale: Locale) {
  const t = dictionaries[locale];
  const url = pageUrl(locale);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': WEBSITE_ID,
        url: pageUrl('en'),
        name: 'wattslot',
        inLanguage: Object.keys(LOCALES),
        publisher: { '@id': AUTHOR.id },
      },
      {
        '@type': 'WebApplication',
        '@id': `${url}#app`,
        name: 'wattslot',
        url,
        description: t.metaDescription,
        inLanguage: locale,
        image: absolute(ogImagePath(locale)),
        applicationCategory: 'UtilitiesApplication',
        operatingSystem: 'Any',
        browserRequirements: 'Requires JavaScript',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: 0, priceCurrency: 'DKK' },
        license: 'https://www.gnu.org/licenses/agpl-3.0.html',
        isPartOf: { '@id': WEBSITE_ID },
        author: { '@id': AUTHOR.id },
      },
      {
        '@type': 'Dataset',
        '@id': DATASET_ID,
        name: 'All-in Danish electricity prices per 15 minutes',
        description:
          'Consumer electricity prices for Denmark (DK1 and DK2) for every 15-minute slot: day-ahead spot price, the grid company’s time-of-use tariff, Energinet’s tariffs, electricity tax and VAT, calculated by wattslot from Energinet’s data for 31 grid companies. Spot prices only for Germany, Norway (NO2) and Sweden (SE3, SE4).',
        url: pageUrl('en'),
        keywords: [
          'electricity price',
          'elpris',
          'spot price',
          'grid tariff',
          'nettarif',
          'Denmark',
        ],
        license: 'https://creativecommons.org/licenses/by/4.0/',
        creditText: 'Source: Energinet (energidataservice.dk); prices calculated by wattslot.',
        isAccessibleForFree: true,
        isBasedOn: [
          'https://api.energidataservice.dk/meta/dataset/DayAheadPrices',
          'https://api.energidataservice.dk/meta/dataset/DatahubPricelist',
        ],
        creator: { '@id': AUTHOR.id },
        spatialCoverage: { '@type': 'Place', name: 'Denmark' },
        temporalCoverage: '2026-10-28/..',
        variableMeasured: 'Electricity price per kWh including tariffs, taxes and VAT (DKK)',
        distribution: {
          '@type': 'DataDownload',
          encodingFormat: 'application/json',
          contentUrl: absolute('/v1/prices?zone=DK2'),
        },
      },
      { '@type': 'Person', '@id': AUTHOR.id, name: AUTHOR.name, url: AUTHOR.url },
    ],
  };
}

/** JSON for a <script type="application/ld+json">, safe to inline in HTML. */
export const jsonLdScript = (data: unknown): string =>
  JSON.stringify(data).replace(/</g, '\\u003c');
