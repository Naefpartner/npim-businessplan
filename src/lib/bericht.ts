// Businessplan-Bericht: Kapitelkatalog und Layoutmasse der Naef-Vorlage.
//
// Die Masse stammen aus NPIM_Bericht.dotx (Word-Vorlage) und sind dort in
// Twips/EMU hinterlegt; hier in Millimeter umgerechnet. Punktangaben sind
// Typografie-Punkte, wie sie @react-pdf/renderer erwartet.

/** Ein druckbares Kapitel des Berichts. */
export interface BerichtKapitel {
  key: string
  label: string
  /** Kurzbeschrieb für die Auswahlliste. */
  beschrieb: string
  /**
   * Kapitel, die im Bericht immer erscheinen und nicht abwählbar sind
   * (Titelblatt, Inhaltsverzeichnis).
   */
  fix?: boolean
  /** Seitenformat, das dieses Kapitel braucht; ohne Angabe A4 hoch. */
  format?: SeitenFormat
}

/**
 * Seitenformate des Berichts. A4 hoch ist der Standard; breite Tabellen
 * bekommen A3 hoch, sehr breite Gegenüberstellungen ein Querformat — so hält
 * es auch die Word-Vorlage, die Abschnitte in allen vier Formaten führt.
 */
export type SeitenFormat = 'a4' | 'a4-quer' | 'a3' | 'a3-quer'

/**
 * Beschriftung des ersten Blocks auf dem Titelblatt. Die Vorlage schreibt
 * „Auftraggeberin"; je nach Kundschaft passt die männliche Form besser,
 * deshalb wählbar.
 */
export type AuftragAnrede = 'Auftraggeberin' | 'Auftraggeber'

export const AUFTRAG_ANREDEN: AuftragAnrede[] = ['Auftraggeberin', 'Auftraggeber']

/**
 * Umfang der Kapitel, die es sowohl für das Gesamtprojekt als auch je Etappe
 * gibt — derzeit die Mengen. Ohne zweite Etappe fällt die Wahl weg, dann gibt
 * es nur das Gesamtprojekt.
 */
export type EtappenUmfang = 'gesamt' | 'etappen' | 'beide'

export const ETAPPEN_UMFANG: { key: EtappenUmfang; label: string; beschrieb: string }[] = [
  { key: 'gesamt',  label: 'Gesamt',  beschrieb: 'Nur das Gesamtprojekt' },
  { key: 'etappen', label: 'Etappen', beschrieb: 'Nur die Etappen einzeln' },
  { key: 'beide',   label: 'Beides',  beschrieb: 'Gesamtprojekt und Etappen' },
]

/**
 * Katalog der Kapitel in Druckreihenfolge. Die Schlüssel landen in den
 * gespeicherten Vorlagen (Migration 063) — beim Umbenennen eines Kapitels
 * bleibt der Schlüssel deshalb stehen.
 */
export const BERICHT_KAPITEL: BerichtKapitel[] = [
  { key: 'titelblatt',        label: 'Titelblatt',                beschrieb: 'Projektbild, Auftraggeberin, Datum', fix: true },
  { key: 'inhalt',            label: 'Inhaltsverzeichnis',        beschrieb: 'Automatisch aus den gewählten Kapiteln', fix: true },
  { key: 'projektuebersicht', label: 'Projektübersicht',          beschrieb: 'Eckdaten, Adresse, Phase, Kunde' },
  // Schlüssel bleibt 'stammdaten': gespeicherte Vorlagen (Migration 063)
  // führen ihn, das Kapitel hat nur einen neuen Inhalt bekommen.
  { key: 'stammdaten',        label: 'Nutzungsberechnung',        beschrieb: 'Ausnutzung nach AZ, BM, ÜZ und FFZ' },
  { key: 'mengengeruest',     label: 'Mengen und Erträge',        beschrieb: 'Gebäude, Mietflächen, Mietzinse' },
  { key: 'wohnungsmix',       label: 'Wohnungsmix',               beschrieb: 'Verteilung nach Zimmerzahl und Mietspiegel' },
  { key: 'mengenanalyse',     label: 'Mengen- und Mietzinsanalyse', beschrieb: 'Kennzahlen und Preisanalyse' },
  { key: 'anlagekosten',      label: 'Anlagekosten',              beschrieb: 'Kostenberechnung der gewählten Methode', format: 'a3' },
  { key: 'anlagekostenlimiten', label: 'Anlagekostenlimiten',  beschrieb: 'Wohnbauförderung WBF und BWO, nur Genossenschaft' },
  // Schlüssel bleibt 'benchmarks': gespeicherte Vorlagen führen ihn.
  { key: 'benchmarks',        label: 'Kennwerte',                 beschrieb: 'Flächen- und Volumenkennwerte, Kostenkennwerte' },
  { key: 'wirtschaftlichkeit', label: 'Wirtschaftlichkeit',       beschrieb: 'Kostenmiete, Rendite, Verkaufsgewinn' },
  { key: 'mittelfluss',       label: 'Mittelflussrechnung',       beschrieb: 'Terminplan und Quartalsverteilung', format: 'a3' },
  { key: 'honorare',          label: 'Honorarrechner',            beschrieb: 'Planerhonorare nach SIA' },
  { key: 'variantenvergleich', label: 'Variantenvergleich',       beschrieb: 'Gegenüberstellung aller Varianten', format: 'a4-quer' },
]

/** Kapitel, die immer gedruckt werden. */
export const FIXE_KAPITEL = BERICHT_KAPITEL.filter((k) => k.fix).map((k) => k.key)

/** Wählbare Kapitel — alles ausser Titelblatt und Inhaltsverzeichnis. */
export const WAEHLBARE_KAPITEL = BERICHT_KAPITEL.filter((k) => !k.fix)

/** Kapitel eines Schlüssels; unbekannte Schlüssel (alte Vorlage) fallen weg. */
export function kapitelFuer(keys: string[]): BerichtKapitel[] {
  const nach = new Map(BERICHT_KAPITEL.map((k) => [k.key, k]))
  return keys.map((k) => nach.get(k)).filter((k): k is BerichtKapitel => !!k)
}

/**
 * Bringt eine Auswahl in die Katalogreihenfolge. Gespeicherte Vorlagen sollen
 * unabhängig von der Klickreihenfolge immer gleich gedruckt werden.
 */
export function sortiereKapitel(keys: string[]): string[] {
  const rang = new Map(BERICHT_KAPITEL.map((k, i) => [k.key, i]))
  return [...new Set(keys)]
    .filter((k) => rang.has(k))
    .sort((a, b) => rang.get(a)! - rang.get(b)!)
}

// ── Layout der Naef-Vorlage ──────────────────────────────────────────────────

/**
 * Seitenmasse in Millimeter, nach ISO 216. `size` und `orientation` gehen
 * unverändert an @react-pdf — dessen A4/A3 entsprechen exakt diesen Massen,
 * eigene Punktwerte sind also unnötig.
 */
export const SEITE: Record<SeitenFormat, {
  breite: number
  hoehe: number
  size: 'A4' | 'A3'
  quer: boolean
}> = {
  'a4':      { breite: 210, hoehe: 297, size: 'A4', quer: false },
  'a4-quer': { breite: 297, hoehe: 210, size: 'A4', quer: true },
  'a3':      { breite: 297, hoehe: 420, size: 'A3', quer: false },
  'a3-quer': { breite: 420, hoehe: 297, size: 'A3', quer: true },
}

/** Breite des Satzspiegels eines Formats. */
export function satzBreite(format: SeitenFormat): number {
  return SEITE[format].breite - RAND.links - RAND.rechts
}

/**
 * Breite der Fusszeile. Sie beginnt links auf der Kante der Titelfläche
 * (17.5 mm) und endet auf dem rechten Satzspiegelrand.
 */
export function fussBreite(format: SeitenFormat): number {
  return SEITE[format].breite - RAND.rechts - FUSSZEILE_LINKS
}

/** Satzspiegel in Millimeter — links breiter für die Bundstegablage. */
export const RAND = {
  oben: 28.5,
  unten: 27,
  links: 30,
  rechts: 12.5,
  kopf: 12.5,
  fuss: 11.1,
} as const

/**
 * Titelblatt. Alle Werte in Millimeter, nachgemessen am PDF-Export der
 * Vorlage (dort auf Letter skaliert, Faktor 0.941 — hier zurückgerechnet).
 *
 * Aufbau: eine kupferne Fläche mit zwei weissen Aussparungen. Oben links sitzt
 * die Wortmarke, unten links ein weisser Kasten mit dem Titel — der Titel steht
 * also schwarz auf Weiss, nicht weiss auf der Fläche.
 */
export const TITELBLATT = {
  flaeche: { links: 17.5, oben: 12.5, breite: 180, hoehe: 136.6 },
  /** Aussparung oben links, in der die Wortmarke steht. */
  logoEcke: { breite: 59.4, hoehe: 17.35 },
  /**
   * Weisser Kasten unten links; überlappt die Fläche und trägt den Titel.
   * Die Breite ergibt sich aus dem Titel — der Kasten wächst mit und reicht
   * `ueberhangRechts` über die längste Zeile hinaus. Begrenzt wird er auf die
   * rechte Kante der Kupferfläche, damit ein langer Titel nicht über die Seite
   * hinausläuft; er bricht dann um.
   */
  titelKasten: { links: 17.5, oben: 130.4, ueberhangRechts: 12 },
  /**
   * Überstand der weissen Aussparungen über die Kante der Kupferfläche hinaus.
   * Liegen sie exakt auf der Kante, bleibt eine Pixelzeile der kantengeglätteten
   * Fläche sichtbar — eine feine Linie am Ausschnitt. Ausserhalb der Fläche ist
   * die Seite weiss, der Überstand fällt also nicht auf.
   */
  ueberstand: 1,
  /** Titelzeilen — eingerückt auf den Satzspiegel, nicht auf den Kasten. */
  titel: { links: 30, oben: 141.5 },
  /** Angabentabelle Auftraggeberin / Beauftragte / Datum. */
  angaben: {
    links: 30,
    /** Spalte der Werte. */
    wertLinks: 55,
    rechts: 111.9,
    /** Oberkante der ersten Trennlinie. */
    ersteLinie: 183.4,
    /** Abstand von der Linie zur ersten Textzeile darunter. */
    textNachLinie: 1.4,
    /** Abstand vom letzten Text zur Linie darunter. */
    textVorLinie: 0.9,
    /** Höhe eines Blocks mit drei Zeilen bzw. mit zwei Zeilen. */
    zeilenAbstand: 4.2,
  },
} as const

/**
 * Logo: Wortmarke auf dem Titelblatt, Bildmarke auf den Folgeseiten.
 *
 * Bei der Wortmarke steht bewusst nur die Breite — die Höhe folgt dem
 * Seitenverhältnis der Bilddatei. Ein fester Rahmen verzerrte den Schriftzug,
 * weil die Datei ein anderes Verhältnis hat als der Rahmen der Word-Vorlage.
 * Die Werte sind am Schriftzug der Vorlage gemessen (46.97 × 5.04 mm).
 */
export const LOGO = {
  titel:  { links: 17.5, oben: 12.5, breite: 47.0 },
  folge:  { rechts: 12.5, oben: 12.5, breite: 10.0, hoehe: 10.0 },
} as const

/** Inhaltsverzeichnis — Spalten und Linien, nachgemessen an Seite 4. */
export const INHALT = {
  titel: 'Inhalt',
  /** Nummer und Text der obersten Ebene. */
  ebene1: { nummer: 30, text: 36, linieLinks: 29.5 },
  /** Nummer und Text der Unterebenen. */
  ebene2: { nummer: 36, text: 46, linieLinks: 35.5 },
  /** Rechte Kante von Seitenzahl und Linien. */
  rechts: 197.9,
  /** Abstand der Trennlinie unter der Textoberkante. */
  linieUnterText: 5.3,
  /** Zeilenhöhe innerhalb einer Ebene und zusätzlicher Vorabstand vor Ebene 1. */
  zeilenHoehe: 6.3,
  vorEbene1: 4.9,
  /** Abstand von der Überschrift „Inhalt" zum ersten Eintrag. */
  nachTitel: 3.5,
} as const

/** Schriftgrade in Punkt, aus den Word-Formatvorlagen. */
export const SCHRIFT = {
  familie: 'Euclid NP',
  grund: 9,
  zeile: 12,      // 240 Twips
  titel: 20,
  titelZeile: 25, // 500 Twips
  h1: 14,
  h1Zeile: 19,
  h2: 11,
  h2Zeile: 15,
  h3: 9,
  klein: 8,       // Kopf-, Fusszeile, Legenden
  kleinZeile: 11,
} as const

/** Farben der Vorlage — deckungsgleich mit der CI im Tool (lib/ci.ts). */
export const BERICHT_FARBE = {
  primaer: '#B98C74',   // accent1, Kupfer 7 — Titelfläche
  primaerMittel: '#E7AF90', // Kupfer 5 — Untertitel eine Stufe unter dem Balken
  primaerHell: '#F2D3C2', // Kupfer 3 — Untertitel unter einer Titelfläche
  primaerZart: '#FAEFE9', // Kupfer 1 — Hinterlegung von Summenzeilen
  text: '#000000',
  grau: '#F1F1F1',      // lt2, Flächen
  h4: '#95654B',        // Überschrift 4
  linie: '#000000',
} as const

/**
 * Spaltenraster einer Herleitung: Bezeichnung, Menge mit Einheit, Ansatz mit
 * Einheit, Betrag. Die Zahlen stehen rechtsbündig untereinander, ihre Einheit
 * linksbündig daneben; die Zahlenspalten sind auf ihren längsten Inhalt
 * bemessen, der Rest gehört der Bezeichnung. Kostenmiete und
 * Anlagekostenlimiten rechnen im selben Raster — die Tabellen sollen sich
 * gleich lesen.
 */
export const RASTER_HERLEITUNG: {
  breiten: number[]
  einheitenSpalten: number[]
  spaltenAbstand: number
} = {
  breiten: [79, 17, 16, 20, 15, 18],
  einheitenSpalten: [2, 4],
  /** Engerer Steg als die üblichen 3 mm — sechs Spalten brauchen die Breite. */
  spaltenAbstand: 2,
}

/**
 * Dasselbe Raster mit einer Spalte für Zwischenwerte vor dem Betrag. Wo eine
 * Herleitung über eine Zwischengrösse läuft — der Gebäudeversicherungswert
 * etwa —, steht deren Ergebnis dort und nicht in der Betragsspalte, die sonst
 * Werte und Jahresbeträge vermischte.
 */
/** Breite einer Wertspalte der Sensitivitätstafel, in Anteilen. */
const MATRIX_WERT = 15
/** Anteile einer ganzen Tafelzeile — Beschriftung und fünf Wertspalten. */
const MATRIX_TOTAL = 26 + 5 * MATRIX_WERT

/**
 * Raster einer Sensitivitätstafel: links die Beschriftung der Zeilenachse,
 * daneben fünf gleich breite Wertspalten.
 */
export const RASTER_MATRIX: { breiten: number[]; spaltenAbstand: number } = {
  breiten: [26, ...Array<number>(5).fill(MATRIX_WERT)],
  spaltenAbstand: 3,
}

/**
 * Raster einer Tabelle, die unter einer Sensitivitätstafel steht: ihre
 * Zahlenspalten sind so breit wie die der Tafel und stehen mit deren rechten
 * Spalten auf einer Flucht. Was links übrig bleibt, gehört der Bezeichnung.
 */
export function rasterAufMatrix(
  spalten: number,
  /**
   * Zuschlag je Wertspalte, aus der Bezeichnung genommen. Eine breitere Spalte
   * schiebt nur die Spalten links von ihr nach links; ihr rechter Rand und
   * alles rechts davon bleibt auf der Flucht. Für Zellen, die Zahl und Einheit
   * tragen und in der Tafelbreite nicht Platz haben.
   */
  zuschlaege: number[] = [],
): { breiten: number[]; spaltenAbstand: number } {
  const werte = Array<number>(spalten).fill(MATRIX_WERT)
    .map((w, i) => w + (zuschlaege[i] ?? 0))
  const summe = werte.reduce((a, b) => a + b, 0)
  return { breiten: [MATRIX_TOTAL - summe, ...werte], spaltenAbstand: 3 }
}

export const FUSSZEILE_FIRMA = 'Naef & Partner Immobilien AG'
/** Fusszeile des Titelblatts — Firmenadresse statt Dokumentbezug. */
export const FUSSZEILE_TITEL = 'Naef & Partner Immobilien AG  |  Bleicherweg 10  |  8002 Zürich  |  naefpartner.com'
/** Die Fusszeile bündelt links auf der Kante der Titelfläche, nicht am Satzspiegel. */
export const FUSSZEILE_LINKS = 17.5
