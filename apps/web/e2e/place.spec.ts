import { expect, type Page, test } from '@playwright/test';

// Navigation and "my place": the grid company a visitor chose, remembered in this browser.

/** Wednesday 28 Oct 2026, 12:00 in Copenhagen — the day the fixtures cover. */
const NOON = new Date('2026-10-28T11:00:00Z');
const N1 = '5790001089030';

async function visit(page: Page, path: string) {
  await page.clock.setFixedTime(NOON);
  await page.goto(path);
}

const chip = (page: Page) =>
  page.getByRole('link', { name: /^(Your|Dit) (grid company|netselskab)/ });

test.describe('navigation', () => {
  for (const { path, current } of [
    { path: '/', current: 'Prices' },
    { path: '/electricity-price/dk1/', current: 'Prices' },
    { path: '/outages/', current: 'Outages' },
    { path: '/grid-companies/', current: 'Grid companies' },
    { path: '/grid-companies/radius-elnet/', current: 'Grid companies' },
    { path: '/guides/tarifmodel-3/', current: 'Guides' },
  ]) {
    test(`marks ${current} as the current section on ${path}`, async ({ page }) => {
      await visit(page, path);
      const sections = page.getByRole('navigation', { name: 'Sections' });
      await expect(sections.getByRole('link')).toHaveText([
        'Prices',
        'Outages',
        'Grid companies',
        'Guides',
      ]);
      await expect(sections.getByRole('link', { name: current })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });
  }

  test('speaks the page’s language and leads to its own sections', async ({ page }) => {
    await visit(page, '/da/om/');
    const sections = page.getByRole('navigation', { name: 'Sektioner' });
    await expect(sections.getByRole('link')).toHaveText([
      'Elpris',
      'Strømafbrud',
      'Netselskaber',
      'Guides',
    ]);
    await expect(sections.getByRole('link', { name: 'Netselskaber' })).toHaveAttribute(
      'href',
      '/da/netselskaber/',
    );
    await expect(sections.locator('[aria-current]')).toHaveCount(0);
  });
});

test.describe('my place', () => {
  test('stays hidden until the visitor chooses', async ({ page }) => {
    await visit(page, '/');
    await expect(page.getByRole('slider')).toBeVisible();
    await expect(chip(page)).toHaveCount(0);
  });

  test('a grid company page remembers “this is my grid company”', async ({ page }) => {
    await visit(page, '/da/netselskaber/radius-elnet/');
    await page.getByRole('button', { name: 'Det er mit netselskab' }).click();
    await expect(page.getByText('Dit netselskab', { exact: true })).toBeVisible();
    await expect(chip(page).first()).toHaveAccessibleName('Dit netselskab: Radius Elnet');

    // The live view opens on it, and other pages show it too.
    await page.getByRole('link', { name: 'Se prisen lige nu med Radius Elnet →' }).click();
    await expect(page.getByRole('combobox', { name: 'Netselskab' })).toHaveText(/Radius Elnet/);
    await page.goto('/da/guides/');
    await expect(chip(page).first()).toBeVisible();
  });

  test('picking a company in the live view makes it yours', async ({ page }) => {
    await visit(page, '/');
    await expect(page.getByRole('slider')).toBeVisible();
    await page.getByRole('combobox', { name: 'Grid company' }).click();
    await page.keyboard.type('ceri');
    await page.getByRole('option', { name: /Cerius A\/S/ }).click();
    await expect(chip(page).first()).toHaveAccessibleName('Your grid company: Cerius');
  });

  test('can be forgotten from the header or the company page', async ({ page }) => {
    await visit(page, '/da/netselskaber/radius-elnet/');
    await page.getByRole('button', { name: 'Det er mit netselskab' }).click();
    await page
      .getByRole('button', { name: 'Glem dit netselskab' })
      .filter({ visible: true })
      .first()
      .click();
    await expect(chip(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Det er mit netselskab' })).toBeVisible();

    // And from the chip, on any page.
    await page.getByRole('button', { name: 'Det er mit netselskab' }).click();
    await page.goto('/da/guides/');
    await page
      .getByRole('button', { name: 'Glem dit netselskab' })
      .filter({ visible: true })
      .first()
      .click();
    await expect(chip(page)).toHaveCount(0);
  });

  test('a shared link shows another place without replacing yours', async ({ page }) => {
    await visit(page, '/grid-companies/radius-elnet/');
    await page.getByRole('button', { name: 'This is my grid company' }).click();

    await page.goto(`/?zone=DK1&gln=${N1}`);
    await expect(page.getByRole('combobox', { name: 'Grid company' })).toHaveText(/N1 A\/S/);
    await expect(chip(page).first()).toHaveAccessibleName('Your grid company: Radius Elnet');

    await page.goto('/');
    await expect(page.getByRole('combobox', { name: 'Grid company' })).toHaveText(/Radius Elnet/);
  });
});
