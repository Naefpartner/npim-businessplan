-- =============================================================================
-- NPIM-Businessplan: Berichtseinstellungen merken und je Projekt speichern
-- Migration: 073_bericht_speichern.sql
--
-- Zwei Dinge, die bisher bei jedem Aufruf neu einzustellen waren:
--
-- 1. Der Arbeitsstand einer Variante — Kapitelauswahl, Anrede, Etappenumfang
--    und Etappenauswahl. Er gehört zur Variante wie die Seitenumbrüche
--    (Migration 067) und wird automatisch gemerkt, ohne Knopf.
--
-- 2. Benannte Berichte. `bericht_vorlagen` gab es schon, aber nur
--    projektübergreifend und nur mit der Kapitelliste. Neu trägt eine Vorlage
--    wahlweise ein Projekt (dann erscheint sie nur dort) und die übrigen
--    Einstellungen. Die Seitenumbrüche bleiben bewusst draussen: sie zeigen
--    auf Häuser, Etappen und Positionen einer bestimmten Variante.
-- =============================================================================

-- ── 1. Arbeitsstand je Variante ─────────────────────────────────────────────
ALTER TABLE project_variants
    ADD COLUMN IF NOT EXISTS bericht_einstellungen jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN project_variants.bericht_einstellungen IS
    'Zuletzt benutzte Berichtseinstellungen dieser Variante: kapitel, anrede, '
    'umfang, etappen. Form siehe lib/bericht.ts (BerichtEinstellungen).';

-- ── 2. Vorlagen wahlweise an ein Projekt binden ─────────────────────────────
ALTER TABLE bericht_vorlagen
    ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE bericht_vorlagen
    ADD COLUMN IF NOT EXISTS einstellungen jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN bericht_vorlagen.project_id IS
    'Projekt, zu dem dieser Bericht gehört. NULL = projektübergreifende Vorlage.';
COMMENT ON COLUMN bericht_vorlagen.einstellungen IS
    'Anrede, Etappenumfang und Etappenauswahl; die Kapitel stehen in kapitel.';

CREATE INDEX IF NOT EXISTS idx_bericht_vorlagen_project
    ON bericht_vorlagen(project_id);

-- Der Name muss nur innerhalb seines Geltungsbereichs eindeutig sein: zwei
-- Projekte dürfen beide ein „Bankdossier" führen. Der alte Index über den
-- blossen Namen weicht deshalb zwei getrennten.
DROP INDEX IF EXISTS idx_bericht_vorlagen_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bericht_vorlagen_name_global
    ON bericht_vorlagen(lower(name)) WHERE project_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bericht_vorlagen_name_projekt
    ON bericht_vorlagen(project_id, lower(name)) WHERE project_id IS NOT NULL;
