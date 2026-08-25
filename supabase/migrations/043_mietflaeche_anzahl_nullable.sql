-- =============================================================================
-- NPIM-Businessplan: Stk (anzahl) auf Geschoss-/Mietflächenebene optional
-- Migration: 043_mietflaeche_anzahl_nullable.sql
--
-- Bisher war building_mietflaechen.anzahl NOT NULL DEFAULT 1 — neue Geschoss-
-- zeilen zeigten dadurch immer „1" an. Für Zeilen ohne Mieteinheiten (z.B.
-- Keller: nur GF + Volumen) soll das Feld leer bleiben dürfen.
--
-- NULL-Default + NOT-NULL entfernen. Für Berechnungen wird NULL im Frontend
-- weiterhin als 1 behandelt (Mietzins etc.), aber nicht mehr persistiert.
-- Bestehende Werte bleiben unverändert.
-- =============================================================================

ALTER TABLE building_mietflaechen
    ALTER COLUMN anzahl DROP DEFAULT,
    ALTER COLUMN anzahl DROP NOT NULL;
