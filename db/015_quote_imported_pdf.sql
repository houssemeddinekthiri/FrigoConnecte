-- Devis présenté au client sous la forme d'un PDF importé par le prestataire (la signature du client vient après, sur son empreinte).
ALTER TABLE quotes ADD COLUMN pdf_imported boolean NOT NULL DEFAULT false;
