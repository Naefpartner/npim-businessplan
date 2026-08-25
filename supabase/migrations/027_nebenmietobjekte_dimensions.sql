-- =============================================================================
-- NPIM-Businessplan: Dimensionen + OI/UI an Nebenmietobjekten
-- Migration: 027_nebenmietobjekte_dimensions.sql
--
-- Damit Nebenmietobjekte (Garagen-PP, Lager, Reklametafeln …) ebenfalls in
-- die BKP-2-Aggregation einfliessen, brauchen sie eigene Mengen:
--   - Geschossfläche, Geschosshöhe, Volumen — mit Lock-Mechanismus
--     (`locked_fields`) wie bei Mietflächen
--   - Oberirdisch/Unterirdisch-Flag pro Zeile
-- =============================================================================

ALTER TABLE variant_nebenmietobjekte
    ADD COLUMN IF NOT EXISTS gf_m2          numeric(12,2),
    ADD COLUMN IF NOT EXISTS geschosshoehe_m numeric(5,2),
    ADD COLUMN IF NOT EXISTS volumen_m3     numeric(12,2),
    ADD COLUMN IF NOT EXISTS locked_fields  text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS unterirdisch   boolean NOT NULL DEFAULT false;
