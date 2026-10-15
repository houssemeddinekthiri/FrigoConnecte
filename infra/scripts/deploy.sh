#!/usr/bin/env bash
# Déploie une version sur CE serveur, avec retour arrière automatique.   deploy.sh <tag>
#   IMAGE_PREFIX  ex. ghcr.io/mon-org/frigoconnect   (images : <prefix>-api:<tag> et <prefix>-web:<tag>)
#   DEPLOY_DIR    dossier contenant docker-compose.yml et .env (défaut : /opt/frigoconnect)
#
# Principes :
#  - la version précédente reste en place tant que la nouvelle n'est pas « healthy » ;
#  - si la nouvelle ne démarre pas, on REVIENT à la précédente (exit 1) ;
#  - un seul déploiement à la fois ;
#  - le retour arrière ne concerne que les IMAGES : le schéma SQL ne recule jamais (voir docs/CICD.md : migrations compatibles).
set -euo pipefail

tag="${1:?usage: deploy.sh <tag>}"
prefix="${IMAGE_PREFIX:?IMAGE_PREFIX manquant}"
dir="${DEPLOY_DIR:-/opt/frigoconnect}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Le tag finit dans des variables d'environnement et des commandes : on n'accepte que des caractères sûrs
[[ "$tag" =~ ^[A-Za-z0-9_.-]{1,128}$ ]] || { echo "tag invalide : $tag" >&2; exit 2; }
[[ "$prefix" =~ ^[a-z0-9._/:-]+$ ]] || { echo "IMAGE_PREFIX invalide" >&2; exit 2; }

cd "$dir"
[ -f docker-compose.yml ] && [ -f .env ] || { echo "docker-compose.yml ou .env absent de $dir" >&2; exit 2; }

# Verrou portable (mkdir est atomique) : pas deux déploiements en parallèle
lock=".deploy.lock"
mkdir "$lock" 2>/dev/null || { echo "un déploiement est déjà en cours ($lock)" >&2; exit 4; }
trap 'rmdir "$lock" 2>/dev/null || true' EXIT

state=".deployed-tag"
previous="$(cat "$state" 2>/dev/null || true)"

up() { # up <tag> : démarre api + web (et leurs dépendances) sur ce tag, puis attend qu'ils soient sains
  export API_IMAGE="$prefix-api:$1" WEB_IMAGE="$prefix-web:$1"
  docker compose up -d --no-build --remove-orphans
  "$here/wait-healthy.sh" "${WAIT_TIMEOUT:-240}" api web
}

echo "→ déploiement de $tag (précédent : ${previous:-aucun})"

# Sauvegarde des bases AVANT de toucher à quoi que ce soit : une migration défectueuse ne se « retourne » pas, on restaure.
# Active seulement si le serveur a des sauvegardes configurées. Son ÉCHEC bloque le déploiement (code 5).
hook="${PREDEPLOY_HOOK:-$here/../server/backup.sh}"
if [ -x "$hook" ] || [ -f "$hook" ]; then
  if [ -r "${BACKUP_ENV_FILE:-/etc/frigoconnect/backup.env}" ]; then
    DEPLOY_DIR="$dir" bash "$hook" --pre-deploy "$tag" || { echo "✗ sauvegarde pré-déploiement impossible : déploiement ANNULÉ (rien n'a été modifié)" >&2; exit 5; }
  else
    echo "• sauvegardes non configurées sur ce serveur : étape ignorée"
  fi
fi

API_IMAGE="$prefix-api:$tag" WEB_IMAGE="$prefix-web:$tag" docker compose pull api web

if up "$tag"; then
  echo "$tag" >"$state"
  # Pour les commandes manuelles : docker compose --env-file .env --env-file .images.env <commande>  (sinon Compose reprendrait les images locales par défaut)
  { echo "API_IMAGE=$prefix-api:$tag"; echo "WEB_IMAGE=$prefix-web:$tag"; } >.images.env
  [ -n "$previous" ] && [ "$previous" != "$tag" ] && echo "$previous" >.previous-tag
  docker image prune -f >/dev/null 2>&1 || true
  echo "✓ $tag déployé"
  exit 0
fi

echo "✗ $tag n'est pas devenu sain" >&2
docker compose logs --tail 60 api web >&2 || true
if [ -n "$previous" ] && [ "$previous" != "$tag" ]; then
  echo "↩ retour arrière vers $previous" >&2
  if up "$previous"; then echo "✓ $previous rétabli (la version $tag est REFUSÉE)" >&2; exit 1; fi
  echo "✗✗ le retour arrière a lui aussi échoué : intervention manuelle nécessaire" >&2
  exit 3
fi
echo "aucune version précédente à rétablir" >&2
exit 1
