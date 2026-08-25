-- =============================================================================
-- NPIM-Businessplan: Lock-Flags pro Mietflächen-Zeile
-- Migration: 013_mietflaechen_locks.sql
--
-- Pro Zeile kann der User einzelne Werte „einfrieren". Die Recalc-Logik
-- überschreibt eingefrorene Felder nicht, sondern leitet auf andere
-- Beziehungen aus (z.B. wenn GF und VMF gelockt sind, wird der Faktor
-- berechnet, statt einer der beiden Werte überschrieben zu werden).
-- =============================================================================

ALTER TABLE building_mietflaechen
    ADD COLUMN IF NOT EXISTS locked_fields text[] NOT NULL DEFAULT '{}'::text[];
