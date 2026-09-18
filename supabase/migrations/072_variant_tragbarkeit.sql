-- =============================================================================
-- NPIM-Businessplan: Tragbarkeit je Variante
-- Migration: 072_variant_tragbarkeit.sql
--
-- Die Annahmen der Tragbarkeitsrechnung (Zinssätze, Belehnungsgrenzen,
-- Mietzinsniveau, Bewirtschaftungsquote, Amortisationsdauer, Eigenmittel) als
-- ein JSONB-Dokument pro Variante — wie Mittelfluss (057) und Kapital und
-- Steuern (069). Die Mengen und Kosten selbst stehen nicht darin; sie kommen
-- live aus der Variante.
--
-- Die Policies folgen der Projektzuordnung aus Migration 071.
-- =============================================================================

CREATE TABLE IF NOT EXISTS variant_tragbarkeit (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id uuid NOT NULL REFERENCES project_variants(id) ON DELETE CASCADE,
    doc        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(variant_id)
);

CREATE INDEX IF NOT EXISTS idx_variant_tragbarkeit_variant
    ON variant_tragbarkeit(variant_id);

DROP TRIGGER IF EXISTS trg_variant_tragbarkeit_updated_at ON variant_tragbarkeit;
CREATE TRIGGER trg_variant_tragbarkeit_updated_at
    BEFORE UPDATE ON variant_tragbarkeit
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE variant_tragbarkeit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS variant_tragbarkeit_select_zugeordnet ON variant_tragbarkeit;
CREATE POLICY variant_tragbarkeit_select_zugeordnet
    ON variant_tragbarkeit FOR SELECT TO authenticated
    USING (is_active_user() AND has_variant_access(variant_id));

DROP POLICY IF EXISTS variant_tragbarkeit_insert_write ON variant_tragbarkeit;
CREATE POLICY variant_tragbarkeit_insert_write
    ON variant_tragbarkeit FOR INSERT TO authenticated
    WITH CHECK (can_write() AND has_variant_access(variant_id));

DROP POLICY IF EXISTS variant_tragbarkeit_update_write ON variant_tragbarkeit;
CREATE POLICY variant_tragbarkeit_update_write
    ON variant_tragbarkeit FOR UPDATE TO authenticated
    USING (can_write() AND has_variant_access(variant_id))
    WITH CHECK (can_write() AND has_variant_access(variant_id));

DROP POLICY IF EXISTS variant_tragbarkeit_delete_write ON variant_tragbarkeit;
CREATE POLICY variant_tragbarkeit_delete_write
    ON variant_tragbarkeit FOR DELETE TO authenticated
    USING (can_write() AND has_variant_access(variant_id));
