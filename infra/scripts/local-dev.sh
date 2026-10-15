#!/usr/bin/env bash
# MODE DÉVELOPPEMENT (WSL) : le site se met à jour en 1 à 2 secondes à chaque modification, sans reconstruire d'image.
# Arrêtez avec Ctrl+C ; pour revenir à la version « image Docker » : docker compose up -d web
set -uo pipefail
SRC=/mnt/c/Users/kthir/Desktop/platforme; STACK="$HOME/frigoconnect"; DEV="$HOME/frigoconnect-dev"
command -v node >/dev/null || { echo "Node.js absent dans WSL : sudo apt install -y nodejs npm"; exit 1; }

sync() { rsync -a --delete --exclude=node_modules --exclude=.next --exclude=dist --exclude=.git --exclude=.env --exclude=LOCAL-ACCESS.txt "$SRC"/ "$DEV"/; }
mkdir -p "$DEV"; sync
(cd "$STACK" && docker compose stop web >/dev/null 2>&1)   # libère le port 3000

cd "$DEV"
if [ ! -d node_modules ]; then echo "Première fois : installation des dépendances (2 à 3 minutes, une seule fois)…"; npm ci --no-audit --no-fund || exit 1; fi
npm run build:contracts >/dev/null || exit 1

# Les fichiers sont recopiés depuis Windows toutes les secondes (la surveillance directe de C:\ ne marche pas depuis WSL)
( while sleep 1; do sync; done ) &
SYNC=$!; trap 'kill $SYNC 2>/dev/null' EXIT

set -a; . "$STACK/.env"; set +a
export NODE_ENV=development AUTH_URL=http://localhost:3000 AUTH_TRUST_HOST=true \
  KEYCLOAK_ISSUER="${KEYCLOAK_PUBLIC_URL:-http://localhost:18080}/realms/frigoconnect" KEYCLOAK_INTERNAL_ISSUER="${KEYCLOAK_PUBLIC_URL:-http://localhost:18080}/realms/frigoconnect" \
  KEYCLOAK_CLIENT_ID=frigoconnect-web API_URL=http://localhost:3001 NEXT_PUBLIC_WS_URL=http://localhost:3001 NEXT_TELEMETRY_DISABLED=1
echo "Site de développement : http://localhost:3000  (Ctrl+C pour arrêter)"
npm run dev -w @frigoconnect/web
