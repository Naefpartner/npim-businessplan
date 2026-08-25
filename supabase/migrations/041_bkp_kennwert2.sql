-- =============================================================================
-- NPIM-Businessplan: Zweiter Kennwert (z.B. Finanzierungs-Anteil)
-- Migration: 041_bkp_kennwert2.sql
--
-- Für Positionen mit einem dritten Eingabewert. Aktuell: Finanzierung
-- (940/950/960) = Basis × Zinssatz (kennwert) × Monate/12 (bezugsmenge)
--                 × Anteil (kennwert2).
-- =============================================================================

ALTER TABLE variant_bkp_kosten
    ADD COLUMN IF NOT EXISTS kennwert2 numeric(14,6);
