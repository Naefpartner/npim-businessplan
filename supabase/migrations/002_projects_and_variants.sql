-- =============================================================================
-- NPIM-Businessplan: Projekte und Varianten (Phase 1)
-- Migration: 002_projects_and_variants.sql
--
-- Konzept:
--   - "Projekt" = ein konkretes Bauvorhaben (z.B. "Areal Birch")
--   - "Variante" = ein Stand / eine Studie innerhalb eines Projekts
--                  (z.B. "V1 LOI", "V2 nach Wettbewerb", "V3 Optimierung")
--
-- Varianten halten die gesamten Eingabedaten des Businessplans. Sie sind
-- gleichberechtigt – keine Variante ist privilegiert. Jede Variante
-- referenziert optional eine Vorgängervariante (snapshot_of), damit man
-- "Stand abspeichern" als Kopie einer anderen Variante umsetzen kann.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ENUMS
-- -----------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE project_phase AS ENUM (
        'loi',
        'gestaltungsplan',
        'vorprojekt',
        'bauprojekt',
        'bewilligungsverfahren',
        'ausschreibung',
        'realisierung'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE project_use_type AS ENUM (
        'renditeobjekt',
        'verkaufsobjekt',
        'genossenschaft',
        'gemischt'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE variant_status AS ENUM (
        'entwurf',
        'aktiv',
        'archiviert'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- projects
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    project_number  text,
    address         text,
    description     text,
    start_year      smallint CHECK (start_year IS NULL OR (start_year > 1900 AND start_year < 2100)),
    archived        boolean NOT NULL DEFAULT false,
    created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects(archived);
CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by);

DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- project_variants
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_variants (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    variant_number      int  NOT NULL,
    name                text NOT NULL,
    phase               project_phase    NOT NULL DEFAULT 'loi',
    use_type            project_use_type NOT NULL DEFAULT 'renditeobjekt',
    status              variant_status   NOT NULL DEFAULT 'entwurf',
    notes               text,

    -- "Stand abspeichern": neue Variante kann Snapshot einer existierenden sein
    snapshot_of         uuid REFERENCES project_variants(id) ON DELETE SET NULL,
    snapshot_taken_at   timestamptz,

    created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    UNIQUE (project_id, variant_number)
);

ALTER TABLE project_variants ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_project_variants_project_id ON project_variants(project_id);
CREATE INDEX IF NOT EXISTS idx_project_variants_status     ON project_variants(status);
CREATE INDEX IF NOT EXISTS idx_project_variants_snapshot   ON project_variants(snapshot_of);

DROP TRIGGER IF EXISTS trg_project_variants_updated_at ON project_variants;
CREATE TRIGGER trg_project_variants_updated_at
    BEFORE UPDATE ON project_variants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Auto-Inkrement für variant_number pro Projekt (1, 2, 3, ...)
-- Beim INSERT ohne explizite Nummer wird die nächste freie Nummer gesetzt.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assign_variant_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.variant_number IS NULL OR NEW.variant_number = 0 THEN
        SELECT COALESCE(MAX(variant_number), 0) + 1
            INTO NEW.variant_number
            FROM project_variants
            WHERE project_id = NEW.project_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_variant_number ON project_variants;
CREATE TRIGGER trg_assign_variant_number
    BEFORE INSERT ON project_variants
    FOR EACH ROW EXECUTE FUNCTION assign_variant_number();

-- -----------------------------------------------------------------------------
-- RLS-Policies: Lesen für aktive User, Schreiben nur Admin/Manager
-- -----------------------------------------------------------------------------

CREATE POLICY "projects_select_active"
    ON projects FOR SELECT TO authenticated
    USING (is_active_user());

CREATE POLICY "projects_insert_write"
    ON projects FOR INSERT TO authenticated
    WITH CHECK (can_write());

CREATE POLICY "projects_update_write"
    ON projects FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

CREATE POLICY "projects_delete_write"
    ON projects FOR DELETE TO authenticated
    USING (can_write());

CREATE POLICY "project_variants_select_active"
    ON project_variants FOR SELECT TO authenticated
    USING (is_active_user());

CREATE POLICY "project_variants_insert_write"
    ON project_variants FOR INSERT TO authenticated
    WITH CHECK (can_write());

CREATE POLICY "project_variants_update_write"
    ON project_variants FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

CREATE POLICY "project_variants_delete_write"
    ON project_variants FOR DELETE TO authenticated
    USING (can_write());
