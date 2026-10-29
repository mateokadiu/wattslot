import { GUIDE_KEYS, GUIDE_SLUGS, GUIDES, type GuideKey, type GuideLinks } from '@/content/guides';
import { guideData } from '@/lib/guide-data';
import { dictionaries, LOCALES } from '@/lib/i18n';
import { buildPrices } from '@/lib/load-facts';
import { pageMetadata } from '@/lib/metadata';
import { COMPANIES_HUB, companyRoute, GUIDES_HUB, guideRoute, PAGES } from '@/lib/routes';
import { absolute } from '@/lib/site';
import { pageGraph } from '@/lib/structured-data';
import { Breadcrumbs } from './Breadcrumbs';
import { SiteFrame } from './SiteFrame';

type L = 'en' | 'da';

const HUB = {
  en: {
    crumb: 'Guides',
    title: 'Guides to cheaper electricity | wattslot',
    description:
      'Short guides to paying less for electricity in Denmark: when power is cheapest, charging an EV, the grid tariff’s time bands and 15-minute prices.',
    heading: 'Guides',
    intro: 'Short, practical guides to paying less for electricity, with today’s numbers.',
  },
  da: {
    crumb: 'Guides',
    title: 'Guides til billigere strøm | wattslot',
    description:
      'Korte guides til at betale mindre for strømmen: hvornår den er billigst, opladning af elbil, nettariffens tidsrum og priser pr. kvarter.',
    heading: 'Guides',
    intro: 'Korte, praktiske guides til at betale mindre for strømmen, med dagens tal.',
  },
};

export const guideKeyFor = (locale: L, slug: string): GuideKey => {
  const key = GUIDE_KEYS.find((k) => GUIDE_SLUGS[k][locale] === slug);
  if (!key) throw new Error(`Unknown guide ${slug}`);
  return key;
};

export const guidesHubMetadata = (locale: L) =>
  pageMetadata(locale, GUIDES_HUB, HUB[locale].title, HUB[locale].description);

export const guideMetadata = (key: GuideKey, locale: L) =>
  pageMetadata(
    locale,
    guideRoute(key),
    GUIDES[key][locale].title,
    GUIDES[key][locale].description,
    'article',
  );

const links = (locale: L): GuideLinks => ({
  live: LOCALES[locale].path,
  liveEv: `${LOCALES[locale].path}?task=ev`,
  method: PAGES.method.paths[locale],
  companies: COMPANIES_HUB.paths[locale] ?? '/',
  company: (slug) => companyRoute(slug).paths[locale] ?? '/',
  guide: (key) => guideRoute(key).paths[locale] ?? '/',
});

/** One guide, with today's numbers. */
export function GuidePage({ guide, locale }: { guide: GuideKey; locale: L }) {
  const g = GUIDES[guide][locale];
  const t = dictionaries[locale];
  const route = guideRoute(guide);
  const path = route.paths[locale] ?? '/';
  const crumbs = [
    { name: 'wattslot', href: LOCALES[locale].path },
    { name: HUB[locale].crumb, href: GUIDES_HUB.paths[locale] ?? '/' },
    { name: g.heading, href: path },
  ];
  return (
    <SiteFrame
      locale={locale}
      route={route}
      jsonLd={pageGraph({
        locale,
        url: absolute(path),
        title: g.title,
        description: g.description,
        modified: buildPrices().generatedAt,
        crumbs,
        type: 'Article',
      })}
    >
      <Breadcrumbs items={crumbs} label={t.nav.breadcrumb} />
      <article className="prose max-w-3xl">
        <h1>{g.heading}</h1>
        {g.body(guideData(), links(locale))}
        <p className="byline">
          {locale === 'da'
            ? 'Af Mateo Kadiu. Tallene opdateres dagligt.'
            : 'By Mateo Kadiu. Numbers update daily.'}
        </p>
      </article>
    </SiteFrame>
  );
}

/** The list of guides. */
export function GuidesHub({ locale }: { locale: L }) {
  const h = HUB[locale];
  const t = dictionaries[locale];
  const path = GUIDES_HUB.paths[locale] ?? '/';
  const crumbs = [
    { name: 'wattslot', href: LOCALES[locale].path },
    { name: h.crumb, href: path },
  ];
  return (
    <SiteFrame
      locale={locale}
      route={GUIDES_HUB}
      jsonLd={pageGraph({
        locale,
        url: absolute(path),
        title: h.title,
        description: h.description,
        modified: buildPrices().generatedAt,
        crumbs,
        type: 'CollectionPage',
      })}
    >
      <Breadcrumbs items={crumbs} label={t.nav.breadcrumb} />
      <div className="prose max-w-3xl">
        <h1>{h.heading}</h1>
        <p>{h.intro}</p>
        <ul>
          {GUIDE_KEYS.map((key) => (
            <li key={key}>
              <a href={guideRoute(key).paths[locale]}>{GUIDES[key][locale].heading}</a> –{' '}
              {GUIDES[key][locale].summary}
            </li>
          ))}
        </ul>
      </div>
    </SiteFrame>
  );
}
