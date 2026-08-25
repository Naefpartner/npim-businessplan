-- =============================================================================
-- NPIM-Businessplan: Wohnungsmix pro Mieteinheit
-- Migration: 019_mieteinheiten_wohnungsmix.sql
-- =============================================================================

ALTER TABLE building_mieteinheiten
    ADD COLUMN IF NOT EXISTS wohnungsmix jsonb;
