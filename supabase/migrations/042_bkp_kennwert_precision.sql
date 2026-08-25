-- =============================================================================
-- NPIM-Businessplan: Höhere Präzision für Kennwerte
-- Migration: 042_bkp_kennwert_precision.sql
--
-- kennwert war numeric(14,4) → bei %-Sätzen (als Bruch gespeichert) blieben nur
-- 2 %-Kommastellen, und das Zurückrechnen vom Betrag rundete weg. Auf 10
-- Nachkommastellen erhöhen (≈ 8 %-Kommastellen, exakte Rückrechnung).
-- =============================================================================

ALTER TABLE variant_bkp_kosten
    ALTER COLUMN kennwert  TYPE numeric(20,10),
    ALTER COLUMN kennwert2 TYPE numeric(20,10);
