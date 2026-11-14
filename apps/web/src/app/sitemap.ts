import type { MetadataRoute } from 'next';
import { SERVICE_TYPES } from '@frigoconnect/contracts';
import { SITE_URL } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/prestataires`, changeFrequency: 'daily', priority: 0.9 },
    ...SERVICE_TYPES.map((s) => ({ url: `${SITE_URL}/prestataires?service=${s}`, changeFrequency: 'daily' as const, priority: 0.7 })),
    { url: `${SITE_URL}/inscription`, changeFrequency: 'monthly', priority: 0.5 },
  ];
}
