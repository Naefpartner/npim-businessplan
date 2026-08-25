-- =============================================================================
-- NPIM-Businessplan: MwSt-Satz an Variante + Override pro BKP-Position
-- Migration: 031_mwst_und_einheiten.sql
--
-- Pro Variante wird ein globaler MwSt-Satz gespeichert (Default 8.1% gemäss
-- Schweizer Standard). Pro BKP-Position kann der User:
--   - mwst_anwenden setzen (TRUE/FALSE; NULL = Katalog-Default)
--   - mwst_satz_override setzen (NULL = globaler Satz der Variante)
-- =============================================================================

ALTER TABLE project_variants
    ADD COLUMN IF NOT EXISTS mwst_satz numeric(5,4) NOT NULL DEFAULT 0.0810;

ALTER TABLE variant_bkp_kosten
    ADD COLUMN IF NOT EXISTS mwst_anwenden      boolean,
    ADD COLUMN IF NOT EXISTS mwst_satz_override numeric(5,4);
