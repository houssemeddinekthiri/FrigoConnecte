# Lancer FrigoConnect avec Docker

## Prérequis
Docker Desktop (ou Docker Engine + plugin Compose v2), 8 Go de RAM recommandés (le compose plafonne la mémoire de chaque service : ≈ 4 Go au total).

## Démarrage

```bash
cp .env.example .env
# Remplir CHAQUE secret vide. Générer une valeur :   openssl rand -hex 32
# Stripe : clés de test (sk_test_ / pk_test_). Webhook local : stripe listen --forward-to localhost:3001/api/v1/webhooks/stripe
docker compose up -d --build
docker compose ps          # tous les services doivent passer à « healthy » (Keycloak : ~1 min)
```

| Service | Adresse locale | Rôle |
|---|---|---|
| Site | http://localhost:3000 | Next.js |
| API | http://localhost:3001/api/v1/health | NestJS (applique les migrations SQL au démarrage) |
| Keycloak | http://localhost:8080 | Authentification (console : `KEYCLOAK_ADMIN_USER`) |
| MinIO | http://localhost:9001 | Console des fichiers |

PostgreSQL et Redis ne sont **pas** publiés. Tous les ports sont liés à `127.0.0.1`.

## Premier administrateur

```bash
docker compose exec api node apps/api/dist/scripts/seed-admin.js admin@votre-domaine.fr Prénom Nom
```
Affiche un mot de passe provisoire (une seule fois). À la première connexion : changement du mot de passe, puis configuration obligatoire d'une application d'authentification (OTP).

## Commandes utiles

```bash
docker compose logs -f api            # journaux
docker compose exec postgres psql -U frigo frigoconnect
docker compose down                   # arrêt (les données restent dans les volumes)
docker compose down -v                # ⚠ SUPPRIME toutes les données (bases, fichiers)
docker compose build web              # obligatoire si NEXT_PUBLIC_WS_URL change (valeur figée à la compilation)
```

## Migrations de base de données
Les fichiers `db/NNN_*.sql` sont appliqués **dans l'ordre, au démarrage de l'API**, chacun dans une transaction, et enregistrés dans `schema_migrations` avec leur empreinte.

- **Ne modifiez jamais** une migration déjà appliquée : l'API refuse de démarrer. Ajoutez un nouveau fichier (`007_...sql`).
- Une migration qui échoue est annulée et empêche le démarrage : le conteneur n'est jamais « healthy » sur un schéma à moitié appliqué.

## Dépannage

| Symptôme | Piste |
|---|---|
| `POSTGRES_PASSWORD manquant` au `up` | Variable vide dans `.env` (voulu : le compose refuse de démarrer sans secret) |
| API « unhealthy » | `docker compose logs api` : migration en échec, ou base inaccessible |
| Connexion impossible / boucle de redirection | `KEYCLOAK_PUBLIC_URL` doit être exactement l'adresse que le **navigateur** utilise ; l'« iss » des jetons en dépend |
| Envoi de fichier refusé (CORS) | `APP_URL` doit être l'origine exacte du site (MinIO n'autorise que celle-ci) |
| Keycloak ignore une modification du realm | Le fichier n'est importé qu'à la **création** du realm. Pour réimporter en développement : `docker compose down -v` |
| `exec ... /init.sh: no such file` | Fins de ligne CRLF dans un script `.sh` (voir `.gitattributes`) |

## Stockage de fichiers : MinIO

Les images officielles de MinIO ne sont **plus publiées** sur Docker Hub ni sur quay.io (vérifié en octobre 2026). Le compose utilise par défaut le fork communautaire maintenu **`pgsty/minio`** (et son client `pgsty/mc`), configurable par `MINIO_IMAGE` et `MC_IMAGE`. L'application n'utilise que l'API S3 : changer de fournisseur (compilation depuis les sources de MinIO, SeaweedFS, Garage, RustFS…) ne touche pas au code, seulement à l'image et à `minio-init`. C'est une décision de chaîne d'approvisionnement à valider avant la production.

## Ports déjà utilisés

Si 3000, 3001, 8080, 9000 ou 9001 sont pris, définir dans `.env` : `WEB_PORT`, `API_PORT`, `KEYCLOAK_PORT`, `MINIO_API_PORT`, `MINIO_CONSOLE_PORT`, **et** aligner `APP_URL`, `KEYCLOAK_PUBLIC_URL`, `S3_PUBLIC_ENDPOINT`, `NEXT_PUBLIC_WS_URL` (ce sont les adresses vues par le navigateur).

## Ce qui a été vérifié

**Exécuté pour de vrai (Docker Engine 29 sous WSL, Ubuntu 24.04)** : construction des deux images ; démarrage des **7 services** jusqu'à l'état « sain » ; import du realm Keycloak avec le flux OTP administrateur et les trois clients OIDC ; émetteur des jetons égal à l'adresse publique ; recherche PostGIS ; bucket et compte applicatif MinIO ; création du premier administrateur de bout en bout ; **40 scénarios SQL sur PostGIS réel** (devis, signature, contrat, paiements, versements, remboursements, avis, administration, recherche géographique, index GiST) ; **sauvegarde réelle** (`pg_dump`, copie MinIO) et **test de restauration réel** dans une base jetable (31 tables, schéma reconnu, realm Keycloak restauré).

**Simulé ou jamais exécuté** : le chiffrement et l'envoi hors serveur de **restic** (remplacé par une copie locale), tout appel réel à **Stripe** (webhooks, Connect, transferts), l'envoi d'**emails**, le déploiement **SSH** depuis GitHub Actions, les workflows GitHub eux-mêmes, et les scripts d'installation du serveur (`bootstrap.sh`, `setup-nginx.sh` avec Let's Encrypt, `install-ops.sh`) qui exigent un Ubuntu avec droits root et un nom de domaine.
