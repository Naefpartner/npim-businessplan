-- =============================================================================
-- NPIM-Businessplan: Expliziter Aggregat-Schalter pro Anlagekosten-Position
-- Migration: 035_bkp_aggregate_from_etappen.sql
--
-- Statt automatisch zu aggregieren, sobald eine Etappe abweicht, steuert ein
-- Haken pro (Eigentumsart, Position) auf der Konsolidiert-Row die Richtung:
--   true  → Konsolidiert = Summe der Etappen (Etappen sind führend)
--   false → Konsolidiert-Wert wird per Logik (blockShare/GSF) auf die Etappen
--           verteilt (Konsolidiert ist führend)
-- Das Flag wird auf der Konsolidiert-Row (etappe_id NULL) gepflegt.
-- =============================================================================

ALTER TABLE variant_bkp_kosten
    ADD COLUMN IF NOT EXISTS aggregate_from_etappen boolean NOT NULL DEFAULT false;
