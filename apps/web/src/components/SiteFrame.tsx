import type { ReactNode } from 'react';
import { dictionaries, LOCALES, type Locale } from '@/lib/i18n';
import { PAGES, type Route, twin } from '@/lib/routes';
import { REPO_URL as REPO } from '@/lib/site';
import { jsonLdScript } from '@/lib/structured-data';

const link = 'underline hover:text-[var(--foreground)]';

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
  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD built from constants, `<` escaped
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
      <header className="flex items-center justify-between py-6">
        <a href={LOCALES[locale].path} className="font-mono text-base font-semibold tracking-tight">
          watt<span className="text-[var(--accent)]">slot</span>
        </a>
        <div className="flex items-center gap-4 text-sm text-[var(--muted)]">
          <nav aria-label={t.languages}>
            <ul className="flex items-center gap-0.5 font-mono text-xs">
              {(Object.keys(LOCALES) as Locale[]).map((code) => {
                const l = LOCALES[code];
                const current = code === locale;
                return (
                  <li key={code}>
                    <a
                      href={twin(route, code)}
                      hrefLang={code}
                      lang={code}
                      title={l.name}
                      aria-current={current ? 'page' : undefined}
                      className={`block rounded px-1.5 py-1 ${
                        current
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
          <a href={REPO} className="hover:text-[var(--foreground)]">
            GitHub
          </a>
        </div>
      </header>
      <main>{children}</main>
      <footer className="mt-12 space-y-1 border-t border-[var(--border)] pt-6 text-xs text-[var(--muted)]">
        <p>{t.footer.data}</p>
        <p>{t.footer.markup}</p>
        <p>{t.footer.affiliation}</p>
        <nav aria-label={t.nav.label} className="pt-2">
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
        </nav>
      </footer>
    </div>
  );
}
