import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Home, Layers } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts'
import {
  useMengengeruestShared, useVariantEtappenGeteilt,
} from '@/contexts/VariantDataContext'
import { useVariantEtappen } from '@/hooks/useVariantEtappen'
import {
  WOHNUNGSMIX_KEYS, WOHNUNGSMIX_LABEL, isNutzungWohnen, effektiveWohnungCounts, WOHNUNG_FALLBACK_KEY,
  USE_TYPE_LABEL,
  type ProjectUseType, type Wohnungsmix,
} from '@/types'

// Label eines Mix-Schlüssels; Fallback (nur Stückzahl) im Diagramm „Wohnung",
// in der Mix-Tabelle „Wohnungen".
const mixLabelViz = (k: string) => (k === WOHNUNG_FALLBACK_KEY ? 'Wohnung' : WOHNUNGSMIX_LABEL[k as keyof Wohnungsmix] ?? k)
const mixLabelTab = (k: string) => (k === WOHNUNG_FALLBACK_KEY ? 'Wohnungen' : WOHNUNGSMIX_LABEL[k as keyof Wohnungsmix] ?? k)
const istZimmer = (k: string) => k !== 'joker' && k !== WOHNUNG_FALLBACK_KEY
const MIX_ROW_KEYS: string[] = [...(WOHNUNGSMIX_KEYS as readonly string[]), WOHNUNG_FALLBACK_KEY]
import { isGarageNutzung } from '@/lib/bkp2'
import { USE_TYPE_COLOR, USE_TYPE_COLOR_7, TOTAL_COLOR } from '@/lib/kategorieFarben'
import { CHART_PALETTE } from '@/lib/ci'
import { cn, formatNumber } from '@/lib/utils'

/** Parking/Garage/PP – zählt nicht zur Nutzungsverteilung. */
function isParkNutzung(nutzung: string): boolean {
  return isGarageNutzung(nutzung) || /\bpp\b|parkplatz|parkpl\.?/i.test(nutzung)
}

/** Nebenräume (in der Visualisierung grau dargestellt). */
function isNebenraum(nutzung: string): boolean {
  return /nebenr/i.test(nutzung)
}

// Lesbare Textfarbe (dunkel/hell) je nach Helligkeit der Hintergrundfarbe.
function readableText(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length < 6) return '#ffffff'
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#1e293b' : '#ffffff'
}

// Geschoss-Rang für die Stapel-Reihenfolge (höher = weiter oben).
function rankGeschoss(name: string): number {
  const s = name.toLowerCase()
  if (s.includes('attika')) return 1000
  const og = s.match(/(\d+)\s*\.?\s*og/); if (og) return 100 + Number(og[1])
  const ug = s.match(/(\d+)\s*\.?\s*ug/); if (ug) return -Number(ug[1])
  if (s.includes('dach') || /\bdg\b/.test(s)) return 900
  if (s.includes('og')) return 100
  if (s.includes('eg') || s.includes('erdgesch')) return 0
  if (s.includes('ug') || s.includes('keller') || s.includes('unterges')) return -1
  return 50 // unbekannt → Mitte
}

// Ein Flächensegment innerhalb eines Geschosses (Wohnung oder andere Nutzung).
interface VizSeg { label: string; sub: string; nutzung: string; m2: number; color: string }
interface VizFloor {
  name: string; rank: number
  /** Geschossfläche (GF) für die Breite; Fallback VMF. */
  size: number
  vmf: number
  segs: VizSeg[]
  isPark: boolean
  pp: number
}
interface VizBuilding {
  id: string; name: string; etappeId: string | null; useType: ProjectUseType
  floors: VizFloor[]; maxSize: number; totalApts: number; pp: number
}

// Eigentumskategorien für den Wohnungsmix (inkl. Genossenschaft).
const CAT_ORDER: ProjectUseType[] = ['renditeobjekt', 'genossenschaft', 'verkaufsobjekt', 'gemischt']
// Farben je Eigentumskategorie aus der zentralen Palette — gleiche Quelle für
// Donut, Karten-Header und Balkendiagramme (Orientierung über alle Module).
const CAT_COLOR_BY_LABEL: Record<string, string> = {
  [USE_TYPE_LABEL.renditeobjekt]:  USE_TYPE_COLOR.renditeobjekt,
  [USE_TYPE_LABEL.genossenschaft]: USE_TYPE_COLOR.genossenschaft,
  [USE_TYPE_LABEL.verkaufsobjekt]: USE_TYPE_COLOR.verkaufsobjekt,
  [USE_TYPE_LABEL.gemischt]:       USE_TYPE_COLOR.gemischt,
}
const catColor = (name: string) => CAT_COLOR_BY_LABEL[name] ?? '#cbd5e1'
const cardColor = (cat: ProjectUseType | null) => (cat ? USE_TYPE_COLOR[cat] : TOTAL_COLOR)
// Qualitative Palette für die Nutzungsverteilung — CI-Diagrammreihenfolge.
const PALETTE = CHART_PALETTE

interface MixGroup {
  etappeId: string | null
  etappeName: string
  cat: ProjectUseType | null   // null = Total über alle Eigentumskategorien
  rows: { key: string; label: string; anzahl: number; avgM2: number }[]
  totalAnzahl: number
  totalM2: number
}

interface NutzungItem { name: string; m2: number; pct: number }
interface NutzungBlock { etappeId: string | null; etappeName: string; total: number; items: NutzungItem[] }

function toNutzungItems(m: Map<string, number>): { items: NutzungItem[]; total: number } {
  // Nur Nutzungen mit effektiver Fläche (> 0 m²).
  const entries = [...m.entries()].filter(([, m2]) => m2 > 0)
  const total = entries.reduce((s, [, v]) => s + v, 0)
  const items = entries
    .map(([name, m2]) => ({ name, m2, pct: total > 0 ? m2 / total : 0 }))
    .sort((a, b) => b.m2 - a.m2)
  return { items, total }
}

type CountMap = { anzahl: Map<string, number>; m2: Map<string, number> }

function emptyCount(): CountMap {
  return { anzahl: new Map(), m2: new Map() }
}

function addCounts(target: CountMap, counts: readonly (readonly [string, number])[], avg: number) {
  for (const [k, c] of counts) {
    target.anzahl.set(k, (target.anzahl.get(k) ?? 0) + c)
    target.m2.set(k, (target.m2.get(k) ?? 0) + c * avg)
  }
}

function toGroup(c: CountMap, etappeId: string | null, etappeName: string, cat: ProjectUseType | null): MixGroup {
  const rows = MIX_ROW_KEYS
    .filter((k) => (c.anzahl.get(k) ?? 0) > 0)
    .map((k) => {
      const anzahl = c.anzahl.get(k) ?? 0
      const m2 = c.m2.get(k) ?? 0
      return { key: k, label: mixLabelTab(k), anzahl, avgM2: anzahl > 0 ? m2 / anzahl : 0 }
    })
  const totalAnzahl = rows.reduce((s, r) => s + r.anzahl, 0)
  const totalM2 = MIX_ROW_KEYS.reduce((s, k) => s + (c.m2.get(k) ?? 0), 0)
  return { etappeId, etappeName, cat, rows, totalAnzahl, totalM2 }
}

export function WohnungsmixSection({ variantId, defaultExpanded = false }: { variantId: string; defaultExpanded?: boolean }) {
  const mengen = useMengengeruestShared()
  const etappenGeteilt = useVariantEtappenGeteilt()
  const etappenEigen = useVariantEtappen(etappenGeteilt ? undefined : variantId)
  const { etappen } = etappenGeteilt ?? etappenEigen
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [view, setView] = useState<'konsolidiert' | 'etappen'>('konsolidiert')
  const [tab, setTab] = useState<'tabelle' | 'visualisierung'>('tabelle')

  const buildings = mengen.buildings

  const { etappenGroups, konsGroups, konsTotal, etappenTotals, nutzungKons, nutzungEtappen, eigKons, eigEtappen, colorFor } = useMemo(() => {
    // Pro (Etappe × Kategorie) und konsolidiert (nur Kategorie) aggregieren.
    const acc = new Map<string, CountMap>()           // key `${etId}::${cat}`
    const kons = new Map<ProjectUseType, CountMap>()  // key cat (über alle Etappen)
    const accAll = new Map<string, CountMap>()        // key etId|'none' → Total der Etappe
    const konsAll = emptyCount()                      // Total über alle Etappen & Kategorien
    const nut = new Map<string, number>()             // Nutzungsverteilung konsolidiert
    const nutByEt = new Map<string, Map<string, number>>() // key etId|'none' → Nutzung→m²
    const eig = new Map<string, number>()             // Eigentumsverteilung konsolidiert
    const eigByEt = new Map<string, Map<string, number>>() // key etId|'none' → Kategorie→m²

    for (const b of buildings) {
      const cat = b.use_type
      const catLabel = USE_TYPE_LABEL[cat]
      const etId = b.etappe_id ?? null
      const etKey = etId ?? 'none'
      for (const m of b.mietflaechen) {
        const vmf = m.flaeche_m2 || 0
        // Nutzungs-/Eigentumsverteilung (m² VMF) – konsolidiert und pro Etappe.
        // Nur Flächen > 0 m², ohne Parking/PP.
        if (vmf > 0 && !isParkNutzung(m.nutzung || '')) {
          const nKey = (m.nutzung || '').trim() || '(ohne Nutzung)'
          nut.set(nKey, (nut.get(nKey) ?? 0) + vmf)
          if (!nutByEt.has(etKey)) nutByEt.set(etKey, new Map())
          nutByEt.get(etKey)!.set(nKey, (nutByEt.get(etKey)!.get(nKey) ?? 0) + vmf)
          eig.set(catLabel, (eig.get(catLabel) ?? 0) + vmf)
          if (!eigByEt.has(etKey)) eigByEt.set(etKey, new Map())
          eigByEt.get(etKey)!.set(catLabel, (eigByEt.get(etKey)!.get(catLabel) ?? 0) + vmf)
        }
        // Wohnungen: Zimmer-Mix, sonst die erfasste Stückzahl als „Joker".
        const counts = effektiveWohnungCounts(m.nutzung, m.wohnungsmix, m.anzahl)
        const totalApts = counts.reduce((s, [, c]) => s + c, 0)
        if (totalApts === 0) continue
        const avg = vmf / totalApts // m² pro Wohnung in dieser Mietfläche
        const key = `${etKey}::${cat}`
        if (!acc.has(key)) acc.set(key, emptyCount())
        if (!kons.has(cat)) kons.set(cat, emptyCount())
        if (!accAll.has(etKey)) accAll.set(etKey, emptyCount())
        addCounts(acc.get(key)!, counts, avg)
        addCounts(kons.get(cat)!, counts, avg)
        addCounts(accAll.get(etKey)!, counts, avg)
        addCounts(konsAll, counts, avg)
      }
    }

    // Etappen-Ansicht: geordnet nach Etappen-Reihenfolge × Kategorie.
    const etOrder: { id: string | null; name: string }[] = [
      ...etappen.map((e) => ({ id: e.id as string | null, name: e.name })),
      { id: null, name: 'Ohne Etappe' },
    ]
    const etGroups: MixGroup[] = []
    for (const et of etOrder) {
      for (const cat of CAT_ORDER) {
        const c = acc.get(`${et.id ?? 'none'}::${cat}`)
        if (c) etGroups.push(toGroup(c, et.id, et.name, cat))
      }
    }

    // Konsolidierte Ansicht: nur Kategorie, über alle Etappen.
    const kGroups: MixGroup[] = []
    for (const cat of CAT_ORDER) {
      const c = kons.get(cat)
      if (c) kGroups.push(toGroup(c, null, 'Konsolidiert', cat))
    }
    // Total über alle Eigentumskategorien — nur sinnvoll bei mehreren Kategorien.
    const kTotal = kons.size > 1 ? toGroup(konsAll, null, 'Konsolidiert', null) : null

    // Total pro Etappe — nur wenn die Etappe mehrere Eigentumskategorien hat.
    const etTotals: MixGroup[] = []
    for (const et of etOrder) {
      const etKey = et.id ?? 'none'
      const catCount = CAT_ORDER.filter((c) => acc.has(`${etKey}::${c}`)).length
      const all = accAll.get(etKey)
      if (catCount > 1 && all) etTotals.push(toGroup(all, et.id, et.name, null))
    }

    // Nutzungsverteilung konsolidiert + pro Etappe.
    const konsNut = toNutzungItems(nut)
    const nutBlocks: NutzungBlock[] = []
    for (const et of etOrder) {
      const em = nutByEt.get(et.id ?? 'none')
      if (!em || em.size === 0) continue
      const { items, total } = toNutzungItems(em)
      nutBlocks.push({ etappeId: et.id, etappeName: et.name, items, total })
    }

    // Eigentumsverteilung konsolidiert + pro Etappe (analog zur Nutzung).
    const konsEig = toNutzungItems(eig)
    const eigBlocks: NutzungBlock[] = []
    for (const et of etOrder) {
      const em = eigByEt.get(et.id ?? 'none')
      if (!em || em.size === 0) continue
      const { items, total } = toNutzungItems(em)
      eigBlocks.push({ etappeId: et.id, etappeName: et.name, items, total })
    }

    // Stabile Farbzuordnung je Nutzung (gleiche Farbe in allen Charts),
    // Reihenfolge nach konsolidiertem m² (grösste zuerst).
    const cmap = new Map<string, string>()
    konsNut.items.forEach((it, i) => cmap.set(it.name, PALETTE[i % PALETTE.length]))
    let next = konsNut.items.length
    for (const blk of nutBlocks) {
      for (const it of blk.items) {
        if (!cmap.has(it.name)) cmap.set(it.name, PALETTE[next++ % PALETTE.length])
      }
    }
    const color = (name: string) => cmap.get(name) ?? '#cbd5e1'

    const totalW = kGroups.reduce((s, g) => s + g.totalAnzahl, 0)
    return {
      etappenGroups: etGroups,
      konsGroups: kGroups,
      konsTotal: kTotal,
      etappenTotals: etTotals,
      nutzungKons: { etappeId: null, etappeName: 'Konsolidiert', items: konsNut.items, total: konsNut.total } as NutzungBlock,
      nutzungEtappen: nutBlocks,
      eigKons: { etappeId: null, etappeName: 'Konsolidiert', items: konsEig.items, total: konsEig.total } as NutzungBlock,
      eigEtappen: eigBlocks,
      colorFor: color,
      totalWohnungen: totalW,
    }
  }, [buildings, etappen])

  // Virtuelles Gebäude: pro Geschoss Box (Breite ∝ Geschossfläche), darin die VNF
  // zentriert und proportional je Wohnung/Nutzung, farbcodiert nach Nutzung.
  const buildingViz = useMemo<VizBuilding[]>(() => {
    const PARK_COLOR = '#94a3b8'
    const NEBEN_COLOR = '#AFAFAF' // Nebenräume → neutrales Grau (CI Neutral 5)
    const FALLBACK = '#cbd5e1'
    // Fläche einer Zeile: VNF, sonst (z.B. Keller/Technik ohne VNF) Geschossfläche.
    const areaOf = (vmf: number, gf: number) => (vmf > 0 ? vmf : gf)

    // Vollständige Farbzuordnung über ALLE Nutzungen (auch ohne VNF). Farben der
    // Nutzungsverteilung beibehalten, übrige (z.B. Keller) aus der Palette ergänzen.
    const colorMap = new Map<string, string>()
    const used = new Set<string>()
    let pi = 0
    const nextColor = () => {
      while (used.has(PALETTE[pi % PALETTE.length])) pi++
      const c = PALETTE[pi % PALETTE.length]; pi++; used.add(c); return c
    }
    for (const b of buildings) {
      for (const m of b.mietflaechen) {
        if (isParkNutzung(m.nutzung || '')) continue
        if (areaOf(m.flaeche_m2 || 0, m.gf_m2 || 0) <= 0) continue
        const name = (m.nutzung || '').trim() || '(ohne Nutzung)'
        if (colorMap.has(name)) continue
        if (isNebenraum(name)) { colorMap.set(name, NEBEN_COLOR); continue }
        const known = colorFor(name)
        if (known !== FALLBACK) { used.add(known); colorMap.set(name, known) }
        else colorMap.set(name, nextColor())
      }
    }
    const vizColor = (name: string) => colorMap.get(name) ?? FALLBACK

    return buildings.map((b) => {
      const floorMap = new Map<string, VizFloor>()
      const getFloor = (name: string) => {
        const key = name || '(ohne Geschoss)'
        if (!floorMap.has(key)) floorMap.set(key, { name: key, rank: rankGeschoss(key), size: 0, vmf: 0, segs: [], isPark: false, pp: 0 })
        return floorMap.get(key)!
      }
      let pp = 0
      let apts = 0
      for (const m of b.mietflaechen) {
        const floorName = m.geschoss_bezeichnung?.trim() || '(ohne Geschoss)'
        const fl = getFloor(floorName)
        const vmf = m.flaeche_m2 || 0
        const gf = m.gf_m2 || 0
        const area = areaOf(vmf, gf)
        fl.size += gf > 0 ? gf : vmf

        if (isParkNutzung(m.nutzung || '')) {
          const anz = m.anzahl || 0
          fl.isPark = true; fl.pp += anz; pp += anz
          const label = m.unterirdisch ? 'Tiefgarage' : 'Parkplätze'
          if (area > 0) fl.segs.push({ label, sub: `${formatNumber(anz)} PP`, nutzung: label, m2: area, color: PARK_COLOR })
          continue
        }

        fl.vmf += vmf
        const name = (m.nutzung || '').trim() || '(ohne Nutzung)'
        // Wohnungen in der Eigentumsart-Farbe (zweitdunkelste Stufe 7); übrige nach Nutzung.
        const color = isNutzungWohnen(m.nutzung) ? USE_TYPE_COLOR_7[b.use_type] : vizColor(name)

        if (isNutzungWohnen(m.nutzung)) {
          const units = m.mieteinheiten ?? []
          // Mieteinheiten-Mix zusammenführen, sonst der Mix der Mietfläche.
          const mergedMix: Wohnungsmix | null = units.length
            ? (Object.fromEntries(WOHNUNGSMIX_KEYS.map((k) => [k, units.reduce((s, u) => s + (u.wohnungsmix?.[k] ?? 0), 0)])) as unknown as Wohnungsmix)
            : m.wohnungsmix
          // Zimmer-Mix, sonst die erfasste Stückzahl als „Joker".
          const counts = effektiveWohnungCounts(m.nutzung, mergedMix, m.anzahl)
          const totalApts = counts.reduce((s, [, c]) => s + c, 0)
          if (totalApts > 0) {
            const avg = vmf / totalApts
            apts += totalApts
            for (const [k, c] of counts) {
              const label = `${mixLabelViz(k)}${istZimmer(k) ? ' Zi' : ''}`
              for (let i = 0; i < c; i++) fl.segs.push({ label, sub: `${formatNumber(avg)} m²`, nutzung: name, m2: avg, color })
            }
          } else if (area > 0) {
            fl.segs.push({ label: name, sub: `${formatNumber(area)} m²`, nutzung: name, m2: area, color })
          }
        } else if (area > 0) {
          fl.segs.push({ label: name, sub: `${formatNumber(area)} m²`, nutzung: name, m2: area, color })
        }
      }

      const floors = [...floorMap.values()].filter((f) => f.segs.length > 0).sort((a, z) => z.rank - a.rank)
      let maxSize = floors.reduce((s, f) => Math.max(s, f.size), 0)
      if (maxSize <= 0) maxSize = 1
      // Geschosse ohne Flächenangabe → volle Breite.
      for (const f of floors) if (f.size <= 0) f.size = maxSize
      return { id: b.id, name: b.name, etappeId: b.etappe_id ?? null, useType: b.use_type, floors, maxSize, totalApts: apts, pp }
    }).filter((v) => v.floors.length > 0)
  }, [buildings, colorFor])

  // Häuser nach Etappe gruppiert (Etappen-Reihenfolge, „Ohne Etappe" am Ende).
  const vizByEtappe = useMemo(() => {
    const order: { id: string | null; name: string }[] = [
      ...etappen.map((e) => ({ id: e.id as string | null, name: e.name })),
      { id: null, name: 'Ohne Etappe' },
    ]
    // Häuser je Etappe nach Eigentumsart sortieren (nicht gemischt):
    // 1. Renditeobjekt, 2. Genossenschaft, 3. Verkaufsobjekt (STWEG), dann übrige.
    const catRank = (t: ProjectUseType) => {
      const i = CAT_ORDER.indexOf(t)
      return i === -1 ? CAT_ORDER.length : i
    }
    return order
      .map((et) => ({
        id: et.id,
        name: et.name,
        houses: buildingViz
          .filter((v) => v.etappeId === et.id)
          .sort((a, z) => catRank(a.useType) - catRank(z.useType)),
      }))
      .filter((g) => g.houses.length > 0)
  }, [etappen, buildingViz])

  const hasEtappen = etappen.length > 0 || etappenGroups.some((g) => g.etappeId === null)

  // Etappen-Ansicht: pro Etappe ein Bereich mit Wohnungsmix + Verteilungen.
  const etappeSections = useMemo(() => {
    const order: { id: string | null; name: string }[] = [
      ...etappen.map((e) => ({ id: e.id as string | null, name: e.name })),
      { id: null, name: 'Ohne Etappe' },
    ]
    return order
      .map((et) => {
        const total = etappenTotals.find((t) => t.etappeId === et.id)
        // (Falls vorhanden) Total-Karte zuoberst, dann die Kategorien-Karten.
        const groups = [
          ...(total ? [total] : []),
          ...etappenGroups.filter((g) => g.etappeId === et.id),
        ]
        return {
          key: et.id ?? 'none',
          name: et.name,
          groups,
          nutzung: nutzungEtappen.filter((b) => b.etappeId === et.id),
          eig: eigEtappen.filter((b) => b.etappeId === et.id),
        }
      })
      .filter((s) => s.groups.length > 0 || s.nutzung.length > 0 || s.eig.length > 0)
  }, [etappen, etappenGroups, etappenTotals, nutzungEtappen, eigEtappen])

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 bg-[#B98C74] px-5 py-3 text-sm font-semibold text-slate-900 transition hover:brightness-95"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-slate-700" /> : <ChevronRight className="h-4 w-4 text-slate-700" />}
        <Home className="h-4 w-4 text-slate-700" />
        <span>Wohnungs- und Nutzungsmix</span>
      </button>

      {expanded && (
        <div className="space-y-6 p-5">
          {mengen.loading ? (
            <p className="text-sm text-slate-500">Wird geladen…</p>
          ) : (
            <>
              {/* Tab: Tabelle ↔ Visualisierung */}
              <div className="flex gap-1 border-b border-slate-200">
                {(['tabelle', 'visualisierung'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={cn(
                      'rounded-t-lg border border-b-0 px-4 py-2 text-sm font-medium transition',
                      tab === t ? 'border-slate-200 bg-slate-200 text-slate-900' : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700',
                    )}
                  >
                    {t === 'tabelle' ? 'Tabelle' : 'Visualisierung'}
                  </button>
                ))}
              </div>

              {tab === 'tabelle' ? (
              <>
              {/* Ansicht: Konsolidiert (über alle Etappen) ↔ je Etappe */}
              {hasEtappen && (
                <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 text-xs font-medium w-fit">
                  {(['konsolidiert', 'etappen'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setView(v)}
                      className={cn(
                        'rounded-md px-3 py-1 transition',
                        view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                      )}
                    >
                      {v === 'konsolidiert' ? 'Konsolidiert' : 'Nach Etappe'}
                    </button>
                  ))}
                </div>
              )}

              {/* Konsolidiert: eine Zwei-Spalten-Ansicht.
                  Nach Etappe: pro Etappe ein eigener, klar abgegrenzter Bereich. */}
              {view === 'konsolidiert' ? (
                <MixTwoColumns
                  groups={konsTotal ? [konsTotal, ...konsGroups] : konsGroups}
                  nutzungBlocks={nutzungKons.items.length > 0 ? [nutzungKons] : []}
                  eigBlocks={eigKons.items.length > 0 ? [eigKons] : []}
                  colorFor={colorFor}
                />
              ) : (
                <div className="space-y-6">
                  {etappeSections.map((s) => (
                    <div key={s.key} className="overflow-hidden rounded-xl border border-slate-300">
                      <div className="flex items-center gap-2 border-b border-slate-300 px-4 py-2">
                        <Layers className="h-5 w-5 text-[#8B6956]" />
                        <h3 className="text-lg font-bold text-slate-900">{s.name}</h3>
                      </div>
                      <div className="p-4">
                        <MixTwoColumns
                          groups={s.groups}
                          nutzungBlocks={s.nutzung}
                          eigBlocks={s.eig}
                          colorFor={colorFor}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              </>
              ) : buildingViz.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Keine Wohnungen erfasst. In „Mengen und Erträge" bei Wohn-Mietflächen den
                  Wohnungsmix (Anzahl je Zimmergrösse) und das Geschoss erfassen.
                </p>
              ) : (
                <div className="space-y-6">
                  {vizByEtappe.map((g) => (
                    <div key={g.id ?? 'none'} className="space-y-3">
                      {(vizByEtappe.length > 1 || g.id !== null) && (
                        <div className="flex items-center gap-2 border-b border-slate-200 pb-1.5">
                          <Layers className="h-5 w-5 text-[#8B6956]" />
                          <h4 className="text-lg font-bold text-slate-900">{g.name}</h4>
                        </div>
                      )}
                      <div className="grid gap-4 lg:grid-cols-2">
                        {g.houses.map((v) => <HouseDiagram key={v.id} v={v} />)}
                      </div>
                    </div>
                  ))}
                  <p className="text-[10px] text-slate-400">
                    Geschossbreite ∝ Geschossfläche; Flächen zentriert und proportional zur VNF. Wohnungs-m² = Ø (VNF ÷ Anzahl).
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}

// Ein „Hausschnitt": gestapelte Geschosse, Breite ∝ Geschossfläche, Flächen
// zentriert und proportional zur VNF, farbcodiert nach Nutzung.
function HouseDiagram({ v }: { v: VizBuilding }) {
  const legend = [...new Map(v.floors.flatMap((f) => f.segs).map((s) => [s.nutzung, s.color])).entries()]
  return (
    <div className="overflow-hidden rounded-xl border border-slate-300">
      <div className="flex items-baseline justify-between px-3 py-2 text-slate-900" style={{ backgroundColor: cardColor(v.useType) }}>
        <h3 className="truncate text-sm font-semibold">{v.name}</h3>
        <span className="shrink-0 pl-2 text-xs font-semibold tabular-nums">
          {formatNumber(v.totalApts)} Whg{v.pp > 0 ? ` · ${formatNumber(v.pp)} PP` : ''}
        </span>
      </div>
      <div className="bg-slate-50 p-3">
        <div className="space-y-1">
          {v.floors.map((f) => (
            <div key={f.name} className="flex items-center gap-2">
              <div className="w-12 shrink-0 truncate text-right text-[11px] font-medium text-slate-500" title={`${f.name} · ${formatNumber(f.size)} m² GF`}>
                {f.name}
              </div>
              <div className="flex-1">
                <div
                  className="mx-auto flex h-16 items-stretch justify-center overflow-hidden rounded-sm border border-slate-300 bg-white"
                  style={{ width: `${Math.max(8, (f.size / v.maxSize) * 100)}%` }}
                  title={`${f.name}: ${formatNumber(f.size)} m² GF · ${formatNumber(f.vmf || f.segs.reduce((s, x) => s + x.m2, 0))} m² VNF`}
                >
                  {f.segs.map((s, i) => {
                    const tc = readableText(s.color)
                    return (
                      <div
                        key={i}
                        className="flex min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden border-r border-white/50 px-1 text-center leading-tight last:border-r-0"
                        style={{ width: `${(s.m2 / f.size) * 100}%`, backgroundColor: s.color, color: tc }}
                        title={`${s.label} · ${s.sub}`}
                      >
                        <span className="w-full truncate text-xs font-semibold">{s.label}</span>
                        <span className="w-full truncate text-[11px] opacity-85">{s.sub}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
          {legend.map(([name, color]) => (
            <span key={name} className="inline-flex items-center gap-1 text-[11px] text-slate-600">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
              {name}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// Zwei-Spalten-Block: links Wohnungsmix-Karten, rechts Nutzungs-/Eigentumsverteilung.
function MixTwoColumns({
  groups, nutzungBlocks, eigBlocks, colorFor,
}: {
  groups: MixGroup[]
  nutzungBlocks: NutzungBlock[]
  eigBlocks: NutzungBlock[]
  colorFor: (name: string) => string
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* Spalte 1 — Wohnungsmix nach Wohnungstyp */}
      <div className="space-y-4">
        {groups.length === 0 ? (
          <p className="text-sm text-slate-500">
            Keine Wohnungen mit Wohnungsmix erfasst (in Mengen und Erträge bei Wohn-Mietflächen den Mix eintragen).
          </p>
        ) : (
          groups.map((g) => <WohnungsmixCard key={`${g.etappeId ?? 'none'}::${g.cat ?? 'total'}`} g={g} />)
        )}
      </div>
      {/* Spalte 2 — Nutzungs- und Eigentumsverteilung */}
      <div className="space-y-4">
        {nutzungBlocks.map((blk) => (
          <NutzungVerteilung key={`n-${blk.etappeId ?? 'none'}`} title="Nutzungsverteilung (VMF)" block={blk} colorFor={colorFor} showEtappe={false} />
        ))}
        {eigBlocks.map((blk) => (
          <NutzungVerteilung key={`e-${blk.etappeId ?? 'none'}`} title="Eigentumsverteilung (VMF)" block={blk} colorFor={catColor} showEtappe={false} />
        ))}
      </div>
    </div>
  )
}

// Eine Wohnungsmix-Karte (Kategorie): Tabelle + Balkendiagramm nebeneinander.
function WohnungsmixCard({ g }: { g: MixGroup }) {
  const isTotal = g.cat === null
  const color = cardColor(g.cat)
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="flex items-baseline justify-between px-4 py-2 text-white" style={{ backgroundColor: color }}>
        <h3 className="text-base font-semibold">
          {isTotal ? 'Total · alle Eigentumsarten' : USE_TYPE_LABEL[g.cat!]}
        </h3>
        <span className="text-xs font-semibold tabular-nums">
          {formatNumber(g.totalAnzahl)} Whg · {formatNumber(g.totalM2)} m²
        </span>
      </div>
      <div className="grid items-start gap-4 p-4 sm:grid-cols-2">
        {/* Tabelle */}
        <table className="h-fit w-full text-sm">
          <thead className="text-[11px] font-medium tracking-wider text-slate-500">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Wohnungstyp</th>
              <th className="px-2 py-1.5 text-right font-medium">Anzahl</th>
              <th className="px-2 py-1.5 text-right font-medium">Ø m²/Whg</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {g.rows.map((r) => (
              <tr key={r.key}>
                <td className="px-2 py-1.5 text-slate-700">{r.label}{istZimmer(r.key) ? ' Zi' : ''}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-900">{formatNumber(r.anzahl)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{r.avgM2 > 0 ? formatNumber(r.avgM2) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-300 text-sm font-semibold text-slate-900">
            <tr>
              <td className="px-2 py-1.5">Total</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{formatNumber(g.totalAnzahl)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{g.totalAnzahl > 0 ? formatNumber(g.totalM2 / g.totalAnzahl) : '—'}</td>
            </tr>
          </tfoot>
        </table>
        {/* Grafik: Anzahl je Wohnungstyp */}
        <div className="h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={g.rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v) => [formatNumber(Number(v)), 'Anzahl']} labelFormatter={(l) => `${l} Zimmer`} />
              <Bar dataKey="anzahl" fill={color} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

function NutzungVerteilung({
  title, block, colorFor, showEtappe,
}: {
  title: string
  block: NutzungBlock
  colorFor: (name: string) => string
  showEtappe: boolean
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="flex items-baseline justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
        <h3 className="text-sm font-semibold text-slate-700">
          {title}
          {showEtappe && <span className="ml-2 font-normal text-slate-400">{block.etappeName}</span>}
        </h3>
        <span className="text-xs font-semibold tabular-nums text-slate-700">{formatNumber(block.total)} m²</span>
      </div>
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={block.items}
                dataKey="m2"
                nameKey="name"
                innerRadius={45}
                outerRadius={80}
                paddingAngle={1}
                label={(e) => `${Math.round((e.percent ?? 0) * 100)}%`}
                labelLine={false}
              >
                {block.items.map((it) => <Cell key={it.name} fill={colorFor(it.name)} />)}
              </Pie>
              <Tooltip formatter={(v) => [`${formatNumber(Number(v))} m²`, 'VMF']} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <table className="h-fit w-full text-sm">
          <thead className="text-[11px] font-medium tracking-wider text-slate-500">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Nutzung</th>
              <th className="px-2 py-1.5 text-right font-medium">m²</th>
              <th className="px-2 py-1.5 text-right font-medium">Anteil</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {block.items.map((n) => (
              <tr key={n.name}>
                <td className="px-2 py-1.5 text-slate-700">
                  <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: colorFor(n.name) }} />
                  {n.name}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-900">{formatNumber(n.m2)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{(n.pct * 100).toFixed(1)} %</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-300 text-sm font-semibold text-slate-900">
            <tr>
              <td className="px-2 py-1.5">Total</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{formatNumber(block.total)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">100,0 %</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
