// Kostenberechnung über Benchmarks: ein Kennwert je BKP-Hauptgruppe.
//
// Dritte Erfassungsmethode neben Detailkatalog und keeValue. Die Hauptgruppen
// werden schrittweise ausgebaut; jede bekommt ihre eigene Bezugsgrösse. Noch
// nicht definierte Gruppen erscheinen als offene Zeilen, damit die Gliederung
// vollständig bleibt und sichtbar ist, was noch fehlt.

import { HAUPTGRUPPEN, type BkpHauptgruppe } from '@/lib/bkpKatalog'
import type { AnsatzEinheit } from '@/components/projects/AnsatzEingabe'

/** Die erfassten Kennwerte je Variante (Migration 061). */
export interface BenchmarkDoc {
  /** BKP 0 Grundstück: CHF pro m² Grundstücksfläche. */
  bkp0ChfProM2Gsf: number | null
}

export const LEERER_BENCHMARK: BenchmarkDoc = {
  bkp0ChfProM2Gsf: null,
}

/** Fehlende Felder auffüllen — `doc` kommt als beliebiges JSONB aus der DB. */
export function normalizeBenchmark(doc: Partial<BenchmarkDoc> | null | undefined): BenchmarkDoc {
  return { ...LEERER_BENCHMARK, ...(doc ?? {}) }
}

export interface BenchmarkZeile {
  code: BkpHauptgruppe
  label: string
  /** null = Berechnungsart dieser Hauptgruppe noch offen. */
  netto: number | null
  brutto: number | null
  /** Kennwert-Feld, das diese Zeile bearbeitet. Fehlt bei offenen Zeilen. */
  feld?: keyof BenchmarkDoc
  ansatzWert?: number | null
  ansatzEinheit?: AnsatzEinheit
  /** Bezugsgrösse im Klartext, z.B. „× GSF 1'200 m²". */
  ansatzBasis?: string
  /** Kennwert in CHF/m² GF inkl. MwSt — einheitlich wie bei keeValue. */
  chfProM2Gf: number | null
}

export interface BenchmarkBezug {
  /** Grundstücksfläche (m²) aus den Parzellen. */
  gsfTotal: number
  /** Geschossfläche (m²) aus dem Mengengerüst — Bezug der Kennwertspalte. */
  gfM2: number
  /** Globaler MwSt-Satz der Variante, z.B. 0.081. */
  mwstSatz: number
}

export interface BenchmarkErgebnis {
  zeilen: BenchmarkZeile[]
  /** Summe über die bereits definierten Hauptgruppen. */
  totalNetto: number
  totalBrutto: number
  /** Wie viele Hauptgruppen noch keine Berechnungsart haben. */
  offeneGruppen: number
}

/** Ganzzahl mit Tausender-Hochkomma — für die Basistexte in der UI. */
function formatMenge(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'")
}

/**
 * Baut die Zeilen der Benchmark-Kostenberechnung — eine je Hauptgruppe 0–9.
 *
 * Definiert ist bisher:
 *   BKP 0 Grundstück — CHF/m² × Grundstücksfläche aus den Parzellen, ohne MwSt
 *     (Grundstückerwerb ist nicht mehrwertsteuerpflichtig, analog der
 *     Katalogposition 010).
 *
 * Alle übrigen Hauptgruppen bleiben vorerst offen.
 */
export function benchmarkZeilen(doc: BenchmarkDoc, bezug: BenchmarkBezug): BenchmarkErgebnis {
  const zeilen: BenchmarkZeile[] = HAUPTGRUPPEN.map((h) => {
    if (h.code === 0) {
      const netto = (doc.bkp0ChfProM2Gsf ?? 0) * bezug.gsfTotal
      return {
        code: h.code,
        label: h.label,
        netto,
        brutto: netto, // ohne MwSt
        feld: 'bkp0ChfProM2Gsf' as const,
        ansatzWert: doc.bkp0ChfProM2Gsf,
        ansatzEinheit: 'CHF/m²' as const,
        ansatzBasis: bezug.gsfTotal > 0
          ? `× GSF ${formatMenge(bezug.gsfTotal)} m²`
          : '× GSF — keine Parzellenfläche erfasst',
        chfProM2Gf: null,
      }
    }
    return { code: h.code, label: h.label, netto: null, brutto: null, chfProM2Gf: null }
  })

  // Kennwertspalte einheitlich über die Geschossfläche, brutto — gleiche
  // Konvention wie in der keeValue-Tabelle.
  for (const z of zeilen) {
    z.chfProM2Gf = z.brutto != null && bezug.gfM2 > 0 ? z.brutto / bezug.gfM2 : null
  }

  return {
    zeilen,
    totalNetto: zeilen.reduce((s, z) => s + (z.netto ?? 0), 0),
    totalBrutto: zeilen.reduce((s, z) => s + (z.brutto ?? 0), 0),
    offeneGruppen: zeilen.filter((z) => z.netto == null).length,
  }
}
