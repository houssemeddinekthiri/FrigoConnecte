#!/usr/bin/env bash
# Installe les tâches d'exploitation : sauvegarde nocturne, test de restauration mensuel, surveillance. Idempotent.
#   sudo APP_URL=https://app.exemple.fr bash infra/server/install-ops.sh
# Ensuite : renseigner /etc/frigoconnect/backup.env (stockage hors serveur) puis tester : sudo systemctl start frigo-backup.service
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "À lancer avec sudo" >&2; exit 1; }
DEPLOY_DIR="${DEPLOY_DIR:-/opt/frigoconnect}"
APP_URL="${APP_URL:-}"
[[ "$DEPLOY_DIR" =~ ^/[A-Za-z0-9_./-]+$ ]] || { echo "DEPLOY_DIR invalide" >&2; exit 2; }
[ -z "$APP_URL" ] || [[ "$APP_URL" =~ ^https://[a-z0-9.-]+$ ]] || { echo "APP_URL : https://nom.de.domaine (sans chemin)" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

install -d -m 700 /etc/frigoconnect /var/backups/frigoconnect /var/lib/frigoconnect-watchdog

# Mot de passe de chiffrement des sauvegardes : généré UNE fois, jamais écrasé
if [ ! -s /etc/frigoconnect/restic.pass ]; then
  openssl rand -base64 32 >/etc/frigoconnect/restic.pass
  chmod 600 /etc/frigoconnect/restic.pass
  cat <<EOF

╔══════════════════════════════════════════════════════════════════════════╗
║  MOT DE PASSE DE CHIFFREMENT DES SAUVEGARDES (affiché une seule fois)    ║
║                                                                          ║
║     $(cat /etc/frigoconnect/restic.pass)
║                                                                          ║
║  COPIEZ-LE MAINTENANT dans un gestionnaire de mots de passe, HORS de ce  ║
║  serveur. Si le serveur est perdu et que vous ne l'avez pas : toutes     ║
║  les sauvegardes sont définitivement illisibles.                         ║
╚══════════════════════════════════════════════════════════════════════════╝

EOF
fi

if [ ! -f /etc/frigoconnect/backup.env ]; then
  cat >/etc/frigoconnect/backup.env <<'EOF'
# Stockage HORS du serveur, chez un AUTRE fournisseur que l'hébergeur du VPS (compatible S3).
RESTIC_REPOSITORY=s3:https://s3.EXEMPLE.fr/BUCKET-DE-SAUVEGARDE
RESTIC_PASSWORD_FILE=/etc/frigoconnect/restic.pass
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
# Surveillance « homme mort » (healthchecks.io ou équivalent) : une alerte part si la sauvegarde NE SE SIGNALE PAS
BACKUP_PING_URL=
RESTORE_PING_URL=
EOF
  chmod 600 /etc/frigoconnect/backup.env
  echo "→ à compléter : /etc/frigoconnect/backup.env"
fi

if [ ! -f /etc/frigoconnect/watchdog.env ]; then
  printf 'APP_URL=%s\n# Reçoit un JSON {"text","content"} : compatible Slack, Discord, ntfy (via un relais), Mattermost...\nALERT_WEBHOOK_URL=\n' "$APP_URL" >/etc/frigoconnect/watchdog.env
  chmod 600 /etc/frigoconnect/watchdog.env
  echo "→ à compléter : /etc/frigoconnect/watchdog.env (ALERT_WEBHOOK_URL)"
fi

for u in frigo-backup frigo-restore-test frigo-watchdog; do
  for ext in service timer; do
    sed "s|@DEPLOY_DIR@|$DEPLOY_DIR|g" "$here/systemd/$u.$ext" >"/etc/systemd/system/$u.$ext"
  done
done
systemctl daemon-reload
systemctl enable --now frigo-backup.timer frigo-restore-test.timer frigo-watchdog.timer
echo "✓ minuteries actives :"
systemctl list-timers 'frigo-*' --no-pager
