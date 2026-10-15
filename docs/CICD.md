# CI/CD : mise en place et exploitation

## Vue d'ensemble

```
Pull request ──► CI : compilation + tests unitaires ─ intégration SQL (PostGIS réel) ─ audit npm ─ pile Docker complète + test de fumée
                                              │ (obligatoire pour fusionner)
Fusion sur main ─► CI ─► images publiées (GHCR) + analyse Trivy ─► STAGING (auto) ─► PRODUCTION (validation manuelle)
                                                                       │                     │
                                                           retour arrière auto        retour arrière auto
```

- **Construire une fois, déployer partout** : staging et production reçoivent le **même tag** (`sha-<12 premiers caractères du commit>`). Les images ne dépendent d'aucun domaine (le temps réel utilise l'origine du site).
- **Rien n'est publié si la CI échoue**, rien n'est déployé si l'analyse Trivy trouve une vulnérabilité critique corrigeable.
- Les **secrets applicatifs** (`.env`) vivent uniquement sur chaque serveur : la CI ne les voit jamais.

## 1. Réglages GitHub (une fois)

**Environnements** (Settings > Environments) : créer `staging` et `production`.
- `production` : cocher **Required reviewers** (vous-même ou l'équipe). C'est ce qui déclenche la validation manuelle. Option : *Deployment branches* limité à `main`.

**Secrets et variables, par environnement** (pas au niveau du dépôt : staging et production ont des valeurs différentes) :

| Type | Nom | Valeur |
|---|---|---|
| Secret | `SSH_PRIVATE_KEY` | clé privée **dédiée** au déploiement (`ssh-keygen -t ed25519 -f deploy_key -N ""`) |
| Secret | `SSH_KNOWN_HOSTS` | empreinte du serveur : `ssh-keyscan -t ed25519 <hôte>`, à **comparer** avec l'empreinte affichée par la console de l'hébergeur avant de la coller |
| Variable | `SSH_HOST` | nom DNS ou IP du serveur |
| Variable | `SSH_USER` | `deploy` |
| Variable | `DEPLOY_DIR` | `/opt/frigoconnect` |
| Variable | `DEPLOY_URL` | `https://staging.exemple.fr` (optionnel : active le contrôle de santé depuis l'extérieur) |

**Activation du déploiement automatique** : une fois les environnements remplis, créer la variable **de dépôt** (Settings > Secrets and variables > Actions > Variables) `DEPLOY_ENABLED` = `true`. Sans elle, « Release » s'arrête après la publication des images (staging et production apparaissent « skipped »). Le déploiement manuel (Actions > Deploy) n'en dépend pas.

**Protection de `main`** (Settings > Branches) : exiger une pull request et les contrôles `Compilation et tests unitaires`, `Intégration SQL (PostGIS réel)`, `Dépendances (vulnérabilités critiques)`, `Pile Docker complète`.

**Paquets** : le premier push crée les paquets `frigoconnect-api` et `frigoconnect-web` dans GHCR, liés au dépôt (étiquette `org.opencontainers.image.source`). Le déploiement s'authentifie avec le jeton éphémère du workflow : aucun jeton personnel n'est stocké.

## 2. Serveur (staging et production)

Prérequis (installés en Phase 15) : Docker + plugin Compose v2, `rsync`, un utilisateur `deploy` dans le groupe `docker`, dont la clé publique correspond à `SSH_PRIVATE_KEY`.

```bash
sudo mkdir -p /opt/frigoconnect && sudo chown deploy: /opt/frigoconnect
# en tant que deploy :
cd /opt/frigoconnect
# depuis une copie du dépôt : générer le .env (secrets aléatoires) puis REMPLIR les vraies valeurs (domaines, Stripe, Resend)
bash infra/scripts/gen-env.sh .env      # ou : cp .env.example .env et tout renseigner à la main
```
Le premier déploiement (workflow ou manuel) envoie `docker-compose.yml` et `infra/` ; le `.env` n'est **jamais** écrasé.

Premier administrateur (après le premier déploiement) :
```bash
docker compose --env-file .env --env-file .images.env exec api node apps/api/dist/scripts/seed-admin.js admin@exemple.fr Prénom Nom
```

## 3. Retour arrière

**Automatique** : `deploy.sh` démarre la nouvelle version, attend que `api` et `web` soient `healthy` (240 s) ; sinon il **rétablit la version précédente**, journalise la cause, et le workflow échoue (code 1 : la version est refusée). Code 3 = le retour arrière a lui aussi échoué : intervention humaine.

**Manuel** : Actions > **Deploy** > Run workflow > choisir l'environnement et le **tag d'une version précédente** (visible dans Packages ou dans l'historique des Releases).

### Règle d'or : des migrations compatibles dans les deux sens
Le retour arrière ne concerne que les **images** : le schéma SQL, lui, ne recule jamais. Pour qu'une ancienne image fonctionne avec un schéma plus récent, appliquer **expand / contract** :

1. **Expand** (version N) : ajouter la colonne/table, sans rien supprimer ni renommer ; le code N écrit les deux formes.
2. **Contract** (version N+1, plus tard) : supprimer l'ancien une fois N+1 stabilisée.

Ne jamais, dans la même version : renommer ou supprimer une colonne lue par la version précédente, ou ajouter une colonne `NOT NULL` sans valeur par défaut.

## 4. Mises à jour de dépendances
Dependabot ouvre chaque lundi des PR (npm, actions GitHub, images Docker de base) ; elles passent par la même CI. Les actions tierces sont épinglées par **version majeure** ; pour un durcissement supplémentaire, les épingler par empreinte de commit (Dependabot sait les maintenir).

## 5. Ce qui a été vérifié, et ce qui ne l'a pas été

**Exécuté pour de vrai** : la pile Docker complète (images, 7 services, test de fumée `infra/scripts/smoke.sh` : 11 vérifications dont l'import du realm, l'OTP administrateur et `seed-admin`), les **40 scénarios d'intégration sur PostGIS réel** (`npm run test:integration`), la sauvegarde et le test de restauration.

**Vérifié par simulation** : `deploy.sh`, `wait-healthy.sh` et `gen-env.sh` contre un faux `docker` (29 scénarios dont le retour arrière, l'échec du retour arrière, le verrou et le refus d'un tag piégé) ; syntaxe et références croisées des 3 workflows (entrées, `needs`, scripts, aucune interpolation `${{ }}` dans un script shell).

**Jamais exécuté** : aucun workflow n'a tourné sur GitHub ; le déploiement SSH et `rsync` ; l'analyse Trivy ; la publication vers GHCR. **Le premier passage de la CI peut donc échouer** sur l'un de ces points, c'est son rôle de les révéler. Lisez le job en échec avant de conclure à un bug du workflow ou de l'application.
