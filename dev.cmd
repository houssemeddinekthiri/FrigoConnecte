@echo off
rem Lance le site en mode développement (modifications visibles en 1-2 s). Docker doit tourner (API, Keycloak...).
wsl -e bash -lc "cd ~/frigoconnect && docker compose up -d postgres redis keycloak minio api && docker compose stop web"
cd /d "%~dp0"
call npm run build:contracts
cd apps\web
npx next dev
