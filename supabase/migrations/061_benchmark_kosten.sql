-- =============================================================================
-- NPIM-Businessplan: Kennwerte der Benchmark-Kostenberechnung je Variante
-- Migration: 061_benchmark_kosten.sql
--
-- Dritte Erfassungsmethode neben Detailkatalog und keeValue (siehe 059): eine
-- Grobschätzung über einen Kennwert je BKP-Hauptgruppe. Die Kennwerte werden
-- hier je Variante gehalten.
--
-- Als JSONB (analog variant_mittelfluss und variant_keevalue_ergaenzung), weil
-- die Hauptgruppen schrittweise dazukommen und jede eine eigene Bezugsgrösse
-- bekommt. Aufbau siehe BenchmarkDoc in lib/benchmark.ts.
--
-- Stand: BKP 0 Grundstück — CHF/m² Grundstücksfläche, Menge aus den Parzellen.
-- =============================================================================

CREATE TABLE IF NOT EXISTS variant_benchmark_kosten (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id uuid NOT NULL REFERENCES project_variants(id) ON DELETE CASCADE,
    doc        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(variant_id)
);

CREATE INDEX IF NOT EXISTS idx_variant_benchmark_kosten_variant
    ON variant_benchmark_kosten(variant_id);

DROP TRIGGER IF EXISTS trg_variant_benchmark_kosten_updated_at ON variant_benchmark_kosten;
CREATE TRIGGER trg_variant_benchmark_kosten_updated_at
    BEFORE UPDATE ON variant_benchmark_kosten
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE variant_benchmark_kosten ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vbk_select ON variant_benchmark_kosten;
CREATE POLICY vbk_select ON variant_benchmark_kosten FOR SELECT TO authenticated
    USING (is_active_user());

DROP POLICY IF EXISTS vbk_insert ON variant_benchmark_kosten;
CREATE POLICY vbk_insert ON variant_benchmark_kosten FOR INSERT TO authenticated
    WITH CHECK (can_write());

DROP POLICY IF EXISTS vbk_update ON variant_benchmark_kosten;
CREATE POLICY vbk_update ON variant_benchmark_kosten FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

DROP POLICY IF EXISTS vbk_delete ON variant_benchmark_kosten;
CREATE POLICY vbk_delete ON variant_benchmark_kosten FOR DELETE TO authenticated
    USING (can_write());
