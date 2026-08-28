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
  fuss: 11.7,
} as const

/**
 * Titelblatt: farbige Fläche mit ausgeschnittener Ecke oben links, in der das
 * Logo sitzt. Masse und Ausschnitt exakt aus der Vorlage.
 */
export const TITELFLAECHE = {
  links: 17.5,
  oben: 12.5,
  breite: 180,
  hoehe: 136.6,
  /** Ausschnitt oben links, in dem das Logo steht. */
  ausschnittBreite: 59.4,
  ausschnittHoehe: 17.35,
  /** Vollflächige Variante der Vorlage. */
  hoeheGross: 257.3,
} as const

/** Logo auf dem Titelblatt (Wortmarke) und auf Folgeseiten (Bildmarke). */
export const LOGO = {
  titel:  { links: 16.5, oben: 11.5, breite: 49.2, hoehe: 7.2 },
  folge:  { rechts: 11.1, oben: 11.5, breite: 12.1, hoehe: 12.1 },
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
} as const

/** Absätze der Fusszeile — erst ab Seite 2 sichtbar, wie in der Vorlage. */
export const FUSSZEILE_FIRMA = 'Naef & Partner Immobilien AG'
