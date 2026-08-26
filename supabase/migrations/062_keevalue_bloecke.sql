-- =============================================================================
-- NPIM-Businessplan: keeValue-Import je Etappe × Nutzungsart
-- Migration: 062_keevalue_bloecke.sql
--
-- Bisher hielt variant_keevalue_import genau einen Excel-Import pro Variante.
-- Neu soll — wie bei den Benchmarks (061) — wahlweise gesamthaft oder je Block
-- aus Etappe und Nutzungsart gerechnet werden. Jeder Block bekommt damit sein
-- eigenes keeValue-Ergebnis, das separat eingelesen wird.
--
-- `block_key` ist der leere String für den Gesamtimport und sonst
-- '<etappe_id>::<eigentumsart>' — derselbe Schlüssel wie im Benchmark-Dokument.
-- Bestehende Zeilen behalten über den Default den leeren Schlüssel und bleiben
-- damit der Gesamtimport.
--
-- Die Erfassungstiefe selbst (modus) steht im JSONB von
-- variant_keevalue_ergaenzung, dessen Aufbau ohne Schema-Änderung mitwächst.
-- =============================================================================

ALTER TABLE variant_keevalue_import
    ADD COLUMN IF NOT EXISTS block_key text NOT NULL DEFAULT '';

-- Ein Import je Variante × Block statt je Variante.
ALTER TABLE variant_keevalue_import
    DROP CONSTRAINT IF EXISTS variant_keevalue_import_variant_id_key;
ALTER TABLE variant_keevalue_import
    DROP CONSTRAINT IF EXISTS variant_keevalue_import_variant_block_key;
ALTER TABLE variant_keevalue_import
    ADD CONSTRAINT variant_keevalue_import_variant_block_key UNIQUE (variant_id, block_key);

CREATE INDEX IF NOT EXISTS idx_variant_keevalue_import_variant_block
    ON variant_keevalue_import(variant_id, block_key);
