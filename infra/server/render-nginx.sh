#!/usr/bin/env bash
# Rend un modèle Nginx : remplace ${VARIABLE} par sa valeur. Même comportement partout (pas besoin d'envsubst).
#   APP_HOST=app.exemple.fr AUTH_HOST=auth.exemple.fr FILES_HOST=files.exemple.fr SSL_DIR=/etc/letsencrypt/live/app.exemple.fr \
#     render-nginx.sh modèle.template sortie.conf
# Les variables Nginx ($host, $remote_addr...) n'ont pas d'accolades : elles ne sont jamais touchées.
set -euo pipefail

in="${1:?usage: render-nginx.sh <modèle> <sortie>}"; out="${2:?sortie manquante}"

APP_HOST="${APP_HOST:-}"; AUTH_HOST="${AUTH_HOST:-}"; FILES_HOST="${FILES_HOST:-}"; SSL_DIR="${SSL_DIR:-}"
HSTS_MAX_AGE="${HSTS_MAX_AGE:-300}"; HTTP_PORT="${HTTP_PORT:-80}"; HTTPS_PORT="${HTTPS_PORT:-443}"

# Les valeurs finissent dans une configuration serveur : on n'accepte que des caractères sûrs
host_re='^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'
for v in APP_HOST AUTH_HOST FILES_HOST; do
  [[ "${!v}" =~ $host_re ]] || { echo "$v invalide ou absent : « ${!v} »" >&2; exit 2; }
done
[[ "$SSL_DIR" =~ ^[A-Za-z0-9:_./-]+$ ]] || { echo "SSL_DIR invalide ou absent" >&2; exit 2; }
[[ "$HSTS_MAX_AGE" =~ ^[0-9]{1,9}$ && "$HTTP_PORT" =~ ^[0-9]{1,5}$ && "$HTTPS_PORT" =~ ^[0-9]{1,5}$ ]] || { echo "valeur numérique invalide" >&2; exit 2; }
[ "$APP_HOST" != "$AUTH_HOST" ] && [ "$APP_HOST" != "$FILES_HOST" ] && [ "$AUTH_HOST" != "$FILES_HOST" ] || { echo "les trois noms d'hôte doivent être distincts" >&2; exit 2; }

sed -e "s|\${APP_HOST}|$APP_HOST|g" -e "s|\${AUTH_HOST}|$AUTH_HOST|g" -e "s|\${FILES_HOST}|$FILES_HOST|g" \
    -e "s|\${SSL_DIR}|$SSL_DIR|g" -e "s|\${HSTS_MAX_AGE}|$HSTS_MAX_AGE|g" \
    -e "s|\${HTTP_PORT}|$HTTP_PORT|g" -e "s|\${HTTPS_PORT}|$HTTPS_PORT|g" "$in" >"$out"

if grep -nE '\$\{[A-Z_]+\}' "$out" >&2; then echo "variable non résolue dans $out" >&2; rm -f "$out"; exit 3; fi
