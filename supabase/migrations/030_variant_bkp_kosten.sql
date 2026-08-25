-- =============================================================================
-- NPIM-Businessplan: Anlagekosten-Positionen pro Variante (BKP-Hauptgruppen 0,1,3-9)
-- Migration: 030_variant_bkp_kosten.sql
--
-- Pro Variante und BKP-Position wird ein Eintrag gespeichert mit:
--   - status (berücksichtigt / nicht berücksichtigt / nicht relevant)
--   - kennwert (CHF, CHF/m², %, Zinssatz — semantisch je nach Position)
--   - bezugsmenge_override (z.B. m³ Abbruch, Monate Laufzeit, CHF Mehrwert)
--   - betrag_override (manuelle Überschreibung des berechneten Betrags)
--
-- Die m³-Mengen für BKP 2 werden weiterhin im Mengengerüst und in
-- variant_building_bkp2_kennwerte gehalten.
-- =============================================================================

CREATE TABLE IF NOT EXISTS variant_bkp_kosten (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id           uuid NOT NULL REFERENCES project_variants(id) ON DELETE CASCADE,
    /* Code aus bkpKatalog.ts, z.B. '010', '690a', '699.1' */
    position_code        text NOT NULL,
    status               text NOT NULL DEFAULT 'beruecksichtigt'
        CHECK (status IN ('beruecksichtigt', 'nicht_beruecksichtigt', 'nicht_relevant')),
    kennwert             numeric(14,4),
    bezugsmenge_override numeric(14,2),
    betrag_override      numeric(14,2),
    notiz                text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE(variant_id, position_code)
);

ALTER TABLE variant_bkp_kosten ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_variant_bkp_kosten_variant
    ON variant_bkp_kosten(variant_id);

DROP TRIGGER IF EXISTS trg_variant_bkp_kosten_updated_at ON variant_bkp_kosten;
CREATE TRIGGER trg_variant_bkp_kosten_updated_at
    BEFORE UPDATE ON variant_bkp_kosten
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP POLICY IF EXISTS "vbk_select_active" ON variant_bkp_kosten;
CREATE POLICY "vbk_select_active"
    ON variant_bkp_kosten FOR SELECT TO authenticated
    USING (is_active_user());

DROP POLICY IF EXISTS "vbk_insert_write" ON variant_bkp_kosten;
CREATE POLICY "vbk_insert_write"
    ON variant_bkp_kosten FOR INSERT TO authenticated
    WITH CHECK (can_write());

DROP POLICY IF EXISTS "vbk_update_write" ON variant_bkp_kosten;
CREATE POLICY "vbk_update_write"
    ON variant_bkp_kosten FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

DROP POLICY IF EXISTS "vbk_delete_write" ON variant_bkp_kosten;
CREATE POLICY "vbk_delete_write"
    ON variant_bkp_kosten FOR DELETE TO authenticated
    USING (can_write());
