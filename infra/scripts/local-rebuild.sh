#!/usr/bin/env bash
# Local (WSL) : recopie les sources vers ~/frigoconnect et reconstruit les services demandés (web par défaut). .env et données conservés.
set -uo pipefail
SRC=/mnt/c/Users/kthir/Desktop/platforme; DST="$HOME/frigoconnect"
SERVICES=("${@:-web}")
echo "1/3 Copie des fichiers…"
tar -C "$SRC" --exclude=node_modules --exclude=.next --exclude=dist --exclude=.git --exclude=.env --exclude=LOCAL-ACCESS.txt -cf - . | tar -C "$DST" -xf - 2>/dev/null
cd "$DST"
find . -type f \( -name '*.sh' -o -name '*.yml' -o -name '*.json' -o -name '*.ts' -o -name '*.tsx' -o -name '*.Dockerfile' \) -not -path './node_modules/*' -exec sed -i 's/\r$//' {} +
echo "2/3 Construction de ${SERVICES[*]} (2 à 5 minutes la première fois, les étapes défilent ci-dessous)…"
# sortie condensée : une ligne par étape de construction, pour voir que ça avance
docker compose build --progress=plain "${SERVICES[@]}" 2>&1 | grep -E '^#[0-9]+ \[|ERROR|error TS|Failed|DONE [0-9.]+s$' | grep -vE 'CACHED' | cut -c1-120
echo "3/3 Redémarrage…"
docker compose up -d "${SERVICES[@]}" 2>&1 | grep -iE "error|failed"
bash infra/scripts/wait-healthy.sh 300 "${SERVICES[@]}"
echo "Terminé : faites Ctrl+F5 dans le navigateur."
