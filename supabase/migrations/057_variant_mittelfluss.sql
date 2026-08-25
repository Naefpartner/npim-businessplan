-- =============================================================================
-- NPIM-Businessplan: Mittelflussrechnung (Liquiditätsplanung) je Variante
-- Migration: 057_variant_mittelfluss.sql
--
-- Speichert den gesamten bearbeitbaren Zustand der Mittelflussrechnung als ein
-- JSONB-Dokument pro Variante (variabler Aufbau: Terminplan-Phasen, %-Verteilung
-- der Kostenpositionen je Quartal und Ansicht/Etappe, Zeitfenster). Analog zum
-- Honorarrechner-Doc — Strukturänderungen brauchen kein Schema-Update.
-- =============================================================================

CREATE TABLE IF NOT EXISTS variant_mittelfluss (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id uuid NOT NULL REFERENCES project_variants(id) ON DELETE CASCADE,
    doc        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(variant_id)
);

CREATE INDEX IF NOT EXISTS idx_variant_mittelfluss_variant ON variant_mittelfluss(variant_id);

DROP TRIGGER IF EXISTS trg_variant_mittelfluss_updated_at ON variant_mittelfluss;
CREATE TRIGGER trg_variant_mittelfluss_updated_at
    BEFORE UPDATE ON variant_mittelfluss
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE variant_mittelfluss ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vmf_select ON variant_mittelfluss;
CREATE POLICY vmf_select ON variant_mittelfluss FOR SELECT TO authenticated
    USING (is_active_user());

DROP POLICY IF EXISTS vmf_insert ON variant_mittelfluss;
CREATE POLICY vmf_insert ON variant_mittelfluss FOR INSERT TO authenticated
    WITH CHECK (can_write());

DROP POLICY IF EXISTS vmf_update ON variant_mittelfluss;
CREATE POLICY vmf_update ON variant_mittelfluss FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

DROP POLICY IF EXISTS vmf_delete ON variant_mittelfluss;
CREATE POLICY vmf_delete ON variant_mittelfluss FOR DELETE TO authenticated
    USING (can_write());
