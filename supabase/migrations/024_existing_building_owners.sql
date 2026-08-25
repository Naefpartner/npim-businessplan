-- =============================================================================
-- NPIM-Businessplan: Eigentümer-Anteile pro Bestandsgebäude
-- Migration: 024_existing_building_owners.sql
--
-- Pro Bestandsgebäude können mehrere Eigentümer mit prozentualem Anteil
-- erfasst werden. Bewusst ohne Obergrenze (>100% wäre meist ein Tippfehler,
-- aber Sonderfälle wie Stockwerkeigentum mit Wertquoten sollen möglich sein
-- — die UI weist auf Auffälligkeiten hin).
-- =============================================================================

CREATE TABLE IF NOT EXISTS existing_building_owners (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    existing_building_id uuid NOT NULL REFERENCES existing_buildings(id) ON DELETE CASCADE,
    name                 text NOT NULL,
    anteil_pct           numeric(6,2) NOT NULL CHECK (anteil_pct >= 0),
    sort_order           smallint NOT NULL DEFAULT 0,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE existing_building_owners ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_existing_building_owners_building
    ON existing_building_owners(existing_building_id);

DROP TRIGGER IF EXISTS trg_existing_building_owners_updated_at ON existing_building_owners;
CREATE TRIGGER trg_existing_building_owners_updated_at
    BEFORE UPDATE ON existing_building_owners
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP POLICY IF EXISTS "existing_building_owners_select_active" ON existing_building_owners;
CREATE POLICY "existing_building_owners_select_active"
    ON existing_building_owners FOR SELECT TO authenticated
    USING (is_active_user());

DROP POLICY IF EXISTS "existing_building_owners_insert_write" ON existing_building_owners;
CREATE POLICY "existing_building_owners_insert_write"
    ON existing_building_owners FOR INSERT TO authenticated
    WITH CHECK (can_write());

DROP POLICY IF EXISTS "existing_building_owners_update_write" ON existing_building_owners;
CREATE POLICY "existing_building_owners_update_write"
    ON existing_building_owners FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

DROP POLICY IF EXISTS "existing_building_owners_delete_write" ON existing_building_owners;
CREATE POLICY "existing_building_owners_delete_write"
    ON existing_building_owners FOR DELETE TO authenticated
    USING (can_write());
