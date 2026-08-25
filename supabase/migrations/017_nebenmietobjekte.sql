-- =============================================================================
-- NPIM-Businessplan: Nebenmietobjekte (dynamische Liste pro Gruppe)
-- Migration: 017_nebenmietobjekte.sql
--
-- Ersetzt das frühere variant_group_quantities-Modell mit fixen Spalten
-- (garagen_pp, aussen_pp, …) durch eine flexible Zeilenliste, in der pro
-- Variante × Nutzungsart-Gruppe beliebig viele Mietobjekte (Garagen,
-- Reklameflächen, Antennen …) erfasst werden können.
-- =============================================================================

CREATE TABLE IF NOT EXISTS variant_nebenmietobjekte (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id        uuid NOT NULL REFERENCES project_variants(id) ON DELETE CASCADE,
    use_type          project_use_type NOT NULL,
    sort_order        smallint NOT NULL DEFAULT 0,
    bezeichnung       text NOT NULL,
    anzahl            integer,
    miete_chf_stk_mt  numeric(10,2),
    miete_chf_pa      numeric(12,2),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE variant_nebenmietobjekte ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_vnm_variant_use
    ON variant_nebenmietobjekte(variant_id, use_type);

DROP TRIGGER IF EXISTS trg_vnm_updated_at ON variant_nebenmietobjekte;
CREATE TRIGGER trg_vnm_updated_at
    BEFORE UPDATE ON variant_nebenmietobjekte
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE POLICY "vnm_select_active"
    ON variant_nebenmietobjekte FOR SELECT TO authenticated
    USING (is_active_user());

CREATE POLICY "vnm_insert_write"
    ON variant_nebenmietobjekte FOR INSERT TO authenticated
    WITH CHECK (can_write());

CREATE POLICY "vnm_update_write"
    ON variant_nebenmietobjekte FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

CREATE POLICY "vnm_delete_write"
    ON variant_nebenmietobjekte FOR DELETE TO authenticated
    USING (can_write());

-- Altes Schema entfernen
DROP TABLE IF EXISTS variant_group_quantities CASCADE;
