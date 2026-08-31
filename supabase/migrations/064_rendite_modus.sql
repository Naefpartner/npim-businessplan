-- Gewählte Betrachtung der Renditeobjekte je Variante.
--
-- Die Sektion „Renditeberechnung" kennt zwei Modi: die Renditeberechnung
-- (Erfolgsrechnung mit Brutto- und Nettorendite) und den Residualwert
-- (Ertragswert abzüglich Erstellungskosten = Landwert). Bisher war das eine
-- reine Anzeigeoption; der Bericht konnte deshalb nicht wissen, welche der
-- beiden Sichten gilt. Mit der Spalte wird die Wahl Teil der Variante.
alter table project_variants
  add column if not exists rendite_modus text not null default 'rendite'
    check (rendite_modus in ('rendite', 'residual'));

comment on column project_variants.rendite_modus is
  'Betrachtung der Renditeobjekte: rendite = Renditeberechnung, residual = Residualwert.';
