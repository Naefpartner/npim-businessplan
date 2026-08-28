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
  /** Seitenformat, das dieses Kapitel braucht. */
  format?: 'a4' | 'a4-quer' | 'a3'
}

/**
 * Katalog der Kapitel in Druckreihenfolge. Die Schlüssel landen in den
 * gespeicherten Vorlagen (Migration 063) — beim Umbenennen eines Kapitels
 * bleibt der Schlüssel deshalb stehen.
 */
export const BERICHT_KAPITEL: BerichtKapitel[] = [
  { key: 'titelblatt',        label: 'Titelblatt',                beschrieb: 'Projektbild, Auftraggeberin, Datum', fix: true },
  { key: 'inhalt',            label: 'Inhaltsverzeichnis',        beschrieb: 'Automatisch aus den gewählten Kapiteln', fix: true },
  { key: 'projektuebersicht', label: 'Projektübersicht',          beschrieb: 'Eckdaten, Adresse, Phase, Kunde' },
  { key: 'stammdaten',        label: 'Stammdaten',                beschrieb: 'Parzellen, Bestand, Baurechte' },
  { key: 'mengengeruest',     label: 'Mengen und Erträge',        beschrieb: 'Gebäude, Mietflächen, Mietzinse' },
  { key: 'mengenanalyse',     label: 'Mengen- und Mietzinsanalyse', beschrieb: 'Mietspiegel, Kennzahlen, Preisanalyse' },
  { key: 'anlagekosten',      label: 'Anlagekosten',              beschrieb: 'Kostenberechnung der gewählten Methode', format: 'a3' },
  { key: 'benchmarks',        label: 'Benchmarks',                beschrieb: 'Kennwertvergleich je Hauptgruppe' },
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

/** Seitenmasse in Millimeter. */
export const SEITE = {
  a4:      { breite: 210, hoehe: 297 },
  a4Quer:  { breite: 297, hoehe: 210 },
  a3:      { breite: 297, hoehe: 420 },
  a3Quer:  { breite: 420, hoehe: 297 },
} as const

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
  /** Weisser Kasten unten links; überlappt die Fläche und trägt den Titel. */
  titelKasten: { links: 17.5, oben: 130.4, breite: 102, hoehe: 56.8 },
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
  text: '#000000',
  grau: '#F1F1F1',      // lt2, Flächen
  h4: '#95654B',        // Überschrift 4
  linie: '#000000',
} as const

export const FUSSZEILE_FIRMA = 'Naef & Partner Immobilien AG'
/** Fusszeile des Titelblatts — Firmenadresse statt Dokumentbezug. */
export const FUSSZEILE_TITEL = 'Naef & Partner Immobilien AG  |  Bleicherweg 10  |  8002 Zürich  |  naefpartner.com'
/** Die Fusszeile bündelt links auf der Kante der Titelfläche, nicht am Satzspiegel. */
export const FUSSZEILE_LINKS = 17.5
