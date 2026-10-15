-- Les permissions vivent dans le code (apps/api/src/shared/auth/permissions.ts), pas en base.
ALTER TABLE roles DROP COLUMN permissions;
