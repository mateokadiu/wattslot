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

test.describe('saved plans', () => {
  test('saves a plan, adds it to the calendar, lists it, and cancels it', async ({ page }) => {
    await page.goto('/');
    const dialog = await plan(page, 'Dishwasher');
    await dialog.getByRole('button', { name: 'Save this plan' }).first().click();
    await expect(dialog.getByRole('status')).toContainText('Saved.');

    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Add to calendar' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('wattslot-plan.ics');
    const ics = await (await file.createReadStream()).toArray();
    const text = Buffer.concat(ics).toString('utf8');
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).toContain('SUMMARY:Run the dishwasher');

    await page.keyboard.press('Escape');
    const mine = page.getByRole('region', { name: 'My plans' });
    await expect(mine).toContainText('Dishwasher');
    await expect(mine).toContainText('Planned');
    await expect(mine).toContainText(/Start .*\d\d:\d\d · done/);

    // Kept in this browser across visits.
    await page.reload();
    await expect(mine).toContainText('Planned');

    await mine.getByRole('button', { name: 'Cancel plan' }).click();
    await expect(mine).toContainText('Cancelled');
    await expect(mine.getByRole('button', { name: 'Cancel plan' })).toHaveCount(0);
  });

  test('deletes everything after asking once', async ({ page }) => {
    await page.goto('/da/');
    await page.getByRole('button', { name: 'Planlæg' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Find det bedste tidspunkt' }).click();
    await dialog.getByRole('button', { name: 'Gem planen' }).first().click();
    await expect(dialog.getByRole('status')).toContainText('Gemt.');
    await page.keyboard.press('Escape');

    const mine = page.getByRole('region', { name: 'Mine planer' });
    await mine.getByRole('button', { name: 'Slet alt' }).click();
    await expect(mine).toContainText('Slet alle dine planer?');
    await mine.getByRole('button', { name: 'Behold dem' }).click();
    await expect(mine).toContainText('Opvaskemaskine');
    await mine.getByRole('button', { name: 'Slet alt' }).click();
    await mine.getByRole('button', { name: 'Ja, slet' }).click();
    await expect(mine).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('wattslot:owner'))).toBeNull();
  });

  test('loads nothing about plans in a browser that never saved one', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(new URL(r.url()).pathname));
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Plan it' })).toBeVisible();
    expect(requests.filter((p) => p.startsWith('/v1/jobs') || p.startsWith('/v1/owners'))).toEqual(
      [],
    );
    await expect(page.getByRole('region', { name: 'My plans' })).toHaveCount(0);
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`My plans has no accessibility violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto('/');
      const dialog = await plan(page, 'EV charge');
      await dialog.getByRole('button', { name: 'Save this plan' }).first().click();
      await expect(dialog.getByRole('status')).toContainText('Saved.');
      await page.keyboard.press('Escape');
      const mine = page.getByRole('region', { name: 'My plans' });
      await mine.getByRole('button', { name: 'Delete everything' }).click();
      await expect(mine).toContainText('Delete all your plans?');
      await page.waitForFunction(() =>
        document.getAnimations().every((a) => a.playState !== 'running'),
      );
      const results = await new AxeBuilder({ page }).include('#my-plans-section').analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    });
  }
});

test.describe('notifications', () => {
  // Headless browsers can't reach a real push service, and headless Chromium reports the
  // notification permission as denied whatever is granted. So the permission prompt and the
  // PushManager are replaced; everything else (service worker, API) is real.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      let permission: NotificationPermission = 'default';
      Object.defineProperty(Notification, 'permission', { get: () => permission });
      Notification.requestPermission = async () => {
        permission = 'granted';
        return permission;
      };
      let current: PushSubscription | null = null;
      PushManager.prototype.subscribe = async (options) => {
        const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${Math.random().toString(36).slice(2)}`;
        current = {
          endpoint,
          options: { applicationServerKey: options?.applicationServerKey ?? null },
          toJSON: () => ({
            endpoint,
            keys: { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) },
          }),
          unsubscribe: async () => {
            current = null;
            return true;
          },
        } as unknown as PushSubscription;
        return current;
      };
      PushManager.prototype.getSubscription = async () => current;
    });
  });

  test('turns notifications on for this device after saving, and off again', async ({ page }) => {
    await page.goto('/');
    const dialog = await plan(page, 'EV charge');
    await dialog.getByRole('button', { name: 'Save this plan' }).first().click();
    await dialog.getByRole('button', { name: 'Notify me on this device' }).click();
    await expect(dialog).toContainText('Notifications are on for this device.');
    expect(
      await page.evaluate(
        async () => (await navigator.serviceWorker.getRegistration('/'))?.active?.scriptURL,
      ),
    ).toMatch(/\/sw\.js$/);

    await page.keyboard.press('Escape');
    const mine = page.getByRole('region', { name: 'My plans' });
    await expect(mine).toContainText('Notifications are on for this device.');
    await mine.getByRole('button', { name: 'Turn off' }).click();
    await expect(mine.getByRole('button', { name: 'Notify me on this device' })).toBeVisible();
  });

  test('says when notifications are blocked', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Notification, 'permission', { get: () => 'denied' });
      Notification.requestPermission = async () => 'denied';
    });
    await page.goto('/');
    const dialog = await plan(page, 'Dishwasher');
    await dialog.getByRole('button', { name: 'Save this plan' }).first().click();
    await expect(dialog).toContainText('Notifications are blocked for this site');
  });
});

test('points iPhone users to the Home Screen, where notifications work', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15',
    });
    // Safari outside a Home Screen app has no PushManager.
    delete (window as { PushManager?: unknown }).PushManager;
  });
  await page.goto('/');
  const dialog = await plan(page, 'Dishwasher');
  await dialog.getByRole('button', { name: 'Save this plan' }).first().click();
  await expect(dialog).toContainText('Add to Home Screen');
});

test('serves a service worker that only shows notifications', async ({ request }) => {
  const response = await request.get('/sw.js');
  expect(response.status()).toBe(200);
  const script = await response.text();
  expect(script).toContain("addEventListener('push'");
  expect(script).not.toContain("addEventListener('fetch'");
});
