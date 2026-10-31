import type { OutageKind } from '@/lib/api';

// Text for the outage page and the outage blocks on grid company pages (Danish and English).

export interface OutageText {
  title: string;
  description: string;
  heading: string;
  intro: string;
  postcodeLabel: string;
  postcodeHint: string;
  postcodeHelp: string;
  yours: (name: string) => string;
  postcode: (code: string) => string;
  all: string;
  planned: string;
  plannedHint: string;
  kinds: Record<OutageKind, string>;
  restored: string;
  customers: (n: number) => string;
  since: (when: string) => string;
  expected: (when: string) => string;
  back: (when: string) => string;
  window: (from: string, to: string) => string;
  none: string;
  noneFor: string;
  plannedNone: string;
  more: (n: number) => string;
  loading: string;
  error: string;
  paused: string;
  stale: (when: string) => string;
  updated: (when: string) => string;
  source: string;
  whatToDo: string;
  steps: string[];
  companiesHeading: string;
  columns: { company: string; phone: string; page: string; reports: string };
  yes: string;
  no: string;
  open: string;
  blockHeading: string;
  faultLine: string;
  companyPage: string;
  silent: (name: string) => string;
  allOutages: string;
}

export const OUTAGES_TEXT: Record<'en' | 'da', OutageText> = {
  en: {
    title: 'Power outages in Denmark now | wattslot',
    description:
      'Current power outages and planned work from all Danish grid companies in one list, updated every 5 minutes, with each grid company’s fault line.',
    heading: 'Power outages now',
    intro:
      'Current outages and planned work in the grid, as the Danish grid companies report them. Updated every 5 minutes.',
    postcodeLabel: 'Your postcode',
    postcodeHint: 'e.g. 2100',
    postcodeHelp: 'Saved in this browser only.',
    yours: (name) => `Your grid company: ${name}`,
    postcode: (code) => `Postcode ${code}`,
    all: 'All current outages',
    planned: 'Planned work',
    plannedHint: 'Enter your postcode or choose your grid company to see planned work near you.',
    kinds: {
      unplanned: 'Unplanned outage',
      announced: 'Announced outage',
      planned: 'Planned work',
      notice: 'Service notice',
    },
    restored: 'Power restored',
    customers: (n) => `${n.toLocaleString('en-GB')} ${n === 1 ? 'customer' : 'customers'}`,
    since: (when) => `since ${when}`,
    expected: (when) => `expected back ${when}`,
    back: (when) => `back ${when}`,
    window: (from, to) => `${from} – ${to}`,
    none: 'No current power outages are reported.',
    noneFor: 'No current outages reported here.',
    plannedNone: 'No planned work in the next 30 days.',
    more: (n) => `Show ${n} more`,
    loading: 'Fetching outages…',
    error: 'Couldn’t fetch outages. Try again in a moment.',
    paused: 'The outage overview is paused right now.',
    stale: (when) => `The latest data is from ${when} and may be out of date.`,
    updated: (when) => `Updated ${when}`,
    source:
      'Source: the grid companies via Green Power Denmark (elnet.dk). Indicative — the grid companies update it themselves.',
    whatToDo: 'What to do in a power outage',
    steps: [
      'Check your fuse board first: if a fuse or the residual-current device (HPFI) has tripped, the fault is in your home, not the grid.',
      'If your neighbours are out too, look for your postcode above.',
      'Call your grid company’s fault line, not your electricity supplier. You’ll find it below.',
      'Planned work is announced to affected homes by letter or text message. If you have solar panels, you may be asked to switch off the inverter during the work.',
    ],
    companiesHeading: 'Grid companies’ fault lines',
    columns: {
      company: 'Grid company',
      phone: 'Fault line',
      page: 'Outage page',
      reports: 'On this list',
    },
    yes: 'Yes',
    no: 'No',
    open: 'Open',
    blockHeading: 'Power outages',
    faultLine: 'Fault line',
    companyPage: 'Outage page',
    silent: (name) =>
      `${name} doesn’t report outages to the shared overview. See the company’s own page or call its fault line.`,
    allOutages: 'All power outages in Denmark',
  },
  da: {
    title: 'Strømafbrud lige nu – hele Danmark | wattslot',
    description:
      'Aktuelle strømafbrud og planlagt arbejde fra alle danske netselskaber samlet ét sted, opdateret hvert 5. minut – med netselskabernes fejlnumre.',
    heading: 'Strømafbrud lige nu',
    intro:
      'Aktuelle afbrud og planlagt arbejde i elnettet, som netselskaberne melder dem. Opdateres hvert 5. minut.',
    postcodeLabel: 'Dit postnummer',
    postcodeHint: 'fx 2100',
    postcodeHelp: 'Gemmes kun i denne browser.',
    yours: (name) => `Dit netselskab: ${name}`,
    postcode: (code) => `Postnummer ${code}`,
    all: 'Alle aktuelle afbrud',
    planned: 'Planlagt arbejde',
    plannedHint:
      'Skriv dit postnummer eller vælg dit netselskab for at se planlagt arbejde nær dig.',
    kinds: {
      unplanned: 'Uvarslet afbrud',
      announced: 'Varslet afbrud',
      planned: 'Planlagt arbejde',
      notice: 'Driftsinformation',
    },
    restored: 'Strømmen er tilbage',
    customers: (n) => `${n.toLocaleString('da-DK')} ${n === 1 ? 'kunde' : 'kunder'}`,
    since: (when) => `siden ${when}`,
    expected: (when) => `forventes tilbage ${when}`,
    back: (when) => `tilbage ${when}`,
    window: (from, to) => `${from} – ${to}`,
    none: 'Der er ingen aktuelle strømafbrud meldt.',
    noneFor: 'Ingen aktuelle afbrud meldt her.',
    plannedNone: 'Intet planlagt arbejde de næste 30 dage.',
    more: (n) => `Vis ${n} mere`,
    loading: 'Henter strømafbrud…',
    error: 'Kunne ikke hente strømafbrud. Prøv igen om lidt.',
    paused: 'Afbrudsoversigten er sat på pause lige nu.',
    stale: (when) => `De seneste data er fra ${when} og kan være forældede.`,
    updated: (when) => `Opdateret ${when}`,
    source:
      'Kilde: netselskaberne via Green Power Denmark (elnet.dk). Vejledende – netselskaberne opdaterer selv.',
    whatToDo: 'Det gør du ved strømafbrud',
    steps: [
      'Tjek først dit eltavle: Er en sikring eller HPFI-relæet slået fra, er fejlen i din bolig og ikke i elnettet.',
      'Har naboerne heller ikke strøm, så find dit postnummer ovenfor.',
      'Ring til dit netselskabs fejlnummer – ikke til dit elselskab. Du finder det nedenfor.',
      'Planlagt arbejde varsles med brev eller sms til de berørte. Har du solceller, kan du blive bedt om at slukke for inverteren under arbejdet.',
    ],
    companiesHeading: 'Netselskabernes fejlnumre',
    columns: {
      company: 'Netselskab',
      phone: 'Fejlnummer',
      page: 'Afbrudsside',
      reports: 'På listen',
    },
    yes: 'Ja',
    no: 'Nej',
    open: 'Åbn',
    blockHeading: 'Strømafbrud',
    faultLine: 'Fejlnummer',
    companyPage: 'Afbrudsside',
    silent: (name) =>
      `${name} melder ikke afbrud til den fælles oversigt. Se selskabets egen side, eller ring til fejlnummeret.`,
    allOutages: 'Alle strømafbrud i Danmark',
  },
};
