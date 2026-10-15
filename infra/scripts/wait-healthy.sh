#!/usr/bin/env bash
# Attend que les services Compose soient « healthy ».   wait-healthy.sh <délai_en_secondes> <service>...
# (Plutôt que « docker compose up --wait » : ce dernier traite mal les tâches uniques qui se terminent, comme minio-init.)
set -uo pipefail

timeout="${1:?usage: wait-healthy.sh <délai> <service>...}"; shift
[ "$#" -ge 1 ] || { echo "aucun service" >&2; exit 2; }

health() {
  local id
  id="$(docker compose ps -q "$1" 2>/dev/null | head -n1)"
  [ -n "$id" ] || { echo "absent"; return; }
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id"
}

deadline=$((SECONDS + timeout))
for svc in "$@"; do
  while :; do
    state="$(health "$svc")"
    case "$state" in
      healthy | running) echo "✓ $svc : $state"; break ;;
      exited | dead) echo "✗ $svc : arrêté" >&2; exit 1 ;;   # inutile d'attendre un conteneur mort (boucle de redémarrage comprise)
    esac
    if [ "$SECONDS" -ge "$deadline" ]; then echo "✗ $svc : toujours « $state » après ${timeout}s" >&2; exit 1; fi
    sleep "${WAIT_INTERVAL:-3}"
  done
done
