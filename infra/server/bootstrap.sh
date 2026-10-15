#!/usr/bin/env bash
# Prépare un VPS Ubuntu 24.04 LTS vierge : utilisateur de déploiement, SSH durci, pare-feu, fail2ban, mises à jour de sécurité
# automatiques, Docker, Nginx, certbot, restic. Idempotent : peut être relancé.
#
#   sudo DEPLOY_SSH_PUBKEY="ssh-ed25519 AAAA... deploy-ci" bash bootstrap.sh
#
# Variables :  DEPLOY_USER (défaut deploy) · DEPLOY_SSH_PUBKEY (obligatoire : clé PUBLIQUE de la CI) · TIMEZONE (Europe/Paris)
#              SWAP_GB (2) · AUTO_REBOOT (false : redémarrage automatique à 04:30 quand une mise à jour du noyau l'exige)
#
# ⚠ AVANT de lancer : gardez votre session SSH actuelle OUVERTE. Après le script, testez une NOUVELLE connexion dans un autre terminal.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "À lancer avec sudo" >&2; exit 1; }
. /etc/os-release
[ "${VERSION_ID:-}" = "24.04" ] || echo "⚠ testé pour Ubuntu 24.04, ici : ${PRETTY_NAME:-inconnu}" >&2

DEPLOY_USER="${DEPLOY_USER:-deploy}"
TIMEZONE="${TIMEZONE:-Europe/Paris}"
SWAP_GB="${SWAP_GB:-2}"
AUTO_REBOOT="${AUTO_REBOOT:-false}"
ADMIN_USER="${SUDO_USER:-}"   # la personne qui lance ce script : elle garde son accès (et sudo)
[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || { echo "DEPLOY_USER invalide" >&2; exit 2; }
[[ "${DEPLOY_SSH_PUBKEY:-}" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp[0-9]+)\ [A-Za-z0-9+/=]+(\ .*)?$ ]] || { echo "DEPLOY_SSH_PUBKEY absente ou invalide (clé PUBLIQUE)" >&2; exit 2; }
[[ "$AUTO_REBOOT" =~ ^(true|false)$ && "$SWAP_GB" =~ ^[0-9]+$ ]] || { echo "AUTO_REBOOT ou SWAP_GB invalide" >&2; exit 2; }

log() { printf '\n==> %s\n' "$*"; }
export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------- garde-fou anti-verrouillage
# On ne durcit SSH que si quelqu'un pourra encore se connecter par CLÉ : l'administrateur qui lance le script, ou à défaut l'utilisateur de déploiement.
admin_has_key=false
if [ -n "$ADMIN_USER" ] && [ "$ADMIN_USER" != root ] && [ -s "/home/$ADMIN_USER/.ssh/authorized_keys" ]; then admin_has_key=true; fi
if [ "$admin_has_key" = false ]; then
  echo "⚠ $([ -n "$ADMIN_USER" ] && echo "$ADMIN_USER n'a pas de clé SSH" || echo "script lancé sans sudo depuis un compte nommé") : l'administration se fera par $DEPLOY_USER uniquement." >&2
fi

log "Paquets et mises à jour"
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl gnupg ufw fail2ban unattended-upgrades nginx certbot rsync restic jq chrony logrotate openssl

log "Fuseau horaire : $TIMEZONE"
timedatectl set-timezone "$TIMEZONE"
systemctl enable --now chrony

log "Utilisateur de déploiement : $DEPLOY_USER"
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
auth="/home/$DEPLOY_USER/.ssh/authorized_keys"
touch "$auth"; chmod 600 "$auth"; chown "$DEPLOY_USER:$DEPLOY_USER" "$auth"
grep -qxF "$DEPLOY_SSH_PUBKEY" "$auth" || echo "$DEPLOY_SSH_PUBKEY" >>"$auth"

log "Docker (dépôt officiel)"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME} stable" >/etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# Journaux plafonnés ; « live-restore » : les conteneurs continuent de tourner pendant une mise à jour de Docker
if [ ! -s /etc/docker/daemon.json ]; then
  install -d /etc/docker
  cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true
}
JSON
  systemctl restart docker
fi
systemctl enable --now docker
usermod -aG docker "$DEPLOY_USER"   # ⚠ le groupe docker équivaut à root : d'où l'authentification par clé UNIQUEMENT

log "Pare-feu UFW : SSH (limité), HTTP, HTTPS"
# NOTE : Docker contourne UFW pour les ports qu'il publie. Aucun port de la pile n'est publié sur 0.0.0.0 (tout est sur 127.0.0.1) ;
# Nginx est le seul écouteur public. Ne JAMAIS ajouter de « ports: "5432:5432" » dans le compose.
ufw default deny incoming
ufw default allow outgoing
ufw limit 22/tcp comment 'ssh'
ufw allow 80/tcp comment 'http'
ufw allow 443/tcp comment 'https'
ufw --force enable

log "fail2ban : SSH et excès de requêtes Nginx"
cat >/etc/fail2ban/jail.d/frigoconnect.local <<'EOF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
maxretry = 4

[nginx-limit-req]
enabled  = true
port     = http,https
logpath  = /var/log/nginx/error.log
maxretry = 20
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

log "Mises à jour de sécurité automatiques"
cat >/etc/apt/apt.conf.d/52frigoconnect-unattended <<EOF
Unattended-Upgrade::Automatic-Reboot "${AUTO_REBOOT}";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
echo 'APT::Periodic::Update-Package-Lists "1"; APT::Periodic::Unattended-Upgrade "1";' >/etc/apt/apt.conf.d/20auto-upgrades

log "Réglages système"
cat >/etc/sysctl.d/99-frigoconnect.conf <<'EOF'
vm.swappiness = 10
net.core.somaxconn = 1024
EOF
sysctl --system >/dev/null
if [ "$SWAP_GB" -gt 0 ] && [ -z "$(swapon --show --noheadings)" ]; then
  fallocate -l "${SWAP_GB}G" /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

log "Dossiers"
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /opt/frigoconnect
install -d -m 700 /var/backups/frigoconnect /etc/frigoconnect
systemctl enable --now nginx

# ---------------------------------------------------------------- SSH : en DERNIER, après vérification
log "Durcissement SSH"
allowed="$DEPLOY_USER"; [ "$admin_has_key" = true ] && allowed="$allowed $ADMIN_USER"
cat >/etc/ssh/sshd_config.d/99-frigoconnect.conf <<EOF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 20
X11Forwarding no
AllowUsers ${allowed}
EOF
if sshd -t; then
  systemctl reload ssh
  echo "✓ SSH durci : connexion par clé uniquement, root interdit, utilisateurs autorisés : ${allowed}"
else
  rm -f /etc/ssh/sshd_config.d/99-frigoconnect.conf
  echo "✗ configuration SSH invalide : durcissement ANNULÉ (rien n'a changé côté SSH)" >&2
  exit 1
fi

cat <<EOF

────────────────────────────────────────────────────────────
✓ Serveur prêt.
  1. DANS UN AUTRE TERMINAL, testez : ssh ${ADMIN_USER:-$DEPLOY_USER}@<ce serveur>   (gardez celui-ci ouvert tant que ce n'est pas bon)
  2. Puis : docs/SERVER.md, étape « Nginx et certificats ».
────────────────────────────────────────────────────────────
EOF
