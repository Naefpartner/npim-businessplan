-- =============================================================================
-- NPIM-Businessplan: Nebenmietobjekte entfernen
-- Migration: 029_drop_nebenmietobjekte.sql
--
-- Mit der erweiterten Mengenerfassung (Stk + VMF/Stk + Lock-Reconcile) lassen
-- sich Garagenplätze, Lager etc. genauso wie Mietflächen als reguläre Zeilen
-- im Mengengerüst erfassen. Das alte separate `variant_nebenmietobjekte`-Modell
-- ist damit obsolet und wird komplett entfernt.
-- =============================================================================

DROP TABLE IF EXISTS variant_nebenmietobjekte CASCADE;
