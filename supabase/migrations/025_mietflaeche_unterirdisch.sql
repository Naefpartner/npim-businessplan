-- =============================================================================
-- NPIM-Businessplan: Oberirdisch/Unterirdisch-Flag pro Mietflächen-Zeile
-- Migration: 025_mietflaeche_unterirdisch.sql
--
-- Hintergrund: Die Anlagekosten-Erfassung (BKP 2) braucht m³ getrennt nach
-- oberirdisch und unterirdisch (Wohnen oberirdisch vs. Wohnen unterirdisch /
-- Keller, Gewerbe oberirdisch vs. Lager im UG usw.). Wir lösen das mit einem
-- Boolean-Flag pro Mietflächen-Zeile statt einer separaten Tabelle.
--
-- Default: false (= oberirdisch). Bestehende Zeilen bleiben damit unverändert
-- als „oberirdisch" markiert, was den häufigsten Fall trifft.
-- =============================================================================

ALTER TABLE building_mietflaechen
    ADD COLUMN IF NOT EXISTS unterirdisch boolean NOT NULL DEFAULT false;
