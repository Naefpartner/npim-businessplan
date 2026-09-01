-- Planausschnitte des GIS nach Thema ablegen.
--
-- Bisher war ein GIS-Bild nur ein Bild in einer Reihenfolge. Der Bericht kann
-- damit nicht gezielt auf einen Ausschnitt verweisen — etwa auf den Zonenplan
-- bei der Nutzungsberechnung. Mit der Kategorie wird jedes Bild adressierbar;
-- 'weitere' bleibt für alles, was nicht in die Liste passt, und trägt dann
-- seine Beschriftung.
alter table project_gis_screenshots
  add column if not exists kategorie text not null default 'weitere'
    check (kategorie in (
      'amtliche_vermessung', 'zonenplan', 'naturgefahren', 'grundwasser',
      'waermenutzung', 'altlasten', 'denkmalpflege', 'baumschutz', 'isos',
      'weitere'
    )),
  add column if not exists bezeichnung text;

comment on column project_gis_screenshots.kategorie is
  'Thema des Planausschnitts; ''weitere'' für frei beschriftete Bilder.';
comment on column project_gis_screenshots.bezeichnung is
  'Freie Beschriftung — nötig bei ''weitere'', sonst optional als Zusatz.';

-- Je Thema wird im Bericht ein Bild gezeigt; die Reihenfolge entscheidet.
create index if not exists project_gis_screenshots_kategorie_idx
  on project_gis_screenshots (project_id, kategorie, sort_order);
