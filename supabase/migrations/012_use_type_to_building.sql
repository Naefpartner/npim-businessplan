-- =============================================================================
-- NPIM-Businessplan: Nutzungsart von Variante auf Gebäude verschieben
-- Migration: 012_use_type_to_building.sql
--
-- Fachliche Begründung: ein Projekt kann gemischte Gebäude haben (z.B. ein
-- Renditeobjekt + ein Verkaufsobjekt nebeneinander). Die Nutzungsart gehört
-- daher pro Gebäude in der Variante.
-- =============================================================================

-- Neue Spalte am Gebäude (gleicher Enum-Typ wie bei Projekten)
ALTER TABLE variant_buildings
    ADD COLUMN IF NOT EXISTS use_type project_use_type NOT NULL DEFAULT 'renditeobjekt';

-- Bestehende Daten: Variant-Wert auf alle zugehörigen Gebäude übernehmen.
-- Wird nur ausgeführt, wenn die Quell-Spalte noch existiert.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'project_variants' AND column_name = 'use_type'
    ) THEN
        UPDATE variant_buildings vb
        SET use_type = v.use_type
        FROM project_variants v
        WHERE vb.variant_id = v.id;
    END IF;
END $$;

-- Variant-Spalte entfernen
ALTER TABLE project_variants DROP COLUMN IF EXISTS use_type;
