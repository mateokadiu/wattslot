import { createRoute, z } from '@hono/zod-openapi';
import { requireOwner } from '../owners/auth.ts';
import { pushConfig } from '../push/send.ts';
import {
  addSubscription,
  isPushEndpoint,
  MAX_DEVICES,
  removeSubscription,
} from '../push/subscriptions.ts';
import { ErrorBody, router } from '../router.ts';

// Devices for notifications (PLAN.md §17.7, P2c). A device subscribes with the browser's own
// push service; wattslot then sends each saved plan's moments to it.

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ErrorBody } },
});
const bearer = [{ ownerToken: [] }];
const base64url = (length: number) => z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${length}}$`));

const Subscription = z
  .object({
    endpoint: z.url().max(1024),
    keys: z.object({ p256dh: base64url(87), auth: base64url(22) }),
  })
  .openapi('PushSubscription');

const keyRoute = createRoute({
  method: 'get',
  path: '/push/key',
  summary: 'The public key browsers subscribe with (VAPID)',
  responses: {
    200: {
      description: 'Base64url, uncompressed P-256 point',
      content: { 'application/json': { schema: z.object({ publicKey: z.string() }) } },
    },
    404: error('Notifications are off'),
  },
});

const subscribeRoute = createRoute({
  method: 'post',
  path: '/push/subscriptions',
  summary: 'Get notifications on this device',
  description: `Only endpoints of the browsers' push services are accepted. At most ${MAX_DEVICES} devices per owner.`,
  security: bearer,
  request: {
    body: { content: { 'application/json': { schema: Subscription } }, required: true },
  },
  responses: {
    201: { description: 'Subscribed', content: { 'application/json': { schema: z.object({}) } } },
    400: error('Invalid subscription, or not a known push service'),
    401: error('No valid owner token'),
    429: error('Too many devices'),
    503: error('Notifications are off'),
  },
});

const unsubscribeRoute = createRoute({
  method: 'delete',
  path: '/push/subscriptions',
  summary: 'Stop notifications on this device',
  security: bearer,
  request: {
    body: {
      content: { 'application/json': { schema: z.object({ endpoint: z.url().max(1024) }) } },
      required: true,
    },
  },
  responses: { 204: { description: 'Unsubscribed' }, 401: error('No valid owner token') },
});

export const pushRoutes = router();
pushRoutes.use('/push/subscriptions', requireOwner);

pushRoutes
  .openapi(keyRoute, (c) => {
    const config = pushConfig(c.env);
    if (!config) {
      c.header('Cache-Control', 'no-store');
      return c.json({ error: 'push_off', message: 'Notifications are off.' }, 404);
    }
    c.header('Cache-Control', 'public, max-age=3600');
    return c.json({ publicKey: config.keys.publicKey }, 200);
  })
  .openapi(subscribeRoute, async (c) => {
    const config = pushConfig(c.env);
    if (!config) return c.json({ error: 'push_off', message: 'Notifications are off.' }, 503);
    const subscription = c.req.valid('json');
    if (!isPushEndpoint(subscription.endpoint)) {
      return c.json(
        { error: 'invalid_request', message: 'Not the endpoint of a known push service.' },
        400,
      );
    }
    const added = await addSubscription(c.env.DB, config.kek, c.get('owner').id, subscription);
    if (!added) {
      return c.json(
        { error: 'too_many_devices', message: `At most ${MAX_DEVICES} devices get notifications.` },
        429,
      );
    }
    return c.json({}, 201);
  })
  .openapi(unsubscribeRoute, async (c) => {
    await removeSubscription(c.env.DB, c.get('owner').id, c.req.valid('json').endpoint);
    return c.body(null, 204);
  });
