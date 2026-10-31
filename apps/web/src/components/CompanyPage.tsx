import { DIRECTORY, firstThatFits } from '@/content/directory';
import { calendarDate, lastDay, ore } from '@/lib/format';
import { dictionaries, LOCALES } from '@/lib/i18n';
import {
  buildPrices,
  companies,
  companyFacts,
  companyPeriods,
  companyTariffs,
  gridCompanyList,
} from '@/lib/load-facts';
import { pageMetadata } from '@/lib/metadata';
import { areaRoute, COMPANIES_HUB, companyRoute } from '@/lib/routes';
import { absolute } from '@/lib/site';
import { pageGraph } from '@/lib/structured-data';
import { type TariffPeriod, tariffShape } from '@/lib/tariffs';
import { Breadcrumbs } from './Breadcrumbs';
import { DayFacts } from './DayFacts';
import { SetPlaceButton } from './SetPlaceButton';
import { SiteFrame } from './SiteFrame';
import { TariffTable } from './TariffTable';

type L = 'en' | 'da';

const companyBySlug = (slug: string) => {
  const company = companies().find((c) => c.slug === slug);
  if (!company) throw new Error(`Unknown grid company page ${slug}`);
  return company;
};

/** Periods valid today or later (the API already drops ended ones; a build can be a day old). */
const upcoming = (periods: TariffPeriod[]) => {
  const today = `${buildPrices().date}T00:00:00`;
  return periods.filter((p) => p.validTo === null || p.validTo > today);
};

const same = (a: TariffPeriod[], b: TariffPeriod[]) =>
  a.length === b.length &&
  a.every(
    (p, i) =>
      p.validFrom === b[i]?.validFrom &&
      p.hourly.every((v, h) => Math.abs(v - (b[i]?.hourly[h] ?? 0)) < 0.0005),
  );

function texts(slug: string, locale: L) {
  const d = DIRECTORY[locale];
  const company = companyBySlug(slug);
  const year = buildPrices().date.slice(0, 4);
  const current = upcoming(companyPeriods(company.areas[0]?.gln ?? ''))[0];
  const shape = current ? tariffShape(current.hourly) : null;
  const o = (v: number) => ore(v, locale, true);
  const bands =
    shape?.kind === 'bands'
      ? d.bands(o(shape.low), o(shape.high), o(shape.peak))
      : shape?.kind === 'flat'
        ? d.flat(o(shape.price))
        : '';
  return {
    company,
    title: firstThatFits(60, d.companyTitles(company.name, year)),
    description: firstThatFits(160, d.companyDescriptions(company.name, bands)),
  };
}

export function companyMetadata(slug: string, locale: L) {
  const { title, description } = texts(slug, locale);
  return pageMetadata(locale, companyRoute(slug), title, description);
}

/** One grid company: its tariff by time band and today's all-in prices with it. */
export function CompanyPage({ slug, locale }: { slug: string; locale: L }) {
  const d = DIRECTORY[locale];
  const t = dictionaries[locale];
  const { company, title, description } = texts(slug, locale);
  const route = companyRoute(slug);
  const path = route.paths[locale] ?? '/';
  const main = company.areas[0];
  const gln = main?.gln ?? '';
  const periods = upcoming(companyPeriods(gln));
  const others = company.areas.slice(1);
  const differing = others.filter((a) => !same(upcoming(companyPeriods(a.gln)), periods));
  const codes = company.areas.map((a) => a.code).filter(Boolean);
  const chargeCodes = companyTariffs(gln)
    .tariffs.map((c) => c.chargeCode)
    .join(', ');
  const { generatedAt, date } = buildPrices();
  const crumbs = [
    { name: 'wattslot', href: LOCALES[locale].path },
    { name: d.hubCrumb, href: COMPANIES_HUB.paths[locale] ?? '/' },
    { name: company.name, href: path },
  ];
  const live = `${LOCALES[locale].path}?zone=${company.zone}&gln=${gln}`;
  return (
    <SiteFrame
      locale={locale}
      route={route}
      jsonLd={pageGraph({
        locale,
        url: absolute(path),
        title,
        description,
        modified: generatedAt,
        crumbs,
        extra: [
          {
            '@type': 'Organization',
            '@id': `${absolute(path)}#company`,
            name: company.legalName,
            identifier: company.areas.map((a) => a.gln),
          },
        ],
      })}
    >
      <Breadcrumbs items={crumbs} label={t.nav.breadcrumb} />
      <div className="prose max-w-3xl">
        <h1>{d.companyHeading(company.name)}</h1>
        <p>
          {d.companyIntro(
            company.name,
            company.zone,
            new Intl.NumberFormat(LOCALES[locale].intl).format(company.meteringPoints),
            company.areas.length,
          )}
        </p>
        <SetPlaceButton
          locale={locale}
          zone={company.zone}
          gln={gln}
          name={gridCompanyList().find((g) => g.gln === gln)?.name ?? company.legalName}
        />
        <p>
          <a href={live}>{d.liveWith(company.name)} →</a>
        </p>
        <h2>{d.tariffHeading}</h2>
        {periods.length === 0 && <p>{d.noTariff}</p>}
        {periods.map((p) => (
          <TariffTable
            key={p.validFrom}
            locale={locale}
            hourly={p.hourly}
            caption={`${d.period(
              calendarDate(p.validFrom, locale),
              p.validTo ? calendarDate(lastDay(p.validTo), locale) : null,
            )} · ${d.unit}`}
          />
        ))}
        {codes.length > 1 && (
          <p className="text-sm text-[var(--muted)]">
            {differing.length === 0
              ? d.allAreas(codes.join(', '))
              : d.otherAreas(differing.map((a) => a.code).join(', '))}
          </p>
        )}
      </div>
      <DayFacts locale={locale} days={companyFacts(gln)} generatedAt={generatedAt} />
      <div className="prose mt-8 max-w-3xl text-sm">
        <p>
          <a href={areaRoute(company.zone.toLowerCase()).paths[locale]}>
            {d.areaHeading(company.zone, d.region[company.zone.toLowerCase() as 'dk1' | 'dk2'])}
          </a>{' '}
          · <a href={COMPANIES_HUB.paths[locale]}>{d.hubHeading}</a>
        </p>
        <p className="text-xs text-[var(--muted)]">
          {d.source(chargeCodes, calendarDate(date, locale))}
        </p>
      </div>
    </SiteFrame>
  );
}
