#!/usr/bin/env bash
# Test de RESTAURATION : une sauvegarde qu'on n'a jamais restaurée n'est pas une sauvegarde.
# Restaure le dernier instantané dans un PostgreSQL JETABLE (aucun contact avec la production) et vérifie son contenu.
# Planifié chaque mois (frigo-restore-test.timer). Échec = alerte (BACKUP_PING_URL…/fail).
set -euo pipefail
umask 077

CONF="${BACKUP_ENV_FILE:-/etc/frigoconnect/backup.env}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/frigoconnect}"
[ -r "$CONF" ] || { echo "$CONF introuvable" >&2; exit 2; }
set -a; . "$CONF"; set +a
ping() { [ -n "${RESTORE_PING_URL:-}" ] && curl -fsS -m 10 --retry 3 -o /dev/null "${RESTORE_PING_URL}$1" || true; }

work="$(mktemp -d)"; name="frigo-restore-test-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
fail() { echo "✗ TEST DE RESTAURATION ÉCHOUÉ : $1" >&2; ping /fail; exit 1; }

cd "$DEPLOY_DIR"
image="$(docker compose config --images 2>/dev/null | grep -m1 postgis || echo postgis/postgis:17-3.5)"

echo "→ restauration du dernier instantané"
restic restore latest --tag nightly --target "$work" --quiet || fail "restic restore"
snap="$(find "$work" -type f -name app.dump -print -quit)"; [ -n "$snap" ] || fail "app.dump absent de l'instantané"
dir="$(dirname "$snap")"
for f in app.dump keycloak.dump config/.env config/docker-compose.yml; do [ -s "$dir/$f" ] || fail "$f absent ou vide dans l'instantané"; done

echo "→ base jetable ($image)"
docker run -d --name "$name" -e POSTGRES_PASSWORD=restore -e POSTGRES_DB=restore "$image" >/dev/null
# Attente en TCP (-h 127.0.0.1) et NON par socket : l'image démarre d'abord un serveur TEMPORAIRE (initialisation) qui n'écoute que sur
# le socket Unix, puis l'arrête et relance le vrai. Un test par socket répondrait « prêt » trop tôt et la restauration serait perdue.
for _ in $(seq 1 60); do docker exec "$name" pg_isready -h 127.0.0.1 -U postgres -d restore >/dev/null 2>&1 && break; sleep 2; done
docker exec "$name" pg_isready -h 127.0.0.1 -U postgres -d restore >/dev/null 2>&1 || fail "la base jetable ne démarre pas"

docker exec -i "$name" pg_restore -U postgres -d restore --no-owner --exit-on-error <"$dir/app.dump" || fail "pg_restore de l'application"
q() { docker exec "$name" psql -U postgres -d restore -tAc "$1"; }

tables="$(q "select count(*) from information_schema.tables where table_schema='public'")"
[ "${tables:-0}" -ge 20 ] || fail "seulement $tables tables restaurées (attendu : 20 ou plus)"
last="$(q "select max(version) from schema_migrations")"
[ -n "$last" ] || fail "table schema_migrations vide : schéma jamais initialisé ?"
# Les migrations sont DANS l'image de l'API (/app/db). La version restaurée doit être une version que le code déployé connaît.
known="$(docker compose exec -T api ls /app/db 2>/dev/null || true)"
if [ -n "$known" ]; then printf '%s\n' "$known" | grep -qx "${last}.sql" || fail "schéma restauré à « $last », inconnu de la version déployée"; fi
q "select postgis_version()" >/dev/null || fail "PostGIS absent de la base restaurée"
users="$(q "select count(*) from users")"
contracts="$(q "select count(*) from contracts")"

# Keycloak : on le RESTAURE réellement (base séparée) et on exige de retrouver notre realm, pas seulement une archive « lisible »
docker exec "$name" psql -U postgres -d restore -qc 'CREATE DATABASE keycloak_restore' || fail "création de la base Keycloak jetable"
docker exec -i "$name" pg_restore -U postgres -d keycloak_restore --no-owner --exit-on-error <"$dir/keycloak.dump" || fail "pg_restore de Keycloak"
realms="$(docker exec "$name" psql -U postgres -d keycloak_restore -tAc "select string_agg(name, ',') from realm")"
case ",$realms," in *,frigoconnect,*) ;; *) fail "le realm « frigoconnect » est absent de la sauvegarde Keycloak (realms : ${realms:-aucun})" ;; esac
files="$(find "$dir/minio" -type f 2>/dev/null | wc -l)"

echo "✓ restauration vérifiée : $tables tables, schéma $last, $users utilisateurs, $contracts contrats, $files fichiers, Keycloak lisible"
ping ""
