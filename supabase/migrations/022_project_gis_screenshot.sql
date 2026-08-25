-- =============================================================================
-- NPIM-Businessplan: GIS-Screenshot pro Projekt
-- Migration: 022_project_gis_screenshot.sql
--
-- Viele Kantons-GIS-Portale (z.B. maps.zh.ch) setzen X-Frame-Options=SAMEORIGIN
-- und verhindern damit das Einbetten der Karte per iframe. Statt der Karte
-- speichern wir pro Projekt einen manuell hochgeladenen Screenshot, der die
-- gewünschte Kartenansicht festhält.
-- =============================================================================

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS gis_screenshot_path text;

-- Eigener Bucket — saubere Trennung von der Foto-Galerie (project-photos).
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-gis', 'project-gis', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "project_gis_storage_select" ON storage.objects;
CREATE POLICY "project_gis_storage_select"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'project-gis' AND is_active_user());

DROP POLICY IF EXISTS "project_gis_storage_insert" ON storage.objects;
CREATE POLICY "project_gis_storage_insert"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'project-gis' AND can_write());

DROP POLICY IF EXISTS "project_gis_storage_update" ON storage.objects;
CREATE POLICY "project_gis_storage_update"
    ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'project-gis' AND can_write())
    WITH CHECK (bucket_id = 'project-gis' AND can_write());

DROP POLICY IF EXISTS "project_gis_storage_delete" ON storage.objects;
CREATE POLICY "project_gis_storage_delete"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'project-gis' AND can_write());
