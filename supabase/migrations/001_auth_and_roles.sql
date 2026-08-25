-- =============================================================================
-- NPIM-Businessplan: Auth-Modell, Rollen und RLS-Helper
-- Migration: 001_auth_and_roles.sql
--
-- Strategie:
--   - Selbstregistrierung im Supabase-Dashboard deaktiviert
--   - Neue User entstehen ausschliesslich via auth.admin.inviteUserByEmail()
--   - profiles.active steuert "Konto gesperrt"
--   - Rollen: admin / manager / viewer
--   - Helper-Funktionen sind SECURITY DEFINER, damit sie in RLS-Policies
--     anderer Tabellen aufgerufen werden können
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- ENUMS
-- -----------------------------------------------------------------------------
DO $$ BEGIN CREATE TYPE user_role AS ENUM ('admin', 'manager', 'viewer'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
    id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name   text,
    role        user_role NOT NULL DEFAULT 'viewer',
    active      boolean   NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- updated_at-Trigger
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON profiles;
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- handle_new_user: legt Profil bei jeder Auth-User-Erstellung an
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    invited_role user_role;
BEGIN
    BEGIN
        invited_role := COALESCE(
            (NEW.raw_user_meta_data->>'role')::user_role,
            'viewer'::user_role
        );
    EXCEPTION WHEN invalid_text_representation THEN
        invited_role := 'viewer';
    END;

    INSERT INTO profiles (id, full_name, role, active)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
        invited_role,
        true
    );
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: Profil konnte nicht angelegt werden: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
CREATE TRIGGER trg_on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- -----------------------------------------------------------------------------
-- RLS-Helper-Funktionen
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS user_role AS $$
    SELECT role FROM profiles WHERE id = auth.uid() AND active = true;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
    SELECT EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid() AND active = true AND role = 'admin'
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION can_write()
RETURNS boolean AS $$
    SELECT EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid() AND active = true AND role IN ('admin', 'manager')
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION is_active_user()
RETURNS boolean AS $$
    SELECT EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid() AND active = true
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- -----------------------------------------------------------------------------
-- profiles-Policies
--   - User sehen nur ihr eigenes Profil; Admin sieht/ändert alle
--   - User können den eigenen Namen anpassen, aber nicht ihre Rolle / active-Flag
-- -----------------------------------------------------------------------------

CREATE POLICY "profiles_select_self_or_admin"
    ON profiles FOR SELECT
    TO authenticated
    USING (auth.uid() = id OR is_admin());

CREATE POLICY "profiles_update_self_name"
    ON profiles FOR UPDATE
    TO authenticated
    USING (auth.uid() = id AND active = true)
    WITH CHECK (
        auth.uid() = id
        AND active = true
        AND role = (SELECT role FROM profiles WHERE id = auth.uid())
    );

CREATE POLICY "profiles_admin_all"
    ON profiles FOR ALL
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

-- =============================================================================
-- HINWEIS NACH MIGRATION:
-- =============================================================================
-- 1. Im Supabase-Dashboard: Authentication → Providers → Email →
--    "Allow new users to sign up" auf OFF stellen.
-- 2. Den ersten Admin manuell festlegen, sobald sich der Account einmal
--    angemeldet hat:
--      UPDATE profiles SET role = 'admin' WHERE id = '<deine-uid>';
-- =============================================================================
