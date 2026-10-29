import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/** Wednesday 28 Oct 2026, 12:00 in Copenhagen — the day the fixtures cover. */
const NOON = new Date('2026-10-28T11:00:00Z');
const RADIUS = '5790000705689';
const N1 = '5790001089030';

async function open(page: Page, path = '/') {
  await page.clock.setFixedTime(NOON);
  await page.goto(path);
  await expect(page.getByRole('slider')).toBeVisible();
}

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) < 640;

test('answers "is now a good time?" with today’s price', async ({ page }) => {
  await open(page);
  const hero = page.getByRole('article').first();
  await expect(hero).toContainText(/\d\.\d\d\s*DKK\/kWh/);
  await expect(hero).toContainText('until 12:15');
  await expect(hero).toContainText(/Good time to use power|Wait until \d\d:\d\d — \d+% cheaper/);
});

test('shows the evening peak from the worked example', async ({ page }) => {
  await open(page);
  const peak = page.locator('p.label', { hasText: 'Most expensive' }).locator('..');
  await expect(peak).toContainText('18:00');
  await expect(peak).toContainText('4.35 DKK/kWh');
});

test('plans the dishwasher in kroner, and an EV charge that can pause', async ({ page }) => {
  await open(page);
  const planner = page.getByRole('article').nth(1);
  await expect(planner).toContainText(/Start at\s*\d\d:\d\d/);
  await expect(planner).toContainText(/costs\s*\d+\.\d\d kr\./);
  await expect(planner).toContainText('Assumes about 1.1 kWh over 2 hours.');

  await planner.getByRole('tab', { name: 'EV charge' }).click();
  await expect(planner).toContainText('Charge in the cheapest quarter hours');
  await expect(planner).toContainText('20 kWh');
});

test('remembers choices in the URL', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Washing machine' }).click();
  await expect(page).toHaveURL(/task=washing/);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Washing machine' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('falls back to spot prices, and says so, for a grid company without current tariffs', async ({
  page,
}) => {
  await open(page, `/?zone=DK1&gln=${N1}`);
  await expect(page.getByRole('status')).toContainText('Spot price only');
});

test('finds a grid company by typing, and switches price area', async ({ page }) => {
  await open(page);
  await page.getByRole('combobox', { name: 'Grid company' }).click();
  await page.keyboard.type('ceri');
  await page.getByRole('option', { name: /Cerius A\/S/ }).click();
  await expect(page).toHaveURL(/gln=5790000705184/);
  await expect(page.getByRole('combobox', { name: 'Grid company' })).toHaveText(/Cerius A\/S/);

  await page.getByRole('combobox', { name: 'Price area' }).click();
  await page.getByRole('option', { name: 'DK1 · West Denmark' }).click();
  await expect(page).toHaveURL(/zone=DK1/);
  await expect(page.getByRole('combobox', { name: 'Grid company' })).not.toHaveText(/Cerius/);
});

test('keeps tomorrow disabled until its prices are published', async ({ page }) => {
  await open(page);
  const tomorrow = page.getByRole('tab', { name: 'Tomorrow' });
  await expect(tomorrow).toBeDisabled();
  await expect(tomorrow).toHaveAttribute('title', /published around 13:00/);
});

test('switches the chart between price level and what you pay for', async ({ page }) => {
  await open(page);
  await expect(page.getByText('Expensive', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'What you pay for' }).click();
  await expect(page.getByText('Grid tariff').first()).toBeVisible();
  await expect(page).toHaveURL(/view=breakdown/);
});

test('can be read with the keyboard', async ({ page }) => {
  await open(page);
  const slider = page.getByRole('slider');
  await slider.focus();
  await page.keyboard.press('Home');
  // Quarter hours on wide screens, whole hours on phones.
  await expect(slider).toHaveAttribute('aria-valuetext', /^00:00–0[01]:(15|00):/);
  await page.keyboard.press('End');
  await expect(slider).toHaveAttribute('aria-valuetext', /^23:(45|00)–00:00:/);
});

test('uses quarter hours on wide screens and hours on phones', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('slider')).toHaveAttribute('data-bars', isMobile(page) ? '24' : '96');
});

test('keeps the answer in view on phones', async ({ page }) => {
  test.skip(!isMobile(page), 'phones only');
  await open(page);
  await page.mouse.wheel(0, 1500);
  await expect(page.locator('.sticky').first()).toBeInViewport();
});

test('speaks Danish on /da/', async ({ page }) => {
  await open(page, `/da/?zone=DK2&gln=${RADIUS}`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'da');
  const peak = page.locator('p.label', { hasText: 'Dyreste' }).locator('..');
  await expect(peak).toContainText('4,35 kr./kWh');
  await expect(page.getByRole('tab', { name: 'Opvaskemaskine' })).toBeVisible();
});

test('has no detectable accessibility problems', async ({ page }) => {
  await open(page);
  // Audit the settled page: mid-fade text is partly transparent and would read as low contrast.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running'),
  );
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});
