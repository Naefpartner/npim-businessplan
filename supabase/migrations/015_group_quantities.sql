-- =============================================================================
-- NPIM-Businessplan: Mengen pro Nutzungsart-Gruppe statt pro Gebäude
-- Migration: 015_group_quantities.sql
--
-- Mengen (Parkplätze, Anzahl Wohnungen, …) sind in Wirklichkeit i.d.R. nicht
-- pro Einzelgebäude, sondern für die ganze Nutzungs-Gruppe einer Variante
-- definiert (z.B. eine zentrale Tiefgarage für alle Renditeobjekte).
-- =============================================================================

CREATE TABLE IF NOT EXISTS variant_group_quantities (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id        uuid NOT NULL REFERENCES project_variants(id) ON DELETE CASCADE,
    use_type          project_use_type NOT NULL,
    garagen_pp        integer,
    aussen_pp         integer,
    motorrad_pp       integer,
    velo_pp           integer,
    anzahl_wohnungen  integer,
    anzahl_gewerbe    integer,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (variant_id, use_type)
);

ALTER TABLE variant_group_quantities ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_vgq_variant_id ON variant_group_quantities(variant_id);

DROP TRIGGER IF EXISTS trg_vgq_updated_at ON variant_group_quantities;
CREATE TRIGGER trg_vgq_updated_at
    BEFORE UPDATE ON variant_group_quantities
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE POLICY "vgq_select_active"
    ON variant_group_quantities FOR SELECT TO authenticated
    USING (is_active_user());

CREATE POLICY "vgq_insert_write"
    ON variant_group_quantities FOR INSERT TO authenticated
    WITH CHECK (can_write());

CREATE POLICY "vgq_update_write"
    ON variant_group_quantities FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

CREATE POLICY "vgq_delete_write"
    ON variant_group_quantities FOR DELETE TO authenticated
    USING (can_write());

-- Bestehende Werte aus building_quantities aufsummieren (best effort)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'building_quantities'
    ) THEN
        INSERT INTO variant_group_quantities (
            variant_id, use_type,
            garagen_pp, aussen_pp, motorrad_pp, velo_pp,
            anzahl_wohnungen, anzahl_gewerbe
        )
        SELECT
            vb.variant_id,
            vb.use_type,
            SUM(bq.garagen_pp),
            SUM(bq.aussen_pp),
            SUM(bq.motorrad_pp),
            SUM(bq.velo_pp),
            SUM(bq.anzahl_wohnungen),
            SUM(bq.anzahl_gewerbe)
        FROM variant_buildings vb
        JOIN building_quantities bq ON bq.variant_building_id = vb.id
        GROUP BY vb.variant_id, vb.use_type
        ON CONFLICT (variant_id, use_type) DO NOTHING;
    END IF;
END $$;

DROP TABLE IF EXISTS building_quantities CASCADE;
