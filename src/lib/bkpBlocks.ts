// Block-Logik für die Anlagekosten: eine vollständige Berechnung je
// (Etappe × Eigentumsart). Die eigentliche Auflösung bleibt in
// `berechneAnlagekosten` — hier nur das Zusammenstellen der effektiven
// Einträge (coalesce Etappe→Konsolidiert), der Block-Bezugsgrössen und das
// positionsweise Aggregat über alle Blöcke (= Konsolidiert).

import {
  resolveTyp,
  type BkpPosition, type BerechnungsTyp, type BkpHauptgruppe,
} from '@/lib/bkpKatalog'
import {
  berechneAnlagekosten,
  type BkpEintrag, type BkpMengen, type BkpErgebnis, type PositionResult,
} from '@/lib/bkpBerechnung'
import {
  aggregateBkp2, bkp2KonsolidiertRows,
  type Bkp2Aggregat,
} from '@/lib/bkp2'
import type {
  VariantBkpKosten, VariantBkpCustomPosition, VariantEtappeGsfAlloc,
  Eigentumsart, BuildingMietflaeche, BaseRef, CalcMethod,
} from '@/types'
import { eigentumsartForBuilding } from '@/types'

export type TypFor = (code: string) => BerechnungsTyp

/** Methode/Basis liegen auf der Konsolidiert-Row (etappe_id NULL). */
export function methodFor(rows: VariantBkpKosten[], eig: Eigentumsart, code: string): CalcMethod | null {
  const r = rows.find((x) => x.eigentumsart === eig && x.etappe_id === null && x.position_code === code)
  return r?.calc_method ?? null
}
export function baseFor(rows: VariantBkpKosten[], eig: Eigentumsart, code: string): BaseRef[] | null {
  const r = rows.find((x) => x.eigentumsart === eig && x.etappe_id === null && x.position_code === code)
  return r?.calc_base ?? null
}

/** Eigene Zeilen einer Eigentumsart als BkpPosition (Methode/Typ via typFor). */
export function customToPositions(custom: VariantBkpCustomPosition[], eig: Eigentumsart): BkpPosition[] {
  return custom
    .filter((c) => c.eigentumsart === eig)
    .map((c) => ({
      code: c.id,
      displayCode: c.code,
      hauptgruppe: c.hauptgruppe as BkpHauptgruppe,
      label: c.label,
      typ: { kind: 'pauschal' } as BerechnungsTyp,
      defaultStatus: 'beruecksichtigt' as const,
      defaultMode: 'pauschal' as const,
      mwst: c.mwst,
    }))
}

/** Effektiver Typ pro Code: Methode-Override aus den Rows, sonst Katalog-Typ. */
export function makeTypFor(positions: BkpPosition[], rows: VariantBkpKosten[], eig: Eigentumsart): TypFor {
  const catalog = new Map(positions.map((p) => [p.code, p.typ]))
  return (code) => resolveTyp(catalog.get(code) ?? { kind: 'pauschal' }, methodFor(rows, eig, code), baseFor(rows, eig, code))
}

// ─── Effektive Einträge je Block (coalesce Etappe → Konsolidiert) ────────────

function rowToEintrag(r: VariantBkpKosten): BkpEintrag {
  return {
    position_code:           r.position_code,
    status:                  r.status,
    kennwert:                r.kennwert,
    kennwert2:               r.kennwert2,
    bezugsmenge_override:    r.bezugsmenge_override,
    betrag_override:         r.betrag_override,
    mengen_einheit_override: r.mengen_einheit_override,
    mwst_anwenden:           r.mwst_anwenden,
    mwst_satz_override:      r.mwst_satz_override,
    notiz:                   r.notiz,
  }
}

/**
 * Skaliert einen konsolidierten Eintrag auf den Block-Anteil. Absolute Beträge
 * und Mengen werden mit `share` multipliziert; Raten/Prozentsätze/Laufzeiten
 * werden 1:1 geerbt.
 */
function scaleToBlock(e: BkpEintrag, typ: BerechnungsTyp, share: number): BkpEintrag {
  const out: BkpEintrag = { ...e }
  // Pauschal-Override (CHF) immer anteilig.
  if (out.betrag_override != null) out.betrag_override = out.betrag_override * share
  // Kennwert ist nur bei reinen Pauschal-Typen ein absoluter Betrag.
  if (typ.kind === 'pauschal' || typ.kind === 'von_ertrag_vereinfacht') {
    if (out.kennwert != null) out.kennwert = out.kennwert * share
  }
  // Bezugsmenge ist nur bei diesen Typen eine absolute Menge (m³, Stk, CHF-Mehrwert).
  if (
    (typ.kind === 'chf_pro_m3_abbruch' ||
     typ.kind === 'manuell_menge_einheit' ||
     typ.kind === 'auf_mehrwert') &&
    out.bezugsmenge_override != null
  ) {
    out.bezugsmenge_override = out.bezugsmenge_override * share
  }
  return out
}

/** Aggregat-Flag der Konsolidiert-Row für (eigentumsart, position). */
export function aggregateFlag(
  rows: VariantBkpKosten[], eig: Eigentumsart, positionCode: string,
): boolean {
  const kons = rows.find(
    (r) => r.eigentumsart === eig && r.etappe_id === null && r.position_code === positionCode,
  )
  return kons?.aggregate_from_etappen ?? false
}

/** Leerer Eintrag — unterdrückt Katalog-Defaults im Block (kennwert 0). */
function emptyEintrag(pos: BkpPosition): BkpEintrag {
  return {
    position_code: pos.code,
    status: pos.defaultStatus,
    kennwert: 0,
    kennwert2: null,
    bezugsmenge_override: null,
    betrag_override: null,
    mengen_einheit_override: null,
    mwst_anwenden: null,
    mwst_satz_override: null,
    notiz: null,
  }
}

/**
 * Konsolidierter Eintrag mit aufgelöstem Default — der Katalog-Default
 * (defaultKennwert) wird einmalig hier eingesetzt, damit `berechneAnlagekosten`
 * im Block nicht erneut (und damit pro Block multipliziert) den Default anwendet.
 */
function resolveKonsolidiert(kons: VariantBkpKosten | undefined, pos: BkpPosition): BkpEintrag {
  // Ohne Konsolidiert-Row muss der Kennwert NULL bleiben, damit unten der
  // Katalog-Default greift. `emptyEintrag` liefert kennwert 0 (um Defaults im
  // Aggregat-Modus zu unterdrücken) — hier würde das aber den ??-Fallback
  // aushebeln, weil 0 nicht nullish ist. Darum für den fehlenden Fall auf null.
  const base = kons ? rowToEintrag(kons) : { ...emptyEintrag(pos), kennwert: null }
  return { ...base, kennwert: base.kennwert ?? pos.defaultKennwert ?? null }
}

/**
 * Effektive Einträge für (etappe, eigentumsart):
 *   - Flag ON  (aus Etappen aggregiert): nur explizite Etappen-Rows (sonst leer).
 *   - Flag OFF (verteilt): konsolidierter Wert (inkl. aufgelöstem Default), mit
 *     `blockShare` skaliert → Verteilung auf die Blöcke.
 */
export function effectiveEintraege(
  rows: VariantBkpKosten[],
  etappeId: string,
  eig: Eigentumsart,
  blockShare: number,
  positions: BkpPosition[],
  typFor: TypFor,
): Map<string, BkpEintrag> {
  const map = new Map<string, BkpEintrag>()
  for (const pos of positions) {
    const code = pos.code
    if (aggregateFlag(rows, eig, code)) {
      const ov = rows.find(
        (r) => r.eigentumsart === eig && r.etappe_id === etappeId && r.position_code === code,
      )
      map.set(code, ov ? rowToEintrag(ov) : emptyEintrag(pos))
    } else {
      const kons = rows.find(
        (r) => r.eigentumsart === eig && r.etappe_id === null && r.position_code === code,
      )
      // Skalierung nach effektivem Typ (Pauschal-Override wird anteilig verteilt).
      map.set(code, scaleToBlock(resolveKonsolidiert(kons, pos), typFor(code), blockShare))
    }
  }
  return map
}

/** Konsolidierte Row (etappe_id NULL) für (eigentumsart, position). */
export function konsolidiertEintrag(
  rows: VariantBkpKosten[], eig: Eigentumsart, positionCode: string,
): BkpEintrag | null {
  const r = rows.find(
    (x) => x.eigentumsart === eig && x.etappe_id === null && x.position_code === positionCode,
  )
  return r ? rowToEintrag(r) : null
}

// ─── Block-Bezugsgrössen ──────────────────────────────────────────────────────

type BuildingLite = {
  use_type: Parameters<typeof eigentumsartForBuilding>[0]
  etappe_id: string | null
  mietflaechen: Pick<BuildingMietflaeche, 'flaeche_m2' | 'nutzung' | 'anzahl' | 'miete_chf_pa' | 'miete_chf_m2_pa' | 'miete_chf_stk_mt'>[]
}

/** VMF-Total (m²) der Gebäude eines Blocks (etappe × eigentumsart). */
export function blockVmf(buildings: BuildingLite[], etappeId: string, eig: Eigentumsart): number {
  let vmf = 0
  for (const b of buildings) {
    if (b.etappe_id !== etappeId) continue
    if (eigentumsartForBuilding(b.use_type) !== eig) continue
    for (const m of b.mietflaechen) vmf += m.flaeche_m2 || 0
  }
  return vmf
}

/**
 * Jahreswert (CHF) einer Mietfläche — Fallback wie in RenditeBerechnung.
 * Bei Verkaufsobjekten (STWEG) sind die Felder Verkaufspreise: der Stk-Fall
 * ist bereits ein Total (Faktor 1) statt Monatsmiete (×12) — analog dem
 * `F = isVerkauf ? 1 : 12` im Mengengerüst-Recalc.
 */
function mietflaecheErtrag(m: BuildingLite['mietflaechen'][number], isVerkauf: boolean): number {
  const fl = m.flaeche_m2 || 0
  const anz = m.anzahl ?? 1
  const F = isVerkauf ? 1 : 12
  return (m.miete_chf_pa || 0)
    || (m.miete_chf_m2_pa ? m.miete_chf_m2_pa * fl : 0)
    || (m.miete_chf_stk_mt ? m.miete_chf_stk_mt * anz * F : 0)
}

/**
 * Jahreswert je Nutzung für eine Auswahl von Gebäuden (bereits nach Block/Eig
 * gefiltert). Für Rendite-/Genossenschaftsobjekte = Jahresmietertrag, für
 * Verkaufsobjekte (STWEG) = Verkaufserlös (dient 710/720 bzw. 730/740).
 */
export function ertragProNutzung(buildings: BuildingLite[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const b of buildings) {
    const isVerkauf = b.use_type === 'verkaufsobjekt'
    for (const m of b.mietflaechen) {
      const key = (m.nutzung || '').trim() || '(ohne Nutzung)'
      out[key] = (out[key] ?? 0) + mietflaecheErtrag(m, isVerkauf)
    }
  }
  return out
}

/** Eine Nutzung der Ertragsaufstellung, mit ihrer Bezugsgrösse. */
export interface ErtragDetail {
  nutzung: string
  /** Vermiet- bzw. Verkaufsfläche in m². Null bei Nutzungen, die nach Stück zählen. */
  flaecheM2: number
  /** Einheiten (Parkplätze, Garagen …) — Bezugsgrösse, wo keine Fläche erfasst ist. */
  anzahl: number
  /** Jahresmietertrag bzw. Verkaufserlös. */
  ertrag: number
}

/**
 * Wie `ertragProNutzung`, zusätzlich mit Fläche und Stückzahl je Nutzung —
 * damit sich der Ansatz (CHF/m² bzw. CHF/Mt) im Bericht ausweisen lässt.
 *
 * Der Ansatz wird bewusst nicht aus den Eingabefeldern übernommen, sondern
 * aus Ertrag und Menge zurückgerechnet: eine Nutzung kann in mehreren
 * Gebäuden unterschiedlich erfasst sein (Pauschale, CHF/m², CHF/Stück), und
 * nur der Durchschnitt passt dann zur ausgewiesenen Summe.
 */
export function ertragDetailProNutzung(buildings: BuildingLite[]): ErtragDetail[] {
  const flaeche: Record<string, number> = {}
  const anzahl: Record<string, number> = {}
  const ertrag: Record<string, number> = {}
  const reihenfolge: string[] = []
  for (const b of buildings) {
    const isVerkauf = b.use_type === 'verkaufsobjekt'
    for (const m of b.mietflaechen) {
      const key = (m.nutzung || '').trim() || '(ohne Nutzung)'
      if (!(key in ertrag)) reihenfolge.push(key)
      flaeche[key] = (flaeche[key] ?? 0) + (m.flaeche_m2 || 0)
      anzahl[key] = (anzahl[key] ?? 0) + (m.anzahl ?? 1)
      ertrag[key] = (ertrag[key] ?? 0) + mietflaecheErtrag(m, isVerkauf)
    }
  }
  return reihenfolge.map((k) => ({
    nutzung: k, flaecheM2: flaeche[k], anzahl: anzahl[k], ertrag: ertrag[k],
  }))
}

/**
 * Schlüssel eines Kostenblocks (Etappe × Eigentumsart). Wird von der
 * Benchmark- und der keeValue-Methode gleichermassen verwendet — im
 * JSONB-Dokument wie in der Spalte block_key des keeValue-Imports.
 */
export function blockKey(etappeId: string, eig: Eigentumsart): string {
  return `${etappeId}::${eig}`
}

/**
 * Block-Anteil (0..1) aus der GSF-Aufteilung. Ohne Allokation: `defaultShare`
 * (üblich VMF-anteilig, vom Aufrufer berechnet).
 */
export function gsfBlockShare(
  alloc: Pick<VariantEtappeGsfAlloc, 'mode' | 'value'> | null | undefined,
  gsfTotal: number,
  defaultShare: number,
): number {
  if (!alloc || alloc.value == null) return defaultShare
  if (alloc.mode === 'pct') return alloc.value
  return gsfTotal > 0 ? alloc.value / gsfTotal : 0
}

/** m³ je BKP-2-row_key für einen Block (etappe × eigentumsart). Key = roher row_key. */
function bkp2M3ForBlock(aggregat: Bkp2Aggregat, etappeId: string, eig: Eigentumsart): Record<string, number> {
  const out: Record<string, number> = {}
  const et = aggregat.etappen.find((e) => e.etappeId === etappeId)
  const eg = et?.eigentumsarten.find((g) => g.eigentumsart === eig)
  for (const row of eg?.rows ?? []) out[row.rowKey] = row.m3
  return out
}

/** m³ je BKP-2-row_key konsolidiert (Total über alle Etappen) einer Eigentumsart. */
function bkp2M3Konsolidiert(aggregat: Bkp2Aggregat, eig: Eigentumsart): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of bkp2KonsolidiertRows(aggregat, eig)) out[row.rowKey] = row.m3
  return out
}

/** Generierte BKP-2-Positionen (HG 2) einer Eigentumsart — m³ aus dem Mengengerüst. */
export function bkp2GeneratedPositions(aggregat: Bkp2Aggregat, eig: Eigentumsart): BkpPosition[] {
  return bkp2KonsolidiertRows(aggregat, eig).map((row, i) => ({
    code:         `bkp2:${row.rowKey}`,
    displayCode:  String(200 + i * 10),
    hauptgruppe:  2 as BkpHauptgruppe,
    label:        row.label,
    typ:          { kind: 'chf_pro_m3_bkp2', rowKey: row.rowKey },
    defaultStatus:'beruecksichtigt' as const,
    mwst:         true,
  }))
}

/** BkpMengen für einen Block zusammenstellen. */
export function blockMengen(args: {
  buildings: BuildingLite[]
  etappeId: string
  eig: Eigentumsart
  bkp2Aggregat: Bkp2Aggregat
  gsfForBlock: number
  mwstSatzGlobal: number
}): BkpMengen {
  const vmf = blockVmf(args.buildings, args.etappeId, args.eig)
  const blockBuildings = args.buildings.filter(
    (b) => b.etappe_id === args.etappeId && eigentumsartForBuilding(b.use_type) === args.eig,
  )
  return {
    gsf_total_m2:   args.gsfForBlock,
    vmf_total_m2:   vmf,
    uf_total_m2:    args.gsfForBlock,
    bkp2_m3:        bkp2M3ForBlock(args.bkp2Aggregat, args.etappeId, args.eig),
    rueckstellungs_codes: new Set(['560', '570']),
    mwst_satz_global: args.mwstSatzGlobal,
    ertrag_pro_nutzung: ertragProNutzung(blockBuildings),
  }
}

// Re-export der bkp2-Aggregation für Aufrufer, die Block-Mengen brauchen.
export { aggregateBkp2 }

// ─── Aggregat über Blöcke (= Konsolidiert) ───────────────────────────────────

const HG_KEYS: BkpHauptgruppe[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

// Positionstypen, deren Betrag linear „Kennwert × Menge" ist — für diese kann
// der effektive Kennwert im Aggregat zurückgerechnet werden (Σ Betrag / Σ Menge).
const LINEAR_KENNWERT_TYPEN = new Set<BerechnungsTyp['kind']>([
  'chf_pro_m2_gsf', 'chf_pro_m2_vmf', 'chf_pro_m2_uf', 'chf_pro_m3_abbruch',
  'prozent_von_hauptgruppen', 'manuell_menge_einheit', 'auf_mehrwert', 'prozent_von_refs',
  'chf_pro_m3_bkp2',
])

/**
 * Positionsweise Summe mehrerer Block-Ergebnisse → Konsolidiert-Ergebnis.
 * Damit gilt immer „Konsolidiert = Σ Blöcke". Kennwert wird nur ausgewiesen,
 * wenn über alle Blöcke einheitlich, sonst `kennwertGemischt`.
 */
export function aggregateBlocks(bloecke: BkpErgebnis[], typFor?: TypFor): BkpErgebnis {
  const positionen: Record<string, PositionResult> = {}
  const summenNetto = { 0:0,1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0,9:0 } as Record<BkpHauptgruppe, number>
  const summenMwst  = { 0:0,1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0,9:0 } as Record<BkpHauptgruppe, number>

  // Alle vorkommenden Positions-Codes sammeln (Reihenfolge des ersten Blocks).
  const codes: string[] = []
  const seen = new Set<string>()
  for (const b of bloecke) {
    for (const code of Object.keys(b.positionen)) {
      if (!seen.has(code)) { seen.add(code); codes.push(code) }
    }
  }

  for (const code of codes) {
    const parts = bloecke.map((b) => b.positionen[code]).filter(Boolean)
    if (parts.length === 0) continue
    const first = parts[0]
    let netto = 0, menge = 0, mwst = 0, brutto = 0
    let kennwertUniform = true
    const kref = parts[0].kennwert
    for (const p of parts) {
      netto  += p.betragNetto ?? 0
      menge  += p.menge ?? 0
      mwst   += p.mwstBetrag
      brutto += p.betragBrutto
      if (p.kennwert !== kref) kennwertUniform = false
    }
    // Bei linearen „Kennwert × Menge"-Positionen den effektiven Kennwert
    // zurückrechnen (Σ Betrag / Σ Menge) statt „gemischt" anzuzeigen.
    let kennwert = kennwertUniform ? kref : null
    let kennwertGemischt = !kennwertUniform
    const effKind = typFor ? typFor(code).kind : first.position.typ.kind
    if (LINEAR_KENNWERT_TYPEN.has(effKind) && menge !== 0) {
      kennwert = netto / menge
      kennwertGemischt = false
    }
    positionen[code] = {
      ...first,
      kennwert,
      kennwertGemischt,
      menge:          menge || null,
      betragNetto:    netto,
      mwstBetrag:     mwst,
      betragBrutto:   brutto,
    }
    const hg = first.position.hauptgruppe
    summenNetto[hg] += netto
    summenMwst[hg]  += mwst
  }

  let totalNetto = 0, totalMwst = 0
  for (const k of HG_KEYS) { totalNetto += summenNetto[k]; totalMwst += summenMwst[k] }

  return {
    positionen,
    hauptgruppenSummenNetto: summenNetto,
    hauptgruppenSummenMwst:  summenMwst,
    totalNetto, totalMwst, totalBrutto: totalNetto + totalMwst,
  }
}

// ─── Konsolidiert-Tab ─────────────────────────────────────────────────────────

/** Alle konsolidierten Einträge (etappe_id NULL) einer Eigentumsart. */
export function konsolidiertEintraege(
  rows: VariantBkpKosten[], eig: Eigentumsart,
): Map<string, BkpEintrag> {
  const m = new Map<string, BkpEintrag>()
  for (const r of rows) {
    if (r.eigentumsart === eig && r.etappe_id === null) m.set(r.position_code, rowToEintrag(r))
  }
  return m
}

/** Bezugsgrössen für die konsolidierte (etappenübergreifende) Direktrechnung. */
export function konsolidiertMengen(args: {
  buildings: BuildingLite[]
  eig: Eigentumsart
  bkp2Aggregat: Bkp2Aggregat
  gsfTotal: number
  mwstSatzGlobal: number
}): BkpMengen {
  let vmf = 0
  for (const b of args.buildings) {
    if (eigentumsartForBuilding(b.use_type) !== args.eig) continue
    for (const m of b.mietflaechen) vmf += m.flaeche_m2 || 0
  }
  const eigBuildings = args.buildings.filter((b) => eigentumsartForBuilding(b.use_type) === args.eig)
  return {
    gsf_total_m2:   args.gsfTotal,
    vmf_total_m2:   vmf,
    uf_total_m2:    args.gsfTotal,
    bkp2_m3:        bkp2M3Konsolidiert(args.bkp2Aggregat, args.eig),
    rueckstellungs_codes: new Set(['560', '570']),
    mwst_satz_global: args.mwstSatzGlobal,
    ertrag_pro_nutzung: ertragProNutzung(eigBuildings),
  }
}

/**
 * Konsolidiert-Ergebnis einer Eigentumsart: Direktrechnung aus den
 * konsolidierten Einträgen (zeigt die etappenübergreifenden Eingabewerte),
 * aber für Positionen mit Etappen-Override wird Betrag/Menge durch das
 * Aggregat (Summe der Blöcke) ersetzt und der Code als „aggregiert" markiert.
 */
export function buildKonsolidiert(
  rows: VariantBkpKosten[],
  eig: Eigentumsart,
  konsMengen: BkpMengen,
  etappenBloecke: BkpErgebnis[],
  positions: BkpPosition[],
  typFor: TypFor,
): { ergebnis: BkpErgebnis; aggregatCodes: Set<string> } {
  const direct = berechneAnlagekosten(konsolidiertEintraege(rows, eig), konsMengen, positions, typFor)
  const agg = aggregateBlocks(etappenBloecke, typFor)
  const aggregatCodes = new Set<string>()
  const positionen: Record<string, PositionResult> = {}
  const summenNetto = { 0:0,1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0,9:0 } as Record<BkpHauptgruppe, number>
  const summenMwst  = { 0:0,1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0,9:0 } as Record<BkpHauptgruppe, number>

  for (const code of Object.keys(direct.positionen)) {
    const d = direct.positionen[code]
    if (aggregateFlag(rows, eig, code)) {
      aggregatCodes.add(code)
      const a = agg.positionen[code]
      positionen[code] = a ? {
        ...d,
        kennwert:         a.kennwert,
        kennwertGemischt: a.kennwertGemischt,
        menge:            a.menge,
        betragNetto:      a.betragNetto,
        mwstBetrag:       a.mwstBetrag,
        betragBrutto:     a.betragBrutto,
      } : d
    } else {
      positionen[code] = d
    }
    const p = positionen[code]
    if (p.status === 'beruecksichtigt') {
      summenNetto[p.position.hauptgruppe] += p.betragNetto ?? 0
      summenMwst[p.position.hauptgruppe]  += p.mwstBetrag
    }
  }

  let totalNetto = 0, totalMwst = 0
  for (const k of HG_KEYS) { totalNetto += summenNetto[k]; totalMwst += summenMwst[k] }

  return {
    ergebnis: {
      positionen,
      hauptgruppenSummenNetto: summenNetto,
      hauptgruppenSummenMwst:  summenMwst,
      totalNetto, totalMwst, totalBrutto: totalNetto + totalMwst,
    },
    aggregatCodes,
  }
}
