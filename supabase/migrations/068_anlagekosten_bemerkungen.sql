-- Bemerkungen zu den Anlagekosten.
--
-- Die Zahlen sagen, was etwas kostet — nicht, was nicht darin steckt. Genau
-- das braucht der Bericht aber: Abgrenzungen, ausgenommene Leistungen,
-- Annahmen zum Preisstand. Als Freitext, weil sich das nicht in Felder
-- zwingen lässt.
--
-- Pro Variante, weil die Kosten an ihr hängen. Gespeichert wird derselbe enge
-- HTML-Ausschnitt wie bei den Bemerkungen zur Ausnutzung (lib/richText):
-- Absätze, fett, kursiv, unterstrichen und eine Textfarbe aus der CI.
alter table project_variants
  add column if not exists anlagekosten_bemerkungen text;

comment on column project_variants.anlagekosten_bemerkungen is
  'Bemerkungen zu den Anlagekosten als ausgezeichneter Freitext; erscheinen im Bericht.';
