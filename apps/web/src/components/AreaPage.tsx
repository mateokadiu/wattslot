import { type AreaCode, DIRECTORY } from '@/content/directory';
import { dictionaries, LOCALES } from '@/lib/i18n';
import { areaFacts, buildPrices, companies } from '@/lib/load-facts';
import { pageMetadata } from '@/lib/metadata';
import { areaRoute, companyRoute } from '@/lib/routes';
import { absolute } from '@/lib/site';
import { pageGraph } from '@/lib/structured-data';
import { Breadcrumbs } from './Breadcrumbs';
import { DayFacts } from './DayFacts';
import { SiteFrame } from './SiteFrame';

type L = 'en' | 'da';

export function areaMetadata(code: AreaCode, locale: L) {
  const d = DIRECTORY[locale];
  const zone = code.toUpperCase();
  return pageMetadata(
    locale,
    areaRoute(code),
    d.areaTitle(zone, d.region[code]),
    d.areaDescription(zone, d.region[code]),
  );
}

/** One price area: its prices today and tomorrow, and its grid companies. */
export function AreaPage({ code, locale }: { code: AreaCode; locale: L }) {
  const d = DIRECTORY[locale];
  const t = dictionaries[locale];
  const zone = code.toUpperCase();
  const route = areaRoute(code);
  const path = route.paths[locale] ?? '/';
  const days = areaFacts(zone);
  const inArea = companies().filter((c) => c.zone === zone);
  const largest = days[0]?.zones[0]?.company ?? inArea[0]?.legalName ?? '';
  const meters = new Intl.NumberFormat(LOCALES[locale].intl);
  const { generatedAt } = buildPrices();
  const crumbs = [
    { name: 'wattslot', href: LOCALES[locale].path },
    { name: d.areaHeading(zone, d.region[code]), href: path },
  ];
  const live = `${LOCALES[locale].path}?zone=${zone}`;
  return (
    <SiteFrame
      locale={locale}
      route={route}
      jsonLd={pageGraph({
        locale,
        url: absolute(path),
        title: d.areaTitle(zone, d.region[code]),
        description: d.areaDescription(zone, d.region[code]),
        modified: generatedAt,
        crumbs,
      })}
    >
      <Breadcrumbs items={crumbs} label={t.nav.breadcrumb} />
      <div className="prose max-w-3xl">
        <h1>{d.areaHeading(zone, d.region[code])}</h1>
        <p>{d.areaIntro(zone, d.side[code], d.regions[code], largest)}</p>
        <p>
          <a href={live}>{d.live} →</a>
        </p>
      </div>
      <DayFacts locale={locale} days={days} generatedAt={generatedAt} />
      <section className="prose mt-10 max-w-3xl" aria-labelledby="companies">
        <h2 id="companies">{d.areaCompanies(zone)}</h2>
        <ul>
          {inArea.map((c) => (
            <li key={c.slug}>
              <a href={companyRoute(c.slug).paths[locale]}>{c.name}</a>{' '}
              <span className="text-[var(--muted)]">
                · {meters.format(c.meteringPoints)} {d.columns.meters.toLowerCase()}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </SiteFrame>
  );
}
