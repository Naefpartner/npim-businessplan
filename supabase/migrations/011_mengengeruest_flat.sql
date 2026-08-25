-- =============================================================================
-- NPIM-Businessplan: Mengengerüst flach (eine Zeile pro Erfassungseinheit)
-- Migration: 011_mengengeruest_flat.sql
--
-- Aufgehoben: Erfassungstiefe-Modus / Geschoss-Tabelle / Miete-Modus.
-- Neu: pro Mietflächen-Zeile alle Werte (Geschoss als Text, GF, Höhe,
-- Volumen, Faktor, VMF, drei Mietzins-Repräsentationen). Auto-Berechnung
-- erfolgt im Frontend.
-- =============================================================================

-- Alte Tiefen-Felder aus variant_buildings entfernen — UI nutzt sie nicht mehr.
ALTER TABLE variant_buildings DROP COLUMN IF EXISTS erfassungstiefe;
ALTER TABLE variant_buildings DROP COLUMN IF EXISTS leit_groesse;

-- Geschoss-Tabelle entfällt; Geschoss kommt als Text in jeder Zeile.
DROP TABLE IF EXISTS building_storeys CASCADE;

-- Alte Miete-Modus-Felder & storey_id raus
ALTER TABLE building_mietflaechen DROP COLUMN IF EXISTS storey_id;
ALTER TABLE building_mietflaechen DROP COLUMN IF EXISTS miete_modus;
ALTER TABLE building_mietflaechen DROP COLUMN IF EXISTS miete_wert;

-- Neue Felder pro Zeile
ALTER TABLE building_mietflaechen
    ADD COLUMN IF NOT EXISTS geschoss_bezeichnung text,
    ADD COLUMN IF NOT EXISTS gf_m2                numeric(12,2),
    ADD COLUMN IF NOT EXISTS geschosshoehe_m      numeric(5,2),
    ADD COLUMN IF NOT EXISTS volumen_m3           numeric(12,2),
    ADD COLUMN IF NOT EXISTS faktor_vmf_gf        numeric(5,3),
    ADD COLUMN IF NOT EXISTS miete_chf_m2_pa      numeric(10,2),
    ADD COLUMN IF NOT EXISTS miete_chf_stk_mt     numeric(10,2),
    ADD COLUMN IF NOT EXISTS miete_chf_pa         numeric(12,2);

-- Enums, die nicht mehr genutzt werden, droppen (falls niemand sonst sie braucht)
DROP TYPE IF EXISTS erfassungstiefe;
DROP TYPE IF EXISTS leit_groesse;
DROP TYPE IF EXISTS miete_modus;
