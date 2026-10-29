import { DIRECTORY } from '@/content/directory';
import { ore } from '@/lib/format';
import { dictionaries, LOCALES } from '@/lib/i18n';
import { buildPrices, companies, companyPeriods, gridCompanyList } from '@/lib/load-facts';
import { pageMetadata } from '@/lib/metadata';
import { areaRoute, COMPANIES_HUB, companyRoute } from '@/lib/routes';
import { absolute } from '@/lib/site';
import { pageGraph } from '@/lib/structured-data';
import { tariffShape } from '@/lib/tariffs';
import { Breadcrumbs } from './Breadcrumbs';
import { SiteFrame } from './SiteFrame';

type L = 'en' | 'da';

const year = () => buildPrices().date.slice(0, 4);

export function hubMetadata(locale: L) {
  const d = DIRECTORY[locale];
  return pageMetadata(locale, COMPANIES_HUB, d.hubTitle(year()), d.hubDescription(year()));
}

/** Low, high and peak today (one price for a flat tariff), incl. VAT; null if not published. */
function todayBands(gln: string): [number, number, number] | null {
  const today = `${buildPrices().date}T00:00:00`;
  const current = companyPeriods(gln).find(
    (p) => p.validFrom <= today && (p.validTo === null || p.validTo > today),
  );
  if (!current) return null;
  const shape = tariffShape(current.hourly);
  if (shape.kind === 'bands') return [shape.low, shape.high, shape.peak];
  if (shape.kind === 'flat') return [shape.price, shape.price, shape.price];
  return null;
}

/** Every grid company with today's tariff, linking to each one's page. */
export function CompaniesHub({ locale }: { locale: L }) {
  const d = DIRECTORY[locale];
  const t = dictionaries[locale];
  const path = COMPANIES_HUB.paths[locale] ?? '/';
  const meters = new Intl.NumberFormat(LOCALES[locale].intl);
  const unsupported = gridCompanyList().filter((g) => !g.supported);
  const crumbs = [
    { name: 'wattslot', href: LOCALES[locale].path },
    { name: d.hubCrumb, href: path },
  ];
  return (
    <SiteFrame
      locale={locale}
      route={COMPANIES_HUB}
      jsonLd={pageGraph({
        locale,
        url: absolute(path),
        title: d.hubTitle(year()),
        description: d.hubDescription(year()),
        modified: buildPrices().generatedAt,
        crumbs,
        type: 'CollectionPage',
      })}
    >
      <Breadcrumbs items={crumbs} label={t.nav.breadcrumb} />
      <div className="prose max-w-4xl">
        <h1>{d.hubHeading}</h1>
        <p>{d.hubIntro}</p>
        <table>
          <caption className="pb-2 text-left text-xs text-[var(--muted)]">{d.hubCaption}</caption>
          <thead>
            <tr>
              <th scope="col">{d.columns.company}</th>
              <th scope="col" className="hidden sm:table-cell">
                {d.columns.area}
              </th>
              <th scope="col" className="hidden text-right sm:table-cell">
                {d.columns.meters}
              </th>
              <th scope="col" className="text-right">
                {d.columns.low}
              </th>
              <th scope="col" className="text-right">
                {d.columns.high}
              </th>
              <th scope="col" className="text-right">
                {d.columns.peak}
              </th>
            </tr>
          </thead>
          <tbody>
            {companies().map((c) => {
              const bands = todayBands(c.areas[0]?.gln ?? '');
              return (
                <tr key={c.slug}>
                  <th scope="row" className="!whitespace-normal">
                    <a href={companyRoute(c.slug).paths[locale]}>{c.name}</a>
                  </th>
                  <td className="hidden sm:table-cell">
                    <a href={areaRoute(c.zone.toLowerCase()).paths[locale]}>{c.zone}</a>
                  </td>
                  <td className="hidden text-right font-mono tabular-nums sm:table-cell">
                    {meters.format(c.meteringPoints)}
                  </td>
                  {(bands ?? [null, null, null]).map((v, i) => (
                    <td
                      // biome-ignore lint/suspicious/noArrayIndexKey: fixed low/high/peak columns
                      key={i}
                      className="text-right font-mono tabular-nums"
                    >
                      {v === null ? '–' : ore(v, locale, true)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {unsupported.length > 0 && (
          <p className="text-sm text-[var(--muted)]">
            {d.unsupported(unsupported.map((g) => g.name).join(', '))}
          </p>
        )}
      </div>
    </SiteFrame>
  );
}
