import { OUTAGES_TEXT } from '@/content/outages';
import type { GridCompany } from '@/lib/api';
import { displayName, slugify } from '@/lib/companies';
import { dictionaries, LOCALES } from '@/lib/i18n';
import { buildPrices, companies, gridCompanyList } from '@/lib/load-facts';
import { pageMetadata } from '@/lib/metadata';
import { companyRoute, OUTAGES } from '@/lib/routes';
import { absolute } from '@/lib/site';
import { pageGraph } from '@/lib/structured-data';
import { Breadcrumbs } from './Breadcrumbs';
import { type BoardCompany, OutageBoard } from './OutageBoard';
import { SiteFrame } from './SiteFrame';

type L = 'en' | 'da';

export const outagesMetadata = (locale: L) =>
  pageMetadata(locale, OUTAGES, OUTAGES_TEXT[locale].title, OUTAGES_TEXT[locale].description);

interface Row extends BoardCompany {
  slug: string;
  meteringPoints: number;
  outages: GridCompany['outages'];
}

/** Every grid company (supported or not) as one row, its grid areas merged, largest first. */
function allCompanies(): Row[] {
  const rows = new Map<string, Row>();
  for (const g of gridCompanyList()) {
    const slug = slugify(g.name);
    const row = rows.get(slug);
    if (row) {
      row.glns.push(g.gln);
      row.meteringPoints += g.meteringPoints ?? 0;
      row.outages ??= g.outages ?? null;
    } else {
      rows.set(slug, {
        slug,
        name: displayName(g.name),
        glns: [g.gln],
        meteringPoints: g.meteringPoints ?? 0,
        outages: g.outages ?? null,
      });
    }
  }
  return [...rows.values()].sort((a, b) => b.meteringPoints - a.meteringPoints);
}

const tel = (phone: string) => `tel:${phone.replace(/\s/g, '')}`;

/** The national outage page: live lists, what to do, and every grid company's fault line. */
export function OutagesPage({ locale }: { locale: L }) {
  const x = OUTAGES_TEXT[locale];
  const t = dictionaries[locale];
  const path = OUTAGES.paths[locale] ?? '/';
  const rows = allCompanies();
  const pages = new Set(companies().map((c) => c.slug));
  const crumbs = [
    { name: 'wattslot', href: LOCALES[locale].path },
    { name: t.nav.outages, href: path },
  ];
  return (
    <SiteFrame
      locale={locale}
      route={OUTAGES}
      jsonLd={pageGraph({
        locale,
        url: absolute(path),
        title: x.title,
        description: x.description,
        modified: buildPrices().generatedAt,
        crumbs,
      })}
    >
      <Breadcrumbs items={crumbs} label={t.nav.breadcrumb} />
      <div className="max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight">{x.heading}</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)] sm:text-base">{x.intro}</p>
        <div className="mt-6">
          <OutageBoard locale={locale} companies={rows.map(({ name, glns }) => ({ name, glns }))} />
        </div>
        <p className="mt-6 text-xs text-[var(--muted)]">{x.source}</p>
      </div>

      <div className="prose mt-12 max-w-3xl">
        <h2>{x.whatToDo}</h2>
        <ol>
          {x.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <h2>{x.companiesHeading}</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">{x.columns.company}</th>
              <th scope="col">{x.columns.phone}</th>
              <th scope="col" className="hidden sm:table-cell">
                {x.columns.page}
              </th>
              <th scope="col" className="hidden sm:table-cell">
                {x.columns.reports}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.slug}>
                <th scope="row" className="!whitespace-normal">
                  {pages.has(c.slug) ? (
                    <a href={companyRoute(c.slug).paths[locale]}>{c.name}</a>
                  ) : (
                    c.name
                  )}
                </th>
                <td className="whitespace-nowrap font-mono tabular-nums">
                  {c.outages ? <a href={tel(c.outages.phone)}>{c.outages.phone}</a> : '–'}
                </td>
                <td className="hidden sm:table-cell">
                  {c.outages?.page ? (
                    <a href={c.outages.page} rel="noopener">
                      {x.open}
                    </a>
                  ) : (
                    '–'
                  )}
                </td>
                <td className="hidden sm:table-cell">{c.outages?.reports ? x.yes : x.no}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SiteFrame>
  );
}
