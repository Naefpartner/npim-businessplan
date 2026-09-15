-- =============================================================================
-- NPIM-Businessplan: Kapital und Steuern je Variante
-- Migration: 069_variant_kapital_steuern.sql
--
-- Speichert Kapitalstruktur (Investoren mit Einlage, Gewinnanteil und Zins),
-- die beteiligten Gesellschaften (Landprovider, Totalunternehmer) sowie deren
-- Kosten-, Gewinn- und Steuerzeilen als ein JSONB-Dokument pro Variante —
-- analog zur Mittelflussrechnung (057). Der Aufbau wächst noch, deshalb ein
-- Dokument statt Spalten.
-- =============================================================================

CREATE TABLE IF NOT EXISTS variant_kapital_steuern (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id uuid NOT NULL REFERENCES project_variants(id) ON DELETE CASCADE,
    doc        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(variant_id)
);

CREATE INDEX IF NOT EXISTS idx_variant_kapital_steuern_variant
    ON variant_kapital_steuern(variant_id);

DROP TRIGGER IF EXISTS trg_variant_kapital_steuern_updated_at ON variant_kapital_steuern;
CREATE TRIGGER trg_variant_kapital_steuern_updated_at
    BEFORE UPDATE ON variant_kapital_steuern
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE variant_kapital_steuern ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vks_select ON variant_kapital_steuern;
CREATE POLICY vks_select ON variant_kapital_steuern FOR SELECT TO authenticated
    USING (is_active_user());

DROP POLICY IF EXISTS vks_insert ON variant_kapital_steuern;
CREATE POLICY vks_insert ON variant_kapital_steuern FOR INSERT TO authenticated
    WITH CHECK (can_write());

DROP POLICY IF EXISTS vks_update ON variant_kapital_steuern;
CREATE POLICY vks_update ON variant_kapital_steuern FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

DROP POLICY IF EXISTS vks_delete ON variant_kapital_steuern;
CREATE POLICY vks_delete ON variant_kapital_steuern FOR DELETE TO authenticated
    USING (can_write());
