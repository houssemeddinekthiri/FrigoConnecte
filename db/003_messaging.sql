-- Phase 9 : messagerie et notifications

-- Indique qu'une partie du message a été masquée (coordonnées avant acceptation d'un devis).
-- L'original n'est volontairement PAS conservé.
ALTER TABLE messages ADD COLUMN masked boolean NOT NULL DEFAULT false;

-- Idempotence : l'outbox est "au moins une fois", une même mise en relation ne notifie qu'une fois.
CREATE UNIQUE INDEX notif_request_matched_once
  ON notifications (user_id, type, (data->>'requestId'))
  WHERE type = 'request.matched';
