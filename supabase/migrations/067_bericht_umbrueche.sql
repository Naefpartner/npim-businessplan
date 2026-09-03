-- Von Hand gesetzte Seitenumbrüche des Berichts.
--
-- Der Bericht rechnet seinen Umbruch selbst aus, weil der Inhaltsfluss am
-- Seitenfuss keinen Platz für die Fusszeile reserviert. Die Rechnung füllt die
-- Seiten so weit wie möglich — was fachlich zusammengehört, kann dabei
-- auseinanderfallen. Wie viel Platz ein Projekt braucht, weiss nur, wer es
-- vor sich hat: die eine Variante hat zwei Parzellen, die nächste vierzehn.
--
-- Hier stehen deshalb die Bausteine, vor denen in jedem Fall eine neue Seite
-- beginnt — als JSONB-Array ihrer Schlüssel, wie sie components/bericht
-- vergibt. Pro Variante, weil sie an deren Mengen hängen.
alter table project_variants
  add column if not exists bericht_umbrueche jsonb not null default '[]'::jsonb;

comment on column project_variants.bericht_umbrueche is
  'Schlüssel der Bausteine, vor denen der Bericht eine neue Seite beginnt.';
