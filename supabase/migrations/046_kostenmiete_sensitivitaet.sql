-- =============================================================================
-- NPIM-Businessplan: Sensitivitätsanalyse-Einstellungen je Variante
-- Migration: 046_kostenmiete_sensitivitaet.sql
--
-- Speichert die gewählten Achsen und Schrittweiten der Sensitivitätsanalyse
-- (Kostenmiete) pro Variante in variant_kostenmiete.
--   *_axis_*  : 'refzins' | 'erstellung_pm2' | 'erstellung_abs' | 'vmf_wohnen'
--   *_mode    : 'pct' (relativ) | 'abs' (absolut)
--   *_value   : Schrittweite (Anteil bei pct, native Einheit bei abs)
-- =============================================================================

ALTER TABLE variant_kostenmiete
    ADD COLUMN IF NOT EXISTS sens_axis_x      text          NOT NULL DEFAULT 'refzins'
        CHECK (sens_axis_x IN ('refzins', 'erstellung_pm2', 'erstellung_abs', 'vmf_wohnen')),
    ADD COLUMN IF NOT EXISTS sens_axis_y      text          NOT NULL DEFAULT 'erstellung_abs'
        CHECK (sens_axis_y IN ('refzins', 'erstellung_pm2', 'erstellung_abs', 'vmf_wohnen')),
    ADD COLUMN IF NOT EXISTS sens_step_x_mode text          NOT NULL DEFAULT 'pct'
        CHECK (sens_step_x_mode IN ('pct', 'abs')),
    ADD COLUMN IF NOT EXISTS sens_step_x_value numeric(16,5) NOT NULL DEFAULT 0.1,
    ADD COLUMN IF NOT EXISTS sens_step_y_mode text          NOT NULL DEFAULT 'pct'
        CHECK (sens_step_y_mode IN ('pct', 'abs')),
    ADD COLUMN IF NOT EXISTS sens_step_y_value numeric(16,5) NOT NULL DEFAULT 0.1;
