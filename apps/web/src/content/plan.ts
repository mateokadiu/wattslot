import type { Locale } from '@/lib/i18n';
import type { OptionKind } from '@/lib/plan';

// Text for the "Plan" form on the live view, in every language the site is published in.

export interface PlanText {
  open: string;
  title: string;
  intro: string;
  energy: string;
  length: string;
  power: string;
  from: string;
  doneBy: string;
  readyBy: string;
  mayPause: string;
  submit: string;
  planning: string;
  options: string;
  kinds: Record<OptionKind, string>;
  hints: { cheapest: string; balanced: (money: string) => string; greenest: string };
  sameAsAbove: string;
  start: (when: string) => string;
  done: (when: string) => string;
  charge: string;
  co2: (kg: string) => string;
  /** Saving (positive) or extra cost against a baseline, already formatted. */
  vsMidnight: { less: (amount: string) => string; more: (amount: string) => string };
  vsNow: { less: (amount: string) => string; more: (amount: string) => string };
  /** The word for tomorrow; other days use the weekday's name. */
  tomorrow: string;
  /** A time, with the day when it isn't today: "tomorrow 02:45", "morgen um 02:45 Uhr". */
  at: (day: string | null, time: string) => string;
  /** A stretch within one day: "01:00–03:15", "kl. 01:00–03:15", "01:00–03:15 Uhr". */
  span: (day: string | null, from: string, to: string) => string;
  estimated: (when: string) => string;
  spotOnly: string;
  tooShort: string;
  none: string;
  error: string;
  privacy: string;
}

export const PLAN_TEXT: Record<Locale, PlanText> = {
  en: {
    open: 'Plan it',
    title: 'Plan it',
    intro: 'Say when it has to be done, and wattslot finds the best time to run it.',
    energy: 'Energy (kWh)',
    length: 'Programme length',
    power: 'Charging power',
    from: 'Plugged in from',
    doneBy: 'Done by',
    readyBy: 'Ready by',
    mayPause: 'May pause in between',
    submit: 'Find the best time',
    planning: 'Planning…',
    options: 'Options',
    kinds: { cheapest: 'Cheapest', balanced: 'Balanced', greenest: 'Greenest' },
    hints: {
      cheapest: 'Lowest price',
      balanced: (money) => `Counts 1 kg of CO₂ as ${money}`,
      greenest: 'Least CO₂',
    },
    sameAsAbove: 'Same times as above',
    start: (when) => `Start ${when}`,
    done: (when) => `done ${when}`,
    charge: 'Charge',
    co2: (kg) => `${kg} kg CO₂`,
    vsMidnight: {
      less: (amount) => `${amount} less than starting at midnight`,
      more: (amount) => `${amount} more than starting at midnight`,
    },
    vsNow: {
      less: (amount) => `${amount} less than starting now`,
      more: (amount) => `${amount} more than starting now`,
    },
    tomorrow: 'tomorrow',
    at: (day, time) => `${day ? `${day} ` : ''}${time}`,
    span: (day, from, to) => `${day ? `${day} ` : ''}${from}–${to}`,
    estimated: (when) =>
      `Prices from ${when} are estimates based on recent weeks. The real ones are published around 13:00.`,
    spotOnly: 'Spot price only — grid tariffs and taxes aren’t included.',
    tooShort: 'There isn’t enough time for this before then. Choose a later time.',
    none: 'There aren’t enough prices for this window yet.',
    error: 'Couldn’t make a plan. Try again in a moment.',
    privacy: 'Nothing you enter here is saved.',
  },
  da: {
    open: 'Planlæg',
    title: 'Planlæg',
    intro: 'Sig, hvornår det skal være færdigt, så finder wattslot det bedste tidspunkt.',
    energy: 'Energi (kWh)',
    length: 'Programmets længde',
    power: 'Ladeeffekt',
    from: 'Tilsluttet fra kl.',
    doneBy: 'Færdig senest kl.',
    readyBy: 'Klar senest kl.',
    mayPause: 'Må holde pause undervejs',
    submit: 'Find det bedste tidspunkt',
    planning: 'Planlægger…',
    options: 'Muligheder',
    kinds: { cheapest: 'Billigst', balanced: 'Balanceret', greenest: 'Grønnest' },
    hints: {
      cheapest: 'Laveste pris',
      balanced: (money) => `Regner 1 kg CO₂ som ${money}`,
      greenest: 'Mindst CO₂',
    },
    sameAsAbove: 'Samme tider som ovenfor',
    start: (when) => `Start ${when}`,
    done: (when) => `færdig ${when}`,
    charge: 'Lad',
    co2: (kg) => `${kg} kg CO₂`,
    vsMidnight: {
      less: (amount) => `${amount} mindre end at starte ved midnat`,
      more: (amount) => `${amount} mere end at starte ved midnat`,
    },
    vsNow: {
      less: (amount) => `${amount} mindre end at starte nu`,
      more: (amount) => `${amount} mere end at starte nu`,
    },
    tomorrow: 'i morgen',
    at: (day, time) => `${day ? `${day} ` : ''}kl. ${time}`,
    span: (day, from, to) => `${day ? `${day} ` : ''}kl. ${from}–${to}`,
    estimated: (when) =>
      `Priserne fra ${when} er skøn ud fra de seneste uger. De rigtige offentliggøres omkring kl. 13.`,
    spotOnly: 'Kun spotpris – nettarif og afgifter er ikke med.',
    tooShort: 'Der er ikke tid nok til det inden da. Vælg et senere tidspunkt.',
    none: 'Der er endnu ikke priser nok til det tidsrum.',
    error: 'Kunne ikke lave en plan. Prøv igen om lidt.',
    privacy: 'Intet af det, du skriver her, bliver gemt.',
  },
  de: {
    open: 'Planen',
    title: 'Planen',
    intro: 'Sag, bis wann es fertig sein muss – wattslot findet die beste Zeit dafür.',
    energy: 'Energie (kWh)',
    length: 'Programmdauer',
    power: 'Ladeleistung',
    from: 'Angeschlossen ab',
    doneBy: 'Fertig bis',
    readyBy: 'Fertig geladen bis',
    mayPause: 'Darf zwischendurch pausieren',
    submit: 'Beste Zeit finden',
    planning: 'Wird geplant…',
    options: 'Möglichkeiten',
    kinds: { cheapest: 'Am günstigsten', balanced: 'Ausgewogen', greenest: 'Am grünsten' },
    hints: {
      cheapest: 'Niedrigster Preis',
      balanced: (money) => `Rechnet 1 kg CO₂ als ${money}`,
      greenest: 'Am wenigsten CO₂',
    },
    sameAsAbove: 'Dieselben Zeiten wie oben',
    start: (when) => `Start ${when}`,
    done: (when) => `fertig ${when}`,
    charge: 'Laden',
    co2: (kg) => `${kg} kg CO₂`,
    vsMidnight: {
      less: (amount) => `${amount} weniger als bei einem Start um Mitternacht`,
      more: (amount) => `${amount} mehr als bei einem Start um Mitternacht`,
    },
    vsNow: {
      less: (amount) => `${amount} weniger als bei einem Start jetzt`,
      more: (amount) => `${amount} mehr als bei einem Start jetzt`,
    },
    tomorrow: 'morgen',
    at: (day, time) => `${day ? `${day} ` : ''}um ${time} Uhr`,
    span: (day, from, to) => `${day ? `${day} ` : ''}${from}–${to} Uhr`,
    estimated: (when) =>
      `Die Preise ab ${when} sind Schätzungen aus den letzten Wochen. Die echten erscheinen gegen 13 Uhr.`,
    spotOnly: 'Nur Spotpreis – Netzentgelte und Abgaben sind nicht enthalten.',
    tooShort: 'Bis dahin reicht die Zeit dafür nicht. Wähle eine spätere Uhrzeit.',
    none: 'Für diesen Zeitraum gibt es noch nicht genug Preise.',
    error: 'Das Planen hat nicht geklappt. Versuch es gleich noch einmal.',
    privacy: 'Nichts, was du hier eingibst, wird gespeichert.',
  },
  nb: {
    open: 'Planlegg',
    title: 'Planlegg',
    intro: 'Si når det må være ferdig, så finner wattslot det beste tidspunktet.',
    energy: 'Energi (kWh)',
    length: 'Programmets lengde',
    power: 'Ladeeffekt',
    from: 'Koblet til fra kl.',
    doneBy: 'Ferdig senest kl.',
    readyBy: 'Klar senest kl.',
    mayPause: 'Kan ta pauser underveis',
    submit: 'Finn beste tidspunkt',
    planning: 'Planlegger…',
    options: 'Alternativer',
    kinds: { cheapest: 'Billigst', balanced: 'Balansert', greenest: 'Grønnest' },
    hints: {
      cheapest: 'Lavest pris',
      balanced: (money) => `Regner 1 kg CO₂ som ${money}`,
      greenest: 'Minst CO₂',
    },
    sameAsAbove: 'Samme tider som over',
    start: (when) => `Start ${when}`,
    done: (when) => `ferdig ${when}`,
    charge: 'Lad',
    co2: (kg) => `${kg} kg CO₂`,
    vsMidnight: {
      less: (amount) => `${amount} mindre enn å starte ved midnatt`,
      more: (amount) => `${amount} mer enn å starte ved midnatt`,
    },
    vsNow: {
      less: (amount) => `${amount} mindre enn å starte nå`,
      more: (amount) => `${amount} mer enn å starte nå`,
    },
    tomorrow: 'i morgen',
    at: (day, time) => `${day ? `${day} ` : ''}kl. ${time}`,
    span: (day, from, to) => `${day ? `${day} ` : ''}kl. ${from}–${to}`,
    estimated: (when) =>
      `Prisene fra ${when} er anslag basert på de siste ukene. De faktiske publiseres rundt kl. 13.`,
    spotOnly: 'Bare spotpris – nettleie og avgifter er ikke med.',
    tooShort: 'Det er ikke nok tid til dette før da. Velg et senere tidspunkt.',
    none: 'Det er ikke nok priser for dette tidsrommet ennå.',
    error: 'Klarte ikke å lage en plan. Prøv igjen om litt.',
    privacy: 'Ingenting du skriver inn her, blir lagret.',
  },
  sv: {
    open: 'Planera',
    title: 'Planera',
    intro: 'Ange när det ska vara klart, så hittar wattslot den bästa tiden.',
    energy: 'Energi (kWh)',
    length: 'Programmets längd',
    power: 'Laddeffekt',
    from: 'Inkopplad från kl.',
    doneBy: 'Klar senast kl.',
    readyBy: 'Laddad senast kl.',
    mayPause: 'Får pausa emellanåt',
    submit: 'Hitta den bästa tiden',
    planning: 'Planerar…',
    options: 'Alternativ',
    kinds: { cheapest: 'Billigast', balanced: 'Balanserat', greenest: 'Grönast' },
    hints: {
      cheapest: 'Lägst pris',
      balanced: (money) => `Räknar 1 kg CO₂ som ${money}`,
      greenest: 'Minst CO₂',
    },
    sameAsAbove: 'Samma tider som ovan',
    start: (when) => `Starta ${when}`,
    done: (when) => `klar ${when}`,
    charge: 'Ladda',
    co2: (kg) => `${kg} kg CO₂`,
    vsMidnight: {
      less: (amount) => `${amount} mindre än att starta vid midnatt`,
      more: (amount) => `${amount} mer än att starta vid midnatt`,
    },
    vsNow: {
      less: (amount) => `${amount} mindre än att starta nu`,
      more: (amount) => `${amount} mer än att starta nu`,
    },
    tomorrow: 'i morgon',
    at: (day, time) => `${day ? `${day} ` : ''}kl. ${time}`,
    span: (day, from, to) => `${day ? `${day} ` : ''}kl. ${from}–${to}`,
    estimated: (when) =>
      `Priserna från ${when} är uppskattningar utifrån de senaste veckorna. De riktiga publiceras runt kl. 13.`,
    spotOnly: 'Endast spotpris – nätavgift och skatter ingår inte.',
    tooShort: 'Det finns inte tid nog för det före dess. Välj en senare tid.',
    none: 'Det finns inte tillräckligt med priser för den perioden än.',
    error: 'Det gick inte att göra en plan. Försök igen om en stund.',
    privacy: 'Inget du anger här sparas.',
  },
};
