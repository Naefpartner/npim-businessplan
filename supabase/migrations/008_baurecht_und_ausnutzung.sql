-- =============================================================================
-- NPIM-Businessplan: Baurecht in Parzelle integrieren + Ausnutzungs-Modell
-- Migration: 008_baurecht_und_ausnutzung.sql
--
-- Anpassungen analog zu immo-portfolio:
--   - parcels bekommt "Baurecht vorhanden / Zins / Ablauf" als optionale Felder
--   - separate Tabelle building_rights wird gedropped (Modell wechselt zur
--     simplen Variante; falls in Zukunft komplexere Verträge nötig sind,
--     kommt dann eine eigene Tabelle wieder dazu)
--   - zone_regulations: pro Projekt + Bauzone die Eckwerte (AZ, BMZ, ÜZ, FFZ,
--     Vollgeschosse, anrechenbare UG/DG) für die Ausnutzungsberechnung
--   - projects: zusätzliche VMF-Inputs (Ausnützungsübertrag, % VMF/aBGF, etc.)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- parcels: Baurecht-Felder
-- -----------------------------------------------------------------------------
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS has_building_right       boolean NOT NULL DEFAULT false;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS building_right_fee_chf_pa numeric(12,2);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS building_right_expiry    date;

-- -----------------------------------------------------------------------------
-- Alte building_rights-Tabelle entfernen
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS building_rights CASCADE;
DROP TYPE  IF EXISTS building_right_kind;

-- -----------------------------------------------------------------------------
-- zone_regulations (pro Projekt + Zone, eindeutig)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zone_regulations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    zone_type       text NOT NULL,
    az              numeric(8,3),    -- Ausnutzungsziffer
    bmz             numeric(8,3),    -- Baumassenziffer
    uez             numeric(8,3),    -- Überbauungsziffer
    ffz             numeric(8,3),    -- Freiflächenziffer
    vollgeschosse   smallint,
    anrech_ug       smallint,
    anrech_ug_pct   smallint,
    dg              smallint,        -- Dachgeschosse
    dg_pct          smallint,
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(project_id, zone_type)
);

ALTER TABLE zone_regulations ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_zone_regulations_project_id ON zone_regulations(project_id);

DROP TRIGGER IF EXISTS trg_zone_regulations_updated_at ON zone_regulations;
CREATE TRIGGER trg_zone_regulations_updated_at
    BEFORE UPDATE ON zone_regulations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE POLICY "zone_regulations_select_active"
    ON zone_regulations FOR SELECT TO authenticated
    USING (is_active_user());

CREATE POLICY "zone_regulations_insert_write"
    ON zone_regulations FOR INSERT TO authenticated
    WITH CHECK (can_write());

CREATE POLICY "zone_regulations_update_write"
    ON zone_regulations FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

CREATE POLICY "zone_regulations_delete_write"
    ON zone_regulations FOR DELETE TO authenticated
    USING (can_write());

-- -----------------------------------------------------------------------------
-- projects: VMF-Inputs für Ausnutzungsberechnung
-- -----------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS vmf_ausnuetzungsuebertragung_m2 numeric(12,2);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS vmf_az_anrechenbar_pct          numeric(5,2);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS vmf_bm_geschosshoehe_m          numeric(5,2);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS vmf_bm_gelaendekorrektur_pct    numeric(5,2);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS vmf_bm_vmf_gf_pct               numeric(5,2);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS vmf_uz_vmf_gf_pct               numeric(5,2);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS vmf_ff_vmf_gf_pct               numeric(5,2);
