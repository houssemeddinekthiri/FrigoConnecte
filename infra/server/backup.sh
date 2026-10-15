#!/usr/bin/env bash
# Sauvegarde de FrigoConnect.
#   backup.sh                    sauvegarde nocturne COMPLÈTE : bases (application + Keycloak), fichiers MinIO, configuration (.env inclus),
#                                chiffrée par restic puis envoyée HORS du serveur. Rétention : 7 jours, 4 semaines, 6 mois.
#   backup.sh --pre-deploy <tag> copie locale rapide des bases AVANT un déploiement (appelée par deploy.sh) ; son échec BLOQUE le déploiement.
#
# Configuration : /etc/frigoconnect/backup.env (root, 600) :
#   RESTIC_REPOSITORY=s3:https://s3.fr-par.scw.cloud/<bucket>      RESTIC_PASSWORD_FILE=/etc/frigoconnect/restic.pass
#   AWS_ACCESS_KEY_ID=...  AWS_SECRET_ACCESS_KEY=...                BACKUP_PING_URL=https://hc-ping.com/<uuid>   (optionnel)
set -euo pipefail
umask 077

CONF="${BACKUP_ENV_FILE:-/etc/frigoconnect/backup.env}"
ROOT="${BACKUP_ROOT:-/var/backups/frigoconnect}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/frigoconnect}"
KEEP_LOCAL_DAYS="${BACKUP_KEEP_LOCAL_DAYS:-2}"
KEEP_PREDEPLOY="${BACKUP_KEEP_PREDEPLOY:-5}"

mode=nightly; tag=""
if [ "${1:-}" = "--pre-deploy" ]; then mode=predeploy; tag="${2:?usage: backup.sh --pre-deploy <tag>}"; [[ "$tag" =~ ^[A-Za-z0-9_.-]{1,128}$ ]] || { echo "tag invalide" >&2; exit 2; }; fi

[ -r "$CONF" ] || { echo "$CONF introuvable : sauvegardes non configurées" >&2; exit 2; }
set -a; . "$CONF"; set +a
ping() { [ -n "${BACKUP_PING_URL:-}" ] && curl -fsS -m 10 --retry 3 -o /dev/null "${BACKUP_PING_URL}$1" || true; }

cd "$DEPLOY_DIR"
compose=(docker compose --env-file .env)
[ -f .images.env ] && compose+=(--env-file .images.env)
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-frigoconnect}"

stage=""
fail() { echo "✗ sauvegarde échouée : $1" >&2; [ -n "$stage" ] && rm -rf "$stage"; [ "$mode" = nightly ] && ping /fail; exit 1; }

dump() { # dump <fichier> <commande sh exécutée dans le conteneur postgres>
  local out="$1"; shift
  "${compose[@]}" exec -T postgres sh -c "$1" >"$out" || fail "pg_dump ($(basename "$out"))"
  [ -s "$out" ] || fail "$(basename "$out") est vide"
  # le fichier doit être une archive lisible : on ne découvre pas qu'une sauvegarde est corrompue le jour où on en a besoin
  "${compose[@]}" exec -T postgres pg_restore --list <"$out" >/dev/null || fail "$(basename "$out") illisible (pg_restore --list)"
}
dump_all() {
  dump "$1/app.dump"      'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'
  dump "$1/keycloak.dump" 'PGPASSWORD="$KEYCLOAK_DB_PASSWORD" pg_dump -h localhost -U keycloak -d keycloak -Fc'
}

# ======================================================== avant déploiement : bases seules, en local
if [ "$mode" = predeploy ]; then
  d="$ROOT/pre-deploy/$tag"; stage="$d"; mkdir -p "$d"
  dump_all "$d"
  stage=""
  # on garde les N dernières
  ls -1dt "$ROOT"/pre-deploy/*/ 2>/dev/null | tail -n +$((KEEP_PREDEPLOY + 1)) | xargs -r rm -rf
  echo "✓ sauvegarde pré-déploiement : $d"
  exit 0
fi

# ======================================================== nocturne
ts="$(date +%Y%m%d-%H%M%S)"
stage="$ROOT/$ts"; mkdir -p "$stage/minio" "$stage/config"
echo "→ sauvegarde $ts"

dump_all "$stage"

# Fichiers : copie par l'API S3 de MinIO (cohérente, contrairement à une copie du dossier de données d'un MinIO en marche)
"${compose[@]}" run --rm --no-deps -T --entrypoint sh -v "$stage/minio:/out" minio-init -c \
  'mc alias set l http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc mirror --overwrite --quiet "l/$S3_BUCKET" /out' \
  || fail "copie des fichiers MinIO"

# Configuration : sans .env (secrets) il est IMPOSSIBLE de reconstruire le serveur. Il part chiffré par restic.
cp .env docker-compose.yml "$stage/config/" || fail "copie de la configuration"
cp .deployed-tag "$stage/config/" 2>/dev/null || true
cp -r infra "$stage/config/infra"

# Chiffrement côté client + hors serveur. Initialisation automatique du dépôt la première fois.
restic cat config >/dev/null 2>&1 || restic init || fail "initialisation du dépôt restic"
restic backup "$stage" --tag nightly --host "$(hostname)" --quiet || fail "restic backup"
restic forget --tag nightly --host "$(hostname)" --keep-daily 7 --keep-weekly 4 --keep-monthly 6 \
  $([ "$(date +%u)" = 7 ] || [ -n "${BACKUP_FORCE_WEEKLY:-}" ] && echo --prune) >/dev/null || fail "restic forget"
# Hebdomadaire : relit 5 % des données chiffrées pour détecter une corruption du stockage distant
if [ "$(date +%u)" = 7 ] || [ -n "${BACKUP_FORCE_WEEKLY:-}" ]; then restic check --read-data-subset=5% >/dev/null || fail "restic check"; fi

# Copies locales : seulement les dernières, pour une restauration rapide
find "$ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime "+$KEEP_LOCAL_DAYS" -exec rm -rf {} + 2>/dev/null || true
date +%s >"$ROOT/.last-success"   # lu par watchdog.sh : alerte si plus de 36 h
stage=""
ping ""
echo "✓ sauvegarde terminée ($ts)"
