-- =============================================================================
-- NPIM-Businessplan: Kantonale Wohnbauförderung ZH (WBF) — Parameter pro Variante
-- Migration: 047_wbf_zh.sql
--
-- Eine Parameter-Zeile pro Variante für die WBF-Berechnung (Genossenschaft).
-- Wohnungsmix + Nicht-Wohn-Nutzungen kommen aus dem Mengengerüst; hier werden
-- nur die editierbaren Ansätze/Punkte gespeichert:
--   * Punkte je Zimmer-Kategorie (jsonb)
--   * Ansätze je Nutzung — CHF/m² bzw. CHF/Stk (jsonb, nur Overrides)
--   * CHF/Pt. Erstellung, Energiezuschlag, CHF/Pt. Investition total
-- =============================================================================

CREATE TABLE IF NOT EXISTS variant_wbf_zh (
    id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id                      uuid NOT NULL REFERENCES project_variants(id) ON DELETE CASCADE,
    chf_pro_punkt_erstellung        numeric(14,2) NOT NULL DEFAULT 48000,
    energiezuschlag_pct             numeric(6,5)  NOT NULL DEFAULT 0.03,
    chf_pro_punkt_investition_total numeric(14,2) NOT NULL DEFAULT 60400,
    punkte                          jsonb NOT NULL DEFAULT '{}'::jsonb,
    nutzung_rates                   jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at                      timestamptz NOT NULL DEFAULT now(),
    updated_at                      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(variant_id)
);

ALTER TABLE variant_wbf_zh ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_variant_wbf_zh_variant
    ON variant_wbf_zh(variant_id);

DROP TRIGGER IF EXISTS trg_variant_wbf_zh_updated_at ON variant_wbf_zh;
CREATE TRIGGER trg_variant_wbf_zh_updated_at
    BEFORE UPDATE ON variant_wbf_zh
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP POLICY IF EXISTS "vwbf_select_active" ON variant_wbf_zh;
CREATE POLICY "vwbf_select_active"
    ON variant_wbf_zh FOR SELECT TO authenticated
    USING (is_active_user());

DROP POLICY IF EXISTS "vwbf_insert_write" ON variant_wbf_zh;
CREATE POLICY "vwbf_insert_write"
    ON variant_wbf_zh FOR INSERT TO authenticated
    WITH CHECK (can_write());

DROP POLICY IF EXISTS "vwbf_update_write" ON variant_wbf_zh;
CREATE POLICY "vwbf_update_write"
    ON variant_wbf_zh FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

DROP POLICY IF EXISTS "vwbf_delete_write" ON variant_wbf_zh;
CREATE POLICY "vwbf_delete_write"
    ON variant_wbf_zh FOR DELETE TO authenticated
    USING (can_write());
