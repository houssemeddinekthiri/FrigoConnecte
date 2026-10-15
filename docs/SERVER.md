# Serveur : installation, exploitation, reprise après sinistre

Un serveur par environnement (**staging** et **production**), Ubuntu 24.04 LTS. Dimensionnement indicatif :

| | vCPU | RAM | Disque | Remarque |
|---|---|---|---|---|
| Staging | 2 | 4 Go | 40 Go | La pile plafonne à ≈ 4 Go : prévoir du swap (créé par le script) |
| Production | 4 | 8 Go | 80 Go SSD | Marge pour les pics et les sauvegardes locales |

```
Internet ──► UFW (22, 80, 443) ──► Nginx (TLS, limites de débit, en-têtes) ──► 127.0.0.1 : web 3000 · api 3001 · keycloak 8080 · minio 9000
                                                                              PostgreSQL et Redis : réseau Docker interne UNIQUEMENT
```

## 0. Avant de commencer
- Un **nom de domaine** et trois enregistrements DNS **A** (et **AAAA** si IPv6) vers l'IP du serveur : `app.`, `auth.`, `files.` (ex. `app.exemple.fr`). Staging : `app.staging.exemple.fr`, etc.
- Une **paire de clés SSH dédiée au déploiement** : `ssh-keygen -t ed25519 -f deploy_key -N ""` (la privée va dans le secret GitHub `SSH_PRIVATE_KEY`, la publique dans le script ci-dessous).
- Un **stockage S3 hors serveur, chez un autre fournisseur que le VPS** (pour les sauvegardes), et un compte sur un service de surveillance « homme mort » (healthchecks.io ou équivalent).

## 1. Préparer le serveur
Connecté en SSH avec le compte administrateur fourni par l'hébergeur (clé SSH), **sans fermer cette session** :

```bash
git clone <votre dépôt> ~/frigoconnect-src && cd ~/frigoconnect-src
sudo DEPLOY_SSH_PUBKEY="ssh-ed25519 AAAA... deploy-ci" bash infra/server/bootstrap.sh
```
Le script : crée l'utilisateur `deploy` (clé uniquement), **durcit SSH** (root interdit, mots de passe interdits, `AllowUsers`), active le pare-feu (22 limité, 80, 443), **fail2ban** (SSH et excès de requêtes), les **mises à jour de sécurité automatiques**, installe Docker, Nginx, certbot et restic. Il refuse de durcir SSH si l'administrateur n'a pas de clé, pour ne jamais vous enfermer dehors.

**Dans un autre terminal, testez une nouvelle connexion** (`ssh <vous>@serveur` puis `ssh deploy@serveur`) avant de fermer la première.

> **Docker contourne le pare-feu UFW** pour les ports qu'il publie. Toute la pile est publiée sur `127.0.0.1` uniquement : n'écrivez jamais `ports: "5432:5432"` dans le compose.

## 2. Nginx et certificats

```bash
sudo APP_HOST=app.exemple.fr AUTH_HOST=auth.exemple.fr FILES_HOST=files.exemple.fr \
     CERTBOT_EMAIL=vous@exemple.fr ENVIRONMENT=production bash infra/server/setup-nginx.sh
```
- Obtient **un certificat unique** pour les 3 noms (défi HTTP), installe la configuration définitive, teste (`nginx -t`) et recharge. **Si la configuration est invalide, l'ancienne est restaurée** : le site en service n'est jamais cassé.
- Pour s'entraîner sans épuiser les quotas de Let's Encrypt : `CERTBOT_STAGING=1` (certificat non reconnu par les navigateurs).
- **HSTS démarre à 300 s** : le temps de vérifier que tout fonctionne. Une fois validé, relancer avec `HSTS_MAX_AGE=31536000`. (Un HSTS d'un an posé trop tôt est difficile à retirer.)
- **CSP en mode observation** : ouvrir la console du navigateur sur les parcours principaux (connexion, dépôt de demande, paiement, messagerie, envoi de fichier). Quand elle est propre, passer l'en-tête `Content-Security-Policy-Report-Only` en `Content-Security-Policy` dans `infra/nginx/frigo-security.conf.template`.
- Renouvellement automatique (minuterie certbot, rechargement de Nginx). Vérifier : `sudo certbot renew --dry-run`.
- Modifier un fichier de `infra/nginx/` ne s'applique **pas** au déploiement : relancer `setup-nginx.sh` (il nécessite `sudo`, que l'utilisateur `deploy` n'a volontairement pas).

**Ce qui est exposé publiquement** : le site ; sur l'API, **uniquement** `/api/v1/webhooks/stripe`, `/api/v1/health/ready` et `/socket.io/` ; sur Keycloak, uniquement le realm `frigoconnect` et ses ressources ; sur MinIO, lecture et dépôt (pas de suppression). **Jamais publics** : la console Keycloak (`/admin`), le realm `master`, les métriques, la console MinIO, le reste de l'API.

**Accéder aux consoles d'administration** (depuis votre poste) :
```bash
ssh -L 8080:127.0.0.1:8080 -L 9001:127.0.0.1:9001 deploy@serveur
# puis http://localhost:8080 (Keycloak, compte KEYCLOAK_ADMIN_USER) et http://localhost:9001 (MinIO)
```

## 3. Première mise en ligne
1. Créer `/opt/frigoconnect/.env` : `bash infra/scripts/gen-env.sh /opt/frigoconnect/.env` génère les secrets, puis **renseigner à la main** les vraies valeurs : `APP_URL=https://app.exemple.fr`, `APP_DOMAIN`, `KEYCLOAK_PUBLIC_URL=https://auth.exemple.fr`, `S3_PUBLIC_ENDPOINT=https://files.exemple.fr`, clés Stripe (live ou test), `RESEND_API_KEY`, `MAIL_FROM`. **`NEXT_PUBLIC_WS_URL` : laisser VIDE** (même origine).
2. Configurer les secrets et variables GitHub de l'environnement (voir `docs/CICD.md`), puis lancer le workflow **Deploy** (ou fusionner sur `main`).
3. Créer le premier administrateur : `docker compose --env-file .env --env-file .images.env exec api node apps/api/dist/scripts/seed-admin.js admin@exemple.fr Prénom Nom`.
4. Dans le tableau de bord Stripe, déclarer le webhook `https://app.exemple.fr/api/v1/webhooks/stripe` (événements : `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `account.updated`, `charge.dispute.created`) et copier son secret dans `STRIPE_WEBHOOK_SECRET`.

## 4. Sauvegardes et surveillance

```bash
sudo APP_URL=https://app.exemple.fr bash infra/server/install-ops.sh
```
Il installe 3 minuteries et **affiche une seule fois le mot de passe de chiffrement** des sauvegardes : copiez-le **tout de suite** dans un gestionnaire de mots de passe, hors du serveur. **Sans lui, les sauvegardes sont définitivement illisibles.**

Puis compléter `/etc/frigoconnect/backup.env` (stockage S3 hors serveur, URL de surveillance « homme mort ») et `/etc/frigoconnect/watchdog.env` (`ALERT_WEBHOOK_URL`), et **tester tout de suite** :
```bash
sudo systemctl start frigo-backup.service && journalctl -u frigo-backup.service -n 30 --no-pager
sudo systemctl start frigo-restore-test.service && journalctl -u frigo-restore-test.service -n 30 --no-pager
```

| Tâche | Quand | Rôle |
|---|---|---|
| `frigo-backup` | chaque nuit à 02:30 | Bases (application et Keycloak, archives vérifiées lisibles), fichiers, **configuration avec `.env`**, chiffrés et envoyés hors serveur. Rétention 7 jours / 4 semaines / 6 mois. Le dimanche : nettoyage et relecture de 5 % des données distantes |
| `frigo-restore-test` | le 1er de chaque mois | Restaure le dernier instantané dans une base **jetable** et vérifie : ≥ 20 tables, version du schéma connue de l'API, PostGIS, realm Keycloak lisible |
| `frigo-watchdog` | toutes les 5 minutes | Site joignable de l'extérieur, conteneurs sains, disque < 85 %, certificat > 14 jours, sauvegarde < 36 h. Alerte au changement d'état, rappel toutes les 6 h, message « rétabli » |
| Avant chaque déploiement | automatique | Copie locale des bases ; **si elle échoue, le déploiement est annulé** |

Les alertes des minuteries et la surveillance « homme mort » se complètent : si le serveur entier tombe, le watchdog est mort aussi, mais l'absence de signal de sauvegarde, elle, déclenche l'alerte. Prévoyez en plus une sonde **externe** gratuite (UptimeRobot, Better Stack) sur `https://app.exemple.fr/api/v1/health/ready`.

## 5. Reprise après sinistre (serveur perdu)

Objectif : reconstruire à l'identique sur un nouveau VPS à partir de la dernière sauvegarde (perte maximale : < 24 h).

```bash
# 1. Nouveau VPS : sections 1 et 2 de ce guide (bootstrap + setup-nginx ; le DNS pointe sur la nouvelle IP).
# 2. Récupérer les accès au stockage de sauvegarde et le MOT DE PASSE restic (gestionnaire de mots de passe) :
sudo install -d -m 700 /etc/frigoconnect
sudo editor /etc/frigoconnect/backup.env /etc/frigoconnect/restic.pass       # mêmes valeurs qu'avant
set -a; . /etc/frigoconnect/backup.env; set +a
restic snapshots                                                              # repérer le dernier « nightly »
sudo -E restic restore latest --tag nightly --target /tmp/restore
D="$(dirname "$(find /tmp/restore -name app.dump | head -1)")"

# 3. Configuration (le .env contient TOUS les secrets : mêmes mots de passe qu'avant)
sudo cp "$D/config/.env" "$D/config/docker-compose.yml" /opt/frigoconnect/ && sudo cp -r "$D/config/infra" /opt/frigoconnect/
sudo chown -R deploy: /opt/frigoconnect && cd /opt/frigoconnect

# 4. Bases d'abord, SANS démarrer l'API (elle appliquerait ses migrations sur une base vide)
docker compose up -d postgres
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < "$D/app.dump"
docker compose exec -T postgres sh -c 'PGPASSWORD="$KEYCLOAK_DB_PASSWORD" pg_restore -h localhost -U keycloak -d keycloak --clean --if-exists --no-owner' < "$D/keycloak.dump"

# 5. Fichiers
docker compose up -d minio minio-init
docker compose run --rm --no-deps -T --entrypoint sh -v "$D/minio:/in" minio-init -c \
  'mc alias set l http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" && mc mirror --overwrite /in "l/$S3_BUCKET"'

# 6. Application, à la dernière version déployée, puis réinstaller les tâches
bash infra/scripts/deploy.sh "$(cat "$D/config/.deployed-tag")"       # avec IMAGE_PREFIX=ghcr.io/<org>/frigoconnect
sudo APP_URL=https://app.exemple.fr bash infra/server/install-ops.sh
```
Vérifier ensuite : connexion d'un compte existant, un devis signé, le téléchargement d'un fichier. **Répétez cette procédure à blanc** (sur un serveur de test) avant d'en avoir besoin : c'est la seule façon de savoir qu'elle fonctionne.

## 6. Liste de contrôle de sécurité
- [ ] Connexion SSH par clé uniquement, root interdit (`sshd -T | grep -E 'permitrootlogin|passwordauthentication'`)
- [ ] `ufw status` : uniquement 22, 80, 443 ; `ss -tlnp` : aucun écouteur public autre que Nginx et SSH
- [ ] `docker compose ps` : aucun port publié sur `0.0.0.0`
- [ ] Certificat valide, `certbot renew --dry-run` réussi, HSTS passé à un an
- [ ] CSP passée de « observation » à « application »
- [ ] Mot de passe restic **hors serveur** ; test de restauration réussi ce mois-ci
- [ ] Console Keycloak injoignable depuis Internet (`curl -I https://auth.exemple.fr/admin/` → 404)
- [ ] Clés Stripe de **production** uniquement sur le serveur de production
- [ ] Mises à jour automatiques actives (`systemctl status unattended-upgrades`)

## 7. Variante : VPS partagé avec Tanit Sign / Travel Tanit (staging)
Sur le VPS `178.18.253.237`, le **Nginx en conteneur de Tanit Sign** (`/opt/tanit`) occupe déjà les ports 80/443 et sert tous les sites. FrigoConnect s'y branche au lieu d'installer son propre Nginx :

```
Internet ─► Nginx Tanit Sign (TLS, filtrage, débit) ─► tanit-sign-net ─► fc-edge (relais TCP) ─► web · api · keycloak · minio
```
Adresses (sans achat de domaine, via sslip.io) : `https://app.178-18-253-237.sslip.io`, `auth.…`, `files.…`.

**Ne PAS lancer `bootstrap.sh` ni `setup-nginx.sh` sur ce serveur** : ils interdiraient la connexion root par mot de passe (utilisée par la CI de Tanit Sign et Travel Tanit), remplaceraient le pare-feu et installeraient un second Nginx sur les ports 80/443.

1. **Vérifier la place** (en root) : `free -h` ; FrigoConnect plafonne à ≈ 4 Go de RAM, à ajouter à ce qui tourne déjà. `docker network ls | grep tanit-sign-net` doit afficher le réseau.
2. **Utilisateur de déploiement** (clé publique de `deploy_key`, voir section 0) :
   ```bash
   adduser --disabled-password --gecos "" deploy && usermod -aG docker deploy
   install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
   echo "ssh-ed25519 AAAA... deploy-ci" > /home/deploy/.ssh/authorized_keys
   chown deploy: /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
   apt-get install -y rsync
   ```
3. **Dossier, `.env` et activation de la variante** :
   ```bash
   git clone https://github.com/houssemeddinekthiri/FrigoConnecte.git /tmp/fc-src
   mkdir -p /opt/frigoconnect && bash /tmp/fc-src/infra/scripts/gen-env.sh /opt/frigoconnect/.env
   ln -s infra/server/shared-vps/docker-compose.override.yml /opt/frigoconnect/docker-compose.override.yml
   chown -R deploy: /opt/frigoconnect && rm -rf /tmp/fc-src
   ```
   Dans `/opt/frigoconnect/.env`, renseigner :
   ```
   APP_URL=https://app.178-18-253-237.sslip.io
   APP_DOMAIN=app.178-18-253-237.sslip.io
   KEYCLOAK_PUBLIC_URL=https://auth.178-18-253-237.sslip.io
   S3_PUBLIC_ENDPOINT=https://files.178-18-253-237.sslip.io
   NEXT_PUBLIC_WS_URL=
   # ports locaux décalés : 3001 et 9001 sont déjà pris sur ce VPS (Uptime Kuma, console MinIO Tanit Sign)
   WEB_PORT=3100
   API_PORT=3101
   KEYCLOAK_PORT=8180
   MINIO_API_PORT=9100
   MINIO_CONSOLE_PORT=9101
   ```
   plus les clés Stripe **de test**, `RESEND_API_KEY` et `MAIL_FROM`. Le lien symbolique pointe dans le vide jusqu'au premier déploiement (qui envoie `infra/`) : c'est normal.
4. **Côté Tanit Sign** (dépôt `dev4`) : pousser sur `main` les vhosts FrigoConnect de `infra/docker/nginx.conf` et l'ajout des 3 noms au certificat dans `.github/workflows/deploy-production.yml`. Sa CI recharge Nginx à chaud et étend le certificat Let's Encrypt. Tant que FrigoConnect ne tourne pas, ces 3 noms répondent 502 ; Tanit Sign et Travel Tanit ne sont pas touchés.
5. **GitHub, environnement `staging`** (voir `docs/CICD.md`) : `SSH_HOST=178.18.253.237`, `SSH_USER=deploy`, `DEPLOY_DIR=/opt/frigoconnect`, `DEPLOY_URL=https://app.178-18-253-237.sslip.io`, secrets `SSH_PRIVATE_KEY` et `SSH_KNOWN_HOSTS` (`ssh-keyscan -t ed25519 178.18.253.237`).
6. **Premier déploiement** : Actions > Deploy > `staging` + un tag publié (ex. `sha-8936218dc534`), puis l'administrateur (section 3, étape 3).

Consoles par tunnel : `ssh -L 8180:127.0.0.1:8180 -L 9101:127.0.0.1:9101 deploy@178.18.253.237`. Les sauvegardes (section 4) restent à configurer à part.
