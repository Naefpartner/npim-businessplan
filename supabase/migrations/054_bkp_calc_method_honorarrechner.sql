-- =============================================================================
-- NPIM-Businessplan: Berechnungsmethode „honorarrechner" für 690a/690b zulassen
-- Migration: 054_bkp_calc_method_honorarrechner.sql
--
-- Die Anlagekosten-Positionen 690a (Planer bis SIA-Phase 41) und 690b (ab
-- Phase 51) können neu die Honorarsummen aus dem Honorarrechner übernehmen
-- (Methode `honorarrechner`). Dafür muss der CHECK-Constraint auf
-- variant_bkp_kosten.calc_method (aus Migration 037) den neuen Wert erlauben.
-- =============================================================================

ALTER TABLE variant_bkp_kosten
    DROP CONSTRAINT IF EXISTS variant_bkp_kosten_calc_method_check;

ALTER TABLE variant_bkp_kosten
    ADD CONSTRAINT variant_bkp_kosten_calc_method_check
    CHECK (calc_method IS NULL OR calc_method IN
        ('standard', 'pauschal', 'einheit', 'prozent_von', 'promille_von', 'honorarrechner'));
