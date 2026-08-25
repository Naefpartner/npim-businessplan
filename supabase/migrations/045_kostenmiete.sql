-- =============================================================================
-- NPIM-Businessplan: Kostenmiete-Parameter (Zürcher Kostenmietmodell)
-- Migration: 045_kostenmiete.sql
--
-- Eine Parameter-Zeile pro Variante für die Genossenschafts-Kostenmiete.
-- Maximale Mieterträge = Verzinsung Erstellungskosten + Verzinsung Grundstück
--   (oder Baurechtszins, zwei Zeilen subv./nicht subv.) + Betriebskosten
--   (Erstellungskosten × GVW-Faktor × Betriebskostensatz).
-- =============================================================================

CREATE TABLE IF NOT EXISTS variant_kostenmiete (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id                uuid NOT NULL REFERENCES project_variants(id) ON DELETE CASCADE,
    referenzzinssatz          numeric(6,5)  NOT NULL DEFAULT 0.015,
    im_baurecht               boolean       NOT NULL DEFAULT false,
    gvw_faktor                numeric(6,5)  NOT NULL DEFAULT 0.90,
    betriebskosten_satz       numeric(6,5)  NOT NULL DEFAULT 0.0325,
    -- Baurecht: subventionierte Wohnungen
    baurecht_subv_anteil      numeric(6,5)  NOT NULL DEFAULT 0,
    baurecht_subv_modus       text          NOT NULL DEFAULT 'pct'
        CHECK (baurecht_subv_modus IN ('pct', 'chf')),
    baurecht_subv_betrag_chf  numeric(14,2) NOT NULL DEFAULT 0,
    -- Baurecht: nicht subventionierte Wohnungen
    baurecht_nsubv_anteil     numeric(6,5)  NOT NULL DEFAULT 0,
    baurecht_nsubv_modus      text          NOT NULL DEFAULT 'pct'
        CHECK (baurecht_nsubv_modus IN ('pct', 'chf')),
    baurecht_nsubv_betrag_chf numeric(14,2) NOT NULL DEFAULT 0,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    UNIQUE(variant_id)
);

ALTER TABLE variant_kostenmiete ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_variant_kostenmiete_variant
    ON variant_kostenmiete(variant_id);

DROP TRIGGER IF EXISTS trg_variant_kostenmiete_updated_at ON variant_kostenmiete;
CREATE TRIGGER trg_variant_kostenmiete_updated_at
    BEFORE UPDATE ON variant_kostenmiete
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP POLICY IF EXISTS "vkm_select_active" ON variant_kostenmiete;
CREATE POLICY "vkm_select_active"
    ON variant_kostenmiete FOR SELECT TO authenticated
    USING (is_active_user());

DROP POLICY IF EXISTS "vkm_insert_write" ON variant_kostenmiete;
CREATE POLICY "vkm_insert_write"
    ON variant_kostenmiete FOR INSERT TO authenticated
    WITH CHECK (can_write());

DROP POLICY IF EXISTS "vkm_update_write" ON variant_kostenmiete;
CREATE POLICY "vkm_update_write"
    ON variant_kostenmiete FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

DROP POLICY IF EXISTS "vkm_delete_write" ON variant_kostenmiete;
CREATE POLICY "vkm_delete_write"
    ON variant_kostenmiete FOR DELETE TO authenticated
    USING (can_write());
