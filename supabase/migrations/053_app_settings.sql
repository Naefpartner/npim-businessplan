-- =============================================================================
-- NPIM-Businessplan: Globale Anwendungs-Einstellungen (Standardwerte)
-- Migration: 053_app_settings.sql
--
-- Eine Singleton-Zeile (id = 1) mit anwendungsweiten Defaults. Aktuell:
--   * mwst_default — Standard-Mehrwertsteuersatz für neue Projekte/Varianten und
--     den Honorarrechner (z. B. 0.081 = 8.1 %).
-- =============================================================================

CREATE TABLE IF NOT EXISTS app_settings (
    id           smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    mwst_default numeric(6,5) NOT NULL DEFAULT 0.081,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Singleton-Zeile anlegen (falls noch nicht vorhanden).
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON app_settings;
CREATE TRIGGER trg_app_settings_updated_at
    BEFORE UPDATE ON app_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP POLICY IF EXISTS "app_settings_select_active" ON app_settings;
CREATE POLICY "app_settings_select_active"
    ON app_settings FOR SELECT TO authenticated
    USING (is_active_user());

DROP POLICY IF EXISTS "app_settings_insert_write" ON app_settings;
CREATE POLICY "app_settings_insert_write"
    ON app_settings FOR INSERT TO authenticated
    WITH CHECK (can_write());

DROP POLICY IF EXISTS "app_settings_update_write" ON app_settings;
CREATE POLICY "app_settings_update_write"
    ON app_settings FOR UPDATE TO authenticated
    USING (can_write()) WITH CHECK (can_write());
