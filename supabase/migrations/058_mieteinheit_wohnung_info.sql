-- =============================================================================
-- NPIM-Businessplan: Zusatzangaben je Mieteinheit (Wohnungsnummer, Wohnungstyp)
-- Migration: 058_mieteinheit_wohnung_info.sql
--
-- Auf Mieteinheit-Ebene sollen eine Wohnungsnummer und ein Wohnungstyp erfasst
-- werden können. Der Wohnungstyp ist Freitext (UI bietet bei Wohnen eine Auswahl:
-- Geschosswohnung, Maisonette, Attika, Dachgeschoss, REFH, EFH, Atelierwohnung,
-- Loft — plus freie Eingabe).
-- =============================================================================

ALTER TABLE building_mieteinheiten
    ADD COLUMN IF NOT EXISTS wohnungsnummer text,
    ADD COLUMN IF NOT EXISTS wohnungstyp    text;
