-- =============================================================================
-- NPIM-Businessplan: Honorarrechner (Planerhonorare SIA) — Persistenz pro Projekt
-- Migration: 052_project_honorar.sql
--
-- Der gesamte bearbeitbare Zustand des Honorarrechners wird als ein JSONB-Dokument
-- pro Projekt gehalten (Planerliste inkl. SIA-Parameter/Faktoren, BKP-Eingaben je
-- Variante, %-Verteilungen, Kostenquelle/Methode, GP-/Nebenkosten-/MWST-Sätze).
--
-- Eine Zeile pro Projekt (UNIQUE project_id). Projektübergreifende Abfrage der
-- Planer-Definitionen (für die Übernahme aus anderen Projekten/Varianten) erfolgt
-- via RLS über alle zugänglichen Projekte.
-- =============================================================================

CREATE TABLE IF NOT EXISTS project_honorar (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    doc         jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE(project_id)
);

ALTER TABLE project_honorar ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_project_honorar_project
    ON project_honorar(project_id);

DROP TRIGGER IF EXISTS trg_project_honorar_updated_at ON project_honorar;
CREATE TRIGGER trg_project_honorar_updated_at
    BEFORE UPDATE ON project_honorar
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP POLICY IF EXISTS "phonorar_select_active" ON project_honorar;
CREATE POLICY "phonorar_select_active"
    ON project_honorar FOR SELECT TO authenticated
    USING (is_active_user());

DROP POLICY IF EXISTS "phonorar_insert_write" ON project_honorar;
CREATE POLICY "phonorar_insert_write"
    ON project_honorar FOR INSERT TO authenticated
    WITH CHECK (can_write());

DROP POLICY IF EXISTS "phonorar_update_write" ON project_honorar;
CREATE POLICY "phonorar_update_write"
    ON project_honorar FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

DROP POLICY IF EXISTS "phonorar_delete_write" ON project_honorar;
CREATE POLICY "phonorar_delete_write"
    ON project_honorar FOR DELETE TO authenticated
    USING (can_write());
