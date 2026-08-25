-- =============================================================================
-- NPIM-Businessplan: Kundentypen "Stiftung" und "Öffentliche Hand" ergänzen
-- Migration: 055_customer_kind_stiftung_oeffentliche_hand.sql
-- =============================================================================

ALTER TYPE customer_kind ADD VALUE IF NOT EXISTS 'stiftung';
ALTER TYPE customer_kind ADD VALUE IF NOT EXISTS 'oeffentliche_hand';
