-- =============================================================================
-- NPIM-Businessplan: Kundenkartei
-- Migration: 005_customers.sql
--
-- Konzept:
--   - "Kunde" = Auftraggeber/Bauherr eines Projekts
--   - 1:n Verknüpfung (projects.customer_id). Falls später Konstellationen
--     wie "Bauherr + Investor + Verwalter" gleichzeitig pro Projekt benötigt
--     werden, kommt eine separate Tabelle project_customers dazu — die
--     bestehende Spalte muss dann gedropped oder migriert werden.
-- =============================================================================

DO $$ BEGIN
    CREATE TYPE customer_kind AS ENUM ('firma', 'privat');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS customers (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name         text NOT NULL,
    typ          customer_kind NOT NULL DEFAULT 'firma',
    vorname      text,
    nachname     text,
    strasse      text,
    hausnummer   text,
    plz          text,
    ort          text,
    land         text DEFAULT 'Schweiz',
    email        text,
    telefon      text,
    website      text,
    notizen      text,
    created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

DROP TRIGGER IF EXISTS trg_customers_updated_at ON customers;
CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- projects: customer_id-Spalte
-- ON DELETE SET NULL — ein gelöschter Kunde löscht keine Projekte
-- -----------------------------------------------------------------------------
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_customer_id ON projects(customer_id);

-- -----------------------------------------------------------------------------
-- RLS-Policies (analog projects/parcels):
--   Lesen für aktive User, Schreiben für admin/manager
-- -----------------------------------------------------------------------------

CREATE POLICY "customers_select_active"
    ON customers FOR SELECT TO authenticated
    USING (is_active_user());

CREATE POLICY "customers_insert_write"
    ON customers FOR INSERT TO authenticated
    WITH CHECK (can_write());

CREATE POLICY "customers_update_write"
    ON customers FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());

CREATE POLICY "customers_delete_write"
    ON customers FOR DELETE TO authenticated
    USING (can_write());
