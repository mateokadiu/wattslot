import type { ReactNode } from 'react';
import { calendarDate, clock, ore, price } from '@/lib/format';
import type { GuideData } from '@/lib/guide-data';

// Four guides in Danish and English. Live numbers come from GuideData (rebuilt with the
// prices); fixed numbers are from PLAN.md §2.3 (wattslot's own simulation) and are labelled.

export type GuideKey = 'cheapest' | 'ev' | 'tarifmodel' | 'quarter-hours';
type L = 'en' | 'da';

export const GUIDE_KEYS: GuideKey[] = ['cheapest', 'ev', 'tarifmodel', 'quarter-hours'];

export const GUIDE_SLUGS: Record<GuideKey, Record<L, string>> = {
  cheapest: { en: 'when-is-electricity-cheapest', da: 'hvornaar-er-stroemmen-billigst' },
  ev: { en: 'charge-your-ev-cheaply', da: 'lad-elbilen-billigst' },
  tarifmodel: { en: 'tarifmodel-3', da: 'tarifmodel-3' },
  'quarter-hours': { en: 'quarter-hour-prices', da: 'kvarterspriser' },
};

export interface Guide {
  title: string;
  description: string;
  heading: string;
  /** One line for the guides page. */
  summary: string;
  body: (g: GuideData, links: GuideLinks) => ReactNode;
}

export interface GuideLinks {
  live: string;
  liveEv: string;
  method: string;
  companies: string;
  company: (slug: string) => string;
  guide: (key: GuideKey) => string;
}

const TZ = 'Europe/Copenhagen';
/** Two-hour programmes at the default assumptions in the live view (lib/insights TASKS). */
const APPLIANCES = { dishwasher: 1.1, washing: 0.9, dryer: 2 };

/** Average price of the two hours from 18:00, and of the cheapest two hours, today. */
function eveningVsCheapest(g: GuideData) {
  const dk2 = g.today.find((t) => t.zone === 'DK2')?.facts;
  if (!dk2?.cheapest2h) return null;
  const evening = dk2.hours.filter((h) => {
    const at = clock(h.startMs, TZ);
    return at === '18:00' || at === '19:00';
  });
  if (evening.length !== 2) return null;
  const eveningAvg = (evening[0]?.average ?? 0) / 2 + (evening[1]?.average ?? 0) / 2;
  return { evening: eveningAvg, cheap: dk2.cheapest2h, diff: eveningAvg - dk2.cheapest2h.average };
}

function TodayList({ g, l }: { g: GuideData; l: L }) {
  return (
    <ul>
      {g.today.map(({ zone, facts }) =>
        facts.cheapest2h && facts.priciestHour ? (
          <li key={zone}>
            <strong>{zone}</strong>:{' '}
            {l === 'da'
              ? `billigst kl. ${clock(facts.cheapest2h.startMs, TZ)}–${clock(facts.cheapest2h.endMs, TZ)} (i gennemsnit ${price(facts.cheapest2h.average, l)} kr./kWh), dyrest kl. ${clock(facts.priciestHour.startMs, TZ)}–${clock(facts.priciestHour.endMs, TZ)} (${price(facts.priciestHour.average, l)} kr./kWh).`
              : `cheapest ${clock(facts.cheapest2h.startMs, TZ)}–${clock(facts.cheapest2h.endMs, TZ)} (${price(facts.cheapest2h.average, l)} DKK/kWh on average), most expensive ${clock(facts.priciestHour.startMs, TZ)}–${clock(facts.priciestHour.endMs, TZ)} (${price(facts.priciestHour.average, l)} DKK/kWh).`}
          </li>
        ) : null,
      )}
    </ul>
  );
}

function SimulationTable({ l }: { l: L }) {
  const rows =
    l === 'da'
      ? [
          ['Lad straks', '6.210 kr.', '5.630 kr.'],
          ['De billigste kvarterer', '3.217 kr.', '3.170 kr.'],
          ['Besparelse', 'ca. 2.990 kr. (−48 %)', 'ca. 2.460 kr. (−44 %)'],
          ['Heraf ud over en timer kl. 00', 'ca. 550 kr.', 'ca. 575 kr.'],
        ]
      : [
          ['Charge on plug-in', '6,210 kr.', '5,630 kr.'],
          ['Cheapest quarter hours', '3,217 kr.', '3,170 kr.'],
          ['Saving', '≈ 2,990 kr. (−48%)', '≈ 2,460 kr. (−44%)'],
          ['Of which beyond a 00:00 timer', '≈ 550 kr.', '≈ 575 kr.'],
        ];
  return (
    <table>
      <caption className="pb-2 text-left text-xs text-[var(--muted)]">
        {l === 'da'
          ? 'Elbil, 3.000 kWh om året, 7,4 kW, sat til kl. 17, klar kl. 07. Pris pr. år inkl. moms.'
          : 'EV, 3,000 kWh a year, 7.4 kW, plugged in at 17:00, ready at 07:00. Cost per year incl. VAT.'}
      </caption>
      <thead>
        <tr>
          <th scope="col">{l === 'da' ? 'Opladning' : 'Charging'}</th>
          <th scope="col" className="text-right">
            DK2 · Radius Elnet
          </th>
          <th scope="col" className="text-right">
            DK1 · N1
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, dk2, dk1]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td className="text-right tabular-nums">{dk2}</td>
            <td className="text-right tabular-nums">{dk1}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TariffList({ g, l, links }: { g: GuideData; l: L; links: GuideLinks }) {
  return (
    <table>
      <caption className="pb-2 text-left text-xs text-[var(--muted)]">
        {l === 'da'
          ? 'Nettarif i dag hos de største netselskaber, øre pr. kWh inkl. moms.'
          : 'Grid tariff today at the largest grid companies, øre per kWh incl. VAT.'}
      </caption>
      <thead>
        <tr>
          <th scope="col">{l === 'da' ? 'Netselskab' : 'Grid company'}</th>
          <th scope="col" className="text-right">
            {l === 'da' ? 'Lav' : 'Low'}
          </th>
          <th scope="col" className="text-right">
            {l === 'da' ? 'Høj' : 'High'}
          </th>
          <th scope="col" className="text-right">
            {l === 'da' ? 'Spids' : 'Peak'}
          </th>
        </tr>
      </thead>
      <tbody>
        {g.tariffs.slice(0, 10).map((c) => (
          <tr key={c.slug}>
            <th scope="row">
              <a href={links.company(c.slug)}>{c.name}</a>
            </th>
            <td className="text-right font-mono tabular-nums">{ore(c.low, l, true)}</td>
            <td className="text-right font-mono tabular-nums">{ore(c.high, l, true)}</td>
            <td className="text-right font-mono tabular-nums">{ore(c.peak, l, true)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const GUIDES: Record<GuideKey, Record<L, Guide>> = {
  cheapest: {
    en: {
      title: 'When is electricity cheapest in Denmark? | wattslot',
      description:
        'Electricity is usually cheapest at night and dearest from 17 to 21, when the grid tariff peaks. Today’s cheapest hours, and how to move your use to them.',
      heading: 'When is electricity cheapest?',
      summary: 'Night versus the 17–21 peak, and today’s cheapest hours.',
      body: (g, links) => {
        const big = g.tariffs[0];
        const shift = eveningVsCheapest(g);
        return (
          <>
            <p>
              <strong>Short answer:</strong> usually at night, and almost never between 17:00 and
              21:00. That’s when the grid tariff is at its peak, on top of a spot price that is
              usually high too.
            </p>
            <h2>Today</h2>
            <TodayList g={g} l="en" />
            <p>
              <a href={links.live}>See the live price for your grid company →</a>
            </p>
            <h2>Why the time of day matters</h2>
            <p>
              You pay the spot price plus your grid company’s tariff, Energinet’s tariffs,
              electricity tax and VAT. Two of these change during the day:
            </p>
            <ul>
              <li>
                <strong>The spot price</strong> follows supply and demand. It often falls at night
                and when there is a lot of wind or sun, and rises in the morning and evening.
              </li>
              {big && (
                <li>
                  <strong>The grid tariff</strong> follows fixed time bands. At {big.name}, the
                  largest grid company, the peak tariff (17–21) is {ore(big.peak, 'en', true)}{' '}
                  øre/kWh including VAT today, against {ore(big.low, 'en', true)} øre at night —{' '}
                  {Math.round(big.peak / big.low)} times as much.{' '}
                  <a href={links.guide('tarifmodel')}>How the tariff works</a>.
                </li>
              )}
            </ul>
            {shift && shift.diff > 0 && (
              <>
                <h2>What moving an appliance saves</h2>
                <p>
                  In DK2 today, the two hours from 18:00 cost {price(shift.evening, 'en')} DKK/kWh
                  on average, and the cheapest two hours {price(shift.cheap.average, 'en')}. For a
                  two-hour programme, that is per run:
                </p>
                <ul>
                  <li>
                    Dishwasher ({APPLIANCES.dishwasher} kWh):{' '}
                    {price(APPLIANCES.dishwasher * shift.diff, 'en')} kr.
                  </li>
                  <li>
                    Washing machine ({APPLIANCES.washing} kWh):{' '}
                    {price(APPLIANCES.washing * shift.diff, 'en')} kr.
                  </li>
                  <li>
                    Tumble dryer ({APPLIANCES.dryer} kWh):{' '}
                    {price(APPLIANCES.dryer * shift.diff, 'en')} kr.
                  </li>
                </ul>
                <p>
                  Small per run, but if every day were like today, moving all three out of the
                  evening would save about{' '}
                  {Math.round(
                    (APPLIANCES.dishwasher + APPLIANCES.washing + APPLIANCES.dryer) *
                      shift.diff *
                      365,
                  ).toLocaleString('en-GB')}{' '}
                  kroner a year.
                </p>
              </>
            )}
            <h2>How to do it</h2>
            <ul>
              <li>
                Use the delay start on your dishwasher or washing machine, so it runs at night or
                after 21:00.
              </li>
              <li>Tomorrow’s prices are published around 13:00 — check them then.</li>
              <li>
                Have an electric car? It matters far more: see{' '}
                <a href={links.guide('ev')}>how to charge it cheaply</a>.
              </li>
            </ul>
          </>
        );
      },
    },
    da: {
      title: 'Hvornår er strømmen billigst i dag? | wattslot',
      description:
        'Strømmen er som regel billigst om natten og dyrest kl. 17–21, når nettariffen topper. Se dagens billigste timer, og hvordan du flytter dit forbrug.',
      heading: 'Hvornår er strømmen billigst?',
      summary: 'Natten mod spidslasten kl. 17–21, og dagens billigste timer.',
      body: (g, links) => {
        const big = g.tariffs[0];
        const shift = eveningVsCheapest(g);
        return (
          <>
            <p>
              <strong>Kort svar:</strong> som regel om natten og næsten aldrig mellem kl. 17 og 21.
              Her er nettariffen på sit højeste, oven i en spotpris, der som regel også er høj.
            </p>
            <h2>I dag</h2>
            <TodayList g={g} l="da" />
            <p>
              <a href={links.live}>Se prisen lige nu for dit netselskab →</a>
            </p>
            <h2>Derfor betyder tidspunktet noget</h2>
            <p>
              Du betaler spotprisen plus dit netselskabs tarif, Energinets tariffer, elafgift og
              moms. To af dem skifter i løbet af døgnet:
            </p>
            <ul>
              <li>
                <strong>Spotprisen</strong> følger udbud og efterspørgsel. Den falder ofte om natten
                og når det blæser eller er solrigt, og stiger om morgenen og om aftenen.
              </li>
              {big && (
                <li>
                  <strong>Nettariffen</strong> følger faste tidsrum. Hos {big.name}, landets største
                  netselskab, er spidstariffen (kl. 17–21) i dag {ore(big.peak, 'da', true)} øre/kWh
                  inkl. moms mod {ore(big.low, 'da', true)} øre om natten –{' '}
                  {Math.round(big.peak / big.low)} gange så meget.{' '}
                  <a href={links.guide('tarifmodel')}>Sådan virker tariffen</a>.
                </li>
              )}
            </ul>
            {shift && shift.diff > 0 && (
              <>
                <h2>Det sparer du ved at flytte et apparat</h2>
                <p>
                  I DK2 koster de to timer fra kl. 18 i dag i gennemsnit{' '}
                  {price(shift.evening, 'da')} kr./kWh og de billigste to timer{' '}
                  {price(shift.cheap.average, 'da')}. For et program på to timer er det pr. gang:
                </p>
                <ul>
                  <li>
                    Opvaskemaskine ({APPLIANCES.dishwasher.toLocaleString('da-DK')} kWh):{' '}
                    {price(APPLIANCES.dishwasher * shift.diff, 'da')} kr.
                  </li>
                  <li>
                    Vaskemaskine ({APPLIANCES.washing.toLocaleString('da-DK')} kWh):{' '}
                    {price(APPLIANCES.washing * shift.diff, 'da')} kr.
                  </li>
                  <li>
                    Tørretumbler ({APPLIANCES.dryer} kWh):{' '}
                    {price(APPLIANCES.dryer * shift.diff, 'da')} kr.
                  </li>
                </ul>
                <p>
                  Ikke meget pr. gang, men hvis hver dag var som i dag, ville du spare omkring{' '}
                  {Math.round(
                    (APPLIANCES.dishwasher + APPLIANCES.washing + APPLIANCES.dryer) *
                      shift.diff *
                      365,
                  ).toLocaleString('da-DK')}{' '}
                  kr. om året ved at flytte alle tre væk fra aftenen.
                </p>
              </>
            )}
            <h2>Sådan gør du</h2>
            <ul>
              <li>
                Brug den udskudte start på opvaskemaskinen eller vaskemaskinen, så den kører om
                natten eller efter kl. 21.
              </li>
              <li>Morgendagens priser offentliggøres omkring kl. 13 – tjek dem der.</li>
              <li>
                Har du elbil? Den betyder langt mere: se{' '}
                <a href={links.guide('ev')}>hvordan du lader den billigst</a>.
              </li>
            </ul>
          </>
        );
      },
    },
  },
  ev: {
    en: {
      title: 'How to charge your electric car cheaply | wattslot',
      description:
        'Charging an EV in the cheapest quarter hours instead of on plug-in cuts its electricity cost by 44–48%. Most of that comes from avoiding 17 to 21.',
      heading: 'Charge your electric car cheaply',
      summary: 'Up to 48% off by avoiding the evening peak, and what smart charging adds.',
      body: (_g, links) => (
        <>
          <p>
            An electric car is the biggest flexible load in most homes: 3,000 kWh a year is typical.
            Charging it at the right time is worth more than everything else on this site put
            together.
          </p>
          <h2>What it’s worth</h2>
          <p>
            wattslot simulated a year of real 15-minute prices and grid tariffs (October 2025 –
            September 2026, VAT included) for a car that charges at 7.4 kW, is plugged in at 17:00
            and must be ready at 07:00:
          </p>
          <SimulationTable l="en" />
          <p>
            Most of the saving comes from one thing: not charging between 17:00 and 21:00. A plain
            timer that starts at midnight gets you most of the way; picking the cheapest quarter
            hours adds about 550 kroner a year on top.
          </p>
          <h2>How to set it up</h2>
          <ul>
            <li>Easiest: set the car’s or the charger’s timer to start at 00:00.</li>
            <li>
              Better: a charger or app that charges in the cheapest quarter hours — ideally by the
              full price including your grid tariff, not just the spot price. The two often pick
              different hours.
            </li>
            <li>At 7.4 kW, a quarter hour adds about 1.85 kWh, roughly 11 km of range.</li>
          </ul>
          <p>
            <a href={links.liveEv}>See tonight’s cheapest charging hours →</a>
          </p>
        </>
      ),
    },
    da: {
      title: 'Sådan lader du elbilen billigst | wattslot',
      description:
        'Lad elbilen i de billigste kvarterer i stedet for straks, og elregningen for bilen falder med 44–48 %. Det meste kommer af at undgå kl. 17–21. Sådan gør du.',
      heading: 'Sådan lader du elbilen billigst',
      summary:
        'Op til 48 % billigere ved at undgå aftenens spidslast – og hvad smart opladning giver.',
      body: (_g, links) => (
        <>
          <p>
            En elbil er det største fleksible forbrug i de fleste hjem: 3.000 kWh om året er typisk.
            At lade den på det rigtige tidspunkt er mere værd end alt det andet på denne side
            tilsammen.
          </p>
          <h2>Hvad det er værd</h2>
          <p>
            wattslot har regnet et år igennem med rigtige kvarterspriser og nettariffer (oktober
            2025 – september 2026, inkl. moms) for en bil, der lader med 7,4 kW, sættes til kl. 17
            og skal være klar kl. 07:
          </p>
          <SimulationTable l="da" />
          <p>
            Det meste af besparelsen kommer af én ting: ikke at lade mellem kl. 17 og 21. En
            almindelig timer, der starter ved midnat, giver dig det meste; at vælge de billigste
            kvarterer giver omkring 550 kr. mere om året.
          </p>
          <h2>Sådan sætter du det op</h2>
          <ul>
            <li>Nemmest: sæt bilens eller laderens timer til at starte kl. 00.</li>
            <li>
              Bedre: en lader eller app, der lader i de billigste kvarterer – helst efter den fulde
              pris inkl. din nettarif og ikke kun spotprisen. De to vælger tit forskellige timer.
            </li>
            <li>Ved 7,4 kW giver et kvarter omkring 1,85 kWh, cirka 11 km rækkevidde.</li>
          </ul>
          <p>
            <a href={links.liveEv}>Se nattens billigste timer til opladning →</a>
          </p>
        </>
      ),
    },
  },
  tarifmodel: {
    en: {
      title: 'Tarifmodel 3.0 explained: grid tariff by hour | wattslot',
      description:
        'The Danish grid tariff has three time bands: low 00–06, high 06–17 and 21–24, peak 17–21, with higher winter prices. What they cost at the largest companies.',
      heading: 'Tarifmodel 3.0 explained',
      summary: 'The grid tariff’s three time bands, and what they cost at the largest companies.',
      body: (g, links) => {
        const big = g.tariffs[0];
        return (
          <>
            <p>
              Tarifmodel 3.0 is the structure most Danish grid companies use for household grid
              tariffs. It splits the day into three bands:
            </p>
            <ul>
              <li>
                <strong>Low</strong>: 00–06
              </li>
              <li>
                <strong>High</strong>: 06–17 and 21–24
              </li>
              <li>
                <strong>Peak</strong>: 17–21
              </li>
            </ul>
            <p>
              Prices are higher in winter (October–March) than in summer. Each grid company sets its
              own prices within the model.
            </p>
            <h2>Why there is a peak</h2>
            <p>
              The local grid is busiest in the early evening, when people come home, cook and plug
              in their cars. A high price from 17 to 21 pays for the grid capacity that peak needs,
              and rewards moving use to other hours.
            </p>
            <h2>The largest grid companies today</h2>
            <TariffList g={g} l="en" links={links} />
            <p>
              All {g.tariffs.length} grid companies wattslot covers follow these bands
              {g.flat.length > 0 &&
                `; ${g.flat.length} of them charge one price around the clock (${g.flat.join(', ')})`}
              . <a href={links.companies}>Every grid company and its tariff</a>.
            </p>
            {big && g.next && (
              <>
                <h2>Summer and winter</h2>
                <p>
                  At {big.name}, the peak tariff changes from {ore(big.peak, 'en', true)} to{' '}
                  {ore(g.next.peak, 'en', true)} øre/kWh including VAT on{' '}
                  {calendarDate(g.next.from, 'en')}.
                </p>
              </>
            )}
            {big && (
              <>
                <h2>What it means for you</h2>
                <p>
                  Moving 1 kWh from the peak to the night saves{' '}
                  {ore(big.peak - big.low, 'en', true)} øre in grid tariff alone at {big.name}{' '}
                  today, VAT included — before any difference in the spot price.{' '}
                  <a href={links.guide('cheapest')}>When electricity is cheapest</a>.
                </p>
              </>
            )}
          </>
        );
      },
    },
    da: {
      title: 'Tarifmodel 3.0 forklaret: nettarif pr. time | wattslot',
      description:
        'Nettariffen har tre tidsrum: lav kl. 00–06, høj kl. 06–17 og 21–24, spids kl. 17–21, og højere priser om vinteren. Se priserne hos de største netselskaber.',
      heading: 'Tarifmodel 3.0 forklaret',
      summary: 'Nettariffens tre tidsrum, og hvad de koster hos de største netselskaber.',
      body: (g, links) => {
        const big = g.tariffs[0];
        return (
          <>
            <p>
              Tarifmodel 3.0 er den model, de fleste danske netselskaber bruger til husstandes
              nettarif. Den deler døgnet i tre tidsrum:
            </p>
            <ul>
              <li>
                <strong>Lav</strong>: kl. 00–06
              </li>
              <li>
                <strong>Høj</strong>: kl. 06–17 og 21–24
              </li>
              <li>
                <strong>Spids</strong>: kl. 17–21
              </li>
            </ul>
            <p>
              Priserne er højere om vinteren (oktober–marts) end om sommeren. Hvert netselskab
              fastsætter sine egne priser inden for modellen.
            </p>
            <h2>Derfor er der en spidslast</h2>
            <p>
              Elnettet har mest at lave sidst på eftermiddagen, når folk kommer hjem, laver mad og
              sætter bilen til. En høj pris fra kl. 17 til 21 betaler for den kapacitet, spidsen
              kræver, og belønner at flytte forbruget til andre timer.
            </p>
            <h2>De største netselskaber i dag</h2>
            <TariffList g={g} l="da" links={links} />
            <p>
              Alle {g.tariffs.length} netselskaber, wattslot dækker, følger disse tidsrum
              {g.flat.length > 0 &&
                `; ${g.flat.length} af dem har én pris hele døgnet (${g.flat.join(', ')})`}
              . <a href={links.companies}>Alle netselskaber og deres tarif</a>.
            </p>
            {big && g.next && (
              <>
                <h2>Sommer og vinter</h2>
                <p>
                  Hos {big.name} ændres spidstariffen fra {ore(big.peak, 'da', true)} til{' '}
                  {ore(g.next.peak, 'da', true)} øre/kWh inkl. moms den{' '}
                  {calendarDate(g.next.from, 'da')}.
                </p>
              </>
            )}
            {big && (
              <>
                <h2>Hvad det betyder for dig</h2>
                <p>
                  Flytter du 1 kWh fra spidslasten til natten, sparer du{' '}
                  {ore(big.peak - big.low, 'da', true)} øre i nettarif alene hos {big.name} i dag,
                  inkl. moms – før en eventuel forskel i spotprisen.{' '}
                  <a href={links.guide('cheapest')}>Hvornår strømmen er billigst</a>.
                </p>
              </>
            )}
          </>
        );
      },
    },
  },
  'quarter-hours': {
    en: {
      title: 'Electricity prices per 15 minutes since 2025 | wattslot',
      description:
        'Since 1 October 2025 the spot price is set for every 15 minutes instead of every hour. What changed, what didn’t, and how much the price moves within an hour.',
      heading: 'Prices per 15 minutes',
      summary: 'Since October 2025 the spot price changes every quarter hour. What that means.',
      body: (g, links) => (
        <>
          <p>
            Since 1 October 2025, the day-ahead market that sets the Danish spot price works in
            15-minute periods instead of hours. Each day now has 96 prices instead of 24.
          </p>
          <h2>What changed</h2>
          <ul>
            <li>The spot price can change four times an hour.</li>
            <li>
              Energinet’s hourly dataset (Elspotprices) stopped on 30 September 2025; the new one,
              DayAheadPrices, has the quarter-hour prices.
            </li>
          </ul>
          <h2>What didn’t</h2>
          <ul>
            <li>Grid tariffs are still set per hour, in the same time bands.</li>
            <li>Tomorrow’s prices are still published once a day, around 13:00.</li>
          </ul>
          {g.jump && (
            <>
              <h2>How much it moves</h2>
              <p>
                In DK2 today, the biggest difference between quarter hours of the same hour was{' '}
                {price(g.jump.max - g.jump.min, 'en')} DKK/kWh: {price(g.jump.min, 'en')} at{' '}
                {clock(g.jump.minAt, TZ)} against {price(g.jump.max, 'en')} at{' '}
                {clock(g.jump.maxAt, TZ)}.
              </p>
            </>
          )}
          <h2>What it means for you</h2>
          <p>
            For short tasks, starting on the right quarter hour can matter, not just the right hour.
            wattslot plans in quarter hours, and an electric car can pause between them to use only
            the cheapest. <a href={links.live}>See today’s quarter-hour prices →</a>
          </p>
          <p>
            <a href={links.method}>How wattslot calculates the price</a>.
          </p>
        </>
      ),
    },
    da: {
      title: 'Kvarterspriser: elprisen pr. 15 minutter | wattslot',
      description:
        'Siden 1. oktober 2025 fastsættes spotprisen for hvert kvarter i stedet for hver time. Hvad der er ændret, hvad der ikke er, og hvor meget prisen svinger.',
      heading: 'Kvarterspriser: elprisen pr. 15 minutter',
      summary: 'Siden oktober 2025 skifter spotprisen hvert kvarter. Hvad det betyder.',
      body: (g, links) => (
        <>
          <p>
            Siden 1. oktober 2025 har det marked, der fastsætter den danske spotpris dagen før,
            arbejdet i kvarterer i stedet for timer. Hvert døgn har nu 96 priser i stedet for 24.
          </p>
          <h2>Det er ændret</h2>
          <ul>
            <li>Spotprisen kan skifte fire gange i timen.</li>
            <li>
              Energinets timedatasæt (Elspotprices) stoppede 30. september 2025; det nye,
              DayAheadPrices, har kvarterspriserne.
            </li>
          </ul>
          <h2>Det er ikke ændret</h2>
          <ul>
            <li>Nettarifferne gælder stadig pr. time, i de samme tidsrum.</li>
            <li>Morgendagens priser offentliggøres stadig én gang dagligt, omkring kl. 13.</li>
          </ul>
          {g.jump && (
            <>
              <h2>Så meget svinger den</h2>
              <p>
                I DK2 var den største forskel mellem kvarterer i samme time i dag{' '}
                {price(g.jump.max - g.jump.min, 'da')} kr./kWh: {price(g.jump.min, 'da')} kl.{' '}
                {clock(g.jump.minAt, TZ)} mod {price(g.jump.max, 'da')} kl.{' '}
                {clock(g.jump.maxAt, TZ)}.
              </p>
            </>
          )}
          <h2>Hvad det betyder for dig</h2>
          <p>
            For korte opgaver kan det betale sig at starte i det rigtige kvarter, ikke bare den
            rigtige time. wattslot planlægger i kvarterer, og en elbil kan holde pause mellem dem og
            kun bruge de billigste. <a href={links.live}>Se dagens kvarterspriser →</a>
          </p>
          <p>
            <a href={links.method}>Sådan beregner wattslot prisen</a>.
          </p>
        </>
      ),
    },
  },
};
