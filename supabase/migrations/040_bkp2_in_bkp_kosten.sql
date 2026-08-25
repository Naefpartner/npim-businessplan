-- =============================================================================
-- NPIM-Businessplan: BKP 2 ins generische Positions-System überführen
-- Migration: 040_bkp2_in_bkp_kosten.sql
--
-- Die BKP-2-Kennwerte (variant_bkp2_kennwerte) wandern als normale Positionen
-- (position_code = 'bkp2:<row_key>') in variant_bkp_kosten. Damit rendert BKP 2
-- wie die übrigen Hauptgruppen (gleiche Spalten, Methode, Haken, eigene Zeilen);
-- die m³-Mengen kommen live aus dem Mengengerüst.
-- =============================================================================

INSERT INTO variant_bkp_kosten
    (variant_id, etappe_id, eigentumsart, position_code, status, kennwert, betrag_override, aggregate_from_etappen)
SELECT variant_id, etappe_id, eigentumsart, 'bkp2:' || row_key, 'beruecksichtigt',
       chf_pro_m3, pauschal_chf, aggregate_from_etappen
FROM variant_bkp2_kennwerte
ON CONFLICT ON CONSTRAINT variant_bkp_kosten_uq DO NOTHING;

DROP TABLE IF EXISTS variant_bkp2_kennwerte;
