-- =============================================================================
-- NPIM-Businessplan: Vordefinierte Berichte (Kapitelauswahl)
-- Migration: 063_bericht_vorlagen.sql
--
-- Eine Berichtsvorlage hält die Auswahl der zu druckenden Kapitel unter einem
-- Namen, z.B. „Machbarkeitsstudie kurz" oder „Vollbericht". Bewusst
-- projektübergreifend: einmal definiert, in jedem Projekt und jeder Variante
-- nutzbar.
--
-- `kapitel` ist ein JSONB-Array der Kapitelschlüssel in Druckreihenfolge —
-- die Schlüssel definiert lib/bericht.ts. Als JSONB, weil Kapitel dazukommen
-- und ihre Optionen (z.B. Detailtiefe) später mitwachsen sollen.
-- =============================================================================

CREATE TABLE IF NOT EXISTS bericht_vorlagen (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    /** Optionale Kurzbeschreibung für die Auswahlliste. */
    beschreibung text,
    kapitel     jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Namen eindeutig halten, damit „Vollbericht" nicht dreimal in der Liste steht.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bericht_vorlagen_name ON bericht_vorlagen(lower(name));

DROP TRIGGER IF EXISTS trg_bericht_vorlagen_updated_at ON bericht_vorlagen;
CREATE TRIGGER trg_bericht_vorlagen_updated_at
    BEFORE UPDATE ON bericht_vorlagen
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE bericht_vorlagen ENABLE ROW LEVEL SECURITY;

-- Vorlagen sind Teamwissen: alle aktiven Benutzer sehen sie, alle mit
-- Schreibrecht pflegen sie.
DROP POLICY IF EXISTS bv_select ON bericht_vorlagen;
CREATE POLICY bv_select ON bericht_vorlagen FOR SELECT TO authenticated
    USING (is_active_user());

DROP POLICY IF EXISTS bv_insert ON bericht_vorlagen;
CREATE POLICY bv_insert ON bericht_vorlagen FOR INSERT TO authenticated
    WITH CHECK (can_write());

DROP POLICY IF EXISTS bv_update ON bericht_vorlagen;
CREATE POLICY bv_update ON bericht_vorlagen FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

DROP POLICY IF EXISTS bv_delete ON bericht_vorlagen;
CREATE POLICY bv_delete ON bericht_vorlagen FOR DELETE TO authenticated
    USING (can_write());
