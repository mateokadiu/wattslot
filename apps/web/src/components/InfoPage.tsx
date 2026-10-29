import { INFO, type InfoKey } from '@/content/info';
import { dictionaries, LOCALES } from '@/lib/i18n';
import { buildPrices } from '@/lib/load-facts';
import { pageMetadata } from '@/lib/metadata';
import { PAGES } from '@/lib/routes';
import { absolute } from '@/lib/site';
import { pageGraph } from '@/lib/structured-data';
import { Breadcrumbs } from './Breadcrumbs';
import { SiteFrame } from './SiteFrame';

type InfoLocale = 'en' | 'da';

export const infoMetadata = (page: InfoKey, locale: InfoLocale) => {
  const c = INFO[page][locale];
  return pageMetadata(locale, PAGES[page], c.title, c.description);
};

/** Method, About or Privacy: a page of text in the site frame. */
export function InfoPage({ page, locale }: { page: InfoKey; locale: InfoLocale }) {
  const c = INFO[page][locale];
  const t = dictionaries[locale];
  const route = PAGES[page];
  const path = route.paths[locale];
  const crumbs = [
    { name: 'wattslot', href: LOCALES[locale].path },
    { name: t.nav[page], href: path },
  ];
  const graph = pageGraph({
    locale,
    url: absolute(path),
    title: c.title,
    description: c.description,
    modified: buildPrices().generatedAt,
    crumbs,
    type: page === 'about' ? 'AboutPage' : 'WebPage',
  });
  return (
    <SiteFrame locale={locale} route={route} jsonLd={graph}>
      <Breadcrumbs items={crumbs} label={t.nav.breadcrumb} />
      <article className="prose max-w-3xl">
        <h1>{c.heading}</h1>
        {c.body}
      </article>
    </SiteFrame>
  );
}
