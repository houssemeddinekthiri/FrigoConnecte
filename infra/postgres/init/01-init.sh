#!/bin/sh
# Exécuté UNE SEULE FOIS, à la création du volume de données (image postgres : /docker-entrypoint-initdb.d).
# Crée la base et le rôle de Keycloak (séparés de ceux de l'application) et active pg_stat_statements pour le suivi des requêtes lentes.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  CREATE ROLE keycloak LOGIN PASSWORD '${KEYCLOAK_DB_PASSWORD}';
  CREATE DATABASE keycloak OWNER keycloak;
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SQL
