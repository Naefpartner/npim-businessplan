-- =============================================================================
-- NPIM-Businessplan: Detaillierte Mieteinheiten als Kindzeilen einer Mietfläche
-- Migration: 018_mieteinheiten.sql
--
-- Pro Mietfläche (Geschoss × Nutzung) können beliebig viele Mieteinheiten
-- (z.B. einzelne Wohnungen) erfasst werden. Sobald Einheiten existieren,
-- werden die Werte der übergeordneten Mietfläche aus diesen aggregiert.
-- =============================================================================

CREATE TABLE IF NOT EXISTS building_mieteinheiten (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mietflaeche_id    uuid NOT NULL REFERENCES building_mietflaechen(id) ON DELETE CASCADE,
    sort_order        smallint NOT NULL DEFAULT 0,
    bezeichnung       text,
    zimmer            numeric(3,1),
    anzahl            integer NOT NULL DEFAULT 1,
    gf_m2             numeric(12,2),
    geschosshoehe_m   numeric(5,2),
    volumen_m3        numeric(12,2),
    faktor_vmf_gf     numeric(5,3),
    flaeche_m2        numeric(12,2) NOT NULL DEFAULT 0,
    miete_chf_m2_pa   numeric(10,2),
    miete_chf_stk_mt  numeric(10,2),
    miete_chf_pa      numeric(12,2),
    locked_fields     text[] NOT NULL DEFAULT '{}'::text[],
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE building_mieteinheiten ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_building_mieteinheiten_mietflaeche
    ON building_mieteinheiten(mietflaeche_id);

DROP TRIGGER IF EXISTS trg_building_mieteinheiten_updated_at ON building_mieteinheiten;
CREATE TRIGGER trg_building_mieteinheiten_updated_at
    BEFORE UPDATE ON building_mieteinheiten
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE POLICY "building_mieteinheiten_select_active"
    ON building_mieteinheiten FOR SELECT TO authenticated
    USING (is_active_user());

CREATE POLICY "building_mieteinheiten_insert_write"
    ON building_mieteinheiten FOR INSERT TO authenticated
    WITH CHECK (can_write());

CREATE POLICY "building_mieteinheiten_update_write"
    ON building_mieteinheiten FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

CREATE POLICY "building_mieteinheiten_delete_write"
    ON building_mieteinheiten FOR DELETE TO authenticated
    USING (can_write());
