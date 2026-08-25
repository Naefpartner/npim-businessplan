-- =============================================================================
-- NPIM-Businessplan: Eigener Baurechtszins in der Kostenmiete
-- Migration: 049_baurecht_zins.sql
--
-- Der Baurechtszins ist neu frei wählbar (unabhängig vom Referenzzinssatz).
-- =============================================================================

ALTER TABLE variant_kostenmiete
    ADD COLUMN IF NOT EXISTS baurecht_zins numeric(6,5) NOT NULL DEFAULT 0.015;
