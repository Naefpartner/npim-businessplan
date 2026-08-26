// Kostenberechnung über Benchmarks: ein Kennwert je BKP-Hauptgruppe.
//
// Dritte Erfassungsmethode neben Detailkatalog und keeValue. Anders als der
// Detailkatalog kennt sie nur eine Zeile je Hauptgruppe — für Grobschätzungen
// in frühen Phasen, wenn noch kein Positionsraster gefüllt werden kann.

import { HAUPTGRUPPEN, type BkpHauptgruppe } from '@/lib/bkpKatalog'
import type { AnsatzEinheit } from '@/components/projects/AnsatzEingabe'

/** Bezugsgrösse, über die BKP 2 gerechnet wird. */
export type Bkp2Methode = 'gf' | 'gv' | 'vmf'

export const BKP2_METHODE_LABEL: Record<Bkp2Methode, string> = {
  gf:  'Geschossfläche GF',
  gv:  'Gebäudevolumen GV',
  vmf: 'Mietfläche VMF / VKF',
}

/** Die erfassten Kennwerte je Variante (Migration 061). */
export interface BenchmarkDoc {
  /** BKP 0 Grundstück: CHF pro m² Grundstücksfläche. */
  bkp0ChfProM2Gsf: number | null
  /** BKP 1 Vorbereitungsarbeiten: Anteil an BKP 2. */
  bkp1ProzentVonBkp2: number | null
  /** BKP 2 Gebäude: über welche Bezugsgrösse gerechnet wird. */
  bkp2Methode: Bkp2Methode
  /** BKP 2 über GF: CHF pro m² Geschossfläche. */
  bkp2ChfProM2Gf: number | null
  /** BKP 2 über GV, oberirdischer Anteil: CHF pro m³. */
  bkp2ChfProM3Oi: number | null
  /** BKP 2 über GV, unterirdischer Anteil: CHF pro m³. */
  bkp2ChfProM3Ui: number | null
  /** BKP 2 über VMF: CHF pro m² Miet-/Verkaufsfläche. */
  bkp2ChfProM2Vmf: number | null
  /** BKP 3 Betriebseinrichtungen: Pauschalbetrag in CHF. */
  bkp3Pauschal: number | null
  /** BKP 4 Umgebung: CHF pro m² bearbeitete Umgebungsfläche. */
  bkp4ChfProM2Buf: number | null
  /** BKP 5 Baunebenkosten: Anteil an BKP 1–4. */
  bkp5ProzentVon1bis4: number | null
  /** BKP 6 Honorare: Anteil an BKP 1–4. */
  bkp6ProzentVon1bis4: number | null
  /** BKP 7 Vermarktung: Anteil am Miet- bzw. Verkaufsertrag. */
  bkp7ProzentVonErtrag: number | null
  /** BKP 8 Entwicklung: Anteil an BKP 1–7. */
  bkp8ProzentVon1bis7: number | null
  /** BKP 9 Eigentümer / Investor: Anteil an BKP 1–8. */
  bkp9ProzentVon1bis8: number | null
}

export const LEERER_BENCHMARK: BenchmarkDoc = {
  bkp0ChfProM2Gsf: null,
  bkp1ProzentVonBkp2: null,
  bkp2Methode: 'gf',
  bkp2ChfProM2Gf: null,
  bkp2ChfProM3Oi: null,
  bkp2ChfProM3Ui: null,
  bkp2ChfProM2Vmf: null,
  bkp3Pauschal: null,
  bkp4ChfProM2Buf: null,
  bkp5ProzentVon1bis4: null,
  bkp6ProzentVon1bis4: null,
  bkp7ProzentVonErtrag: null,
  bkp8ProzentVon1bis7: null,
  bkp9ProzentVon1bis8: null,
}

/** Fehlende Felder auffüllen — `doc` kommt als beliebiges JSONB aus der DB. */
export function normalizeBenchmark(doc: Partial<BenchmarkDoc> | null | undefined): BenchmarkDoc {
  const roh = { ...LEERER_BENCHMARK, ...(doc ?? {}) }
  // Gegen ungültige Altwerte absichern — die Methode steuert die Berechnung.
  if (!['gf', 'gv', 'vmf'].includes(roh.bkp2Methode)) roh.bkp2Methode = 'gf'
  return roh
}

/** Zahlenfelder des Dokuments — nur die darf die Ansatz-Eingabe setzen. */
export type BenchmarkZahlfeld = Exclude<keyof BenchmarkDoc, 'bkp2Methode'>

export interface BenchmarkZeile {
  /** Hauptgruppe; bei Unterzeilen die der übergeordneten Gruppe. */
  code: BkpHauptgruppe
  label: string
  /** 0 = Hauptgruppe, 1 = Unterzeile (ober-/unterirdisch bei BKP 2 über GV). */
  ebene: 0 | 1
  netto: number
  brutto: number
  /** Kennwert-Feld, das diese Zeile bearbeitet. */
  feld?: BenchmarkZahlfeld
  ansatzWert?: number | null
  ansatzEinheit?: AnsatzEinheit
  /** Bezugsgrösse im Klartext, z.B. „× GSF 1'200 m²". */
  ansatzBasis?: string
  /** Auf der BKP-2-Zeile: Auswahl der Bezugsgrösse anzeigen. */
  methodeWahl?: boolean
  /** Kennwert in CHF/m² GF inkl. MwSt — einheitlich wie bei keeValue. */
  chfProM2Gf: number | null
}

export interface BenchmarkBezug {
  /** Grundstücksfläche (m²) aus den Parzellen. */
  gsfTotal: number
  /** Geschossfläche (m²) aus dem Mengengerüst — auch Bezug der Kennwertspalte. */
  gfM2: number
  /** Gebäudevolumen (m³) total. */
  gvM3: number
  /** Davon unterirdisch (m³). */
  gvUiM3: number
  /** Miet-/Verkaufsfläche (m²) total. */
  vmfM2: number
  /**
   * Bearbeitete Umgebungsfläche (m²) = Parzelle minus Erdgeschossflächen,
   * gleiche Herleitung wie im keeValue-Panel. null = kein EG bezeichnet.
   */
  bufM2: number | null
  /** Jahresmietertrag bzw. Verkaufserlös der Variante (Basis für BKP 7). */
  ertragBasis: number
  /** Globaler MwSt-Satz der Variante, z.B. 0.081. */
  mwstSatz: number
}

export interface BenchmarkErgebnis {
  zeilen: BenchmarkZeile[]
  totalNetto: number
  totalBrutto: number
}

/** Ganzzahl mit Tausender-Hochkomma — für die Basistexte in der UI. */
function formatMenge(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'")
}

/** „× GF 2'378 m²" bzw. der Hinweis, dass die Bezugsgrösse fehlt. */
function basisText(praefix: string, menge: number, einheit: string): string {
  return menge > 0 ? `${praefix} ${formatMenge(menge)} ${einheit}` : `${praefix} — nicht erfasst`
}

/**
 * Baut die Zeilen der Benchmark-Kostenberechnung — eine je Hauptgruppe 0–9.
 *
 *   BKP 0 Grundstück    — CHF/m² × Grundstücksfläche aus den Parzellen
 *   BKP 1 Vorbereitung  — % von BKP 2
 *   BKP 2 Gebäude       — wahlweise über GF, GV (getrennt ober-/unterirdisch)
 *                         oder VMF; die Wahl steht im Dokument
 *   BKP 3 Betriebseinr. — Pauschalbetrag
 *   BKP 4 Umgebung      — CHF/m² × bearbeitete Umgebungsfläche
 *   BKP 5 Baunebenkosten— % von BKP 1–4
 *   BKP 6 Honorare      — % von BKP 1–4
 *   BKP 7 Vermarktung   — % vom Miet- bzw. Verkaufsertrag
 *   BKP 8 Entwicklung   — % von BKP 1–7
 *   BKP 9 Eigentümer    — % von BKP 1–8
 *
 * Gerechnet wird in Abhängigkeitsreihenfolge, nicht in Nummernfolge: BKP 2
 * zuerst, weil BKP 1 darauf Bezug nimmt — dieselbe Vorwärtsreferenz wie bei der
 * Katalogposition 160. Danach 3 und 4, dann die Prozentgruppen aufsteigend.
 *
 * Alle Prozentsätze rechnen auf den Netto-Beträgen, die MwSt kommt je Zeile
 * obendrauf — Konvention wie in lib/bkpBerechnung.ts. MwSt-frei sind Grundstück
 * und die Eigentümerkosten, analog den Katalogpositionen 010 und 910/920.
 *
 * BKP 0 bleibt in allen Prozentbasen aussen vor, ebenfalls wie im Katalog, wo
 * die Positionen 810 und 910 erst bei Hauptgruppe 1 ansetzen.
 */
export function benchmarkZeilen(doc: BenchmarkDoc, bezug: BenchmarkBezug): BenchmarkErgebnis {
  const mitMwst = (netto: number) => netto * (1 + bezug.mwstSatz)
  const gvOiM3 = Math.max(0, bezug.gvM3 - bezug.gvUiM3)

  // ─── BKP 2 zuerst: Bezugsgrösse nach gewählter Methode ────────────────────
  const bkp2Unterzeilen: Omit<BenchmarkZeile, 'chfProM2Gf'>[] = []
  let n2 = 0
  let bkp2Ansatz: Partial<BenchmarkZeile> = {}

  if (doc.bkp2Methode === 'gf') {
    n2 = (doc.bkp2ChfProM2Gf ?? 0) * bezug.gfM2
    bkp2Ansatz = {
      feld: 'bkp2ChfProM2Gf',
      ansatzWert: doc.bkp2ChfProM2Gf,
      ansatzEinheit: 'CHF/m²',
      ansatzBasis: basisText('× GF', bezug.gfM2, 'm²'),
    }
  } else if (doc.bkp2Methode === 'vmf') {
    n2 = (doc.bkp2ChfProM2Vmf ?? 0) * bezug.vmfM2
    bkp2Ansatz = {
      feld: 'bkp2ChfProM2Vmf',
      ansatzWert: doc.bkp2ChfProM2Vmf,
      ansatzEinheit: 'CHF/m²',
      ansatzBasis: basisText('× VMF/VKF', bezug.vmfM2, 'm²'),
    }
  } else {
    // Über das Volumen getrennt nach Lage — unterirdisch baut sich anders als
    // oberirdisch, deshalb zwei Kennwerte statt eines Mischwerts.
    const oiNetto = (doc.bkp2ChfProM3Oi ?? 0) * gvOiM3
    const uiNetto = (doc.bkp2ChfProM3Ui ?? 0) * bezug.gvUiM3
    n2 = oiNetto + uiNetto
    bkp2Unterzeilen.push(
      {
        code: 2, label: 'Oberirdisch', ebene: 1,
        netto: oiNetto, brutto: mitMwst(oiNetto),
        feld: 'bkp2ChfProM3Oi',
        ansatzWert: doc.bkp2ChfProM3Oi,
        ansatzEinheit: 'CHF/m³',
        ansatzBasis: basisText('× GV', gvOiM3, 'm³'),
      },
      {
        code: 2, label: 'Unterirdisch', ebene: 1,
        netto: uiNetto, brutto: mitMwst(uiNetto),
        feld: 'bkp2ChfProM3Ui',
        ansatzWert: doc.bkp2ChfProM3Ui,
        ansatzEinheit: 'CHF/m³',
        ansatzBasis: basisText('× GV', bezug.gvUiM3, 'm³'),
      },
    )
  }

  // ─── Übrige Gruppen in Abhängigkeitsreihenfolge ──────────────────────────
  const buf = bezug.bufM2 ?? 0
  const n0 = (doc.bkp0ChfProM2Gsf ?? 0) * bezug.gsfTotal
  const n1 = (doc.bkp1ProzentVonBkp2 ?? 0) * n2
  const n3 = doc.bkp3Pauschal ?? 0
  const n4 = (doc.bkp4ChfProM2Buf ?? 0) * buf
  const basis1bis4 = n1 + n2 + n3 + n4
  const n5 = (doc.bkp5ProzentVon1bis4 ?? 0) * basis1bis4
  const n6 = (doc.bkp6ProzentVon1bis4 ?? 0) * basis1bis4
  const n7 = (doc.bkp7ProzentVonErtrag ?? 0) * bezug.ertragBasis
  const basis1bis7 = basis1bis4 + n5 + n6 + n7
  const n8 = (doc.bkp8ProzentVon1bis7 ?? 0) * basis1bis7
  const basis1bis8 = basis1bis7 + n8
  const n9 = (doc.bkp9ProzentVon1bis8 ?? 0) * basis1bis8

  const label = (c: BkpHauptgruppe) => HAUPTGRUPPEN.find((h) => h.code === c)!.label
  const roh: Omit<BenchmarkZeile, 'chfProM2Gf'>[] = [
    {
      code: 0, label: label(0), ebene: 0,
      netto: n0, brutto: n0, // Grundstückerwerb ist nicht MwSt-pflichtig
      feld: 'bkp0ChfProM2Gsf', ansatzWert: doc.bkp0ChfProM2Gsf, ansatzEinheit: 'CHF/m²',
      ansatzBasis: basisText('× GSF', bezug.gsfTotal, 'm²'),
    },
    {
      code: 1, label: label(1), ebene: 0,
      netto: n1, brutto: mitMwst(n1),
      feld: 'bkp1ProzentVonBkp2', ansatzWert: doc.bkp1ProzentVonBkp2, ansatzEinheit: '%',
      ansatzBasis: `von BKP 2 ${formatMenge(n2)} CHF`,
    },
    {
      code: 2, label: label(2), ebene: 0,
      netto: n2, brutto: mitMwst(n2),
      methodeWahl: true,
      ...bkp2Ansatz,
    },
    ...bkp2Unterzeilen,
    {
      code: 3, label: label(3), ebene: 0,
      netto: n3, brutto: mitMwst(n3),
      feld: 'bkp3Pauschal', ansatzWert: doc.bkp3Pauschal, ansatzEinheit: 'CHF',
      ansatzBasis: 'Pauschalbetrag',
    },
    {
      code: 4, label: label(4), ebene: 0,
      netto: n4, brutto: mitMwst(n4),
      feld: 'bkp4ChfProM2Buf', ansatzWert: doc.bkp4ChfProM2Buf, ansatzEinheit: 'CHF/m²',
      ansatzBasis: bezug.bufM2 != null
        ? basisText('× UF', buf, 'm²')
        : '× UF — kein Erdgeschoss bezeichnet',
    },
    {
      code: 5, label: label(5), ebene: 0,
      netto: n5, brutto: mitMwst(n5),
      feld: 'bkp5ProzentVon1bis4', ansatzWert: doc.bkp5ProzentVon1bis4, ansatzEinheit: '%',
      ansatzBasis: `von BKP 1–4 ${formatMenge(basis1bis4)} CHF`,
    },
    {
      code: 6, label: label(6), ebene: 0,
      netto: n6, brutto: mitMwst(n6),
      feld: 'bkp6ProzentVon1bis4', ansatzWert: doc.bkp6ProzentVon1bis4, ansatzEinheit: '%',
      ansatzBasis: `von BKP 1–4 ${formatMenge(basis1bis4)} CHF`,
    },
    {
      code: 7, label: label(7), ebene: 0,
      netto: n7, brutto: mitMwst(n7),
      feld: 'bkp7ProzentVonErtrag', ansatzWert: doc.bkp7ProzentVonErtrag, ansatzEinheit: '%',
      ansatzBasis: `von Ertrag / Verkaufserlös ${formatMenge(bezug.ertragBasis)} CHF`,
    },
    {
      code: 8, label: label(8), ebene: 0,
      netto: n8, brutto: mitMwst(n8),
      feld: 'bkp8ProzentVon1bis7', ansatzWert: doc.bkp8ProzentVon1bis7, ansatzEinheit: '%',
      ansatzBasis: `von BKP 1–7 ${formatMenge(basis1bis7)} CHF`,
    },
    {
      code: 9, label: label(9), ebene: 0,
      netto: n9, brutto: n9, // Eigenleistungen sind nicht MwSt-pflichtig
      feld: 'bkp9ProzentVon1bis8', ansatzWert: doc.bkp9ProzentVon1bis8, ansatzEinheit: '%',
      ansatzBasis: `von BKP 1–8 ${formatMenge(basis1bis8)} CHF`,
    },
  ]

  // Kennwertspalte einheitlich über die Geschossfläche, brutto — gleiche
  // Konvention wie in der keeValue-Tabelle.
  const zeilen: BenchmarkZeile[] = roh.map((z) => ({
    ...z,
    chfProM2Gf: bezug.gfM2 > 0 ? z.brutto / bezug.gfM2 : null,
  }))

  const hauptgruppen = zeilen.filter((z) => z.ebene === 0)
  return {
    zeilen,
    totalNetto: hauptgruppen.reduce((s, z) => s + z.netto, 0),
    totalBrutto: hauptgruppen.reduce((s, z) => s + z.brutto, 0),
  }
}
