-- =============================================================================
-- NPIM-Businessplan: Pauschal-Kalkulator — Teilpositionen einer Pauschale
-- Migration: 036_bkp_pauschal_detail.sql
--
-- Eine Pauschale kann entweder direkt als Zahl erfasst oder im Rechner aus
-- mehreren Teilpositionen (Text · Anzahl · EH-Preis) zusammengebaut werden.
-- Das Total landet in betrag_override; die Aufschlüsselung hier als JSON:
--   [{ "text": "...", "anzahl": 1, "ehp": 1000 }, ...]
-- =============================================================================

ALTER TABLE variant_bkp_kosten
    ADD COLUMN IF NOT EXISTS pauschal_detail jsonb;
