@echo off
rem Copie l'API, les contrats et les migrations vers la copie WSL puis reconstruit le conteneur API.
wsl -e bash -lc "cd ~/frigoconnect && S=/mnt/c/Users/kthir/Desktop/platforme && for d in apps/api packages/contracts db; do rsync -a --exclude node_modules --exclude dist $S/$d/ $d/; done && docker compose up -d --build api"
