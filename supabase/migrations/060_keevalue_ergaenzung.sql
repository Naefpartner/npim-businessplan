-- =============================================================================
-- NPIM-Businessplan: Ergänzende Hauptgruppen zur keeValue-Kostenberechnung
-- Migration: 060_keevalue_ergaenzung.sql
--
-- keeValue liefert nur die Erstellungskosten (bei uns die Hauptgruppen 1, 2, 4,
-- 5, 6 sowie die Reserve in 9). Für ein vollständiges Anlagekostentotal fehlen:
--   BKP 0  Grundstück        — CHF/m² GSF, Menge aus den Parzellen
--   BKP 7  Vermarktung       — % vom Ertrag bzw. Verkaufserlös der Variante
--   BKP 8  Entwicklungskosten— % von BKP 1–7
--   BKP 9  Eigentümerkosten  — % von BKP 1–8
--   BKP 9  Reserve           — % von BKP 0–8; leer = Reserve aus keeValue
--
-- Diese vier Kennwerte werden hier je Variante gehalten. Bewusst NICHT in
-- variant_keevalue_import, weil ein neuer Excel-Upload jene Zeile ersetzt — die
-- hier erfassten Werte sollen einen Reimport überleben.
--
-- Als JSONB (analog variant_mittelfluss), damit weitere Ergänzungszeilen ohne
-- Schema-Migration dazukommen können. Aufbau siehe ErgaenzungDoc in
-- lib/keevalue.ts.
-- =============================================================================

CREATE TABLE IF NOT EXISTS variant_keevalue_ergaenzung (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id uuid NOT NULL REFERENCES project_variants(id) ON DELETE CASCADE,
    doc        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(variant_id)
);

CREATE INDEX IF NOT EXISTS idx_variant_keevalue_ergaenzung_variant
    ON variant_keevalue_ergaenzung(variant_id);

DROP TRIGGER IF EXISTS trg_variant_keevalue_ergaenzung_updated_at ON variant_keevalue_ergaenzung;
CREATE TRIGGER trg_variant_keevalue_ergaenzung_updated_at
    BEFORE UPDATE ON variant_keevalue_ergaenzung
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE variant_keevalue_ergaenzung ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vke_select ON variant_keevalue_ergaenzung;
CREATE POLICY vke_select ON variant_keevalue_ergaenzung FOR SELECT TO authenticated
    USING (is_active_user());

DROP POLICY IF EXISTS vke_insert ON variant_keevalue_ergaenzung;
CREATE POLICY vke_insert ON variant_keevalue_ergaenzung FOR INSERT TO authenticated
    WITH CHECK (can_write());

DROP POLICY IF EXISTS vke_update ON variant_keevalue_ergaenzung;
CREATE POLICY vke_update ON variant_keevalue_ergaenzung FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

DROP POLICY IF EXISTS vke_delete ON variant_keevalue_ergaenzung;
CREATE POLICY vke_delete ON variant_keevalue_ergaenzung FOR DELETE TO authenticated
    USING (can_write());
