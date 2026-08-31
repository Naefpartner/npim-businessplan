import { Document, Page, View, Text, Image, StyleSheet, Svg, Path, Circle } from '@react-pdf/renderer'
import {
  SEITE, RAND, TITELBLATT, LOGO, INHALT, SCHRIFT, BERICHT_FARBE,
  FUSSZEILE_FIRMA, FUSSZEILE_TITEL, FUSSZEILE_LINKS, fussBreite,
  kapitelFuer, type BerichtKapitel, type SeitenFormat, type AuftragAnrede,
} from '@/lib/bericht'
import { mm, schriftRegistrieren, datumCh, assetPfad } from '@/lib/berichtPdf'
import { formatNumber } from '@/lib/utils'
import { CHART_PALETTE } from '@/lib/ci'

/** Alles, was der Bericht über Projekt und Variante wissen muss. */
export interface BerichtDaten {
  projektName: string
  /** Erste Titelzeile: Ortschaft, Projektname — ohne Postleitzahl. */
  titelZeile: string
  /** Objektbezug in der Fusszeile. */
  adresse: string | null
  dokumentBezeichnung: string
  untertitel: string | null
  /** Beschriftung des ersten Blocks — je nach Kundschaft. */
  auftragAnrede: AuftragAnrede
  /** Zeilen des Auftraggeber-Blocks: Name, Strasse + Nr., PLZ und Ort. */
  auftraggeberin: string[]
  datum: Date
  /** Öffentliche URL des Projektbilds für die Titelfläche. */
  titelbildUrl: string | null
  /** Kapitelschlüssel in Druckreihenfolge. */
  kapitel: string[]
  /** Inhalt der Projektübersicht; fehlt, solange die Daten laden. */
  uebersicht?: UebersichtDaten
}

/** Eine Zeile einer Feldtabelle: Bezeichnung links, Wert rechts. */
export interface Feld {
  label: string
  wert: string
  /**
   * Einheit in einer eigenen Spalte vor dem Wert. Trägt ein Feld der Tabelle
   * eine, bekommt die ganze Tabelle die Spalte — die Einheiten stehen dann
   * untereinander und die Zahlen rechtsbündig am Spaltenrand.
   */
  einheit?: string
}

/** Eine Zeile der Grundstücks- bzw. Bestandstabelle. */
export interface TabellenZeile {
  zellen: string[]
  /** Hervorgehobene Summenzeile. */
  total?: boolean
}

/** Eine Betragszeile mit Netto und Brutto (Anlagekosten je Hauptgruppe). */
export interface BetragZeile {
  code: string
  label: string
  netto: number
  brutto: number
  total?: boolean
}

/**
 * Die Projektübersicht. Bewusst als Daten statt als Layout — so lässt sich der
 * Inhalt verschieben, ohne das PDF anzufassen.
 */
export interface UebersichtDaten {
  /** GIS-Ausschnitt als Situationsplan; fehlt, wenn keiner hinterlegt ist. */
  situationsplanUrl: string | null
  auftrag: Feld[]
  /** Grundstücke: Nummer, Gemeinde, Zone, Fläche. */
  grundstuecke: { kopf: string[]; zeilen: TabellenZeile[] }
  /** Bestandsgebäude: Bezeichnung, Baujahr, Nutzung, GF, Volumen, Zustand. */
  bestand: { kopf: string[]; zeilen: TabellenZeile[] }
  mengen: Feld[]
  /** Anlagekosten je BKP-Hauptgruppe 0–9, inklusive Grundstück, samt Total. */
  kosten: BetragZeile[]
  /**
   * Je Eigentumsart eine Zeile: links die Wirtschaftlichkeit, rechts die
   * Erträge. Getrennt gesetzt liessen sich die beiden nicht nebeneinander
   * halten, sobald mehrere Eigentumsarten vorkommen.
   */
  bloecke: EigentumsartBlock[]
  /**
   * Nutzungs- und Wohnungsmix. Bei einer Eigentumsart ein Block über alles,
   * bei mehreren einer je Nutzungsart — dann auf einer eigenen Seite.
   */
  mix: Nutzungsmix[]
}

/** Wirtschaftlichkeit und Erträge einer Eigentumsart. */
export interface EigentumsartBlock {
  /**
   * Obertitel über beiden Spalten — nur gesetzt, wenn mehrere Eigentumsarten
   * vorkommen. Bei einer einzigen sagte er nichts, was nicht schon dasteht.
   */
  titel?: string
  /**
   * Farbe des Obertitels — dieselbe wie in den Berechnungssektionen. Fehlt,
   * wenn nur eine Eigentumsart vorkommt: dann bleibt es beim Kupfer der
   * übrigen Blöcke.
   */
  farbe?: string
  /** Hellere Stufe derselben Farbfamilie für die beiden Untertitel. */
  farbeUnter?: string
  wirtschaft: { titel: string; felder: Feld[] } | null
  ertraege: { titel: string; kopf: string[]; zeilen: TabellenZeile[] } | null
}

/**
 * Grundlage der Mixdarstellung. Die Nutzungen stehen in einer gemeinsamen
 * Liste, damit beide Ringe dieselbe Reihenfolge und dieselben Farben
 * verwenden — sonst wäre ein Vergleich zwischen ihnen wertlos.
 */
export interface Nutzungsmix {
  titel: string
  /** Farben der Nutzungsart; fehlen, wenn nur eine vorkommt. */
  farbe?: string
  farbeUnter?: string
  /** Abstufungen für die Ringsegmente; ohne Angabe die allgemeine Palette. */
  segmentFarben?: string[]
  flaechenTitel: string
  ertraegeTitel: string
  nutzungen: { label: string; flaeche: number; ertrag: number }[]
  wohnungsmix: { label: string; anzahl: number }[]
}

const T = TITELBLATT

/**
 * Innenabstände einer Tabellenzeile in Millimeter — für Feld- und
 * Datentabellen dieselben, damit ihre Linien in nebeneinanderstehenden
 * Spalten auf gleicher Höhe liegen.
 */
const ZEILE = { oben: 1.2, unten: 0.9 } as const

/**
 * Seitlicher Einzug des Textes in Millimetern, gemessen am Kupferbalken der
 * Vorlage. Balken und Tabellenzeilen teilen ihn sich, damit die erste Spalte
 * unter dem Titel steht und nicht davor.
 */
// Nur links: rechts sollen die Zahlen bündig am Spaltenrand abschliessen.
const EINZUG = 2.3

const s = StyleSheet.create({
  /**
   * Der Zeilenabstand gehört auf die Seite. Auf View oder Text wirkt er in
   * react-pdf doppelt (n × 2 × Schriftgrad statt n × Schriftgrad) — nur über
   * die Seite ergibt 12/9 auch wirklich 12 pt.
   */
  seite: {
    fontFamily: SCHRIFT.familie,
    fontSize: SCHRIFT.grund,
    lineHeight: SCHRIFT.zeile / SCHRIFT.grund,
    color: BERICHT_FARBE.text,
    backgroundColor: '#FFFFFF',
  },
  // Der untere Rand endet auf der Fusszeile; den Abstand bis zum Satzspiegel
  // hält der Inhaltsfluss darüber.
  inhaltsSeite: {
    paddingTop: mm(RAND.oben),
    paddingBottom: mm(RAND.fuss),
    paddingLeft: mm(RAND.links),
    paddingRight: mm(RAND.rechts),
  },
  /** Nimmt den Inhalt auf und schiebt die Fusszeile an den Seitenfuss. */
  inhaltsFluss: { flexGrow: 1, paddingBottom: mm(RAND.unten - RAND.fuss) },

  // ── Titelblatt ────────────────────────────────────────────────────────────
  flaeche: {
    position: 'absolute',
    left: mm(T.flaeche.links),
    top: mm(T.flaeche.oben),
    width: mm(T.flaeche.breite),
    height: mm(T.flaeche.hoehe),
    backgroundColor: BERICHT_FARBE.primaer,
    overflow: 'hidden',
  },
  flaechenBild: { width: '100%', height: '100%', objectFit: 'cover' },
  /**
   * Die Vorlage spart oben links eine Ecke aus der Fläche aus. Nachgebildet
   * durch ein weisses Rechteck darüber — auf weissem Grund optisch identisch
   * zum Pfad der Vorlage und deutlich einfacher als ein Clipping.
   *
   * Links und oben ragt es über die Kante hinaus, damit keine Pixelzeile der
   * kantengeglätteten Fläche stehen bleibt; die Innenkanten bleiben exakt.
   */
  logoEcke: {
    position: 'absolute',
    left: mm(T.flaeche.links - T.ueberstand),
    top: mm(T.flaeche.oben - T.ueberstand),
    width: mm(T.logoEcke.breite + T.ueberstand),
    height: mm(T.logoEcke.hoehe + T.ueberstand),
    backgroundColor: '#FFFFFF',
  },
  wortmarke: {
    position: 'absolute',
    left: mm(LOGO.titel.links),
    top: mm(LOGO.titel.oben),
    width: mm(LOGO.titel.breite),
    // Keine Höhe: sie folgt dem Seitenverhältnis der Datei, sonst verzieht
    // sich der Schriftzug.
  },
  /**
   * Weisser Kasten unten links, der zugleich den Titel trägt: seine Breite
   * ergibt sich aus dem Text plus Überhang, er wächst also mit dem Titel.
   * Ohne `width` schrumpft ein absolut positioniertes Element auf den Inhalt.
   *
   * Links mit demselben Überstand wie die Logo-Ecke, aus demselben Grund.
   * Die Innenabstände setzen den Text auf den Satzspiegel (30 mm) und auf die
   * Höhe der Vorlage (141.5 mm).
   */
  titelKasten: {
    position: 'absolute',
    left: mm(T.titelKasten.links - T.ueberstand),
    top: mm(T.titelKasten.oben),
    maxWidth: mm(T.flaeche.links + T.flaeche.breite - T.titelKasten.links + T.ueberstand),
    paddingLeft: mm(T.titel.links - T.titelKasten.links + T.ueberstand),
    paddingRight: mm(T.titelKasten.ueberhangRechts),
    paddingTop: mm(T.titel.oben - T.titelKasten.oben),
    // Bis unter die Kupferfläche, damit die Aussparung sauber durchschneidet.
    paddingBottom: mm(T.ueberstand),
    backgroundColor: '#FFFFFF',
  },
  titelZeile: {
    fontSize: SCHRIFT.titel,
    lineHeight: SCHRIFT.titelZeile / SCHRIFT.titel,
  },
  titelFett: { fontWeight: 700 },

  // Angabentabelle: Trennlinien über die Blockbreite, Label fett.
  angaben: {
    position: 'absolute',
    left: mm(T.angaben.links),
    top: mm(T.angaben.ersteLinie),
    width: mm(T.angaben.rechts - T.angaben.links),
  },
  angabenLinie: { borderTopWidth: 0.5, borderTopColor: BERICHT_FARBE.linie },
  angabenZeile: {
    flexDirection: 'row',
    paddingTop: mm(T.angaben.textNachLinie),
    paddingBottom: mm(T.angaben.textVorLinie),
  },
  angabenLabel: { width: mm(T.angaben.wertLinks - T.angaben.links), fontWeight: 700 },
  angabenWert: { flex: 1 },

  // ── Fusszeilen ────────────────────────────────────────────────────────────
  /**
   * Fusszeile der Inhaltsseiten. Bewusst im Fluss statt absolut positioniert:
   * ein `fixed`-Element mit position:absolute verschwindet, sobald die Seite
   * einen lineHeight trägt. Der negative linke Rand holt sie auf die Kante der
   * Titelfläche (17.5 mm) statt auf den Satzspiegel (30 mm).
   */
  fuss: {
    marginLeft: mm(FUSSZEILE_LINKS - RAND.links),
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: SCHRIFT.klein,
  },
  /** Fusszeile des Titelblatts — dort ohne Satzspiegel, deshalb absolut. */
  fussTitel: {
    position: 'absolute',
    left: mm(FUSSZEILE_LINKS),
    width: mm(fussBreite('a4')),
    bottom: mm(RAND.fuss),
    fontSize: SCHRIFT.klein,
  },

  // ── Inhaltsseiten ─────────────────────────────────────────────────────────
  bildmarke: {
    position: 'absolute',
    right: mm(LOGO.folge.rechts),
    top: mm(LOGO.folge.oben),
    width: mm(LOGO.folge.breite),
    height: mm(LOGO.folge.hoehe),
  },
  h1: {
    fontSize: SCHRIFT.h1,
    lineHeight: SCHRIFT.h1Zeile / SCHRIFT.h1,
    fontWeight: 700,
    marginBottom: mm(INHALT.nachTitel),
  },

  // ── Kapitel und Feldtabellen ──────────────────────────────────────────────
  /**
   * Blocktitel auf dem Kupferbalken der Vorlage. Dort trägt ihn die Kopfzeile
   * der Tabelle; im Bericht steht der Titel über der Tabelle, bekommt aber
   * dieselbe Fläche — gemessen an der Vorlage: Kupfer 7, Text 2.3 mm
   * eingerückt.
   */
  h2: {
    fontSize: SCHRIFT.h2,
    lineHeight: SCHRIFT.h2Zeile / SCHRIFT.h2,
    fontWeight: 700,
    backgroundColor: BERICHT_FARBE.primaer,
    paddingLeft: mm(EINZUG),
    paddingRight: mm(EINZUG),
    paddingTop: mm(0.9),
    paddingBottom: mm(0.7),
    marginTop: mm(6.3),
    marginBottom: mm(1.4),
  },
  /**
   * Feldtabelle im Stil des Titelblatts: dünne Linien, Label links.
   *
   * `flexShrink: 0` ist hier wesentlich: der Inhaltsfluss der Seite hat eine
   * feste Höhe, und sobald der Inhalt darüber hinausgeht, staucht Yoga die
   * Blöcke — aber nur die, die Spielraum haben. Dann laufen die Zeilenraster
   * benachbarter Spalten auseinander. Ohne Schrumpfen bleibt das Raster
   * überall gleich; passt der Inhalt nicht, bricht die Seite stattdessen um.
   */
  feldBlock: { marginBottom: mm(2), flexShrink: 0 },
  /** Trennlinie zwischen zwei Feldzeilen — so hell wie in den Datentabellen. */
  feldLinie: { borderTopWidth: 0.5, borderTopColor: '#D8D8D8' },
  feldZeile: {
    flexDirection: 'row',
    paddingTop: mm(ZEILE.oben),
    paddingBottom: mm(ZEILE.unten),
    paddingLeft: mm(EINZUG),
  },
  // Abstand nach rechts, damit Bezeichnung, Einheit und Zahl in schmalen
  // Spalten nicht aneinanderstossen.
  feldLabel: { width: mm(52), paddingRight: mm(1.5) },
  feldEinheit: { width: mm(9), paddingRight: mm(1.5) },
  feldZahl: { flex: 1, textAlign: 'right' },
  // Werte stehen wie die Bezeichnungen in normaler Schrift — fett bleibt den
  // Totalzeilen vorbehalten, damit sie sich abheben.
  feldWert: { flex: 1 },
  hinweis: { marginTop: mm(4), fontSize: SCHRIFT.klein, color: '#6B6B6B' },

  // ── Situationsplan ────────────────────────────────────────────────────────
  /**
   * Rahmen des Situationsplans: wächst über flexGrow auf die Resthöhe der
   * Zeile, bringt aber selbst keine Höhe mit.
   */
  planRahmen: { flexGrow: 1, position: 'relative' },
  /**
   * Das Bild liegt absolut im Rahmen und bleibt damit aus dem Fluss — sonst
   * bestimmte seine natürliche Höhe die Zeilenhöhe, sobald sie grösser ist als
   * die Auftragstabelle (flexGrow wächst nur, es schrumpft nicht). So endet
   * der Plan immer auf der untersten Tabellenlinie, egal welches Format der
   * GIS-Ausschnitt hat. `cover` beschneidet aus der Mitte, statt zu verzerren.
   */
  plan: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  zweiSpalten: { flexDirection: 'row', flexShrink: 0 },
  /** Dreiteilung für den Mix je Nutzungsart — gleiche Anteile, gleicher Abstand. */
  dreiSpalten: { flexDirection: 'row', flexShrink: 0 },
  /**
   * Nicht gedrittelt, sondern nach Bedarf: die Ringlegenden tragen
   * Bezeichnung, Betrag und Anteil, der Wohnungsmix nur Bezeichnung, Balken
   * und Zahl — er kommt mit weniger aus.
   */
  drittel: { flexGrow: 1.15, flexShrink: 1, flexBasis: '0%', marginRight: mm(6) },
  drittelLetzte: { flexGrow: 0.9, flexShrink: 1, flexBasis: '0%' },
  /**
   * Die Spaltenteilung der Übersicht: links etwas schmaler, rechts breiter.
   * Alle geteilten Zeilen nutzen dieselben Werte, damit die Spaltenkanten
   * über die Zeilen hinweg auf einer Flucht stehen.
   */
  /**
   * Grundbreite null, damit die Spalten sich die Breite nach ihrem Anteil
   * teilen und nicht nach dem, was gerade in ihnen steht. Das allein genügt
   * allerdings nicht — die Innenabstände zählen weiterhin mit, siehe
   * `tabZeile`.
   */
  spalteEins: { flexGrow: 0.85, flexShrink: 1, flexBasis: '0%', marginRight: mm(6) },
  spalteZwei: { flexGrow: 1.3, flexShrink: 1, flexBasis: '0%' },
  legende: { fontSize: SCHRIFT.klein, color: '#6B6B6B', marginTop: mm(1.5), marginBottom: mm(2), flexShrink: 0 },

  // ── Ringdiagramme und Mixbalken ───────────────────────────────────────────
  ringBlock: { flexShrink: 0, marginBottom: mm(2) },
  /**
   * Titel, der unter einem anderen steht: knapperer Vorabstand als der volle
   * Blockabstand, aber nicht null — sonst klebt er am Balken darüber.
   */
  h2Anschluss: { marginTop: mm(2.5) },
  /**
   * Untertitel im Mixbereich: weder Kupferfläche noch Linie. Der Balken bleibt
   * dem Bereichstitel darüber vorbehalten, sonst wögen die Beschriftungen
   * schwerer als die Diagramme, zu denen sie gehören. Der seitliche Einzug
   * bleibt, damit sie auf der Flucht der Legenden- und Balkenzeilen stehen.
   */
  h2Schlicht: {
    backgroundColor: 'transparent',
    paddingTop: 0,
  },
  /**
   * Der Ring steht über der Legende, nicht daneben: in der schmaleren der
   * beiden Spalten bliebe sonst zu wenig Breite für Bezeichnung, Wert und
   * Anteil, und die Zellen liefen ineinander.
   */
  /**
   * Der Ring steht mittig in seiner Spalte; der seitliche Einzug gilt nur für
   * den Text darunter, an dem sich die Legende ausrichtet.
   */
  ringFlaeche: { marginTop: mm(2.5), marginBottom: mm(2.5), alignItems: 'center' },
  legendeZeile: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: mm(0.8),
    paddingLeft: mm(EINZUG),
  },
  legendeMarke: { width: mm(2.2), height: mm(2.2), marginRight: mm(1.8), borderRadius: mm(1.1) },
  legendeLabel: { flex: 1, paddingRight: mm(2) },
  legendeWert: { textAlign: 'right', paddingRight: mm(3) },
  /**
   * Der Anteil steht kleiner als der Wert — er ergänzt ihn, statt mit ihm zu
   * konkurrieren.
   *
   * Der Vorabstand bringt ihn auf dieselbe Grundlinie. `alignItems` hilft hier
   * nicht: die Textboxen füllen die Zeilenhöhe ohnehin aus, und innerhalb
   * ihrer Box sitzt die kleinere Schrift höher.
   *
   * Der Wert ist eingemessen und nicht gerechnet: der Abstand wächst die
   * Zeile mit, sodass gut die Hälfte davon wieder verlorengeht. Bei 0.7 mm
   * stehen Wert und Anteil auf 0.00 mm genau auf derselben Unterkante.
   */
  legendeAnteil: {
    width: mm(11.5),
    textAlign: 'right',
    color: '#6B6B6B',
    fontSize: SCHRIFT.klein,
    paddingTop: mm(0.7),
  },

  mixZeile: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: mm(1.2),
    paddingLeft: mm(EINZUG),
  },
  mixLabel: { width: mm(16) },
  /** Spur des Balkens; der Balken selbst liegt als Anteil darin. */
  mixSpur: { flex: 1, height: mm(2.6), backgroundColor: '#EFEBE8' },
  mixLeer: { flex: 1 },
  mixBalken: { height: '100%', backgroundColor: BERICHT_FARBE.primaer },
  mixWert: { width: mm(10), textAlign: 'right' },

  // ── Datentabellen ─────────────────────────────────────────────────────────
  tabKopf: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: BERICHT_FARBE.linie,
    paddingBottom: mm(0.9),
    paddingLeft: mm(EINZUG),
    fontSize: SCHRIFT.klein,
    color: '#4A4A4A',
  },
  /**
   * Geometrie einer Datenzeile ohne Linie. In der Doppeltabelle bekommt sie
   * auch die leere Gegenspalte: fehlen dort die Innenabstände, wird die Spalte
   * schmaler und die Nachbarspalte rückt seitlich weg.
   */
  tabZeile: {
    flexDirection: 'row',
    paddingTop: mm(ZEILE.oben),
    paddingBottom: mm(ZEILE.unten),
    paddingLeft: mm(EINZUG),
  },
  /** Trennlinie einer Datenzeile — nur dort, wo die Tabelle noch Zeilen hat. */
  tabLinie: { borderBottomWidth: 0.5, borderBottomColor: '#D8D8D8' },
  /** Die Totalzeile hebt sich über die Schrift ab, nicht über eine kräftigere
   *  Linie — ihre Trennlinie ist dieselbe wie bei jeder anderen Zeile. */
  tabTotal: { fontWeight: 700 },
  zelleRechts: { textAlign: 'right' },

  // Verzeichniszeile: Nummer, Text, Seitenzahl — jede mit Linie darunter.
  tocZeile: { flexDirection: 'row', alignItems: 'baseline' },
  tocLinie: { borderBottomWidth: 0.5, borderBottomColor: BERICHT_FARBE.linie },
  tocSeite: { textAlign: 'right' },
})

/**
 * Fusszeile der Inhaltsseiten — Dokumentbezug links, Seitenzahl rechts.
 *
 * Die Seitenzahl kommt aus dem Seitenplan und nicht aus dem `render`-Callback
 * von react-pdf: solange die Seite ein `lineHeight` trägt, liefert dieser
 * nichts (dieselbe Wurzel wie das Verschwinden absolut gesetzter
 * `fixed`-Elemente). Und ohne `lineHeight` auf der Seite stimmt der
 * Zeilenabstand nicht mehr — dort wirkt er doppelt.
 */
function Fusszeile({
  daten, format, seite, seitenTotal,
}: { daten: BerichtDaten; format: SeitenFormat; seite: number; seitenTotal: number }) {
  const links = [FUSSZEILE_FIRMA, daten.adresse, daten.dokumentBezeichnung]
    .filter(Boolean).join('  |  ')
  return (
    <View style={[s.fuss, { width: mm(fussBreite(format)) }]} fixed>
      <Text>{links}</Text>
      <Text>{seite} / {seitenTotal}</Text>
    </View>
  )
}

/** Bildmarke oben rechts auf den Inhaltsseiten. */
function Kopfmarke() {
  return (
    <View style={s.bildmarke} fixed>
      <Image src={assetPfad('/naef-bildmarke.png')} />
    </View>
  )
}

/**
 * Titelblatt nach Vorlage: kupferne Fläche mit dem Projektbild, oben links die
 * Ecke für die Wortmarke ausgespart, unten links der weisse Titelkasten.
 * Darunter die Angaben in einer Tabelle mit Trennlinien.
 */
function Titelblatt({ daten }: { daten: BerichtDaten }) {
  const bloecke: { label: string; zeilen: string[] }[] = [
    { label: daten.auftragAnrede, zeilen: daten.auftraggeberin },
    { label: 'Beauftragte', zeilen: ['Naef & Partner Immobilien AG', 'Bleicherweg 10', '8002 Zürich'] },
    {
      label: 'Datum',
      zeilen: [datumCh(daten.datum), daten.untertitel].filter((z): z is string => !!z),
    },
  ]

  return (
    <Page size={SEITE.a4.size} orientation="portrait" style={s.seite}>
      <View style={s.flaeche}>
        {daten.titelbildUrl && <Image src={daten.titelbildUrl} style={s.flaechenBild} />}
      </View>
      <View style={s.logoEcke} />
      <Image src={assetPfad('/naef-wortmarke.jpg')} style={s.wortmarke} />
      <View style={s.titelKasten}>
        <Text style={s.titelZeile}>{daten.titelZeile}</Text>
        <Text style={[s.titelZeile, s.titelFett]}>{daten.dokumentBezeichnung}</Text>
      </View>

      <View style={s.angaben}>
        {bloecke.map((b) => (
          <View key={b.label} style={s.angabenLinie}>
            <View style={s.angabenZeile}>
              <Text style={s.angabenLabel}>{b.label}</Text>
              <View style={s.angabenWert}>
                {b.zeilen.map((z, i) => <Text key={i}>{z}</Text>)}
              </View>
            </View>
          </View>
        ))}
        {/* Abschliessende Linie unter dem letzten Block. */}
        <View style={s.angabenLinie} />
      </View>

      <View style={s.fussTitel}>
        <Text>{FUSSZEILE_TITEL}</Text>
      </View>
    </Page>
  )
}

/** Eine Zeile des Inhaltsverzeichnisses samt Trennlinie darunter. */
function InhaltZeile({
  nummer, label, seite, ebene,
}: {
  nummer: string
  label: string
  seite: string
  ebene: 1 | 2
}) {
  const sp = ebene === 1 ? INHALT.ebene1 : INHALT.ebene2
  return (
    <View
      style={[
        s.tocLinie,
        {
          marginLeft: mm(sp.linieLinks - RAND.links),
          marginTop: mm(ebene === 1 ? INHALT.vorEbene1 : 0),
        },
      ]}
    >
      <View style={[s.tocZeile, { paddingBottom: mm(INHALT.linieUnterText - 4.1) }]}>
        <Text style={{
          width: mm(sp.text - sp.nummer),
          marginLeft: mm(sp.nummer - sp.linieLinks),
          fontWeight: ebene === 1 ? 700 : 400,
        }}>
          {nummer}
        </Text>
        <Text style={{ flex: 1, fontWeight: ebene === 1 ? 700 : 400 }}>{label}</Text>
        <Text style={[s.tocSeite, { fontWeight: ebene === 1 ? 700 : 400 }]}>{seite}</Text>
      </View>
    </View>
  )
}

/**
 * Eine Inhaltsseite im gewünschten Format — mit Bildmarke, Satzspiegel und
 * Fusszeile. Alle Fachkapitel bauen darauf auf, damit Ränder und Fusszeile
 * über Formate hinweg gleich sitzen.
 */
export function InhaltsSeite({
  format = 'a4', daten, seite, seitenTotal, children,
}: {
  format?: SeitenFormat
  daten: BerichtDaten
  /** Nummer dieser Seite im Bericht — siehe `seitenPlan`. */
  seite: number
  seitenTotal: number
  children: React.ReactNode
}) {
  const f = SEITE[format]
  return (
    <Page size={f.size} orientation={f.quer ? 'landscape' : 'portrait'} style={[s.seite, s.inhaltsSeite]}>
      <Kopfmarke />
      <View style={s.inhaltsFluss}>{children}</View>
      <Fusszeile daten={daten} format={format} seite={seite} seitenTotal={seitenTotal} />
    </Page>
  )
}

/**
 * Seiten eines Fachkapitels. Der Umbruch wird gesetzt und nicht dem Fluss
 * überlassen, weil der am Seitenfuss keinen Platz für die Fusszeile reserviert.
 *
 * Die Projektübersicht braucht eine dritte Seite, sobald mehrere
 * Eigentumsarten vorkommen: dann steht der Mix je Nutzungsart getrennt und
 * passt nicht mehr unter die Erträge.
 */
function kapitelSeiten(key: string, daten: BerichtDaten): number {
  if (key !== 'projektuebersicht') return 1
  return (daten.uebersicht?.mix.length ?? 0) > 1 ? 3 : 2
}

interface SeitenplanEintrag { kapitel: BerichtKapitel; seite: number }
type Seitenplan = SeitenplanEintrag[]

/**
 * Erste Seite jedes Fachkapitels. Titelblatt ist Seite 1, das
 * Inhaltsverzeichnis Seite 2 — die Fachkapitel folgen ab 3.
 */
function seitenPlan(kapitel: BerichtKapitel[], daten: BerichtDaten): Seitenplan {
  const plan: Seitenplan = []
  let seite = 3
  for (const k of kapitel) {
    plan.push({ kapitel: k, seite })
    seite += kapitelSeiten(k.key, daten)
  }
  return plan
}

/** Gesamtzahl der Seiten des Berichts. */
function seitenTotalVon(plan: Seitenplan, daten: BerichtDaten): number {
  const letzte = plan[plan.length - 1]
  return letzte ? letzte.seite + kapitelSeiten(letzte.kapitel.key, daten) - 1 : 2
}

/**
 * Inhaltsverzeichnis nach Vorlage: Überschrift „Inhalt", darunter je Kapitel
 * eine Zeile aus Nummer, Titel und Seitenzahl, jeweils mit Trennlinie.
 */
function Inhaltsverzeichnis({
  plan, daten, seitenTotal,
}: { plan: Seitenplan; daten: BerichtDaten; seitenTotal: number }) {
  return (
    <InhaltsSeite daten={daten} seite={2} seitenTotal={seitenTotal}>
      <Text style={s.h1}>{INHALT.titel}</Text>
      {plan.map((e, i) => (
        <InhaltZeile
          key={e.kapitel.key}
          nummer={String(i + 1)}
          label={e.kapitel.label}
          seite={String(e.seite)}
          ebene={1}
        />
      ))}
    </InhaltsSeite>
  )
}

/** Beschreibung einer Datentabelle. */
interface Tabelle {
  titel?: string
  /** Abweichende Farbe des Titelbalkens (Eigentumsart). */
  titelFarbe?: string
  /** Der Titel steht unter einem Obertitel und hält knapperen Vorabstand. */
  anschluss?: boolean
  kopf: string[]
  zeilen: TabellenZeile[]
  /** Spaltenanteile; ohne Angabe erste Spalte doppelt so breit. */
  breiten?: number[]
  /** Bis zu dieser Spalte linksbündig, danach rechtsbündig (Zahlenspalten). */
  linksBis?: number
}

/**
 * Stil einer Tabellenzelle. Der Abstand nach rechts verhindert, dass
 * rechtsbündige Werte an die Nachbarspalte stossen; die letzte Spalte
 * schliesst bündig ab.
 */
function zellenStil(t: Tabelle, i: number) {
  const anteile = t.breiten ?? t.kopf.map((_, k) => (k === 0 ? 2 : 1))
  // Grundbreite null: die Spaltenanteile sollen die Breite bestimmen, nicht
  // die Länge des Zellinhalts.
  return {
    flexGrow: anteile[i] ?? 1,
    flexShrink: 1,
    flexBasis: 0,
    ...(i > (t.linksBis ?? 0) ? { textAlign: 'right' as const } : {}),
    ...(i < t.kopf.length - 1 ? { paddingRight: mm(3) } : {}),
  }
}

/** Die Zellen einer Zeile; der Rahmen kommt vom umschliessenden Element. */
function Zellen({ t, werte }: { t: Tabelle; werte: string[] }) {
  return <>{werte.map((c, i) => <Text key={i} style={zellenStil(t, i)}>{c}</Text>)}</>
}

function Kopfzeile({ t }: { t: Tabelle }) {
  return <View style={s.tabKopf}><Zellen t={t} werte={t.kopf} /></View>
}

function Datenzeile({ t, zeile }: { t: Tabelle; zeile: TabellenZeile }) {
  return (
    <View style={[s.tabZeile, s.tabLinie, ...(zeile.total ? [s.tabTotal] : [])]}>
      <Zellen t={t} werte={zeile.zellen} />
    </View>
  )
}

/** Einzelne Datentabelle mit Kopfzeile. */
function Datentabelle({
  titel, titelFarbe, anschluss, kopf, zeilen, breiten, linksBis = 0,
}: Tabelle) {
  if (zeilen.length === 0) return null
  const t: Tabelle = { kopf, zeilen, breiten, linksBis }
  return (
    <View style={s.feldBlock}>
      {titel && <Text style={titelStil(titelFarbe, anschluss)}>{titel}</Text>}
      <Kopfzeile t={t} />
      {zeilen.map((z, r) => <Datenzeile key={r} t={t} zeile={z} />)}
    </View>
  )
}

/**
 * Zwei Tabellen nebeneinander, Zeile für Zeile gemeinsam gesetzt.
 *
 * Getrennt gesetzt liefen die Trennlinien auseinander, sobald eine Zelle
 * umbricht und ihre Zeile höher wird. Hier teilen sich beide Tabellen dieselbe
 * Zeile, deren Höhe sich nach der höheren Seite richtet — die Linien liegen
 * damit zwangsläufig auf einer Höhe. Die kürzere Tabelle endet einfach früher.
 */
function Doppeltabelle({ links, rechts }: { links: Tabelle; rechts: Tabelle }) {
  const zeilen = Math.max(links.zeilen.length, rechts.zeilen.length)
  if (zeilen === 0) return null
  return (
    <View style={s.feldBlock}>
      <View style={s.zweiSpalten}>
        <View style={s.spalteEins}>{links.titel && <Text style={s.h2}>{links.titel}</Text>}</View>
        <View style={s.spalteZwei}>{rechts.titel && <Text style={s.h2}>{rechts.titel}</Text>}</View>
      </View>
      {/* Rahmen und Innenabstände sitzen auf der Spalte, nicht auf einer
          inneren Zeile — nur so reicht die Trennlinie bis zur Unterkante der
          gemeinsamen Zeile, auch wenn die Gegenseite höher ist. */}
      <View style={s.zweiSpalten}>
        <View style={[s.spalteEins, s.tabKopf]}><Zellen t={links} werte={links.kopf} /></View>
        <View style={[s.spalteZwei, s.tabKopf]}><Zellen t={rechts} werte={rechts.kopf} /></View>
      </View>
      {Array.from({ length: zeilen }, (_, r) => {
        const l = links.zeilen[r]
        const re = rechts.zeilen[r]
        return (
          <View key={r} style={s.zweiSpalten}>
            {/* Die Innenabstände trägt jede Spalte, auch die leere — sonst
                verschiebt sich die Nachbarspalte, sobald eine Tabelle endet.
                Nur Linie und Totalauszeichnung hängen am Inhalt. */}
            <View style={[s.spalteEins, s.tabZeile,
                          ...(l ? [s.tabLinie] : []), ...(l?.total ? [s.tabTotal] : [])]}>
              {l && <Zellen t={links} werte={l.zellen} />}
            </View>
            <View style={[s.spalteZwei, s.tabZeile,
                          ...(re ? [s.tabLinie] : []), ...(re?.total ? [s.tabTotal] : [])]}>
              {re && <Zellen t={rechts} werte={re.zellen} />}
            </View>
          </View>
        )
      })}
    </View>
  )
}

/**
 * Kostenzeilen für die Tabelle: Beträge gerundet, dazu der Anteil an den
 * Gesamtanlagekosten. Bezug ist die Totalzeile — sie steht damit auf 100 %.
 */
function kostenZeilen(kosten: BetragZeile[]): TabellenZeile[] {
  const total = kosten.find((k) => k.total)?.brutto ?? 0
  return kosten.map((k) => ({
    zellen: [
      k.code,
      k.label,
      formatNumber(Math.round(k.netto)),
      formatNumber(Math.round(k.brutto)),
      total > 0 ? `${((k.brutto / total) * 100).toFixed(1)}` : '—',
    ],
    total: k.total,
  }))
}

/** Stil eines Blocktitels: Farbe der Eigentumsart, Vorabstand nach Kontext. */
function titelStil(farbe?: string, anschluss?: boolean) {
  return [
    s.h2,
    ...(farbe ? [{ backgroundColor: farbe }] : []),
    ...(anschluss ? [s.h2Anschluss] : []),
  ]
}

/** Tabelle aus Bezeichnung und Wert, durch dünne Linien getrennt. */
function Feldtabelle({
  titel, titelFarbe, anschluss, felder, labelBreite, einheitBreite, kopf,
  abstandUnten = true,
}: {
  titel: string
  /** Abweichende Farbe des Titelbalkens (Eigentumsart). */
  titelFarbe?: string
  /** Der Titel steht unter einem Obertitel und hält knapperen Vorabstand. */
  anschluss?: boolean
  felder: Feld[]
  /** Breite der Bezeichnungsspalte in mm; schmaler in geteilten Spalten. */
  labelBreite?: number
  /** Breite der Einheitenspalte in mm; je nach längster Einheit. */
  einheitBreite?: number
  /**
   * Beschriftung der Bezeichnungsspalte, wie sie die Datentabellen tragen.
   * Sie bringt die Linie schon mit — die erste Feldzeile lässt ihre eigene
   * deshalb weg, sonst stünden zwei übereinander.
   */
  kopf?: string
  /**
   * Abstand nach der letzten Linie. In der geteilten Zeile abzuschalten:
   * er zählt sonst zur Spaltenhöhe, und der Situationsplan daneben ragt um
   * denselben Betrag über die unterste Tabellenlinie hinaus.
   */
  abstandUnten?: boolean
}) {
  if (felder.length === 0) return null
  const mitEinheit = felder.some((f) => f.einheit)
  return (
    <View style={abstandUnten ? s.feldBlock : undefined}>
      <Text style={titelStil(titelFarbe, anschluss)}>{titel}</Text>
      {kopf && <View style={s.tabKopf}><Text>{kopf}</Text></View>}
      {felder.map((f, i) => (
        <View key={f.label} style={i === 0 ? undefined : s.feldLinie}>
          <View style={s.feldZeile}>
            <Text style={[s.feldLabel, ...(labelBreite ? [{ width: mm(labelBreite) }] : [])]}>
              {f.label}
            </Text>
            {mitEinheit && (
              <Text style={[s.feldEinheit, ...(einheitBreite ? [{ width: mm(einheitBreite) }] : [])]}>
                {f.einheit ?? ''}
              </Text>
            )}
            <Text style={mitEinheit ? s.feldZahl : s.feldWert}>{f.wert}</Text>
          </View>
        </View>
      ))}
      <View style={s.feldLinie} />
    </View>
  )
}

/**
 * Projektübersicht — bewusst auf zwei Seiten aufgeteilt statt dem automatischen
 * Umbruch überlassen: der Inhaltsfluss reserviert am Seitenfuss keinen Platz
 * für die Fusszeile, ein Umbruch mitten im Kapitel liefe deshalb in sie
 * hinein. Absolut positionieren lässt sie sich nicht — mit `lineHeight` auf
 * der Seite verwirft react-pdf `fixed`-Elemente ausserhalb des Flusses.
 *
 * Erste Seite: Situation, Grundstücke, Mengen und Kosten. Zweite Seite:
 * Erträge und Wirtschaftlichkeit.
 */
function Projektuebersicht({ daten, seite, seitenTotal }: Kapitelseite) {
  const u = daten.uebersicht
  if (!u) {
    return (
      <InhaltsSeite daten={daten} seite={seite} seitenTotal={seitenTotal}>
        <Text style={s.h1}>Projektübersicht</Text>
        <Text style={s.hinweis}>Die Kennzahlen werden geladen…</Text>
      </InhaltsSeite>
    )
  }
  return (
    <>
      <InhaltsSeite daten={daten} seite={seite} seitenTotal={seitenTotal}>
        <Text style={s.h1}>Projektübersicht</Text>
        {/* Situationsplan und Auftrag nebeneinander — der Plan links, die
            Angaben rechts, damit die Seite oben nicht zweimal bricht. */}
        <View style={s.zweiSpalten}>
          <View style={s.spalteEins}>
            <Text style={s.h2}>Situationsplan</Text>
            {u.situationsplanUrl ? (
              <View style={s.planRahmen}>
                <Image src={u.situationsplanUrl} style={s.plan} />
              </View>
            ) : (
              <Text style={s.legende}>Kein GIS-Ausschnitt hinterlegt.</Text>
            )}
          </View>
          <View style={s.spalteZwei}>
            <Feldtabelle titel="Auftrag" felder={u.auftrag} labelBreite={30} abstandUnten={false} />
          </View>
        </View>

        {/* Bildlegende in einer eigenen Zeile darunter — sonst zählte sie
            zur Spaltenhöhe und das Bild endete oberhalb der Tabellenlinie. */}
        {u.situationsplanUrl && (
          <View style={s.zweiSpalten}>
            <View style={s.spalteEins}>
              <Text style={s.legende}>Ausschnitt aus dem kantonalen GIS</Text>
            </View>
            <View style={s.spalteZwei} />
          </View>
        )}

        {/* Grundstücke und Bestandsgebäude nebeneinander, Zeile für Zeile
            gemeinsam gesetzt — so liegen ihre Trennlinien auf einer Höhe. */}
        <Doppeltabelle
          links={{
            titel: 'Grundstücke',
            kopf: u.grundstuecke.kopf,
            breiten: [1.6, 1.3, 1],
            linksBis: 1,
            zeilen: u.grundstuecke.zeilen,
          }}
          rechts={{
            titel: 'Bestandsgebäude',
            kopf: u.bestand.kopf,
            // Die Nebenspalten so schmal wie ihr Inhalt zulässt — der Platz
            // gehört der Bezeichnung, die als einzige lange Namen trägt.
            breiten: [3.45, 1.15, 1.3, 1.35, 1],
            linksBis: 3,
            zeilen: u.bestand.zeilen,
          }}
        />

        {/* Mengen und Anlagekosten in derselben Spaltenteilung wie darüber. */}
        <View style={s.zweiSpalten}>
          <View style={s.spalteEins}>
            <Feldtabelle titel="Mengen" kopf="Kennzahlen" felder={u.mengen} labelBreite={39} />
          </View>
          <View style={s.spalteZwei}>
            <Datentabelle
              titel="Anlagekosten BKP 0–9"
              kopf={['BKP', 'Hauptgruppe', 'exkl.', 'inkl.', '%']}
              breiten={[0.45, 2.5, 1.3, 1.3, 0.7]}
              linksBis={1}
              zeilen={kostenZeilen(u.kosten)}
            />
          </View>
        </View>

      </InhaltsSeite>

      {/* Fortsetzung ohne eigene Überschrift — die Tabellentitel tragen die
          Gliederung, und im Inhaltsverzeichnis steht nur das Kapitel. */}
      <InhaltsSeite daten={daten} seite={seite + 1} seitenTotal={seitenTotal}>
        {/* Je Eigentumsart eine Zeile: Wirtschaftlichkeit links, Erträge
            rechts — die Erträge tragen vier Spalten und brauchen die breitere
            Seite. */}
        {u.bloecke.map((b, i) => (
          <View key={i}>
            {b.titel && (
              <Text style={b.farbe ? [s.h2, { backgroundColor: b.farbe }] : s.h2}>
                {b.titel}
              </Text>
            )}
            <View style={s.zweiSpalten}>
            <View style={s.spalteEins}>
              {/* Der Spaltenkopf hat hier keine eigene Aussage, er hält aber
                  die Zeilen auf der Höhe der Ertragstabelle nebenan: ohne ihn
                  begännen die Feldzeilen um die Kopfzeilenhöhe weiter oben. */}
              {b.wirtschaft && (
                <Feldtabelle
                  titel={b.wirtschaft.titel}
                  titelFarbe={b.farbeUnter}
                  anschluss={Boolean(b.titel)}
                  kopf="Kennzahlen"
                  felder={b.wirtschaft.felder}
                  labelBreite={33.5}
                  einheitBreite={11.5}
                />
              )}
            </View>
            <View style={s.spalteZwei}>
              {b.ertraege && (
                <Datentabelle
                  titel={b.ertraege.titel}
                  titelFarbe={b.farbeUnter}
                  anschluss={Boolean(b.titel)}
                  kopf={b.ertraege.kopf}
                  breiten={[1.8, 1.2, 1.7, 1.55]}
                  zeilen={b.ertraege.zeilen}
                />
              )}
            </View>
            </View>
          </View>
        ))}

        {/* Bei einer Nutzungsart passt der Mix noch unter die Erträge. */}
        {u.mix.length === 1 && <Mixbereich mix={u.mix[0]} />}
      </InhaltsSeite>

      {/* Mehrere Nutzungsarten: der Mix bekommt eine eigene Seite und steht
          dort je Nutzungsart getrennt, damit sich Miet- und Verkaufsflächen
          nicht in einem Ring vermischen. */}
      {u.mix.length > 1 && (
        <InhaltsSeite daten={daten} seite={seite + 2} seitenTotal={seitenTotal}>
          {u.mix.map((m) => <Mixbereich key={m.titel} mix={m} dreispaltig />)}
        </InhaltsSeite>
      )}
    </>
  )
}

// ─── Ringdiagramme ───────────────────────────────────────────────────────────

/** Ein Sektor des Rings. */
interface RingSegment {
  label: string
  wert: number
  farbe: string
}

/** Punkt auf dem Kreis; 0 liegt oben, gezählt wird im Uhrzeigersinn. */
function ringPunkt(mitte: number, radius: number, anteil: number): [number, number] {
  const winkel = anteil * 2 * Math.PI - Math.PI / 2
  return [mitte + radius * Math.cos(winkel), mitte + radius * Math.sin(winkel)]
}

/**
 * Sektoren als Bogenpfade. Der Ring entsteht aus der Strichstärke, nicht aus
 * einer Kreisringfläche — ein Bogen je Sektor genügt damit.
 *
 * Ausserhalb der Komponente, weil die Anteile kumuliert werden müssen und der
 * React-Compiler Mutationen im Komponentenrumpf nicht zulässt.
 */
function ringPfade(
  segmente: RingSegment[], mitte: number, radius: number,
): { d: string; farbe: string }[] {
  const summe = segmente.reduce((a, x) => a + x.wert, 0)
  if (summe <= 0) return []
  const pfade: { d: string; farbe: string }[] = []
  let gelaufen = 0
  for (const seg of segmente) {
    const anteil = seg.wert / summe
    if (anteil <= 0) continue
    const [x0, y0] = ringPunkt(mitte, radius, gelaufen)
    const [x1, y1] = ringPunkt(mitte, radius, gelaufen + anteil)
    // Ein Bogen kann keinen Vollkreis beschreiben — Start und Ende fielen
    // zusammen. Knapp darunter abschneiden, der Spalt ist unsichtbar.
    const bis = Math.min(anteil, 0.9995)
    pfade.push({
      d: `M ${x0} ${y0} A ${radius} ${radius} 0 ${bis > 0.5 ? 1 : 0} 1 ${x1} ${y1}`,
      farbe: seg.farbe,
    })
    gelaufen += anteil
  }
  return pfade
}

/**
 * Ringdiagramm mit Legende. Die Legende trägt die Zahlen; der Ring zeigt nur
 * die Verhältnisse, deshalb steht in ihm keine Beschriftung.
 */
function Ringdiagramm({
  titel, segmente, einheit, anschluss, titelFarbe, groesse = 30,
}: {
  titel: string
  segmente: RingSegment[]
  einheit: string
  anschluss?: boolean
  titelFarbe?: string
  /** Aussenmass in Millimetern; schmaler, wenn drei Blöcke auf eine Seite müssen. */
  groesse?: number
}) {
  const echte = segmente.filter((x) => x.wert > 0)
  const summe = echte.reduce((a, x) => a + x.wert, 0)
  if (summe <= 0) return null

  const dicke = groesse * 0.22 // mm, Ringbreite
  const mitte = groesse / 2
  const radius = mitte - dicke / 2
  const pfade = ringPfade(echte, mitte, radius)

  return (
    <View style={s.ringBlock}>
      <Text style={titelFarbe
        ? titelStil(titelFarbe, anschluss)
        : [s.h2, s.h2Schlicht, ...(anschluss ? [s.h2Anschluss] : [])]}>
        {titel} in {einheit}
      </Text>
      <View style={s.ringFlaeche}>
        <Svg width={mm(groesse)} height={mm(groesse)} viewBox={`0 0 ${groesse} ${groesse}`}>
          {/* Grundkreis: schliesst die Fugen zwischen den Bögen. */}
          <Circle cx={mitte} cy={mitte} r={radius} stroke="#EFEBE8" strokeWidth={dicke} fill="none" />
          {pfade.map((p, i) => (
            <Path key={i} d={p.d} stroke={p.farbe} strokeWidth={dicke} fill="none" />
          ))}
        </Svg>
      </View>
      {echte.map((seg) => (
        <View key={seg.label} style={s.legendeZeile}>
          <View style={[s.legendeMarke, { backgroundColor: seg.farbe }]} />
          <Text style={s.legendeLabel}>{seg.label}</Text>
          <Text style={s.legendeWert}>{formatNumber(Math.round(seg.wert))}</Text>
          <Text style={s.legendeAnteil}>{((seg.wert / summe) * 100).toFixed(1)} %</Text>
        </View>
      ))}
    </View>
  )
}

/** Wohnungsmix als Balken — die Zimmerzahlen lesen sich so als Verteilung. */
function Wohnungsmix({
  zeilen, anschluss, titelFarbe, balkenFarbe,
}: {
  zeilen: { label: string; anzahl: number }[]
  anschluss?: boolean
  titelFarbe?: string
  balkenFarbe?: string
}) {
  if (zeilen.length === 0) return null
  const groesste = Math.max(...zeilen.map((z) => z.anzahl))
  const total = zeilen.reduce((a, z) => a + z.anzahl, 0)
  return (
    <View style={s.ringBlock}>
      <Text style={titelFarbe
        ? titelStil(titelFarbe, anschluss)
        : [s.h2, s.h2Schlicht, ...(anschluss ? [s.h2Anschluss] : [])]}>
        Wohnungsmix
      </Text>
      {zeilen.map((z) => (
        <View key={z.label} style={s.mixZeile}>
          <Text style={s.mixLabel}>{z.label}</Text>
          <View style={s.mixSpur}>
            <View style={[
              s.mixBalken,
              { width: `${(z.anzahl / groesste) * 100}%` },
              ...(balkenFarbe ? [{ backgroundColor: balkenFarbe }] : []),
            ]} />
          </View>
          <Text style={s.mixWert}>{z.anzahl}</Text>
        </View>
      ))}
      <View style={s.mixZeile}>
        <Text style={s.mixLabel}>Total</Text>
        {/* Ohne Spur: eine leere Spur läse sich als Anteil von null. */}
        <View style={s.mixLeer} />
        <Text style={s.mixWert}>{total}</Text>
      </View>
    </View>
  )
}

/** Nutzungs- und Wohnungsmix: zwei Ringe nebeneinander, darunter die Balken. */
/**
 * Ein Mixblock. Steht er allein, nehmen die Ringe die linke Spalte
 * untereinander ein und der Wohnungsmix die rechte. Kommen mehrere
 * Nutzungsarten vor, muss jeder Block flacher werden: dann stehen die drei
 * Darstellungen nebeneinander und die Ringe kleiner.
 */
function Mixbereich({ mix, dreispaltig }: { mix: Nutzungsmix; dreispaltig?: boolean }) {
  const palette = mix.segmentFarben ?? CHART_PALETTE
  const farbe = (i: number) => palette[i % palette.length]
  const flaechen = mix.nutzungen.map((n, i) => ({ label: n.label, wert: n.flaeche, farbe: farbe(i) }))
  const ertraege = mix.nutzungen.map((n, i) => ({ label: n.label, wert: n.ertrag, farbe: farbe(i) }))
  const ringGroesse = dreispaltig ? 24 : 30
  // Ohne Nutzungsart-Farbe die helle Stufe des Kupfers — die Untertitel sind
  // damit auch dort Balken, nur leiser als die Blocktitel darüber.
  const unterFarbe = mix.farbeUnter ?? BERICHT_FARBE.primaerHell

  return (
    <>
      <Text style={mix.farbe ? titelStil(mix.farbe) : s.h2}>{mix.titel}</Text>
      {/* Die obersten Titel stehen unter dem Bereichstitel und halten deshalb
          nur den knappen Vorabstand. */}
      {dreispaltig ? (
        <View style={s.dreiSpalten}>
          <View style={s.drittel}>
            <Ringdiagramm titel={mix.flaechenTitel} segmente={flaechen} einheit="m²"
              anschluss titelFarbe={unterFarbe} groesse={ringGroesse} />
          </View>
          <View style={s.drittel}>
            <Ringdiagramm titel={mix.ertraegeTitel} segmente={ertraege} einheit="CHF"
              anschluss titelFarbe={unterFarbe} groesse={ringGroesse} />
          </View>
          <View style={s.drittelLetzte}>
            <Wohnungsmix zeilen={mix.wohnungsmix} anschluss
              titelFarbe={unterFarbe} balkenFarbe={mix.farbe} />
          </View>
        </View>
      ) : (
        <View style={s.zweiSpalten}>
          <View style={s.spalteEins}>
            <Ringdiagramm titel={mix.flaechenTitel} segmente={flaechen} einheit="m²"
              anschluss titelFarbe={unterFarbe} />
            <Ringdiagramm titel={mix.ertraegeTitel} segmente={ertraege} einheit="CHF"
              titelFarbe={unterFarbe} />
          </View>
          <View style={s.spalteZwei}>
            <Wohnungsmix zeilen={mix.wohnungsmix} anschluss titelFarbe={unterFarbe} />
          </View>
        </View>
      )}
    </>
  )
}

/** Was jede Kapitelseite braucht: die Daten und ihren Platz im Seitenplan. */
interface Kapitelseite {
  daten: BerichtDaten
  /** Erste Seite des Kapitels. */
  seite: number
  seitenTotal: number
}

/** Platzhalter für Kapitel, deren Inhalt noch aussteht. */
function KapitelPlatzhalter({
  kapitel, daten, seite, seitenTotal,
}: Kapitelseite & { kapitel: BerichtKapitel }) {
  return (
    <InhaltsSeite format={kapitel.format} daten={daten} seite={seite} seitenTotal={seitenTotal}>
      <Text style={s.h1}>{kapitel.label}</Text>
      <Text style={s.hinweis}>
        {kapitel.beschrieb} — dieses Kapitel wird noch aufgebaut.
      </Text>
    </InhaltsSeite>
  )
}

/** Wählt die Seite eines Kapitels; noch leere Kapitel bekommen einen Platzhalter. */
function KapitelSeite({ kapitel, ...rest }: Kapitelseite & { kapitel: BerichtKapitel }) {
  switch (kapitel.key) {
    case 'projektuebersicht': return <Projektuebersicht {...rest} />
    default:                  return <KapitelPlatzhalter kapitel={kapitel} {...rest} />
  }
}

/**
 * Der Businessplan-Bericht als PDF-Dokument.
 *
 * Titelblatt und Inhaltsverzeichnis stehen; von den Fachkapiteln ist die
 * Projektübersicht ausgebaut, die übrigen erscheinen als Platzhalter — so
 * bleibt die Gliederung vollständig und man sieht, was noch fehlt.
 */
export function BerichtDokument({ daten }: { daten: BerichtDaten }) {
  // Hier statt beim Modulimport, damit eine abweichende Asset-Basis vorher
  // gesetzt werden kann (Rendern ausserhalb des Browsers).
  schriftRegistrieren()
  const plan = seitenPlan(kapitelFuer(daten.kapitel).filter((k) => !k.fix), daten)
  const seitenTotal = seitenTotalVon(plan, daten)

  return (
    <Document
      title={`${daten.projektName} — ${daten.dokumentBezeichnung}`}
      author={FUSSZEILE_FIRMA}
    >
      <Titelblatt daten={daten} />
      <Inhaltsverzeichnis plan={plan} daten={daten} seitenTotal={seitenTotal} />
      {plan.map((e) => (
        <KapitelSeite
          key={e.kapitel.key}
          kapitel={e.kapitel}
          daten={daten}
          seite={e.seite}
          seitenTotal={seitenTotal}
        />
      ))}
    </Document>
  )
}
