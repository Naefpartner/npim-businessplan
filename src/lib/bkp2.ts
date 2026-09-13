// BKP 2 (Hauptgruppe „Gebäude") nach Naef-Schema.
//
// Erfassung auf VARIANTENEBENE (nicht mehr pro Gebäude): die Mengen (m³) kommen
// aus dem Mengengerüst (`building_mietflaechen`) und werden aggregiert nach
//   Etappe × Eigentumsart × Zeile
// wobei die Zeile entweder eine Nutzung (oberirdisch), „Unterirdisch" (Keller,
// Nebenräume) oder „Tiefgarage" ist. Pro Zeile wird im Kostentab ein Kennwert
// (CHF/m³) bzw. eine Pauschale erfasst.

import type {
  BuildingMietflaeche, VariantBuilding, VariantEtappe, Eigentumsart, VariantBkp2Kennwert,
} from '@/types'
import { eigentumsartForBuilding, EIGENTUMSART_LABEL } from '@/types'

export type Bkp2RowKind = 'nutzung' | 'unterirdisch' | 'tiefgarage'

export const UNTERIRDISCH_KEY = 'unterirdisch'
export const TIEFGARAGE_KEY   = 'tiefgarage'

export const UNTERIRDISCH_LABEL = 'Unterirdisch (Keller, Nebenräume)'
export const TIEFGARAGE_LABEL   = 'Tiefgarage'

// Reihenfolge der Eigentumsarten in der Anzeige.
export const EIGENTUMSART_ORDER: Eigentumsart[] = ['renditeobjekt', 'genossenschaft', 'verkaufsobjekt']

export interface Bkp2Row {
  /** Schlüssel für die Kennwert-Zuordnung (Nutzung kleingeschrieben | 'unterirdisch' | 'tiefgarage') */
  rowKey: string
  /** Anzeige-Label */
  label: string
  kind: Bkp2RowKind
  /** Aggregiertes Volumen (m³) aus dem Mengengerüst */
  m3: number
}

export interface Bkp2EigentumsartGroup {
  eigentumsart: Eigentumsart
  label: string
  rows: Bkp2Row[]
}

export interface Bkp2EtappeGroup {
  /** null = Gebäude ohne (noch) zugeordnete Etappe */
  etappeId: string | null
  etappeName: string
  eigentumsarten: Bkp2EigentumsartGroup[]
}

export interface Bkp2Aggregat {
  etappen: Bkp2EtappeGroup[]
}

/** Erkennt Parking/Tiefgarage anhand der Nutzungsbezeichnung. */
export function isGarageNutzung(nutzung: string): boolean {
  const n = nutzung.toLowerCase()
  return n.includes('park') || n.includes('garage')
}

/**
 * Erkennt Nutzungen, die je Stück vermietet oder gerechnet werden —
 * Parkplätze, Einstellhallen, Abstellplätze. Weiter gefasst als
 * `isGarageNutzung`, das nur die Zuordnung zur BKP-2-Zeile trifft.
 */
export function isParkNutzung(nutzung: string): boolean {
  return isGarageNutzung(nutzung)
    || /\bpp\b|parkpl|parkplatz|tiefgarage|einstellh|autoeinstell|abstellplatz/i.test(nutzung)
}

/**
 * Ordnet eine Mietflächen-Zeile einer BKP-2-Zeile zu:
 *   - Parking/Garage          → Tiefgarage
 *   - sonst unterirdisch       → Unterirdisch (Keller, Nebenräume)
 *   - sonst (oberirdisch)      → Nutzung (Label = Nutzungsbezeichnung)
 */
export function classifyMietflaeche(
  m: Pick<BuildingMietflaeche, 'nutzung' | 'unterirdisch'>,
): { rowKey: string; label: string; kind: Bkp2RowKind } {
  const nutzung = (m.nutzung ?? '').trim()
  if (isGarageNutzung(nutzung)) {
    return { rowKey: TIEFGARAGE_KEY, label: TIEFGARAGE_LABEL, kind: 'tiefgarage' }
  }
  if (m.unterirdisch) {
    return { rowKey: UNTERIRDISCH_KEY, label: UNTERIRDISCH_LABEL, kind: 'unterirdisch' }
  }
  return { rowKey: nutzung.toLowerCase(), label: nutzung || '(ohne Nutzung)', kind: 'nutzung' }
}

type BuildingWithMietflaechen = Pick<VariantBuilding, 'use_type' | 'etappe_id'> & {
  mietflaechen: Pick<BuildingMietflaeche, 'nutzung' | 'unterirdisch' | 'volumen_m3'>[]
}

/**
 * Aggregiert die Volumen aller Gebäude einer Variante zur BKP-2-Struktur
 * (Etappe → Eigentumsart → Zeilen). Etappen werden in der übergebenen
 * Reihenfolge ausgegeben; Gebäude ohne zuordenbare Etappe landen in einer
 * zusätzlichen „ohne Etappe"-Gruppe am Ende.
 */
export function aggregateBkp2(
  buildings: BuildingWithMietflaechen[],
  etappen: Pick<VariantEtappe, 'id' | 'name'>[],
): Bkp2Aggregat {
  // map: etappeId -> eigentumsart -> rowKey -> { label, kind, m3 }
  type RowAcc = { label: string; kind: Bkp2RowKind; m3: number }
  const acc = new Map<string, Map<Eigentumsart, Map<string, RowAcc>>>()

  const NONE = '__none__'

  for (const b of buildings) {
    const eig = eigentumsartForBuilding(b.use_type)
    const etId = b.etappe_id ?? NONE
    for (const m of b.mietflaechen) {
      const vol = m.volumen_m3 ?? 0
      if (vol <= 0) continue
      const cls = classifyMietflaeche(m)
      if (!acc.has(etId)) acc.set(etId, new Map())
      const byEig = acc.get(etId)!
      if (!byEig.has(eig)) byEig.set(eig, new Map())
      const byRow = byEig.get(eig)!
      const existing = byRow.get(cls.rowKey)
      if (existing) existing.m3 += vol
      else byRow.set(cls.rowKey, { label: cls.label, kind: cls.kind, m3: vol })
    }
  }

  // Zeilen einer Eigentumsart in stabile Reihenfolge bringen:
  // Nutzungen (alphabetisch) → Unterirdisch → Tiefgarage.
  function orderRows(byRow: Map<string, RowAcc>): Bkp2Row[] {
    const rows: Bkp2Row[] = [...byRow.entries()].map(([rowKey, v]) => ({
      rowKey, label: v.label, kind: v.kind, m3: v.m3,
    }))
    const kindRank: Record<Bkp2RowKind, number> = { nutzung: 0, unterirdisch: 1, tiefgarage: 2 }
    return rows.sort((a, b) =>
      kindRank[a.kind] - kindRank[b.kind] || a.label.localeCompare(b.label, 'de'),
    )
  }

  function buildEtappeGroup(etappeId: string | null, etappeName: string): Bkp2EtappeGroup {
    const key = etappeId ?? NONE
    const byEig = acc.get(key)
    const eigentumsarten: Bkp2EigentumsartGroup[] = []
    for (const eig of EIGENTUMSART_ORDER) {
      const byRow = byEig?.get(eig)
      if (!byRow || byRow.size === 0) continue
      eigentumsarten.push({ eigentumsart: eig, label: EIGENTUMSART_LABEL[eig], rows: orderRows(byRow) })
    }
    return { etappeId, etappeName, eigentumsarten }
  }

  const out: Bkp2EtappeGroup[] = etappen.map((e) => buildEtappeGroup(e.id, e.name))
  // „ohne Etappe" nur anhängen, wenn dort tatsächlich Volumen liegt.
  if (acc.has(NONE)) out.push(buildEtappeGroup(null, 'Ohne Etappe'))
  return { etappen: out }
}

/** Betrag einer Zeile: Pauschale (falls gesetzt) sonst Kennwert × m³. */
export function bkp2RowBetrag(
  kennwert: Pick<VariantBkp2Kennwert, 'chf_pro_m3' | 'pauschal_chf'> | null | undefined,
  m3: number,
): number {
  if (kennwert?.pauschal_chf != null) return kennwert.pauschal_chf
  if (kennwert?.chf_pro_m3 == null || m3 <= 0) return 0
  return kennwert.chf_pro_m3 * m3
}

export type Bkp2KennwertLookup = (
  etappeId: string | null, eigentumsart: Eigentumsart, rowKey: string,
) => Pick<VariantBkp2Kennwert, 'chf_pro_m3' | 'pauschal_chf'> | null

/** Summe aller BKP-2-Beträge der Variante (netto). */
export function bkp2VariantTotal(aggregat: Bkp2Aggregat, getKennwert: Bkp2KennwertLookup): number {
  let total = 0
  for (const et of aggregat.etappen) {
    for (const eg of et.eigentumsarten) {
      for (const row of eg.rows) {
        total += bkp2RowBetrag(getKennwert(et.etappeId, eg.eigentumsart, row.rowKey), row.m3)
      }
    }
  }
  return total
}

/**
 * BKP-2-Netto-Total NUR für einen Block (eine Etappe × Eigentumsart) — für die
 * blockweise Anlagekostenberechnung, damit nicht über alle Gruppen doppelt
 * gezählt wird. Summe über alle Blöcke == bkp2VariantTotal.
 */
export function bkp2BlockTotal(
  aggregat: Bkp2Aggregat,
  getKennwert: Bkp2KennwertLookup,
  etappeId: string | null,
  eigentumsart: Eigentumsart,
): number {
  const et = aggregat.etappen.find((e) => e.etappeId === etappeId)
  if (!et) return 0
  const eg = et.eigentumsarten.find((g) => g.eigentumsart === eigentumsart)
  if (!eg) return 0
  let total = 0
  for (const row of eg.rows) {
    total += bkp2RowBetrag(getKennwert(etappeId, eigentumsart, row.rowKey), row.m3)
  }
  return total
}

const ROW_RANK: Record<Bkp2RowKind, number> = { nutzung: 0, unterirdisch: 1, tiefgarage: 2 }

/** Konsolidierte Zeilen einer Eigentumsart: pro rowKey das Total-m³ über alle Etappen. */
export function bkp2KonsolidiertRows(aggregat: Bkp2Aggregat, eig: Eigentumsart): Bkp2Row[] {
  const map = new Map<string, Bkp2Row>()
  for (const et of aggregat.etappen) {
    const eg = et.eigentumsarten.find((g) => g.eigentumsart === eig)
    if (!eg) continue
    for (const row of eg.rows) {
      const ex = map.get(row.rowKey)
      if (ex) ex.m3 += row.m3
      else map.set(row.rowKey, { ...row })
    }
  }
  return [...map.values()].sort((a, b) => ROW_RANK[a.kind] - ROW_RANK[b.kind] || a.label.localeCompare(b.label, 'de'))
}

/** Aggregierter Netto-Betrag + m³ einer Konsolidiert-Zeile über alle Etappen (effektive Kennwerte). */
export function bkp2RowAggregat(
  aggregat: Bkp2Aggregat, getEffective: Bkp2KennwertLookup, eig: Eigentumsart, rowKey: string,
): { betrag: number; m3: number } {
  let betrag = 0, m3 = 0
  for (const et of aggregat.etappen) {
    if (et.etappeId == null) continue
    const eg = et.eigentumsarten.find((g) => g.eigentumsart === eig)
    const row = eg?.rows.find((r) => r.rowKey === rowKey)
    if (!row) continue
    m3 += row.m3
    betrag += bkp2RowBetrag(getEffective(et.etappeId, eig, rowKey), row.m3)
  }
  return { betrag, m3 }
}
