-- =============================================================================
-- NPIM-Businessplan: Bundesamt für Wohnungswesen (BWO) — Parameter pro Variante
-- Migration: 048_bwo.sql
--
-- Eine Parameter-Zeile pro Variante für die BWO-Anlagekostenlimite (Genossenschaft).
-- Einheiten/Anzahl kommen aus dem Mengengerüst; hier nur die editierbaren Limiten:
--   * Kostenlimite je Zimmer-Kategorie — CHF/Einheit (jsonb)
--   * Kostenlimite je Nebenfläche/Parkplatz — CHF/Einheit (jsonb, nur Overrides)
--   * Zuschlag Energie (%), Zusatzaufwand Baugrund (CHF)
-- =============================================================================

CREATE TABLE IF NOT EXISTS variant_bwo (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id           uuid NOT NULL REFERENCES project_variants(id) ON DELETE CASCADE,
    energie_zuschlag_pct numeric(6,5)  NOT NULL DEFAULT 0,
    baugrund_zusatz      numeric(14,2) NOT NULL DEFAULT 0,
    wohn_limits          jsonb NOT NULL DEFAULT '{}'::jsonb,
    nutzung_limits       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE(variant_id)
);

ALTER TABLE variant_bwo ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_variant_bwo_variant
    ON variant_bwo(variant_id);

DROP TRIGGER IF EXISTS trg_variant_bwo_updated_at ON variant_bwo;
CREATE TRIGGER trg_variant_bwo_updated_at
    BEFORE UPDATE ON variant_bwo
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP POLICY IF EXISTS "vbwo_select_active" ON variant_bwo;
CREATE POLICY "vbwo_select_active"
    ON variant_bwo FOR SELECT TO authenticated
    USING (is_active_user());

DROP POLICY IF EXISTS "vbwo_insert_write" ON variant_bwo;
CREATE POLICY "vbwo_insert_write"
    ON variant_bwo FOR INSERT TO authenticated
    WITH CHECK (can_write());

DROP POLICY IF EXISTS "vbwo_update_write" ON variant_bwo;
CREATE POLICY "vbwo_update_write"
    ON variant_bwo FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

DROP POLICY IF EXISTS "vbwo_delete_write" ON variant_bwo;
CREATE POLICY "vbwo_delete_write"
    ON variant_bwo FOR DELETE TO authenticated
    USING (can_write());
