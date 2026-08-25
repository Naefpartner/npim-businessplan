-- =============================================================================
-- NPIM-Businessplan: Projekt-Fotos
-- Migration: 020_project_photos.sql
--
-- Pro Projekt können beliebig viele Fotos hochgeladen werden. Eines der Fotos
-- kann als Thumbnail markiert werden (für Kachel-Ansicht in der Projektliste).
-- =============================================================================

CREATE TABLE IF NOT EXISTS project_photos (
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

ALTER TABLE project_photos ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_project_photos_project ON project_photos(project_id);

-- Thumbnail-Verknüpfung am Projekt (FK auf project_photos)
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS thumbnail_photo_id uuid
    REFERENCES project_photos(id) ON DELETE SET NULL;

CREATE POLICY "project_photos_select_active"
    ON project_photos FOR SELECT TO authenticated
    USING (is_active_user());

CREATE POLICY "project_photos_insert_write"
    ON project_photos FOR INSERT TO authenticated
    WITH CHECK (can_write());

CREATE POLICY "project_photos_update_write"
    ON project_photos FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

CREATE POLICY "project_photos_delete_write"
    ON project_photos FOR DELETE TO authenticated
    USING (can_write());

-- Storage-Bucket für die hochgeladenen Foto-Dateien
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-photos', 'project-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage-Policies (analog zu den DB-Policies)
DROP POLICY IF EXISTS "project_photos_storage_select" ON storage.objects;
CREATE POLICY "project_photos_storage_select"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'project-photos' AND is_active_user());

DROP POLICY IF EXISTS "project_photos_storage_insert" ON storage.objects;
CREATE POLICY "project_photos_storage_insert"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'project-photos' AND can_write());

DROP POLICY IF EXISTS "project_photos_storage_delete" ON storage.objects;
CREATE POLICY "project_photos_storage_delete"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'project-photos' AND can_write());
