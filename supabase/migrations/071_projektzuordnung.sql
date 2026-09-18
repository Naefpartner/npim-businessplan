-- =============================================================================
-- NPIM-Businessplan: Projekte einzelnen Benutzern zuordnen
-- Migration: 071_projektzuordnung.sql
--
-- Bisher sah jeder aktive Benutzer jedes Projekt. Neu gilt:
--   - Administratoren sehen und bearbeiten weiterhin alles.
--   - Alle anderen (Bearbeiter und Betrachter) sehen nur die Projekte, die
--     ihnen in der Benutzerverwaltung zugeordnet sind — und damit auch nur
--     deren Varianten, Mengen, Kosten und Berichte.
--   - Wer ein Projekt anlegt, wird ihm automatisch zugeordnet; sonst wäre es
--     für den Ersteller im selben Moment unsichtbar.
--
-- Die Prüfung steckt in `has_project_access()` und den beiden Ableitungen
-- darüber. Jede Tabelle, die an einem Projekt hängt, ruft in ihrer Policy die
-- Funktion auf, die zu ihrem Schlüssel passt — direkt über `project_id`, über
-- die Variante, über das Gebäude oder über die Mietfläche.
--
-- Bestehende Projekte bekommen bewusst KEINE Zuordnungen: nach dem Einspielen
-- sieht ausser den Administratoren niemand ein Projekt, bis es zugeordnet ist.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Zuordnungstabelle
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_members (
    project_id  uuid NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);

ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_members_select" ON project_members;
CREATE POLICY "project_members_select"
    ON project_members FOR SELECT TO authenticated
    USING (is_admin() OR user_id = auth.uid());

DROP POLICY IF EXISTS "project_members_admin_all" ON project_members;
CREATE POLICY "project_members_admin_all"
    ON project_members FOR ALL TO authenticated
    USING (is_admin()) WITH CHECK (is_admin());

-- -----------------------------------------------------------------------------
-- Zugriffsprüfungen
--
-- SECURITY DEFINER, damit sie in den Policies fremder Tabellen aufgerufen
-- werden können; STABLE, damit der Planer sie je Abfrage einmal auswertet.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION has_project_access(p uuid)
RETURNS boolean AS $$
    SELECT is_admin() OR EXISTS (
        SELECT 1
        FROM project_members m
        JOIN profiles pr ON pr.id = m.user_id
        WHERE m.project_id = p
          AND m.user_id = auth.uid()
          AND pr.active = true
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION has_variant_access(v uuid)
RETURNS boolean AS $$
    SELECT has_project_access((SELECT project_id FROM project_variants WHERE id = v));
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION has_building_access(b uuid)
RETURNS boolean AS $$
    SELECT has_variant_access((SELECT variant_id FROM variant_buildings WHERE id = b));
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION has_mietflaeche_access(f uuid)
RETURNS boolean AS $$
    SELECT has_building_access((SELECT variant_building_id FROM building_mietflaechen WHERE id = f));
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION has_existing_building_access(e uuid)
RETURNS boolean AS $$
    SELECT has_project_access((SELECT project_id FROM existing_buildings WHERE id = e));
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- -----------------------------------------------------------------------------
-- Wer ein Projekt anlegt, ist ihm zugeordnet
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION add_project_creator_as_member()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO project_members (project_id, user_id, created_by)
    VALUES (NEW.id, COALESCE(NEW.created_by, auth.uid()), auth.uid())
    ON CONFLICT DO NOTHING;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Ein Projekt ohne Ersteller (Import, Skript) soll nicht am Eintrag scheitern.
    RAISE WARNING 'add_project_creator_as_member: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_project_creator_member ON projects;
CREATE TRIGGER trg_project_creator_member
    AFTER INSERT ON projects
    FOR EACH ROW EXECUTE FUNCTION add_project_creator_as_member();

-- -----------------------------------------------------------------------------
-- Policies neu setzen
--
-- Die gewachsenen Policies heissen uneinheitlich (vbk2_…, vgq_…, vmf_select).
-- Sie werden je Tabelle vollständig entfernt und durch vier einheitliche
-- ersetzt: lesen darf, wer aktiv ist und Zugriff auf das Projekt hat; schreiben
-- zusätzlich nur mit Schreibrecht.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    -- Tabelle → Ausdruck, der den Projektzugriff der Zeile prüft
    zuordnung constant text[][] := ARRAY[
        ['projects',                       'has_project_access(id)'],
        ['project_variants',               'has_project_access(project_id)'],
        ['parcels',                        'has_project_access(project_id)'],
        ['existing_buildings',             'has_project_access(project_id)'],
        ['building_rights',                'has_project_access(project_id)'],
        ['zone_regulations',               'has_project_access(project_id)'],
        ['project_photos',                 'has_project_access(project_id)'],
        ['project_gis_screenshots',        'has_project_access(project_id)'],
        ['project_honorar',                'has_project_access(project_id)'],
        ['existing_building_owners',       'has_existing_building_access(existing_building_id)'],
        ['variant_buildings',              'has_variant_access(variant_id)'],
        ['variant_etappen',                'has_variant_access(variant_id)'],
        ['variant_etappe_gsf_alloc',       'has_variant_access(variant_id)'],
        ['variant_group_quantities',       'has_variant_access(variant_id)'],
        ['variant_bkp_kosten',             'has_variant_access(variant_id)'],
        ['variant_bkp_custom_position',    'has_variant_access(variant_id)'],
        ['variant_bkp2_kennwerte',         'has_variant_access(variant_id)'],
        ['variant_benchmark_kosten',       'has_variant_access(variant_id)'],
        ['variant_keevalue_import',        'has_variant_access(variant_id)'],
        ['variant_keevalue_ergaenzung',    'has_variant_access(variant_id)'],
        ['variant_kostenmiete',            'has_variant_access(variant_id)'],
        ['variant_wbf_zh',                 'has_variant_access(variant_id)'],
        ['variant_bwo',                    'has_variant_access(variant_id)'],
        ['variant_rendite',                'has_variant_access(variant_id)'],
        ['variant_mittelfluss',            'has_variant_access(variant_id)'],
        ['variant_kapital_steuern',        'has_variant_access(variant_id)'],
        ['variant_nebenmietobjekte',       'has_variant_access(variant_id)'],
        ['building_quantities',            'has_building_access(variant_building_id)'],
        ['building_storeys',               'has_building_access(variant_building_id)'],
        ['building_mietflaechen',          'has_building_access(variant_building_id)'],
        ['building_ertragsobjekte',        'has_building_access(variant_building_id)'],
        ['variant_building_bkp2_kennwerte','has_building_access(variant_building_id)'],
        ['building_mieteinheiten',         'has_mietflaeche_access(mietflaeche_id)']
    ];
    tab text;
    pruefung text;
    alt record;
    i int;
BEGIN
    FOR i IN 1 .. array_length(zuordnung, 1) LOOP
        tab      := zuordnung[i][1];
        pruefung := zuordnung[i][2];

        IF to_regclass('public.' || tab) IS NULL THEN
            RAISE WARNING 'Tabelle % fehlt — übersprungen', tab;
            CONTINUE;
        END IF;

        FOR alt IN
            SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = tab
        LOOP
            EXECUTE format('DROP POLICY %I ON public.%I', alt.policyname, tab);
        END LOOP;

        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (is_active_user() AND %s)',
            tab || '_select_zugeordnet', tab, pruefung);

        -- Ein neues Projekt kann noch keine Zuordnung haben; es entsteht mit
        -- dem Schreibrecht, und der Trigger ordnet den Ersteller zu.
        IF tab = 'projects' THEN
            EXECUTE format(
                'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (can_write())',
                tab || '_insert_write', tab);
        ELSE
            EXECUTE format(
                'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (can_write() AND %s)',
                tab || '_insert_write', tab, pruefung);
        END IF;

        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (can_write() AND %s) WITH CHECK (can_write() AND %s)',
            tab || '_update_write', tab, pruefung, pruefung);

        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (can_write() AND %s)',
            tab || '_delete_write', tab, pruefung);
    END LOOP;
END $$;

-- =============================================================================
-- HINWEISE
-- =============================================================================
-- 1. Nach dem Einspielen sehen Bearbeiter und Betrachter kein Projekt mehr,
--    bis es ihnen in der Benutzerverwaltung zugeordnet wird.
--
-- 2. Soll stattdessen der bisherige Stand erhalten bleiben — alle aktiven
--    Benutzer auf allen bestehenden Projekten —, dieses Statement einmal
--    ausführen:
--
--    INSERT INTO project_members (project_id, user_id) SELECT p.id, pr.id FROM projects p CROSS JOIN profiles pr WHERE pr.active ON CONFLICT DO NOTHING;
--
-- 3. Nicht projektgebunden bleiben: Kunden, Einstellungen, Berichtsvorlagen und
--    die Dateien im Storage (Projektbilder, GIS-Ausschnitte). Wer die Adresse
--    einer Datei kennt, kann sie weiterhin laden.
-- =============================================================================
