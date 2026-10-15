#!/usr/bin/env bash
# Test de fumée de la pile Docker déjà démarrée (CI, ou en local : bash infra/scripts/smoke.sh).
# Vérifie ce qu'aucun test unitaire ne peut voir : les services s'accordent entre eux (adresses, secrets, realm, stockage).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

set -a; . ./.env; set +a
API="${SMOKE_API:-http://127.0.0.1:3001}"; WEB="${SMOKE_WEB:-http://127.0.0.1:3000}"; KC="${SMOKE_KC:-http://127.0.0.1:8080}"
fail=0
ok()  { echo "OK   $1"; }
bad() { echo "FAIL $1" >&2; fail=1; }
json() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log($1)}catch{console.log('')}})"; }

# --- API : migrations appliquées (le healthcheck exige la base), routes protégées ---
[ "$(curl -s -o /dev/null -w '%{http_code}' "$API/api/v1/health/ready")" = 200 ] && ok "API prête (migrations SQL appliquées sur PostGIS)" || bad "API non prête"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$API/api/v1/admin/stats")" = 401 ] && ok "route d'administration refusée sans jeton (401)" || bad "route admin non protégée"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$API/api/v1/providers/search?lat=45.76&lng=4.83")" = 200 ] && ok "recherche par distance PostGIS (ST_DWithin) : requête exécutée" || bad "recherche PostGIS en échec"

# --- Web ---
[ "$(curl -s -o /dev/null -w '%{http_code}' "$WEB/")" = 200 ] && ok "site : page d'accueil servie" || bad "site : accueil en échec"
loc="$(curl -s -o /dev/null -w '%{redirect_url}' "$WEB/client")"
case "$loc" in */connexion*) ok "site : /client sans session redirige vers la connexion" ;; *) bad "site : redirection inattendue ($loc)" ;; esac

# --- Keycloak : l'émetteur annoncé doit être EXACTEMENT celui que l'API et le site attendent ---
expected="${KEYCLOAK_PUBLIC_URL:-http://localhost:8080}/realms/frigoconnect"
issuer="$(curl -s "$KC/realms/frigoconnect/.well-known/openid-configuration" | json 'j.issuer')"
[ "$issuer" = "$expected" ] && ok "Keycloak : émetteur des jetons = $issuer" || bad "Keycloak : émetteur « $issuer » ≠ attendu « $expected »"

admin_token="$(curl -s -d client_id=admin-cli -d grant_type=password -d "username=${KEYCLOAK_ADMIN_USER:-admin}" --data-urlencode "password=$KEYCLOAK_ADMIN_PASSWORD" "$KC/realms/master/protocol/openid-connect/token" | json 'j.access_token')"
if [ -n "$admin_token" ]; then
  auth=(-H "Authorization: Bearer $admin_token")
  # Keycloak ajoute ses propres rôles (offline_access, uma_authorization, default-roles-*) : on vérifie seulement les NÔTRES
  roles="$(curl -s "${auth[@]}" "$KC/admin/realms/frigoconnect/roles" | json 'j.map(r=>r.name).filter(n=>["client","provider","super_admin"].includes(n)).sort().join(",")')"
  [ "$roles" = "client,provider,super_admin" ] && ok "realm importé : rôles client, provider, super_admin" || bad "rôles du realm : « $roles »"
  flow="$(curl -s "${auth[@]}" "$KC/admin/realms/frigoconnect" | json 'j.browserFlow')"
  [ "$flow" = "browser-admin-mfa" ] && ok "flux de connexion avec OTP administrateur actif (browser-admin-mfa)" || bad "flux de connexion : « $flow »"
  clients="$(curl -s "${auth[@]}" "$KC/admin/realms/frigoconnect/clients" | json 'j.map(c=>c.clientId).filter(c=>c.startsWith("frigoconnect")).sort().join(",")')"
  [ "$clients" = "frigoconnect-api,frigoconnect-backend,frigoconnect-web" ] && ok "clients OIDC : web (PKCE), api (audience), backend (compte de service)" || bad "clients : « $clients »"
else
  bad "Keycloak : connexion à l'API d'administration impossible"
fi

# --- Stockage : bucket créé par minio-init, tâche terminée avec succès ---
init="$(docker compose ps -a --format '{{.State}} {{.ExitCode}}' minio-init 2>/dev/null | head -n1)"
[ "$init" = "exited 0" ] && ok "MinIO : bucket et compte applicatif créés (minio-init terminé avec succès)" || bad "minio-init : « $init »"

# --- Création du premier administrateur : Keycloak + base + rôle, de bout en bout ---
out="$(docker compose exec -T api node apps/api/dist/scripts/seed-admin.js ci-admin@example.org CI Admin 2>&1)"
if echo "$out" | grep -q "Administrateur créé"; then
  role="$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-frigo}" -d "${POSTGRES_DB:-frigoconnect}" -tAc "select role_code||':'||status from users where email='ci-admin@example.org'")"
  [ "$role" = "super_admin:active" ] && ok "seed-admin : utilisateur créé dans Keycloak ET en base (super_admin actif)" || bad "seed-admin : base « $role »"
else
  bad "seed-admin : $out"
fi

[ "$fail" = 0 ] && echo "✔ test de fumée réussi" || { echo "✘ test de fumée en échec" >&2; exit 1; }
