-- =============================================================================
-- NPIM-Businessplan: Mengengerüst (variantenbezogen)
-- Migration: 009_mengengeruest.sql
--
-- Konzept (siehe Memory project_stammdaten_per_project): Bestandsgebäude
-- liegen am Projekt; was eine Variante daraus macht (sanieren / abreissen /
-- behalten) bzw. was zusätzlich gebaut wird, hängt am variant_buildings.
--
-- Phase 1 (Hybrid-Modell, analog immo-portfolio): pro Gebäude Mietflächen
-- nach Nutzung, fixe Mengen (Parkplätze etc.) und Ertragsobjekte. Geschosse
-- und Einheiten kommen später als optionale Sub-Tabellen dazu, ohne dieses
-- Schema zu brechen.
-- =============================================================================

DO $$ BEGIN
    CREATE TYPE building_art AS ENUM (
        'neubau',
        'sanierung',
        'bestand_unveraendert',
        'abbruch'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- variant_buildings: Gebäude pro Variante
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS variant_buildings (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id            uuid NOT NULL REFERENCES project_variants(id) ON DELETE CASCADE,
    name                  text NOT NULL,
    art                   building_art NOT NULL DEFAULT 'neubau',
    -- Optionale Verknüpfung auf ein Bestandsgebäude des Projekts.
    -- Wenn gesetzt, beschreibt dieser Eintrag, was die Variante mit dem
    -- Bestandsgebäude macht (sanieren / abbrechen / unverändert).
    existing_building_id  uuid REFERENCES existing_buildings(id) ON DELETE SET NULL,
    nutzung_haupt         text,        -- z.B. "Wohnen", "gemischt"
    geschossflaeche_m2    numeric(12,2),
    volumen_m3            numeric(12,2),
    notizen               text,
    sort_order            smallint NOT NULL DEFAULT 0,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE variant_buildings ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_variant_buildings_variant_id  ON variant_buildings(variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_buildings_existing_id ON variant_buildings(existing_building_id);

DROP TRIGGER IF EXISTS trg_variant_buildings_updated_at ON variant_buildings;
CREATE TRIGGER trg_variant_buildings_updated_at
    BEFORE UPDATE ON variant_buildings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- building_mietflaechen: Mietflächen pro Nutzung pro Gebäude
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS building_mietflaechen (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_building_id uuid NOT NULL REFERENCES variant_buildings(id) ON DELETE CASCADE,
    nutzung             text NOT NULL,            -- "Wohnen", "Büro", "Gewerbe", …
    flaeche_m2          numeric(12,2) NOT NULL DEFAULT 0,
    sort_order          smallint NOT NULL DEFAULT 0,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE building_mietflaechen ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bmf_variant_building_id ON building_mietflaechen(variant_building_id);

DROP TRIGGER IF EXISTS trg_building_mietflaechen_updated_at ON building_mietflaechen;
CREATE TRIGGER trg_building_mietflaechen_updated_at
    BEFORE UPDATE ON building_mietflaechen
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- building_quantities: Fixe Mengen pro Gebäude (Parkplätze, Wohnungen, …)
-- 1:1 mit variant_buildings über UNIQUE-Constraint.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS building_quantities (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_building_id uuid NOT NULL REFERENCES variant_buildings(id) ON DELETE CASCADE,
    garagen_pp          integer,
    aussen_pp           integer,
    motorrad_pp         integer,
    velo_pp             integer,
    anzahl_wohnungen    integer,
    anzahl_gewerbe      integer,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (variant_building_id)
);

ALTER TABLE building_quantities ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_building_quantities_updated_at ON building_quantities;
CREATE TRIGGER trg_building_quantities_updated_at
    BEFORE UPDATE ON building_quantities
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- building_ertragsobjekte: Werbeflächen, Antennen, sonstige Ertragsobjekte
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS building_ertragsobjekte (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_building_id uuid NOT NULL REFERENCES variant_buildings(id) ON DELETE CASCADE,
    bezeichnung         text NOT NULL,
    anzahl              integer NOT NULL DEFAULT 1,
    notizen             text,
    sort_order          smallint NOT NULL DEFAULT 0,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE building_ertragsobjekte ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_beo_variant_building_id ON building_ertragsobjekte(variant_building_id);

DROP TRIGGER IF EXISTS trg_building_ertragsobjekte_updated_at ON building_ertragsobjekte;
CREATE TRIGGER trg_building_ertragsobjekte_updated_at
    BEFORE UPDATE ON building_ertragsobjekte
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS-Policies (analog zu Stammdaten):
--   Lesen für aktive User, Schreiben für admin/manager
-- -----------------------------------------------------------------------------

CREATE POLICY "variant_buildings_select_active"
    ON variant_buildings FOR SELECT TO authenticated
    USING (is_active_user());

CREATE POLICY "variant_buildings_insert_write"
    ON variant_buildings FOR INSERT TO authenticated
    WITH CHECK (can_write());

CREATE POLICY "variant_buildings_update_write"
    ON variant_buildings FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

CREATE POLICY "variant_buildings_delete_write"
    ON variant_buildings FOR DELETE TO authenticated
    USING (can_write());

CREATE POLICY "building_mietflaechen_select_active"
    ON building_mietflaechen FOR SELECT TO authenticated
    USING (is_active_user());

CREATE POLICY "building_mietflaechen_insert_write"
    ON building_mietflaechen FOR INSERT TO authenticated
    WITH CHECK (can_write());

CREATE POLICY "building_mietflaechen_update_write"
    ON building_mietflaechen FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

CREATE POLICY "building_mietflaechen_delete_write"
    ON building_mietflaechen FOR DELETE TO authenticated
    USING (can_write());

CREATE POLICY "building_quantities_select_active"
    ON building_quantities FOR SELECT TO authenticated
    USING (is_active_user());

CREATE POLICY "building_quantities_insert_write"
    ON building_quantities FOR INSERT TO authenticated
    WITH CHECK (can_write());

CREATE POLICY "building_quantities_update_write"
    ON building_quantities FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

CREATE POLICY "building_quantities_delete_write"
    ON building_quantities FOR DELETE TO authenticated
    USING (can_write());

CREATE POLICY "building_ertragsobjekte_select_active"
    ON building_ertragsobjekte FOR SELECT TO authenticated
    USING (is_active_user());

CREATE POLICY "building_ertragsobjekte_insert_write"
    ON building_ertragsobjekte FOR INSERT TO authenticated
    WITH CHECK (can_write());

CREATE POLICY "building_ertragsobjekte_update_write"
    ON building_ertragsobjekte FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

CREATE POLICY "building_ertragsobjekte_delete_write"
    ON building_ertragsobjekte FOR DELETE TO authenticated
    USING (can_write());
