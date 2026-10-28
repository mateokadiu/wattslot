import { dictionaries, type Locale } from '@/lib/i18n';
import { Dashboard } from './Dashboard';

const REPO = 'https://github.com/mateokadiu/wattslot';

export function Shell({ locale }: { locale: Locale }) {
  const t = dictionaries[locale];
  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
      <header className="flex items-center justify-between py-6">
        <a href={locale === 'da' ? '/da/' : '/'} className="text-lg font-semibold tracking-tight">
          watt<span className="text-[var(--accent)]">slot</span>
        </a>
        <nav className="flex items-center gap-4 text-sm text-[var(--muted)]">
          <a
            href={t.languageHref}
            hrefLang={locale === 'da' ? 'en' : 'da'}
            className="hover:text-[var(--foreground)]"
          >
            {t.language}
          </a>
          <a href={REPO} className="hover:text-[var(--foreground)]">
            GitHub
          </a>
        </nav>
      </header>
      <main>
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">{t.tagline}</h1>
        <p className="mt-3 max-w-3xl text-[var(--muted)]">{t.lede}</p>
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
