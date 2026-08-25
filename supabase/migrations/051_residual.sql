-- =============================================================================
-- NPIM-Businessplan: Residualwertberechnung — zusätzliche Parameter
-- Migration: 051_residual.sql
--
-- Erweitert variant_rendite um die Residualwert-Eingabe:
--   * Nettokapitalisierungssatz (Ertragswert = Liegenschaftserfolg / Satz)
-- Die Grundstücksfläche für CHF/m² wird aus den Anlagekosten (GSF) übernommen.
-- =============================================================================

ALTER TABLE variant_rendite
    ADD COLUMN IF NOT EXISTS netto_kap_satz numeric(6,5) NOT NULL DEFAULT 0.04;
