// Service worker minimal : rend l'application installable et affiche une page de secours hors ligne.
// Aucune donnée d'API ni de session n'est mise en cache (contenu privé).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(
    fetch(e.request).catch(
      () => new Response('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center"><div><h1>Hors ligne</h1><p>Reconnectez-vous à Internet pour utiliser FrigoConnect.</p></div>', { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    ),
  );
});
