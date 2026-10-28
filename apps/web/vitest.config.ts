import { defineConfig } from 'vitest/config';

// Unit tests only; e2e/ is Playwright's (pnpm --filter @wattslot/web e2e).
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
