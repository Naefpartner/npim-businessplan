-- =============================================================================
-- Eigene Zeilen auf die neuen Katalogpositionen umschlüsseln
-- Datenpflege, keine Migration — je Projekt einmal auszuführen.
--
-- Hintergrund: die Verkaufs- und Beurkundungskosten der Giessackerstrasse
-- waren als eigene Zeilen erfasst (variant_bkp_custom_position). Sie stehen
-- jetzt im Katalog (nur für Verkaufsobjekte). Ohne diesen Schritt erschienen
-- sie doppelt: einmal aus dem Katalog, einmal als eigene Zeile.
--
-- Das Skript überträgt die erfassten Werte auf die Katalogposition und löscht
-- danach die eigene Zeile. Der Zusammenhang läuft über die Nummer der eigenen
-- Zeile; die beiden Zeilen mit der Nummer 073 werden über ihre Bezeichnung
-- unterschieden (Stockwerkeigentumsbegründung → 074).
--
-- Vor dem Ausführen: den Projektnamen unten setzen. Für Altendorf dasselbe
-- Skript mit dem anderen Namen laufen lassen.
--
-- Jede Anweisung steht auf einer Zeile: beim Einfügen in den SQL-Editor gingen
-- Zeilenumbrüche verloren, und aus „c JOIN" wurde „cJOIN".
-- =============================================================================

BEGIN;

-- Abbildung: welche eigene Zeile wird zu welcher Katalogposition
CREATE TEMP TABLE abbildung ON COMMIT DROP AS SELECT c.id AS custom_id, c.variant_id, c.eigentumsart, c.code AS alte_nummer, c.label, CASE WHEN c.code = '073' AND c.label ILIKE '%stockwerk%' THEN '074' ELSE c.code END AS neuer_code FROM variant_bkp_custom_position c JOIN project_variants v ON v.id = c.variant_id JOIN projects p ON p.id = v.project_id WHERE p.name ILIKE '%Giessackerstrasse%' AND c.eigentumsart = 'verkaufsobjekt' AND c.code IN ('021','061','062','063','064','065','066','067','071','072','073','830','941','942');

-- Kontrolle: das wird umgeschlüsselt — passt die Liste nicht, ROLLBACK statt COMMIT
SELECT alte_nummer, neuer_code, label FROM abbildung ORDER BY neuer_code;

-- 1) Zielzeilen räumen, damit der Umschlüssel nicht kollidiert
DELETE FROM variant_bkp_kosten k USING abbildung a WHERE k.variant_id = a.variant_id AND k.eigentumsart = a.eigentumsart AND k.position_code = a.neuer_code;

-- 2) Erfasste Werte auf die Katalogposition umhängen (Kostenzeilen führen die Id der eigenen Zeile)
UPDATE variant_bkp_kosten k SET position_code = a.neuer_code FROM abbildung a WHERE k.position_code = a.custom_id::text;

-- 3) Eigene Zeilen löschen
DELETE FROM variant_bkp_custom_position c USING abbildung a WHERE c.id = a.custom_id;

COMMIT;
