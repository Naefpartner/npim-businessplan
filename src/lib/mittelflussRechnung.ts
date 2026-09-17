// =============================================================================
// Mittelflussrechnung — Zeilen und Quartalsverteilung, ohne Oberfläche.
//
// Der Reiter der Variante und das Berichtskapitel zeigen dieselbe Rechnung:
// welche Kostenzeilen es gibt, wie sie sich auf die Quartale verteilen, was die
// Verkaufserlöse und die Gewinnsteuern beitragen. Damit die beiden nicht
// auseinanderlaufen, steht die Rechnung hier und nicht in der Sektion.
// =============================================================================

import { HAUPTGRUPPEN, type BkpPosition } from '@/lib/bkpKatalog'
import type { BkpErgebnis } from '@/lib/bkpBerechnung'
import { posSortKey } from '@/hooks/useAnlagekosten'
import {
  kapitalSteuernErgebnis, positionsBetraegeAus, type KapitalSteuernDoc,
} from '@/lib/kapitalSteuern'
import type { HonorarPhaseGewicht } from '@/lib/mittelfluss'
import type { Eigentumsart } from '@/types'

/** Eine Kostenzeile der Rechnung — Position, Honorarphase oder Finanzierung. */
export interface MfRow {
  key: string
  label: string
  hauptgruppe: number
  netto: number
  mwst: number
  brutto: number
  kind: 'normal' | 'honorar' | 'finanzierung'
  /** Zinssatz und Anteil der Finanzierungszeilen. */
  rate?: number
  share?: number
}

/** Anzeige-Zeile: Basiszeile mit Verteilungs-Scope, Einrückung und Rolle. */
export interface MfDispRow extends MfRow {
  /** Verteilungs-Scope `${etappe}|${eig}`. */
  scope: string
  /** Schlüssel der Position innerhalb des Scopes. */
  posKey: string
  indent: number
  isHeader: boolean
  editable: boolean
  groupId?: string
}

/** Eine Quartalszelle: Prozentsatz und die drei Beträge daraus. */
export interface QCell { pct: number; netto: number; mwst: number; brutto: number }

/** Ergebnis der Quartalsverteilung. */
export interface MfCalc {
  qKeys: string[]
  cells: Record<string, QCell[]>
  totNetto: number[]
  /** Anlagekosten netto ohne Finanzierung. */
  totNettoAK: number[]
  totMwst: number[]
  totBrutto: number[]
}

/** Was die Zeilen brauchen — die Kostenberechnung, so wie sie die Variante führt. */
export interface MfZeilenQuellen {
  /** Eigentumsarten der Ansicht; ihre Beträge werden zusammengezogen. */
  eigs: Eigentumsart[]
  positionsByEig: Map<Eigentumsart, BkpPosition[]>
  typForByEig: Map<Eigentumsart, (code: string) => { kind: string } | undefined>
  /** Kostenergebnis einer Eigentumsart — konsolidiert oder je Etappe. */
  ergFor: (eig: Eigentumsart) => BkpErgebnis | undefined
  /** Gewichte der Honorarphasen für die Aufteilung von 690a/690b. */
  honGewichte: HonorarPhaseGewicht[]
  /**
   * Auf Hauptgruppen statt auf Positionen. Benchmark und keeValue kennen keine
   * Positionen; sonst entscheidet die gewählte Ebene.
   */
  aufHauptgruppen: boolean
}

/**
 * Kostenzeilen einer Ansicht.
 *
 * Welche Zeilen es gibt, hängt an der Erfassungsmethode: der Detailkatalog
 * liefert einzelne Positionen, Benchmark und keeValue rechnen dagegen auf
 * Hauptgruppen — dort führen ihre Ergebnisse nur Land und Reserve als
 * Position, und die Tabelle bliebe fast leer. In diesem Fall sind die
 * Hauptgruppen selbst die Zeilen.
 */
export function mittelflussZeilen(q: MfZeilenQuellen): MfRow[] {
  const posMeta = new Map<string, BkpPosition>()
  for (const eig of q.eigs) {
    for (const p of (q.positionsByEig.get(eig) ?? [])) if (!posMeta.has(p.code)) posMeta.set(p.code, p)
  }
  const istFinanz = (code: string) => q.eigs.some(
    (eig) => q.typForByEig.get(eig)?.(code)?.kind === 'finanzierung')
  const sumBis41 = q.honGewichte.filter((g) => g.group === 'bis41').reduce((s, g) => s + g.weight, 0)
  const sumAb51 = q.honGewichte.filter((g) => g.group === 'ab51').reduce((s, g) => s + g.weight, 0)
  const bkp2Label = `2 · ${HAUPTGRUPPEN.find((h) => h.code === 2)?.label ?? 'Gebäude'} (BKP 2 gesamt)`

  if (q.aufHauptgruppen) {
    const netto = Array<number>(10).fill(0)
    const mwst = Array<number>(10).fill(0)
    for (const eig of q.eigs) {
      const erg = q.ergFor(eig)
      if (!erg) continue
      for (let c = 0; c <= 9; c++) {
        const k = c as keyof BkpErgebnis['hauptgruppenSummenNetto']
        netto[c] += erg.hauptgruppenSummenNetto[k] ?? 0
        mwst[c] += erg.hauptgruppenSummenMwst[k] ?? 0
      }
      /*
       * Die Finanzierungspositionen stecken in ihrer Hauptgruppe (940/950/960
       * in den Eigentümerkosten) — hier gehören sie heraus: die Zeile trägt
       * „exkl. Finanzierung", und der Zinsaufwand steht unten für sich, auf
       * dem Kapitalbedarf, den diese Kosten erst ergeben.
       */
      for (const [code, p] of Object.entries(erg.positionen)) {
        if (q.typForByEig.get(eig)?.(code)?.kind !== 'finanzierung') continue
        const hg = posMeta.get(code)?.hauptgruppe ?? (Number(code[0]) || 9)
        netto[hg] -= p.betragNetto ?? 0
        mwst[hg] -= p.mwstBetrag ?? 0
      }
    }
    return HAUPTGRUPPEN
      .filter((h) => Math.abs(netto[h.code] + mwst[h.code]) >= 0.5)
      .map((h) => ({
        key: `hg${h.code}`,
        label: `${h.code} · ${h.label}`,
        hauptgruppe: h.code,
        netto: netto[h.code],
        mwst: mwst[h.code],
        brutto: netto[h.code] + mwst[h.code],
        kind: 'normal' as const,
      }))
  }

  const acc = new Map<string, {
    netto: number; mwst: number; brutto: number
    kennwert: number | null; kennwert2: number | null
  }>()
  for (const eig of q.eigs) {
    const erg = q.ergFor(eig)
    if (!erg) continue
    for (const code of Object.keys(erg.positionen)) {
      const p = erg.positionen[code]
      const cur = acc.get(code)
        ?? { netto: 0, mwst: 0, brutto: 0, kennwert: null, kennwert2: null }
      cur.netto += p.betragNetto ?? 0
      cur.mwst += p.mwstBetrag ?? 0
      cur.brutto += p.betragBrutto ?? 0
      if (cur.kennwert == null) cur.kennwert = p.kennwert
      if (cur.kennwert2 == null) cur.kennwert2 = p.kennwert2 ?? null
      acc.set(code, cur)
    }
  }
  const codes = [...acc.keys()].sort((a, b) => {
    const pa = posMeta.get(a), pb = posMeta.get(b)
    return (pa?.hauptgruppe ?? 9) - (pb?.hauptgruppe ?? 9)
      || posSortKey(pa ?? ({} as BkpPosition)) - posSortKey(pb ?? ({} as BkpPosition))
  })
  const bkp2 = { netto: 0, mwst: 0, brutto: 0 }
  for (const code of codes) {
    if (posMeta.get(code)?.hauptgruppe !== 2) continue
    const a = acc.get(code)!
    bkp2.netto += a.netto; bkp2.mwst += a.mwst; bkp2.brutto += a.brutto
  }
  let bkp2Gesetzt = false
  const out: MfRow[] = []
  for (const code of codes) {
    const a = acc.get(code)!
    const meta = posMeta.get(code)
    const hg = meta?.hauptgruppe ?? 9
    // BKP 2 steht als eine Zeile: die Bauwerkskosten verteilen sich zeitlich
    // ohnehin gemeinsam, und einzeln wären es hundert Zeilen.
    if (hg === 2) {
      if (!bkp2Gesetzt && Math.abs(bkp2.brutto) >= 0.5) {
        out.push({
          key: 'hg2', label: bkp2Label, hauptgruppe: 2,
          netto: bkp2.netto, mwst: bkp2.mwst, brutto: bkp2.brutto, kind: 'normal',
        })
      }
      bkp2Gesetzt = true
      continue
    }
    const disp = meta?.displayCode ?? meta?.code ?? code
    // Honorarzeilen bleiben, auch wo sie null sind — sie tragen die Phasen.
    if (Math.abs(a.brutto) < 0.5 && !(code === '690a' || code === '690b')) continue
    if (istFinanz(code)) {
      out.push({
        key: code, label: `${disp} · ${meta?.label ?? ''}`, hauptgruppe: hg,
        netto: a.netto, mwst: a.mwst, brutto: a.brutto, kind: 'finanzierung',
        rate: a.kennwert ?? 0, share: a.kennwert2 ?? 0.5,
      })
      continue
    }
    const phasen = code === '690a' ? 'bis41' : code === '690b' ? 'ab51' : null
    const summe = phasen === 'bis41' ? sumBis41 : sumAb51
    if (phasen && summe > 0 && Math.abs(a.brutto) >= 0.5) {
      for (const g of q.honGewichte) {
        if (g.group !== phasen) continue
        const f = g.weight / summe
        out.push({
          key: `hon:${g.gruppe}`, label: `${code} · Phase ${g.gruppe} ${g.label}`,
          hauptgruppe: hg, netto: a.netto * f, mwst: a.mwst * f, brutto: a.brutto * f,
          kind: 'honorar',
        })
      }
      continue
    }
    out.push({
      key: code, label: `${disp} · ${meta?.label ?? ''}`, hauptgruppe: hg,
      netto: a.netto, mwst: a.mwst, brutto: a.brutto, kind: 'normal',
    })
  }
  return out
}

/**
 * Verteilung der Zeilen auf die Quartale. Die Prozentsätze stehen im Dokument,
 * die Beträge folgen daraus; die Finanzierung rechnet auf dem kumulierten
 * Bedarf, den die übrigen Zeilen ergeben.
 */
export function mittelflussCalc(
  rows: MfDispRow[],
  verteilung: Record<string, Record<string, Record<string, number>>>,
  qKeys: string[],
): MfCalc {
  const cells: Record<string, QCell[]> = {}
  const cumBase = new Array<number>(qKeys.length).fill(0)
  // Editierbare Zeilen (Gesamt-Positionen bzw. Etappen-Unterzeilen) aus ihrem Scope.
  for (const r of rows) {
    if (!r.editable) continue
    const rc = qKeys.map((qk) => {
      const pct = verteilung[r.scope]?.[r.posKey]?.[qk] ?? 0
      return {
        pct,
        netto: (pct / 100) * r.netto,
        mwst: (pct / 100) * r.mwst,
        brutto: (pct / 100) * r.brutto,
      }
    })
    cells[r.key] = rc
    rc.forEach((c, i) => { cumBase[i] += c.brutto })
  }
  const cum: number[] = []
  let run = 0
  for (let i = 0; i < qKeys.length; i++) { run += cumBase[i]; cum.push(run) }
  // Finanzierung: abgeleitet aus dem kumulierten Bedarf.
  for (const r of rows) {
    if (r.kind !== 'finanzierung') continue
    cells[r.key] = qKeys.map((_, i) => {
      const zins = cum[i] * (r.rate ?? 0) * (r.share ?? 0.5) / 4
      return { pct: 0, netto: zins, mwst: 0, brutto: zins }
    })
  }
  // Kopfzeilen (Etappen-Modus): Summe ihrer Etappen-Kinder.
  for (const r of rows) {
    if (!r.isHeader) continue
    const kids = rows.filter((x) => x.editable && x.groupId === r.groupId)
    cells[r.key] = qKeys.map((_, i) => {
      let n = 0, m = 0, b = 0
      for (const k of kids) {
        const c = cells[k.key]?.[i]
        if (c) { n += c.netto; m += c.mwst; b += c.brutto }
      }
      return { pct: 0, netto: n, mwst: m, brutto: b }
    })
  }
  // Summen: editierbare Zeilen + Finanzierung (Kopfzeilen NICHT, sonst doppelt).
  const contrib = (r: MfDispRow) => r.editable || r.kind === 'finanzierung'
  const summe = (waehle: (r: MfDispRow) => boolean, feld: 'netto' | 'mwst') => qKeys.map(
    (_, i) => rows.reduce((s, r) => s + (waehle(r) ? (cells[r.key]?.[i]?.[feld] ?? 0) : 0), 0))
  const totNetto = summe(contrib, 'netto')
  // Anlagekosten netto OHNE Finanzierung (Zinsen fliessen nur ins Brutto-Total).
  const totNettoAK = summe((r) => r.editable, 'netto')
  const totMwst = summe(contrib, 'mwst')
  return {
    qKeys, cells, totNetto, totNettoAK, totMwst,
    totBrutto: totNetto.map((n, i) => n + totMwst[i]),
  }
}

/**
 * Die beiden Gewinnsteuern aus „Kapital und Steuern". Sie werden dort
 * gerechnet; die Mittelflussrechnung verteilt nur ihre Fälligkeit.
 */
export function gewinnsteuern(
  ksDoc: KapitalSteuernDoc | null | undefined,
  erg: BkpErgebnis | undefined,
  aufHauptgruppen: boolean,
  verkaufserloesTotal: number,
): { grundstueckgewinn: number; gewinnTu: number } {
  if (!ksDoc) return { grundstueckgewinn: 0, gewinnTu: 0 }
  const betraege = positionsBetraegeAus(erg, aufHauptgruppen)
  const p010 = erg?.positionen['010']
  const landpreis = (p010?.betragNetto ?? 0) + (p010?.mwstBetrag ?? 0)
  const r = kapitalSteuernErgebnis(ksDoc, betraege, landpreis, verkaufserloesTotal)
  return { grundstueckgewinn: r.lp.steuern, gewinnTu: r.tu.steuern }
}

// ── Verkaufserlöse ──────────────────────────────────────────────────────────

/** Eine Verkaufseinheit aus dem Mengengerüst. */
export interface MfVerkaufsObjekt {
  id: string
  label: string
  /** Verkaufspreis in CHF. */
  betrag: number
  /** Verkaufsfläche — nur Einheiten mit Fläche tragen einen Landanteil. */
  vkf: number
}

/** Eine Erlöszeile mit ihrer Verteilung: Prozentsätze und Beträge je Quartal. */
export interface MfErloesReihe {
  id: string
  label: string
  betrag: number
  pct: number[]
  betraege: number[]
}

/**
 * Je Verkaufseinheit zwei Zeilen: der Landanteil und der Werkanteil. Der
 * Verkaufserlös des Grundstücks verteilt sich im Verhältnis der Verkaufspreise
 * auf die Einheiten; was übrig bleibt, ist der Werkanteil. Beide Teile
 * fliessen zu verschiedenen Zeiten — Land beim Abschluss, Werk nach
 * Baufortschritt —, deshalb je eine eigene Zeile.
 *
 * Land tragen nur Einheiten mit Verkaufsfläche: ein Parkplatz oder ein
 * Kellerabteil hat keinen Landanteil, sein Preis ist ganz Werk.
 */
export function objektErloesReihen(
  objekte: MfVerkaufsObjekt[],
  qKeys: string[],
  /** Verteilung des Erlös-Scopes: `obj:<id>` → Quartal → Prozent. */
  vertErloes: Record<string, Record<string, number>> | undefined,
  /** Verkaufserlös des Grundstücks, den der Landprovider verrechnet. */
  landerloes: number,
): MfErloesReihe[] {
  const summeMitFlaeche = objekte.reduce((s, o) => s + (o.vkf > 0 ? o.betrag : 0), 0)
  const reihe = (id: string, label: string, betrag: number): MfErloesReihe => {
    const pct = qKeys.map((qk) => vertErloes?.[`obj:${id}`]?.[qk] ?? 0)
    return { id, label, betrag, pct, betraege: pct.map((p) => (p / 100) * betrag) }
  }
  return objekte.flatMap((o) => {
    const land = o.vkf > 0 && summeMitFlaeche > 0
      ? landerloes * (o.betrag / summeMitFlaeche)
      : 0
    // Ohne Landanteil bleibt es bei einer Zeile — eine Nullzeile sagte nichts.
    if (land <= 0) return [reihe(`${o.id}:werk`, o.label, o.betrag)]
    return [
      reihe(`${o.id}:land`, `${o.label} · Landanteil`, land),
      reihe(`${o.id}:werk`, `${o.label} · Werkanteil`, o.betrag - land),
    ]
  })
}
