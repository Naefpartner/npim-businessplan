-- =============================================================================
-- NPIM-Businessplan: Anlagekosten pro Etappe × Eigentumsart + GSF-Aufteilung
-- Migration: 034_anlagekosten_etappe_eigentumsart.sql
--
-- Die Anlagekosten (variant_bkp_kosten) waren bisher flach pro Variante. Neu:
--   * pro Etappe (etappe_id NULL = Konsolidiert-Ebene) und
--   * pro Eigentumsart (miete | stockwerkeigentum)
-- jeweils eigene Einträge. Effektiver Wert = Etappen-Override ?? Konsolidiert.
--
-- Zusätzlich variant_etappe_gsf_alloc: prozentuale oder mengenmässige
-- Aufteilung der projektweiten Grundstücksfläche je Etappe × Eigentumsart.
-- =============================================================================

-- ─── 1. variant_bkp_kosten: Etappe × Eigentumsart ────────────────────────────
ALTER TABLE variant_bkp_kosten
    ADD COLUMN IF NOT EXISTS etappe_id uuid
        REFERENCES variant_etappen(id) ON DELETE CASCADE;

ALTER TABLE variant_bkp_kosten
    ADD COLUMN IF NOT EXISTS eigentumsart text NOT NULL DEFAULT 'miete'
        CHECK (eigentumsart IN ('miete', 'stockwerkeigentum'));

-- Generierte Sentinel-Spalte: NULL etappe_id (= Konsolidiert) wird auf eine
-- feste UUID gemappt. Nötig, weil Postgres NULL im Unique-Index als distinkt
-- behandelt — sonst greift weder die Unique-Constraint noch onConflict für die
-- Konsolidiert-Rows. etappe_id bleibt ein sauberer nullable FK.
ALTER TABLE variant_bkp_kosten
    ADD COLUMN IF NOT EXISTS etappe_key uuid NOT NULL
        GENERATED ALWAYS AS (COALESCE(etappe_id, '00000000-0000-0000-0000-000000000000')) STORED;

-- Alten Unique-Key (variant_id, position_code) durch den neuen ersetzen.
ALTER TABLE variant_bkp_kosten
    DROP CONSTRAINT IF EXISTS variant_bkp_kosten_variant_id_position_code_key;
ALTER TABLE variant_bkp_kosten
    DROP CONSTRAINT IF EXISTS variant_bkp_kosten_uq;
ALTER TABLE variant_bkp_kosten
    ADD CONSTRAINT variant_bkp_kosten_uq
    UNIQUE (variant_id, etappe_key, eigentumsart, position_code);

CREATE INDEX IF NOT EXISTS idx_variant_bkp_kosten_etappe
    ON variant_bkp_kosten(etappe_id);

-- ─── 2. GSF-Aufteilung je Etappe × Eigentumsart ──────────────────────────────
CREATE TABLE IF NOT EXISTS variant_etappe_gsf_alloc (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id   uuid NOT NULL REFERENCES project_variants(id) ON DELETE CASCADE,
    etappe_id    uuid NOT NULL REFERENCES variant_etappen(id) ON DELETE CASCADE,
    eigentumsart text NOT NULL CHECK (eigentumsart IN ('miete', 'stockwerkeigentum')),
    /* 'pct' = Anteil 0..1 ; 'm2' = absolute Fläche in m² */
    mode         text NOT NULL DEFAULT 'pct' CHECK (mode IN ('pct', 'm2')),
    value        numeric(14,4),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (variant_id, etappe_id, eigentumsart)
);

ALTER TABLE variant_etappe_gsf_alloc ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_variant_etappe_gsf_alloc_variant
    ON variant_etappe_gsf_alloc(variant_id);

DROP TRIGGER IF EXISTS trg_variant_etappe_gsf_alloc_updated_at ON variant_etappe_gsf_alloc;
CREATE TRIGGER trg_variant_etappe_gsf_alloc_updated_at
    BEFORE UPDATE ON variant_etappe_gsf_alloc
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP POLICY IF EXISTS "vega_select_active" ON variant_etappe_gsf_alloc;
CREATE POLICY "vega_select_active"
    ON variant_etappe_gsf_alloc FOR SELECT TO authenticated
    USING (is_active_user());

DROP POLICY IF EXISTS "vega_insert_write" ON variant_etappe_gsf_alloc;
CREATE POLICY "vega_insert_write"
    ON variant_etappe_gsf_alloc FOR INSERT TO authenticated
    WITH CHECK (can_write());

DROP POLICY IF EXISTS "vega_update_write" ON variant_etappe_gsf_alloc;
CREATE POLICY "vega_update_write"
    ON variant_etappe_gsf_alloc FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

DROP POLICY IF EXISTS "vega_delete_write" ON variant_etappe_gsf_alloc;
CREATE POLICY "vega_delete_write"
    ON variant_etappe_gsf_alloc FOR DELETE TO authenticated
    USING (can_write());
