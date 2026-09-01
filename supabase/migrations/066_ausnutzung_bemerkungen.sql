-- Bemerkungen zur Ausnutzungsberechnung.
--
-- Die Rechnung erklärt sich nicht immer aus den Zahlen: Sonderbauvorschriften,
-- Gestaltungspläne, Absprachen mit der Gemeinde. Der Text steht am Projekt,
-- weil auch die Ausnutzungsparameter dort stehen, und erscheint im Bericht
-- unter dem Kapitel Nutzungsberechnung.
alter table projects
  add column if not exists ausnutzung_bemerkungen text;

comment on column projects.ausnutzung_bemerkungen is
  'Freitext zur Ausnutzungsberechnung; erscheint im Bericht unter der Berechnung.';
