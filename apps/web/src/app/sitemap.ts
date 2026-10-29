import type { MetadataRoute } from 'next';
import { buildPrices } from '@/lib/load-facts';
import { allRoutes, alternates } from '@/lib/routes';
import { absolute } from '@/lib/site';

export const dynamic = 'force-static';

/** Every page in every language, each listing all its translations. */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date(buildPrices().generatedAt);
  return allRoutes().flatMap((route) =>
    Object.values(route.paths).map((path) => ({
      url: absolute(path),
      lastModified,
      alternates: { languages: alternates(route) },
    })),
  );
}
