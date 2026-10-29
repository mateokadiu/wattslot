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
      'WebSite',
    ]);
    expect(nodes.find((n) => n['@type'] === 'WebApplication')?.url).toBe(`${SITE}${path}`);
  });
}

test('the sitemap lists every page with all its translations', async ({ request }) => {
  const response = await request.get('/sitemap.xml');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('xml');
  const xml = await response.text();
  for (const { path } of PAGES) expect(xml).toContain(`<loc>${SITE}${path}</loc>`);
  expect(xml.match(/<url>/g)).toHaveLength(PAGES.length);
  expect(xml.match(/hreflang=/g)).toHaveLength(PAGES.length * Object.keys(HREFLANGS).length);
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
