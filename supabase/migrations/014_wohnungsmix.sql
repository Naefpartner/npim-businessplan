-- =============================================================================
-- NPIM-Businessplan: Wohnungsmix pro Mietflächen-Zeile
-- Migration: 014_wohnungsmix.sql
--
-- Wenn Nutzung "Wohnen" enthält: Anzahl Wohnungen pro Zimmergrösse
-- (Joker, 1.5, 2.0, …, 5.5 + 2 freie Felder mit Label).
-- Modell als JSONB, damit später flexibel weitere Grössen ergänzt werden
-- können ohne Schema-Migration.
-- =============================================================================

ALTER TABLE building_mietflaechen
    ADD COLUMN IF NOT EXISTS wohnungsmix jsonb;
