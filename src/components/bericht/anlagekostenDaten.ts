import { useMemo } from 'react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { useKeeValueImport } from '@/hooks/useKeeValueImport'
import { HAUPTGRUPPEN } from '@/lib/bkpKatalog'
import { formatNumber } from '@/lib/utils'
import type { BkpPosition } from '@/lib/bkpKatalog'
import type { BaseRef } from '@/types'
import type { PositionResult } from '@/lib/bkpBerechnung'
import type { AnlagekostenDaten, TabellenZeile } from '@/components/bericht/BerichtDokument'

/** Betrag in Franken, gerundet; Null bleibt sichtbar leer. */
function chf(v: number): string {
  return v !== 0 ? formatNumber(Math.round(v)) : '—'
}

/** Zusammenhängende Hauptgruppen als Spanne: [1,2,3,4] wird zu „BKP 1–4". */
function gruppenLabel(gruppen: number[]): string {
  if (gruppen.length === 0) return ''
  const sortiert = [...gruppen].sort((a, b) => a - b)
  const luecke = sortiert.some((g, i) => i > 0 && g !== sortiert[i - 1] + 1)
  return luecke
    ? `BKP ${sortiert.join(', ')}`
    : `BKP ${sortiert[0]}${sortiert.length > 1 ? `–${sortiert[sortiert.length - 1]}` : ''}`
}

/**
 * Worauf sich eine Bezugsmenge bezieht — „BKP 1–4", „Pos. 160", „Ertrag".
 * Ohne das steht in der Mengenspalte eine Summe ohne Herkunft, und die
 * Rechnung dahinter bleibt unlesbar. Positionen, deren Menge eine echte
 * Grösse ist (Fläche, Volumen), brauchen die Angabe nicht.
 */
function bezug(typ: BkpPosition['typ']): string {
  const refs = (r: BaseRef[]): string => r.map((x) => (
    x.kind === 'hauptgruppe' ? `BKP ${x.ref}`
      : x.kind === 'position' ? `Pos. ${x.ref}`
        : x.ref
  )).join(', ')
  switch (typ.kind) {
    case 'prozent_von_hauptgruppen': return gruppenLabel(typ.gruppen)
    case 'finanzierung':
      return [gruppenLabel(typ.gruppen), typ.refs?.length ? refs(typ.refs) : '']
        .filter(Boolean).join(', ')
    case 'prozent_von_refs':
    case 'promille_von_refs': return refs(typ.refs)
    case 'prozent_von_ertrag': return typ.refs.length > 0 ? refs(typ.refs) : 'Ertrag'
    case 'von_ertrag_vereinfacht': return 'Ertrag'
    case 'chf_pro_m3_bkp2': return 'BKP 2'
    case 'auf_mehrwert': return 'Mehrwert'
    default: return ''
  }
}

/**
 * Menge mit ihrer Einheit in einer Zelle. Worauf sie sich bezieht, steht in
 * der Spalte davor — hier bleibt die Zahl.
 */
function menge(p: PositionResult): string {
  if (p.menge == null) return '—'
  const wert = formatNumber(Math.round(p.menge * 100) / 100)
  return p.mengeEinheit ? `${wert} ${p.mengeEinheit}` : wert
}

/**
 * Ansatz einer Position: der eingegebene Kennwert mit seiner Einheit. Bei
 * Prozentpositionen ist das der Satz, bei Stückkosten der Einheitspreis.
 * Uneinheitlich über die Eigentumsarten hinweg bleibt die Zelle leer — ein
 * gemittelter Ansatz wäre eine Zahl, die nirgends erfasst ist.
 *
 * Prozentsätze stehen in der Datenbank als Bruchteil: die Berechnung rechnet
 * `Basis × kennwert`, 0.04 sind also vier Prozent. Promille dagegen stehen als
 * Zahl da — dort teilt die Berechnung selbst durch tausend. Ungerechnet
 * ausgegeben ergäbe der eine Satz ein Hundertstel seines Werts.
 */
function ansatz(p: PositionResult): string {
  if (p.kennwertGemischt || p.kennwert == null) return '—'
  const e = p.preisEinheit
  const wert = e === '%' || e === '%/a'
    ? (p.kennwert * 100).toFixed(1)
    : e === '‰'
      ? p.kennwert.toFixed(1)
      : formatNumber(Math.round(p.kennwert * 100) / 100)
  return e ? `${wert} ${e}` : wert
}

/**
 * Stellt das Kapitel „Anlagekosten" zusammen. Was es zeigt, hängt an der
 * Erfassungsmethode der Variante:
 *
 * - Benchmark: die Hauptgruppen 0–9 auf einer A4-Seite. Mehr gibt die Methode
 *   nicht her — sie rechnet mit Kennwerten je Hauptgruppe.
 * - keeValue: die Hauptgruppen 1–9, ebenfalls A4. Das Grundstück fehlt dort,
 *   weil der Import es nicht führt. Woher die Zahlen stammen — Modell,
 *   Preisstand, Datei — steht als Satz unter der Tabelle; die Berechnung des
 *   Modells selbst legt man dem Bericht separat bei.
 * - Detail: A3, mit jeder erfassten Position, ihrer Menge, ihrem Ansatz und
 *   der Herleitung — die Zusammenstellung der Hauptgruppen steht voran.
 */
export function useAnlagekostenDaten(variantId: string | undefined): AnlagekostenDaten | undefined {
  const ak = useAnlagekostenShared()
  // Die importierte Datei selbst liegt nicht vor, ihre Herkunft schon:
  // Dateiname, Preisstand und Version stehen beim Import.
  const keeValue = useKeeValueImport(variantId)
  const herkunft = keeValue.row('')

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
          ? [
            'Grundlage der Kosten ist das keeValue-Kostenmodell',
            herkunft?.preisstand ? `, Preisstand ${herkunft.preisstand}` : '',
            herkunft?.version ? `, Version ${herkunft.version}` : '',
            herkunft?.file_name ? ` (${herkunft.file_name})` : '',
            '. Die Berechnung des Modells liegt dem Bericht separat bei.',
          ].join('')
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

    let tNetto = 0
    let tMwst = 0
    const roh = HAUPTGRUPPEN.map((h) => {
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
        const zeige = erste
          ? { ...erste, kennwertGemischt: erste.kennwertGemischt || gemischt }
          : null
        zeilen.push({
          zellen: [
            pos.displayCode ?? pos.code,
            pos.label,
            zeige ? bezug(zeige.position.typ) : '',
            zeige ? menge(zeige) : '—',
            zeige ? ansatz(zeige) : '—',
            chf(pNetto),
            chf(pMwst),
            chf(pNetto + pMwst),
            '',
          ],
        })
      }
      if (zeilen.length === 0) return null
      tNetto += gNetto
      tMwst += gMwst
      return { code: String(h.code), label: h.label, zeilen, gNetto, gMwst }
    }).filter((g) => g != null)

    const gesamt = tNetto + tMwst
    // Die Summen der Hauptgruppe stehen in ihrem Titelbalken statt in einer
    // eigenen Zeile darunter — das spart je Gruppe eine Zeile, und der Balken
    // trägt ohnehin schon ihre Nummer.
    const gruppen = roh.map((g) => ({
      code: g.code,
      label: g.label,
      balken: [
        g.code, g.label, '', '', '',
        chf(g.gNetto), chf(g.gMwst), chf(g.gNetto + g.gMwst),
        gesamt > 0 ? ((g.gNetto + g.gMwst) / gesamt * 100).toFixed(1) : '—',
      ],
      zeilen: g.zeilen,
    }))

    return {
      methode,
      format: 'a3' as const,
      hinweis: null,
      // Die Beschriftung steht einmal zuoberst; die Hauptgruppen darunter
      // führen keine eigene mehr.
      kopf: ['BKP', 'Position', 'Bezug', 'Menge', 'Einheit',
        'exkl. MWST', 'MWST', 'inkl. MWST', '%'],
      gruppen,
      total: ['', 'Total Anlagekosten', '', '', '',
        chf(tNetto), chf(tMwst), chf(gesamt), gesamt > 0 ? '100.0' : '—'],
    }
  }, [ak, herkunft])
}
