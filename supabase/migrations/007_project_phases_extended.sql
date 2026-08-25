-- =============================================================================
-- NPIM-Businessplan: Projektphasen erweitern
-- Migration: 007_project_phases_extended.sql
--
-- Reihenfolge nach der Erweiterung:
--   grundstuecksakquisition → machbarkeit → loi → wettbewerb →
--   ueberarbeitung_wettbewerb → gestaltungsplan → vorprojekt → bauprojekt →
--   bewilligungsverfahren → ausschreibung → realisierung
-- =============================================================================

-- Vor LOI (in dieser Reihenfolge einfügen, sonst kippt die Sortierung):
ALTER TYPE project_phase ADD VALUE IF NOT EXISTS 'machbarkeit' BEFORE 'loi';
ALTER TYPE project_phase ADD VALUE IF NOT EXISTS 'grundstuecksakquisition' BEFORE 'machbarkeit';

-- Zwischen LOI und Gestaltungsplan:
ALTER TYPE project_phase ADD VALUE IF NOT EXISTS 'wettbewerb' BEFORE 'gestaltungsplan';
ALTER TYPE project_phase ADD VALUE IF NOT EXISTS 'ueberarbeitung_wettbewerb' BEFORE 'gestaltungsplan';
