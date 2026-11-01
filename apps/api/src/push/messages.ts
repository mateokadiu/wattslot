import type { Run } from '@wattslot/planner';
import { addDays, localTime } from '@wattslot/pricing';
import type { Action } from '../jobs/actions.ts';
import type { Task } from '../jobs/store.ts';
import type { OwnerLocale } from '../owners/auth.ts';

// Notification text (PLAN.md §17.7), in the owner's language and on the price area's clock.

type Appliance = Exclude<Task, 'ev'>;

interface Text {
  intl: string;
  /** Path of the site in this language. */
  path: string;
  /** Task names as titles ("Dishwasher") and with their article ("the dishwasher"). */
  tasks: Record<Task, string>;
  the: Record<Appliance, string>;
  tomorrow: string;
  at: (day: string | null, time: string) => string;
  planned: (task: string) => string;
  starts: (when: string, cost: string) => string;
  startTask: (the: string) => string;
  doneBy: (time: string) => string;
  startCharging: string;
  chargeUntil: (time: string) => string;
  pauseCharging: string;
  nextCharge: (when: string) => string;
  chargingDone: string;
  chargingDoneBody: string;
}

const on = (day: string | null) => (day ? `${day} ` : '');

const TEXT: Record<OwnerLocale, Text> = {
  en: {
    intl: 'en-GB',
    path: '/',
    tasks: {
      dishwasher: 'Dishwasher',
      washing: 'Washing machine',
      dryer: 'Tumble dryer',
      ev: 'EV charge',
    },
    the: {
      dishwasher: 'the dishwasher',
      washing: 'the washing machine',
      dryer: 'the tumble dryer',
    },
    tomorrow: 'tomorrow',
    at: (day, time) => `${on(day)}${time}`,
    planned: (task) => `Plan saved: ${task}`,
    starts: (when, cost) => `Starts ${when} · ${cost}`,
    startTask: (the) => `Start ${the} now`,
    doneBy: (time) => `Done by ${time}`,
    startCharging: 'Start charging now',
    chargeUntil: (time) => `Charge until ${time}`,
    pauseCharging: 'Pause charging now',
    nextCharge: (when) => `Next charge ${when}`,
    chargingDone: 'Charging plan done',
    chargingDoneBody: 'You can stop charging now.',
  },
  da: {
    intl: 'da-DK',
    path: '/da/',
    tasks: {
      dishwasher: 'Opvaskemaskine',
      washing: 'Vaskemaskine',
      dryer: 'Tørretumbler',
      ev: 'Elbil',
    },
    the: { dishwasher: 'opvaskemaskinen', washing: 'vaskemaskinen', dryer: 'tørretumbleren' },
    tomorrow: 'i morgen',
    at: (day, time) => `${on(day)}kl. ${time}`,
    planned: (task) => `Plan gemt: ${task}`,
    starts: (when, cost) => `Starter ${when} · ${cost}`,
    startTask: (the) => `Start ${the} nu`,
    doneBy: (time) => `Færdig kl. ${time}`,
    startCharging: 'Start opladningen nu',
    chargeUntil: (time) => `Lad til kl. ${time}`,
    pauseCharging: 'Sæt opladningen på pause nu',
    nextCharge: (when) => `Næste opladning ${when}`,
    chargingDone: 'Opladningen er færdig',
    chargingDoneBody: 'Du kan stoppe opladningen nu.',
  },
  de: {
    intl: 'de-DE',
    path: '/de/',
    tasks: {
      dishwasher: 'Spülmaschine',
      washing: 'Waschmaschine',
      dryer: 'Trockner',
      ev: 'Auto laden',
    },
    the: { dishwasher: 'die Spülmaschine', washing: 'die Waschmaschine', dryer: 'den Trockner' },
    tomorrow: 'morgen',
    at: (day, time) => `${on(day)}um ${time} Uhr`,
    planned: (task) => `Plan gespeichert: ${task}`,
    starts: (when, cost) => `Start ${when} · ${cost}`,
    startTask: (the) => `Starte jetzt ${the}`,
    doneBy: (time) => `Fertig um ${time} Uhr`,
    startCharging: 'Jetzt laden',
    chargeUntil: (time) => `Laden bis ${time} Uhr`,
    pauseCharging: 'Laden jetzt pausieren',
    nextCharge: (when) => `Weiter laden ${when}`,
    chargingDone: 'Ladeplan erledigt',
    chargingDoneBody: 'Du kannst das Laden jetzt beenden.',
  },
  nb: {
    intl: 'nb-NO',
    path: '/no/',
    tasks: {
      dishwasher: 'Oppvaskmaskin',
      washing: 'Vaskemaskin',
      dryer: 'Tørketrommel',
      ev: 'Elbil',
    },
    the: { dishwasher: 'oppvaskmaskinen', washing: 'vaskemaskinen', dryer: 'tørketrommelen' },
    tomorrow: 'i morgen',
    at: (day, time) => `${on(day)}kl. ${time}`,
    planned: (task) => `Plan lagret: ${task}`,
    starts: (when, cost) => `Starter ${when} · ${cost}`,
    startTask: (the) => `Start ${the} nå`,
    doneBy: (time) => `Ferdig kl. ${time}`,
    startCharging: 'Start ladingen nå',
    chargeUntil: (time) => `Lad til kl. ${time}`,
    pauseCharging: 'Sett ladingen på pause nå',
    nextCharge: (when) => `Neste lading ${when}`,
    chargingDone: 'Ladingen er ferdig',
    chargingDoneBody: 'Du kan stoppe ladingen nå.',
  },
  sv: {
    intl: 'sv-SE',
    path: '/sv/',
    tasks: { dishwasher: 'Diskmaskin', washing: 'Tvättmaskin', dryer: 'Torktumlare', ev: 'Elbil' },
    the: { dishwasher: 'diskmaskinen', washing: 'tvättmaskinen', dryer: 'torktumlaren' },
    tomorrow: 'i morgon',
    at: (day, time) => `${on(day)}kl. ${time}`,
    planned: (task) => `Plan sparad: ${task}`,
    starts: (when, cost) => `Startar ${when} · ${cost}`,
    startTask: (the) => `Starta ${the} nu`,
    doneBy: (time) => `Klar kl. ${time}`,
    startCharging: 'Börja ladda nu',
    chargeUntil: (time) => `Ladda till kl. ${time}`,
    pauseCharging: 'Pausa laddningen nu',
    nextCharge: (when) => `Nästa laddning ${when}`,
    chargingDone: 'Laddningen är klar',
    chargingDoneBody: 'Du kan sluta ladda nu.',
  },
};

export interface MessageContext {
  locale: OwnerLocale;
  task: Task;
  timeZone: string;
  currency: string;
  runs: readonly Run[];
  cost: number;
  siteUrl: string;
  jobId: string;
}

export interface Message {
  title: string;
  body: string;
  /** Where tapping the notification leads. */
  navigate: string;
  lang: string;
  /** One notification per job: a newer message replaces the older one. */
  tag: string;
  /** Seconds a push service may hold it for an offline device: until it's out of date. */
  ttl: number;
  urgency: 'normal' | 'high';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** What to send when a plan is saved, or at one of its moments; null when there's nothing to say. */
export function message(
  kind: 'planned' | Action['kind'],
  ctx: MessageContext,
  atMs: number,
  nowMs: number,
): Message | null {
  const text = TEXT[ctx.locale] ?? TEXT.en;
  const clock = (ms: number) => {
    const t = localTime(ms, ctx.timeZone);
    return `${pad(t.hour)}:${pad(t.minute)}`;
  };
  const today = localTime(nowMs, ctx.timeZone).date;
  const weekday = new Intl.DateTimeFormat(text.intl, { weekday: 'long', timeZone: ctx.timeZone });
  const when = (ms: number) => {
    const date = localTime(ms, ctx.timeZone).date;
    const day =
      date === today ? null : date === addDays(today, 1) ? text.tomorrow : weekday.format(ms);
    return text.at(day, clock(ms));
  };
  const money = `${new Intl.NumberFormat(text.intl, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(ctx.cost)} ${ctx.currency === 'DKK' ? 'kr.' : ctx.currency}`;
  const first = ctx.runs[0];
  const last = ctx.runs.at(-1);
  const run = ctx.runs.find((r) => r.startMs === atMs);
  const next = ctx.runs.find((r) => r.startMs > atMs);
  const base = {
    navigate: `${ctx.siteUrl}${text.path}#my-plans`,
    lang: text.intl,
    tag: `job-${ctx.jobId}`,
  };
  const until = (ms: number) => Math.max(60, Math.round((ms - nowMs) / 1000));
  // A moment that has passed by the time the message would go out isn't worth telling.
  const stale = (ms: number) => nowMs >= ms;

  if (kind === 'planned') {
    if (!first || stale(first.startMs)) return null;
    return {
      ...base,
      title: text.planned(text.tasks[ctx.task]),
      body: text.starts(when(first.startMs), money),
      ttl: until(first.startMs),
      urgency: 'normal',
    };
  }
  if (ctx.task !== 'ev') {
    // An appliance only needs starting; its programme stops by itself.
    if (kind !== 'start' || !last || stale(last.endMs)) return null;
    return {
      ...base,
      title: text.startTask(text.the[ctx.task]),
      body: text.doneBy(clock(last.endMs)),
      ttl: until(last.endMs),
      urgency: 'high',
    };
  }
  if (kind === 'start' && run && !stale(run.endMs)) {
    return {
      ...base,
      title: text.startCharging,
      body: text.chargeUntil(clock(run.endMs)),
      ttl: until(run.endMs),
      urgency: 'high',
    };
  }
  if (kind === 'stop' && next && !stale(next.startMs)) {
    return {
      ...base,
      title: text.pauseCharging,
      body: text.nextCharge(when(next.startMs)),
      ttl: until(next.startMs),
      urgency: 'high',
    };
  }
  if (kind === 'finish' && !stale(atMs + 3_600_000)) {
    return {
      ...base,
      title: text.chargingDone,
      body: text.chargingDoneBody,
      ttl: 3_600,
      urgency: 'high',
    };
  }
  return null;
}

/**
 * The push payload: Safari's Declarative Web Push format (iOS/macOS 18.4+ show it without any
 * script), which the site's service worker also reads on other browsers.
 */
export function payload(m: Message): string {
  return JSON.stringify({
    web_push: 8030,
    notification: { title: m.title, body: m.body, navigate: m.navigate, lang: m.lang, tag: m.tag },
  });
}
