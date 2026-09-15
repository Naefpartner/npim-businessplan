-- =============================================================================
-- NPIM-Businessplan: Berechnungsmethode „finanzierung" zulassen
-- Migration: 070_bkp_calc_method_finanzierung.sql
--
-- Eigene Zeilen (etwa in Hauptgruppe 9, Eigentümer / Investor) sollen wie die
-- Katalogpositionen 940/950/960 als Finanzierung rechnen: Kennwert = Zinssatz
-- p. a., Bezugsmenge = Laufzeit in Monaten, Bezugsgrösse über `calc_base`.
-- Der CHECK auf calc_method muss den neuen Wert erlauben.
-- =============================================================================

ALTER TABLE variant_bkp_kosten
    DROP CONSTRAINT IF EXISTS variant_bkp_kosten_calc_method_check;

ALTER TABLE variant_bkp_kosten
    ADD CONSTRAINT variant_bkp_kosten_calc_method_check
    CHECK (calc_method IS NULL OR calc_method IN
        ('standard', 'pauschal', 'einheit', 'prozent_von', 'promille_von',
         'honorarrechner', 'ertrag_nutzung', 'finanzierung'));
