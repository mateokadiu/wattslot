import type { NextConfig } from 'next';

/**
 * Static export: the free Workers plan allows 10 ms of CPU per request, too little for
 * server-rendering React reliably. Static files are served from Cloudflare's edge without
 * running any code, and the page reads data from the API on the same origin.
 */
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@wattslot/planner', '@wattslot/pricing'],
};

export default config;
