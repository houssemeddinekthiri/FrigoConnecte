#!/usr/bin/env bash
# Génère un fichier .env à partir de .env.example en remplissant chaque secret VIDE par une valeur aléatoire.
#   infra/scripts/gen-env.sh [sortie]      (défaut : .env ; refuse d'écraser un fichier existant)
# Utilisé par la CI (test de fumée) et pour un premier essai local. Les clés Stripe/Resend gardent leurs valeurs factices.
set -euo pipefail

out="${1:-.env}"
src="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.env.example"
[ ! -e "$out" ] || { echo "$out existe déjà : je ne l'écrase pas" >&2; exit 1; }

rand() { if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32; else head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; fi; }

: >"$out"
while IFS= read -r line || [ -n "$line" ]; do
  if [[ "$line" =~ ^([A-Z0-9_]+)=$ ]]; then
    case "${BASH_REMATCH[1]}" in
      RESEND_API_KEY) printf '%s=\n' "${BASH_REMATCH[1]}" >>"$out" ;;   # vide volontairement : les emails sont journalisés
      *) printf '%s=%s\n' "${BASH_REMATCH[1]}" "$(rand)" >>"$out" ;;
    esac
  else
    printf '%s\n' "$line" >>"$out"
  fi
done <"$src"
chmod 600 "$out"
echo "$out généré ($(grep -c '^[A-Z0-9_]*=.' "$out") variables renseignées)"
