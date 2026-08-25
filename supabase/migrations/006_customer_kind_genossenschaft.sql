-- =============================================================================
-- NPIM-Businessplan: Kundentyp "Genossenschaft" ergänzen
-- Migration: 006_customer_kind_genossenschaft.sql
-- =============================================================================

ALTER TYPE customer_kind ADD VALUE IF NOT EXISTS 'genossenschaft';
