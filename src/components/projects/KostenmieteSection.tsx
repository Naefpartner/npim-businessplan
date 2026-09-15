import { useEffect, useMemo, useState } from 'react'
import { useAufklappbar } from '@/hooks/useAufklappbar'
import { ChevronDown, ChevronRight, ExternalLink, Landmark, Loader2, Calculator, Grid3x3, Home, SlidersHorizontal, Lock, Unlock, RotateCcw } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import {
  basisFromErgebnis, berechneKostenmiete, sammleKostenmieteMengen,
  type KostenmieteParams, type KostenmieteBasis, type BaurechtZeile, type ErtragNutzung,
  type SensParamId, type SensAxisStep,
} from '@/lib/kostenmiete'
import { buildUnits, wohnungsmieten as berechneWohnungsmieten } from '@/lib/mengenAnalyse'
import { useKostenmiete } from '@/hooks/useKostenmiete'
import { useUndoableSetter } from '@/contexts/UndoContext'
import { useWbfZh } from '@/hooks/useWbfZh'
import { EIGENTUMSART_COLOR, USE_TYPE_COLOR_1, USE_TYPE_COLOR_3, USE_TYPE_COLOR_7 } from '@/lib/kategorieFarben'
import { etappenTabs } from '@/lib/etappenTabs'
import { cn, formatNumber } from '@/lib/utils'

const EIG: 'genossenschaft' = 'genossenschaft'

function formatPctNumber(n: number): string {
  return String(+(n * 100).toFixed(6))
}

// ─── Sensitivitätsanalyse ────────────────────────────────────────────────────
const SENS_PARAMS: { id: SensParamId; label: string; fmt: (v: number) => string }[] = [
  { id: 'refzins',        label: 'Referenzzinssatz',                   fmt: (v) => `${formatPctNumber(v)} %` },
  { id: 'erstellung_pm2', label: 'Erstellungskosten BKP 1–9 (CHF/m²)', fmt: (v) => formatNumber(v) },
  { id: 'erstellung_abs', label: 'Erstellungskosten BKP 1–9 (CHF)',    fmt: (v) => formatNumber(v) },
  { id: 'vmf_wohnen',     label: 'VMF Wohnen (m²)',                    fmt: (v) => formatNumber(v) },
]

const DEFAULT_STEP: SensAxisStep = { mode: 'pct', value: 0.1 }
const STEP_IDX = [-2, -1, 0, 1, 2]

function axisUnit(id: SensParamId): string {
  switch (id) {
    case 'refzins':        return '%-Pkt'
    case 'erstellung_pm2': return 'CHF/m²'
    case 'erstellung_abs': return 'CHF'
    case 'vmf_wohnen':     return 'm²'
  }
}

// 5 Stationen je Achse: Schrittweite relativ (% des Basiswerts) oder absolut.
function axisValues(base: number, step: SensAxisStep): number[] {
  return step.mode === 'pct'
    ? STEP_IDX.map((i) => base * (1 + i * step.value))
    : STEP_IDX.map((i) => base + i * step.value)
}

function sensBase(id: SensParamId, basis: KostenmieteBasis, params: KostenmieteParams): number {
  switch (id) {
    case 'refzins':        return params.referenzzinssatz
    case 'erstellung_abs': return basis.erstellungBrutto
    case 'erstellung_pm2': return basis.wohnenFlaeche > 0 ? basis.erstellungBrutto / basis.wohnenFlaeche : 0
    case 'vmf_wohnen':     return basis.wohnenFlaeche
  }
}

/** Kennwert CHF/m²,a (Kostenmiete Wohnen) bei überschriebenen Parameterwerten. */
function sensCell(
  basis: KostenmieteBasis, params: KostenmieteParams, ertrags: ErtragNutzung[],
  assigns: [SensParamId, number][],
): number {
  const core = {
    referenzzinssatz: params.referenzzinssatz,
    erstellungBrutto: basis.erstellungBrutto,
    wohnenFlaeche: basis.wohnenFlaeche,
  }
  // Zuerst die direkten Grössen setzen …
  for (const [id, v] of assigns) {
    if (id === 'refzins') core.referenzzinssatz = v
    else if (id === 'erstellung_abs') core.erstellungBrutto = v
    else if (id === 'vmf_wohnen') core.wohnenFlaeche = v
  }
  // … dann CHF/m² (hängt von der ggf. überschriebenen VMF ab).
  for (const [id, v] of assigns) {
    if (id === 'erstellung_pm2') core.erstellungBrutto = v * core.wohnenFlaeche
  }
  const r = berechneKostenmiete(
    { ...basis, erstellungBrutto: core.erstellungBrutto, wohnenFlaeche: core.wohnenFlaeche },
    { ...params, referenzzinssatz: core.referenzzinssatz },
    ertrags,
  )
  return r.proM2Jahr
}

export function KostenmieteSection({ variantId, defaultExpanded = false }: { variantId: string; defaultExpanded?: boolean }) {
  const { canWrite } = useAuth()
  const [expanded, umschalten] = useAufklappbar(defaultExpanded)
  const ak = useAnlagekostenShared()
  const { params, setParams: setParamsRaw, sens, setSens: setSensRaw, loading: paramsLoading } = useKostenmiete(variantId)
  const setParams = useUndoableSetter(params, setParamsRaw, 'Kostenmiete', `kostenmiete:${variantId}`)
  const setSens = useUndoableSetter(sens, setSensRaw, 'Sensitivitätsanalyse', `kostenmiete-sens:${variantId}`)
  const { params: wbf } = useWbfZh(variantId)
  const { axisX, axisY, stepX, stepY } = sens

  const hasGenossenschaft = ak.presentEig.includes(EIG)

  // Reiter: Konsolidiert + Etappen mit Genossenschafts-Block.
  const [activeTab, setActiveTab] = useState<string>('konsolidiert')
  const etappenMitBlock = useMemo(
    () => ak.etappen.filter((e) => ak.blockErgebnisse.has(`${e.id}::${EIG}`)),
    [ak.etappen, ak.blockErgebnisse],
  )
  // Ohne zweite Etappe gibt es nichts zu wählen — dann keine Reiterleiste.
  const tabs = etappenTabs(etappenMitBlock)
  const tabKey = tabs.some((t) => t.key === activeTab) ? activeTab : 'konsolidiert'
  const isKons = tabKey === 'konsolidiert'

  const { vmf, wohnenFlaeche, wohnungen, ertragsNutzungen } = useMemo(
    () => sammleKostenmieteMengen(ak.buildings, isKons ? null : tabKey),
    [ak.buildings, isKons, tabKey],
  )

  // Kosten aus der in den Anlagekosten gewählten Erfassungsmethode — auf
  // Etappenebene ebenso wie konsolidiert.
  const ergebnis = isKons
    ? ak.konsolidiertEffektiv.get(EIG)
    : ak.blockErgebnisseEffektiv.get(`${tabKey}::${EIG}`)
  const basis = useMemo(
    () => (ergebnis ? basisFromErgebnis(ergebnis, vmf, wohnenFlaeche, wohnungen) : null),
    [ergebnis, vmf, wohnenFlaeche, wohnungen],
  )
  const result = useMemo(
    () => (basis ? berechneKostenmiete(basis, params, ertragsNutzungen) : null),
    [basis, params, ertragsNutzungen],
  )

  // Wohnungen der Genossenschaft (je Reiter) — dieselbe Einheiten-Basis wie die
  // Mengen-/Mietzinsanalyse, damit dort exakt dieselben Wohnungsmieten stehen.
  const genoWohnungen = useMemo(
    () => buildUnits(ak.buildings, ak.etappen)
      .filter((u) => u.eig === EIG && u.istWohnen && (isKons || u.etappeId === tabKey)),
    [ak.buildings, ak.etappen, isKons, tabKey],
  )

  // Miete je Wohnung = max. Mietertrag Wohnen / Total-WBF-Punkte × Punkte des
  // Wohnungstyps / 12 (CHF/Monat).
  const wohnungsmieten = useMemo(
    () => berechneWohnungsmieten(genoWohnungen, wbf.punkte, result?.maxMietertragWohnen ?? 0),
    [genoWohnungen, wbf.punkte, result],
  )

  // Sensitivitäts-Matrix: CHF/m²,a (Kostenmiete Wohnen) über zwei Parameter.
  const sensMatrix = useMemo(() => {
    if (!basis) return null
    const baseX = sensBase(axisX, basis, params)
    const baseY = sensBase(axisY, basis, params)
    const colVals = axisValues(baseX, stepX)
    const rowVals = axisValues(baseY, stepY)
    const cells = rowVals.map((rv) =>
      colVals.map((cv) => sensCell(basis, params, ertragsNutzungen, [[axisX, cv], [axisY, rv]])),
    )
    return { colVals, rowVals, cells }
  }, [basis, params, ertragsNutzungen, axisX, axisY, stepX, stepY])

  function pickAxisX(id: SensParamId) {
    if (id === axisX) return
    if (id === axisY) setSens({ ...sens, axisX: id, axisY: axisX, stepX: stepY, stepY: stepX })
    else setSens({ ...sens, axisX: id, stepX: DEFAULT_STEP })
  }
  function pickAxisY(id: SensParamId) {
    if (id === axisY) return
    if (id === axisX) setSens({ ...sens, axisY: id, axisX: axisY, stepY: stepX, stepX: stepY })
    else setSens({ ...sens, axisY: id, stepY: DEFAULT_STEP })
  }
  const updateStepX = (s: SensAxisStep) => setSens({ ...sens, stepX: s })
  const updateStepY = (s: SensAxisStep) => setSens({ ...sens, stepY: s })

  function set<K extends keyof KostenmieteParams>(key: K, value: KostenmieteParams[K]) {
    void setParams({ ...params, [key]: value })
  }
  function setBaurecht(key: 'baurechtSubv' | 'baurechtNichtSubv', patch: Partial<BaurechtZeile>) {
    void setParams({ ...params, [key]: { ...params[key], ...patch } })
  }
  const betragOf = (key: string) => result?.posten.find((p) => p.key === key)?.betrag ?? 0

  // Header nur darstellen, wenn überhaupt Genossenschaftsbauten erfasst sind.
  if (!hasGenossenschaft) return null

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={umschalten}
        style={{ backgroundColor: EIGENTUMSART_COLOR.genossenschaft }}
        className="flex w-full items-center gap-2 px-5 py-3 text-sm font-semibold text-slate-900 transition hover:brightness-95"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-slate-700" /> : <ChevronRight className="h-4 w-4 text-slate-700" />}
        <Landmark className="h-4 w-4 text-slate-700" />
        <span>Kostenmiete (Genossenschaft)</span>
        <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-normal text-slate-700">Zürcher Modell</span>
      </button>

      {expanded && (ak.loading || paramsLoading ? (
        <div className="flex min-h-[15vh] items-center justify-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Wird geladen…
        </div>
      ) : !hasGenossenschaft || !ergebnis || !result || !basis ? (
        <div className="m-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
          Keine Genossenschaftsbauten in dieser Variante. Die Kostenmiete berechnet sich aus den
          Anlagekosten der Eigentumsart „Genossenschaft".
        </div>
      ) : (
        <div className="space-y-6 p-5">
          {/* Reiter: Konsolidiert + je Etappe */}
          {tabs.length > 0 && (
            <div className="flex flex-wrap gap-1 border-b border-slate-200">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveTab(t.key)}
                  className={cn(
                    'rounded-t-lg border border-b-0 px-4 py-2 text-sm font-medium transition',
                    tabKey === t.key
                      ? 'border-slate-200 bg-slate-200 text-slate-900'
                      : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {/* Berechnung — Parameter direkt in den Zeilen editierbar */}
          <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Calculator className="h-5 w-5 text-slate-500" />
            Kostenmietberechnung
          </h3>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[760px] table-fixed text-sm">
              <colgroup>
                <col style={{ width: '32%' }} />
                <col style={{ width: '9.5rem' }} />
                <col />
                <col style={{ width: '9rem' }} />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100 text-sm font-semibold text-slate-900">
                  <th className="px-4 py-2 text-left">Kostenposition</th>
                  <th className="px-4 py-2 text-left">Zinssatz</th>
                  <th className="px-4 py-2 text-left">Berechnung</th>
                  <th className="px-4 py-2 text-right">CHF / Jahr</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {/* Verzinsung Erstellungskosten */}
                <tr>
                  <td className="px-4 py-2.5 text-slate-900">Verzinsung Erstellungskosten</td>
                  <td className="px-4 py-2.5">
                    <PctInline value={params.referenzzinssatz} disabled={!canWrite} onChange={(v) => set('referenzzinssatz', v)} />
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-900">
                    <span className="inline-flex items-center gap-1.5">
                      von Erstellungskosten CHF {formatNumber(basis.erstellungBrutto)}
                      <a
                        href="https://www.bwo.admin.ch/de/entwicklung-referenzzinssatz-und-durchschnittszinssatz"
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Aktuellen Referenzzinssatz beim BWO nachschlagen"
                        className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 transition hover:border-[#8B6956] hover:text-[#8B6956]"
                      >
                        <ExternalLink className="h-3 w-3" /> Referenzzinssatz
                      </a>
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">{formatNumber(betragOf('verz_erstellung'))}</td>
                </tr>

                {/* Baurecht-Umschalter */}
                <tr className="bg-slate-50">
                  <td colSpan={4} className="px-4 py-1.5">
                    <label className="inline-flex items-center gap-2 text-xs text-slate-900">
                      <input type="checkbox" checked={params.imBaurecht} disabled={!canWrite} onChange={(e) => set('imBaurecht', e.target.checked)} className="h-3.5 w-3.5" />
                      Grundstück im Baurecht (Baurechtszins statt Verzinsung Grundstück)
                    </label>
                  </td>
                </tr>

                {!params.imBaurecht ? (
                  <tr>
                    <td className="px-4 py-2.5 text-slate-900">Verzinsung Grundstück</td>
                    <td className="px-4 py-2.5"><PctInline value={params.referenzzinssatz} disabled /></td>
                    <td className="px-4 py-2.5 text-sm text-slate-900">(Referenzzinssatz) von Grundstück CHF {formatNumber(basis.grundstueckBrutto)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">{formatNumber(betragOf('verz_grundstueck'))}</td>
                  </tr>
                ) : (
                  <>
                    <tr>
                      <td className="px-4 py-2.5 text-slate-900">Baurechtszins</td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          <PctInline value={params.baurechtZins} disabled={!canWrite} onChange={(v) => set('baurechtZins', v)} />
                          <ZinsRechner disabled={!canWrite} onApply={(v) => set('baurechtZins', v)} />
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-sm text-slate-500">frei wählbar · Rechner für Mittelwert mehrerer Zinssätze</td>
                      <td />
                    </tr>
                    <BaurechtTableRow
                      label="Baurechtszins · subventioniert"
                      zeile={params.baurechtSubv} betrag={betragOf('baurecht_subv')}
                      erstellung={basis.erstellungBrutto} baurechtZins={params.baurechtZins} disabled={!canWrite}
                      onChange={(patch) => setBaurecht('baurechtSubv', patch)}
                    />
                    <BaurechtTableRow
                      label="Baurechtszins · nicht subventioniert"
                      zeile={params.baurechtNichtSubv} betrag={betragOf('baurecht_nsubv')}
                      erstellung={basis.erstellungBrutto} baurechtZins={params.baurechtZins} disabled={!canWrite}
                      onChange={(patch) => setBaurecht('baurechtNichtSubv', patch)}
                    />
                  </>
                )}

                {/* Betriebskosten */}
                <tr>
                  <td className="px-4 py-2.5 text-slate-900">Betriebskosten</td>
                  <td className="px-4 py-2.5">
                    <PctInline value={params.betriebskostenSatz} disabled={!canWrite} onChange={(v) => set('betriebskostenSatz', v)} />
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-900">
                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      von GVW =
                      <PctInline value={params.gvwFaktor} disabled={!canWrite} onChange={(v) => set('gvwFaktor', v)} />
                      × Erstellungskosten CHF {formatNumber(basis.erstellungBrutto)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">{formatNumber(betragOf('betriebskosten'))}</td>
                </tr>

                {/* Zwischensumme: Maximale Mieterträge */}
                <tr className="border-t-2 border-slate-300 font-semibold text-slate-900" style={{ backgroundColor: USE_TYPE_COLOR_3.genossenschaft }}>
                  <td className="px-4 py-2.5 text-slate-900" colSpan={3}>Maximale Mieterträge</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">{formatNumber(result.maxMieterertrag)}</td>
                </tr>

                {/* Erfasste Mieterträge je Nutzung */}
                {result.ertragsNutzungen.length > 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 pt-3 pb-1 text-[11px] text-slate-400">
                      Erfasste Mieterträge je Nutzung (Wohnen wird nicht abgezogen)
                    </td>
                  </tr>
                )}
                {result.ertragsNutzungen.map((e) => (
                  <tr key={e.nutzung}>
                    <td className="px-4 py-2.5 text-slate-900">
                      {e.nutzung}
                      {e.istWohnen && <span className="ml-1.5 text-[10px] text-slate-500">(Residual – nicht abgezogen)</span>}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-slate-900">
                      {e.basis === 'flaeche'
                        ? `${formatNumber(e.flaeche)} m² VNF`
                        : `${formatNumber(e.anzahl)} Stk`}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-slate-900">
                      {e.basis === 'flaeche'
                        ? `${formatNumber(e.flaeche > 0 ? e.ertragJahr / e.flaeche : 0)} CHF/m² VNF,a`
                        : `${formatNumber(e.anzahl > 0 ? e.ertragJahr / e.anzahl / 12 : 0, 2)} CHF/Stk·Mt × 12`}
                    </td>
                    <td className={cn('px-4 py-2.5 text-right tabular-nums', e.istWohnen ? 'text-slate-400' : 'text-rose-600')}>
                      {e.istWohnen ? formatNumber(e.ertragJahr) : `− ${formatNumber(e.ertragJahr)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="text-slate-900" style={{ backgroundColor: USE_TYPE_COLOR_7.genossenschaft }}>
                  <td className="px-4 py-3 text-sm font-semibold" colSpan={2}>Maximaler Mietertrag Wohnen</td>
                  <td className="px-4 py-3 text-right text-sm font-medium tabular-nums text-slate-700">{formatNumber(result.proM2Jahr)} CHF/m² VMF</td>
                  <td className="px-4 py-3 text-right text-base font-bold tabular-nums">{formatNumber(result.maxMietertragWohnen)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Sensitivitätsanalyse: Kennwert CHF/m²,a Wohnen über zwei Parameter */}
          {sensMatrix && (() => {
            const xParam = SENS_PARAMS.find((p) => p.id === axisX)!
            const yParam = SENS_PARAMS.find((p) => p.id === axisY)!
            return (
              <div className="space-y-3 border-t border-slate-200 pt-6">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                    <Grid3x3 className="h-5 w-5 text-slate-500" />
                    Sensitivitätsanalyse
                  </h3>
                  <span className="text-xs text-slate-500">Kennwert Kostenmiete Wohnen — CHF/m² VNF · Jahr</span>
                </div>

                <div className="flex flex-col gap-2 text-xs text-slate-600 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
                  <div className="flex items-center gap-1.5">
                    <span className="w-20 shrink-0 text-slate-500">Spalten (X)</span>
                    <select
                      value={axisX}
                      onChange={(e) => pickAxisX(e.target.value as SensParamId)}
                      className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs outline-none focus:border-[#8B6956]"
                    >
                      {SENS_PARAMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                    <span className="text-slate-400">Schritt</span>
                    <AxisStepControl paramId={axisX} base={sensBase(axisX, basis, params)} step={stepX} onChange={updateStepX} />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-20 shrink-0 text-slate-500">Zeilen (Y)</span>
                    <select
                      value={axisY}
                      onChange={(e) => pickAxisY(e.target.value as SensParamId)}
                      className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs outline-none focus:border-[#8B6956]"
                    >
                      {SENS_PARAMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                    <span className="text-slate-400">Schritt</span>
                    <AxisStepControl paramId={axisY} base={sensBase(axisY, basis, params)} step={stepY} onChange={updateStepY} />
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full table-fixed text-sm">
                    <colgroup>
                      <col style={{ width: '25%' }} />
                      <col style={{ width: '15%' }} />
                      <col style={{ width: '15%' }} />
                      <col style={{ width: '15%' }} />
                      <col style={{ width: '15%' }} />
                      <col style={{ width: '15%' }} />
                    </colgroup>
                    <thead>
                      <tr className="bg-slate-100">
                        <th className="px-3 py-2 text-left text-[10px] font-medium leading-tight text-slate-500">
                          {yParam.label} ⬍<br />/ {xParam.label} ⬌
                        </th>
                        {sensMatrix.colVals.map((cv, ci) => (
                          <th key={ci} className={cn('px-3 py-2 text-right text-xs font-semibold text-slate-700', ci === 2 && 'bg-slate-200')}>
                            {xParam.fmt(cv)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sensMatrix.rowVals.map((rv, ri) => (
                        <tr key={ri} className="border-t border-slate-100">
                          <th className={cn('px-3 py-2 text-left text-xs font-semibold text-slate-700', ri === 2 && 'bg-slate-200')}>
                            {yParam.fmt(rv)}
                          </th>
                          {sensMatrix.colVals.map((_, ci) => {
                            const isBase = ri === 2 && ci === 2
                            const inCross = ri === 2 || ci === 2
                            return (
                              <td
                                key={ci}
                                className={cn(
                                  'px-3 py-2 text-right tabular-nums text-slate-900',
                                  isBase ? 'bg-slate-300 font-semibold' : inCross && 'bg-slate-200',
                                )}
                              >
                                {formatNumber(sensMatrix.cells[ri][ci], 0)}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-slate-400">
                  Zellen = max. Kostenmiete Wohnen in CHF/m² VNF·Jahr. Mittlere Zelle (hervorgehoben) = aktueller Basis-Fall.
                  Schrittweite je Achse relativ (%) oder absolut wählbar (2 Schritte je Richtung). Übrige Parameter bleiben konstant.
                </p>
              </div>
            )
          })()}

          {/* Interaktiver Regler (What-if) */}
          {basis && (
            <KostenmietePlayground key={tabKey} basis={basis} params={params} ertragsNutzungen={ertragsNutzungen} />
          )}

          {/* Resultierende Wohnungsmieten: max. Mietertrag Wohnen nach WBF-Punkten */}
          {result && wohnungsmieten.rows.length > 0 && (
            <div className="space-y-3 border-t border-slate-200 pt-6">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                  <Home className="h-5 w-5 text-slate-500" />
                  Resultierende Wohnungsmieten
                </h3>
                <span className="text-xs text-slate-500">Maximaler Mietertrag Wohnen nach WBF-Punkten verteilt — CHF/Monat</span>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col style={{ width: '25%' }} />
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '15%' }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-100 text-slate-600">
                      <th className="px-4 py-2 text-left font-medium">Wohnungstyp</th>
                      <th className="px-4 py-2 text-right font-medium">Punkte/Whg</th>
                      <th className="px-4 py-2 text-right font-medium">Anzahl</th>
                      <th className="px-4 py-2 text-right font-medium">Miete CHF/Mt.</th>
                      <th colSpan={2} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {wohnungsmieten.rows.map((r) => (
                      <tr key={r.key}>
                        <td className="px-4 py-2 text-slate-700">{r.label}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-600">{formatNumber(r.punkte, 1)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-900">{formatNumber(r.anzahl)}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-900">{formatNumber(r.mieteMt)}</td>
                        <td colSpan={2} />
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 font-semibold text-slate-900" style={{ backgroundColor: USE_TYPE_COLOR_1.genossenschaft }}>
                      <td className="px-4 py-2">Total / Monat</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatNumber(wohnungsmieten.punkteTotal, 1)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatNumber(wohnungsmieten.anzahlTotal)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatNumber(wohnungsmieten.monatlichTotal)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>

              <p className="text-[11px] text-slate-400">
                Miete je Wohnung = Maximaler Mietertrag Wohnen ({formatNumber(wohnungsmieten.maxWohnenPa)} CHF/a) ÷ Total
                WBF-Punkte ({formatNumber(wohnungsmieten.punkteTotal, 1)}) × Punkte des Wohnungstyps ÷ 12. Punkte aus
                der WBF-Berechnung (Anlagekostenlimiten), Wohnungsmix aus den Mengen.
              </p>
            </div>
          )}

        </div>
      ))}
    </section>
  )
}

function AxisStepControl({ paramId, base, step, onChange }: {
  paramId: SensParamId; base: number; step: SensAxisStep; onChange: (s: SensAxisStep) => void
}) {
  const rate = paramId === 'refzins'
  // Anzeige in % (relativ oder %-Punkte bei Zinssatz), sonst in der Einheit der Achse.
  const factor = step.mode === 'abs' && !rate ? 1 : 100
  const unit = step.mode === 'pct' ? '%' : (rate ? '%-Pkt' : axisUnit(paramId))
  const [text, setText] = useState(() => String(+(step.value * factor).toFixed(6)))
  useEffect(() => { setText(String(+(step.value * factor).toFixed(6))) }, [step.value, factor])

  function setMode(mode: 'pct' | 'abs') {
    onChange({ mode, value: mode === 'pct' ? 0.1 : base * 0.1 })
  }
  function commit() {
    const n = parseFloat(text.replace(',', '.'))
    onChange({ ...step, value: Number.isFinite(n) ? n / factor : 0 })
  }
  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={step.mode}
        onChange={(e) => setMode(e.target.value as 'pct' | 'abs')}
        className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs outline-none focus:border-[#8B6956]"
      >
        <option value="pct">%</option>
        <option value="abs">absolut</option>
      </select>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        className="w-24 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-right text-xs tabular-nums outline-none focus:border-[#8B6956] focus:ring-1 focus:ring-[#8B6956]/30"
      />
      <span className="text-slate-400">{unit}</span>
    </span>
  )
}

function BaurechtTableRow({ label, zeile, betrag, erstellung, baurechtZins, disabled, onChange }: {
  label: string; zeile: BaurechtZeile; betrag: number; erstellung: number; baurechtZins: number; disabled?: boolean
  onChange: (patch: Partial<BaurechtZeile>) => void
}) {
  const isChf = zeile.modus === 'chf'
  return (
    <tr>
      <td className="px-4 py-2.5 text-slate-900">{label}</td>
      <td className="px-4 py-2.5">
        {isChf
          ? <div className="inline-block w-20 pl-2 text-left text-xs text-slate-300">—</div>
          : <PctInline value={baurechtZins} disabled />}
      </td>
      <td className="px-4 py-2.5 text-sm text-slate-900">
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          Anteil
          <PctInline value={zeile.anteil} disabled={disabled} onChange={(v) => onChange({ anteil: v })} />
          <select
            value={isChf ? 'chf' : 'pct'}
            disabled={disabled}
            onChange={(e) => onChange({ modus: e.target.value as BaurechtZeile['modus'] })}
            className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs outline-none focus:border-[#8B6956] disabled:opacity-50"
          >
            <option value="pct">% der Erstellungskosten</option>
            <option value="chf">CHF / Jahr</option>
          </select>
          {isChf
            ? <ChfInline value={zeile.betragChf} disabled={disabled} onChange={(v) => onChange({ betragChf: v })} />
            : <>von Erstellungskosten CHF {formatNumber(erstellung)} ×&nbsp;Anteil</>}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">{formatNumber(betrag)}</td>
    </tr>
  )
}

// Mittelwert-Rechner: beliebig viele Zinssätze (z. B. die letzten Jahre)
// eingeben → Durchschnitt berechnen und als Baurechtszins übernehmen.
function ZinsRechner({ onApply, disabled }: { onApply: (avg: number) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [rates, setRates] = useState<string[]>(['', '', '', '', ''])
  const nums = rates.map((r) => parseFloat(r.replace(',', '.'))).filter((n) => Number.isFinite(n))
  const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
  return (
    <span className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title="Durchschnitt mehrerer Zinssätze berechnen"
        className="rounded border border-slate-300 p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
      >
        <Calculator className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <div className="mb-2 text-xs font-medium text-slate-600">Durchschnitt Zinssätze</div>
          <div className="space-y-1.5">
            {rates.map((r, i) => (
              <div key={i} className="flex items-center gap-1">
                <div className="relative flex-1">
                  <input
                    value={r}
                    inputMode="decimal"
                    placeholder="z. B. 1.5"
                    onChange={(e) => setRates((rs) => rs.map((x, j) => (j === i ? e.target.value : x)))}
                    className="w-full rounded border border-slate-300 bg-white py-0.5 pl-2 pr-5 text-right text-xs tabular-nums outline-none focus:border-[#8B6956]"
                  />
                  <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
                </div>
                <button
                  type="button"
                  onClick={() => setRates((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : ['']))}
                  className="px-1 text-sm leading-none text-slate-400 hover:text-red-500"
                  title="Zeile entfernen"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setRates((rs) => [...rs, ''])} className="mt-1.5 text-xs font-medium text-[#8B6956] hover:underline">
            + Zinssatz
          </button>
          <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
            <span className="font-medium text-slate-700">Ø {formatPctNumber(avg / 100)} %</span>
            <span className="text-slate-400">{nums.length} Werte</span>
          </div>
          <button
            type="button"
            onClick={() => { onApply(avg / 100); setOpen(false) }}
            className="mt-2 w-full rounded bg-[#F2D3C2] py-1 text-xs font-medium text-slate-900 transition hover:bg-[#E7AF90]"
          >
            Übernehmen
          </button>
        </div>
      )}
    </span>
  )
}

function PctInline({ value, disabled, onChange }: {
  value: number; disabled?: boolean; onChange?: (v: number) => void
}) {
  const [text, setText] = useState(() => formatPctNumber(value))
  useEffect(() => { setText(formatPctNumber(value)) }, [value])
  const readonly = disabled || !onChange
  return (
    <div className="relative inline-block w-20 align-middle">
      <input
        type="text"
        inputMode="decimal"
        value={text}
        disabled={readonly}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { const n = parseFloat(text.replace(',', '.')); onChange?.(Number.isFinite(n) ? n / 100 : 0) }}
        className="w-full rounded border border-slate-300 bg-white py-0.5 pl-2 pr-6 text-left text-xs tabular-nums outline-none focus:border-[#8B6956] focus:ring-1 focus:ring-[#8B6956]/30 disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-600"
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
    </div>
  )
}

function ChfInline({ value, disabled, onChange }: {
  value: number; disabled?: boolean; onChange: (v: number) => void
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => { setText(String(value)) }, [value])
  return (
    <span className="inline-flex items-center">
      <span className="mr-0.5 text-xs text-slate-400">CHF</span>
      <input
        type="number"
        step="1"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { const n = parseFloat(text.replace(',', '.')); onChange(Number.isFinite(n) ? n : 0) }}
        className="w-28 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-right text-xs tabular-nums outline-none focus:border-[#8B6956] focus:ring-1 focus:ring-[#8B6956]/30 disabled:opacity-50"
      />
    </span>
  )
}

// ─── Interaktiver Regler (What-if) ───────────────────────────────────────────
// Gekoppelte Grössen: Erstellungskosten (A) = Kosten/m² (k) × VMF Wohnen (V).
// Ein Schloss hält eine der drei fest; beim Verschieben einer anderen passt sich
// die dritte an. Referenzzinssatz (z) ist frei. Output = max. Kostenmiete Wohnen.
function clampN(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)) }

function KostenmietePlayground({ basis, params, ertragsNutzungen }: {
  basis: KostenmieteBasis; params: KostenmieteParams; ertragsNutzungen: ErtragNutzung[]
}) {
  const A0 = basis.erstellungBrutto
  const V0 = basis.wohnenFlaeche
  const k0 = V0 > 0 ? A0 / V0 : 0
  const z0 = params.referenzzinssatz

  const [v, setV] = useState(() => ({ A: A0, k: k0, V: V0, z: z0 }))
  const [locked, setLocked] = useState<'A' | 'k' | 'V'>('k')
  const [output, setOutput] = useState<'proM2' | 'total'>('proM2')

  if (A0 <= 0 || V0 <= 0) return null

  function change(which: 'A' | 'k' | 'V' | 'z', value: number) {
    if (which === 'z') { setV((p) => ({ ...p, z: value })); return }
    setV((prev) => {
      const next = { ...prev, [which]: value }
      const third = (['A', 'k', 'V'] as const).find((x) => x !== which && x !== locked)!
      if (third === 'A') next.A = next.k * next.V
      else if (third === 'k') next.k = next.V > 0 ? next.A / next.V : 0
      else next.V = next.k > 0 ? next.A / next.k : 0
      return next
    })
  }
  const reset = () => setV({ A: A0, k: k0, V: V0, z: z0 })

  const compute = (A: number, V: number, z: number) => sensCell(basis, params, ertragsNutzungen, [
    ['erstellung_abs', A], ['vmf_wohnen', V], ['refzins', z],
  ])
  const M = compute(v.A, v.V, v.z)
  const M0 = compute(A0, V0, z0)
  const outVal = output === 'proM2' ? M : M * v.V
  const outBase = output === 'proM2' ? M0 : M0 * V0
  const outUnit = output === 'proM2' ? 'CHF/m²·a' : 'CHF/a'
  const delta = outBase !== 0 ? (outVal - outBase) / outBase : 0

  return (
    <div className="space-y-4 border-t border-slate-200 pt-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <SlidersHorizontal className="h-5 w-5 text-slate-500" />
          Regler (What-if)
        </h3>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          Output
          <select
            value={output}
            onChange={(e) => setOutput(e.target.value as 'proM2' | 'total')}
            className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs outline-none focus:border-[#8B6956]"
          >
            <option value="proM2">Miete CHF/m²·a</option>
            <option value="total">Max. Mietertrag Wohnen CHF/a</option>
          </select>
        </label>
        <button
          type="button"
          onClick={reset}
          title="Regler auf den Stand der aktuellen Berechnung zurücksetzen"
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Auf Berechnung zurücksetzen
        </button>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="text-xs font-medium text-slate-500">{output === 'proM2' ? 'Miete Wohnen' : 'Max. Mietertrag Wohnen'}</div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums text-slate-900">{formatNumber(outVal)}</span>
          <span className="text-sm text-slate-400">{outUnit}</span>
          <span className={cn('text-xs tabular-nums', delta > 0.0001 ? 'text-emerald-700' : delta < -0.0001 ? 'text-red-600' : 'text-slate-400')}>
            {delta >= 0 ? '+' : ''}{(delta * 100).toFixed(1)} % ggü. Basis
          </span>
        </div>
      </div>

      <div className="space-y-2.5">
        <SliderRow label="Erstellungskosten (BKP 1–9)" unit="CHF" value={v.A}
          min={A0 * 0.5} max={A0 * 1.5} step={Math.max(1000, Math.round(A0 * 0.002))}
          locked={locked === 'A'} onToggleLock={() => setLocked('A')} onChange={(x) => change('A', x)} />
        <SliderRow label="Kosten VMF Wohnen" unit="CHF/m²" value={v.k}
          min={k0 * 0.5} max={k0 * 1.5} step={10}
          locked={locked === 'k'} onToggleLock={() => setLocked('k')} onChange={(x) => change('k', x)} />
        <SliderRow label="VMF Wohnen" unit="m²" value={v.V}
          min={V0 * 0.5} max={V0 * 1.5} step={1}
          locked={locked === 'V'} onToggleLock={() => setLocked('V')} onChange={(x) => change('V', x)} />
        <SliderRow label="Referenzzinssatz" unit="%" value={v.z} scale={100} decimals={2}
          min={0} max={0.05} step={0.0005} onChange={(x) => change('z', x)} />
      </div>

      <p className="text-[11px] text-slate-400">
        Sandbox — ändert die gespeicherten Werte nicht. Erstellungskosten = Kosten/m² × VMF; das Schloss hält eine
        Grösse fest, die jeweils dritte passt sich an. Output = max. Kostenmiete Wohnen bei den gewählten Reglern;
        übrige Parameter (Grundstück, GVW, Betriebskosten, weitere Nutzungen) wie in der Berechnung.
      </p>
    </div>
  )
}

function SliderRow({ label, unit, value, min, max, step, scale = 1, decimals = 0, locked, onToggleLock, onChange }: {
  label: string; unit: string; value: number; min: number; max: number; step: number
  scale?: number; decimals?: number; locked?: boolean; onToggleLock?: () => void; onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-3">
      {onToggleLock ? (
        <button
          type="button"
          onClick={onToggleLock}
          title={locked ? 'gesperrt — hält diesen Wert fest' : 'sperren'}
          className="shrink-0 rounded p-1 hover:bg-slate-100"
        >
          {locked ? <Lock className="h-4 w-4 text-[#8B6956]" /> : <Unlock className="h-4 w-4 text-slate-300" />}
        </button>
      ) : <span className="w-6 shrink-0" />}
      <div className="w-40 shrink-0 text-xs text-slate-600">{label}</div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={clampN(value, min, max)}
        disabled={locked}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer accent-[#8B6956] disabled:cursor-not-allowed disabled:opacity-40"
      />
      <NumField value={value} scale={scale} decimals={decimals} disabled={locked} onChange={onChange} />
      <div className="w-12 shrink-0 text-xs text-slate-400">{unit}</div>
    </div>
  )
}

// Zahlenfeld: rechtsbündig, 1000er-Trennzeichen, ohne Spinner-Pfeile.
function NumField({ value, scale, decimals, disabled, onChange }: {
  value: number; scale: number; decimals: number; disabled?: boolean; onChange: (v: number) => void
}) {
  const [raw, setRaw] = useState<string | null>(null)
  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw ?? formatNumber(value * scale, decimals)}
      disabled={disabled}
      onFocus={() => setRaw(String(+(value * scale).toFixed(decimals)))}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={() => {
        const n = parseFloat((raw ?? '').replace(/['’\s]/g, '').replace(',', '.'))
        if (Number.isFinite(n)) onChange(n / scale)
        setRaw(null)
      }}
      className="w-28 shrink-0 rounded border border-slate-300 bg-white px-2 py-0.5 text-right text-sm tabular-nums outline-none focus:border-[#8B6956] disabled:bg-slate-50 disabled:text-slate-400"
    />
  )
}
