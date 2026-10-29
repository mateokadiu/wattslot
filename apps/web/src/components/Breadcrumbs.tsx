export interface Crumb {
  name: string;
  href: string;
}

/** Visible trail matching the BreadcrumbList in the page's structured data. */
export function Breadcrumbs({ items, label }: { items: Crumb[]; label: string }) {
  return (
    <nav aria-label={label} className="mb-6 text-xs text-[var(--muted)]">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, i) => (
          <li key={item.href} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true">›</span>}
            {i === items.length - 1 ? (
              <span aria-current="page" className="text-[var(--foreground)]">
                {item.name}
              </span>
            ) : (
              <a href={item.href} className="hover:text-[var(--foreground)]">
                {item.name}
              </a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
