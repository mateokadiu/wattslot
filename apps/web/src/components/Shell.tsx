import { dictionaries, LOCALES, type Locale } from '@/lib/i18n';
import { Dashboard } from './Dashboard';

const REPO = 'https://github.com/mateokadiu/wattslot';

export function Shell({ locale }: { locale: Locale }) {
  const t = dictionaries[locale];
  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
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
                      href={l.path}
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
      <main>
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">{t.tagline}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--muted)] sm:text-base">
          {t.lede}
        </p>
        <div className="mt-8">
          <Dashboard locale={locale} />
        </div>
      </main>
      <footer className="mt-12 space-y-1 border-t border-[var(--border)] pt-6 text-xs text-[var(--muted)]">
        <p>{t.footer.data}</p>
        <p>{t.footer.markup}</p>
        <p>{t.footer.affiliation}</p>
        <p className="pt-2">
          <a href={REPO} className="underline hover:text-[var(--foreground)]">
            {t.footer.source}
          </a>{' '}
          (AGPL-3.0) ·{' '}
          <a href="/openapi.json" className="underline hover:text-[var(--foreground)]">
            {t.footer.api}
          </a>
        </p>
      </footer>
    </div>
  );
}
