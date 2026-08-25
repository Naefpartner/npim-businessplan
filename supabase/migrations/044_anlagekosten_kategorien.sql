-- =============================================================================
-- NPIM-Businessplan: Anlagekosten nach Eigentumskategorie statt binär
-- Migration: 044_anlagekosten_kategorien.sql
--
-- Bisher: eigentumsart ∈ ('miete', 'stockwerkeigentum').
-- Neu:    eigentumsart ∈ ('renditeobjekt', 'genossenschaft', 'verkaufsobjekt')
--         — durchgängig zu Mengengerüst / Wohnungsmix (use_type).
--
-- Migration der Bestände: miete → renditeobjekt, stockwerkeigentum → verkaufsobjekt.
-- Genossenschaft beginnt leer (wird neu erfasst).
-- Betroffen: variant_bkp_kosten, variant_etappe_gsf_alloc, variant_bkp_custom_position.
-- (variant_bkp2_kennwerte wurde in 040 entfernt.)
-- =============================================================================

-- ─── variant_bkp_kosten ──────────────────────────────────────────────────────
ALTER TABLE variant_bkp_kosten DROP CONSTRAINT IF EXISTS variant_bkp_kosten_eigentumsart_check;
ALTER TABLE variant_bkp_kosten ALTER COLUMN eigentumsart DROP DEFAULT;
UPDATE variant_bkp_kosten SET eigentumsart = 'renditeobjekt'  WHERE eigentumsart = 'miete';
UPDATE variant_bkp_kosten SET eigentumsart = 'verkaufsobjekt' WHERE eigentumsart = 'stockwerkeigentum';
ALTER TABLE variant_bkp_kosten ALTER COLUMN eigentumsart SET DEFAULT 'renditeobjekt';
ALTER TABLE variant_bkp_kosten ADD CONSTRAINT variant_bkp_kosten_eigentumsart_check
    CHECK (eigentumsart IN ('renditeobjekt', 'genossenschaft', 'verkaufsobjekt'));

-- ─── variant_etappe_gsf_alloc ────────────────────────────────────────────────
ALTER TABLE variant_etappe_gsf_alloc DROP CONSTRAINT IF EXISTS variant_etappe_gsf_alloc_eigentumsart_check;
UPDATE variant_etappe_gsf_alloc SET eigentumsart = 'renditeobjekt'  WHERE eigentumsart = 'miete';
UPDATE variant_etappe_gsf_alloc SET eigentumsart = 'verkaufsobjekt' WHERE eigentumsart = 'stockwerkeigentum';
ALTER TABLE variant_etappe_gsf_alloc ADD CONSTRAINT variant_etappe_gsf_alloc_eigentumsart_check
    CHECK (eigentumsart IN ('renditeobjekt', 'genossenschaft', 'verkaufsobjekt'));

-- ─── variant_bkp_custom_position ─────────────────────────────────────────────
ALTER TABLE variant_bkp_custom_position DROP CONSTRAINT IF EXISTS variant_bkp_custom_position_eigentumsart_check;
UPDATE variant_bkp_custom_position SET eigentumsart = 'renditeobjekt'  WHERE eigentumsart = 'miete';
UPDATE variant_bkp_custom_position SET eigentumsart = 'verkaufsobjekt' WHERE eigentumsart = 'stockwerkeigentum';
ALTER TABLE variant_bkp_custom_position ADD CONSTRAINT variant_bkp_custom_position_eigentumsart_check
    CHECK (eigentumsart IN ('renditeobjekt', 'genossenschaft', 'verkaufsobjekt'));
