# syntax=docker/dockerfile:1.7
# Contexte de build : la RACINE du dépôt. docker build -f infra/docker/web.Dockerfile .
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM deps AS build
# Variables « publiques » : incorporées au JavaScript du navigateur À LA COMPILATION (pas de secret ici)
ARG NEXT_PUBLIC_WS_URL=""
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL} \
    NEXT_TELEMETRY_DISABLED=1 \
    # valeurs factices : lues pendant la compilation, jamais conservées (les vraies valeurs arrivent au démarrage)
    AUTH_SECRET=build-only KEYCLOAK_ISSUER=http://localhost:8080/realms/frigoconnect KEYCLOAK_CLIENT_ID=frigoconnect-web API_URL=http://api:3001
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN npm run build:contracts && npm run build -w @frigoconnect/web

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# Sortie « standalone » : uniquement les fichiers réellement utilisés (image ~10x plus légère)
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
# Next écrit son cache de rendu dans .next/cache : l'utilisateur non-root doit pouvoir y créer des fichiers
RUN mkdir -p /app/apps/web/.next/cache && chown -R node:node /app/apps/web/.next
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
