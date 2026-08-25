-- =============================================================================
-- NPIM-Businessplan: Nummer (Code) für eigene Anlagekosten-Zeilen
-- Migration: 038_custom_position_code.sql
--
-- Eigene Zeilen bekommen eine frei wählbare Positionsnummer; die Anzeige je
-- Hauptgruppe wird aufsteigend nach dieser Nummer sortiert.
-- =============================================================================

ALTER TABLE variant_bkp_custom_position
    ADD COLUMN IF NOT EXISTS code text NOT NULL DEFAULT '';
