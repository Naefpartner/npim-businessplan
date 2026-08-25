-- =============================================================================
-- NPIM-Businessplan: Erfassungstiefe Gebäude/Geschoss/Einheit
-- Migration: 010_mengengeruest_tiefe.sql
--
-- Pro Gebäude wählt der User die Tiefe der Erfassung:
--   - "gebaeude": nur Mietflächen pro Nutzung (wie bisher)
--   - "geschoss": Geschossliste + Mietflächen pro Geschoss
--   - "einheit":  Geschosse + einzelne Mieteinheiten mit Mietzins
--
-- Daten bleiben beim Wechsel der Tiefe in der DB. UI filtert je nach Tiefe.
-- Mietflächen ohne storey_id sind die "Gebäude-Ebene"-Einträge,
-- Mietflächen mit storey_id gehören zur Geschoss/Einheit-Ebene.
-- =============================================================================

DO $$ BEGIN
    CREATE TYPE erfassungstiefe AS ENUM ('gebaeude', 'geschoss', 'einheit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE leit_groesse AS ENUM ('gf', 'hnf');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE miete_modus AS ENUM ('chf_m2_pa', 'chf_stk_mt', 'chf_pa');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- variant_buildings: zusätzliche Steuerfelder
-- -----------------------------------------------------------------------------
ALTER TABLE variant_buildings
    ADD COLUMN IF NOT EXISTS erfassungstiefe     erfassungstiefe NOT NULL DEFAULT 'gebaeude',
    ADD COLUMN IF NOT EXISTS leit_groesse        leit_groesse    NOT NULL DEFAULT 'hnf',
    ADD COLUMN IF NOT EXISTS faktor_hnf_gf       numeric(5,3)              DEFAULT 0.82,
    ADD COLUMN IF NOT EXISTS geschosshoehe_m     numeric(5,2),
    ADD COLUMN IF NOT EXISTS hauptnutzflaeche_m2 numeric(12,2);

-- -----------------------------------------------------------------------------
-- building_storeys (Geschosse pro Gebäude)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS building_storeys (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_building_id uuid NOT NULL REFERENCES variant_buildings(id) ON DELETE CASCADE,
    bezeichnung         text NOT NULL,
    sort_order          smallint NOT NULL DEFAULT 0,
    leit_groesse        leit_groesse NOT NULL DEFAULT 'hnf',
    faktor_hnf_gf       numeric(5,3),    -- null = Default vom Gebäude erben
    geschosshoehe_m     numeric(5,2),
    gf_m2               numeric(12,2),
    hnf_m2              numeric(12,2),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE building_storeys ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_building_storeys_variant_building_id
    ON building_storeys(variant_building_id);

DROP TRIGGER IF EXISTS trg_building_storeys_updated_at ON building_storeys;
CREATE TRIGGER trg_building_storeys_updated_at
    BEFORE UPDATE ON building_storeys
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE POLICY "building_storeys_select_active"
    ON building_storeys FOR SELECT TO authenticated
    USING (is_active_user());

CREATE POLICY "building_storeys_insert_write"
    ON building_storeys FOR INSERT TO authenticated
    WITH CHECK (can_write());

CREATE POLICY "building_storeys_update_write"
    ON building_storeys FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

CREATE POLICY "building_storeys_delete_write"
    ON building_storeys FOR DELETE TO authenticated
    USING (can_write());

-- -----------------------------------------------------------------------------
-- building_mietflaechen: zusätzliche Felder für Geschoss/Einheit-Erfassung
-- -----------------------------------------------------------------------------
ALTER TABLE building_mietflaechen
    ADD COLUMN IF NOT EXISTS storey_id   uuid REFERENCES building_storeys(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS bezeichnung text,
    ADD COLUMN IF NOT EXISTS miete_modus miete_modus,
    ADD COLUMN IF NOT EXISTS miete_wert  numeric(12,2),
    ADD COLUMN IF NOT EXISTS anzahl      smallint NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS zimmer      numeric(3,1);

CREATE INDEX IF NOT EXISTS idx_bmf_storey_id ON building_mietflaechen(storey_id);
