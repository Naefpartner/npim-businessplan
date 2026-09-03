import { Document, Page, View, Text, Image, StyleSheet, Svg, Path, Circle } from '@react-pdf/renderer'
import {
  SEITE, RAND, TITELBLATT, LOGO, INHALT, SCHRIFT, BERICHT_FARBE,
  FUSSZEILE_FIRMA, FUSSZEILE_TITEL, FUSSZEILE_LINKS, fussBreite,
  kapitelFuer,
  type BerichtKapitel, type SeitenFormat, type AuftragAnrede, type EtappenUmfang,
} from '@/lib/bericht'
import { mm, schriftRegistrieren, datumCh, assetPfad } from '@/lib/berichtPdf'
import { formatNumber } from '@/lib/utils'
import { CHART_PALETTE } from '@/lib/ci'
import { alsAbsaetze, hatInhalt, type Absatz } from '@/lib/richText'

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
  /**
   * Ob Kapitel mit Etappenbezug das Gesamtprojekt, die Etappen einzeln oder
   * beides zeigen. Wirkt heute auf die Mengen; ohne zweite Etappe bleibt es
   * beim Gesamtprojekt, unabhängig von der Wahl.
   */
  etappenUmfang: EtappenUmfang
  /** Inhalt der Projektübersicht; fehlt, solange die Daten laden. */
  uebersicht?: UebersichtDaten
  /** Inhalt des Kapitels „Mengen und Erträge"; fehlt ohne erfasste Gebäude. */
  mengen?: MengenDaten
  /** Inhalt des Kapitels „Nutzungsberechnung"; fehlt ohne Zonen. */
  nutzung?: NutzungDaten
  /**
   * Bausteine, vor denen von Hand eine neue Seite beginnt. Die Rechnung füllt
   * die Seiten so weit wie möglich; wo das fachlich Zusammengehörendes trennt,
   * entscheidet die Wahl hier. Schlüssel siehe berichtUmbruchPunkte().
   */
  umbrueche?: string[]
}

/**
 * Kapitel „Nutzungsberechnung": die vier Wege zur höchstzulässigen
 * Vermietungsfläche nebeneinander, dazu Grundlagen und Zonenvorschriften.
 */
export interface NutzungDaten {
  /** Zonenplan aus dem GIS; fehlt, wenn keiner hinterlegt ist. */
  zonenplanUrl: string | null
  /** Bemerkungen zur Berechnung; fehlen, wenn keine erfasst sind. */
  bemerkungen: string | null
  grundlagen: { kopf: string[]; zeilen: TabellenZeile[] }
  zonen: { kopf: string[]; zeilen: TabellenZeile[] }
  wege: { titel: string; kopf: string[]; zeilen: TabellenZeile[]; ergebnis: number | null }[]
  /** Kleinster der Wege — er begrenzt das Projekt. */
  massgebend: number | null
  massgebendWeg: string | null
}

/** Ein Block mit Farbe der Eigentumsart — Grundlage der Mengenblätter. */
interface EigBlock {
  /**
   * Eigentumsart als unveränderlicher Schlüssel. Die Beschriftung taugt nicht
   * dafür: bei einer einzigen Eigentumsart trägt sie den Namen der Sicht.
   */
  key: string
  label: string
  farbe?: string
  farbeUnter?: string
  /** Sehr helle Stufe — Hinterlegung der Summenzeile. */
  farbeGrund?: string
  /** Titelbalken der Häuser: eine Stufe unter dem Balken der Eigentumsart. */
  farbeHaus?: string
  /**
   * Hinterlegung des Totals über die ganze Sicht — kräftiger als die
   * Zwischensummen, damit es sich von ihnen abhebt.
   */
  farbeTotal?: string
}

/**
 * Kapitel „Mengen und Erträge". Eine Sicht je Blattfolge: das Gesamtprojekt,
 * je eine Etappe oder beides — die Wahl trifft die Sidebar.
 */
export interface MengenDaten {
  sichten: MengenSicht[]
}

export interface MengenSicht {
  /** „Gesamtprojekt" oder der Name der Etappe. */
  titel: string
  /**
   * Ob diese Sicht das Gesamtprojekt zeigt. Dann bleibt der Kapiteltitel ohne
   * Zusatz — „Gesamtprojekt" sagt über einen Bericht zu genau diesem Projekt
   * nichts, während der Name einer Etappe die Seiten unterscheidet.
   */
  gesamt: boolean
  /** Kennwerte der Flächen und ihre Verhältnisse, je Eigentumsart und total. */
  benchmarks: { kopf: string[]; zeilen: TabellenZeile[] }
  /**
   * Je Eigentumsart die Häuser in je einer Zeile — steht den Geschossen voran.
   * Leer bei nur einem Haus und in den Etappensichten.
   */
  haeuserUebersicht: (EigBlock & { kopf: string[]; zeilen: TabellenZeile[] })[]
  /** Mengen und Erträge auf Haus- und Geschossebene, je Eigentumsart. */
  eigentumsarten: (EigBlock & {
    kopf: string[]
    haeuser: { name: string; zeilen: TabellenZeile[]; total: TabellenZeile }[]
    total: TabellenZeile
  })[]
  /** Wohnungsmix je Eigentumsart: Zimmerzahl, Anzahl, Fläche. */
  wohnungsmix: (EigBlock & {
    segmentFarben?: string[]
    /** Ob der Block auf dem Blatt „Wohnungsmix und Erträge" erscheint. */
    aufMixblatt: boolean
    zeilen: TabellenZeile[]
  })[]
  /** Ertragsübersicht je Eigentumsart. */
  ertraege: (EigBlock & { kopf: string[]; aufMixblatt: boolean; zeilen: TabellenZeile[] })[]
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
  /** Untergeordnete Zeile — eingerückt und leiser gesetzt (Mieteinheiten). */
  einzug?: boolean
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
  /** Eigentumsart als unveränderlicher Schlüssel — für gesetzte Umbrüche. */
  key: string
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
  /** Eigentumsart oder 'gesamt' — unveränderlicher Schlüssel des Blocks. */
  key: string
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
const ZEILE = { oben: 0.9, unten: 0.6 } as const

/**
 * Seitlicher Einzug des Textes in Millimetern, gemessen am Kupferbalken der
 * Vorlage. Balken und Tabellenzeilen teilen ihn sich, damit die erste Spalte
 * unter dem Titel steht und nicht davor.
 */
// Nur links: rechts sollen die Zahlen bündig am Spaltenrand abschliessen.
const EINZUG = 2.3

/**
 * Feste Höhe des Zonenplans in Millimetern. Bewusst nicht mitwachsend: neben
 * langen Tabellen geriete er sonst überhoch, und das Bild schnitte immer mehr
 * von den Seiten weg.
 */
const PLAN_HOEHE = 70

/**
 * Höhe des Situationsplans über die ganze Seitenbreite — das Höchstmass. Wird
 * die Seite eng, gibt er nach; siehe planHoehe().
 */
const PLAN_BREIT = 75

/**
 * Mindesthöhe des Situationsplans. Er gibt weit nach, bevor die Anlagekosten
 * von der ersten Seite rutschen — sie gehören zu den Mengen darüber, ein
 * flacherer Planausschnitt wiegt das auf. Darunter bliebe allerdings nur noch
 * ein Streifen, dann ist die zweite Seite das kleinere Übel.
 */
const PLAN_MIN = 40

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
  /**
   * Kapiteltitel ohne eigenen Abstand nach unten: der erste Block darunter
   * bringt seinen Vorabstand schon mit, und beides zusammen riss eine Lücke.
   * Das Inhaltsverzeichnis behält den Wert der Vorlage.
   */
  h1Kapitel: { marginBottom: 0 },

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
    paddingTop: mm(0.55),
    paddingBottom: mm(0.4),
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
  /** Hinweis innerhalb einer Spalte — auf der Flucht der Tabellen daneben. */
  hinweisSpalte: {
    paddingLeft: mm(EINZUG),
    paddingBottom: mm(2),
    fontSize: SCHRIFT.klein,
    color: '#6B6B6B',
  },
  /** Freitext unter einer Tabelle — eingerückt wie deren erste Spalte. */
  bemerkung: { paddingLeft: mm(EINZUG), paddingTop: mm(ZEILE.oben) },

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
  /** Situationsplan über die ganze Satzbreite; das Bild schneidet aus der Mitte. */
  planBreit: { height: mm(PLAN_BREIT), position: 'relative' },
  /**
   * Zonenplan in der Spalte neben den Tabellen. Den Abstand nach unten bringt
   * die Beschriftung darunter mit.
   */
  planSpalte: {
    height: mm(PLAN_HOEHE),
    position: 'relative',
  },
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
  /** Zwei gleich breite Spalten — für Blöcke ohne unterschiedlichen Bedarf. */
  spalteHalbLinks: { flexGrow: 1, flexShrink: 1, flexBasis: '0%', marginRight: mm(6) },
  spalteHalbRechts: { flexGrow: 1, flexShrink: 1, flexBasis: '0%' },
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
  /** Bezugsrahmen für die Zahl in der Mitte des Rings. */
  ringRahmen: { position: 'relative' },
  /**
   * Das Total sitzt im Loch des Rings. Über die ganze Fläche gelegt und darin
   * zentriert — so trifft es die Mitte, ohne dass die Zeilenhöhe der Seite
   * hineinrechnet.
   */
  ringMitte: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * Zeilen im Ring stehen enger als im Fliesstext: die Einheit gehört zur Zahl
   * darunter, und im Loch ist wenig Platz.
   */
  ringTotal: { fontWeight: 700, textAlign: 'center', lineHeight: 1.15 },
  ringEinheit: { color: '#6B6B6B', textAlign: 'center', lineHeight: 1.15 },
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
  /**
   * Summenzeile: fett und hell hinterlegt, wie die Ergebniszeile der Vorlage.
   * Trägt der Block eine Farbe der Nutzungsart, überschreibt sie den Grundton.
   */
  tabTotal: { fontWeight: 700, backgroundColor: BERICHT_FARBE.primaerZart },
  /**
   * Untergeordnete Zeile — kleiner und leiser gesetzt, damit sie sich der Zeile
   * darüber unterordnet. Die kleinere Schrift macht die Zeile auch niedriger;
   * die Umbruchrechnung führt dafür eine eigene Höhe.
   */
  tabEinzug: { color: '#4A4A4A', fontSize: SCHRIFT.klein },
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
/** Höhe eines Tabellenblocks: Balken mit Vorabstand, Kopfzeile, Zeilen, Abstand. */
function blockHoehe(zeilen: number): number {
  return MH.eigTitel + MH.kopfzeile + zeilen * MH.zeile + MH.blockEnde
}

/** Breite des Satzspiegels in Millimetern. */
const SATZBREITE = SEITE.a4.breite - RAND.links - RAND.rechts

/**
 * Breite der beiden ungleichen Spalten (spalteEins/spalteZwei), abzüglich des
 * Stegs dazwischen — die Umbruchrechnung braucht sie, um zu wissen, ab wann
 * eine Zelle umbricht.
 */
const SPALTE_EINS = (SATZBREITE - 6) * 0.85 / 2.15
const SPALTE_ZWEI = (SATZBREITE - 6) * 1.3 / 2.15

/**
 * Geschätzte Breite eines Zellinhalts in Millimetern. @react-pdf misst Text
 * erst beim Satz — bis dahin muss feststehen, ob eine Zelle umbricht. Die
 * Werte sind an gerenderten Seiten nachgemessen: „Seestrasse" belegt bei 9 pt
 * 45 pt, also gut ein halbes Geviert je Zeichen; Ziffern laufen etwas breiter,
 * Punkt und Strich deutlich schmaler.
 */
function zeichenBreite(c: string): number {
  if (/\d/.test(c)) return 0.59
  if ('iIl|!.,;:\'’·'.includes(c)) return 0.28
  if (' tfjr'.includes(c)) return 0.36
  if ('mw'.includes(c)) return 0.85
  if ('MW'.includes(c)) return 0.98
  if (c >= 'A' && c <= 'Z') return 0.63
  if ('ÄÖÜ'.includes(c)) return 0.63
  return 0.58
}

/**
 * Sicherheitszuschlag auf die geschätzte Breite. Die Schätzung trifft im Mittel,
 * einzelne Wörter weichen um einige Prozent ab — und ein übersehener Umbruch
 * wiegt schwerer als ein zu früh angenommener: er lässt die Seite überlaufen,
 * und react-pdf hängt eine Leerseite an.
 */
const BREITE_ZUSCHLAG = 1.05

function textBreite(text: string): number {
  const em = [...text].reduce((a, c) => a + zeichenBreite(c), 0)
  return em * SCHRIFT.grund * (25.4 / 72) * BREITE_ZUSCHLAG
}

/**
 * Zeilen, die ein Text in einer Spalte belegt. Umbrochen wird nur an
 * Leerzeichen — ein einzelnes langes Wort läuft über die Spalte hinaus, statt
 * getrennt zu werden. „CHF/Mt,Stk" steht deshalb auf einer Zeile, auch wo die
 * Spalte schmaler ist; die Rechnung darf dort keine zweite annehmen, sonst
 * rücken Blöcke weiter, obwohl sie noch Platz hätten.
 */
function textZeilen(text: string, breite: number, grad: number): number {
  const woerter = text.split(/\s+/).filter(Boolean)
  if (woerter.length === 0 || breite <= 0) return 1
  const leer = textBreite(' ') * grad
  let zeilen = 1
  let belegt = 0
  for (const w of woerter) {
    const b = textBreite(w) * grad
    if (belegt > 0 && belegt + leer + b > breite) {
      zeilen++
      belegt = b
    } else {
      belegt += (belegt > 0 ? leer : 0) + b
    }
  }
  return zeilen
}

/**
 * Höhe von Tabellenzeilen — mit den Zeilen, die eine zu lange Zelle nach sich
 * zieht. Ohne das fehlen dem Modell je Umbruch rund vier Millimeter, und eine
 * randvolle Seite kippt: react-pdf bricht dann selbst um und hängt eine Seite
 * an, die der Seitenplan nicht kennt.
 */
function zeilenZahl(
  zeile: TabellenZeile | undefined, breiten: number[], spaltenAbstand: number, breite: number,
  /** Schriftgrad im Verhältnis zur Grundschrift — die Kopfzeile ist kleiner. */
  grad = 1,
): number {
  if (!zeile) return 0
  const summe = breiten.reduce((a, b) => a + b, 0)
  const nutzbar = breite - EINZUG
  let zahl = 1
  zeile.zellen.forEach((c, i) => {
    if (!c) return
    const spalte = nutzbar * (breiten[i] ?? 1) / summe
      - (i < zeile.zellen.length - 1 ? spaltenAbstand : 0)
    if (spalte > 0) zahl = Math.max(zahl, textZeilen(c, spalte, grad))
  })
  return zahl
}

/**
 * Höhe der Kopfzeile. Sie ist kleiner gesetzt als die Daten, bricht aber
 * ebenso um — „CHF/Mt,Stk" passt in eine schmale Spalte nicht auf eine Zeile,
 * und die zweite fehlte dem Modell.
 */
function kopfHoehe(
  kopf: string[], breiten: number[], spaltenAbstand = 3, breite = SATZBREITE,
): number {
  const zahl = zeilenZahl({ zellen: kopf }, breiten, spaltenAbstand, breite,
    SCHRIFT.klein / SCHRIFT.grund)
  return MH.kopfzeile + (zahl - 1) * SCHRIFT.zeile * (SCHRIFT.klein / SCHRIFT.grund) * (25.4 / 72)
}

function zeilenHoehe(
  zeilen: TabellenZeile[], breiten: number[], spaltenAbstand = 3, breite = SATZBREITE,
): number {
  return zeilen.reduce(
    (h, z) => h + zeilenZahl(z, breiten, spaltenAbstand, breite) * MH.zeile, 0)
}

/**
 * Höhe einer Doppeltabelle. Beide Seiten setzen Zeile r gemeinsam — bricht auf
 * einer Seite eine Zelle um, wächst die ganze Zeile. Die Höhen der beiden
 * Tabellen getrennt zu nehmen und das Maximum zu bilden, wäre zu wenig: die
 * Umbrüche können auf verschiedene Zeilen fallen.
 */
function doppelHoehe(
  links: { zeilen: TabellenZeile[]; breiten: number[] },
  rechts: { zeilen: TabellenZeile[]; breiten: number[] },
): number {
  const zeilen = Math.max(links.zeilen.length, rechts.zeilen.length)
  let hoehe = 0
  for (let r = 0; r < zeilen; r++) {
    hoehe += Math.max(
      zeilenZahl(links.zeilen[r], links.breiten, 3, SPALTE_EINS),
      zeilenZahl(rechts.zeilen[r], rechts.breiten, 3, SPALTE_ZWEI),
    ) * MH.zeile
  }
  return hoehe
}

/**
 * Höhe der Nutzungsberechnung. Oben stehen Zonenvorschriften und Grundstücke
 * übereinander, daneben der Zonenplan — der füllt die Höhe der beiden und
 * fällt deshalb nicht ins Gewicht. Passt darunter nicht alles, wandern die
 * Wege auf die zweite Seite.
 */
function nutzungHoehen(n: NutzungDaten): { oben: number; wege: number } {
  const einWeg = n.wege.length === 1
  const links = blockHoehe(n.zonen.zeilen.length)
    + blockHoehe(n.grundlagen.zeilen.length)
    + (einWeg ? blockHoehe(n.wege[0].zeilen.length) : 0)
    // Der Hinweis, wenn keine Nutzungsmasse erfasst sind.
    + (n.wege.length === 0 ? MH.zeile + MH.blockEnde : 0)
  // Die Spalte des Plans kann höher ausfallen als die Tabellen daneben.
  const oben = MH.h1 + Math.max(
    links,
    // Balken, Bild und die Beschriftung darunter.
    n.zonenplanUrl ? MH.eigTitel + PLAN_HOEHE + MH.legende : 0,
  )
  if (einWeg) return { oben, wege: 0 }

  let wege = 0
  for (let i = 0; i < n.wege.length; i += 2) {
    wege += Math.max(
      blockHoehe(n.wege[i].zeilen.length),
      n.wege[i + 1] ? blockHoehe(n.wege[i + 1].zeilen.length) : 0,
    )
  }
  // Dazu der Block „Massgebende Vermietungsfläche" — er steht nur, wenn es
  // mehrere Wege gibt.
  return { oben, wege: wege + blockHoehe(1) }
}

/**
 * Höhe eines Blockpaares der Projektübersicht: der Obertitel und die höhere
 * der beiden Spalten — Wirtschaftlichkeit und Erträge stehen nebeneinander.
 */
function eigBlockHoehe(b: EigentumsartBlock): number {
  // Unter einem Obertitel halten die beiden Titel nur den knappen Vorabstand.
  const titel = b.titel ? MH.hausTitel : MH.eigTitel
  const rahmen = titel + MH.kopfzeile + MH.blockEnde
  const breiten = [1.8, 1.2, 1.7, 1.55]
  return (b.titel ? MH.eigTitel : 0) + Math.max(
    b.wirtschaft ? rahmen + b.wirtschaft.felder.length * MH.zeile : 0,
    b.ertraege
      ? titel + kopfHoehe(b.ertraege.kopf, breiten, 3, SPALTE_ZWEI) + MH.blockEnde
        + zeilenHoehe(b.ertraege.zeilen, breiten, 3, SPALTE_ZWEI)
      : 0,
  )
}

/**
 * Höhe eines Mixblocks. Nebeneinander stehen die Ringe und der Wohnungsmix,
 * bei mehreren Nutzungsarten alle drei — dann zählt der höchste, sonst die
 * beiden untereinanderstehenden Ringe.
 */
function mixHoehe(m: Nutzungsmix, dreispaltig: boolean): number {
  const groesse = dreispaltig ? 24 : 30
  const ring = (anzahl: number, anschluss: boolean) => (anzahl === 0 ? 0
    : (anschluss ? MH.hausTitel : MH.eigTitel) + MH.ringRand + groesse
      + anzahl * MH.legendeZeile + MH.blockEnde)
  // Segmente ohne Wert erscheinen weder im Ring noch in der Legende.
  const flaechen = ring(m.nutzungen.filter((n) => n.flaeche > 0).length, true)
  const ertraege = ring(m.nutzungen.filter((n) => n.ertrag > 0).length, dreispaltig)
  const wohnungen = m.wohnungsmix.length === 0 ? 0
    // Die Totalzeile kommt hinzu.
    : MH.hausTitel + (m.wohnungsmix.length + 1) * MH.mixZeile + MH.blockEnde
  return MH.eigTitel + (dreispaltig
    ? Math.max(flaechen, ertraege, wohnungen)
    : Math.max(flaechen + ertraege, wohnungen))
}

/**
 * Anfasser für einen von Hand gesetzten Umbruch. Der Schlüssel muss über
 * Änderungen an den Daten hinweg derselbe bleiben — sonst wandert ein
 * gesetzter Umbruch beim nächsten Öffnen auf einen anderen Block.
 */
interface Umbruchpunkt {
  key: string
  /** Name in der Liste über der Vorschau. */
  label: string
}

/** Ein Baustein der Projektübersicht; die Reihenfolge steht fest. */
type UebersichtElement = Umbruchpunkt & (
  /** Der Plan trägt seine Höhe mit: sie hängt vom Platz auf der Seite ab. */
  | { art: 'situationsplan'; url: string; hoehe: number }
  /** Grundstücke und Bestandsgebäude nebeneinander. */
  | { art: 'grundlagen' }
  /** Mengen und Anlagekosten nebeneinander. */
  | { art: 'kosten' }
  | { art: 'block'; block: EigentumsartBlock }
  | { art: 'mix'; mix: Nutzungsmix; dreispaltig: boolean }
)

/**
 * Höhe der Tabellenblöcke der ersten Seite — ohne den Plan. Gerechnet mit
 * denselben Höhen wie der Umbruch, sonst schätzt die eine Stelle den Platz
 * anders ein als die andere.
 */
function ersteSeiteOhnePlan(u: UebersichtDaten): number {
  const leer = Math.max(u.grundstuecke.zeilen.length, u.bestand.zeilen.length) === 0
  return MH.h1
    + (leer ? 0 : uebersichtElementHoehe(
      { art: 'grundlagen', key: '', label: '' }, u))
    + uebersichtElementHoehe({ art: 'kosten', key: '', label: '' }, u)
}

/**
 * Höhe des Situationsplans über den Tabellen — oder null, wenn er dort nicht
 * mehr hingehört.
 *
 * Er ist der einzige Posten der ersten Seite, der nicht von den Daten kommt,
 * also gibt er nach, wenn Grundstücke, Bestandsgebäude und Anlagekosten viel
 * Platz brauchen: Mengen und Kosten gehören zusammen, ein flacherer
 * Planausschnitt wiegt das auf. Bleibt selbst dann zu wenig, rückt er hinter
 * die Tabellen — dort bekommt er wieder seine volle Höhe. Ein Streifen von
 * dreissig Millimetern zeigte ohnehin nichts mehr, und `objectFit: cover`
 * schnitte immer mehr von oben und unten weg.
 */
function planHoehe(u: UebersichtDaten): number | null {
  const rest = ersteSeiteOhnePlan(u) + MH.eigTitel + MH.legende + MH.blockEnde
  const platz = SEITENHOEHE - rest
  if (platz < PLAN_MIN) return null
  return Math.min(PLAN_BREIT, platz)
}

function uebersichtElemente(u: UebersichtDaten): UebersichtElement[] {
  // Mehrere Nutzungsarten: je eine flachere, dreispaltige Mixdarstellung,
  // damit sich Miet- und Verkaufsflächen nicht in einem Ring vermischen.
  const dreispaltig = u.mix.length > 1
  const grundlagen = Math.max(u.grundstuecke.zeilen.length, u.bestand.zeilen.length) > 0
  const hoehe = u.situationsplanUrl ? planHoehe(u) : null
  const plan = u.situationsplanUrl
    ? [{
      art: 'situationsplan', url: u.situationsplanUrl, hoehe: hoehe ?? PLAN_BREIT,
      key: 'uebersicht:situationsplan', label: 'Situationsplan',
    } as const]
    : []
  return [
    // Über den Tabellen, solange er dort noch etwas zeigt.
    ...(hoehe != null ? plan : []),
    ...(grundlagen ? [{
      art: 'grundlagen',
      key: 'uebersicht:grundlagen', label: 'Grundstücke und Bestandsgebäude',
    } as const] : []),
    { art: 'kosten', key: 'uebersicht:kosten', label: 'Mengen und Anlagekosten' },
    // Sonst dahinter, in voller Höhe.
    ...(hoehe == null ? plan : []),
    ...u.bloecke.map((block) => ({
      art: 'block', block,
      key: `uebersicht:block:${block.key}`,
      label: block.titel ?? 'Wirtschaftlichkeit und Erträge',
    }) as const),
    ...u.mix.map((mix) => ({
      art: 'mix', mix, dreispaltig,
      key: `uebersicht:mix:${mix.key}`,
      label: dreispaltig ? `Mix ${mix.titel}` : mix.titel,
    }) as const),
  ]
}

function uebersichtElementHoehe(e: UebersichtElement, u: UebersichtDaten): number {
  switch (e.art) {
    case 'situationsplan':
      return MH.eigTitel + e.hoehe + MH.legende + MH.blockEnde
    case 'grundlagen': {
      const links = [1.6, 1.3, 1]
      const rechts = [3.45, 1.15, 1.3, 1.35, 1]
      return MH.eigTitel + MH.blockEnde + Math.max(
        kopfHoehe(u.grundstuecke.kopf, links, 3, SPALTE_EINS),
        kopfHoehe(u.bestand.kopf, rechts, 3, SPALTE_ZWEI),
      ) + doppelHoehe(
        { zeilen: u.grundstuecke.zeilen, breiten: links },
        { zeilen: u.bestand.zeilen, breiten: rechts },
      )
    }
    case 'kosten': {
      const breiten = [0.45, 2.5, 1.3, 1.3, 0.7]
      const kopf = ['BKP', 'Hauptgruppe', 'exkl.', 'inkl.', '%']
      return MH.eigTitel + kopfHoehe(kopf, breiten, 3, SPALTE_ZWEI) + MH.blockEnde + Math.max(
        u.mengen.length * MH.zeile,
        zeilenHoehe(kostenZeilen(u.kosten), breiten, 3, SPALTE_ZWEI),
      )
    }
    case 'block':
      return eigBlockHoehe(e.block)
    case 'mix':
      return mixHoehe(e.mix, e.dreispaltig)
  }
}

/**
 * Umbruch des Kapitels. Situationsplan, Tabellen, Wirtschaftlichkeit und Mix
 * füllen je nach Grundstücken, Eigentumsarten und Nutzungen unterschiedlich
 * viel. Ohne Vorausrechnung bricht react-pdf selbst um und hängt eine Seite
 * an, die weder Seitenplan noch Sprungnavigation kennen — von dort an zeigt
 * jeder Kapitelknopf eine Seite zu früh.
 *
 * `gesetzt` sind die von Hand gewählten Umbrüche: vor diesen Bausteinen
 * beginnt eine neue Seite, auch wenn noch Platz wäre.
 */
function uebersichtSeiten(
  u: UebersichtDaten, gesetzt: ReadonlySet<string>,
): UebersichtElement[][] {
  const seiten: UebersichtElement[][] = []
  let seite: UebersichtElement[] = []
  // Der Kapiteltitel steht nur auf der ersten Seite.
  let hoehe = MH.h1
  function umbruch() {
    seiten.push(seite)
    seite = []
    hoehe = 0
  }
  for (const e of uebersichtElemente(u)) {
    const h = uebersichtElementHoehe(e, u)
    // Der Mix je Nutzungsart beginnt in jedem Fall auf einer eigenen Seite.
    const eigeneSeite = e.art === 'mix' && e.dreispaltig
      && seite.some((x) => x.art !== 'mix')
    if (seite.length > 0 && (gesetzt.has(e.key) || eigeneSeite || hoehe + h > SEITENHOEHE)) {
      umbruch()
    }
    seite.push(e)
    hoehe += h
  }
  umbruch()
  return seiten
}

/** Die von Hand gesetzten Umbrüche als Menge — die Rechnung fragt sie oft ab. */
function umbruchSet(daten: BerichtDaten): ReadonlySet<string> {
  return new Set(daten.umbrueche ?? [])
}

function kapitelSeiten(key: string, daten: BerichtDaten): number {
  if (key === 'projektuebersicht') {
    const u = daten.uebersicht
    // Ohne Kennzahlen steht nur die Ladezeile — eine Seite.
    return u ? uebersichtSeiten(u, umbruchSet(daten)).length : 1
  }
  if (key === 'stammdaten') {
    const n = daten.nutzung
    if (!n) return 1
    const h = nutzungHoehen(n)
    return h.oben + h.wege > SEITENHOEHE ? 2 : 1
  }
  if (key === 'mengengeruest') {
    const sichten = daten.mengen?.sichten ?? []
    if (sichten.length === 0) return 1
    const gesetzt = umbruchSet(daten)
    return sichten.reduce((a, x) => a + sichtSeiten(x, gesetzt), 0)
  }
  return 1
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

/**
 * Kapitel mit ihrer ersten Seite — Grundlage der Sprungnavigation über der
 * Vorschau. Titelblatt und Inhaltsverzeichnis stehen fest auf 1 und 2.
 */
export function berichtSeitenplan(
  daten: BerichtDaten,
): { key: string; label: string; seite: number }[] {
  const fach = kapitelFuer(daten.kapitel).filter((k) => !k.fix)
  return [
    { key: 'titelblatt', label: 'Titelblatt', seite: 1 },
    { key: 'inhalt', label: 'Inhalt', seite: 2 },
    ...seitenPlan(fach, daten).map((e) => ({
      key: e.kapitel.key, label: e.kapitel.label, seite: e.seite,
    })),
  ]
}

/** Ein Baustein, vor dem sich ein Umbruch setzen lässt. */
export interface UmbruchEintrag extends Umbruchpunkt {
  /** Kapitel, in dem er steht — für die Gruppierung in der Liste. */
  kapitel: string
  /** Seite, auf der er im gegenwärtigen Satz beginnt. */
  seite: number
  /** Ob vor ihm von Hand ein Umbruch gesetzt ist. */
  gesetzt: boolean
  /** Ob er ohnehin schon oben auf der Seite steht. */
  obenAufSeite: boolean
}

/**
 * Alle Bausteine, vor denen sich ein Umbruch setzen lässt, in Druckreihenfolge
 * und mit der Seite, auf der sie gerade beginnen. Gerechnet mit denselben
 * Funktionen wie der Satz — die Seitenzahlen stimmen deshalb mit dem PDF
 * überein, auch nachdem ein Umbruch gesetzt wurde.
 *
 * Nur die datengetriebenen Kapitel: die übrigen füllen eine feste Seite, dort
 * gibt es nichts zu verschieben.
 */
export function berichtUmbruchPunkte(daten: BerichtDaten): UmbruchEintrag[] {
  const gesetzt = umbruchSet(daten)
  const plan = seitenPlan(kapitelFuer(daten.kapitel).filter((k) => !k.fix), daten)
  const punkte: UmbruchEintrag[] = []

  function sammle(
    kapitel: string, ersteSeite: number, seiten: { key: string; label: string }[][],
  ) {
    seiten.forEach((elemente, i) => {
      elemente.forEach((e, j) => {
        if (!e.key) return
        punkte.push({
          key: e.key, label: e.label, kapitel,
          seite: ersteSeite + i,
          gesetzt: gesetzt.has(e.key),
          obenAufSeite: j === 0,
        })
      })
    })
  }

  for (const e of plan) {
    if (e.kapitel.key === 'projektuebersicht' && daten.uebersicht) {
      sammle(e.kapitel.label, e.seite, uebersichtSeiten(daten.uebersicht, gesetzt))
    }
    if (e.kapitel.key === 'mengengeruest' && daten.mengen) {
      let nr = e.seite
      for (const sicht of daten.mengen.sichten) {
        sammle(e.kapitel.label, nr, mengenSeiten(sicht, gesetzt))
        // Mix- und Grafikblatt der Sicht liegen hinter ihren Mengenseiten.
        nr += sichtSeiten(sicht, gesetzt)
      }
    }
  }
  return punkte
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
  /** Hinterlegung der Summenzeilen; ohne Angabe die zarte Kupferstufe. */
  totalFarbe?: string
  kopf: string[]
  zeilen: TabellenZeile[]
  /** Spaltenanteile; ohne Angabe erste Spalte doppelt so breit. */
  breiten?: number[]
  /** Bis zu dieser Spalte linksbündig, danach rechtsbündig (Zahlenspalten). */
  linksBis?: number
  /** Abstand zwischen den Spalten in mm; enger, wo viele Spalten stehen. */
  spaltenAbstand?: number
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
    ...(i < t.kopf.length - 1 ? { paddingRight: mm(t.spaltenAbstand ?? 3) } : {}),
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
    <View style={[
      s.tabZeile, s.tabLinie,
      ...(zeile.total ? [s.tabTotal] : []),
      ...(zeile.total && t.totalFarbe ? [{ backgroundColor: t.totalFarbe }] : []),
      ...(zeile.einzug ? [s.tabEinzug] : []),
    ]}>
      <Zellen t={t} werte={zeile.zellen} />
    </View>
  )
}

/** Einzelne Datentabelle mit Kopfzeile. */
function Datentabelle({
  titel, titelFarbe, anschluss, totalFarbe, kopf, zeilen, breiten, linksBis = 0,
  spaltenAbstand,
}: Tabelle) {
  if (zeilen.length === 0) return null
  const t: Tabelle = { kopf, zeilen, breiten, linksBis, totalFarbe, spaltenAbstand }
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
  /** Hinterlegung der Summenzeilen; ohne Angabe die zarte Kupferstufe. */
  totalFarbe?: string
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

/** Ein Baustein der Projektübersicht, wie ihn der Seitenplan zugeteilt hat. */
function UebersichtBaustein({ el, u }: { el: UebersichtElement; u: UebersichtDaten }) {
  switch (el.art) {
    // Der Situationsplan über die ganze Breite. Feste Höhe, weil neben ihm
    // nichts mehr steht, das sie vorgäbe — und weil die Seite in der
    // Umbruchrechnung nicht überlaufen darf.
    case 'situationsplan':
      return (
        <View style={s.feldBlock}>
          <Text style={s.h2}>Situationsplan</Text>
          <View style={[s.planBreit, { height: mm(el.hoehe) }]}>
            <Image src={el.url} style={s.plan} />
          </View>
          <Text style={s.legende}>Ausschnitt aus dem kantonalen GIS</Text>
        </View>
      )

    // Grundstücke und Bestandsgebäude nebeneinander, Zeile für Zeile
    // gemeinsam gesetzt — so liegen ihre Trennlinien auf einer Höhe.
    case 'grundlagen':
      return (
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
      )

    // Mengen und Anlagekosten in derselben Spaltenteilung wie darüber.
    case 'kosten':
      return (
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
      )

    // Je Eigentumsart eine Zeile: Wirtschaftlichkeit links, Erträge rechts —
    // die Erträge tragen vier Spalten und brauchen die breitere Seite.
    case 'block': {
      const b = el.block
      return (
        <View>
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
      )
    }

    case 'mix':
      return <Mixbereich mix={el.mix} dreispaltig={el.dreispaltig} />
  }
}

/**
 * Projektübersicht — der Umbruch wird gesetzt statt dem Inhaltsfluss
 * überlassen: der reserviert am Seitenfuss keinen Platz für die Fusszeile, ein
 * Umbruch mitten im Kapitel liefe deshalb in sie hinein. Absolut positionieren
 * lässt sie sich nicht — mit `lineHeight` auf der Seite verwirft react-pdf
 * `fixed`-Elemente ausserhalb des Flusses.
 *
 * Wie viele Seiten es werden, entscheidet uebersichtSeiten() — dieselbe
 * Funktion, aus der auch der Seitenplan liest.
 */
function Projektuebersicht({ daten, seite, seitenTotal }: Kapitelseite) {
  const u = daten.uebersicht
  if (!u) {
    return (
      <InhaltsSeite daten={daten} seite={seite} seitenTotal={seitenTotal}>
        <Text style={[s.h1, s.h1Kapitel]}>Projektübersicht</Text>
        <Text style={s.hinweis}>Die Kennzahlen werden geladen…</Text>
      </InhaltsSeite>
    )
  }
  return (
    <>
      {uebersichtSeiten(u, umbruchSet(daten)).map((elemente, n) => (
        <InhaltsSeite key={n} daten={daten} seite={seite + n} seitenTotal={seitenTotal}>
          {/* Nur die erste Seite trägt die Überschrift; auf den Folgeseiten
              gliedern die Tabellentitel, und im Inhaltsverzeichnis steht
              ohnehin nur das Kapitel. */}
          {n === 0 && <Text style={[s.h1, s.h1Kapitel]}>Projektübersicht</Text>}
          {elemente.map((e, i) => <UebersichtBaustein key={i} el={e} u={u} />)}
        </InhaltsSeite>
      ))}
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

/** Breite des Rings, als Anteil seines Aussenmasses. */
const RING_DICKE = 0.22

/**
 * Summe in der Mitte des Rings. Beträge ab einer Million werden gerundet
 * angeschrieben — im Loch des Rings ist die genaue Frankenzahl weder lesbar
 * noch von Belang; sie steht ohnehin Zeile für Zeile in der Legende. Mengen
 * bleiben genau: dort ist der Wert die Aussage.
 */
function ringSumme(summe: number, einheit?: string): string {
  if (einheit === 'CHF' && summe >= 1e6) return `${(summe / 1e6).toFixed(1)} Mio`
  return formatNumber(Math.round(summe))
}

/**
 * Schriftgrad des Totals in der Mitte des Rings: so gross wie möglich, aber
 * innerhalb des Lochs. Die Breite der Zeichenkette wird geschätzt — @react-pdf
 * misst erst beim Satz, und bis dahin muss der Grad feststehen. Ziffern der
 * Euclid laufen auf gut 0.6 em, die Tausendertrennung auf rund 0.3 em.
 */
function ringTotalGrad(text: string, groesse: number): number {
  const em = [...text].reduce((a, c) => a + (/\d/.test(c) ? 0.6 : 0.32), 0)
  // Innendurchmesser, abzüglich eines Rands zum Ring.
  const platz = groesse * (1 - 2 * RING_DICKE) * 0.82
  return Math.max(5.5, Math.min(SCHRIFT.klein, platz / (em * (25.4 / 72))))
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
  /** Einheit der Werte; ohne Angabe steht nur der Titel. */
  einheit?: string
  segmente: RingSegment[]
  anschluss?: boolean
  titelFarbe?: string
  /** Aussenmass in Millimetern; schmaler, wenn drei Blöcke auf eine Seite müssen. */
  groesse?: number
}) {
  const echte = segmente.filter((x) => x.wert > 0)
  const summe = echte.reduce((a, x) => a + x.wert, 0)
  if (summe <= 0) return null

  const dicke = groesse * RING_DICKE // mm, Ringbreite
  const mitte = groesse / 2
  const radius = mitte - dicke / 2
  const pfade = ringPfade(echte, mitte, radius)
  const total = ringSumme(summe, einheit)
  const grad = ringTotalGrad(total, groesse)

  return (
    <View style={s.ringBlock}>
      <Text style={titelFarbe
        ? titelStil(titelFarbe, anschluss)
        : [s.h2, s.h2Schlicht, ...(anschluss ? [s.h2Anschluss] : [])]}>
        {einheit ? `${titel} in ${einheit}` : titel}
      </Text>
      <View style={s.ringFlaeche}>
        <View style={s.ringRahmen}>
          <Svg width={mm(groesse)} height={mm(groesse)} viewBox={`0 0 ${groesse} ${groesse}`}>
            {/* Grundkreis: schliesst die Fugen zwischen den Bögen. */}
            <Circle cx={mitte} cy={mitte} r={radius} stroke="#EFEBE8" strokeWidth={dicke} fill="none" />
            {pfade.map((p, i) => (
              <Path key={i} d={p.d} stroke={p.farbe} strokeWidth={dicke} fill="none" />
            ))}
          </Svg>
          {/* Das Total im Loch des Rings — der Ring zeigt die Anteile, die
              Zahl darin, worauf sie sich beziehen. */}
          <View style={s.ringMitte}>
            {einheit && (
              <Text style={[s.ringEinheit, { fontSize: grad * 0.85 }]}>{einheit}</Text>
            )}
            <Text style={[s.ringTotal, { fontSize: grad }]}>{total}</Text>
          </View>
        </View>
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
  zeilen, anschluss, titelFarbe, balkenFarbe, titel = 'Wohnungsmix',
}: {
  zeilen: { label: string; anzahl: number }[]
  anschluss?: boolean
  titelFarbe?: string
  balkenFarbe?: string
  titel?: string
}) {
  if (zeilen.length === 0) return null
  const groesste = Math.max(...zeilen.map((z) => z.anzahl))
  const total = zeilen.reduce((a, z) => a + z.anzahl, 0)
  return (
    <View style={s.ringBlock}>
      <Text style={titelFarbe
        ? titelStil(titelFarbe, anschluss)
        : [s.h2, s.h2Schlicht, ...(anschluss ? [s.h2Anschluss] : [])]}>
        {titel}
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

// ─── Kapitel „Mengen und Erträge" ────────────────────────────────────────────

/**
 * Höhen der Bausteine in Millimetern, an gerenderten Seiten nachgemessen.
 * Sie sind konstant, weil Schriftgrad und Innenabstände es sind — damit lässt
 * sich der Seitenumbruch vorausberechnen, statt ihn dem Fluss zu überlassen
 * (der reserviert am Seitenfuss keinen Platz für die Fusszeile).
 */
const MH = {
  /** Kapiteltitel; den Abstand darunter bringt der erste Block mit. */
  h1: 6.7,
  /** Balken der Eigentumsart mit vollem Vorabstand. */
  eigTitel: 13.9,
  /** Balken eines Hauses mit knappem Vorabstand. */
  hausTitel: 10.1,
  kopfzeile: 5.0,
  /** Beschriftung unter einem Bild samt Abständen. */
  legende: 6.3,
  /**
   * Alle Datenzeilen, auch die kleiner gesetzten Wohnungen: der Zeilenabstand
   * folgt dem Grundschriftgrad der Seite, nicht dem der Zelle — nachgemessen
   * sind beide gleich hoch.
   */
  zeile: 5.9,
  blockEnde: 2.0,
  /** Abstände über und unter einem Ringdiagramm zusammen. */
  ringRand: 5.0,
  /** Legendenzeile eines Rings. */
  legendeZeile: 5.1,
  /** Zeile des Wohnungsmixes — der Balken ist niedriger als die Schrift. */
  mixZeile: 5.5,
}

/**
 * Nutzbare Höhe einer A4-Inhaltsseite, abzüglich einer knappen Reserve. Ohne
 * sie kippt eine randvolle Seite: react-pdf bricht dann von sich aus um und
 * hängt eine leere Seite an, die weder Seitenplan noch Fusszeile kennen.
 *
 * Ein Millimeter genügt, seit die Rechnung Zeile für Zeile misst — an
 * gerenderten Seiten nachgeprüft, weicht sie um weniger als einen Millimeter
 * je Seite ab. Grösser gewählt kostet die Reserve echten Platz: Blöcke
 * rückten weiter, obwohl sie um Zehntelmillimeter noch gepasst hätten.
 */
const SEITENHOEHE = SEITE.a4.hoehe - RAND.oben - RAND.unten - 1.5

type MengenElement = Umbruchpunkt & (
  | { art: 'benchmarks'; kopf: string[]; zeilen: TabellenZeile[] }
  | { art: 'uebersicht'; block: EigBlock; titel: string
      kopf: string[]; zeilen: TabellenZeile[] }
  | { art: 'eigTitel'; block: EigBlock; kopf: string[] }
  | { art: 'haus'; block: EigBlock; kopf: string[]; name: string
      fortsetzung: boolean; zeilen: TabellenZeile[] }
  | { art: 'eigTotal'; block: EigBlock; kopf: string[]; zeile: TabellenZeile }
)

function hoeheVon(e: MengenElement): number {
  switch (e.art) {
    case 'benchmarks': {
      const breiten = [2.4, ...e.kopf.slice(1).map(() => 1.2)]
      return MH.eigTitel + kopfHoehe(e.kopf, breiten) + MH.blockEnde
        + zeilenHoehe(e.zeilen, breiten)
    }
    // Die Übersicht steht unter dem Balken der Eigentumsart und hält deshalb
    // nur den knappen Vorabstand, wie die Häuser darunter.
    case 'uebersicht':
      return MH.hausTitel + kopfHoehe(e.kopf, UEBERSICHT_BREITEN, 2.4) + MH.blockEnde
        + zeilenHoehe(e.zeilen, UEBERSICHT_BREITEN, 2.4)
    case 'eigTitel': return MH.eigTitel
    case 'haus':
      return MH.hausTitel + kopfHoehe(e.kopf, MENGEN_BREITEN, 2.4) + MH.blockEnde
        + zeilenHoehe(e.zeilen, MENGEN_BREITEN, 2.4)
    case 'eigTotal': return zeilenHoehe([e.zeile], MENGEN_BREITEN, 2.4) + MH.blockEnde
  }
}

/**
 * Verteilt die Mengen einer Sicht auf Seiten. Ein Haus wird nur getrennt, wenn
 * es allein nicht auf eine Seite passt; dann trägt die Fortsetzung denselben
 * Namen mit Zusatz, damit klar bleibt, wozu die Zeilen gehören.
 */
function mengenSeiten(sicht: MengenSicht, gesetzt: ReadonlySet<string>): MengenElement[][] {
  const seiten: MengenElement[][] = []
  let laufend: MengenElement[] = []
  let hoehe = MH.h1
  // Schlüssel der Sicht: dieselbe Tabelle steht im Gesamtprojekt und in der
  // Etappe, ihre Umbrüche sind aber unabhängig voneinander.
  const sk = `mengen:${sicht.titel}`

  function neueSeite() {
    if (laufend.length > 0) seiten.push(laufend)
    laufend = []
    hoehe = 0
  }
  function lege(e: MengenElement) {
    const h = hoeheVon(e)
    if (laufend.length > 0 && (gesetzt.has(e.key) || hoehe + h > SEITENHOEHE)) neueSeite()
    laufend.push(e)
    hoehe += h
  }

  /**
   * Umbruch vor einem Haus. Stand der Titel der Eigentumsart als Letztes auf
   * der Seite, wandert er mit — allein am Seitenfuss sagt er nichts.
   */
  function umbruchVorHaus() {
    const letzte = laufend[laufend.length - 1]
    if (letzte?.art === 'eigTitel') {
      laufend.pop()
      neueSeite()
      lege(letzte)
    } else {
      neueSeite()
    }
  }

  for (const eig of sicht.eigentumsarten) {
    // Der Titel der Eigentumsart trägt den Umbruch für alles, was ihm folgt —
    // ein Umbruch vor dem ersten Haus liesse ihn allein am Seitenfuss stehen.
    lege({
      art: 'eigTitel', block: eig, kopf: eig.kopf,
      key: `${sk}:eig:${eig.key}`, label: eig.label,
    })
    // Die Übersicht der Häuser steht zwischen dem Balken der Eigentumsart und
    // ihren Häusern: erst wovon die Rede ist, dann alle auf einen Blick, dann
    // jedes für sich.
    const uebersicht = sicht.haeuserUebersicht.find((x) => x.key === eig.key)
    if (uebersicht) {
      lege({
        art: 'uebersicht', block: eig, kopf: uebersicht.kopf, zeilen: uebersicht.zeilen,
        titel: uebersicht.label,
        key: `${sk}:uebersicht:${eig.key}`, label: `Übersicht ${eig.label}`,
      })
    }
    for (const haus of eig.haeuser) {
      const alle = [...haus.zeilen, haus.total]
      const rahmen = MH.hausTitel + kopfHoehe(eig.kopf, MENGEN_BREITEN, 2.4) + MH.blockEnde
      const ganz = rahmen + zeilenHoehe(alle, MENGEN_BREITEN, 2.4)

      // Passt das Haus überhaupt auf eine ganze Seite, bleibt es zusammen und
      // rückt notfalls als Ganzes weiter. Nur was für sich schon zu lang ist,
      // wird geteilt.
      if (ganz <= SEITENHOEHE) {
        if (laufend.length > 0 && hoehe + ganz > SEITENHOEHE) umbruchVorHaus()
        lege({
          art: 'haus', block: eig, kopf: eig.kopf, name: haus.name,
          fortsetzung: false, zeilen: alle,
          key: `${sk}:haus:${eig.key}:${haus.name}`, label: haus.name,
        })
        continue
      }

      let rest = alle
      let erste = true
      while (rest.length > 0) {
        // So viele Zeilen, wie in den Rest der Seite passen — umbrochene
        // Zellen zählen dabei doppelt.
        const platz = SEITENHOEHE - hoehe - rahmen
        let passt = 0
        while (passt < rest.length
          && zeilenHoehe(rest.slice(0, passt + 1), MENGEN_BREITEN, 2.4) <= platz) passt++
        if (passt < 3 && laufend.length > 0) { umbruchVorHaus(); continue }
        const nimm = Math.min(rest.length, Math.max(passt, 3))
        lege({
          art: 'haus', block: eig, kopf: eig.kopf, name: haus.name,
          fortsetzung: !erste, zeilen: rest.slice(0, nimm),
          // Nur der Anfang des Hauses ist ein Anfasser; vor einer Fortsetzung
          // wäre ein gesetzter Umbruch sinnlos — sie beginnt ohnehin oben.
          key: erste ? `${sk}:haus:${eig.key}:${haus.name}` : '',
          label: haus.name,
        })
        rest = rest.slice(nimm)
        erste = false
      }
    }
    lege({
      art: 'eigTotal', block: eig, kopf: eig.kopf, zeile: eig.total,
      key: '', label: eig.label,
    })
  }
  lege({
    art: 'benchmarks', kopf: sicht.benchmarks.kopf, zeilen: sicht.benchmarks.zeilen,
    key: `${sk}:benchmarks`, label: 'Benchmarks',
  })
  if (laufend.length > 0) seiten.push(laufend)
  return seiten
}

/** Ob eine Sicht das Blatt „Wohnungsmix und Erträge" überhaupt füllt. */
function hatMixblatt(sicht: MengenSicht): boolean {
  return sicht.wohnungsmix.some((w) => w.aufMixblatt)
    || sicht.ertraege.some((e) => e.aufMixblatt)
}

/** Blattzahl einer Sicht: Mengen (mehrseitig), Mix und Erträge, Grafik. */
function sichtSeiten(sicht: MengenSicht, gesetzt: ReadonlySet<string>): number {
  return mengenSeiten(sicht, gesetzt).length
    + (hatMixblatt(sicht) ? 1 : 0)
    + (sicht.wohnungsmix.length > 0 ? 1 : 0)
}

/**
 * Kapiteltitel einer Sicht. Nur eine Etappe braucht ihren Namen dazu; das
 * Gesamtprojekt ist der Bericht selbst.
 */
function sichtTitel(basis: string, sicht: MengenSicht): string {
  return sicht.gesamt ? basis : `${basis} — ${sicht.titel}`
}

/** Spaltenanteile der Mengentabelle — Mengen links, Erträge rechts. */
const MENGEN_BREITEN = [1.25, 2.0, 0.8, 0.95, 1.05, 0.95, 1.05, 1.05, 1.3]

/**
 * Dieselben Spalten für die Häuserübersicht, nur die ersten beiden getauscht:
 * dort steht der Hausname, der mehr Platz braucht als eine Geschossangabe. Die
 * Summe bleibt gleich, damit die Zahlenspalten mit den Tabellen darunter
 * fluchten.
 */
const UEBERSICHT_BREITEN = [2.0, 1.25, ...MENGEN_BREITEN.slice(2)]

/** Eine Mengenseite: Kennzahlen, Häuser und Zwischensummen in der Reihenfolge. */
function MengenSeite({
  daten, sicht, elemente, seite, seitenTotal, erste,
}: {
  daten: BerichtDaten
  sicht: MengenSicht
  elemente: MengenElement[]
  seite: number
  seitenTotal: number
  erste: boolean
}) {
  return (
    <InhaltsSeite daten={daten} seite={seite} seitenTotal={seitenTotal}>
      {erste && (
        <Text style={[s.h1, s.h1Kapitel]}>
          {sichtTitel('Mengen und Erträge', sicht)}
        </Text>
      )}
      {elemente.map((e, i) => {
        if (e.art === 'benchmarks') {
          return (
            <Datentabelle
              key={i}
              titel="Benchmarks"
              kopf={e.kopf}
              breiten={[2.4, ...e.kopf.slice(1).map(() => 1.2)]}
              zeilen={e.zeilen}
            />
          )
        }
        if (e.art === 'uebersicht') {
          return (
            <Datentabelle
              key={i}
              titel={e.titel}
              // Dieselbe Stufe wie die Haustitel darunter — die Übersicht ist
              // dieselbe Ebene, nur zusammengefasst.
              titelFarbe={e.block.farbeHaus ?? BERICHT_FARBE.primaerMittel}
              anschluss
              // Ihre letzte Zeile ist das Total der ganzen Sicht.
              totalFarbe={e.block.farbeTotal ?? BERICHT_FARBE.primaerHell}
              kopf={e.kopf}
              breiten={UEBERSICHT_BREITEN}
              linksBis={2}
              zeilen={e.zeilen}
            />
          )
        }
        if (e.art === 'eigTitel') {
          return (
            <Text key={i} style={e.block.farbe ? titelStil(e.block.farbe) : s.h2}>
              {e.block.label}
            </Text>
          )
        }
        if (e.art === 'eigTotal') {
          return (
            <Summenzeile
              key={i}
              zeile={e.zeile}
              kopf={e.kopf}
              breiten={MENGEN_BREITEN}
              grund={e.block.farbeTotal ?? BERICHT_FARBE.primaerHell}
            />
          )
        }
        return (
          <Datentabelle
            key={i}
            titel={e.fortsetzung ? `${e.name} (Fortsetzung)` : e.name}
            titelFarbe={e.block.farbeHaus ?? BERICHT_FARBE.primaerMittel}
            anschluss
            totalFarbe={e.block.farbeGrund}
            kopf={e.kopf}
            breiten={MENGEN_BREITEN}
            linksBis={1}
            zeilen={e.zeilen}
          />
        )
      })}
    </InhaltsSeite>
  )
}

/** Freistehende Summenzeile — das Total einer Eigentumsart ohne eigene Tabelle. */
function Summenzeile({
  zeile, kopf, breiten, grund,
}: { zeile: TabellenZeile; kopf: string[]; breiten: number[]; grund: string }) {
  // Die Hinterlegung kommt über die Zeile selbst, nicht über den Block —
  // sonst läge sie auch unter dem Abstand darunter.
  const t: Tabelle = { kopf, zeilen: [zeile], breiten, linksBis: 1, totalFarbe: grund }
  return (
    <View style={s.feldBlock}>
      <Datenzeile t={t} zeile={zeile} />
    </View>
  )
}

/** Blatt mit Wohnungsmix und Ertragsübersicht. */
function MixUndErtragSeite({
  daten, sicht, seite, seitenTotal,
}: { daten: BerichtDaten; sicht: MengenSicht; seite: number; seitenTotal: number }) {
  return (
    <InhaltsSeite daten={daten} seite={seite} seitenTotal={seitenTotal}>
      <Text style={[s.h1, s.h1Kapitel]}>{sichtTitel('Wohnungsmix und Erträge', sicht)}</Text>
      {sicht.wohnungsmix.filter((w) => w.aufMixblatt).map((w) => (
        <View key={`w-${w.label}`} style={s.zweiSpalten}>
          <View style={s.spalteEins}>
            <Datentabelle
              titel={w.label}
              titelFarbe={w.farbeUnter}
              kopf={['Wohnungstyp', 'Anzahl', 'Ø m²', 'Total m²']}
              breiten={[1.6, 1, 1, 1.1]}
              zeilen={w.zeilen}
            />
          </View>
          <View style={s.spalteZwei}>
            {(() => {
              const e = sicht.ertraege.find((x) => x.label === w.label)
              return e ? (
                <Datentabelle
                  titel={e.label}
                  titelFarbe={e.farbeUnter}
                  kopf={e.kopf}
                  breiten={[1.8, 1.2, 1.7, 1.55]}
                  zeilen={e.zeilen}
                />
              ) : null
            })()}
          </View>
        </View>
      ))}
      {/* Eigentumsarten ohne Wohnungen erscheinen nur mit ihren Erträgen. */}
      {sicht.ertraege
        .filter((e) => e.aufMixblatt)
        .filter((e) => !sicht.wohnungsmix.some((w) => w.aufMixblatt && w.label === e.label))
        .map((e) => (
          <Datentabelle
            key={`e-${e.label}`}
            titel={e.label}
            titelFarbe={e.farbeUnter}
            kopf={e.kopf}
            breiten={[1.8, 1.2, 1.7, 1.55]}
            zeilen={e.zeilen}
          />
        ))}
    </InhaltsSeite>
  )
}

/** Blatt mit dem Wohnungsmix als Balken. */
function WohnungsmixSeite({
  daten, sicht, seite, seitenTotal,
}: { daten: BerichtDaten; sicht: MengenSicht; seite: number; seitenTotal: number }) {
  return (
    <InhaltsSeite daten={daten} seite={seite} seitenTotal={seitenTotal}>
      <Text style={[s.h1, s.h1Kapitel]}>{sichtTitel('Wohnungsmix', sicht)}</Text>
      {sicht.wohnungsmix.map((w) => {
        const eintraege = w.zeilen
          .filter((r) => !r.total)
          .map((r) => ({ label: r.zellen[0], anzahl: Number(r.zellen[1].replace(/\D/g, '')) }))
        const palette = w.segmentFarben ?? CHART_PALETTE
        return (
          <View key={w.label}>
            <Text style={w.farbe ? titelStil(w.farbe) : s.h2}>{w.label}</Text>
            {/* Links die Verteilung als Ring, rechts die Zahlen als Balken —
                dieselben Werte, einmal als Anteil, einmal im Vergleich. */}
            <View style={s.zweiSpalten}>
              <View style={s.spalteEins}>
                <Ringdiagramm
                  titel="Verteilung nach Zimmerzahl"
                  anschluss
                  titelFarbe={w.farbeUnter ?? BERICHT_FARBE.primaerHell}
                  segmente={eintraege.map((e, i) => ({
                    label: e.label, wert: e.anzahl, farbe: palette[i % palette.length],
                  }))}
                />
              </View>
              <View style={s.spalteZwei}>
                <Wohnungsmix
                  titel="Anzahl Wohnungen"
                  anschluss
                  titelFarbe={w.farbeUnter ?? BERICHT_FARBE.primaerHell}
                  balkenFarbe={w.farbe}
                  zeilen={eintraege}
                />
              </View>
            </View>
          </View>
        )
      })}
    </InhaltsSeite>
  )
}

/** Das ganze Kapitel: je Sicht die Mengenseiten, das Mixblatt und die Grafik. */
function MengenKapitel({ daten, seite, seitenTotal }: Kapitelseite) {
  const m = daten.mengen
  if (!m || m.sichten.length === 0) {
    return (
      <InhaltsSeite daten={daten} seite={seite} seitenTotal={seitenTotal}>
        <Text style={[s.h1, s.h1Kapitel]}>Mengen und Erträge</Text>
        <Text style={s.hinweis}>Für diese Variante sind keine Gebäude erfasst.</Text>
      </InhaltsSeite>
    )
  }
  let nr = seite
  const gesetzt = umbruchSet(daten)
  const seiten: React.ReactNode[] = []
  for (const sicht of m.sichten) {
    for (const [i, elemente] of mengenSeiten(sicht, gesetzt).entries()) {
      seiten.push(
        <MengenSeite key={`${sicht.titel}-m${i}`} daten={daten} sicht={sicht}
          elemente={elemente} seite={nr++} seitenTotal={seitenTotal} erste={i === 0} />,
      )
    }
    if (hatMixblatt(sicht)) {
      seiten.push(
        <MixUndErtragSeite key={`${sicht.titel}-x`} daten={daten} sicht={sicht}
          seite={nr++} seitenTotal={seitenTotal} />,
      )
    }
    if (sicht.wohnungsmix.length > 0) {
      seiten.push(
        <WohnungsmixSeite key={`${sicht.titel}-g`} daten={daten} sicht={sicht}
          seite={nr++} seitenTotal={seitenTotal} />,
      )
    }
  }
  return <>{seiten}</>
}

/**
 * Kapitel „Nutzungsberechnung" auf einer Seite: Grundlagen und Zonen oben,
 * darunter die vier Wege in zwei Spalten, zuletzt der massgebende Wert.
 */
function NutzungKapitel({ daten, seite, seitenTotal }: Kapitelseite) {
  const n = daten.nutzung
  if (!n) {
    return (
      <InhaltsSeite daten={daten} seite={seite} seitenTotal={seitenTotal}>
        <Text style={[s.h1, s.h1Kapitel]}>Nutzungsberechnung</Text>
        <Text style={s.hinweis}>
          Für dieses Projekt sind keine Bauzonen mit Ausnutzungsziffern erfasst.
        </Text>
      </InhaltsSeite>
    )
  }

  const zweiSeitig = kapitelSeiten('stammdaten', daten) > 1
  // Bei einer einzigen Berechnungsart schliesst sie unter den Grundstücken an,
  // statt eine eigene Zeile unter dem Plan zu eröffnen — so bleibt die Seite
  // in zwei Spalten und der Plan wächst über alle drei Blöcke.
  const einWeg = n.wege.length === 1

  const kopfBereich = (
    // Links Zonenvorschriften über Grundstücken, rechts der Zonenplan. Er
    // wächst auf die Höhe der beiden Tabellen, statt eine eigene mitzubringen.
    <View style={s.zweiSpalten}>
      <View style={s.spalteHalbLinks}>
        <Datentabelle
          titel="Zonenvorschriften"
          kopf={n.zonen.kopf}
          // DG und UG tragen nur noch die Geschosszahl, die Ziffern brauchen
          // den Platz — dadurch reicht wieder mehr Abstand.
          breiten={[15, 11, 11.5, 10, 11.5, 7.5, 7, 6]}
          spaltenAbstand={2.4}
          zeilen={n.zonen.zeilen}
        />
        {/* Der Hinweis steht bei den Vorschriften, denn dort fehlt etwas —
            Plan und Bemerkungen erscheinen trotzdem. */}
        {n.wege.length === 0 && (
          <Text style={s.hinweisSpalte}>Keine Nutzungsmasse erfasst.</Text>
        )}
        <Datentabelle
          titel="Grundstücke"
          kopf={n.grundlagen.kopf}
          breiten={[1.5, 1.2, 1.1, 1.1]}
          linksBis={1}
          zeilen={n.grundlagen.zeilen}
        />
        {einWeg && (
          <Datentabelle
            titel={n.wege[0].titel}
            kopf={n.wege[0].kopf}
            breiten={[3, 1.2]}
            zeilen={n.wege[0].zeilen}
          />
        )}
      </View>
      <View style={s.spalteHalbRechts}>
        {n.zonenplanUrl && (
          <>
            <Text style={s.h2}>Zonenplan</Text>
            <View style={s.planSpalte}>
              <Image src={n.zonenplanUrl} style={s.plan} />
            </View>
            <Text style={s.legende}>Zonenplanausschnitt</Text>
          </>
        )}
      </View>
    </View>
  )

  const absaetze = alsAbsaetze(n.bemerkungen)
  const bemerkungenBlock = hatInhalt(absaetze) && (
    <View style={s.feldBlock}>
      <Text style={s.h2}>Bemerkungen</Text>
      <Freitext absaetze={absaetze} />
    </View>
  )

  const wegeBloecke = (
    <>
      {/* Die Wege paarweise nebeneinander — vier passen so auf die Seite. */}
      {Array.from({ length: Math.ceil(n.wege.length / 2) }, (_, r) => (
        <View key={r} style={s.zweiSpalten}>
          {[n.wege[r * 2], n.wege[r * 2 + 1]].map((w, i) => (
            <View key={i} style={i === 0 ? s.spalteHalbLinks : s.spalteHalbRechts}>
              {w && (
                <Datentabelle
                  titel={w.titel}
                  kopf={w.kopf}
                  breiten={[3, 1.2]}
                  zeilen={w.zeilen}
                />
              )}
            </View>
          ))}
        </View>
      ))}

      {/* Nur bei mehreren Wegen: dann ist der kleinste massgebend. Steht nur
          einer da, ist seine Schlusszeile bereits das Ergebnis. */}
      {n.wege.length > 1 && (
        <Feldtabelle
          titel="Massgebende Vermietungsfläche"
          kopf="Kleinster der Wege"
          labelBreite={60}
          einheitBreite={11.5}
          felder={[
            { label: n.massgebendWeg ?? 'kein Weg vollständig', einheit: 'm²',
              wert: n.massgebend != null ? formatNumber(Math.round(n.massgebend)) : '—' },
          ]}
        />
      )}
    </>
  )

  return (
    <>
      <InhaltsSeite daten={daten} seite={seite} seitenTotal={seitenTotal}>
        <Text style={[s.h1, s.h1Kapitel]}>Nutzungsberechnung</Text>
        {kopfBereich}
        {!zweiSeitig && !einWeg && wegeBloecke}
        {!zweiSeitig && bemerkungenBlock}
      </InhaltsSeite>

      {zweiSeitig && (
        <InhaltsSeite daten={daten} seite={seite + 1} seitenTotal={seitenTotal}>
          {wegeBloecke}
          {bemerkungenBlock}
        </InhaltsSeite>
      )}
    </>
  )
}

/**
 * Ausgezeichneter Freitext. Jeder Absatz wird ein Text, die Läufe darin
 * geschachtelte — react-pdf erbt die Stile dabei wie im Browser.
 */
function Freitext({ absaetze }: { absaetze: Absatz[] }) {
  return (
    <>
      {absaetze.map((a, i) => (
        <Text key={i} style={s.bemerkung}>
          {a.laeufe.map((l, j) => (
            <Text
              key={j}
              style={[
                ...(l.fett ? [{ fontWeight: 700 as const }] : []),
                ...(l.kursiv ? [{ fontStyle: 'italic' as const }] : []),
                ...(l.unterstrichen ? [{ textDecoration: 'underline' as const }] : []),
                ...(l.farbe ? [{ color: l.farbe }] : []),
              ]}
            >
              {l.text}
            </Text>
          ))}
        </Text>
      ))}
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
      <Text style={[s.h1, s.h1Kapitel]}>{kapitel.label}</Text>
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
    case 'mengengeruest':     return <MengenKapitel {...rest} />
    case 'stammdaten':        return <NutzungKapitel {...rest} />
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
