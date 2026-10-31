import { expect, type Page, test } from '@playwright/test';

// Outages come from a faked portal (e2e/serve.mjs) with incidents relative to the real clock:
// an unplanned outage in 2100 (Radius), an announced one in 8000 (N1), one announced for the day
// after tomorrow in 8260 (Dinel), a restored one in 4000 (Cerius) and planned work in 2100 tomorrow.

const board = (page: Page, heading: string) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: heading }) });

test('lists outages happening now first, then announced ones, restored last', async ({ page }) => {
  await page.goto('/da/stroemafbrud/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Strømafbrud lige nu');
  const all = board(page, 'Alle aktuelle afbrud');
  await expect(all.getByRole('listitem')).toHaveCount(4);
  await expect(all.getByRole('listitem').nth(0)).toContainText('Uvarslet afbrud');
  await expect(all.getByRole('listitem').nth(0)).toContainText('Afbrud i Østerbro');
  await expect(all.getByRole('listitem').nth(0)).toContainText('120 kunder');
  await expect(all.getByRole('listitem').nth(1)).toContainText('Varslet afbrud');
  // Announced for later: its time window, not "since".
  await expect(all.getByRole('listitem').nth(2)).toContainText('Afbrud i Viby J');
  await expect(all.getByRole('listitem').nth(2)).not.toContainText('siden');
  await expect(all.getByRole('listitem').nth(2)).toContainText(' – ');
  await expect(all.getByRole('listitem').nth(3)).toContainText('Strømmen er tilbage');
  await expect(page.getByRole('status')).toContainText('Opdateret');
  await expect(
    page.getByRole('navigation', { name: 'Sektioner' }).getByRole('link', { name: 'Strømafbrud' }),
  ).toHaveAttribute('aria-current', 'page');
});

test('a postcode shows the outages and planned work there, and is remembered', async ({ page }) => {
  await page.goto('/da/stroemafbrud/');
  await expect(board(page, 'Planlagt arbejde')).toContainText('Skriv dit postnummer');
  await page.getByLabel('Dit postnummer').fill('2100');
  const here = board(page, 'Postnummer 2100');
  await expect(here.getByRole('listitem')).toHaveCount(1);
  await expect(here).toContainText('Afbrud i Østerbro');
  await expect(board(page, 'Planlagt arbejde')).toContainText('Planlagt arbejde i Østerbro');

  await page.reload();
  await expect(page.getByLabel('Dit postnummer')).toHaveValue('2100');
  await expect(board(page, 'Postnummer 2100')).toContainText('Afbrud i Østerbro');
});

test('every grid company’s fault line is in the page itself', async ({ request }) => {
  const html = await (await request.get('/da/stroemafbrud/')).text();
  expect(html).toContain('Netselskabernes fejlnumre');
  expect(html).toContain('href="tel:+4570205800"');
  expect(html).toContain('Elinord');
});

test('a grid company page shows its outages and planned work', async ({ page }) => {
  await page.goto('/da/netselskaber/radius-elnet/');
  const block = page.locator('section[aria-labelledby="outages"]');
  await expect(block).toContainText('Afbrud i Østerbro');
  await expect(block).toContainText('Planlagt arbejde i Østerbro');
  await expect(block.getByRole('link', { name: '+45 70 20 58 00' })).toHaveAttribute(
    'href',
    'tel:+4570205800',
  );
});

test('a company that doesn’t report outages says where to look instead', async ({ page }) => {
  await page.goto('/grid-companies/elinord/');
  const block = page.locator('section[aria-labelledby="outages"]');
  await expect(block).toContainText('doesn’t report outages to the shared overview');
  await expect(block.getByRole('link', { name: 'Outage page' })).toHaveAttribute(
    'href',
    'https://www.elinord.dk/driftsinformation',
  );
});

test('the header flags an outage at your grid company', async ({ page }) => {
  await page.goto('/grid-companies/radius-elnet/');
  await page.getByRole('button', { name: 'This is my grid company' }).click();
  await expect(
    page.getByRole('link', { name: 'Your grid company: Radius Elnet – power outage now' }).first(),
  ).toBeVisible();
});
