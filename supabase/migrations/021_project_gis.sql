-- =============================================================================
-- NPIM-Businessplan: GIS-Link pro Projekt
-- Migration: 021_project_gis.sql
--
-- Pro Projekt wird die zuletzt angezeigte URL eines Kantons-GIS gespeichert,
-- sodass sich beim erneuten Öffnen die gleiche Kartenansicht laden lässt.
-- =============================================================================

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS gis_url text;
