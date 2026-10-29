import { GUIDE_KEYS, GUIDE_SLUGS, type GuideKey } from '@/content/guides';
import { LOCALES, type Locale } from './i18n';
import { companies } from './load-facts';
import { absolute } from './site';

/** One page, published in one or more languages. */
export interface Route {
  key: string;
  paths: Partial<Record<Locale, string>>;
}

const HOME: Route = {
  key: 'home',
  paths: Object.fromEntries(
    (Object.keys(LOCALES) as Locale[]).map((l) => [l, LOCALES[l].path]),
  ) as Route['paths'],
};

/** Pages with a Danish and an English version. */
export const PAGES = {
  method: { key: 'method', paths: { en: '/method/', da: '/da/metode/' } },
  about: { key: 'about', paths: { en: '/about/', da: '/da/om/' } },
  privacy: { key: 'privacy', paths: { en: '/privacy/', da: '/da/privatliv/' } },
} satisfies Record<string, Route>;

export const AREAS = ['dk1', 'dk2'] as const;

export const areaRoute = (code: string): Route => ({
  key: `area:${code}`,
  paths: { en: `/electricity-price/${code}/`, da: `/da/elpris/${code}/` },
});

export const COMPANIES_HUB: Route = {
  key: 'companies',
  paths: { en: '/grid-companies/', da: '/da/netselskaber/' },
};

export const companyRoute = (slug: string): Route => ({
  key: `company:${slug}`,
  paths: { en: `/grid-companies/${slug}/`, da: `/da/netselskaber/${slug}/` },
});

export const GUIDES_HUB: Route = {
  key: 'guides',
  paths: { en: '/guides/', da: '/da/guides/' },
};

export const guideRoute = (key: GuideKey): Route => ({
  key: `guide:${key}`,
  paths: { en: `/guides/${GUIDE_SLUGS[key].en}/`, da: `/da/guides/${GUIDE_SLUGS[key].da}/` },
});

/** Every page on the site: the sitemap and the SEO tests read this list. */
export function allRoutes(): Route[] {
  return [
    HOME,
    ...Object.values(PAGES),
    ...AREAS.map(areaRoute),
    COMPANIES_HUB,
    ...companies().map((c) => companyRoute(c.slug)),
    GUIDES_HUB,
    ...GUIDE_KEYS.map(guideRoute),
  ];
}

export const homeRoute = HOME;

/** hreflang → absolute URL for a page's languages; `x-default` is English, else the first. */
export function alternates(route: Route): Record<string, string> {
  const entries = Object.entries(route.paths).map(([l, p]) => [l, absolute(p)] as const);
  const fallback = route.paths.en ?? entries[0]?.[1] ?? '/';
  return { ...Object.fromEntries(entries), 'x-default': absolute(fallback) };
}

/** Where a language link should go from this page: its twin, or that language's home. */
export const twin = (route: Route, locale: Locale): string =>
  route.paths[locale] ?? LOCALES[locale].path;
