-- =============================================================================
-- NPIM-Businessplan: Mietzinsen pro Mengen-Eintrag (Garagen-PP, etc.)
-- Migration: 016_quantity_miete.sql
--
-- Pro Eintrag in variant_group_quantities (Garagen-PP, Aussen-PP, …) lassen
-- sich nun zusätzlich CHF/Stk·Mt und CHF/a erfassen. Modell als JSONB,
-- damit weitere Eintrags-Typen ohne Schema-Migration ergänzbar sind.
-- =============================================================================

ALTER TABLE variant_group_quantities
    ADD COLUMN IF NOT EXISTS miete jsonb;
