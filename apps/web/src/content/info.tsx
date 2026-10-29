import type { ReactNode } from 'react';
import { AUTHOR, REPO_URL } from '@/lib/site';

// Method, About and Privacy, in Danish and English. Facts here are checked against the code
// and PLAN.md; update the "last reviewed" dates when they change.

export type InfoKey = 'method' | 'about' | 'privacy';

export interface InfoContent {
  title: string;
  description: string;
  heading: string;
  body: ReactNode;
}

const ext = (href: string, text: string) => <a href={href}>{text}</a>;
const repo = (text: string) => ext(REPO_URL, text);
const api = (text: string) => ext('/openapi.json', text);
const author = ext(AUTHOR.url, 'mateokadiu.com');
const eds = ext('https://www.energidataservice.dk/', 'Energi Data Service');
const ccBy = ext('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0');

export const INFO: Record<InfoKey, { en: InfoContent; da: InfoContent }> = {
  method: {
    en: {
      title: 'How wattslot calculates the electricity price | wattslot',
      description:
        'What the all-in price per 15 minutes is made of: spot price, grid tariff, Energinet’s tariffs, electricity tax and VAT. Sources, update times, limits.',
      heading: 'How the price is calculated',
      body: (
        <>
          <p>
            wattslot shows the price of a kilowatt-hour as it appears on your bill, for every 15
            minutes: the market price plus everything added to it. This page explains where each
            part comes from and what is left out.
          </p>
          <h2>What’s in the price</h2>
          <table>
            <thead>
              <tr>
                <th scope="col">Part</th>
                <th scope="col">What it is</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Spot price</th>
                <td>
                  The market price for your price area (DK1 west of the Great Belt, DK2 east of it),
                  set the day before in a daily auction. In 15-minute slots since 1 October 2025.
                </td>
                <td>Energinet, DayAheadPrices</td>
              </tr>
              <tr>
                <th scope="row">Grid tariff</th>
                <td>
                  Your grid company’s charge for the local grid. Most use Tarifmodel 3.0: low 00–06,
                  high 06–17 and 21–24, peak 17–21, with higher prices in winter (October–March).
                </td>
                <td>DataHub price list (DatahubPricelist)</td>
              </tr>
              <tr>
                <th scope="row">Energinet’s tariffs</th>
                <td>The transmission grid and system tariffs, the same all over Denmark.</td>
                <td>DatahubPricelist</td>
              </tr>
              <tr>
                <th scope="row">Electricity tax</th>
                <td>The state tax on electricity (elafgift), as listed in DataHub.</td>
                <td>DatahubPricelist</td>
              </tr>
              <tr>
                <th scope="row">VAT</th>
                <td>25% of all of the above.</td>
                <td>–</td>
              </tr>
            </tbody>
          </table>
          <h2>What’s not included</h2>
          <p>
            Your supplier’s markup per kWh, and subscriptions from your supplier or grid company.
            They’re set in your contract, and fixed monthly fees don’t depend on when you use power.
            A fixed markup per kWh adds the same to every quarter hour, so the cheapest time stays
            the cheapest.
          </p>
          <h2>How it’s calculated</h2>
          <ul>
            <li>
              Amounts are kept in whole millionths of a krone, so nothing is lost to rounding along
              the way. VAT is rounded once.
            </li>
            <li>
              Tariffs apply per local hour, so on the days the clocks change, a day has 92 or 100
              quarter hours instead of 96.
            </li>
            <li>
              If a grid company’s tariff can’t be priced reliably — for example because the
              published data contradicts itself — wattslot shows the spot price only and says so,
              rather than a wrong total.
            </li>
          </ul>
          <h2>Coverage</h2>
          <ul>
            <li>
              Tariffs for 31 of Denmark’s 35 grid areas are supported — 28 grid companies, covering
              99.7% of metering points. The others show the spot price only.
            </li>
            <li>Germany, Norway (NO2) and Sweden (SE3, SE4): spot price only.</li>
          </ul>
          <h2>When it’s updated</h2>
          <ul>
            <li>
              Tomorrow’s spot prices are usually published around 13:00. wattslot checks every 5
              minutes from 12:50 to 14:30, then every half hour.
            </li>
            <li>Tariffs are checked every night.</li>
            <li>
              These pages are rebuilt just after midnight and once tomorrow’s prices are out. The
              price view at the top of the home page is always live.
            </li>
          </ul>
          <h2>Sources and licence</h2>
          <ul>
            <li>
              Data from Energinet via {eds}, under {ccBy}. The all-in prices are calculated by
              wattslot from that data; Energinet hasn’t checked or endorsed them.
            </li>
            <li>
              The code is open source on {repo('GitHub')}, and the data is available through the
              public API ({api('OpenAPI document')}).
            </li>
          </ul>
          <p className="byline">Written by Mateo Kadiu. Last reviewed 29 October 2026.</p>
        </>
      ),
    },
    da: {
      title: 'Sådan beregner wattslot elprisen | wattslot',
      description:
        'Hvad den fulde pris pr. kvarter består af: spotpris, nettarif, Energinets tariffer, elafgift og moms. Kilder, opdateringstider og begrænsninger.',
      heading: 'Sådan beregnes prisen',
      body: (
        <>
          <p>
            wattslot viser prisen på en kilowatttime, som den står på din elregning, for hvert
            kvarter: markedsprisen plus alt det, der lægges oven i. Her kan du se, hvor hver del
            kommer fra, og hvad der ikke er med.
          </p>
          <h2>Hvad prisen består af</h2>
          <table>
            <thead>
              <tr>
                <th scope="col">Del</th>
                <th scope="col">Hvad det er</th>
                <th scope="col">Kilde</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Spotpris</th>
                <td>
                  Markedsprisen for dit prisområde (DK1 vest for Storebælt, DK2 øst for), fastsat
                  dagen før på en daglig auktion. I kvarterer siden 1. oktober 2025.
                </td>
                <td>Energinet, DayAheadPrices</td>
              </tr>
              <tr>
                <th scope="row">Nettarif</th>
                <td>
                  Dit netselskabs betaling for det lokale elnet. De fleste bruger Tarifmodel 3.0:
                  lav kl. 00–06, høj kl. 06–17 og 21–24, spids kl. 17–21, med højere priser om
                  vinteren (oktober–marts).
                </td>
                <td>DataHubs prisliste (DatahubPricelist)</td>
              </tr>
              <tr>
                <th scope="row">Energinets tariffer</th>
                <td>Net- og systemtarif for transmissionsnettet, ens i hele Danmark.</td>
                <td>DatahubPricelist</td>
              </tr>
              <tr>
                <th scope="row">Elafgift</th>
                <td>Statens afgift på el, som den står i DataHub.</td>
                <td>DatahubPricelist</td>
              </tr>
              <tr>
                <th scope="row">Moms</th>
                <td>25 % af alt ovenstående.</td>
                <td>–</td>
              </tr>
            </tbody>
          </table>
          <h2>Hvad der ikke er med</h2>
          <p>
            Din elleverandørs tillæg pr. kWh og abonnementer fra elleverandøren eller netselskabet.
            De står i din aftale, og faste månedlige beløb afhænger ikke af, hvornår du bruger
            strøm. Et fast tillæg pr. kWh lægger det samme oven i alle kvarterer, så det billigste
            tidspunkt er stadig det billigste.
          </p>
          <h2>Sådan regnes der</h2>
          <ul>
            <li>
              Alle beløb regnes i hele milliontedele af en krone, så intet går tabt til afrunding
              undervejs. Momsen afrundes én gang.
            </li>
            <li>
              Tarifferne gælder pr. lokal time, så på de dage, hvor uret stilles, har døgnet 92
              eller 100 kvarterer i stedet for 96.
            </li>
            <li>
              Hvis et netselskabs tarif ikke kan beregnes sikkert – for eksempel fordi de
              offentliggjorte data modsiger sig selv – viser wattslot kun spotprisen og skriver det,
              i stedet for en forkert samlet pris.
            </li>
          </ul>
          <h2>Dækning</h2>
          <ul>
            <li>
              Tarifferne for 31 af landets 35 netområder er med – 28 netselskaber, der dækker 99,7 %
              af målepunkterne. For de øvrige vises kun spotprisen.
            </li>
            <li>Tyskland, Norge (NO2) og Sverige (SE3, SE4): kun spotpris.</li>
          </ul>
          <h2>Hvornår der opdateres</h2>
          <ul>
            <li>
              Morgendagens spotpriser offentliggøres normalt omkring kl. 13. wattslot tjekker hvert
              5. minut fra kl. 12.50 til 14.30 og derefter hver halve time.
            </li>
            <li>Tarifferne tjekkes hver nat.</li>
            <li>
              Siderne bygges igen lige efter midnat, og når morgendagens priser er klar.
              Prisvisningen øverst på forsiden er altid aktuel.
            </li>
          </ul>
          <h2>Kilder og licens</h2>
          <ul>
            <li>
              Data fra Energinet via {eds} under licensen {ccBy}. De samlede priser er beregnet af
              wattslot ud fra disse data; Energinet har ikke kontrolleret eller godkendt dem.
            </li>
            <li>
              Koden er åben og ligger på {repo('GitHub')}, og data kan hentes via det åbne API (
              {api('OpenAPI-dokument')}).
            </li>
          </ul>
          <p className="byline">Skrevet af Mateo Kadiu. Senest gennemgået 29. oktober 2026.</p>
        </>
      ),
    },
  },
  about: {
    en: {
      title: 'About wattslot: who makes it and why | wattslot',
      description:
        'wattslot is an open-source tool for using electricity when it’s cheapest, measured by the price you actually pay. Who builds it, why, and how to get in touch.',
      heading: 'About wattslot',
      body: (
        <>
          <p>
            wattslot shows what electricity really costs in each quarter hour — spot price, grid
            tariff, taxes and VAT — and when it’s cheapest to run the dishwasher or washing machine,
            or to charge the car.
          </p>
          <h2>Why</h2>
          <p>
            Most apps show the spot price. But the grid tariff alone can be several times higher in
            the evening peak than at night, so the spot price on its own often points at the wrong
            hour. wattslot adds it all up.
          </p>
          <h2>Who</h2>
          <p>wattslot is built by Mateo Kadiu, a software engineer. More at {author}.</p>
          <h2>Open source</h2>
          <p>
            The code is public on {repo('GitHub')}: the libraries under Apache-2.0, the apps under
            AGPL-3.0. Anyone can see how the price is calculated, report a mistake or run their own
            copy.
          </p>
          <h2>Independent</h2>
          <p>
            wattslot isn’t affiliated with Energinet, any grid company or any electricity supplier.
          </p>
          <h2>Contact</h2>
          <p>
            Found a wrong price, or is your grid company missing?{' '}
            {ext(`${REPO_URL}/issues`, 'Open an issue on GitHub')}.
          </p>
        </>
      ),
    },
    da: {
      title: 'Om wattslot: hvem står bag, og hvorfor | wattslot',
      description:
        'wattslot er et åbent værktøj til at bruge strøm, når den er billigst – målt på den pris, du faktisk betaler. Hvem der laver det, og hvorfor.',
      heading: 'Om wattslot',
      body: (
        <>
          <p>
            wattslot viser, hvad strømmen reelt koster i hvert kvarter – spotpris, nettarif,
            afgifter og moms – og hvornår det er billigst at køre opvaskemaskinen eller
            vaskemaskinen eller at lade bilen.
          </p>
          <h2>Hvorfor</h2>
          <p>
            De fleste apps viser spotprisen. Men nettariffen alene kan være flere gange dyrere i
            aftenens spidslast end om natten, så spotprisen peger tit på det forkerte tidspunkt.
            wattslot lægger det hele sammen.
          </p>
          <h2>Hvem</h2>
          <p>wattslot er lavet af Mateo Kadiu, softwareudvikler. Mere på {author}.</p>
          <h2>Åben kildekode</h2>
          <p>
            Koden ligger offentligt på {repo('GitHub')}: bibliotekerne under Apache-2.0 og apps
            under AGPL-3.0. Alle kan se, hvordan prisen beregnes, melde en fejl eller køre deres
            egen kopi.
          </p>
          <h2>Uafhængig</h2>
          <p>wattslot har ingen tilknytning til Energinet, netselskaber eller elleverandører.</p>
          <h2>Kontakt</h2>
          <p>
            Har du fundet en forkert pris, eller mangler dit netselskab?{' '}
            {ext(`${REPO_URL}/issues`, 'Opret en sag på GitHub')}.
          </p>
        </>
      ),
    },
  },
  privacy: {
    en: {
      title: 'Privacy: no cookies, no accounts | wattslot',
      description:
        'wattslot uses no cookies, no accounts and no tracking. Your choices are kept in your own browser. What is processed when you use the site, and why.',
      heading: 'Privacy',
      body: (
        <>
          <p>
            <strong>
              In short: no cookies, no accounts, no analytics or advertising trackers.
            </strong>
          </p>
          <h2>What stays in your browser</h2>
          <p>
            Your price area, grid company, appliance and chart choice are saved in your browser
            (local storage) and in the page address, so the page opens the way you left it. They
            aren’t sent anywhere, except the price area and grid company in the request for prices,
            which is needed to show them.
          </p>
          <h2>What the server sees</h2>
          <p>
            The site runs on Cloudflare. Like any website, it processes your IP address to deliver
            pages and to protect the site, for example against too many requests. Short-lived
            request logs are kept for a few days to find errors. They aren’t used to identify or
            follow you.
          </p>
          <h2>Who is responsible</h2>
          <p>
            Mateo Kadiu ({author}). Questions can be asked on {repo('GitHub')} or through the
            contact details on {author}.
          </p>
          <h2>Changes</h2>
          <p>
            If this ever changes — for example with cookie-free visitor statistics — this page will
            say so first. Last updated 29 October 2026.
          </p>
        </>
      ),
    },
    da: {
      title: 'Privatliv: ingen cookies, ingen konti | wattslot',
      description:
        'wattslot bruger ingen cookies, ingen konti og ingen sporing. Dine valg gemmes i din egen browser. Her er, hvad der behandles, når du bruger siden.',
      heading: 'Privatliv',
      body: (
        <>
          <p>
            <strong>
              Kort fortalt: ingen cookies, ingen konti, ingen statistik- eller annoncesporing.
            </strong>
          </p>
          <h2>Det, der bliver i din browser</h2>
          <p>
            Dit prisområde, netselskab, apparat og valg af graf gemmes i din browser (local storage)
            og i sidens adresse, så siden åbner, som du forlod den. De sendes ingen steder hen,
            bortset fra prisområde og netselskab i forespørgslen efter priser, som er nødvendig for
            at vise dem.
          </p>
          <h2>Det, serveren ser</h2>
          <p>
            Siden kører hos Cloudflare. Som alle websites behandler den din IP-adresse for at levere
            siderne og beskytte dem, for eksempel mod for mange forespørgsler. Korte logfiler over
            forespørgsler gemmes i nogle dage for at finde fejl. De bruges ikke til at genkende
            eller følge dig.
          </p>
          <h2>Hvem er ansvarlig</h2>
          <p>
            Mateo Kadiu ({author}). Spørgsmål kan stilles på {repo('GitHub')} eller via
            kontaktoplysningerne på {author}.
          </p>
          <h2>Ændringer</h2>
          <p>
            Hvis det her ændrer sig – for eksempel med cookiefri besøgsstatistik – står det på denne
            side først. Senest opdateret 29. oktober 2026.
          </p>
        </>
      ),
    },
  },
};
