-- =============================================================================
-- NPIM-Businessplan: Etappen-Dimension + BKP-2-Erfassung auf Variantenebene
-- Migration: 033_etappen_und_bkp2_variante.sql
--
-- BKP 2 („Anlagekosten Gebäude") wird neu im Kostentab erfasst — pro Variante
-- aggregiert, gruppiert nach Etappe × Eigentumsart (Miete / Stockwerkeigentum)
-- × Zeile (Nutzung oberirdisch | unterirdisch | tiefgarage).
--
-- Neu:
--   * variant_etappen          — Bauetappen pro Variante
--   * variant_buildings.etappe_id — Gebäude gehört zu genau einer Etappe
--   * variant_bkp2_kennwerte    — Kennwerte (CHF/m³ bzw. Pauschal) je Gruppe
--
-- Ersetzt das bisherige per-Gebäude-Modell variant_building_bkp2_kennwerte.
-- =============================================================================

-- ─── 1. Etappen ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS variant_etappen (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id  uuid NOT NULL REFERENCES project_variants(id) ON DELETE CASCADE,
    name        text NOT NULL DEFAULT 'Etappe 1',
    sort_order  smallint NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE variant_etappen ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_variant_etappen_variant
    ON variant_etappen(variant_id);

DROP TRIGGER IF EXISTS trg_variant_etappen_updated_at ON variant_etappen;
CREATE TRIGGER trg_variant_etappen_updated_at
    BEFORE UPDATE ON variant_etappen
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP POLICY IF EXISTS "ve_select_active" ON variant_etappen;
CREATE POLICY "ve_select_active"
    ON variant_etappen FOR SELECT TO authenticated
    USING (is_active_user());

DROP POLICY IF EXISTS "ve_insert_write" ON variant_etappen;
CREATE POLICY "ve_insert_write"
    ON variant_etappen FOR INSERT TO authenticated
    WITH CHECK (can_write());

DROP POLICY IF EXISTS "ve_update_write" ON variant_etappen;
CREATE POLICY "ve_update_write"
    ON variant_etappen FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

DROP POLICY IF EXISTS "ve_delete_write" ON variant_etappen;
CREATE POLICY "ve_delete_write"
    ON variant_etappen FOR DELETE TO authenticated
    USING (can_write());

-- ─── 2. Gebäude → Etappe ─────────────────────────────────────────────────────
ALTER TABLE variant_buildings
    ADD COLUMN IF NOT EXISTS etappe_id uuid
        REFERENCES variant_etappen(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_variant_buildings_etappe
    ON variant_buildings(etappe_id);

-- ─── 3. BKP-2-Kennwerte auf Variantenebene ───────────────────────────────────
CREATE TABLE IF NOT EXISTS variant_bkp2_kennwerte (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id   uuid NOT NULL REFERENCES project_variants(id) ON DELETE CASCADE,
    etappe_id    uuid NOT NULL REFERENCES variant_etappen(id) ON DELETE CASCADE,
    eigentumsart text NOT NULL CHECK (eigentumsart IN ('miete', 'stockwerkeigentum')),
    /* Nutzung (kleingeschrieben) für oberirdische Zeilen, oder
       'unterirdisch' / 'tiefgarage' / 'etappierung' */
    row_key      text NOT NULL,
    chf_pro_m3   numeric(14,4),
    pauschal_chf numeric(14,2),
    notiz        text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE(variant_id, etappe_id, eigentumsart, row_key)
);

ALTER TABLE variant_bkp2_kennwerte ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_variant_bkp2_kennwerte_variant
    ON variant_bkp2_kennwerte(variant_id);

DROP TRIGGER IF EXISTS trg_variant_bkp2_kennwerte_updated_at ON variant_bkp2_kennwerte;
CREATE TRIGGER trg_variant_bkp2_kennwerte_updated_at
    BEFORE UPDATE ON variant_bkp2_kennwerte
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP POLICY IF EXISTS "vbk2_select_active" ON variant_bkp2_kennwerte;
CREATE POLICY "vbk2_select_active"
    ON variant_bkp2_kennwerte FOR SELECT TO authenticated
    USING (is_active_user());

DROP POLICY IF EXISTS "vbk2_insert_write" ON variant_bkp2_kennwerte;
CREATE POLICY "vbk2_insert_write"
    ON variant_bkp2_kennwerte FOR INSERT TO authenticated
    WITH CHECK (can_write());

DROP POLICY IF EXISTS "vbk2_update_write" ON variant_bkp2_kennwerte;
CREATE POLICY "vbk2_update_write"
    ON variant_bkp2_kennwerte FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

DROP POLICY IF EXISTS "vbk2_delete_write" ON variant_bkp2_kennwerte;
CREATE POLICY "vbk2_delete_write"
    ON variant_bkp2_kennwerte FOR DELETE TO authenticated
    USING (can_write());

-- ─── 4. Backfill: Default-Etappe pro Variante + Gebäude zuordnen ──────────────
-- Für jede Variante, die noch keine Etappe hat, eine „Etappe 1" anlegen.
INSERT INTO variant_etappen (variant_id, name, sort_order)
SELECT v.id, 'Etappe 1', 0
FROM project_variants v
WHERE NOT EXISTS (
    SELECT 1 FROM variant_etappen e WHERE e.variant_id = v.id
);

-- Alle noch nicht zugeordneten Gebäude der ersten Etappe ihrer Variante zuweisen.
UPDATE variant_buildings b
SET etappe_id = (
    SELECT e.id FROM variant_etappen e
    WHERE e.variant_id = b.variant_id
    ORDER BY e.sort_order, e.created_at
    LIMIT 1
)
WHERE b.etappe_id IS NULL;

-- ─── 5. „Gemischt" abschaffen → Miete (Renditeobjekt) ────────────────────────
UPDATE variant_buildings
SET use_type = 'renditeobjekt'
WHERE use_type = 'gemischt';

-- ─── 6. Altes per-Gebäude-Modell entfernen ───────────────────────────────────
DROP TABLE IF EXISTS variant_building_bkp2_kennwerte;
