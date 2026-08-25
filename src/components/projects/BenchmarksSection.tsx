import { Fragment, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Gauge, Loader2 } from 'lucide-react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { type BkpErgebnis } from '@/lib/bkpBerechnung'
import { effektiveWohnungCounts, eigentumsartForBuilding, EIGENTUMSART_LABEL } from '@/types'
import type { VariantBuildingFull } from '@/hooks/useMengengeruest'
import { EIGENTUMSART_COLOR, TOTAL_COLOR } from '@/lib/kategorieFarben'
import { cn, formatNumber } from '@/lib/utils'

interface Qty { gf: number; gv: number; vmf: number; wohnungen: number }

// Kostenbasen (Hauptgruppen-Codes), über die je Benchmark gerechnet wird.
const BASES: { key: string; label: string; codes: number[] }[] = [
  { key: 'bkp2', label: 'BKP 2', codes: [2] },
  { key: 'bkp26', label: 'BKP 2 + 6', codes: [2, 6] },
  { key: 'bkp16', label: 'BKP 1–6', codes: [1, 2, 3, 4, 5, 6] },
  { key: 'bkp19', label: 'BKP 1–9', codes: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
  { key: 'bkp09', label: 'BKP 0–9', codes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
]

interface BaseRow { key: string; label: string; netto: number; brutto: number }

// Kostenbasis (netto/brutto) je BKP-Bereich aus einer Liste von Ergebnissen.
function basesFrom(ergebnisse: BkpErgebnis[]): BaseRow[] {
  const netto: Record<number, number> = {}
  const mwst: Record<number, number> = {}
  for (let c = 0; c <= 9; c++) { netto[c] = 0; mwst[c] = 0 }
  for (const erg of ergebnisse) {
    for (let c = 0; c <= 9; c++) {
      netto[c] += erg.hauptgruppenSummenNetto[c as keyof typeof erg.hauptgruppenSummenNetto] ?? 0
      mwst[c] += erg.hauptgruppenSummenMwst[c as keyof typeof erg.hauptgruppenSummenMwst] ?? 0
    }
  }
  return BASES.map((b) => {
    const n = b.codes.reduce((s, c) => s + netto[c], 0)
    const m = b.codes.reduce((s, c) => s + mwst[c], 0)
    return { key: b.key, label: b.label, netto: n, brutto: n + m }
  })
}

// Bezugsgrössen aus dem Mengengerüst.
function qtyFrom(buildings: VariantBuildingFull[]) {
  let gf = 0, gv = 0, vmf = 0, wohnungen = 0
  for (const b of buildings) {
    for (const m of b.mietflaechen) {
      gf += m.gf_m2 || 0
      gv += m.volumen_m3 || 0
      vmf += m.flaeche_m2 || 0
      // Wohnungen: Zimmer-Mix, sonst die auf Geschossebene erfasste Stückzahl.
      wohnungen += effektiveWohnungCounts(m.nutzung, m.wohnungsmix, m.anzahl).reduce((s, [, c]) => s + c, 0)
    }
  }
  return { gf, gv, vmf, wohnungen }
}

interface BenchBlock { key: string; label: string; color: string; bases: BaseRow[]; qty: Qty }

export function BenchmarksSection({ defaultExpanded = false }: { defaultExpanded?: boolean }) {
  const ak = useAnlagekostenShared()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [tab, setTab] = useState<string>('konsolidiert')

  // Nur Etappen mit Gebäuden/Blöcken als Tab anbieten.
  const etappenMitBlock = useMemo(
    () => ak.etappen.filter((e) => ak.blockList.some((b) => b.etappeId === e.id)),
    [ak.etappen, ak.blockList],
  )
  const tabs = [{ key: 'konsolidiert', label: 'Konsolidiert' }, ...etappenMitBlock.map((e) => ({ key: e.id, label: e.name }))]
  // Falls der aktive Tab verschwindet (Etappe entfernt), auf Konsolidiert zurück.
  const activeTab = tabs.some((t) => t.key === tab) ? tab : 'konsolidiert'
  const isKons = activeTab === 'konsolidiert'

  const viewBuildings = useMemo(
    () => (isKons ? ak.buildings : ak.buildings.filter((b) => b.etappe_id === activeTab)),
    [isKons, activeTab, ak.buildings],
  )

  // Karten der aktiven Ansicht: Gesamtprojekt + (bei mehreren) je Eigentumsart.
  const blocks = useMemo<BenchBlock[]>(() => {
    const ergFor = (eig: typeof ak.presentEig[number]) =>
      isKons ? ak.konsolidiert.get(eig)?.ergebnis : ak.blockErgebnisse.get(`${activeTab}::${eig}`)
    const eigsInView = ak.presentEig.filter((eig) =>
      !!ergFor(eig) || viewBuildings.some((b) => eigentumsartForBuilding(b.use_type) === eig))

    const out: BenchBlock[] = []
    const allErg = ak.presentEig.map(ergFor).filter((x): x is BkpErgebnis => !!x)
    // Nur eine Eigentumsart in dieser Ansicht → Block mit deren Name/Farbe statt „Gesamtprojekt".
    const onlyEig = eigsInView.length === 1 ? eigsInView[0] : null
    out.push({
      key: 'gesamt',
      label: onlyEig
        ? EIGENTUMSART_LABEL[onlyEig]
        : (isKons ? 'Gesamtprojekt · alle Eigentumsarten' : 'Gesamt · alle Eigentumsarten'),
      color: onlyEig ? EIGENTUMSART_COLOR[onlyEig] : TOTAL_COLOR,
      bases: basesFrom(allErg),
      qty: qtyFrom(viewBuildings),
    })
    if (eigsInView.length > 1) {
      for (const eig of eigsInView) {
        const erg = ergFor(eig)
        out.push({
          key: eig,
          label: EIGENTUMSART_LABEL[eig],
          color: EIGENTUMSART_COLOR[eig],
          bases: basesFrom(erg ? [erg] : []),
          qty: qtyFrom(viewBuildings.filter((b) => eigentumsartForBuilding(b.use_type) === eig)),
        })
      }
    }
    return out
  }, [isKons, activeTab, ak.presentEig, ak.konsolidiert, ak.blockErgebnisse, viewBuildings])

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 bg-[#B98C74] px-5 py-3 text-sm font-semibold text-slate-900 transition hover:brightness-95"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-slate-700" /> : <ChevronRight className="h-4 w-4 text-slate-700" />}
        <Gauge className="h-4 w-4 text-slate-700" />
        <span>Benchmarks</span>
      </button>

      {expanded && (ak.loading ? (
        <div className="flex min-h-[15vh] items-center justify-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Wird geladen…
        </div>
      ) : (
        <div className="space-y-5 p-5">
          {/* Tab-Leiste: Konsolidiert + je Etappe */}
          <div className="flex flex-wrap gap-1 border-b border-slate-200">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  'rounded-t-lg border border-b-0 px-4 py-2 text-sm font-medium transition',
                  activeTab === t.key
                    ? 'border-slate-200 bg-slate-200 text-slate-900'
                    : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {blocks.map((blk) => (
            <div key={blk.key} className="overflow-hidden rounded-lg border border-slate-200">
              <div className="px-4 py-2 text-sm font-semibold text-slate-900" style={{ backgroundColor: blk.color }}>
                {blk.label}
              </div>
              <BenchmarkMatrix bases={blk.bases} qty={blk.qty} />
            </div>
          ))}

          <p className="text-[11px] text-slate-400">
            {isKons ? 'Konsolidiert über alle Etappen.' : 'Aktuelle Etappe.'}
            {' '}GF = Geschossfläche, GV = Gebäudevolumen, VMF/VKF = Vermiet-/Verkaufsfläche. Wohnungen aus dem Wohnungsmix.
          </p>
        </div>
      ))}
    </section>
  )
}

function BenchmarkMatrix({ bases, qty }: { bases: BaseRow[]; qty: Qty }) {
  const metrics: { label: string; einheit: string; qty: number; qtyLabel: string }[] = [
    { label: 'Kosten / m² GF', einheit: 'CHF/m²', qty: qty.gf, qtyLabel: `${formatNumber(qty.gf)} m²` },
    { label: 'Kosten / m³ GV', einheit: 'CHF/m³', qty: qty.gv, qtyLabel: `${formatNumber(qty.gv)} m³` },
    { label: 'Kosten / m² VMF (VKF)', einheit: 'CHF/m²', qty: qty.vmf, qtyLabel: `${formatNumber(qty.vmf)} m²` },
    { label: 'Kosten / Wohnung', einheit: 'CHF/Whg', qty: qty.wohnungen, qtyLabel: `${formatNumber(qty.wohnungen)} Whg` },
  ]
  const cell = (amount: number, q: number) => (q > 0 ? formatNumber(amount / q) : '—')
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="border-b border-slate-200">
            <th rowSpan={2} className="px-3 py-2 text-left align-bottom text-xs font-medium uppercase tracking-wider text-slate-500">Kennzahl</th>
            <th rowSpan={2} className="px-3 py-2 text-right align-bottom text-xs font-medium uppercase tracking-wider text-slate-500">Bezug</th>
            {bases.map((b) => (
              <th key={b.key} colSpan={2} className="border-l border-slate-200 px-3 py-2 text-center text-xs font-semibold text-slate-700">
                {b.label}
              </th>
            ))}
          </tr>
          <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400">
            {bases.map((b) => (
              <Fragment key={b.key}>
                <th className="border-l border-slate-200 px-3 py-1 text-right font-medium">exkl. MWST</th>
                <th className="px-3 py-1 text-right font-medium">inkl. MWST</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          <tr className="bg-slate-50 font-medium text-slate-900">
            <td className="px-3 py-2">Anlagekosten</td>
            <td className="px-3 py-2 text-right text-xs text-slate-400">CHF</td>
            {bases.map((b) => (
              <Fragment key={b.key}>
                <td className="border-l border-slate-200 px-3 py-2 text-right tabular-nums">{formatNumber(b.netto)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(b.brutto)}</td>
              </Fragment>
            ))}
          </tr>
          {metrics.map((mt) => (
            <tr key={mt.label}>
              <td className="px-3 py-2 text-slate-700">
                {mt.label}
                <span className="ml-1 text-[11px] text-slate-400">({mt.einheit})</span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-500">{mt.qtyLabel}</td>
              {bases.map((b) => (
                <Fragment key={b.key}>
                  <td className="border-l border-slate-200 px-3 py-2 text-right tabular-nums text-slate-900">{cell(b.netto, mt.qty)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-900">{cell(b.brutto, mt.qty)}</td>
                </Fragment>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
