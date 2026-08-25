-- =============================================================================
-- NPIM-Businessplan: Stammdaten (Parzellen, Bestandsgebäude, Baurecht)
-- Migration: 003_stammdaten.sql
--
-- Stammdaten sind PROJEKT-bezogen, nicht variantenbezogen:
--   - Parzellen-Geometrie und GVZ-Nummern sind objektive Realität
--   - Variantenabhängige Annahmen (z.B. "Bestandsgebäude X wird abgebrochen")
--     gehören ins Mengengerüst-/Anlagekosten-Modul der jeweiligen Variante
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ENUMS
-- -----------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE building_condition AS ENUM (
        'gut',
        'mittel',
        'sanierungsbeduerftig',
        'abbruchreif'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE building_right_kind AS ENUM (
        'berechtigt',  -- wir sind Baurechtnehmer (auf fremdem Grund)
        'belastet'     -- unser Grundstück ist mit Baurecht zugunsten Dritter belastet
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- parcels (Parzellen)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parcels (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parzelle_nummer   text NOT NULL,
    gemeinde          text,
    kanton            text,
    flaeche_m2        numeric(12,2),  -- Grundstücksfläche
    agsf_m2           numeric(12,2),  -- anrechenbare Grundstücksfläche
    zone              text,
    eigentuemer       text,
    erwerbsdatum      date,
    erwerbspreis_chf  numeric(14,2),
    notizen           text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE parcels ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_parcels_project_id ON parcels(project_id);

DROP TRIGGER IF EXISTS trg_parcels_updated_at ON parcels;
CREATE TRIGGER trg_parcels_updated_at
    BEFORE UPDATE ON parcels
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- existing_buildings (Bestandsgebäude)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS existing_buildings (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    bezeichnung         text NOT NULL,
    gvz_nummer          text,
    baujahr             smallint CHECK (baujahr IS NULL OR (baujahr > 1500 AND baujahr < 2100)),
    nutzung             text,
    geschossflaeche_m2  numeric(12,2),
    volumen_m3          numeric(12,2),
    zustand             building_condition,
    vermietet           boolean NOT NULL DEFAULT false,
    jahresertrag_chf    numeric(14,2),
    notizen             text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE existing_buildings ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_existing_buildings_project_id ON existing_buildings(project_id);

DROP TRIGGER IF EXISTS trg_existing_buildings_updated_at ON existing_buildings;
CREATE TRIGGER trg_existing_buildings_updated_at
    BEFORE UPDATE ON existing_buildings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- building_rights (Baurechte)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS building_rights (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id            uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    art                   building_right_kind NOT NULL,
    parzelle_id           uuid REFERENCES parcels(id) ON DELETE SET NULL,
    gegenpartei           text,
    laufzeit_von          date,
    laufzeit_bis          date,
    baurechtszins_chf_pa  numeric(12,2),
    indexierung_text      text,
    heimfall_text         text,
    notizen               text,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE building_rights ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_building_rights_project_id ON building_rights(project_id);
CREATE INDEX IF NOT EXISTS idx_building_rights_parzelle_id ON building_rights(parzelle_id);

DROP TRIGGER IF EXISTS trg_building_rights_updated_at ON building_rights;
CREATE TRIGGER trg_building_rights_updated_at
    BEFORE UPDATE ON building_rights
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS-Policies (analog projects/variants):
--   Lesen für aktive User, Schreiben für admin/manager
-- -----------------------------------------------------------------------------

CREATE POLICY "parcels_select_active"
    ON parcels FOR SELECT TO authenticated
    USING (is_active_user());

CREATE POLICY "parcels_insert_write"
    ON parcels FOR INSERT TO authenticated
    WITH CHECK (can_write());

CREATE POLICY "parcels_update_write"
    ON parcels FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

CREATE POLICY "parcels_delete_write"
    ON parcels FOR DELETE TO authenticated
    USING (can_write());

CREATE POLICY "existing_buildings_select_active"
    ON existing_buildings FOR SELECT TO authenticated
    USING (is_active_user());

CREATE POLICY "existing_buildings_insert_write"
    ON existing_buildings FOR INSERT TO authenticated
    WITH CHECK (can_write());

CREATE POLICY "existing_buildings_update_write"
    ON existing_buildings FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

CREATE POLICY "existing_buildings_delete_write"
    ON existing_buildings FOR DELETE TO authenticated
    USING (can_write());

CREATE POLICY "building_rights_select_active"
    ON building_rights FOR SELECT TO authenticated
    USING (is_active_user());

CREATE POLICY "building_rights_insert_write"
    ON building_rights FOR INSERT TO authenticated
    WITH CHECK (can_write());

CREATE POLICY "building_rights_update_write"
    ON building_rights FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

CREATE POLICY "building_rights_delete_write"
    ON building_rights FOR DELETE TO authenticated
    USING (can_write());
