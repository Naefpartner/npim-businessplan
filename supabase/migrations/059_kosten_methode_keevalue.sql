-- =============================================================================
-- NPIM-Businessplan: Erfassungsmethode der Anlagekosten je Variante
-- Migration: 059_kosten_methode_keevalue.sql
--
-- Die Kostenermittlung kennt neu drei Erfassungsmethoden, die pro Variante als
-- Kachel gewählt werden:
--   'detail'    — bestehender BKP-Katalog mit Positionsraster (Default, Bestand)
--   'keevalue'  — Erstellungskosten aus dem Onlinetool keevalue.ch, per Excel
--                 importiert (BKP 1–5); Berechnungsart siehe lib/keevalue.ts
--   'benchmark' — Grobschätzung über Benchmarks BKP 0–9 (Berechnungsart offen)
--
-- Bestandsvarianten bleiben auf 'detail', damit sich nichts sichtbar ändert.
-- =============================================================================

-- ─── Methodenwahl an der Variante ────────────────────────────────────────────
ALTER TABLE project_variants
    ADD COLUMN IF NOT EXISTS kosten_methode text NOT NULL DEFAULT 'detail';

ALTER TABLE project_variants DROP CONSTRAINT IF EXISTS project_variants_kosten_methode_check;
ALTER TABLE project_variants ADD CONSTRAINT project_variants_kosten_methode_check
    CHECK (kosten_methode IN ('detail', 'keevalue', 'benchmark'));

-- ─── keeValue-Import je Variante ─────────────────────────────────────────────
-- Ein Import pro Variante; ein neuer Upload ersetzt den vorherigen.
-- `doc` hält das geparste Ergebnis-Blatt (Zeilen BKP 1/2/4/5/6 inkl. der
-- Unterpositionen 20–29, exkl./inkl. MwSt., Kennwerte) sowie die Eingabe- und
-- Terminkennwerte als ein JSONB-Dokument — Aufbau siehe lib/keevalue.ts.
-- Als JSONB, weil keeValue sein Blatt zwischen Versionen erweitern kann und wir
-- die Rohwerte verlustfrei behalten wollen (analog variant_mittelfluss).
CREATE TABLE IF NOT EXISTS variant_keevalue_import (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id  uuid NOT NULL REFERENCES project_variants(id) ON DELETE CASCADE,
    /** Dateiname des hochgeladenen Excels — zur Nachvollziehbarkeit in der UI. */
    file_name   text,
    /** Preisstand aus dem Eingaben-Blatt, z.B. 'April 2026'. */
    preisstand  text,
    /** Version Baukosten aus dem Eingaben-Blatt, z.B. '1.0.11'. */
    version     text,
    doc         jsonb NOT NULL DEFAULT '{}'::jsonb,
    imported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE(variant_id)
);

CREATE INDEX IF NOT EXISTS idx_variant_keevalue_import_variant
    ON variant_keevalue_import(variant_id);

DROP TRIGGER IF EXISTS trg_variant_keevalue_import_updated_at ON variant_keevalue_import;
CREATE TRIGGER trg_variant_keevalue_import_updated_at
    BEFORE UPDATE ON variant_keevalue_import
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE variant_keevalue_import ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vki_select ON variant_keevalue_import;
CREATE POLICY vki_select ON variant_keevalue_import FOR SELECT TO authenticated
    USING (is_active_user());

DROP POLICY IF EXISTS vki_insert ON variant_keevalue_import;
CREATE POLICY vki_insert ON variant_keevalue_import FOR INSERT TO authenticated
    WITH CHECK (can_write());

DROP POLICY IF EXISTS vki_update ON variant_keevalue_import;
CREATE POLICY vki_update ON variant_keevalue_import FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

DROP POLICY IF EXISTS vki_delete ON variant_keevalue_import;
CREATE POLICY vki_delete ON variant_keevalue_import FOR DELETE TO authenticated
    USING (can_write());
