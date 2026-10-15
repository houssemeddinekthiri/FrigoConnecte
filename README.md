# FrigoConnect

Plateforme de mise en relation entre **frigoristes, chauffagistes et techniciens CVC** et leurs clients (entreprises, commerces, hôtels, restaurants, syndics, collectivités, particuliers) : dépôt de demande, matching géographique, messagerie temps réel, devis signés électroniquement, paiement séquestré (Stripe Connect), avis, administration.

## Architecture

Monolithe modulaire NestJS (DDD, CQRS) + site Next.js en BFF, PostgreSQL/PostGIS, Keycloak, MinIO (S3), Redis, Stripe, Nginx.

```
apps/api/            API NestJS : modules identity, providers, matching, service-requests, quotes, contracts, payments,
                     messaging, files, notifications, reviews, admin (+ migrations, scripts)
apps/web/            Next.js 15 / React 19 : site public, espaces client, prestataire, administration
packages/contracts/  Schémas Zod et types partagés API ↔ web (une seule source de validation et de calcul)
db/                  Migrations SQL numérotées (appliquées au démarrage de l'API)
infra/               Docker, Nginx, Keycloak (realm), MinIO, scripts de déploiement, sauvegardes, serveur
.github/             CI (tests, intégration PostGIS, pile Docker), Release (GHCR, staging, production), Deploy
docs/                Guides d'exploitation
```

## Démarrer

```bash
npm ci
npm run build           # contrats partagés + API
npm test                # tests unitaires
```
Pile complète (Docker) : voir **[docs/RUN.md](docs/RUN.md)**.

## Documentation

| Document | Contenu |
|---|---|
| [docs/RUN.md](docs/RUN.md) | Lancer la pile en local, premier administrateur, dépannage |
| [docs/CICD.md](docs/CICD.md) | Pipeline GitHub Actions, environnements, secrets, retour arrière, règle des migrations |
| [docs/SERVER.md](docs/SERVER.md) | Installer un serveur, Nginx et TLS, sauvegardes, surveillance, **reprise après sinistre** |
| [docs/wireframes/index.html](docs/wireframes/index.html) | Maquettes interactives (accueil, recherche, dépôt de demande) |

## Règles à connaître

- **Ne jamais modifier une migration déjà appliquée** : en ajouter une (`db/NNN_*.sql`), compatible avec la version précédente de l'application (*expand/contract*).
- **Les montants** sont des entiers en centimes, **recalculés côté serveur** ; la fonction de calcul des devis est partagée (`packages/contracts`).
- **Fins de ligne LF** pour tous les fichiers (`.editorconfig`, `.gitattributes`) : les scripts s'exécutent dans des conteneurs Linux.
- Aucun secret dans le dépôt : `.env` n'existe que sur chaque serveur.
