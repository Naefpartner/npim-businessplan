-- =============================================================================
-- NPIM-Businessplan: Berechnungsmethode „ertrag_nutzung" für 710/720 zulassen
-- Migration: 056_bkp_calc_method_ertrag_nutzung.sql
--
-- Die Positionen 710/720 (Erstvermietung) und 730/740 (Verkauf) können neu als
-- % nach Nutzungskategorie gerechnet werden (Methode `ertrag_nutzung`): 710/720
-- über die Mieterträge, 730/740 über den Verkaufserlös der STWEG-Objekte
-- (gleiche Engine, Wert je Nutzung block-/eig-genau). Die gewählten Nutzungen +
-- Anteile liegen in `calc_base` (jsonb, unverändert). Der CHECK auf calc_method
-- muss den neuen Wert erlauben.
-- =============================================================================

ALTER TABLE variant_bkp_kosten
    DROP CONSTRAINT IF EXISTS variant_bkp_kosten_calc_method_check;

ALTER TABLE variant_bkp_kosten
    ADD CONSTRAINT variant_bkp_kosten_calc_method_check
    CHECK (calc_method IS NULL OR calc_method IN
        ('standard', 'pauschal', 'einheit', 'prozent_von', 'promille_von', 'honorarrechner', 'ertrag_nutzung'));
