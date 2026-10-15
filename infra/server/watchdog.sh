#!/usr/bin/env bash
# Filet de sécurité minimal, toutes les 5 minutes (frigo-watchdog.timer), AVANT la supervision complète (Prometheus/Grafana, Phase 16).
# Vérifie : site joignable de l'extérieur, conteneurs sains, disque, certificat, dernière sauvegarde.
# Alerte seulement quand l'état CHANGE (panne, puis « rétabli »), avec un rappel toutes les 6 h tant que ça dure : pas de spam.
#
# /etc/frigoconnect/watchdog.env :  APP_URL=https://app.exemple.fr   ALERT_WEBHOOK_URL=https://...   (Slack, Discord, ntfy... : reçoit {"text","content"})
set -uo pipefail

CONF="${WATCHDOG_ENV_FILE:-/etc/frigoconnect/watchdog.env}"
[ -r "$CONF" ] && { set -a; . "$CONF"; set +a; }
STATE="${WATCHDOG_STATE_DIR:-/var/lib/frigoconnect-watchdog}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/frigoconnect}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/frigoconnect}"
DISK_MAX="${DISK_MAX_PERCENT:-85}"
CERT_MIN_DAYS="${CERT_MIN_DAYS:-14}"
BACKUP_MAX_HOURS="${BACKUP_MAX_HOURS:-36}"
REMIND_EVERY="${REMIND_EVERY_SECONDS:-21600}"
mkdir -p "$STATE"
now="$(date +%s)"
host="$(hostname)"

notify() { # notify <message>
  echo "$1"
  [ -n "${ALERT_WEBHOOK_URL:-}" ] || return 0
  local msg; msg="[$host] $1"
  curl -fsS -m 10 --retry 2 -H 'Content-Type: application/json' -d "$(printf '{"text":"%s","content":"%s"}' "${msg//\"/\'}" "${msg//\"/\'}")" "$ALERT_WEBHOOK_URL" >/dev/null || true
}

# report <clé> <ok|bad> <message> : gère l'état par contrôle
report() {
  local key="$1" status="$2" msg="$3" f="$STATE/$1"
  local prev="ok" since=0 last=0
  [ -f "$f" ] && read -r prev since last <"$f"
  if [ "$status" = bad ]; then
    if [ "$prev" != bad ]; then notify "🔴 $msg"; echo "bad $now $now" >"$f"
    elif [ $((now - last)) -ge "$REMIND_EVERY" ]; then notify "🔴 (toujours) $msg"; echo "bad $since $now" >"$f"; fi
  else
    if [ "$prev" = bad ]; then notify "🟢 rétabli : $key (après $(( (now - since) / 60 )) min)"; fi
    echo "ok $now $now" >"$f"
  fi
}

# 1) le site répond depuis l'extérieur (traverse DNS, TLS, Nginx, API, base)
if [ -n "${APP_URL:-}" ]; then
  if curl -fsS -m 10 -o /dev/null "$APP_URL/api/v1/health/ready"; then report site ok ""; else report site bad "le site ne répond pas ($APP_URL/api/v1/health/ready)"; fi
fi

# 2) conteneurs : aucun service arrêté ou malade
if [ -d "$DEPLOY_DIR" ]; then
  bad_services=""
  cd "$DEPLOY_DIR"
  for id in $(docker compose ps -a -q 2>/dev/null); do
    name="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$id" 2>/dev/null)"
    [ "$name" = "minio-init" ] && continue   # tâche unique : « exited » est son état normal
    st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null)"
    case "$st" in healthy | running) ;; *) bad_services="$bad_services $name($st)" ;; esac
  done
  if [ -z "$bad_services" ]; then report conteneurs ok ""; else report conteneurs bad "services en difficulté :$bad_services"; fi
fi

# 3) disque
used="$(df -P / | awk 'NR==2 {gsub("%",""); print $5}')"
if [ "${used:-0}" -ge "$DISK_MAX" ]; then report disque bad "disque rempli à ${used} % (seuil ${DISK_MAX} %)"; else report disque ok ""; fi

# 4) certificat
if [ -n "${APP_URL:-}" ]; then
  appHost="${APP_URL#https://}"; appHost="${appHost%%/*}"
  cert="${LETSENCRYPT_DIR:-/etc/letsencrypt}/live/$appHost/fullchain.pem"
  if [ -r "$cert" ]; then
    if openssl x509 -checkend $((CERT_MIN_DAYS * 86400)) -noout -in "$cert" >/dev/null; then report certificat ok ""; else report certificat bad "le certificat de $appHost expire dans moins de $CERT_MIN_DAYS jours : le renouvellement automatique a échoué"; fi
  fi
fi

# 5) dernière sauvegarde réussie
if [ -d "$BACKUP_ROOT" ] && [ -f "$BACKUP_ROOT/.last-success" ]; then
  age=$(( (now - $(cat "$BACKUP_ROOT/.last-success")) / 3600 ))
  if [ "$age" -ge "$BACKUP_MAX_HOURS" ]; then report sauvegarde bad "dernière sauvegarde réussie il y a ${age} h (seuil ${BACKUP_MAX_HOURS} h)"; else report sauvegarde ok ""; fi
fi
exit 0
