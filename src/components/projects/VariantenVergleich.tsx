import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAnlagekosten } from '@/hooks/useAnlagekosten'
import { useKostenmiete } from '@/hooks/useKostenmiete'
import { useRendite } from '@/hooks/useRendite'
import { berechneKostenmiete, basisFromErgebnis, type ErtragNutzung, type KostenmieteParams } from '@/lib/kostenmiete'
import { type RenditeParams } from '@/lib/rendite'
import { type BkpErgebnis } from '@/lib/bkpBerechnung'
import {
  type ProjectVariant, type Eigentumsart,
  EIGENTUMSART_LABEL, eigentumsartForBuilding, isNutzungWohnen, effektiveWohnungCounts,
} from '@/types'
import { EIGENTUMSART_COLOR } from '@/lib/kategorieFarben'
import { CHART_PALETTE } from '@/lib/ci'
import { isGarageNutzung } from '@/lib/bkp2'
import { formatNumber, cn } from '@/lib/utils'

const EIG_ORDER: Eigentumsart[] = ['renditeobjekt', 'genossenschaft', 'verkaufsobjekt']
type Kind = Eigentumsart | 'total'

// Summiert mehrere Block-Ergebnisse (Etappen) je Eigentumsart zu einem Ergebnis
// (nur die für den Vergleich benötigten Felder: Hauptgruppen, Totale, Pos.-Beträge).
function sumErgebnisse(ergs: BkpErgebnis[]): BkpErgebnis {
  const zero = () => ({ 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 } as Record<number, number>)
  const hgNetto = zero(), hgMwst = zero()
  const positionen: Record<string, { betragNetto: number; mwstBetrag: number }> = {}
  let totalNetto = 0, totalMwst = 0
  for (const e of ergs) {
    for (let c = 0; c < 10; c++) {
      hgNetto[c] += (e.hauptgruppenSummenNetto as Record<number, number>)[c] ?? 0
      hgMwst[c] += (e.hauptgruppenSummenMwst as Record<number, number>)[c] ?? 0
    }
    totalNetto += e.totalNetto; totalMwst += e.totalMwst
    for (const [code, p] of Object.entries(e.positionen)) {
      const cur = positionen[code] ?? { betragNetto: 0, mwstBetrag: 0 }
      cur.betragNetto += p.betragNetto ?? 0; cur.mwstBetrag += p.mwstBetrag ?? 0
      positionen[code] = cur
    }
  }
  return {
    positionen: positionen as unknown as BkpErgebnis['positionen'],
    hauptgruppenSummenNetto: hgNetto as unknown as BkpErgebnis['hauptgruppenSummenNetto'],
    hauptgruppenSummenMwst: hgMwst as unknown as BkpErgebnis['hauptgruppenSummenMwst'],
    totalNetto, totalMwst, totalBrutto: totalNetto + totalMwst,
  }
}
const ALL_KINDS: Kind[] = ['renditeobjekt', 'genossenschaft', 'verkaufsobjekt', 'total']
const kindLabel = (k: Kind) => k === 'total' ? 'Total' : EIGENTUMSART_LABEL[k]

// Kennzahlen je Eigentumsart innerhalb einer Variante.
interface EigMetrics {
  gf: number; gvOi: number; gvUi: number; gvTotal: number; gh: number
  vmf: number; vkf: number; gsf: number
  nutz: Record<string, { flaeche: number; ertragA: number }>
  nutzBar: [string, number][]; nutzBarTotal: number
  bkp: number[]; kostenTotal: number; ertragTotal: number
  maxMietWohnen: number; maxMietWohnenProM2: number
  liegenschaftserfolg: number; bruttorendite: number; nettorendite: number; landwert: number; landwertProM2: number
  chfM2GF: number; chfM3GV: number; chfM2VMF: number; flProGf: number
}

interface VMetrics {
  loading: boolean
  eigs: Eigentumsart[]
  etappen: string[]
  perEig: Record<string, EigMetrics>
  total: EigMetrics
  sig: string
}

function VariantMetricsLoader({ projectId, variantId, etappeNames, etappeKey, onData }: {
  projectId: string; variantId: string; etappeNames: string[] | null; etappeKey: string; onData: (id: string, m: VMetrics) => void
}) {
  const ak = useAnlagekosten(projectId, variantId)
  const { params: kostenParams } = useKostenmiete(variantId)
  const { params: renditeParams } = useRendite(variantId)
  const metrics = useMemo<VMetrics>(
    () => computeMetrics(ak, kostenParams, renditeParams, etappeNames),
    [ak.buildings, ak.konsolidiert, ak.blockErgebnisse, ak.etappen, ak.presentEig, ak.gsfTotal, ak.loading, kostenParams, renditeParams, etappeKey],
  )
  useEffect(() => { onData(variantId, metrics) }, [variantId, metrics, onData])
  return null
}

function computeMetrics(
  ak: ReturnType<typeof useAnlagekosten>, kostenParams: KostenmieteParams, renditeParams: RenditeParams,
  etappeNames: string[] | null,
): VMetrics {
  // Etappen-Filter: alle → konsolidiert; Teilmenge → Summe der Block-Ergebnisse.
  const etSet = etappeNames ? new Set(etappeNames) : null
  const allEtappen = !etSet || ak.etappen.every((e) => etSet.has(e.name))
  const matchingIds = new Set(ak.etappen.filter((e) => !etSet || etSet.has(e.name)).map((e) => e.id))
  const buildings = allEtappen ? ak.buildings : ak.buildings.filter((b) => b.etappe_id != null && matchingIds.has(b.etappe_id))
  const ergOf = (eig: Eigentumsart): BkpErgebnis | undefined => {
    if (allEtappen) return ak.konsolidiertEffektiv.get(eig)
    const ergs = [...matchingIds]
      .map((id) => ak.blockErgebnisseEffektiv.get(`${id}::${eig}`))
      .filter((x): x is BkpErgebnis => !!x)
    return ergs.length ? sumErgebnisse(ergs) : undefined
  }

  interface Acc {
    gf: number; gvOi: number; gvUi: number; flaeche: number; wohnFl: number; wohnungen: number
    nutz: Map<string, { flaeche: number; anzahl: number; ertragA: number; istWohnen: boolean }>
  }
  const accs = new Map<Eigentumsart, Acc>()
  const getAcc = (e: Eigentumsart) => {
    let a = accs.get(e)
    if (!a) { a = { gf: 0, gvOi: 0, gvUi: 0, flaeche: 0, wohnFl: 0, wohnungen: 0, nutz: new Map() }; accs.set(e, a) }
    return a
  }
  for (const b of buildings) {
    const a = getAcc(eigentumsartForBuilding(b.use_type))
    for (const m of b.mietflaechen) {
      const fl = m.flaeche_m2 || 0
      a.gf += m.gf_m2 || 0
      const vol = m.volumen_m3 || 0
      if (m.unterirdisch) a.gvUi += vol; else a.gvOi += vol
      a.flaeche += fl
      const ertrag = (m.miete_chf_pa || 0)
        || (m.miete_chf_m2_pa ? m.miete_chf_m2_pa * fl : 0)
        || (m.miete_chf_stk_mt ? m.miete_chf_stk_mt * (m.anzahl || 0) * 12 : 0)
      const name = (m.nutzung || '').trim() || '(ohne Nutzung)'
      const wohn = isNutzungWohnen(m.nutzung)
      const na = a.nutz.get(name) ?? { flaeche: 0, anzahl: 0, ertragA: 0, istWohnen: wohn }
      na.flaeche += fl; na.anzahl += m.anzahl || 0; na.ertragA += ertrag
      a.nutz.set(name, na)
      if (wohn) { a.wohnFl += fl; a.wohnungen += effektiveWohnungCounts(m.nutzung, m.wohnungsmix, m.anzahl).reduce((s, [, c]) => s + c, 0) }
    }
  }

  const eigs = EIG_ORDER.filter((e) => accs.has(e))
  const perEig: Record<string, EigMetrics> = {}
  for (const eig of eigs) {
    const a = accs.get(eig)!
    const erg = ergOf(eig)
    const bkp = Array.from({ length: 10 }, (_, c) => erg
      ? ((erg.hauptgruppenSummenNetto as Record<number, number>)[c] ?? 0) + ((erg.hauptgruppenSummenMwst as Record<number, number>)[c] ?? 0)
      : 0)
    const kostenTotal = erg?.totalBrutto ?? 0
    const gvTotal = a.gvOi + a.gvUi
    const vmf = eig !== 'verkaufsobjekt' ? a.flaeche : 0
    const vkf = eig === 'verkaufsobjekt' ? a.flaeche : 0

    // Kostenmiete (Genossenschaft): der Wohn-Ertrag = max. Mietertrag Wohnen.
    let maxMietWohnen = 0, maxMietWohnenProM2 = 0
    if (eig === 'genossenschaft' && erg) {
      const ertragsNutzungen: ErtragNutzung[] = [...a.nutz.entries()]
        .filter(([, e]) => e.ertragA > 0)
        .map(([nutzung, e]) => ({ nutzung, istWohnen: e.istWohnen, basis: e.flaeche > 0 ? 'flaeche' : 'anzahl', flaeche: e.flaeche, anzahl: e.anzahl, ertragJahr: e.ertragA }))
      const r = berechneKostenmiete(basisFromErgebnis(erg, a.flaeche, a.wohnFl, a.wohnungen), kostenParams, ertragsNutzungen)
      maxMietWohnen = r.maxMietertragWohnen; maxMietWohnenProM2 = r.proM2Jahr
    }

    const wohnFlTotal = [...a.nutz.values()].filter((x) => x.istWohnen).reduce((s, x) => s + x.flaeche, 0)
    const nutzObj: Record<string, { flaeche: number; ertragA: number }> = {}
    const barItems: [string, number][] = []
    let ertragTotal = 0
    for (const [k, val] of a.nutz) {
      // Genossenschaft Wohnen: Ertrag aus der Kostenmiete (nach Fläche verteilt).
      const ertragA = (eig === 'genossenschaft' && val.istWohnen)
        ? (wohnFlTotal > 0 ? maxMietWohnen * (val.flaeche / wohnFlTotal) : maxMietWohnen)
        : val.ertragA
      nutzObj[k] = { flaeche: val.flaeche, ertragA }
      ertragTotal += ertragA
      if (val.flaeche > 0 && !isGarageNutzung(k)) barItems.push([k, val.flaeche])
    }
    barItems.sort((x, y) => y[1] - x[1])
    const barTotal = barItems.reduce((s, [, x]) => s + x, 0)

    let liegenschaftserfolg = 0, bruttorendite = 0, nettorendite = 0, landwert = 0, landwertProM2 = 0
    if (eig === 'renditeobjekt' && erg) {
      let investition = 0, erstellung = 0
      for (let c = 0; c <= 9; c++) { investition += bkp[c]; if (c >= 1) erstellung += bkp[c] }
      const p = renditeParams
      const mietSoll = ertragTotal
      const mietNetto = (mietSoll - mietSoll * p.leerstand) - mietSoll * p.betriebskosten - p.instandhaltungProM2 * a.flaeche - p.baurechtszins
      liegenschaftserfolg = mietNetto - p.instandsetzungProM2 * a.flaeche
      bruttorendite = investition > 0 ? mietSoll / investition : 0
      nettorendite = investition > 0 ? liegenschaftserfolg / investition : 0
      const ertragswert = p.nettoKapSatz > 0 ? liegenschaftserfolg / p.nettoKapSatz : 0
      landwert = ertragswert - erstellung
      landwertProM2 = ak.gsfTotal > 0 ? landwert / ak.gsfTotal : 0
    }

    perEig[eig] = {
      gf: a.gf, gvOi: a.gvOi, gvUi: a.gvUi, gvTotal, gh: a.gf > 0 ? gvTotal / a.gf : 0, vmf, vkf, gsf: ak.gsfTotal,
      nutz: nutzObj, nutzBar: barItems, nutzBarTotal: barTotal,
      bkp, kostenTotal, ertragTotal,
      maxMietWohnen, maxMietWohnenProM2,
      liegenschaftserfolg, bruttorendite, nettorendite, landwert, landwertProM2,
      chfM2GF: a.gf > 0 ? kostenTotal / a.gf : 0,
      chfM3GV: gvTotal > 0 ? kostenTotal / gvTotal : 0,
      chfM2VMF: a.flaeche > 0 ? kostenTotal / a.flaeche : 0,
      flProGf: a.gf > 0 ? a.flaeche / a.gf : 0,
    }
  }

  // Total (Variante gesamt) = Aggregat über alle Eigentumsarten.
  let tGf = 0, tGvOi = 0, tGvUi = 0, tVmf = 0, tVkf = 0, tKosten = 0, tErtrag = 0
  const tBkp = new Array(10).fill(0)
  const tNutz = new Map<string, { flaeche: number; ertragA: number }>()
  for (const eig of eigs) {
    const m = perEig[eig]
    tGf += m.gf; tGvOi += m.gvOi; tGvUi += m.gvUi; tVmf += m.vmf; tVkf += m.vkf; tKosten += m.kostenTotal; tErtrag += m.ertragTotal
    for (let c = 0; c < 10; c++) tBkp[c] += m.bkp[c]
    for (const [k, v] of Object.entries(m.nutz)) { const e = tNutz.get(k) ?? { flaeche: 0, ertragA: 0 }; e.flaeche += v.flaeche; e.ertragA += v.ertragA; tNutz.set(k, e) }
  }
  const tGvTotal = tGvOi + tGvUi
  const tFl = tVmf + tVkf
  const tNutzObj: Record<string, { flaeche: number; ertragA: number }> = {}
  const tBar: [string, number][] = []
  for (const [k, v] of tNutz) { tNutzObj[k] = v; if (v.flaeche > 0 && !isGarageNutzung(k)) tBar.push([k, v.flaeche]) }
  tBar.sort((x, y) => y[1] - x[1])
  const total: EigMetrics = {
    gf: tGf, gvOi: tGvOi, gvUi: tGvUi, gvTotal: tGvTotal, gh: tGf > 0 ? tGvTotal / tGf : 0, vmf: tVmf, vkf: tVkf, gsf: ak.gsfTotal,
    nutz: tNutzObj, nutzBar: tBar, nutzBarTotal: tBar.reduce((s, [, x]) => s + x, 0),
    bkp: tBkp, kostenTotal: tKosten, ertragTotal: tErtrag,
    maxMietWohnen: 0, maxMietWohnenProM2: 0,
    liegenschaftserfolg: 0, bruttorendite: 0, nettorendite: 0, landwert: 0, landwertProM2: 0,
    chfM2GF: tGf > 0 ? tKosten / tGf : 0, chfM3GV: tGvTotal > 0 ? tKosten / tGvTotal : 0, chfM2VMF: tFl > 0 ? tKosten / tFl : 0, flProGf: tGf > 0 ? tFl / tGf : 0,
  }

  const sig = JSON.stringify({
    loading: ak.loading, eigs, gsf: ak.gsfTotal,
    perEig: eigs.map((e) => {
      const m = perEig[e]
      return [e, m.gf, m.gvTotal, m.vmf, m.vkf, m.kostenTotal, m.ertragTotal, m.maxMietWohnen, m.liegenschaftserfolg, m.landwert, m.bkp, Object.entries(m.nutz).map(([k, v]) => [k, v.flaeche, v.ertragA])]
    }),
  })
  return { loading: ak.loading, eigs, etappen: ak.etappen.map((e) => e.name), perEig, total, sig }
}

// Balken der Nutzungsverteilung nach VMF/VKF, mit %-Beschriftung.
function NutzBar({ items, total, colorFor }: { items: [string, number][]; total: number; colorFor: (n: string) => string }) {
  if (total <= 0) return <span className="text-slate-300">—</span>
  return (
    <div className="min-w-[10rem]">
      <div className="flex h-7 w-full overflow-hidden rounded-md bg-slate-100">
        {items.map(([n, a]) => {
          const share = (a / total) * 100
          return (
            <div key={n} title={`${n} · ${formatNumber(a)} m² (${Math.round(share)}%)`}
              className="flex items-center justify-center overflow-hidden text-xs font-medium leading-none text-white"
              style={{ width: `${share}%`, backgroundColor: colorFor(n) }}>
              {share >= 8 ? `${Math.round(share)}%` : ''}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Eine beschriftete Zeile in der Filterkarte (Label links, Chips rechts).
function FilterRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-2.5 first:border-t-0 sm:flex-row sm:items-start">
      <div className="w-24 shrink-0 sm:pt-1">
        <div className="text-xs font-semibold text-slate-700">{label}</div>
        {hint && <div className="text-[10px] leading-tight text-slate-400">{hint}</div>}
      </div>
      <div className="flex flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  )
}

export function VariantenVergleich({ projectId, variants }: { projectId: string; variants: ProjectVariant[] }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(variants.slice(0, 4).map((v) => v.id)))
  const [dataMap, setDataMap] = useState<Map<string, VMetrics>>(new Map())
  const [baseId, setBaseId] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<Set<Kind>>(() => new Set(ALL_KINDS))
  const toggleKind = (k: Kind) => setKindFilter((prev) => {
    const n = new Set(prev)
    if (n.has(k)) { if (n.size > 1) n.delete(k) } else n.add(k)
    return n
  })
  const [etappeSel, setEtappeSel] = useState<Set<string> | null>(null) // null = alle Etappen

  const onData = useCallback((id: string, m: VMetrics) => {
    setDataMap((prev) => {
      const o = prev.get(id)
      if (o && o.sig === m.sig) return prev
      const next = new Map(prev); next.set(id, m); return next
    })
  }, [])

  const toggle = (id: string) => setSelected((prev) => {
    const n = new Set(prev)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  const chosen = variants.filter((v) => selected.has(v.id))
  const data = (v: ProjectVariant) => dataMap.get(v.id)

  // Etappen-Filter (nach Etappennamen über die Varianten).
  const availableEtappeNames = useMemo(() => {
    const s = new Set<string>()
    for (const v of chosen) { const d = dataMap.get(v.id); if (d && !d.loading) for (const n of d.etappen) s.add(n) }
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [dataMap, chosen.map((v) => v.id).join()])
  const isEtOn = (name: string) => etappeSel === null || etappeSel.has(name)
  const toggleEt = (name: string) => setEtappeSel((prev) => {
    const base = new Set(prev ?? availableEtappeNames)
    if (base.has(name)) { if (base.size > 1) base.delete(name) } else base.add(name)
    return availableEtappeNames.length > 0 && availableEtappeNames.every((n) => base.has(n)) ? null : base
  })
  const etappeNames = etappeSel ? [...etappeSel] : null
  const etappeKey = etappeSel ? [...etappeSel].sort().join('|') : 'all'

  // Spalten je Variante = [Eigentumsarten …] + Total. Übertitel = Variante.
  type Column = { key: string; variant: ProjectVariant; kind: Kind; first: boolean }
  const allColumns: Column[] = chosen.flatMap((v): Column[] => {
    const d = data(v)
    const eigs = d && !d.loading ? d.eigs : []
    const kinds: Kind[] = [...eigs, 'total']
    return kinds.map((k) => ({ key: `${v.id}::${k}`, variant: v, kind: k, first: false }))
  })
  const availableKinds = ALL_KINDS.filter((k) => allColumns.some((c) => c.kind === k))
  const columns = allColumns.filter((c) => kindFilter.has(c.kind))
  { // erste sichtbare Spalte je Variante markieren (für Trennlinie/Gruppierung)
    const seen = new Set<string>()
    for (const c of columns) { if (!seen.has(c.variant.id)) { c.first = true; seen.add(c.variant.id) } }
  }
  const visibleVariants = chosen.filter((v) => columns.some((c) => c.variant.id === v.id))
  const emOf = (col: Column): EigMetrics | undefined => {
    const d = data(col.variant)
    return d ? (col.kind === 'total' ? d.total : d.perEig[col.kind]) : undefined
  }
  const colLoading = (col: Column): boolean => { const d = data(col.variant); return !d || d.loading }

  // Vergleichsbasis = eine Variante; verglichen wird je Spalten-Art (gleiche Eigentumsart bzw. Total).
  const effBaseId = baseId && selected.has(baseId) ? baseId : (chosen[0]?.id ?? null)
  const baseData = effBaseId ? dataMap.get(effBaseId) : undefined
  const baseEmOf = (kind: Kind): EigMetrics | undefined =>
    !baseData || baseData.loading ? undefined : (kind === 'total' ? baseData.total : baseData.perEig[kind])

  type Row =
    | { kind: 'group'; label: string }
    | { kind: 'custom'; label: string; render: (col: Column) => ReactNode; indent?: boolean; dot?: string; eigOnly?: Eigentumsart }
    | { kind: 'num'; label: string; value: (e: EigMetrics) => number; unit: string; fmtNum?: (n: number) => string; applicable?: (e: EigMetrics) => boolean; indent?: boolean; dot?: string; eigOnly?: Eigentumsart }
  type NumRow = Extract<Row, { kind: 'num' }>

  const fmtN = (n: number) => formatNumber(n)

  const customCell = (col: Column, fn: (e: EigMetrics) => ReactNode, eigOnly?: Eigentumsart): ReactNode => {
    if (colLoading(col)) return <span className="text-slate-300">…</span>
    const e = emOf(col)
    if (!e || (eigOnly && col.kind !== eigOnly)) return <span className="text-slate-300">—</span>
    return fn(e)
  }

  const valueCell = (col: Column, row: NumRow): { num: ReactNode; unit: string; delta: ReactNode } => {
    if (colLoading(col)) return { num: <span className="text-slate-300">…</span>, unit: '', delta: null }
    const e = emOf(col)
    if (!e || (row.eigOnly && col.kind !== row.eigOnly) || (row.applicable && !row.applicable(e))) {
      return { num: <span className="text-slate-300">—</span>, unit: '', delta: null }
    }
    const n = row.value(e)
    let delta: ReactNode = null
    const be = baseEmOf(col.kind)
    if (col.variant.id !== effBaseId && be && (!row.applicable || row.applicable(be))) {
      const bn = row.value(be)
      if (bn !== 0) { const dv = ((n - bn) / Math.abs(bn)) * 100; delta = `${dv >= 0 ? '+' : ''}${dv.toFixed(1)}%` }
    }
    return { num: (row.fmtNum ?? fmtN)(n), unit: row.unit, delta }
  }

  // Union aller Nutzungen (mit Fläche) über die sichtbaren Spalten + stabile Farbe.
  const nutzUnion = useMemo(() => {
    const t = new Map<string, number>()
    for (const c of columns) { const e = emOf(c); if (!e) continue; for (const [k, v] of Object.entries(e.nutz)) if (v.flaeche > 0) t.set(k, Math.max(t.get(k) ?? 0, v.flaeche)) }
    return [...t.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  }, [dataMap, columns.map((c) => c.key).join()])
  const nutzColor: Record<string, string> = {}
  nutzUnion.forEach((n, i) => { nutzColor[n] = CHART_PALETTE[i % CHART_PALETTE.length] })

  const anyRendite = columns.some((c) => c.kind === 'renditeobjekt')
  const anyVerkauf = columns.some((c) => c.kind === 'verkaufsobjekt')

  const rows: Row[] = []
  rows.push({ kind: 'group', label: 'Mengen' })
  rows.push({ kind: 'num', label: 'GF (Geschossfläche)', value: (e) => e.gf, unit: 'm²' })
  rows.push({ kind: 'num', label: 'GV oberirdisch', value: (e) => e.gvOi, unit: 'm³' })
  rows.push({ kind: 'num', label: 'GV unterirdisch', value: (e) => e.gvUi, unit: 'm³' })
  rows.push({ kind: 'num', label: 'GV Total', value: (e) => e.gvTotal, unit: 'm³' })
  rows.push({ kind: 'num', label: 'GH (Ø Geschosshöhe)', value: (e) => e.gh, unit: 'm', fmtNum: (n) => formatNumber(n, 2) })
  rows.push({ kind: 'num', label: 'VMF', value: (e) => e.vmf, unit: 'm²', applicable: (e) => e.vmf > 0 })
  rows.push({ kind: 'num', label: 'VKF', value: (e) => e.vkf, unit: 'm²', applicable: (e) => e.vkf > 0 })
  rows.push({ kind: 'num', label: 'GSF (Grundstück)', value: (e) => e.gsf, unit: 'm²' })

  rows.push({ kind: 'group', label: 'Nutzungen' })
  rows.push({ kind: 'custom', label: 'Nutzungsmix (VMF/VKF)', render: (col) => customCell(col, (e) => <NutzBar items={e.nutzBar} total={e.nutzBarTotal} colorFor={(name) => nutzColor[name] ?? '#cbd5e1'} />) })
  for (const n of nutzUnion) rows.push({ kind: 'num', label: n, indent: true, dot: nutzColor[n], value: (e) => e.nutz[n]?.flaeche ?? 0, unit: 'm²', applicable: (e) => (e.nutz[n]?.flaeche ?? 0) > 0 })

  rows.push({ kind: 'group', label: 'Kosten (BKP 0–9, inkl. MwSt)' })
  for (let c = 0; c <= 9; c++) rows.push({ kind: 'num', label: `BKP ${c}`, indent: true, value: (e) => e.bkp[c], unit: 'CHF' })
  rows.push({ kind: 'num', label: 'Total Anlagekosten', value: (e) => e.kostenTotal, unit: 'CHF' })

  rows.push({ kind: 'group', label: 'Erträge (CHF/a)' })
  rows.push({ kind: 'num', label: 'Total Erträge', value: (e) => e.ertragTotal, unit: 'CHF/a' })
  for (const n of nutzUnion) rows.push({ kind: 'num', label: n, indent: true, dot: nutzColor[n], value: (e) => e.nutz[n]?.ertragA ?? 0, unit: 'CHF/a', applicable: (e) => (e.nutz[n]?.ertragA ?? 0) > 0 })

  rows.push({ kind: 'group', label: 'Erträge – Benchmark (CHF/m²·a)' })
  for (const n of nutzUnion) rows.push({ kind: 'num', label: n, indent: true, dot: nutzColor[n], value: (e) => { const a = e.nutz[n]; return a && a.flaeche > 0 ? a.ertragA / a.flaeche : 0 }, unit: 'CHF/m²·a', applicable: (e) => (e.nutz[n]?.flaeche ?? 0) > 0 && (e.nutz[n]?.ertragA ?? 0) > 0 })

  if (anyRendite) {
    rows.push({ kind: 'group', label: 'Rendite (Renditeobjekt)' })
    rows.push({ kind: 'num', label: 'Liegenschaftserfolg', eigOnly: 'renditeobjekt', value: (e) => e.liegenschaftserfolg, unit: 'CHF/a' })
    rows.push({ kind: 'num', label: 'Bruttorendite', eigOnly: 'renditeobjekt', value: (e) => e.bruttorendite, unit: '%', fmtNum: (n) => (n * 100).toFixed(2) })
    rows.push({ kind: 'num', label: 'Nettorendite', eigOnly: 'renditeobjekt', value: (e) => e.nettorendite, unit: '%', fmtNum: (n) => (n * 100).toFixed(2) })
    rows.push({ kind: 'num', label: 'Residualer Landwert', eigOnly: 'renditeobjekt', value: (e) => e.landwert, unit: 'CHF' })
    rows.push({ kind: 'num', label: 'Residualer Landwert je m²', eigOnly: 'renditeobjekt', value: (e) => e.landwertProM2, unit: 'CHF/m²' })
  }
  if (anyVerkauf) {
    rows.push({ kind: 'group', label: 'IRR (Stockwerkeigentum)' })
    rows.push({ kind: 'custom', label: 'IRR', eigOnly: 'verkaufsobjekt', render: (col) => customCell(col, () => <span className="text-slate-400">in Vorbereitung</span>, 'verkaufsobjekt') })
  }

  rows.push({ kind: 'group', label: 'Benchmarks' })
  rows.push({ kind: 'num', label: 'Kosten / m² GF', value: (e) => e.chfM2GF, unit: 'CHF/m²' })
  rows.push({ kind: 'num', label: 'Kosten / m³ GV', value: (e) => e.chfM3GV, unit: 'CHF/m³' })
  rows.push({ kind: 'num', label: 'Kosten / m² VMF (VKF)', value: (e) => e.chfM2VMF, unit: 'CHF/m²' })
  rows.push({ kind: 'num', label: 'VMF (VKF) / GF', value: (e) => e.flProGf, unit: '%', fmtNum: (n) => (n * 100).toFixed(0), applicable: (e) => e.flProGf > 0 })

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white">
        <FilterRow label="Varianten">
          {variants.map((v) => {
            const on = selected.has(v.id)
            return (
              <button key={v.id} type="button" onClick={() => toggle(v.id)}
                className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition',
                  on ? 'border-[#8B6956] bg-[#F2D3C2]/50 text-slate-900' : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-50')}>
                <span className={cn('rounded px-1 text-[10px] font-semibold', on ? 'bg-[#8B6956] text-white' : 'bg-slate-200 text-slate-500')}>V{v.variant_number}</span>
                <span className="max-w-[10rem] truncate">{v.name}</span>
              </button>
            )
          })}
        </FilterRow>

        {chosen.length >= 2 && (
          <FilterRow label="Basis" hint="± % Referenz">
            {chosen.map((v) => (
              <button key={v.id} type="button" onClick={() => setBaseId(v.id)}
                className={cn('rounded-full border px-3 py-1 text-sm font-medium transition',
                  effBaseId === v.id ? 'border-[#8B6956] bg-[#8B6956] text-white' : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-50')}>
                V{v.variant_number}
              </button>
            ))}
          </FilterRow>
        )}

        {availableKinds.length > 1 && (
          <FilterRow label="Spalten">
            {availableKinds.map((k) => {
              const on = kindFilter.has(k)
              return (
                <button key={k} type="button" onClick={() => toggleKind(k)}
                  className={cn('rounded-full border px-3 py-1 text-xs font-medium transition',
                    on ? 'border-transparent text-slate-900 shadow-sm' : 'border-slate-300 bg-white text-slate-400 hover:bg-slate-50')}
                  style={on ? { backgroundColor: k === 'total' ? '#e2e8f0' : EIGENTUMSART_COLOR[k] } : undefined}>
                  {kindLabel(k)}
                </button>
              )
            })}
          </FilterRow>
        )}

        {availableEtappeNames.length > 1 && (
          <FilterRow label="Etappen">
            {availableEtappeNames.map((name) => {
              const on = isEtOn(name)
              return (
                <button key={name} type="button" onClick={() => toggleEt(name)}
                  className={cn('rounded-full border px-3 py-1 text-xs font-medium transition',
                    on ? 'border-[#8B6956] bg-[#F2D3C2]/50 text-slate-900' : 'border-slate-300 bg-white text-slate-400 hover:bg-slate-50')}>
                  {name}
                </button>
              )
            })}
            {etappeSel !== null && (
              <button type="button" onClick={() => setEtappeSel(null)} className="ml-1 text-xs font-medium text-[#8B6956] hover:underline">alle anzeigen</button>
            )}
          </FilterRow>
        )}
      </div>

      {chosen.map((v) => <VariantMetricsLoader key={v.id} projectId={projectId} variantId={v.id} etappeNames={etappeNames} etappeKey={etappeKey} onData={onData} />)}

      {chosen.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">Keine Variante ausgewählt.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              {/* Übertitel: Variante */}
              <tr className="border-b border-slate-200 bg-slate-100 text-slate-600">
                <th rowSpan={2} className="sticky left-0 z-10 min-w-[14rem] bg-slate-100 px-4 py-2 text-left font-medium">Kennzahl</th>
                {visibleVariants.map((v) => (
                  <th key={v.id} colSpan={columns.filter((c) => c.variant.id === v.id).length * 2}
                    className="border-l-2 border-slate-300 px-3 py-2 text-center font-semibold text-slate-900">
                    <span className="mr-1.5 rounded bg-slate-200 px-1 text-[10px] font-medium text-slate-600">V{v.variant_number}</span>
                    {v.name}
                    {v.id === effBaseId && <span className="ml-1.5 rounded bg-[#8B6956] px-1 text-[10px] font-medium text-white">Basis</span>}
                  </th>
                ))}
              </tr>
              {/* Unterspalten: Eigentumsart + Total */}
              <tr className="border-b border-slate-200 bg-slate-100 text-slate-600">
                {columns.map((c) => (
                  <th key={c.key} colSpan={2} className={cn('min-w-[12rem] px-3 py-1.5 text-center', c.first ? 'border-l-2 border-slate-300' : 'border-l border-slate-200')}>
                    {c.kind === 'total'
                      ? <span className="inline-flex rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Total</span>
                      : <span className="inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium text-slate-900" style={{ backgroundColor: EIGENTUMSART_COLOR[c.kind] }}>{EIGENTUMSART_LABEL[c.kind]}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => r.kind === 'group' ? (
                <tr key={`g${i}`}>
                  <td colSpan={1 + columns.length * 2} className="sticky left-0 bg-[#F5DDCD] px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700">{r.label}</td>
                </tr>
              ) : (
                <tr key={`r${i}`}>
                  <td className={cn('sticky left-0 z-10 bg-white px-4 py-1.5 text-slate-600', r.indent ? 'pl-8 text-[13px] text-slate-500' : 'font-medium')}>
                    {r.dot && <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ backgroundColor: r.dot }} />}
                    {r.label}
                  </td>
                  {r.kind === 'num'
                    ? columns.map((col) => {
                        const c = valueCell(col, r)
                        return (
                          <Fragment key={col.key}>
                            <td className={cn('py-1.5 pl-3 pr-1', col.first ? 'border-l-2 border-slate-200' : 'border-l border-slate-100', col.variant.id === effBaseId && 'bg-[#F2D3C2]/20')}>
                              <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                                <span className="tabular-nums text-slate-900">{c.num}</span>
                                <span className="w-14 shrink-0 text-left text-[11px] text-slate-900">{c.unit}</span>
                              </div>
                            </td>
                            <td className={cn('py-1.5 pl-1 pr-3 text-right text-[11px] tabular-nums text-slate-400', col.variant.id === effBaseId && 'bg-[#F2D3C2]/20')}>{c.delta}</td>
                          </Fragment>
                        )
                      })
                    : columns.map((col) => (
                        <td key={col.key} colSpan={2} className={cn('px-3 py-1.5 text-right', col.first ? 'border-l-2 border-slate-200' : 'border-l border-slate-100', col.variant.id === effBaseId && 'bg-[#F2D3C2]/20')}>{r.render(col)}</td>
                      ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
