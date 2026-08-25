-- =============================================================================
-- NPIM-Businessplan: Generische Berechnungsmethode pro Zeile + eigene Zeilen
-- Migration: 037_bkp_methode_generisch.sql
--
-- Pro Position kann die Berechnungsmethode frei gewählt werden (überschreibt
-- den Katalog-Default):
--   calc_method: NULL/'standard' | 'pauschal' | 'einheit' | 'prozent_von' | 'promille_von'
--   calc_base:   bei prozent/promille_von — Refs auf Positionen/Hauptgruppen:
--                [{ "kind":"position","ref":"010" }, { "kind":"hauptgruppe","ref":"2" }]
-- Beide werden auf der Konsolidiert-Row (etappe_id NULL) geführt (variantenweit).
--
-- Zusätzlich: eigene Zeilen pro Block (Hauptgruppe × Eigentumsart).
-- =============================================================================

ALTER TABLE variant_bkp_kosten
    ADD COLUMN IF NOT EXISTS calc_method text
        CHECK (calc_method IS NULL OR calc_method IN
            ('standard', 'pauschal', 'einheit', 'prozent_von', 'promille_von')),
    ADD COLUMN IF NOT EXISTS calc_base jsonb;

-- ─── Eigene Zeilen ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS variant_bkp_custom_position (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id   uuid NOT NULL REFERENCES project_variants(id) ON DELETE CASCADE,
    eigentumsart text NOT NULL CHECK (eigentumsart IN ('miete', 'stockwerkeigentum')),
    hauptgruppe  smallint NOT NULL,
    label        text NOT NULL DEFAULT 'Neue Position',
    mwst         boolean NOT NULL DEFAULT true,
    sort_order   smallint NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE variant_bkp_custom_position ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_variant_bkp_custom_position_variant
    ON variant_bkp_custom_position(variant_id);

DROP TRIGGER IF EXISTS trg_variant_bkp_custom_position_updated_at ON variant_bkp_custom_position;
CREATE TRIGGER trg_variant_bkp_custom_position_updated_at
    BEFORE UPDATE ON variant_bkp_custom_position
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP POLICY IF EXISTS "vbcp_select_active" ON variant_bkp_custom_position;
CREATE POLICY "vbcp_select_active"
    ON variant_bkp_custom_position FOR SELECT TO authenticated
    USING (is_active_user());

DROP POLICY IF EXISTS "vbcp_insert_write" ON variant_bkp_custom_position;
CREATE POLICY "vbcp_insert_write"
    ON variant_bkp_custom_position FOR INSERT TO authenticated
    WITH CHECK (can_write());

DROP POLICY IF EXISTS "vbcp_update_write" ON variant_bkp_custom_position;
CREATE POLICY "vbcp_update_write"
    ON variant_bkp_custom_position FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

DROP POLICY IF EXISTS "vbcp_delete_write" ON variant_bkp_custom_position;
CREATE POLICY "vbcp_delete_write"
    ON variant_bkp_custom_position FOR DELETE TO authenticated
    USING (can_write());
