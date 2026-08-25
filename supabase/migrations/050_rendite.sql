-- =============================================================================
-- NPIM-Businessplan: Renditeberechnung (Erfolgsrechnung) — Parameter pro Variante
-- Migration: 050_rendite.sql
--
-- Eine Parameter-Zeile pro Variante für die Renditeberechnung (Renditeobjekte).
-- Erträge kommen aus den Mengen; hier nur die editierbaren Sätze/Beträge:
--   * Leerstand, Betriebskosten (Anteil des Mietertrag SOLL)
--   * Instandhaltung / Instandsetzung (CHF/m²·a), Baurechtszins (CHF/a)
-- =============================================================================

CREATE TABLE IF NOT EXISTS variant_rendite (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id            uuid NOT NULL REFERENCES project_variants(id) ON DELETE CASCADE,
    leerstand             numeric(6,5)  NOT NULL DEFAULT 0.02,
    betriebskosten        numeric(6,5)  NOT NULL DEFAULT 0.05,
    instandhaltung_pro_m2 numeric(12,2) NOT NULL DEFAULT 15,
    baurechtszins         numeric(14,2) NOT NULL DEFAULT 0,
    instandsetzung_pro_m2 numeric(12,2) NOT NULL DEFAULT 25,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE(variant_id)
);

ALTER TABLE variant_rendite ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_variant_rendite_variant
    ON variant_rendite(variant_id);

DROP TRIGGER IF EXISTS trg_variant_rendite_updated_at ON variant_rendite;
CREATE TRIGGER trg_variant_rendite_updated_at
    BEFORE UPDATE ON variant_rendite
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP POLICY IF EXISTS "vrendite_select_active" ON variant_rendite;
CREATE POLICY "vrendite_select_active"
    ON variant_rendite FOR SELECT TO authenticated
    USING (is_active_user());

DROP POLICY IF EXISTS "vrendite_insert_write" ON variant_rendite;
CREATE POLICY "vrendite_insert_write"
    ON variant_rendite FOR INSERT TO authenticated
    WITH CHECK (can_write());

DROP POLICY IF EXISTS "vrendite_update_write" ON variant_rendite;
CREATE POLICY "vrendite_update_write"
    ON variant_rendite FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

DROP POLICY IF EXISTS "vrendite_delete_write" ON variant_rendite;
CREATE POLICY "vrendite_delete_write"
    ON variant_rendite FOR DELETE TO authenticated
    USING (can_write());
