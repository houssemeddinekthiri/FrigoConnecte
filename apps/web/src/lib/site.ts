/** Adresse publique du site (liens absolus : sitemap, aperçus de partage). Même variable que l'authentification. */
export const SITE_URL = (process.env.AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');
