#!/usr/bin/env bash
# Installe la configuration Nginx de FrigoConnect et obtient les certificats Let's Encrypt. Idempotent (peut être relancé).
#   sudo APP_HOST=app.exemple.fr AUTH_HOST=auth.exemple.fr FILES_HOST=files.exemple.fr CERTBOT_EMAIL=moi@exemple.fr \
#        ENVIRONMENT=production bash infra/server/setup-nginx.sh
# Prérequis : bootstrap.sh exécuté, les 3 noms DNS (enregistrements A/AAAA) pointent sur CE serveur, ports 80/443 ouverts.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "À lancer avec sudo" >&2; exit 1; }
: "${APP_HOST:?}" "${AUTH_HOST:?}" "${FILES_HOST:?}" "${CERTBOT_EMAIL:?}"
ENVIRONMENT="${ENVIRONMENT:-production}"
[[ "$ENVIRONMENT" =~ ^(staging|production)$ ]] || { echo "ENVIRONMENT : staging ou production" >&2; exit 1; }
HSTS_MAX_AGE="${HSTS_MAX_AGE:-300}"
CERTBOT_STAGING="${CERTBOT_STAGING:-0}"   # 1 = serveur de test de Let's Encrypt (quotas élargis, certificat non reconnu) : pour répéter sans risque

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$here/../nginx"
render="$here/render-nginx.sh"
export APP_HOST AUTH_HOST FILES_HOST HSTS_MAX_AGE
export SSL_DIR="/etc/letsencrypt/live/$APP_HOST"

backup="$(mktemp -d)"
trap 'rm -rf "$backup"' EXIT
cp -a /etc/nginx/conf.d /etc/nginx/snippets /etc/nginx/sites-available /etc/nginx/sites-enabled "$backup"/ 2>/dev/null || true

reload_or_restore() { # teste la configuration ; en cas d'erreur, restaure l'ancienne et s'arrête (le site en service n'est jamais cassé)
  if nginx -t; then systemctl reload nginx; return 0; fi
  echo "✗ configuration invalide : restauration de la précédente" >&2
  for d in conf.d snippets sites-available sites-enabled; do rm -rf "/etc/nginx/$d"; [ -d "$backup/$d" ] && cp -a "$backup/$d" "/etc/nginx/$d"; done
  nginx -t && systemctl reload nginx || true
  exit 1
}

mkdir -p /var/www/certbot /etc/nginx/snippets
rm -f /etc/nginx/sites-enabled/default

install -m 644 "$src/00-frigoconnect.conf" /etc/nginx/conf.d/00-frigoconnect.conf
install -m 644 "$src/frigo-proxy.conf" /etc/nginx/snippets/frigo-proxy.conf
bash "$render" "$src/frigo-security.conf.template" /etc/nginx/snippets/frigo-security.conf
if [ "$ENVIRONMENT" = staging ]; then
  echo 'add_header X-Robots-Tag "noindex, nofollow" always;' >/etc/nginx/snippets/frigo-env.conf   # le staging ne doit jamais être indexé
else
  echo '# production : rien' >/etc/nginx/snippets/frigo-env.conf
fi

# 1) Première installation : site HTTP seul pour répondre au défi Let's Encrypt
if [ ! -s "$SSL_DIR/fullchain.pem" ]; then
  echo "→ aucun certificat : installation HTTP temporaire puis demande à Let's Encrypt"
  bash "$render" "$src/bootstrap.conf.template" /etc/nginx/sites-available/frigoconnect.conf
  ln -sf /etc/nginx/sites-available/frigoconnect.conf /etc/nginx/sites-enabled/frigoconnect.conf
  reload_or_restore
  extra=(); [ "$CERTBOT_STAGING" = 1 ] && extra=(--test-cert)
  certbot certonly --webroot -w /var/www/certbot --cert-name "$APP_HOST" \
    -d "$APP_HOST" -d "$AUTH_HOST" -d "$FILES_HOST" \
    --email "$CERTBOT_EMAIL" --agree-tos --no-eff-email --non-interactive "${extra[@]}"
fi

# 2) Configuration définitive (HTTPS)
bash "$render" "$src/frigoconnect.conf.template" /etc/nginx/sites-available/frigoconnect.conf
ln -sf /etc/nginx/sites-available/frigoconnect.conf /etc/nginx/sites-enabled/frigoconnect.conf
reload_or_restore

# 3) Renouvellement automatique : la minuterie de certbot tourne deux fois par jour ; on recharge Nginx après chaque renouvellement
install -d /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nsystemctl reload nginx\n' >/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
systemctl enable --now certbot.timer 2>/dev/null || true

echo "✓ Nginx configuré pour $APP_HOST, $AUTH_HOST, $FILES_HOST ($ENVIRONMENT, HSTS ${HSTS_MAX_AGE}s)"
echo "  Vérifier le renouvellement : sudo certbot renew --dry-run"
echo "  Puis, une fois tout validé en HTTPS : relancer avec HSTS_MAX_AGE=31536000"
