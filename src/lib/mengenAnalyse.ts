// =============================================================================
// Mengen-/Mietzins-Analyse: flacht die Mengengerüst-Daten (Gebäude → Mietflächen
// → Mieteinheiten / Wohnungsmix) zu einer Einheiten-Liste ab und liefert die
// Kennzahlen/Statistik für das Analyse-Dashboard (Übersicht, Spiegel, Mix,
// Preisanalyse, Tabelle). Rein clientseitig, keine Persistenz.
// =============================================================================

import type { VariantBuildingFull } from '@/hooks/useMengengeruest'
import type { BuildingMieteinheit, Wohnungsmix, Eigentumsart } from '@/types'
import {
  eigentumsartForBuilding, EIGENTUMSART_LABEL, isNutzungWohnen,
  effektiveWohnungCounts, WOHNUNGSMIX_LABEL, WOHNUNG_FALLBACK_KEY,
} from '@/types'

// Eine analysierte Einheit (Wohnung / Nutzungseinheit). Repräsentiert ggf.
// mehrere identische Einheiten (`anzahl`); die Kennzahlen sind pro Einheit.
export interface AnalyseUnit {
  id: string
  hausId: string
  haus: string
  etappeId: string | null
  etappe: string
  eig: Eigentumsart
  eigLabel: string
  geschoss: string
  geschossRang: number
  nutzung: string
  istWohnen: boolean
  zimmer: number | null
  zimmerKey: string        // Sortier-/Gruppenschlüssel (z. B. '3.5', 'wohnungen', 'gewerbe:Büro')
  zimmerLabel: string      // Anzeige (z. B. '3.5 Zi', 'Wohnungen', 'Büro')
  wohnungstyp: string | null
  wohnungsnummer: string | null
  bezeichnung: string | null
  anzahl: number           // wie viele Einheiten diese Zeile repräsentiert
  vmf: number              // VMF (m²) pro Einheit
  gf: number               // GF (m²) pro Einheit (0 wenn nicht erfasst)
  mietePa: number          // Netto-Ertrag CHF/Jahr pro Einheit (bei Verkauf: Preis)
  source: 'mieteinheit' | 'wohnungsmix' | 'flaeche'
  /** Ertrag stammt aus der Kostenmiete (Genossenschaft Wohnen), nicht aus dem Mengengerüst. */
  ausKostenmiete: boolean
  /** Im Mengengerüst erfasster Vergleichsmietzins CHF/Jahr (nur wenn `ausKostenmiete`). */
  benchmarkPa: number | null
}

/** Optionen für `buildUnits`. */
export interface BuildUnitsOptions {
  /**
   * Kostenmiete der Eigentumsart Genossenschaft. Ist sie vorhanden, wird der
   * Wohnungsertrag daraus gerechnet statt aus dem Mengengerüst — dort steht bei
   * dieser Eigentumsart nur ein Vergleichswert. Verteilt wird der max.
   * Mietertrag Wohnen über die WBF-Punkte des Wohnungsmix (wie in der
   * Kostenmiete-Sektion), nicht über die Fläche.
   */
  genossenschaftWohnen?: {
    /**
     * Max. Mietertrag Wohnen (CHF/a) der ganzen Variante — konsolidiert über
     * alle Etappen. Eine Genossenschaft führt EINEN Mietzinsspiegel: gleiche
     * Wohnung = gleiche Miete, unabhängig von Etappe und Gebäude.
     */
    maxMietertragWohnenPa: number
    /** WBF-Punkte je Zimmer-Kategorie. */
    punkte: Record<string, number>
  }
}

// Zimmer-Schlüssel einer Einheit auf eine Wohnungsmix-Kategorie normalisieren
// ('3' → '3.0', 7 Zi → '>6.5'), damit die WBF-Punkte greifen.
export function wohnungsmixKey(zimmerKey: string): string {
  if (zimmerKey === WOHNUNG_FALLBACK_KEY || zimmerKey === 'joker') return zimmerKey
  const n = Number(zimmerKey)
  if (!Number.isFinite(n) || n <= 0) return zimmerKey
  return n > 6.5 ? '>6.5' : n.toFixed(1)
}

// ── Geschoss-Rang (oben = grosser Wert), für die Spiegel-Reihenfolge ─────────
export function rankGeschoss(name: string): number {
  const s = (name || '').toLowerCase()
  if (s.includes('attika')) return 1000
  const og = s.match(/(\d+)\s*\.?\s*og/); if (og) return 100 + Number(og[1])
  const ug = s.match(/(\d+)\s*\.?\s*ug/); if (ug) return -Number(ug[1])
  if (s.includes('dach') || /\bdg\b/.test(s)) return 900
  if (s.includes('og')) return 100
  if (s.includes('eg') || s.includes('erdgesch')) return 0
  if (s.includes('ug') || s.includes('keller') || s.includes('unterges')) return -1
  return 50
}

function isVerkaufType(useType: string): boolean { return useType === 'verkaufsobjekt' }

// Netto-Jahresertrag (bzw. Verkaufspreis) einer Mietfläche/Mieteinheit gesamt.
function ertragPa(row: { flaeche_m2: number; anzahl: number | null; miete_chf_pa: number | null; miete_chf_m2_pa: number | null; miete_chf_stk_mt: number | null }, isVerkauf: boolean): number {
  const F = isVerkauf ? 1 : 12
  const fl = row.flaeche_m2 || 0
  const anz = row.anzahl ?? 1
  return (row.miete_chf_pa || 0)
    || (row.miete_chf_m2_pa ? row.miete_chf_m2_pa * fl : 0)
    || (row.miete_chf_stk_mt ? row.miete_chf_stk_mt * anz * F : 0)
}

function parseZimmer(key: string): number | null {
  const n = Number(key)
  return Number.isFinite(n) && n > 0 ? n : null
}
function zimmerLabelFromKey(key: string): string {
  if (key === WOHNUNG_FALLBACK_KEY) return 'Wohnungen'
  if (key === 'joker') return 'Joker'
  return `${WOHNUNGSMIX_LABEL[key as keyof Wohnungsmix] ?? key} Zi`
}
function zimmerFromEinheit(u: BuildingMieteinheit): { zimmer: number | null; key: string; label: string } {
  if (u.zimmer != null && u.zimmer > 0) return { zimmer: u.zimmer, key: String(u.zimmer), label: `${u.zimmer} Zi` }
  // Sonst aus dem Mix der Einheit die dominante Zimmerzahl ableiten.
  const counts = effektiveWohnungCounts('Wohnen', u.wohnungsmix, u.anzahl)
  const top = counts.slice().sort((a, b) => b[1] - a[1])[0]
  if (top) return { zimmer: parseZimmer(top[0]), key: top[0], label: zimmerLabelFromKey(top[0]) }
  return { zimmer: null, key: WOHNUNG_FALLBACK_KEY, label: 'Wohnungen' }
}

// ── Flattener: Gebäude → Einheiten ───────────────────────────────────────────
export function buildUnits(
  buildings: VariantBuildingFull[],
  etappen: { id: string; name: string }[],
  opts: BuildUnitsOptions = {},
): AnalyseUnit[] {
  const etName = (id: string | null) => (id ? (etappen.find((e) => e.id === id)?.name ?? 'Etappe') : 'Ohne Etappe')
  const out: AnalyseUnit[] = []
  const defaults = { ausKostenmiete: false, benchmarkPa: null }

  for (const b of buildings) {
    const eig = eigentumsartForBuilding(b.use_type)
    const isVerkauf = isVerkaufType(b.use_type)
    const base = {
      hausId: b.id, haus: b.name || 'Gebäude',
      etappeId: b.etappe_id ?? null, etappe: etName(b.etappe_id ?? null),
      eig, eigLabel: EIGENTUMSART_LABEL[eig],
    }

    for (const m of (b.mietflaechen ?? [])) {
      const geschoss = m.geschoss_bezeichnung?.trim() || '–'
      const nutzung = m.nutzung?.trim() || '(ohne Nutzung)'
      const istWohnen = isNutzungWohnen(nutzung)
      const geo = { geschoss, geschossRang: rankGeschoss(geschoss), nutzung, istWohnen }
      const units = m.mieteinheiten ?? []

      if (units.length > 0) {
        // Fein: je Mieteinheit eine Zeile (anzahl-gewichtet, Kennzahlen pro Einheit).
        units.forEach((u, i) => {
          const anz = u.anzahl && u.anzahl > 0 ? u.anzahl : 1
          const vmfTot = u.flaeche_m2 || 0
          const ertTot = ertragPa(u, isVerkauf)
          const z = istWohnen ? zimmerFromEinheit(u) : { zimmer: null, key: `nutzung:${nutzung}`, label: nutzung }
          out.push({
            ...base, ...geo,
            id: `${u.id || `${m.id}-u${i}`}`,
            zimmer: z.zimmer, zimmerKey: z.key, zimmerLabel: z.label,
            wohnungstyp: u.wohnungstyp ?? null, wohnungsnummer: u.wohnungsnummer ?? null,
            bezeichnung: u.bezeichnung ?? null,
            anzahl: anz, vmf: vmfTot / anz, gf: (u.gf_m2 ?? 0) / anz,
            mietePa: ertTot / anz, source: 'mieteinheit', ...defaults,
          })
        })
        continue
      }

      const vmfTot = m.flaeche_m2 || 0
      const ertTot = ertragPa(m, isVerkauf)

      if (istWohnen) {
        const counts = effektiveWohnungCounts(nutzung, m.wohnungsmix, m.anzahl)
        const totalApts = counts.reduce((s, [, c]) => s + c, 0)
        if (totalApts > 0) {
          const vmfPer = vmfTot / totalApts
          const gfPer = (m.gf_m2 ?? 0) / totalApts
          const ertPer = ertTot / totalApts
          counts.forEach(([key, n]) => {
            out.push({
              ...base, ...geo,
              id: `${m.id}-mix-${key}`,
              zimmer: parseZimmer(key), zimmerKey: key, zimmerLabel: zimmerLabelFromKey(key),
              wohnungstyp: null, wohnungsnummer: null, bezeichnung: m.bezeichnung ?? null,
              anzahl: n, vmf: vmfPer, gf: gfPer, mietePa: ertPer, source: 'wohnungsmix', ...defaults,
            })
          })
          continue
        }
      }

      // Nicht-Wohnen oder ohne Mix: die Mietfläche als eine (ggf. n-fache) Einheit.
      const anz = m.anzahl && m.anzahl > 0 ? m.anzahl : 1
      out.push({
        ...base, ...geo,
        id: `${m.id}-fl`,
        zimmer: istWohnen ? null : null,
        zimmerKey: istWohnen ? WOHNUNG_FALLBACK_KEY : `nutzung:${nutzung}`,
        zimmerLabel: istWohnen ? 'Wohnungen' : nutzung,
        wohnungstyp: null, wohnungsnummer: null, bezeichnung: m.bezeichnung ?? null,
        anzahl: anz, vmf: vmfTot / anz, gf: (m.gf_m2 ?? 0) / anz,
        mietePa: ertTot / anz, source: 'flaeche', ...defaults,
      })
    }
  }

  // Genossenschaft: Wohnungserträge aus der Kostenmiete statt aus dem
  // Mengengerüst — dort steht bei dieser Eigentumsart nur ein Vergleichswert.
  // Übrige Nutzungen (Gewerbe, Parkplätze …) behalten ihren erfassten Ertrag,
  // er wird im Kostenmietmodell als Ist-Ertrag abgezogen.
  if (opts.genossenschaftWohnen) verteileKostenmiete(out, opts.genossenschaftWohnen)
  return out
}

/**
 * WBF-Punkte je Wohnung für eine Menge Wohn-Einheiten. Wohnungen ohne
 * Zimmerkategorie erhalten die mittlere Punktzahl der übrigen; ist gar keine
 * Kategorie zuordenbar, zählt jede Wohnung gleich (1 Punkt).
 */
export function punkteJeWohnung(
  us: AnalyseUnit[], punkte: Record<string, number>,
): (u: AnalyseUnit) => number {
  const pktOf = (u: AnalyseUnit) => punkte[wohnungsmixKey(u.zimmerKey)] ?? 0
  const bekannt = us.filter((u) => pktOf(u) > 0)
  const bekannteWhg = bekannt.reduce((s, u) => s + u.anzahl, 0)
  const avg = bekannteWhg > 0
    ? bekannt.reduce((s, u) => s + pktOf(u) * u.anzahl, 0) / bekannteWhg
    : 1
  return (u) => (pktOf(u) > 0 ? pktOf(u) : avg)
}

export interface WohnungsmieteZeile {
  key: string           // Wohnungsmix-Kategorie ('1.5', 'joker', 'wohnungen')
  label: string
  anzahl: number
  punkte: number        // WBF-Punkte je Wohnung
  mieteMt: number       // CHF/Monat je Wohnung
}
export interface WohnungsmietenErgebnis {
  rows: WohnungsmieteZeile[]
  punkteTotal: number
  anzahlTotal: number
  maxWohnenPa: number
  monatlichTotal: number
}

/**
 * Max. Mietertrag Wohnen über die WBF-Punkte auf die einzelnen Wohnungen
 * verteilen — die eine Wahrheit für Kostenmiete-Sektion und Analyse:
 *   Miete je Wohnung = max. Mietertrag Wohnen / Punkte-Total × Punkte des Typs / 12
 */
export function wohnungsmieten(
  us: AnalyseUnit[], punkte: Record<string, number>, maxWohnenPa: number,
): WohnungsmietenErgebnis {
  const pkt = punkteJeWohnung(us, punkte)
  const punkteTotal = us.reduce((s, u) => s + pkt(u) * u.anzahl, 0)
  const proPunktMt = punkteTotal > 0 ? maxWohnenPa / punkteTotal / 12 : 0

  const grp = new Map<string, WohnungsmieteZeile>()
  for (const u of us) {
    const key = wohnungsmixKey(u.zimmerKey)
    const z = grp.get(key) ?? { key, label: zimmerLabelFromKey(key), anzahl: 0, punkte: pkt(u), mieteMt: proPunktMt * pkt(u) }
    z.anzahl += u.anzahl
    grp.set(key, z)
  }
  const rows = [...grp.values()].sort((a, b) => {
    const na = Number(a.key), nb = Number(b.key)
    return (Number.isFinite(na) ? na : 99) - (Number.isFinite(nb) ? nb : 99)
  })
  const anzahlTotal = us.reduce((s, u) => s + u.anzahl, 0)
  return { rows, punkteTotal, anzahlTotal, maxWohnenPa, monatlichTotal: maxWohnenPa / 12 }
}

/**
 * Kostenmiete auf alle Genossenschafts-Wohneinheiten der Variante verteilen —
 * konsolidiert, nicht je Etappe: dieselbe Wohnungskategorie ergibt überall
 * dieselbe Miete, genau wie in der Aufstellung der Kostenmiete-Sektion.
 */
function verteileKostenmiete(units: AnalyseUnit[], km: NonNullable<BuildUnitsOptions['genossenschaftWohnen']>): void {
  if (!Number.isFinite(km.maxMietertragWohnenPa)) return
  const us = units.filter((u) => u.eig === 'genossenschaft' && u.istWohnen)
  if (!us.length) return

  const pkt = punkteJeWohnung(us, km.punkte)
  const punkteTotal = us.reduce((s, u) => s + pkt(u) * u.anzahl, 0)
  if (punkteTotal <= 0) return
  const proPunkt = km.maxMietertragWohnenPa / punkteTotal

  for (const u of us) {
    u.benchmarkPa = u.mietePa
    u.ausKostenmiete = true
    u.mietePa = pkt(u) * proPunkt
  }
}

// ── Filter ───────────────────────────────────────────────────────────────────
export interface AnalyseFilter {
  etappe: Set<string>
  eig: Set<string>
  haus: Set<string>
  nutzung: Set<string>
  zimmer: Set<string>
  wohnungstyp: Set<string>
  geschoss: Set<string>
}
export function emptyFilter(): AnalyseFilter {
  return { etappe: new Set(), eig: new Set(), haus: new Set(), nutzung: new Set(), zimmer: new Set(), wohnungstyp: new Set(), geschoss: new Set() }
}
export function filterUnits(units: AnalyseUnit[], f: AnalyseFilter): AnalyseUnit[] {
  return units.filter((u) =>
    (!f.etappe.size || f.etappe.has(u.etappeId ?? 'none')) &&
    (!f.eig.size || f.eig.has(u.eig)) &&
    (!f.haus.size || f.haus.has(u.hausId)) &&
    (!f.nutzung.size || f.nutzung.has(u.nutzung)) &&
    (!f.zimmer.size || f.zimmer.has(u.zimmerKey)) &&
    (!f.wohnungstyp.size || f.wohnungstyp.has(u.wohnungstyp ?? '—')) &&
    (!f.geschoss.size || f.geschoss.has(u.geschoss)))
}
export function isFiltered(f: AnalyseFilter): boolean {
  return Object.values(f).some((s) => s.size > 0)
}

// ── Kennzahl-Zugriff (Fläche VMF/GF, Wert Monat/Jahr/pro m²) ─────────────────
export type FlaecheBasis = 'vmf' | 'gf'
export const flaecheOf = (u: AnalyseUnit, b: FlaecheBasis) => (b === 'gf' && u.gf > 0 ? u.gf : u.vmf)
export const mieteMonat = (u: AnalyseUnit) => u.mietePa / 12
export const chfM2a = (u: AnalyseUnit, b: FlaecheBasis) => { const f = flaecheOf(u, b); return f > 0 ? u.mietePa / f : 0 }

// ── Aggregation & Statistik (anzahl-gewichtet) ──────────────────────────────
export const sumW = (units: AnalyseUnit[], val: (u: AnalyseUnit) => number) => units.reduce((s, u) => s + val(u) * u.anzahl, 0)
export const countW = (units: AnalyseUnit[]) => units.reduce((s, u) => s + u.anzahl, 0)

export interface Spanne { min: number; avg: number; med: number; max: number }
export function spanne(units: AnalyseUnit[], val: (u: AnalyseUnit) => number): Spanne | null {
  if (!units.length) return null
  const vals = units.map(val)
  const totW = countW(units)
  const avgw = totW > 0 ? units.reduce((s, u) => s + val(u) * u.anzahl, 0) / totW : 0
  const sorted = vals.slice().sort((a, b) => a - b)
  const m = sorted.length >> 1
  const md = sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2
  return { min: Math.min(...vals), avg: avgw, med: md, max: Math.max(...vals) }
}

export interface RegResult { slope: number; intercept: number; r2: number }
export function regression(pts: { x: number; y: number }[]): RegResult | null {
  const n = pts.length
  if (n < 3) return null
  const mx = pts.reduce((s, p) => s + p.x, 0) / n
  const my = pts.reduce((s, p) => s + p.y, 0) / n
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0) || 1
  const slope = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx
  const intercept = my - slope * mx
  const ssRes = pts.reduce((s, p) => s + (p.y - (intercept + slope * p.x)) ** 2, 0)
  const ssTot = pts.reduce((s, p) => s + (p.y - my) ** 2, 0) || 1
  return { slope, intercept, r2: 1 - ssRes / ssTot }
}

// Histogramm: gewichtete Klassen (anzahl je Einheit).
export function histogram(units: AnalyseUnit[], val: (u: AnalyseUnit) => number, binw: number): { label: number; count: number }[] {
  if (!units.length) return []
  const vals = units.map(val)
  const lo = Math.floor(Math.min(...vals) / binw) * binw
  const hi = Math.ceil(Math.max(...vals) / binw) * binw
  const nb = Math.max(1, Math.round((hi - lo) / binw))
  const bins = Array.from({ length: nb }, () => 0)
  units.forEach((u) => { let i = Math.floor((val(u) - lo) / binw); if (i >= nb) i = nb - 1; if (i < 0) i = 0; bins[i] += u.anzahl })
  return bins.map((c, i) => ({ label: lo + i * binw, count: c }))
}
