import type { ReactNode } from 'react';
import { dictionaries, LOCALES, type Locale } from '@/lib/i18n';
import { AREAS, areaRoute, COMPANIES_HUB, GUIDES_HUB, PAGES, type Route, twin } from '@/lib/routes';
import { REPO_URL as REPO } from '@/lib/site';
import { jsonLdScript } from '@/lib/structured-data';
import { PlaceChip } from './PlaceChip';

const link = 'underline hover:text-[var(--foreground)]';

/** Which top-level section a page belongs to, for highlighting it in the navigation. */
function sectionOf(route: Route): string | null {
  if (route.key === 'home' || route.key.startsWith('area:')) return 'prices';
  if (route.key === 'companies' || route.key.startsWith('company:')) return 'companies';
  if (route.key === 'guides' || route.key.startsWith('guide:')) return 'guides';
  return null;
}

/** Header, footer and structured data shared by every page. */
export function SiteFrame({
  locale,
  route,
  jsonLd,
  children,
}: {
  locale: Locale;
  route: Route;
  jsonLd: unknown;
  children: ReactNode;
}) {
  const t = dictionaries[locale];
  // Pages without a version in this language link to the English one.
  const page = (r: Route) => r.paths[locale] ?? r.paths.en ?? '/';
  const sections = [
    { key: 'prices', label: t.nav.prices, href: LOCALES[locale].path },
    { key: 'companies', label: t.nav.companies, href: page(COMPANIES_HUB) },
    { key: 'guides', label: t.nav.guides, href: page(GUIDES_HUB) },
  ];
  const current = sectionOf(route);
  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD built from constants, `<` escaped
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 py-5">
        <a href={LOCALES[locale].path} className="font-mono text-base font-semibold tracking-tight">
          watt<span className="text-[var(--accent)]">slot</span>
        </a>
        <nav
          aria-label={t.sections}
          className="order-3 flex w-full items-center gap-1 text-sm sm:order-none sm:w-auto"
        >
          {sections.map((s) => (
            <a
              key={s.key}
              href={s.href}
              aria-current={s.key === current ? 'page' : undefined}
              className={`rounded-md px-2.5 py-1.5 ${
                s.key === current
                  ? 'bg-[var(--card)] font-medium text-[var(--foreground)]'
                  : 'text-[var(--muted)] hover:text-[var(--foreground)]'
              }`}
            >
              {s.label}
            </a>
          ))}
          <PlaceChip locale={locale} className="ml-auto flex sm:hidden" />
        </nav>
        <div className="ml-auto flex items-center gap-4 text-sm text-[var(--muted)]">
          <PlaceChip locale={locale} className="hidden sm:flex" />
          <nav aria-label={t.languages}>
            <ul className="flex items-center gap-0.5 font-mono text-xs">
              {(Object.keys(LOCALES) as Locale[]).map((code) => {
                const l = LOCALES[code];
                const isCurrent = code === locale;
                return (
                  <li key={code}>
                    <a
                      href={twin(route, code)}
                      hrefLang={code}
                      lang={code}
                      title={l.name}
                      aria-current={isCurrent ? 'page' : undefined}
                      className={`block rounded px-1.5 py-1 ${
                        isCurrent
                          ? 'bg-[var(--card)] text-[var(--foreground)]'
                          : 'hover:text-[var(--foreground)]'
                      }`}
                    >
                      {l.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
          <a href={REPO} className="hidden hover:text-[var(--foreground)] sm:inline">
            GitHub
          </a>
        </div>
      </header>
      <main>{children}</main>
      <footer className="mt-12 space-y-1 border-t border-[var(--border)] pt-6 text-xs text-[var(--muted)]">
        <p>{t.footer.data}</p>
        <p>{t.footer.markup}</p>
        <p>{t.footer.affiliation}</p>
        <nav aria-label={t.nav.label} className="space-y-1 pt-2">
          <p>
            {AREAS.map((code) => (
              <span key={code}>
                <a href={page(areaRoute(code))} className={link}>
                  {t.nav.prices} {code.toUpperCase()}
                </a>{' '}
                ·{' '}
              </span>
            ))}
            <a href={page(COMPANIES_HUB)} className={link}>
              {t.nav.companies}
            </a>{' '}
            ·{' '}
            <a href={page(GUIDES_HUB)} className={link}>
              {t.nav.guides}
            </a>
          </p>
          <p>
            <a href={page(PAGES.method)} className={link}>
              {t.nav.method}
            </a>{' '}
            ·{' '}
            <a href={page(PAGES.about)} className={link}>
              {t.nav.about}
            </a>{' '}
            ·{' '}
            <a href={page(PAGES.privacy)} className={link}>
              {t.nav.privacy}
            </a>{' '}
            ·{' '}
            <a href={REPO} className={link}>
              {t.footer.source}
            </a>{' '}
            (AGPL-3.0) ·{' '}
            <a href="/openapi.json" className={link}>
              {t.footer.api}
            </a>
          </p>
        </nav>
      </footer>
    </div>
  );
}
