import { expect, test } from '@playwright/test';

// What search engines and link previews read. Guards against a page quietly losing its
// canonical, a translation or its share card. Runs once (desktop); the HTML is the same on phones.

const SITE = 'https://wattslot.mateokadiu.com';
const PAGES = [
  { path: '/', lang: 'en' },
  { path: '/da/', lang: 'da' },
  { path: '/de/', lang: 'de' },
  { path: '/no/', lang: 'nb' },
  { path: '/sv/', lang: 'sv' },
];
const HREFLANGS = { en: '/', da: '/da/', de: '/de/', nb: '/no/', sv: '/sv/', 'x-default': '/' };

test.skip(({ isMobile }) => isMobile, 'markup is the same on every device');

/** Production URL → the same path on the local server. */
const local = (url: string) => new URL(url).pathname + new URL(url).search;

for (const { path, lang } of PAGES) {
  test(`${path} has complete search and share metadata`, async ({ page, request }) => {
    await page.goto(path);
    const head = page.locator('head');

    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.locator('h1')).toHaveCount(1);

    const title = await page.title();
    expect(title.length, title).toBeLessThanOrEqual(60);
    expect(title).toContain('wattslot');
    const description = await head.locator('meta[name="description"]').getAttribute('content');
    expect(description?.length ?? 0, description ?? '').toBeGreaterThanOrEqual(110);
    expect(description?.length ?? 0, description ?? '').toBeLessThanOrEqual(155);

    const canonical = head.locator('link[rel="canonical"]');
    await expect(canonical).toHaveCount(1);
    await expect(canonical).toHaveAttribute('href', `${SITE}${path}`);

    const alternates = await head
      .locator('link[rel="alternate"][hreflang]')
      .evaluateAll((links) =>
        Object.fromEntries(links.map((l) => [l.getAttribute('hreflang'), l.getAttribute('href')])),
      );
    expect(alternates).toEqual(
      Object.fromEntries(Object.entries(HREFLANGS).map(([k, p]) => [k, `${SITE}${p}`])),
    );

    await expect(head.locator('meta[name="twitter:card"]')).toHaveAttribute(
      'content',
      'summary_large_image',
    );
    const ogImage = await head.locator('meta[property="og:image"]').getAttribute('content');
    expect(ogImage).toBe(`${SITE}/og/${lang}.png`);
    const image = await request.get(local(ogImage ?? ''));
    expect(image.status()).toBe(200);
    expect(image.headers()['content-type']).toBe('image/png');

    const graphs = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((scripts) => scripts.map((s) => JSON.parse(s.textContent ?? '{}')));
    expect(graphs).toHaveLength(1);
    const nodes = graphs[0]['@graph'] as { '@type': string; url?: string }[];
    expect(nodes.map((n) => n['@type']).sort()).toEqual([
      'Dataset',
      'Person',
      'WebApplication',
      'WebPage',
      'WebSite',
    ]);
    expect(nodes.find((n) => n['@type'] === 'WebApplication')?.url).toBe(`${SITE}${path}`);
  });
}

/** Each sitemap entry: its URL and the hreflang → URL map it declares. */
async function sitemapEntries(request: import('@playwright/test').APIRequestContext) {
  const xml = await (await request.get('/sitemap.xml')).text();
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, body = '']) => ({
    loc: /<loc>([^<]+)<\/loc>/.exec(body)?.[1] ?? '',
    alternates: Object.fromEntries(
      [...body.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map(([, l, h]) => [l, h]),
    ),
  }));
}

test('the sitemap lists every page with all its translations', async ({ request }) => {
  const response = await request.get('/sitemap.xml');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('xml');
  const entries = await sitemapEntries(request);
  for (const { path } of PAGES) expect(entries.map((e) => e.loc)).toContain(`${SITE}${path}`);
  for (const entry of entries) {
    // Every page is one of its own translations, and every translation is in the sitemap.
    expect(Object.values(entry.alternates), entry.loc).toContain(entry.loc);
    for (const href of Object.values(entry.alternates)) {
      expect(
        entries.map((e) => e.loc),
        href,
      ).toContain(href);
    }
  }
});

test('every page in the sitemap has a title, description, canonical and twins', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  for (const entry of await sitemapEntries(request)) {
    await page.goto(local(entry.loc));
    const where = entry.loc;
    const title = await page.title();
    expect(title.length, `${where}: ${title}`).toBeLessThanOrEqual(60);
    const description =
      (await page.locator('head meta[name="description"]').getAttribute('content')) ?? '';
    expect(description.length, `${where}: ${description}`).toBeGreaterThanOrEqual(110);
    expect(description.length, `${where}: ${description}`).toBeLessThanOrEqual(160);
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', entry.loc);
    const declared = await page
      .locator('head link[rel="alternate"][hreflang]')
      .evaluateAll((links) =>
        Object.fromEntries(links.map((l) => [l.getAttribute('hreflang'), l.getAttribute('href')])),
      );
    expect(declared, where).toEqual(entry.alternates);
    await expect(page.locator('h1'), where).toHaveCount(1);
    const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
    expect(() => JSON.parse(jsonLd ?? ''), where).not.toThrow();
  }
});

test('robots.txt allows crawling and points at the sitemap', async ({ request }) => {
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain('Allow: /');
  expect(robots).not.toMatch(/Disallow:\s*\/\S/);
  expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
});

test('every icon the manifest and pages point at exists', async ({ page, request }) => {
  await page.goto('/');
  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  const manifest = (await (await request.get('/manifest.webmanifest')).json()) as {
    icons: { src: string; type: string }[];
  };
  for (const src of [apple ?? '', ...manifest.icons.map((i) => i.src)]) {
    const response = await request.get(src);
    expect(response.status(), src).toBe(200);
    expect(response.headers()['content-type'], src).toMatch(/^image\/(png|svg\+xml)/);
  }
});

test('API responses stay out of search results', async ({ request }) => {
  const response = await request.get('/v1/zones');
  expect(response.headers()['x-robots-tag']).toBe('noindex');
});

test.describe('prices in the HTML', () => {
  // Built from the recorded day (see e2e/fixtures/prices): 28 Oct 2026, with the 29th published.

  test('crawlers get the day’s prices without running JavaScript', async ({ request }) => {
    const html = await (await request.get('/da/')).text();
    expect(html).toContain('Elprisen i dag');
    expect(html).toContain('Elprisen i morgen');
    expect(html).toContain('Billigste 2 timer: kl. 00:00–02:00, i gennemsnit 1,70 kr./kWh.');
    expect(html).toContain('Dyreste time: kl. 18:00–19:00, 4,21 kr./kWh.');
    expect(html).toMatch(/datetime="2026-10-28"/i);
  });

  test('shows an hour-by-hour table for both price areas', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-28T11:00:00Z'));
    await page.goto('/');
    const tables = page.getByRole('table', { name: /Average price per hour/ });
    await expect(tables).toHaveCount(2);
    const today = tables.first();
    await expect(today.getByRole('columnheader')).toHaveText(['Time', 'DK1', 'DK2']);
    await expect(today.getByRole('rowheader')).toHaveCount(24);
    await expect(today.getByRole('row', { name: /^18:00–19:00/ })).toContainText('4.21');
  });

  test('never calls an old day “today” when a rebuild was missed', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-29T11:00:00Z'));
    await page.goto('/da/');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      'Elprisen onsdag 28. oktober',
      'Elprisen i dag',
    ]);
  });
});
