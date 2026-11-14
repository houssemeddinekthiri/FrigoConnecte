import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    // `/prestataire/` avec la barre finale : ne doit pas masquer l'annuaire public `/prestataires`
    rules: { userAgent: '*', allow: '/', disallow: ['/client/', '/prestataire/', '/admin/', '/api/', '/connexion', '/deconnexion', '/design-system'] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
