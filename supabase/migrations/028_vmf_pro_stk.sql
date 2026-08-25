-- =============================================================================
-- NPIM-Businessplan: VMF pro Stück (m²/Stk) für Mietflächen und Mieteinheiten
-- Migration: 028_vmf_pro_stk.sql
--
-- Neues Triplet im Mengengerüst: anzahl × vmf_pro_stk = flaeche_m2 (VMF).
-- Damit lässt sich z.B. die durchschnittliche Wohnungsgröße direkt erfassen:
-- 30 Wohnungen × 87,5 m² = 2'625 m² VMF.
--
-- Wie bei den anderen Maßfeldern wird das per `locked_fields` einfrierbar
-- (z.B. „stk gelockt" — bei VMF-Änderung wird vmf_pro_stk angepasst statt
-- der Anzahl).
-- =============================================================================

ALTER TABLE building_mietflaechen
    ADD COLUMN IF NOT EXISTS vmf_pro_stk numeric(12,2);

ALTER TABLE building_mieteinheiten
    ADD COLUMN IF NOT EXISTS vmf_pro_stk numeric(12,2);
