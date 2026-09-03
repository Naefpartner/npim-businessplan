import { useMemo } from 'react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { HAUPTGRUPPEN } from '@/lib/bkpKatalog'
import { formatNumber } from '@/lib/utils'
import type { BkpPosition } from '@/lib/bkpKatalog'
import type { PositionResult } from '@/lib/bkpBerechnung'
import type { AnlagekostenDaten, TabellenZeile } from '@/components/bericht/BerichtDokument'

/** Betrag in Franken, gerundet; Null bleibt sichtbar leer. */
function chf(v: number): string {
  return v !== 0 ? formatNumber(Math.round(v)) : '—'
}

/** Menge mit Einheit, Einheit vorangestellt wie im übrigen Bericht. */
function menge(p: PositionResult): string {
  if (p.menge == null) return '—'
  return `${formatNumber(Math.round(p.menge * 100) / 100)}`
}

/**
 * Ansatz einer Position: der eingegebene Kennwert mit seiner Einheit. Bei
 * Prozentpositionen ist das der Satz, bei Stückkosten der Einheitspreis.
 * Uneinheitlich über die Eigentumsarten hinweg bleibt die Zelle leer — ein
 * gemittelter Ansatz wäre eine Zahl, die nirgends erfasst ist.
 */
function ansatz(p: PositionResult): string {
  if (p.kennwertGemischt || p.kennwert == null) return '—'
  const wert = p.preisEinheit === '%'
    ? p.kennwert.toFixed(1)
    : formatNumber(Math.round(p.kennwert * 100) / 100)
  return `${wert} ${p.preisEinheit}`
}

/**
 * Stellt das Kapitel „Anlagekosten" zusammen. Was es zeigt, hängt an der
 * Erfassungsmethode der Variante:
 *
 * - Benchmark: die Hauptgruppen 0–9 auf einer A4-Seite. Mehr gibt die Methode
 *   nicht her — sie rechnet mit Kennwerten je Hauptgruppe.
 * - keeValue: die Hauptgruppen 1–9, ebenfalls A4. Das Grundstück fehlt dort,
 *   weil der Import es nicht führt. Die Herleitung steht im importierten PDF,
 *   das hinten angehängt wird; darauf weist ein Satz unter der Tabelle hin.
 * - Detail: A3, mit jeder erfassten Position, ihrer Menge, ihrem Ansatz und
 *   der Herleitung — die Zusammenstellung der Hauptgruppen steht voran.
 */
export function useAnlagekostenDaten(): AnlagekostenDaten | undefined {
  const ak = useAnlagekostenShared()

  return useMemo(() => {
    if (ak.presentEig.length === 0) return undefined

    // ── Summen je Hauptgruppe, über alle Eigentumsarten ──────────────────────
    const netto: Record<number, number> = {}
    const mwst: Record<number, number> = {}
    for (let c = 0; c <= 9; c++) { netto[c] = 0; mwst[c] = 0 }
    for (const eig of ak.presentEig) {
      const erg = ak.konsolidiertEffektiv.get(eig)
      if (!erg) continue
      for (let c = 0; c <= 9; c++) {
        const k = c as keyof typeof erg.hauptgruppenSummenNetto
        netto[c] += erg.hauptgruppenSummenNetto[k] ?? 0
        mwst[c] += erg.hauptgruppenSummenMwst[k] ?? 0
      }
    }

    const methode = ak.kostenMethode === 'benchmark' ? 'benchmark'
      : ak.kostenMethode === 'keevalue' ? 'keevalue' : 'detail'
    // Der Import kennt kein Grundstück — die Hauptgruppe 0 bliebe leer und
    // gäbe dem Total einen Anschein von Vollständigkeit, den es nicht hat.
    const vonHg = methode === 'keevalue' ? 1 : 0

    const summeNetto = HAUPTGRUPPEN
      .filter((h) => h.code >= vonHg).reduce((a, h) => a + netto[h.code], 0)
    const summeBrutto = HAUPTGRUPPEN
      .filter((h) => h.code >= vonHg).reduce((a, h) => a + netto[h.code] + mwst[h.code], 0)

    const summenZeilen: TabellenZeile[] = HAUPTGRUPPEN
      .filter((h) => h.code >= vonHg)
      .filter((h) => netto[h.code] !== 0 || mwst[h.code] !== 0)
      .map((h) => ({
        zellen: [
          String(h.code), h.label,
          chf(netto[h.code]),
          chf(mwst[h.code]),
          chf(netto[h.code] + mwst[h.code]),
          summeBrutto > 0
            ? ((netto[h.code] + mwst[h.code]) / summeBrutto * 100).toFixed(1)
            : '—',
        ],
      }))
    if (summenZeilen.length === 0) return undefined
    summenZeilen.push({
      total: true,
      zellen: ['', 'Total Anlagekosten', chf(summeNetto), chf(summeBrutto - summeNetto),
        chf(summeBrutto), '100.0'],
    })

    const summen = {
      titel: methode === 'keevalue' ? 'Anlagekosten BKP 1–9' : 'Anlagekosten BKP 0–9',
      kopf: ['BKP', 'Hauptgruppe', 'exkl. MWST', 'MWST', 'inkl. MWST', '%'],
      zeilen: summenZeilen,
    }

    if (methode !== 'detail') {
      return {
        methode,
        format: 'a4' as const,
        summen,
        hinweis: methode === 'keevalue'
          ? 'Die Herleitung der Kosten stammt aus dem keeValue-Kostenmodell; '
            + 'der Bericht führt sie im Anhang unverändert mit.'
          : 'Die Kosten sind über Kennwerte je Hauptgruppe hergeleitet '
            + '(Benchmark-Methode).',
        gruppen: [],
      }
    }

    // ── Detail: jede erfasste Position, nach Hauptgruppen geordnet ───────────
    // Positionen können sich je Eigentumsart unterscheiden (eigene Zeilen);
    // die Vereinigung führt jede genau einmal.
    const katalog = new Map<string, BkpPosition>()
    for (const eig of ak.presentEig) {
      for (const p of ak.positionsByEig.get(eig) ?? []) katalog.set(p.code, p)
    }

    const gruppen = HAUPTGRUPPEN.map((h) => {
      const zeilen: TabellenZeile[] = []
      let gNetto = 0
      let gMwst = 0
      for (const pos of [...katalog.values()]
        .filter((p) => p.hauptgruppe === h.code)
        .sort((a, b) => (a.displayCode ?? a.code).localeCompare(b.displayCode ?? b.code))) {
        // Über die Eigentumsarten summieren; Menge und Ansatz nur, wenn sie
        // dort übereinstimmen — sonst stünde eine Zahl da, die nicht rechnet.
        let pNetto = 0
        let pMwst = 0
        let erste: PositionResult | null = null
        let gemischt = false
        for (const eig of ak.presentEig) {
          const r = ak.konsolidiertEffektiv.get(eig)?.positionen[pos.code]
          if (!r || (r.betragNetto ?? 0) === 0) continue
          pNetto += r.betragNetto ?? 0
          pMwst += r.mwstBetrag
          if (!erste) erste = r
          else if (erste.kennwert !== r.kennwert) gemischt = true
        }
        if (pNetto === 0 && pMwst === 0) continue
        gNetto += pNetto
        gMwst += pMwst
        const zeige = erste ? { ...erste, kennwertGemischt: erste.kennwertGemischt || gemischt } : null
        zeilen.push({
          zellen: [
            pos.displayCode ?? pos.code,
            pos.label,
            zeige?.mengeEinheit ?? '',
            zeige ? menge(zeige) : '—',
            zeige ? ansatz(zeige) : '—',
            chf(pNetto),
            chf(pMwst),
            chf(pNetto + pMwst),
          ],
        })
      }
      if (zeilen.length === 0) return null
      return {
        code: String(h.code),
        label: `${h.code} ${h.label}`,
        kopf: ['BKP', 'Position', 'Einheit', 'Menge', 'Ansatz',
          'exkl. MWST', 'MWST', 'inkl. MWST'],
        zeilen,
        total: {
          total: true,
          zellen: ['', `Total ${h.label}`, '', '', '',
            chf(gNetto), chf(gMwst), chf(gNetto + gMwst)],
        } satisfies TabellenZeile,
      }
    }).filter((g) => g != null)

    return {
      methode,
      format: 'a3' as const,
      summen,
      hinweis: null,
      gruppen,
    }
  }, [ak])
}
