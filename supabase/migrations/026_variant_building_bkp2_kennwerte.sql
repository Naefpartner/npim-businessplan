-- =============================================================================
-- NPIM-Businessplan: BKP-2-Kennwerte pro Gebäude (Anlagekosten Hauptgruppe 2)
-- Migration: 026_variant_building_bkp2_kennwerte.sql
--
-- Pro Gebäude einer Variante werden BKP-2-Kennwerte gespeichert: CHF/m³ für
-- die nutzungs- und lagespezifischen Positionen (Wohnen oberirdisch/UI,
-- Gewerbe OI/UI, Gemeinschaft OI/UI, UN-Garage) plus Pauschalen (Etappierung).
--
-- Die m³-Mengen kommen NICHT aus dieser Tabelle, sondern werden zur Laufzeit
-- aus building_mietflaechen aggregiert (nach nutzung × unterirdisch).
-- Damit bleibt das Mengengerüst die einzige Quelle der Wahrheit für Volumen.
-- =============================================================================

CREATE TABLE IF NOT EXISTS variant_building_bkp2_kennwerte (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_building_id  uuid NOT NULL REFERENCES variant_buildings(id) ON DELETE CASCADE,
    /* Position-Code, z.B. 'wohnen-oi', 'wohnen-ui', 'un-garage', 'etappierung' */
    position_code        text NOT NULL,
    /* Kennwert in CHF pro m³ — wird mit aggregierter m³-Menge multipliziert */
    chf_pro_m3           numeric(10,2),
    /* Pauschalbetrag in CHF — für Positionen ohne m³-Bezug (z.B. Etappierung) */
    pauschal_chf         numeric(14,2),
    /* Optionale Notiz pro Position, für Annahmen-Doku */
    notiz                text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE(variant_building_id, position_code)
);

ALTER TABLE variant_building_bkp2_kennwerte ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bkp2_variant_building
    ON variant_building_bkp2_kennwerte(variant_building_id);

DROP TRIGGER IF EXISTS trg_bkp2_kennwerte_updated_at ON variant_building_bkp2_kennwerte;
CREATE TRIGGER trg_bkp2_kennwerte_updated_at
    BEFORE UPDATE ON variant_building_bkp2_kennwerte
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP POLICY IF EXISTS "bkp2_kennwerte_select_active" ON variant_building_bkp2_kennwerte;
CREATE POLICY "bkp2_kennwerte_select_active"
    ON variant_building_bkp2_kennwerte FOR SELECT TO authenticated
    USING (is_active_user());

DROP POLICY IF EXISTS "bkp2_kennwerte_insert_write" ON variant_building_bkp2_kennwerte;
CREATE POLICY "bkp2_kennwerte_insert_write"
    ON variant_building_bkp2_kennwerte FOR INSERT TO authenticated
    WITH CHECK (can_write());

DROP POLICY IF EXISTS "bkp2_kennwerte_update_write" ON variant_building_bkp2_kennwerte;
CREATE POLICY "bkp2_kennwerte_update_write"
    ON variant_building_bkp2_kennwerte FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

DROP POLICY IF EXISTS "bkp2_kennwerte_delete_write" ON variant_building_bkp2_kennwerte;
CREATE POLICY "bkp2_kennwerte_delete_write"
    ON variant_building_bkp2_kennwerte FOR DELETE TO authenticated
    USING (can_write());
