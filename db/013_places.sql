-- Lieux : gouvernorat -> villes. Une ville déclare son gouvernorat par nom (parent_name) ;
-- le lien parent_id se fait tout seul, quel que soit l'ordre d'insertion.
CREATE TABLE places (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('governorate','city')),
  name        citext NOT NULL,
  parent_name citext,                                   -- gouvernorat déclaré (villes seulement)
  parent_id   uuid REFERENCES places(id) ON DELETE SET NULL,
  UNIQUE (kind, name),
  CHECK (kind = 'city' OR parent_name IS NULL)
);

-- Nouvelle ville : rattachée au gouvernorat s'il existe déjà.
CREATE FUNCTION places_link_city() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'city' AND NEW.parent_id IS NULL AND NEW.parent_name IS NOT NULL THEN
    SELECT id INTO NEW.parent_id FROM places WHERE kind = 'governorate' AND name = NEW.parent_name;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER places_link_city BEFORE INSERT ON places FOR EACH ROW EXECUTE FUNCTION places_link_city();

-- Nouveau gouvernorat : récupère les villes déjà créées qui lui appartiennent.
CREATE FUNCTION places_link_governorate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE places SET parent_id = NEW.id WHERE kind = 'city' AND parent_id IS NULL AND parent_name = NEW.name;
  RETURN NULL;
END $$;
CREATE TRIGGER places_link_governorate AFTER INSERT ON places FOR EACH ROW WHEN (NEW.kind = 'governorate') EXECUTE FUNCTION places_link_governorate();
