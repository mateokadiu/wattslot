import { OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from './env.js';

export const ErrorBody = z
  .object({ error: z.string(), message: z.string().optional() })
  .openapi('Error');

/** A router whose validation failures come back as `{ error: 'invalid_request', message }`. */
export const router = () =>
  new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const message = result.error.issues
          .map((i) => `${i.path.join('.') || 'query'}: ${i.message}`)
          .join('; ');
        return c.json({ error: 'invalid_request', message }, 400);
      }
    },
  });
