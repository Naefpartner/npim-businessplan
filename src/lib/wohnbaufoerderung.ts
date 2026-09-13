// Gemeinsame Grundlagen der beiden Anlagekostenlimiten — kantonale
// Wohnbauförderung ZH (WBF) und Bundesamt für Wohnungswesen (BWO).
//
// Beide rechnen auf denselben Mengen der Eigentumsart „Genossenschaft":
// dem Wohnungsmix und den übrigen Nutzungen. Nur die Ansätze unterscheiden
// sich — das WBF-Modell rechnet die Flächen in m² VMF, das BWO-Modell zählt
// Einheiten. Die Sektionen der Variante und das Berichtskapitel teilen sich
// diese Funktionen, damit dieselben Zahlen dastehen.

import { isParkNutzung } from '@/lib/bkp2'
import type { VariantBuildingFull } from '@/hooks/useMengengeruest'
import {
  eigentumsartForBuilding, isNutzungWohnen, WOHNUNGSMIX_KEYS,
} from '@/types'

/** Eine Nutzung ausser Wohnen, mit Fläche und Stückzahl. */
export interface NebenNutzung {
  nutzung: string
  isPark: boolean
  /** Vermietbare Fläche in m² — Bezug des WBF-Ansatzes. */
  flaeche: number
  /** Anzahl Einheiten — Bezug der BWO-Limite und des WBF-Ansatzes bei Parkplätzen. */
  anzahl: number
}

/**
 * Wohnungsmix der Genossenschaft aus den Mengen. `etappeId = null`
 * konsolidiert über alle Etappen, sonst nur deren Gebäude.
 */
export function sammleWohnungsmix(
  buildings: VariantBuildingFull[], etappeId: string | null,
): Record<string, number> {
  const mix: Record<string, number> = {}
  for (const k of WOHNUNGSMIX_KEYS) mix[k as string] = 0
  for (const b of buildings) {
    if (eigentumsartForBuilding(b.use_type) !== 'genossenschaft') continue
    if (etappeId != null && b.etappe_id !== etappeId) continue
    for (const mf of (b.mietflaechen ?? [])) {
      if (!isNutzungWohnen(mf.nutzung) || !mf.wohnungsmix) continue
      for (const k of WOHNUNGSMIX_KEYS) mix[k as string] += mf.wohnungsmix[k] ?? 0
    }
  }
  return mix
}

/**
 * Die übrigen Nutzungen der Genossenschaft, nach Bezeichnung gruppiert.
 * Geführt werden Fläche und Stückzahl — welche der beiden zählt, entscheidet
 * das Modell, das darauf rechnet.
 */
export function sammleNebenNutzungen(
  buildings: VariantBuildingFull[], etappeId: string | null,
): NebenNutzung[] {
  const map = new Map<string, NebenNutzung>()
  for (const b of buildings) {
    if (eigentumsartForBuilding(b.use_type) !== 'genossenschaft') continue
    if (etappeId != null && b.etappe_id !== etappeId) continue
    for (const mf of (b.mietflaechen ?? [])) {
      if (isNutzungWohnen(mf.nutzung)) continue
      const name = (mf.nutzung || '').trim() || '(ohne Nutzung)'
      const e = map.get(name)
        ?? { nutzung: name, isPark: isParkNutzung(name), flaeche: 0, anzahl: 0 }
      e.flaeche += mf.flaeche_m2 || 0
      e.anzahl += mf.anzahl || 0
      map.set(name, e)
    }
  }
  return [...map.values()]
    .sort((a, b) => Number(a.isPark) - Number(b.isPark) || a.nutzung.localeCompare(b.nutzung))
}

/** Menge, mit der das WBF-Modell rechnet: Parkplätze je Stück, sonst je m² VMF. */
export function wbfMenge(n: NebenNutzung): number {
  return n.isPark ? n.anzahl : n.flaeche
}
