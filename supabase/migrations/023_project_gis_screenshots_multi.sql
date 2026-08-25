-- =============================================================================
-- NPIM-Businessplan: Mehrere GIS-Screenshots pro Projekt (Karussell)
-- Migration: 023_project_gis_screenshots_multi.sql
--
-- Ersetzt die single-image-Spalte aus 022 durch eine eigene Tabelle, sodass
-- pro Projekt beliebig viele Karten-Screenshots als Galerie verwaltet werden.
-- Storage-Bucket `project-gis` und seine Policies bleiben aus 022 bestehen.
-- =============================================================================

ALTER TABLE projects
    DROP COLUMN IF EXISTS gis_screenshot_path;

CREATE TABLE IF NOT EXISTS project_gis_screenshots (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    storage_path  text NOT NULL,
    file_name     text,
    mime_type     text,
    size_bytes    bigint,
    sort_order    smallint NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE project_gis_screenshots ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_project_gis_screenshots_project
    ON project_gis_screenshots(project_id);

DROP POLICY IF EXISTS "project_gis_screenshots_select_active" ON project_gis_screenshots;
CREATE POLICY "project_gis_screenshots_select_active"
    ON project_gis_screenshots FOR SELECT TO authenticated
    USING (is_active_user());

DROP POLICY IF EXISTS "project_gis_screenshots_insert_write" ON project_gis_screenshots;
CREATE POLICY "project_gis_screenshots_insert_write"
    ON project_gis_screenshots FOR INSERT TO authenticated
    WITH CHECK (can_write());

DROP POLICY IF EXISTS "project_gis_screenshots_update_write" ON project_gis_screenshots;
CREATE POLICY "project_gis_screenshots_update_write"
    ON project_gis_screenshots FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

DROP POLICY IF EXISTS "project_gis_screenshots_delete_write" ON project_gis_screenshots;
CREATE POLICY "project_gis_screenshots_delete_write"
    ON project_gis_screenshots FOR DELETE TO authenticated
    USING (can_write());
