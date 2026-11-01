import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

// The "Plan" form against the real API. Planning looks ahead from the real clock, so these tests
// don't fix it: e2e/serve.mjs copies the recorded day onto recent dates to estimate from.

const TASKS = ['Dishwasher', 'Washing machine', 'Tumble dryer', 'EV charge'];

async function plan(page: Page, task: string) {
  await page.getByRole('tab', { name: task }).click();
  await page.getByRole('button', { name: 'Plan it' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`Plan it: ${task}`);
  await dialog.getByRole('button', { name: 'Find the best time' }).click();
  return dialog;
}

for (const task of TASKS) {
  test(`plans the ${task.toLowerCase()} three ways`, async ({ page }) => {
    await page.goto('/');
    const dialog = await plan(page, task);
    const options = dialog.getByRole('listitem');
    await expect(options).toHaveCount(3);
    await expect(dialog.getByRole('heading', { level: 4 })).toHaveText([
      /^Cheapest/,
      /^Balanced/,
      /^Greenest/,
    ]);
    for (const option of await options.all()) {
      await expect(option).toContainText(/\d+\.\d\d kr\./);
      await expect(option).toContainText(/kg CO₂/);
    }
    // The first option always says when; later ones may repeat it.
    await expect(options.first()).toContainText(
      task === 'EV charge' ? /(Charge|Start) .*\d\d:\d\d/ : /Start .+ · done /,
    );
    for (const option of (await options.all()).slice(1)) {
      await expect(option).toContainText(/Same times as above|(Charge|Start) .*\d\d:\d\d/);
    }
  });
}

test('keeps a programme in one run, and lets an EV charge pause', async ({ page }) => {
  await page.goto('/');
  let dialog = await plan(page, 'Dishwasher');
  await expect(dialog.getByRole('listitem').first()).toContainText(/Start .+ · done /);
  await page.keyboard.press('Escape');

  dialog = await plan(page, 'EV charge');
  await expect(dialog.getByRole('checkbox', { name: 'May pause in between' })).toBeChecked();
  await dialog.getByRole('button', { name: '11 kW' }).click();
  await expect(dialog.getByRole('button', { name: '11 kW' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await dialog.getByRole('checkbox', { name: 'May pause in between' }).uncheck();
  await dialog.getByRole('button', { name: 'Find the best time' }).click();
  await expect(dialog.getByRole('listitem').first()).toContainText(/Start .+ · done /);
});

test('says so when there isn’t time before the deadline', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'EV charge' }).click();
  await page.getByRole('button', { name: 'Plan it' }).click();
  const dialog = page.getByRole('dialog');
  // 100 kWh at 3.7 kW takes 27 hours: longer than until the next 07:00, whenever that is.
  await dialog.getByLabel('Energy (kWh)').fill('100');
  await dialog.getByRole('button', { name: '3.7 kW' }).click();
  await dialog.getByRole('button', { name: 'Find the best time' }).click();
  await expect(dialog).toContainText('There isn’t enough time for this before then.');
});

test('plans in Danish on the Danish page', async ({ page }) => {
  await page.goto('/da/');
  await page.getByRole('button', { name: 'Planlæg' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Find det bedste tidspunkt' }).click();
  await expect(dialog.getByRole('heading', { level: 4 })).toHaveText([
    /^Billigst/,
    /^Balanceret/,
    /^Grønnest/,
  ]);
  await expect(dialog.getByRole('listitem').first()).toContainText(
    /Start (i morgen )?kl\. \d\d:\d\d/,
  );
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`has no accessibility violations with a plan shown (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    const dialog = await plan(page, 'EV charge');
    await expect(dialog.getByRole('listitem')).toHaveCount(3);
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState !== 'running'),
    );
    const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}
