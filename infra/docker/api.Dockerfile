# syntax=docker/dockerfile:1.7
# Contexte de build : la RACINE du dépôt (monorepo). docker build -f infra/docker/api.Dockerfile .
ARG NODE_IMAGE=node:22-alpine

# ---------- 1) dépendances complètes (compilation) ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
# Seuls les package.json (et le verrou) sont copiés ici : la couche reste en cache tant que les dépendances ne changent pas
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ---------- 2) compilation ----------
FROM deps AS build
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN npm run build:contracts && npm run build -w @frigoconnect/api

# ---------- 3) dépendances de production uniquement ----------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund -w @frigoconnect/api -w @frigoconnect/contracts

# ---------- 4) image finale ----------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3001 \
    MIGRATIONS_DIR=/app/db
WORKDIR /app
# Même disposition que le dépôt : le lien npm node_modules/@frigoconnect/contracts -> ../../packages/contracts reste valide
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=build /repo/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /repo/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY db ./db

USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Les migrations passent AVANT l'API : un schéma qui ne s'applique pas empêche le démarrage (le conteneur n'est jamais « sain »).
CMD ["sh", "-c", "node apps/api/dist/migrate.js && exec node apps/api/dist/main.js"]
