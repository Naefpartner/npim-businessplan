-- =============================================================================
-- NPIM-Businessplan: Freie Mengen-Einheit pro BKP-Kostenposition
-- Migration: 032_bkp_kosten_mengen_einheit.sql
--
-- Für Positionen vom Typ "manuell_menge_einheit" (z.B. 020 Vorstudien
-- Grundstückserwerb) kann der User die Mengen-Einheit (z.B. 'Stk',
-- 'Tage', 'Pos.') frei eintragen.
-- =============================================================================

ALTER TABLE variant_bkp_kosten
    ADD COLUMN IF NOT EXISTS mengen_einheit_override text;
