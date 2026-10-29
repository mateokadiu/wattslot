// Text for the price-area, grid-company directory and grid-company pages (Danish and English).

export type AreaCode = 'dk1' | 'dk2';

const pad = (h: number) => String(h).padStart(2, '0');

export const DIRECTORY = {
  en: {
    region: { dk1: 'West Denmark', dk2: 'East Denmark' },
    side: { dk1: 'west of the Great Belt', dk2: 'east of the Great Belt' },
    regions: { dk1: 'Jutland and Funen', dk2: 'Zealand, Lolland-Falster, Møn and Bornholm' },
    areaTitle: (code: string, region: string) =>
      `Electricity price ${code} today – ${region} | wattslot`,
    areaDescription: (code: string, region: string) =>
      `Electricity prices in ${code} (${region}) today and tomorrow, hour by hour, with grid tariff, tax and VAT included, and the cheapest hours to use power.`,
    areaHeading: (code: string, region: string) => `Electricity prices in ${code} · ${region}`,
    areaIntro: (code: string, side: string, regions: string, company: string) =>
      `${code} is the price area ${side}: ${regions}. The prices below are all-in, with the grid tariff of ${company}, the largest grid company in the area. Choose your own grid company for your exact price.`,
    areaCompanies: (code: string) => `Grid companies in ${code}`,
    live: 'See the live price',
    liveWith: (name: string) => `See the live price with ${name}`,
    hubCrumb: 'Grid companies',
    hubTitle: (year: string) => `Danish grid companies and tariffs ${year} | wattslot`,
    hubDescription: (year: string) =>
      `Every Danish grid company with its ${year} grid tariff by hour: low, high and peak including VAT, largest first. Find yours and see your electricity price.`,
    hubHeading: 'Grid companies and grid tariffs',
    hubIntro:
      'The grid tariff is what your grid company charges to deliver electricity to you. It depends on the time of day: low 00–06, high 06–17 and 21–24, peak 17–21. The table shows the tariff that applies today, including VAT. Your grid company is named on your electricity bill.',
    columns: {
      company: 'Grid company',
      area: 'Area',
      meters: 'Metering points',
      low: 'Low',
      high: 'High',
      peak: 'Peak',
    },
    hubCaption:
      'Grid tariff today, øre per kWh including VAT. Low 00–06, high 06–17 and 21–24, peak 17–21.',
    unsupported: (names: string) => `Not included yet (spot price only): ${names}.`,
    companyTitles: (name: string, year: string) => [
      `${name} grid tariff ${year} and today’s price | wattslot`,
      `${name} grid tariff ${year} | wattslot`,
      `${name} grid tariff ${year}`,
    ],
    bands: (low: string, high: string, peak: string) => `low ${low}, high ${high} and peak ${peak}`,
    flat: (price: string) => `${price} around the clock`,
    companyDescriptions: (name: string, bands: string) => [
      `${name} grid tariff: ${bands} øre/kWh including VAT. See the all-in electricity price today and tomorrow, hour by hour, with tariff, tax and VAT.`,
      `${name} grid tariff: ${bands} øre/kWh including VAT. See the all-in electricity price today and tomorrow, hour by hour.`,
      `${name} grid tariff: ${bands} øre/kWh including VAT. See today’s all-in price by the hour.`,
      `${name} grid tariff: ${bands} øre/kWh including VAT.`,
    ],
    companyHeading: (name: string) => `${name}: grid tariff and electricity price`,
    companyIntro: (name: string, code: string, meters: string, areas: number) =>
      `${name} is a grid company in ${code} with ${meters} metering points${areas > 1 ? ` across ${areas} grid areas` : ''}. Here is its grid tariff by hour, and what electricity costs with it today.`,
    tariffHeading: 'Grid tariff',
    timeOfDay: 'Time of day',
    band: {
      low: 'Low · 00–06',
      high: 'High · 06–17 and 21–24',
      peak: 'Peak · 17–21',
      flat: 'All day',
      hour: (h: number) => `${pad(h)}–${pad(h + 1)}`,
    },
    exclVat: 'excl. VAT',
    inclVat: 'incl. VAT',
    unit: 'øre/kWh',
    period: (from: string, to: string | null) => (to ? `${from} – ${to}` : `From ${from}`),
    allAreas: (codes: string) => `Applies to all its grid areas (${codes}).`,
    otherAreas: (codes: string) =>
      `Grid area ${codes} has a slightly different tariff; the prices here are for the largest area.`,
    noTariff: 'No tariff has been published from today on.',
    source: (codes: string, date: string) =>
      `Source: DataHub price list via Energi Data Service (tariff code ${codes}). Fetched ${date}.`,
  },
  da: {
    region: { dk1: 'Vestdanmark', dk2: 'Østdanmark' },
    side: { dk1: 'vest for Storebælt', dk2: 'øst for Storebælt' },
    regions: { dk1: 'Jylland og Fyn', dk2: 'Sjælland, Lolland-Falster, Møn og Bornholm' },
    areaTitle: (code: string, region: string) => `Elpris ${code} i dag – ${region} | wattslot`,
    areaDescription: (code: string, region: string) =>
      `Elprisen i ${code} (${region}) i dag og i morgen, time for time, inkl. nettarif, elafgift og moms – og de billigste timer at bruge strøm.`,
    areaHeading: (code: string, region: string) => `Elprisen i ${code} · ${region}`,
    areaIntro: (code: string, side: string, regions: string, company: string) =>
      `${code} er prisområdet ${side}: ${regions}. Priserne nedenfor er den fulde pris med nettariffen fra ${company}, det største netselskab i området. Vælg dit eget netselskab for din præcise pris.`,
    areaCompanies: (code: string) => `Netselskaber i ${code}`,
    live: 'Se prisen lige nu',
    liveWith: (name: string) => `Se prisen lige nu med ${name}`,
    hubCrumb: 'Netselskaber',
    hubTitle: (year: string) => `Netselskaber og nettariffer ${year} – sammenlign | wattslot`,
    hubDescription: (year: string) =>
      `Alle danske netselskaber med nettarif pr. time i ${year}: lav, høj og spids inkl. moms, sorteret efter størrelse. Find dit netselskab og se din elpris.`,
    hubHeading: 'Netselskaber og nettariffer',
    hubIntro:
      'Nettariffen er dit netselskabs betaling for at levere strømmen til dig. Den afhænger af tidspunktet: lav kl. 00–06, høj kl. 06–17 og 21–24, spids kl. 17–21. Tabellen viser den tarif, der gælder i dag, inkl. moms. Hvilket netselskab du har, står på din elregning.',
    columns: {
      company: 'Netselskab',
      area: 'Område',
      meters: 'Målepunkter',
      low: 'Lav',
      high: 'Høj',
      peak: 'Spids',
    },
    hubCaption:
      'Nettarif i dag, øre pr. kWh inkl. moms. Lav kl. 00–06, høj kl. 06–17 og 21–24, spids kl. 17–21.',
    unsupported: (names: string) => `Ikke med endnu (kun spotpris): ${names}.`,
    companyTitles: (name: string, year: string) => [
      `${name}: nettarif ${year} og elprisen i dag | wattslot`,
      `${name}: nettarif ${year} | wattslot`,
      `${name}: nettarif ${year}`,
    ],
    bands: (low: string, high: string, peak: string) => `lav ${low}, høj ${high} og spids ${peak}`,
    flat: (price: string) => `${price} hele døgnet`,
    companyDescriptions: (name: string, bands: string) => [
      `Nettarif hos ${name}: ${bands} øre/kWh inkl. moms. Se den fulde elpris i dag og i morgen, time for time, med tarif, afgifter og moms.`,
      `Nettarif hos ${name}: ${bands} øre/kWh inkl. moms. Se den fulde elpris i dag og i morgen, time for time.`,
      `Nettarif hos ${name}: ${bands} øre/kWh inkl. moms. Se dagens fulde elpris time for time.`,
      `Nettarif hos ${name}: ${bands} øre/kWh inkl. moms.`,
    ],
    companyHeading: (name: string) => `Nettarif og elpris hos ${name}`,
    companyIntro: (name: string, code: string, meters: string, areas: number) =>
      `${name} er netselskab i ${code} med ${meters} målepunkter${areas > 1 ? ` fordelt på ${areas} netområder` : ''}. Her er nettariffen pr. time, og hvad strømmen koster med den i dag.`,
    tariffHeading: 'Nettarif',
    timeOfDay: 'Tidsrum',
    band: {
      low: 'Lav · kl. 00–06',
      high: 'Høj · kl. 06–17 og 21–24',
      peak: 'Spids · kl. 17–21',
      flat: 'Hele døgnet',
      hour: (h: number) => `kl. ${pad(h)}–${pad(h + 1)}`,
    },
    exclVat: 'ekskl. moms',
    inclVat: 'inkl. moms',
    unit: 'øre/kWh',
    period: (from: string, to: string | null) => (to ? `${from} – ${to}` : `Fra ${from}`),
    allAreas: (codes: string) => `Gælder alle netområder (${codes}).`,
    otherAreas: (codes: string) =>
      `Netområde ${codes} har en lidt anden tarif; priserne her gælder det største netområde.`,
    noTariff: 'Der er ingen offentliggjort tarif fra i dag og frem.',
    source: (codes: string, date: string) =>
      `Kilde: DataHubs prisliste via Energi Data Service (tarifkode ${codes}). Hentet ${date}.`,
  },
};

/** The first text that fits, for titles and descriptions with a length limit. */
export const firstThatFits = (max: number, candidates: string[]): string =>
  candidates.find((c) => c.length <= max) ?? candidates.at(-1) ?? '';
