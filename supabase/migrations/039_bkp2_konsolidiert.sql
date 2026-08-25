-- =============================================================================
-- NPIM-Businessplan: BKP 2 — Konsolidiert-Ebene + Aggregat-Flag (wie HG 0-9)
-- Migration: 039_bkp2_konsolidiert.sql
--
-- Bisher waren BKP-2-Kennwerte zwingend pro Etappe (etappe_id NOT NULL). Neu:
--   * etappe_id NULL = Konsolidiert-Ebene (etappenübergreifender CHF/m³)
--   * aggregate_from_etappen: true = Konsolidiert aus Etappen aggregiert,
--     false = Konsolidiert-Wert wird in den Etappen verwendet (Default).
-- =============================================================================

ALTER TABLE variant_bkp2_kennwerte ALTER COLUMN etappe_id DROP NOT NULL;

-- Sentinel für NULL etappe_id (Konsolidiert), damit Unique-Key + Upsert greifen.
ALTER TABLE variant_bkp2_kennwerte
    ADD COLUMN IF NOT EXISTS etappe_key uuid NOT NULL
        GENERATED ALWAYS AS (COALESCE(etappe_id, '00000000-0000-0000-0000-000000000000')) STORED;

-- Alte Unique-Constraint (auf etappe_id) entfernen — Name ist auto-generiert.
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'variant_bkp2_kennwerte'::regclass AND contype = 'u'
      AND conname <> 'variant_bkp2_kennwerte_uq'
  LOOP
    EXECUTE 'ALTER TABLE variant_bkp2_kennwerte DROP CONSTRAINT ' || quote_ident(c);
  END LOOP;
END $$;

ALTER TABLE variant_bkp2_kennwerte
    ADD CONSTRAINT variant_bkp2_kennwerte_uq
    UNIQUE (variant_id, etappe_key, eigentumsart, row_key);

ALTER TABLE variant_bkp2_kennwerte
    ADD COLUMN IF NOT EXISTS aggregate_from_etappen boolean NOT NULL DEFAULT false;
