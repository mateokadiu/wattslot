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
  // Saving plans (P2b) -------------------------------------------------------------------------
  save: string;
  saving: string;
  saved: string;
  calendar: string;
  tooMany: string;
  full: string;
  saveError: string;
  myPlans: string;
  loadingPlans: string;
  noPlans: string;
  plansNote: string;
  statuses: Record<'planned' | 'running' | 'done' | 'cancelled' | 'failed', string>;
  next: Record<'start' | 'stop' | 'finish', (when: string) => string>;
  estimatedPrices: string;
  cancel: string;
  deleteAll: string;
  deleteConfirm: string;
  deleteYes: string;
  keep: string;
  loadError: string;
  /** Calendar event titles. */
  events: Record<'dishwasher' | 'washing' | 'dryer' | 'ev', string>;
  eventNote: (cost: string) => string;
  // Notifications (P2c) ------------------------------------------------------------------------
  notify: string;
  notifyOn: string;
  notifyTurnOff: string;
  notifyDenied: string;
  notifyError: string;
  tooManyDevices: string;
  iosHint: string;
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
    privacy: 'Nothing is saved unless you save a plan.',
    save: 'Save this plan',
    saving: 'Saving…',
    saved: 'Saved. You’ll find it under My plans on the front page.',
    calendar: 'Add to calendar',
    tooMany: 'You have too many plans right now. Cancel one, or try again tomorrow.',
    full: 'Plans are full right now. Try again later.',
    saveError: 'Couldn’t save the plan. Try again in a moment.',
    myPlans: 'My plans',
    loadingPlans: 'Fetching your plans…',
    noPlans: 'No plans right now.',
    plansNote:
      'Your plans belong to this browser only: clear its data or use another device, and they’re gone. Ended plans disappear after a week.',
    statuses: {
      planned: 'Planned',
      running: 'Running',
      done: 'Done',
      cancelled: 'Cancelled',
      failed: 'Failed',
    },
    next: {
      start: (when) => `Start ${when}`,
      stop: (when) => `Pause ${when}`,
      finish: (when) => `Done ${when}`,
    },
    estimatedPrices: 'Based on estimated prices',
    cancel: 'Cancel plan',
    deleteAll: 'Delete everything',
    deleteConfirm: 'Delete all your plans? This can’t be undone.',
    deleteYes: 'Yes, delete',
    keep: 'Keep them',
    loadError: 'Couldn’t fetch your plans. Try again in a moment.',
    events: {
      dishwasher: 'Run the dishwasher',
      washing: 'Run the washing machine',
      dryer: 'Run the tumble dryer',
      ev: 'Charge the car',
    },
    eventNote: (cost) => `Planned by wattslot · ${cost}`,
    notify: 'Notify me on this device',
    notifyOn: 'Notifications are on for this device.',
    notifyTurnOff: 'Turn off',
    notifyDenied: 'Notifications are blocked for this site in your browser’s settings.',
    notifyError: 'Couldn’t turn on notifications. Try again in a moment.',
    tooManyDevices:
      'Notifications are already on for 3 devices. Turn them off on one of them first.',
    iosHint:
      'On iPhone and iPad, notifications need wattslot on your Home Screen: tap Share, then “Add to Home Screen”. Or use Add to calendar.',
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
    privacy: 'Intet gemmes, medmindre du gemmer en plan.',
    save: 'Gem planen',
    saving: 'Gemmer…',
    saved: 'Gemt. Du finder den under Mine planer på forsiden.',
    calendar: 'Tilføj til kalender',
    tooMany: 'Du har for mange planer lige nu. Annullér en, eller prøv igen i morgen.',
    full: 'Der er ikke plads til flere planer lige nu. Prøv igen senere.',
    saveError: 'Kunne ikke gemme planen. Prøv igen om lidt.',
    myPlans: 'Mine planer',
    loadingPlans: 'Henter dine planer…',
    noPlans: 'Ingen planer lige nu.',
    plansNote:
      'Dine planer hører kun til denne browser: rydder du dens data eller bruger en anden enhed, er de væk. Afsluttede planer forsvinder efter en uge.',
    statuses: {
      planned: 'Planlagt',
      running: 'I gang',
      done: 'Færdig',
      cancelled: 'Annulleret',
      failed: 'Fejlet',
    },
    next: {
      start: (when) => `Start ${when}`,
      stop: (when) => `Pause ${when}`,
      finish: (when) => `Færdig ${when}`,
    },
    estimatedPrices: 'Bygger på skønnede priser',
    cancel: 'Annullér plan',
    deleteAll: 'Slet alt',
    deleteConfirm: 'Slet alle dine planer? Det kan ikke fortrydes.',
    deleteYes: 'Ja, slet',
    keep: 'Behold dem',
    loadError: 'Kunne ikke hente dine planer. Prøv igen om lidt.',
    events: {
      dishwasher: 'Kør opvaskemaskinen',
      washing: 'Kør vaskemaskinen',
      dryer: 'Kør tørretumbleren',
      ev: 'Lad bilen',
    },
    eventNote: (cost) => `Planlagt af wattslot · ${cost}`,
    notify: 'Giv mig besked på denne enhed',
    notifyOn: 'Notifikationer er slået til på denne enhed.',
    notifyTurnOff: 'Slå fra',
    notifyDenied: 'Notifikationer er blokeret for siden i dine browserindstillinger.',
    notifyError: 'Kunne ikke slå notifikationer til. Prøv igen om lidt.',
    tooManyDevices:
      'Notifikationer er allerede slået til på 3 enheder. Slå dem fra på én af dem først.',
    iosHint:
      'På iPhone og iPad kræver notifikationer, at wattslot ligger på din hjemmeskærm: tryk på Del og derefter »Føj til hjemmeskærm«. Eller brug Tilføj til kalender.',
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
    privacy: 'Gespeichert wird nur, wenn du einen Plan speicherst.',
    save: 'Plan speichern',
    saving: 'Wird gespeichert…',
    saved: 'Gespeichert. Du findest ihn unter „Meine Pläne“ auf der Startseite.',
    calendar: 'Zum Kalender hinzufügen',
    tooMany: 'Du hast gerade zu viele Pläne. Brich einen ab oder versuch es morgen wieder.',
    full: 'Gerade ist kein Platz für weitere Pläne. Versuch es später noch einmal.',
    saveError: 'Der Plan konnte nicht gespeichert werden. Versuch es gleich noch einmal.',
    myPlans: 'Meine Pläne',
    loadingPlans: 'Deine Pläne werden geladen…',
    noPlans: 'Gerade keine Pläne.',
    plansNote:
      'Deine Pläne gehören nur zu diesem Browser: Löschst du seine Daten oder nutzt ein anderes Gerät, sind sie weg. Beendete Pläne verschwinden nach einer Woche.',
    statuses: {
      planned: 'Geplant',
      running: 'Läuft',
      done: 'Fertig',
      cancelled: 'Abgebrochen',
      failed: 'Fehlgeschlagen',
    },
    next: {
      start: (when) => `Start ${when}`,
      stop: (when) => `Pause ${when}`,
      finish: (when) => `Fertig ${when}`,
    },
    estimatedPrices: 'Beruht auf geschätzten Preisen',
    cancel: 'Plan abbrechen',
    deleteAll: 'Alles löschen',
    deleteConfirm: 'Alle deine Pläne löschen? Das lässt sich nicht rückgängig machen.',
    deleteYes: 'Ja, löschen',
    keep: 'Behalten',
    loadError: 'Deine Pläne konnten nicht geladen werden. Versuch es gleich noch einmal.',
    events: {
      dishwasher: 'Spülmaschine starten',
      washing: 'Waschmaschine starten',
      dryer: 'Trockner starten',
      ev: 'Auto laden',
    },
    eventNote: (cost) => `Geplant von wattslot · ${cost}`,
    notify: 'Auf diesem Gerät benachrichtigen',
    notifyOn: 'Benachrichtigungen sind auf diesem Gerät an.',
    notifyTurnOff: 'Ausschalten',
    notifyDenied:
      'Benachrichtigungen sind für diese Seite in deinen Browsereinstellungen blockiert.',
    notifyError:
      'Benachrichtigungen konnten nicht eingeschaltet werden. Versuch es gleich noch einmal.',
    tooManyDevices:
      'Benachrichtigungen sind schon auf 3 Geräten an. Schalte sie zuerst auf einem davon aus.',
    iosHint:
      'Auf iPhone und iPad braucht es für Benachrichtigungen wattslot auf dem Home-Bildschirm: Tippe auf Teilen und dann auf „Zum Home-Bildschirm“. Oder nutze „Zum Kalender hinzufügen“.',
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
    privacy: 'Ingenting lagres med mindre du lagrer en plan.',
    save: 'Lagre planen',
    saving: 'Lagrer…',
    saved: 'Lagret. Du finner den under Mine planer på forsiden.',
    calendar: 'Legg til i kalender',
    tooMany: 'Du har for mange planer akkurat nå. Avbryt en, eller prøv igjen i morgen.',
    full: 'Det er ikke plass til flere planer akkurat nå. Prøv igjen senere.',
    saveError: 'Klarte ikke å lagre planen. Prøv igjen om litt.',
    myPlans: 'Mine planer',
    loadingPlans: 'Henter planene dine…',
    noPlans: 'Ingen planer akkurat nå.',
    plansNote:
      'Planene dine hører bare til denne nettleseren: tømmer du dataene eller bruker en annen enhet, er de borte. Avsluttede planer forsvinner etter en uke.',
    statuses: {
      planned: 'Planlagt',
      running: 'Pågår',
      done: 'Ferdig',
      cancelled: 'Avbrutt',
      failed: 'Feilet',
    },
    next: {
      start: (when) => `Start ${when}`,
      stop: (when) => `Pause ${when}`,
      finish: (when) => `Ferdig ${when}`,
    },
    estimatedPrices: 'Bygger på anslåtte priser',
    cancel: 'Avbryt planen',
    deleteAll: 'Slett alt',
    deleteConfirm: 'Slette alle planene dine? Det kan ikke angres.',
    deleteYes: 'Ja, slett',
    keep: 'Behold dem',
    loadError: 'Klarte ikke å hente planene dine. Prøv igjen om litt.',
    events: {
      dishwasher: 'Kjør oppvaskmaskinen',
      washing: 'Kjør vaskemaskinen',
      dryer: 'Kjør tørketrommelen',
      ev: 'Lad bilen',
    },
    eventNote: (cost) => `Planlagt av wattslot · ${cost}`,
    notify: 'Varsle meg på denne enheten',
    notifyOn: 'Varsler er slått på for denne enheten.',
    notifyTurnOff: 'Slå av',
    notifyDenied: 'Varsler er blokkert for nettstedet i nettleserinnstillingene dine.',
    notifyError: 'Klarte ikke å slå på varsler. Prøv igjen om litt.',
    tooManyDevices: 'Varsler er allerede slått på for 3 enheter. Slå dem av på én av dem først.',
    iosHint:
      'På iPhone og iPad må wattslot ligge på Hjem-skjermen for å kunne varsle: trykk på Del og så «Legg til på Hjem-skjerm». Eller bruk Legg til i kalender.',
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
    privacy: 'Inget sparas om du inte sparar en plan.',
    save: 'Spara planen',
    saving: 'Sparar…',
    saved: 'Sparad. Du hittar den under Mina planer på startsidan.',
    calendar: 'Lägg till i kalendern',
    tooMany: 'Du har för många planer just nu. Avbryt en, eller försök igen i morgon.',
    full: 'Det finns inte plats för fler planer just nu. Försök igen senare.',
    saveError: 'Det gick inte att spara planen. Försök igen om en stund.',
    myPlans: 'Mina planer',
    loadingPlans: 'Hämtar dina planer…',
    noPlans: 'Inga planer just nu.',
    plansNote:
      'Dina planer hör bara till den här webbläsaren: rensar du dess data eller använder en annan enhet är de borta. Avslutade planer försvinner efter en vecka.',
    statuses: {
      planned: 'Planerad',
      running: 'Pågår',
      done: 'Klar',
      cancelled: 'Avbruten',
      failed: 'Misslyckades',
    },
    next: {
      start: (when) => `Starta ${when}`,
      stop: (when) => `Paus ${when}`,
      finish: (when) => `Klar ${when}`,
    },
    estimatedPrices: 'Bygger på uppskattade priser',
    cancel: 'Avbryt planen',
    deleteAll: 'Radera allt',
    deleteConfirm: 'Radera alla dina planer? Det går inte att ångra.',
    deleteYes: 'Ja, radera',
    keep: 'Behåll dem',
    loadError: 'Det gick inte att hämta dina planer. Försök igen om en stund.',
    events: {
      dishwasher: 'Kör diskmaskinen',
      washing: 'Kör tvättmaskinen',
      dryer: 'Kör torktumlaren',
      ev: 'Ladda bilen',
    },
    eventNote: (cost) => `Planerad av wattslot · ${cost}`,
    notify: 'Meddela mig på den här enheten',
    notifyOn: 'Aviseringar är på för den här enheten.',
    notifyTurnOff: 'Stäng av',
    notifyDenied: 'Aviseringar är blockerade för webbplatsen i dina webbläsarinställningar.',
    notifyError: 'Det gick inte att slå på aviseringar. Försök igen om en stund.',
    tooManyDevices: 'Aviseringar är redan på för 3 enheter. Stäng av dem på en av dem först.',
    iosHint:
      'På iPhone och iPad behöver wattslot ligga på hemskärmen för att kunna skicka aviseringar: tryck på Dela och sedan ”Lägg till på hemskärmen”. Eller använd Lägg till i kalendern.',
  },
};
