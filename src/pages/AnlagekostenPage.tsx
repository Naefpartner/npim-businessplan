import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useLocation, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Loader2, AlertCircle, ChevronDown, ChevronRight, Coins, Calculator, Plus, Trash2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useAuth } from '@/contexts/AuthContext'
import { useGsfAllocation } from '@/hooks/useGsfAllocation'
import { useBkpKosten, type BkpPatch, type BkpScope } from '@/hooks/useBkpKosten'
import { useBkpCustomPositions } from '@/hooks/useBkpCustomPositions'
import { posSortKey } from '@/hooks/useAnlagekosten'
import { KostenMethodeKacheln } from '@/components/projects/KostenMethodeKacheln'
import { KeeValueSection } from '@/components/projects/KeeValueSection'
import { BenchmarkKostenSection } from '@/components/projects/BenchmarkKostenSection'
import { VariantDataProvider, useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { fetchAnlagekostenVergleich, type VergleichWert } from '@/lib/anlagekostenVergleich'
import { Info } from 'lucide-react'
import {
  HAUPTGRUPPEN, BKP_POSITIONEN,
  type BkpPosition, type Status, type BerechnungsTyp,
} from '@/lib/bkpKatalog'
import { type BkpErgebnis } from '@/lib/bkpBerechnung'
import { gsfBlockShare, type TypFor } from '@/lib/bkpBlocks'
import { EIGENTUMSART_COLOR, TOTAL_COLOR } from '@/lib/kategorieFarben'
import { cn, formatCurrency, formatNumber } from '@/lib/utils'
import {
  eigentumsartForBuilding, EIGENTUMSART_LABEL,
  type Eigentumsart, type PauschalPosten,
  type CalcMethod, type BaseRef,
} from '@/types'

// Zahl mit de-CH Tausendertrennzeichen für die Eingabe-Anzeige (unfokussiert).
function formatInputDisplay(n: number): string {
  if (!Number.isFinite(n)) return ''
  const [intPart, decPart] = String(n).split('.')
  const sign = intPart.startsWith('-') ? '-' : ''
  const digits = sign ? intPart.slice(1) : intPart
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, "'")
  return decPart != null ? `${sign}${grouped}.${decPart}` : `${sign}${grouped}`
}

const STATUS_LABEL: Record<Status, string> = {
  beruecksichtigt:        'Berücksichtigt',
  nicht_beruecksichtigt:  'Nicht berücksichtigt',
  nicht_relevant:         'Nicht relevant',
}

const EMPTY_SET: Set<string> = new Set()
const EMPTY_ERTRAG: Record<string, number> = {}

// GSF-Aufteilungs-Steuerung für die 010-Zeile in den Etappen-Tabs.
interface GsfRow {
  etappeId: string
  eig: Eigentumsart
  gsfTotal: number
  defaultShare: number
  gsfAlloc: ReturnType<typeof useGsfAllocation>
}

// ── Ansicht merken: Auf-/Zuklapp-Zustand je Block (sessionStorage) ────────────
// Damit „Zurück zu den Anlagekosten" wieder dieselbe Ansicht zeigt (gleiche
// Hauptgruppen aufgeklappt), überlebt der collapsed-Zustand die Navigation.
function readStored(key: string | null): boolean | null {
  if (!key || typeof sessionStorage === 'undefined') return null
  const v = sessionStorage.getItem(key)
  return v === '1' ? true : v === '0' ? false : null
}
function usePersistedCollapse(
  key: string | null,
  initial: boolean,
  signal: { collapsed: boolean; tick: number },
) {
  const [collapsed, setRaw] = useState<boolean>(() => readStored(key) ?? initial)
  const setCollapsed = useCallback((u: boolean | ((c: boolean) => boolean)) => {
    setRaw((c) => {
      const next = typeof u === 'function' ? u(c) : u
      if (key && typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, next ? '1' : '0')
      return next
    })
  }, [key])
  // Globales Auf-/Zuklappen (Signal) hat weiterhin Vorrang.
  useEffect(() => { if (signal.tick > 0) setCollapsed(signal.collapsed) }, [signal.tick]) // eslint-disable-line react-hooks/exhaustive-deps
  return [collapsed, setCollapsed] as const
}

export function AnlagekostenSection({
  projectId, variantId, defaultExpanded = false,
}: {
  projectId: string
  variantId?: string
  defaultExpanded?: boolean
}) {
  const projektId = projectId
  // Prefix für die Ansichts-Persistenz (variantenspezifisch).
  const viewKey = variantId ? `ak:${variantId}` : null
  const { canWrite } = useAuth()
  const location = useLocation()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const parzellenUrl = projektId
    ? `/projekte/${projektId}/parzellen?return=${encodeURIComponent(location.pathname)}`
    : undefined

  const [activeTab, setActiveTab] = useState<string>(
    () => (viewKey && typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(`${viewKey}:tab`) : null) || 'konsolidiert',
  )
  // Signal zum globalen Auf-/Zuklappen aller Hauptgruppen.
  const [collapseAll, setCollapseAll] = useState<{ collapsed: boolean; tick: number }>({ collapsed: false, tick: 0 })

  const {
    loading, mwstSatz, setGlobalMwstSatz,
    buildings, etappen, presentEig, gsfTotal, totalVmf,
    positionsByEig, typForByEig,
    blockErgebnisse, konsolidiert,
    aggregateFlags, hasOhneEtappe, totalAllocatedGsf, gsfMismatch,
    getDetail, defaultShare,
    bkpKosten, custom, gsfAlloc, ertragProNutzungByEig,
    kostenMethode, setKostenMethode,
  } = useAnlagekostenShared()

  const tabs: { key: string; label: string }[] = [
    { key: 'konsolidiert', label: 'Konsolidiert' },
    ...etappen.map((e) => ({ key: e.id, label: e.name })),
  ]
  const isKons = activeTab === 'konsolidiert'
  // Aktiven Tab merken; ungültigen (gelöschte Etappe) auf Konsolidiert zurücksetzen.
  useEffect(() => {
    if (viewKey && typeof sessionStorage !== 'undefined') sessionStorage.setItem(`${viewKey}:tab`, activeTab)
  }, [activeTab, viewKey])
  useEffect(() => {
    if (!loading && activeTab !== 'konsolidiert' && !etappen.some((e) => e.id === activeTab)) setActiveTab('konsolidiert')
  }, [loading, etappen, activeTab])

  // Gesamtprojekt: konsolidierte Kosten über ALLE Eigentumsarten zusammengefasst.
  const gesamt = useMemo(() => {
    const hgNetto: Record<number, number> = {}
    const hgMwst: Record<number, number> = {}
    for (let c = 0; c <= 9; c++) { hgNetto[c] = 0; hgMwst[c] = 0 }
    const posNetto: Record<string, number> = {}
    const posMwst: Record<string, number> = {}
    const posBrutto: Record<string, number> = {}
    let totalNetto = 0, totalMwst = 0, totalBrutto = 0
    for (const eig of presentEig) {
      const erg = konsolidiert.get(eig)?.ergebnis
      if (!erg) continue
      for (let c = 0; c <= 9; c++) {
        hgNetto[c] += erg.hauptgruppenSummenNetto[c as keyof typeof erg.hauptgruppenSummenNetto] ?? 0
        hgMwst[c]  += erg.hauptgruppenSummenMwst[c as keyof typeof erg.hauptgruppenSummenMwst] ?? 0
      }
      totalNetto += erg.totalNetto; totalMwst += erg.totalMwst; totalBrutto += erg.totalBrutto
      for (const code of Object.keys(erg.positionen)) {
        const p = erg.positionen[code]
        posNetto[code]  = (posNetto[code]  ?? 0) + (p.betragNetto  ?? 0)
        posMwst[code]   = (posMwst[code]   ?? 0) + (p.mwstBetrag   ?? 0)
        posBrutto[code] = (posBrutto[code] ?? 0) + (p.betragBrutto ?? 0)
      }
    }
    return { hgNetto, hgMwst, posNetto, posMwst, posBrutto, totalNetto, totalMwst, totalBrutto }
  }, [presentEig, konsolidiert])

  // Vereinigte Positionsliste über alle Eigentumsarten (für die Beschriftung).
  const gesamtPositions = useMemo(() => {
    const map = new Map<string, BkpPosition>()
    for (const eig of presentEig) {
      for (const p of (positionsByEig.get(eig) ?? BKP_POSITIONEN)) if (!map.has(p.code)) map.set(p.code, p)
    }
    return [...map.values()].sort((a, b) => a.hauptgruppe - b.hauptgruppe || posSortKey(a) - posSortKey(b))
  }, [presentEig, positionsByEig])

  // Im aktiven Etappen-Tab vorhandene Eigentumsarten.
  const eigInTab = isKons
    ? presentEig
    : presentEig.filter((eig) =>
        buildings.some((b) => b.etappe_id === activeTab && eigentumsartForBuilding(b.use_type) === eig))

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 bg-[#B98C74] px-5 py-3 text-sm font-semibold text-slate-900 transition hover:brightness-95"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-slate-700" /> : <ChevronRight className="h-4 w-4 text-slate-700" />}
        <Coins className="h-4 w-4 text-slate-700" />
        <span>Anlagekosten</span>
      </button>

      {expanded && (loading ? (
        <div className="flex min-h-[20vh] items-center justify-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Wird geladen…
        </div>
      ) : (
        <div className="space-y-6 p-5">
      {/* Erfassungsmethode — nur variantenbezogen wählbar. Ohne Variante
          (Projektsicht) bleibt es beim Detailkatalog. */}
      {variantId && (
        <KostenMethodeKacheln methode={kostenMethode} onChange={setKostenMethode} disabled={!canWrite} />
      )}

      {/* Globale Parameter */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
          <h2 className="text-sm font-medium text-slate-700">Globale Parameter</h2>
          <div className="flex items-baseline gap-2 text-sm">
            <label className="text-xs text-slate-500">MwSt global:</label>
            <ProzentEingabe value={mwstSatz} disabled={!canWrite} onCommit={(v) => v != null && setGlobalMwstSatz(v)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Stat label="Grundstück (GSF)" value={`${formatNumber(gsfTotal)} m²`} linkTo={parzellenUrl} linkTitle="Parzellen erfassen / bearbeiten" />
          <Stat label="VMF total" value={`${formatNumber(totalVmf)} m²`} />
          <Stat label="Etappen" value={String(etappen.length)} />
          <Stat label="Eigentumsarten" value={presentEig.map((e) => EIGENTUMSART_LABEL[e]).join(' · ')} />
        </div>
      </section>

      {variantId && kostenMethode === 'benchmark' && <BenchmarkKostenSection variantId={variantId} />}
      {variantId && kostenMethode === 'keevalue' && (
        <KeeValueSection projectId={projektId} variantId={variantId} />
      )}

      {(!variantId || kostenMethode === 'detail') && (<>
      {hasOhneEtappe && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Es gibt Gebäude ohne Etappen-Zuordnung — diese fliessen nicht in die Anlagekosten ein. Bitte in Mengen und Erträge einer Etappe zuordnen.</span>
        </div>
      )}

      {bkpKosten.error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{bkpKosten.error}</span>
        </div>
      )}

      {gsfMismatch && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Grundstücks-Aufteilung unvollständig: zugeteilt {formatNumber(totalAllocatedGsf)} m² von {formatNumber(gsfTotal)} m²
            (Δ {formatNumber(gsfTotal - totalAllocatedGsf)} m²). In den Etappen-Tabs anpassen.
          </span>
        </div>
      )}

      {/* Tab-Leiste */}
      <div className="flex flex-wrap items-end justify-between gap-1 border-b border-slate-200">
        <div className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
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
        <button
          type="button"
          onClick={() => setCollapseAll((s) => ({ collapsed: !s.collapsed, tick: s.tick + 1 }))}
          className="mb-1 inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50"
        >
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', collapseAll.collapsed && '-rotate-90')} />
          {collapseAll.collapsed ? 'Alle ausklappen' : 'Alle einklappen'}
        </button>
      </div>

      {eigInTab.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
          Keine Gebäude in {isKons ? 'dieser Variante' : 'dieser Etappe'}.
        </div>
      ) : (
        <div className="space-y-8">
          {/* Gesamtprojekt (alle Eigentumsarten) — klappbar, oberhalb der Eigentumsarten. */}
          {isKons && <GesamtprojektBlock gesamt={gesamt} positions={gesamtPositions} collapseSignal={collapseAll} viewKey={viewKey} />}
          {eigInTab.map((eig) => {
            const ergebnis = isKons
              ? konsolidiert.get(eig)?.ergebnis
              : blockErgebnisse.get(`${activeTab}::${eig}`)
            if (!ergebnis) return null
            return (
              <EigentumsartBlock
                key={eig}
                eig={eig}
                ergebnis={ergebnis}
                aggregateFlags={aggregateFlags.get(eig) ?? EMPTY_SET}
                scope={{ etappeId: isKons ? null : activeTab, eigentumsart: eig }}
                canWrite={canWrite}
                onUpsert={bkpKosten.upsert}
                getDetail={getDetail}
                projektId={projektId}
                mwstSatz={mwstSatz}
                isKons={isKons}
                etappeId={isKons ? null : activeTab}
                collapseSignal={collapseAll}
                viewKey={viewKey}
                // GSF-Allokation (nur Etappen-Tabs)
                gsfTotal={gsfTotal}
                gsfAlloc={gsfAlloc}
                defaultShare={isKons ? 0 : defaultShare(activeTab, eig)}
                // Generische Methode + eigene Zeilen
                positions={positionsByEig.get(eig) ?? BKP_POSITIONEN}
                typFor={typForByEig.get(eig)!}
                rows={bkpKosten.rows}
                custom={custom}
                ertragProNutzung={ertragProNutzungByEig.get(eig) ?? EMPTY_ERTRAG}
              />
            )
          })}
        </div>
      )}
      </>)}
        </div>
      ))}
    </section>
  )
}

// Routen-Wrapper (eigene Seite /anlagekosten) — rendert die Section ausgeklappt.
export function AnlagekostenPage() {
  const { projektId, id } = useParams<{ projektId: string; id: string }>()
  const [searchParams] = useSearchParams()
  const focus = searchParams.get('focus')
  // Beim Zurückkommen (z. B. vom Honorarrechner) die Zielposition (690a/690b)
  // in den sichtbaren Bereich scrollen, sobald sie im DOM ist (Blöcke sind via
  // sessionStorage bereits im gleichen Zustand aufgeklappt).
  useEffect(() => {
    if (!focus) return
    let tries = 0
    const iv = setInterval(() => {
      const el = document.getElementById(`ak-pos-${focus}`)
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); clearInterval(iv) }
      else if (++tries > 30) clearInterval(iv)
    }, 150)
    return () => clearInterval(iv)
  }, [focus])
  return (
    <div className="space-y-6">
      <Link to={`/projekte/${projektId}/varianten/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" /> Zurück zur Variante
      </Link>
      <VariantDataProvider projectId={projektId} variantId={id!}>
        <AnlagekostenSection projectId={projektId!} variantId={id} defaultExpanded />
      </VariantDataProvider>
    </div>
  )
}

// =============================================================================
// Ein vollständiger Anlagekosten-Block für eine Eigentumsart
// =============================================================================

function EigentumsartBlock({
  eig, ergebnis, aggregateFlags, scope, canWrite, onUpsert, getDetail, projektId,
  mwstSatz, isKons, etappeId, collapseSignal, viewKey,
  gsfTotal, gsfAlloc, defaultShare, positions, typFor, rows, custom, ertragProNutzung,
}: {
  eig: Eigentumsart
  ergebnis: BkpErgebnis
  aggregateFlags: Set<string>
  scope: BkpScope
  canWrite: boolean
  onUpsert: ReturnType<typeof useBkpKosten>['upsert']
  getDetail: (code: string, scope: BkpScope) => PauschalPosten[] | null
  projektId: string | undefined
  mwstSatz: number
  collapseSignal: { collapsed: boolean; tick: number }
  viewKey: string | null
  isKons: boolean
  etappeId: string | null
  gsfTotal: number
  gsfAlloc: ReturnType<typeof useGsfAllocation>
  defaultShare: number
  positions: BkpPosition[]
  typFor: TypFor
  rows: ReturnType<typeof useBkpKosten>['rows']
  custom: ReturnType<typeof useBkpCustomPositions>
  ertragProNutzung: Record<string, number>
}) {
  const scopeKey = isKons ? 'kons' : (etappeId ?? 'x')
  const [collapsed, setCollapsed] = usePersistedCollapse(
    viewKey ? `${viewKey}:eig:${scopeKey}:${eig}` : null, true, collapseSignal, // Eigentumsart-Block startet eingeklappt
  )
  return (
    <div className="space-y-4">
      {/* Gleiche Spaltenbreiten wie die Tabellen darunter, damit die Totale
          exakt über den Spalten exkl./MwSt/inkl. stehen. */}
      <div className="overflow-x-auto">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-end rounded-lg border border-transparent text-left text-slate-900"
        style={{ minWidth: 1100, backgroundColor: EIGENTUMSART_COLOR[eig] }}
      >
        <h2 className="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-2.5 text-sm font-semibold">
          {collapsed ? <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" /> : <ChevronDown className="h-4 w-4 shrink-0 text-slate-600" />}
          {EIGENTUMSART_LABEL[eig]}
        </h2>
        <div className="w-44 shrink-0 px-3 py-2.5 text-right tabular-nums">
          <div className="pr-2 text-[9px] uppercase leading-4 tracking-wider text-slate-600">exkl. MWST</div>
          <div className="pr-2 text-sm font-bold leading-5">{formatNumber(ergebnis.totalNetto)}</div>
        </div>
        <div className="w-32 shrink-0 px-3 py-2.5 text-right tabular-nums">
          <div className="pr-2 text-[9px] uppercase leading-4 tracking-wider text-slate-600">MwSt</div>
          <div className="pr-2 text-sm leading-5 text-slate-700">{formatNumber(ergebnis.totalMwst)}</div>
        </div>
        <div className="w-40 shrink-0 px-3 py-2.5 text-right tabular-nums">
          <div className="pr-2 text-[9px] uppercase leading-4 tracking-wider text-slate-600">inkl. MWST</div>
          <div className="pr-2 text-sm font-bold leading-5">{formatNumber(ergebnis.totalBrutto)}</div>
        </div>
        <div className="w-40 shrink-0" />
      </button>
      </div>

      {!collapsed && (<>
      {HAUPTGRUPPEN.map((hg) => {
        return (
          <HauptgruppeSection
            key={hg.code}
            hauptgruppeCode={hg.code}
            label={hg.label}
            positionen={positions.filter((p) => p.hauptgruppe === hg.code)}
            ergebnis={ergebnis}
            viewKey={viewKey}
            summeNetto={ergebnis.hauptgruppenSummenNetto[hg.code]}
            summeMwst={ergebnis.hauptgruppenSummenMwst[hg.code]}
            globalMwstSatz={mwstSatz}
            canWrite={canWrite}
            onUpsert={onUpsert}
            getDetail={getDetail}
            scope={scope}
            aggregateFlags={aggregateFlags}
            isKons={isKons}
            projektId={projektId}
            collapseSignal={collapseSignal}
            typFor={typFor}
            allPositions={positions}
            rows={rows}
            eig={eig}
            onAddRow={() => custom.create(hg.code, eig)}
            onRenameRow={custom.rename}
            onSetCodeRow={custom.setCode}
            onDeleteRow={custom.remove}
            customIds={new Set(custom.rows.map((c) => c.id))}
            ertragProNutzung={ertragProNutzung}
            gsfRow={hg.code === 0 && !isKons && etappeId
              ? { etappeId, eig, gsfTotal, defaultShare, gsfAlloc }
              : undefined}
          />
        )
      })}

      {/* Gesamttotal — gleiche Spaltenausrichtung wie der Eigentumsart-Header. */}
      <div className="overflow-x-auto">
      <div className="flex items-end rounded-lg border border-transparent text-slate-900" style={{ minWidth: 1100, backgroundColor: EIGENTUMSART_COLOR[eig] }}>
        <h2 className="min-w-0 flex-1 px-3 py-3 text-sm font-semibold uppercase tracking-wider">Gesamttotal</h2>
        <div className="w-44 shrink-0 px-3 py-3 text-right tabular-nums">
          <div className="pr-2 text-[9px] uppercase leading-4 tracking-wider text-slate-600">exkl. MWST</div>
          <div className="pr-2 text-base font-bold leading-6">{formatNumber(ergebnis.totalNetto)}</div>
        </div>
        <div className="w-32 shrink-0 px-3 py-3 text-right tabular-nums">
          <div className="pr-2 text-[9px] uppercase leading-4 tracking-wider text-slate-600">MwSt</div>
          <div className="pr-2 text-base leading-6 text-slate-700">{formatNumber(ergebnis.totalMwst)}</div>
        </div>
        <div className="w-40 shrink-0 px-3 py-3 text-right tabular-nums">
          <div className="pr-2 text-[9px] uppercase leading-4 tracking-wider text-slate-600">inkl. MWST</div>
          <div className="pr-2 text-base font-bold leading-6">{formatNumber(ergebnis.totalBrutto)}</div>
        </div>
        <div className="w-40 shrink-0" />
      </div>
      </div>
      </>)}
    </div>
  )
}

// =============================================================================
// Gesamtprojekt — konsolidierte Kosten über alle Eigentumsarten (read-only)
// =============================================================================

interface GesamtData {
  hgNetto: Record<number, number>
  hgMwst: Record<number, number>
  posNetto: Record<string, number>
  posMwst: Record<string, number>
  posBrutto: Record<string, number>
  totalNetto: number
  totalMwst: number
  totalBrutto: number
}

function GesamtprojektBlock({ gesamt, positions, collapseSignal, viewKey }: {
  gesamt: GesamtData
  positions: BkpPosition[]
  collapseSignal: { collapsed: boolean; tick: number }
  viewKey: string | null
}) {
  const [collapsed, setCollapsed] = usePersistedCollapse(viewKey ? `${viewKey}:gesamt` : null, true, collapseSignal) // Übersicht startet eingeklappt
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="overflow-x-auto">
      {/* Kopf: Gesamtprojekt-Total (klappbar) — Spalten wie bei den Eigentumsarten. */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-end text-left text-white"
        style={{ minWidth: 1100, backgroundColor: TOTAL_COLOR }}
      >
        <h2 className="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-2.5 text-sm font-semibold">
          {collapsed ? <ChevronRight className="h-4 w-4 shrink-0 text-white/70" /> : <ChevronDown className="h-4 w-4 shrink-0 text-white/70" />}
          Gesamtprojekt · alle Eigentumsarten
        </h2>
        <div className="w-44 shrink-0 px-3 py-2.5 text-right tabular-nums">
          <div className="pr-2 text-[9px] uppercase leading-4 tracking-wider text-slate-300">exkl. MWST</div>
          <div className="pr-2 text-sm font-bold leading-5">{formatNumber(gesamt.totalNetto)}</div>
        </div>
        <div className="w-32 shrink-0 px-3 py-2.5 text-right tabular-nums">
          <div className="pr-2 text-[9px] uppercase leading-4 tracking-wider text-slate-300">MwSt</div>
          <div className="pr-2 text-sm leading-5 text-slate-200">{formatNumber(gesamt.totalMwst)}</div>
        </div>
        <div className="w-40 shrink-0 px-3 py-2.5 text-right tabular-nums">
          <div className="pr-2 text-[9px] uppercase leading-4 tracking-wider text-slate-300">inkl. MWST</div>
          <div className="pr-2 text-sm font-bold leading-5">{formatNumber(gesamt.totalBrutto)}</div>
        </div>
        <div className="w-40 shrink-0" />
      </button>

      {!collapsed && (
      <table className="w-full table-fixed text-sm" style={{ minWidth: 1100 }}>
        <colgroup>
          <col style={{ width: '3rem' }} />{/* Pos. */}
          <col />{/* Bezeichnung (inkl. Methode/Menge/EH-Bereich) */}
          <col style={{ width: '11rem' }} />{/* exkl. */}
          <col style={{ width: '8rem' }} />{/* MwSt */}
          <col style={{ width: '10rem' }} />{/* inkl. */}
          <col style={{ width: '10rem' }} />{/* Status (leer) */}
        </colgroup>
        {HAUPTGRUPPEN.map((hg) => {
          const hgPos = positions.filter((p) => p.hauptgruppe === hg.code && (gesamt.posBrutto[p.code] ?? 0) !== 0)
          const sN = gesamt.hgNetto[hg.code] ?? 0
          const sM = gesamt.hgMwst[hg.code] ?? 0
          if (sN === 0 && sM === 0 && hgPos.length === 0) return null
          return (
            <tbody key={hg.code}>
              <tr className="border-t border-slate-200 bg-slate-100">
                <td colSpan={2} className="px-3 py-2">
                  <h3 className="flex items-center text-sm font-semibold text-slate-900">
                    <span className="mr-2 inline-flex h-6 w-6 items-center justify-center text-sm font-bold text-slate-900">{hg.code}</span>
                    {hg.label}
                  </h3>
                </td>
                <td className="px-3 py-2 pr-5 text-right font-semibold tabular-nums text-slate-900">{formatNumber(sN)}</td>
                <td className="px-3 py-2 pr-5 text-right tabular-nums text-slate-500">{formatNumber(sM)}</td>
                <td className="px-3 py-2 pr-5 text-right font-semibold tabular-nums text-slate-900">{formatNumber(sN + sM)}</td>
                <td />
              </tr>
              {hgPos.map((p) => (
                <tr key={p.code} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 align-top text-xs tabular-nums text-slate-500">{p.displayCode ?? p.code}</td>
                  <td className="px-3 py-1.5 text-slate-700">{p.label}</td>
                  <td className="px-3 py-1.5 pr-5 text-right tabular-nums text-slate-900">{formatNumber(gesamt.posNetto[p.code] ?? 0)}</td>
                  <td className="px-3 py-1.5 pr-5 text-right tabular-nums text-slate-500">{formatNumber(gesamt.posMwst[p.code] ?? 0)}</td>
                  <td className="px-3 py-1.5 pr-5 text-right tabular-nums text-slate-900">{formatNumber(gesamt.posBrutto[p.code] ?? 0)}</td>
                  <td />
                </tr>
              ))}
            </tbody>
          )
        })}
        <tfoot>
          <tr className="bg-[#8B6956] text-white">
            <td colSpan={2} className="px-3 py-3 text-sm font-semibold uppercase tracking-wider">Gesamttotal</td>
            <td className="px-3 py-3 pr-5 text-right text-base font-bold tabular-nums">{formatNumber(gesamt.totalNetto)}</td>
            <td className="px-3 py-3 pr-5 text-right text-base tabular-nums text-slate-300">{formatNumber(gesamt.totalMwst)}</td>
            <td className="px-3 py-3 pr-5 text-right text-base font-bold tabular-nums">{formatNumber(gesamt.totalBrutto)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      )}
      </div>
    </div>
  )
}

// =============================================================================
// GSF-Aufteilung (pro Etappe × Eigentumsart)
// =============================================================================

// GSF-Aufteilung direkt auf der 010-Zeile (Etappen-Tab): % eingeben → m² wird
// berechnet; m² eingeben → wird direkt verwendet. Ohne Eingabe: VMF/VKF-Default.
function GsfMengeControl({ gsfRow, canWrite }: { gsfRow: GsfRow; canWrite: boolean }) {
  const { etappeId, eig, gsfTotal, defaultShare, gsfAlloc } = gsfRow
  const alloc = gsfAlloc.get(etappeId, eig)
  const share = gsfBlockShare(alloc, gsfTotal, defaultShare)
  const m2 = gsfTotal * share
  const istDefault = !alloc || alloc.value == null

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="flex items-center justify-end gap-1">
        <NumInput
          value={share}
          disabled={!canWrite}
          isProzent
          onCommit={(v) => gsfAlloc.upsert(etappeId, eig, { mode: 'pct', value: v })}
        />
        <span className="text-[10px] text-slate-400 w-6 text-left">%</span>
      </div>
      <div className="flex items-center justify-end gap-1">
        <NumInput
          value={m2 > 0 ? Math.round(m2) : null}
          disabled={!canWrite}
          onCommit={(v) => gsfAlloc.upsert(etappeId, eig, { mode: 'm2', value: v })}
        />
        <span className="text-[10px] text-slate-400 w-6 text-left">m²</span>
      </div>
      {istDefault && (
        <span className="text-[9px] text-slate-400">Default {eig === 'verkaufsobjekt' ? 'VKF' : 'VMF'}</span>
      )}
    </div>
  )
}

function Stat({
  label, value, linkTo, linkTitle,
}: {
  label: string
  value: string
  linkTo?: string
  linkTitle?: string
}) {
  if (linkTo) {
    return (
      <Link to={linkTo} title={linkTitle} className="group block rounded-md p-1 -m-1 hover:bg-slate-50">
        <div className="text-xs text-slate-500 group-hover:text-slate-700">{label}</div>
        <div className="mt-0.5 text-base font-semibold tabular-nums text-slate-900 group-hover:text-[#8B6956] group-hover:underline">{value}</div>
      </Link>
    )
  }
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-base font-semibold text-slate-900 tabular-nums">{value}</div>
    </div>
  )
}

function HauptgruppeSection({
  hauptgruppeCode, label, positionen, ergebnis, summeNetto, summeMwst, globalMwstSatz, canWrite, onUpsert, getDetail, scope, aggregateFlags, isKons, projektId, gsfRow, collapseSignal, viewKey,
  typFor, allPositions, rows, eig, onAddRow, onRenameRow, onSetCodeRow, onDeleteRow, customIds, ertragProNutzung,
}: {
  hauptgruppeCode: number
  label: string
  positionen: BkpPosition[]
  ergebnis: BkpErgebnis
  summeNetto: number
  summeMwst: number
  globalMwstSatz: number
  canWrite: boolean
  onUpsert: ReturnType<typeof useBkpKosten>['upsert']
  getDetail: (code: string, scope: BkpScope) => PauschalPosten[] | null
  scope: BkpScope
  aggregateFlags: Set<string>
  isKons: boolean
  projektId: string | undefined
  gsfRow?: GsfRow
  collapseSignal: { collapsed: boolean; tick: number }
  viewKey: string | null
  typFor: TypFor
  allPositions: BkpPosition[]
  rows: ReturnType<typeof useBkpKosten>['rows']
  eig: Eigentumsart
  onAddRow: () => void
  onRenameRow: (id: string, label: string) => void
  onSetCodeRow: (id: string, code: string) => void
  onDeleteRow: (id: string) => void
  customIds: Set<string>
  ertragProNutzung: Record<string, number>
}) {
  const scopeKey = isKons ? 'kons' : (scope.etappeId ?? 'x')
  const [collapsed, setCollapsed] = usePersistedCollapse(
    viewKey ? `${viewKey}:hg:${scopeKey}:${eig}:${hauptgruppeCode}` : null, false, collapseSignal,
  )
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-sm" style={{ minWidth: 1100 }}>
          <colgroup>
            <col style={{ width: '3rem' }} />{/* Pos. */}
            <col />{/* Bezeichnung (Rest) */}
            <col style={{ width: '7.5rem' }} />{/* Methode */}
            <col style={{ width: '9rem' }} />{/* Menge */}
            <col style={{ width: '9rem' }} />{/* EH-Preis */}
            <col style={{ width: '11rem' }} />{/* exkl. MWST */}
            <col style={{ width: '8rem' }} />{/* MwSt */}
            <col style={{ width: '10rem' }} />{/* inkl. MWST */}
            <col style={{ width: '10rem' }} />{/* Status */}
          </colgroup>
          <thead>
            {/* Hauptgruppen-Kopfzeile: Totale direkt in den Spalten exkl./MwSt/inkl. */}
            <tr
              onClick={() => setCollapsed((c) => !c)}
              className="cursor-pointer border-b border-slate-200 bg-slate-50 transition hover:bg-slate-100"
            >
              <td colSpan={5} className="px-3 py-3">
                <h2 className="flex items-center text-sm font-semibold text-slate-900">
                  <ChevronDown className={cn('mr-1 h-4 w-4 shrink-0 self-center text-slate-400 transition-transform', collapsed && '-rotate-90')} />
                  <span className="mr-2 inline-flex h-6 w-6 items-center justify-center text-sm font-bold text-slate-900">{hauptgruppeCode}</span>
                  {label}
                </h2>
              </td>
              <td className="px-3 py-3 text-right align-bottom">
                <div className="pr-2 text-[9px] uppercase leading-4 tracking-wider text-slate-400">exkl. MWST</div>
                <div className="pr-2 text-sm font-semibold leading-5 tabular-nums text-slate-900">{formatNumber(summeNetto)}</div>
              </td>
              <td className="px-3 py-3 text-right align-bottom">
                <div className="pr-2 text-[9px] uppercase leading-4 tracking-wider text-slate-400">MwSt</div>
                <div className="pr-2 text-sm leading-5 tabular-nums text-slate-500">{formatNumber(summeMwst)}</div>
              </td>
              <td className="px-3 py-3 text-right align-bottom">
                <div className="pr-2 text-[9px] uppercase leading-4 tracking-wider text-slate-400">inkl. MWST</div>
                <div className="pr-2 text-sm font-semibold leading-5 tabular-nums text-slate-900">{formatNumber(summeNetto + summeMwst)}</div>
              </td>
              <td />
            </tr>
            {!collapsed && (
              <tr className="bg-white text-xs uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2 text-left font-medium w-14">Pos.</th>
                <th className="px-3 py-2 text-left font-medium">Bezeichnung</th>
                <th className="px-3 py-2 text-left font-medium w-32">Methode</th>
                <th className="px-3 py-2 text-right font-medium w-40">Menge</th>
                <th className="px-3 py-2 text-right font-medium w-40">EH-Preis</th>
                <th className="px-3 py-2 text-right font-medium w-44">exkl. MWST</th>
                <th className="px-3 py-2 text-center font-medium w-32">MwSt</th>
                <th className="px-3 py-2 text-right font-medium w-40">inkl. MWST</th>
                <th className="px-3 py-2 text-left font-medium w-36">Status</th>
              </tr>
            )}
          </thead>
          {!collapsed && (
            <tbody className="divide-y divide-slate-100">
              {positionen.map((pos) => (
                <PositionRow
                  key={pos.code}
                  pos={pos}
                  typ={typFor(pos.code)}
                  result={ergebnis.positionen[pos.code]}
                  ergebnis={ergebnis}
                  globalMwstSatz={globalMwstSatz}
                  canWrite={canWrite}
                  onUpsert={onUpsert}
                  getDetail={getDetail}
                  scope={scope}
                  flagOn={aggregateFlags.has(pos.code)}
                  isKons={isKons}
                  projektId={projektId}
                  gsfRow={gsfRow}
                  allPositions={allPositions}
                  rows={rows}
                  eig={eig}
                  isCustom={customIds.has(pos.code)}
                  onRenameRow={onRenameRow}
                  onSetCodeRow={onSetCodeRow}
                  onDeleteRow={onDeleteRow}
                  ertragProNutzung={ertragProNutzung}
                />
              ))}
            </tbody>
          )}
        </table>
        {!collapsed && canWrite && (
          <button
            type="button"
            onClick={onAddRow}
            className="m-3 inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-xs text-slate-500 transition hover:border-[#8B6956] hover:text-[#8B6956]"
          >
            <Plus className="h-3.5 w-3.5" /> Zeile hinzufügen
          </button>
        )}
      </div>
    </section>
  )
}

const METHOD_LABEL: Record<CalcMethod, string> = {
  standard:     'Standard',
  pauschal:     'Pauschal',
  einheit:      'Einheitspreis',
  prozent_von:  '% von …',
  promille_von: '‰ von …',
  honorarrechner: 'Honorarrechner',
  ertrag_nutzung: 'Mieterträge nach Nutzung',
}

// Die Methode „Honorarrechner" ist nur für die Honorar-Positionen 690a/690b sinnvoll.
const HONORAR_METHODE_CODES = new Set(['690a', '690b'])
// Die Nutzungs-Methode: Erstvermietung 710/720 rechnet über Mieterträge,
// Verkauf 730/740 über den Verkaufserlös der STWEG-Objekte (gleiche Engine).
const ERTRAG_METHODE_CODES = new Set(['710', '720'])
const VERKAUF_METHODE_CODES = new Set(['730', '740'])
const NUTZUNG_METHODE_CODES = new Set([...ERTRAG_METHODE_CODES, ...VERKAUF_METHODE_CODES])

function PositionRow({
  pos, typ, result, ergebnis, globalMwstSatz, canWrite, onUpsert, getDetail, scope, flagOn, isKons, projektId, gsfRow,
  allPositions, rows, eig, isCustom, onRenameRow, onSetCodeRow, onDeleteRow, ertragProNutzung,
}: {
  pos: BkpPosition
  typ: BerechnungsTyp
  result: BkpErgebnis['positionen'][string] | undefined
  ergebnis: BkpErgebnis
  globalMwstSatz: number
  canWrite: boolean
  onUpsert: ReturnType<typeof useBkpKosten>['upsert']
  getDetail: (code: string, scope: BkpScope) => PauschalPosten[] | null
  scope: BkpScope
  flagOn: boolean
  isKons: boolean
  projektId: string | undefined
  gsfRow?: GsfRow
  allPositions: BkpPosition[]
  rows: ReturnType<typeof useBkpKosten>['rows']
  eig: Eigentumsart
  isCustom: boolean
  onRenameRow: (id: string, label: string) => void
  onSetCodeRow: (id: string, code: string) => void
  onDeleteRow: (id: string) => void
  ertragProNutzung: Record<string, number>
}) {
  const [rechnerOffen, setRechnerOffen] = useState(false)
  const [basisOffen, setBasisOffen] = useState(false)
  const [nutzungOffen, setNutzungOffen] = useState(false)
  const [vergleichOffen, setVergleichOffen] = useState(false)
  // Varianten-ID (Route :id) für den Deep-Link zum Honorarrechner.
  const { id: variantIdParam } = useParams<{ id: string }>()
  // Flag ON  = Etappen führend → Konsolidiert grau/aggregiert, Etappe editierbar.
  // Flag OFF = Konsolidiert führend (verteilt) → Konsolidiert editierbar, Etappe grau.
  const aggregatMode = isKons ? flagOn : !flagOn
  const status   = result?.status ?? pos.defaultStatus
  const kennwert = result?.kennwert ?? null
  const menge    = result?.menge ?? null
  const betragNetto    = result?.betragNetto ?? null
  const betragOverride = result?.betragOverride ?? null
  // Pauschal-Modus wird neu von der Methode bestimmt (typ.kind === 'pauschal').
  const istPauschalMode = typ.kind === 'pauschal'
  const mwstAnwenden = result?.mwstAnwenden ?? pos.mwst
  const mwstSatz     = result?.mwstSatz ?? globalMwstSatz
  const mwstBetrag   = result?.mwstBetrag ?? 0
  const betragBrutto = result?.betragBrutto ?? 0
  const kennwertGemischt = result?.kennwertGemischt ?? false

  const edit = canWrite && !aggregatMode

  const mengeBezugUeberOverride =
    typ.kind === 'chf_pro_m3_abbruch' || typ.kind === 'finanzierung' ||
    typ.kind === 'auf_mehrwert' || typ.kind === 'manuell_menge_einheit'
  const istKennwertProzent =
    typ.kind === 'prozent_von_hauptgruppen' || typ.kind === 'finanzierung' ||
    typ.kind === 'auf_mehrwert' || typ.kind === 'prozent_von_refs' ||
    typ.kind === 'prozent_von_ertrag'
  // Lineare %-Positionen (Betrag = % × Basis): Betrag editierbar → Satz zurückrechnen.
  const istRueckrechenbar = typ.kind === 'prozent_von_hauptgruppen' || typ.kind === 'prozent_von_refs' ||
    typ.kind === 'prozent_von_ertrag'

  const mengeEinheit  = result?.mengeEinheit ?? ''
  const preisEinheit  = result?.preisEinheit ?? ''
  const useSatzOverride = result?.mwstSatz !== globalMwstSatz

  // Methode + Basis liegen auf der Konsolidiert-Row und gelten variantenweit.
  const methodScope: BkpScope = { etappeId: null, eigentumsart: eig }
  const consRow = rows.find((r) => r.etappe_id === null && r.eigentumsart === eig && r.position_code === pos.code)
  const method: CalcMethod = consRow?.calc_method ?? 'standard'
  const base: BaseRef[] = consRow?.calc_base ?? []
  const istRefMethode = method === 'prozent_von' || method === 'promille_von'
  // Honorarrechner-Methode (nur 690a/690b): Kennwert kommt aus dem Honorarrechner, read-only.
  const istHonorarMethode = method === 'honorarrechner'
  // Nutzungs-Methode (710/720 Miete, 730/740 Verkauf): Betrag = Σ(Nutzungs-Wert × %), kein Kennwert.
  const istErtragMethode = method === 'ertrag_nutzung'
  const istVerkaufPos = VERKAUF_METHODE_CODES.has(pos.code)
  // Finanzierung: Berechnungsgrundlage (Basis) frei wählbar (Default je Position).
  const finanz = typ.kind === 'finanzierung' ? typ : null
  // Refs als lesbare Liste (HG / Positions-Nummer).
  const refLabel = (refs: BaseRef[]) => refs.map((r) => r.kind === 'hauptgruppe'
    ? `HG ${r.ref}`
    : (allPositions.find((x) => x.code === r.ref)?.displayCode ?? r.ref)).join(', ')
  const gruppenLabel = finanz
    ? (finanz.gruppen.length === 1 ? `BKP ${finanz.gruppen[0]}` : `BKP ${Math.min(...finanz.gruppen)}–${Math.max(...finanz.gruppen)}`)
    : ''
  // Summe der Basis-Kosten (worauf die Finanzierung gerechnet wird).
  const finanzBasis = finanz
    ? (finanz.refs && finanz.refs.length > 0
        ? finanz.refs.reduce((s: number, r) => s + (r.kind === 'position'
            ? (ergebnis.positionen[r.ref]?.betragNetto ?? 0)
            : (ergebnis.hauptgruppenSummenNetto[Number(r.ref) as keyof typeof ergebnis.hauptgruppenSummenNetto] ?? 0)), 0)
        : finanz.gruppen.reduce((s: number, g) => s + (ergebnis.hauptgruppenSummenNetto[g] ?? 0), 0))
    : 0

  function onMethodChange(m: CalcMethod) {
    const patch: BkpPatch = { calc_method: m === 'standard' ? null : m }
    if (m === 'einheit') { patch.kennwert = 0; patch.bezugsmenge_override = 0 }
    onUpsert(pos.code, patch, methodScope)
    if ((m === 'prozent_von' || m === 'promille_von') && base.length === 0) setBasisOffen(true)
    if (m === 'ertrag_nutzung' && base.length === 0) setNutzungOffen(true)
  }

  return (
    <tr id={`ak-pos-${pos.code}`} className={cn(status !== 'beruecksichtigt' && 'opacity-50', aggregatMode && 'bg-slate-100', 'scroll-mt-20')}>
      <td className="px-3 py-2 align-top text-slate-500 tabular-nums text-xs leading-5">
        {isCustom ? (
          <input
            defaultValue={pos.displayCode ?? ''}
            disabled={!canWrite}
            placeholder="Nr."
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== (pos.displayCode ?? '')) onSetCodeRow(pos.code, v) }}
            className="block w-full bg-transparent p-0 text-xs tabular-nums leading-5 text-slate-600 outline-none transition placeholder:text-slate-400 focus:bg-white"
          />
        ) : typ.kind === 'chf_pro_m3_bkp2' ? '' : pos.code}
      </td>
      <td className="px-3 py-2 align-top">
        {isCustom ? (
          <div className="flex items-start gap-1">
            <input
              defaultValue={pos.label}
              disabled={!canWrite}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== pos.label) onRenameRow(pos.code, v) }}
              className="w-full bg-transparent p-0 text-sm leading-5 text-slate-900 outline-none transition focus:bg-white"
            />
            {canWrite && (
              <button type="button" onClick={() => { if (confirm('Zeile löschen?')) onDeleteRow(pos.code) }} className="-my-0.5 shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Zeile löschen">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-start gap-1.5">
              <div className="text-slate-900 text-sm leading-5">{pos.label}</div>
              <button
                type="button"
                onClick={() => setVergleichOffen(true)}
                title="Vergleichswerte aus anderen Projekten"
                className="mt-0.5 shrink-0 rounded p-0.5 text-slate-500 transition hover:bg-slate-100 hover:text-[#8B6956]"
              >
                <Search className="h-3.5 w-3.5" />
              </button>
            </div>
            {pos.hinweis && !istRefMethode && <div className="text-[11px] text-slate-400 mt-0.5">{pos.hinweis}</div>}
          </>
        )}
        {vergleichOffen && (
          <BkpVergleichDialog
            open={vergleichOffen}
            onClose={() => setVergleichOffen(false)}
            code={pos.code}
            label={`${typ.kind === 'chf_pro_m3_bkp2' ? '' : `${pos.code} · `}${pos.label}`}
            preisEinheit={preisEinheit}
            onApply={(patch) => { onUpsert(pos.code, patch, scope); setVergleichOffen(false) }}
          />
        )}
        {istRefMethode && (
          <div className="mt-0.5 text-[11px] text-slate-400">
            {base.length === 0
              ? <span className="text-amber-600">Basis wählen …</span>
              : <>Kennwert = {method === 'promille_von' ? '‰' : '%'} der Auswahl Pos. {refLabel(base)}</>}
          </div>
        )}
        {istHonorarMethode && (
          <div className="mt-0.5 text-[11px] text-slate-400">
            {kennwert && kennwert > 0
              ? <>Aus Honorarrechner · {pos.code === '690a' ? 'Phasen 31–41' : 'ab Phase 51'} (inkl. Nebenkosten)</>
              : <span className="text-amber-600">Honorarrechner dieser Variante öffnen</span>}
          </div>
        )}
        {istErtragMethode && (
          <div className="mt-0.5 text-[11px] text-slate-400">
            {base.filter((b) => b.kind === 'nutzung').length === 0
              ? <span className="text-amber-600">Nutzungen wählen …</span>
              : <>Basis: {istVerkaufPos ? 'Verkaufserlös' : 'Mieterträge'} der Nutzungen {base.filter((b) => b.kind === 'nutzung').map((b) => `${b.ref} ${b.prozent ?? 100} %`).join(', ')} ({istVerkaufPos ? 'Verkaufsobjekte STWEG' : 'Eigentumsart dieser Zeile'})</>}
          </div>
        )}
        {finanz && (
          <div className="mt-0.5 text-[11px] text-slate-400">
            {base.length > 0
              ? <>Basis: Pos. {refLabel(base)}</>
              : finanz.refs && finanz.refs.length > 0
                ? <>Basis: Pos. {refLabel(finanz.refs)} <span className="text-slate-300">(Standard)</span></>
                : <>Basis: {gruppenLabel} <span className="text-slate-300">(Standard)</span></>}
          </div>
        )}
        {isKons && (
          <label className="mt-1 inline-flex items-center gap-1 text-[10px] text-slate-500" title="Wert aus den Etappen aggregieren (statt von hier verteilen)">
            <input
              type="checkbox"
              checked={flagOn}
              disabled={!canWrite}
              onChange={(e) => onUpsert(pos.code, { aggregate_from_etappen: e.target.checked }, scope)}
              className="h-3 w-3"
            />
            aus Etappen
          </label>
        )}
      </td>
      {/* Methode */}
      <td className="px-3 py-2 align-top">
        {finanz ? (
          // Finanzierung: keine Methode — nur Berechnungsgrundlage (Basis) wählen.
          <button
            type="button"
            onClick={() => setBasisOffen(true)}
            disabled={!canWrite}
            className="w-full rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 transition hover:border-[#8B6956] hover:text-[#8B6956]"
            title="Berechnungsgrundlage (Basis) wählen"
          >
            Basis ({base.length})
          </button>
        ) : (
          <>
            <select
              value={method}
              disabled={!canWrite}
              onChange={(e) => onMethodChange(e.target.value as CalcMethod)}
              className="w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs"
            >
              {(Object.keys(METHOD_LABEL) as CalcMethod[])
                .filter((m) => m !== 'honorarrechner' || HONORAR_METHODE_CODES.has(pos.code))
                .filter((m) => m !== 'ertrag_nutzung' || NUTZUNG_METHODE_CODES.has(pos.code))
                .map((m) => (
                  <option key={m} value={m}>
                    {m === 'standard' ? `Standard`
                      : m === 'ertrag_nutzung' && istVerkaufPos ? 'Verkaufserlös nach Nutzung'
                      : METHOD_LABEL[m]}
                  </option>
                ))}
            </select>
            {istRefMethode && (
              <button
                type="button"
                onClick={() => setBasisOffen(true)}
                disabled={!canWrite}
                className="mt-1 w-full rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 transition hover:border-[#8B6956] hover:text-[#8B6956]"
                title="Basis-Positionen wählen"
              >
                Basis ({base.length})
              </button>
            )}
            {istErtragMethode && (
              <button
                type="button"
                onClick={() => setNutzungOffen(true)}
                disabled={!canWrite}
                className="mt-1 w-full rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 transition hover:border-[#8B6956] hover:text-[#8B6956]"
                title="Nutzungskategorien und deren Anteil (%) wählen"
              >
                Nutzungen ({base.filter((b) => b.kind === 'nutzung').length})
              </button>
            )}
            {HONORAR_METHODE_CODES.has(pos.code) && projektId && (
              <Link
                to={`/projekte/${projektId}?tab=honorar${variantIdParam ? `&variant=${variantIdParam}&return=${encodeURIComponent(`/projekte/${projektId}/varianten/${variantIdParam}/anlagekosten?focus=${pos.code}`)}` : ''}`}
                title="Zur Honorarberechnung dieser Variante"
                className="mt-1 flex w-full items-center justify-center gap-1 rounded border border-[#B98C74] bg-[#F2D3C2]/40 px-1.5 py-0.5 text-[10px] font-medium text-[#5A3F2E] transition hover:bg-[#F2D3C2]/70"
              >
                <Calculator className="h-3 w-3" /> Honorarrechner
              </Link>
            )}
          </>
        )}
        {basisOffen && (
          <BasisPicker
            open={basisOffen}
            onClose={() => setBasisOffen(false)}
            label={`${isCustom ? pos.label : `${pos.code} · ${pos.label}`}`}
            allPositions={allPositions}
            current={base}
            getRefNetto={(ref) => ref.kind === 'position'
              ? (ergebnis.positionen[ref.ref]?.betragNetto ?? 0)
              : (ergebnis.hauptgruppenSummenNetto[Number(ref.ref) as keyof typeof ergebnis.hauptgruppenSummenNetto] ?? 0)}
            onApply={(refs) => { onUpsert(pos.code, { calc_base: refs }, methodScope); setBasisOffen(false) }}
          />
        )}
        {nutzungOffen && (
          <NutzungErtragPicker
            open={nutzungOffen}
            onClose={() => setNutzungOffen(false)}
            label={`${pos.code} · ${pos.label}`}
            variant={istVerkaufPos ? 'verkauf' : 'miete'}
            ertragProNutzung={ertragProNutzung}
            current={base}
            onApply={(refs) => { onUpsert(pos.code, { calc_base: refs }, methodScope); setNutzungOffen(false) }}
          />
        )}
      </td>
      {/* Menge */}
      <td className="px-3 py-2 align-top">
        {istPauschalMode ? (
          <div className="flex items-baseline justify-end gap-1"><span className="text-slate-300 tabular-nums text-sm">—</span><span className="w-12" /></div>
        ) : gsfRow && typ.kind === 'chf_pro_m2_gsf' ? (
          <GsfMengeControl gsfRow={gsfRow} canWrite={canWrite} />
        ) : typ.kind === 'finanzierung' && !aggregatMode ? (
          // Finanzierung: Dauer (Monate) + Anteil (%) — Zinssatz steht im EH-Preis.
          <div className="flex flex-col items-end gap-0.5">
            <div className="flex items-center justify-end gap-1">
              <NumInput value={menge} disabled={!edit} onCommit={(v) => onUpsert(pos.code, { bezugsmenge_override: v }, scope)} />
              <span className="text-[10px] text-slate-400 w-12 text-left">Monate</span>
            </div>
            <div className="flex items-center justify-end gap-1">
              <NumInput value={result?.kennwert2 ?? null} disabled={!edit} isProzent onCommit={(v) => onUpsert(pos.code, { kennwert2: v }, scope)} />
              <span className="text-[10px] text-slate-400 w-12 text-left">% Anteil</span>
            </div>
          </div>
        ) : mengeBezugUeberOverride && !aggregatMode ? (
          <div className="flex items-center justify-end gap-1">
            <NumInput value={menge} disabled={!edit} onCommit={(v) => onUpsert(pos.code, { bezugsmenge_override: v }, scope)} />
            {typ.kind === 'manuell_menge_einheit' ? (
              <EinheitTextInput value={mengeEinheit} disabled={!edit} onCommit={(v) => onUpsert(pos.code, { mengen_einheit_override: v || null }, scope)} />
            ) : (
              <span className="text-[10px] text-slate-400 w-10 text-left">{mengeEinheit}</span>
            )}
          </div>
        ) : typ.kind === 'chf_pro_m2_gsf' && projektId && !aggregatMode ? (
          <Link to={`/projekte/${projektId}/parzellen?return=${encodeURIComponent(window.location.pathname)}`} title="Parzellen erfassen / bearbeiten" className="flex items-baseline justify-end gap-1 rounded px-1 -mx-1 hover:bg-slate-50">
            <span className="text-[#8B6956] tabular-nums text-sm hover:underline">{menge != null && menge > 0 ? formatNumber(menge) : '—'}</span>
            <span className="text-[10px] text-slate-400 w-12 text-left">{mengeEinheit}</span>
          </Link>
        ) : (
          <div className="flex items-baseline justify-end gap-1">
            <span className="text-slate-700 tabular-nums text-sm">{menge != null && menge > 0 ? formatNumber(menge) : '—'}</span>
            <span className="text-[10px] text-slate-400 w-12 text-left">{mengeEinheit}</span>
          </div>
        )}
      </td>
      {/* Einheitspreis */}
      <td className="px-3 py-2 align-top">
        <div className="flex items-center justify-end gap-1">
          {istPauschalMode ? (
            <span className="text-slate-300 tabular-nums text-sm">—</span>
          ) : aggregatMode && kennwertGemischt ? (
            <span className="text-[11px] italic text-slate-400">gemischt</span>
          ) : (
            <NumInput
              value={aggregatMode && !istKennwertProzent && kennwert != null ? Math.round(kennwert) : kennwert}
              disabled={!edit || istHonorarMethode}
              isProzent={istKennwertProzent}
              onCommit={(v) => onUpsert(pos.code, { kennwert: v }, scope)}
            />
          )}
          <span className="w-10 shrink-0 text-left text-[10px] text-slate-400">
            {istPauschalMode || (aggregatMode && kennwertGemischt) ? '' : preisEinheit}
          </span>
        </div>
        {finanz && (
          <div className="mt-0.5 pr-12 text-right text-[10px] tabular-nums text-slate-400">
            Basis {formatNumber(finanzBasis)}
          </div>
        )}
      </td>
      {/* Betrag netto */}
      <td className="px-3 py-2 align-top text-right text-slate-900 tabular-nums font-medium">
        {istPauschalMode && !aggregatMode ? (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => setRechnerOffen(true)}
              disabled={!edit}
              title="Pauschale aus Teilpositionen zusammenrechnen"
              className={cn('shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700', !edit && 'cursor-not-allowed opacity-50')}
            >
              <Calculator className="h-3.5 w-3.5" />
            </button>
            <NumInput value={betragOverride ?? betragNetto} disabled={!edit} wholeChf onCommit={(v) => onUpsert(pos.code, { betrag_override: v ?? 0 }, scope)} />
          </div>
        ) : istRueckrechenbar && edit && !istHonorarMethode ? (
          // Gesamtbetrag direkt eingeben → Satz = Betrag / Basis zurückrechnen.
          <NumInput
            value={betragNetto}
            disabled={!edit}
            wholeChf
            onCommit={(v) => onUpsert(pos.code, { kennwert: menge && menge > 0 ? (v ?? 0) / menge : 0 }, scope)}
          />
        ) : betragNetto != null && betragNetto > 0 ? <div className="pr-2">{formatNumber(betragNetto)}</div> : <span className="pr-2 text-slate-300">—</span>}
        {rechnerOffen && (
          <PauschalRechner
            open={rechnerOffen}
            onClose={() => setRechnerOffen(false)}
            label={`${isCustom ? pos.label : `${pos.code} · ${pos.label}`}`}
            initial={getDetail(pos.code, scope)}
            onApply={(total, detail) => {
              onUpsert(pos.code, { betrag_override: total, pauschal_detail: detail }, scope)
              setRechnerOffen(false)
            }}
          />
        )}
      </td>
      {/* MwSt */}
      <td className="px-3 py-2 align-top">
        <div className="flex flex-col items-center gap-1">
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={mwstAnwenden} disabled={!edit} onChange={(e) => onUpsert(pos.code, { mwst_anwenden: e.target.checked }, scope)} className="h-3.5 w-3.5" />
            <ProzentEingabe value={mwstSatz} disabled={!edit || !mwstAnwenden} compact onCommit={(v) => onUpsert(pos.code, { mwst_satz_override: v === globalMwstSatz ? null : v }, scope)} />
            {useSatzOverride && (
              <button type="button" onClick={() => onUpsert(pos.code, { mwst_satz_override: null }, scope)} className="ml-0.5 rounded px-1 text-[10px] text-amber-700 hover:bg-amber-100" disabled={!edit}>reset</button>
            )}
          </label>
          {mwstAnwenden && mwstBetrag > 0 && <div className="text-[10px] tabular-nums text-slate-400">{formatCurrency(mwstBetrag)}</div>}
        </div>
      </td>
      {/* Total inkl. MwSt */}
      <td className="px-3 py-2 align-top text-right text-slate-900 tabular-nums font-semibold">
        <div className="pr-2 leading-5">{betragBrutto > 0 ? formatNumber(betragBrutto) : <span className="text-slate-300">—</span>}</div>
      </td>
      {/* Status */}
      <td className="px-3 py-2 align-top">
        <select value={status} disabled={!edit} onChange={(e) => onUpsert(pos.code, { status: e.target.value as Status }, scope)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs">
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </td>
    </tr>
  )
}

/** Eingabe für Prozent-Werte: User tippt 8.1, intern wird 0.081 gespeichert. */
function ProzentEingabe({
  value, disabled, compact, onCommit,
}: {
  value: number
  disabled?: boolean
  compact?: boolean
  onCommit: (v: number | null) => void
}) {
  const initial = (value * 100).toFixed(2).replace(/\.?0+$/, '')
  const [draft, setDraft] = useState<string>(initial)
  useEffect(() => { setDraft(initial) }, [initial])
  return (
    <span className="inline-flex items-baseline gap-0.5">
      <input
        type="number" inputMode="decimal" step="any" value={draft} disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const trimmed = draft.trim()
          if (trimmed === '') { setDraft(initial); return }
          const n = Number(trimmed.replace(',', '.'))
          if (Number.isNaN(n)) { setDraft(initial); return }
          const dbValue = n / 100
          if (dbValue !== value) onCommit(dbValue)
        }}
        className={cn('no-spinner rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-xs tabular-nums outline-none transition focus:border-slate-300 focus:bg-white', compact ? 'w-12' : 'w-16', disabled && 'cursor-not-allowed opacity-60')}
      />
      <span className="text-[10px] text-slate-400">%</span>
    </span>
  )
}

function NumInput({
  value, disabled, isProzent, wholeChf, onCommit,
}: {
  value: number | null
  disabled?: boolean
  isProzent?: boolean
  /** Betragsfeld: auf ganze Franken runden (Anzeige + Eingabe). */
  wholeChf?: boolean
  onCommit: (v: number | null) => void
}) {
  // Float-Rauschen entfernen (z.B. 0.00823*100 = 0.8230000000000001 → 0.823).
  const clean = (n: number) => Number(n.toPrecision(12))
  const rawOf = (v: number | null) => v == null ? '' : isProzent ? String(clean(v * 100)) : wholeChf ? String(Math.round(v)) : String(clean(v))
  // Unfokussiert: %-Werte mit 2 Kommastellen; Beträge ganzzahlig (volle Präzision bleibt gespeichert).
  const displayOf = (v: number | null) => v == null ? '' : isProzent ? (v * 100).toFixed(2) : formatInputDisplay(wholeChf ? Math.round(v) : clean(v))
  const [focused, setFocused] = useState(false)
  const [draft, setDraft]     = useState<string>(rawOf(value))
  useEffect(() => { if (!focused) setDraft(rawOf(value)) }, [value, isProzent, focused])
  return (
    <input
      type="text" inputMode="decimal" value={focused ? draft : displayOf(value)} disabled={disabled}
      onFocus={() => { setDraft(rawOf(value)); setFocused(true) }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false)
        const trimmed = draft.replace(/['\s]/g, '').trim()
        if (trimmed === '') { if (value != null) onCommit(null); return }
        const n = Number(trimmed.replace(',', '.'))
        if (Number.isNaN(n)) { setDraft(rawOf(value)); return }
        const dbValue = isProzent ? n / 100 : wholeChf ? Math.round(n) : n
        if (dbValue !== value) onCommit(dbValue)
      }}
      className={cn('no-spinner w-full rounded-md border border-transparent bg-transparent px-2 py-0.5 text-right text-sm leading-5 tabular-nums outline-none transition focus:border-slate-300 focus:bg-white', disabled && 'cursor-not-allowed opacity-60')}
      placeholder={isProzent ? '%' : ''}
    />
  )
}

// =============================================================================
// Pauschal-Kalkulator: Pauschale aus Teilpositionen (Text · Anzahl · EH-Preis)
// =============================================================================

function PauschalRechner({
  open, onClose, label, initial, onApply,
}: {
  open: boolean
  onClose: () => void
  label: string
  initial: PauschalPosten[] | null
  onApply: (total: number, detail: PauschalPosten[]) => void
}) {
  const [rows, setRows] = useState<PauschalPosten[]>(
    initial && initial.length ? initial : [{ text: '', anzahl: 1, ehp: 0 }],
  )

  const total = rows.reduce((s, r) => s + (r.anzahl || 0) * (r.ehp || 0), 0)

  function update(i: number, patch: Partial<PauschalPosten>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function addRow() { setRows((rs) => [...rs, { text: '', anzahl: 1, ehp: 0 }]) }
  function removeRow(i: number) { setRows((rs) => rs.filter((_, idx) => idx !== i)) }

  const cell = 'rounded-md border border-slate-200 bg-white px-2 py-1 text-sm outline-none transition focus:border-[#8B6956] focus:ring-1 focus:ring-[#8B6956]/30'

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pauschale zusammenrechnen</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 text-xs text-slate-500">{label}</p>

        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-2 py-2 text-left font-medium">Bezeichnung</th>
                <th className="px-2 py-2 text-right font-medium w-20">Anzahl</th>
                <th className="px-2 py-2 text-right font-medium w-28">EH-Preis</th>
                <th className="px-2 py-2 text-right font-medium w-32">CHF</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="px-2 py-1.5">
                    <input className={cn(cell, 'w-full')} value={r.text} placeholder="z.B. Vermessung Baufeld A" onChange={(e) => update(i, { text: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <RechnerNumInput className={cn(cell, 'w-full text-right tabular-nums')} value={r.anzahl} onChange={(v) => update(i, { anzahl: v })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <RechnerNumInput className={cn(cell, 'w-full text-right tabular-nums')} value={r.ehp} onChange={(v) => update(i, { ehp: v })} />
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-900">{formatNumber((r.anzahl || 0) * (r.ehp || 0))}</td>
                  <td className="px-1 py-1.5 text-center">
                    <button type="button" onClick={() => removeRow(i)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Zeile entfernen">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-300 bg-slate-50 text-sm font-semibold text-slate-900">
              <tr>
                <td className="px-2 py-2" colSpan={3}>Total</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <button type="button" onClick={addRow} className="inline-flex items-center gap-1 self-start text-sm text-[#8B6956] hover:underline">
          <Plus className="h-4 w-4" /> Zeile hinzufügen
        </button>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button type="button" className="bg-[#F2D3C2] text-slate-900 hover:bg-[#E7AF90]" onClick={() => onApply(total, rows.filter((r) => r.text.trim() !== '' || r.anzahl !== 0 || r.ehp !== 0))}>
            Übernehmen ({formatCurrency(total)})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// Basis-Picker: Positionen UND/ODER ganze Hauptgruppen als %/‰-Basis wählen
// =============================================================================

function BasisPicker({
  open, onClose, label, allPositions, current, getRefNetto, onApply,
}: {
  open: boolean
  onClose: () => void
  label: string
  allPositions: BkpPosition[]
  current: BaseRef[]
  getRefNetto: (ref: BaseRef) => number
  onApply: (refs: BaseRef[]) => void
}) {
  const [sel, setSel] = useState<BaseRef[]>(current)
  const isSel = (r: BaseRef) => sel.some((s) => s.kind === r.kind && s.ref === r.ref)
  const toggle = (r: BaseRef) => setSel((xs) => isSel(r) ? xs.filter((s) => !(s.kind === r.kind && s.ref === r.ref)) : [...xs, r])
  const basis = sel.reduce((s, r) => s + getRefNetto(r), 0)

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Basis wählen</DialogTitle></DialogHeader>
        <p className="-mt-2 text-xs text-slate-500">{label} — Positionen und/oder ganze Hauptgruppen ankreuzen.</p>

        <div className="max-h-[55vh] space-y-3 overflow-y-auto rounded-lg border border-slate-200 p-3">
          {HAUPTGRUPPEN.map((hg) => {
            const positionen = allPositions.filter((p) => p.hauptgruppe === hg.code)
            const hgRef: BaseRef = { kind: 'hauptgruppe', ref: String(hg.code) }
            return (
              <div key={hg.code}>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <input type="checkbox" checked={isSel(hgRef)} onChange={() => toggle(hgRef)} className="h-3.5 w-3.5" />
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-slate-900 text-[10px] font-bold text-white">{hg.code}</span>
                  {hg.label} <span className="text-xs font-normal text-slate-400">(ganze Hauptgruppe)</span>
                </label>
                <div className="ml-7 mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5">
                  {positionen.map((p) => {
                    const r: BaseRef = { kind: 'position', ref: p.code }
                    return (
                      <label key={p.code} className="flex items-center gap-1.5 text-xs text-slate-600">
                        <input type="checkbox" checked={isSel(r)} onChange={() => toggle(r)} className="h-3 w-3" />
                        <span className="truncate">{p.label}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex items-baseline justify-between text-sm">
          <span className="text-slate-500">Basis ({sel.length} gewählt)</span>
          <span className="font-semibold tabular-nums text-slate-900">{formatCurrency(basis)}</span>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button type="button" className="bg-[#F2D3C2] text-slate-900 hover:bg-[#E7AF90]" onClick={() => onApply(sel)}>Übernehmen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Picker für 710/720 „Mieterträge nach Nutzung": Nutzungskategorien der Eigentumsart
// ankreuzen und je Anteil (%) wählen (Default 100 %). Betrag = Σ(Ertrag × %).
function NutzungErtragPicker({
  open, onClose, label, ertragProNutzung, current, onApply, variant = 'miete',
}: {
  open: boolean
  onClose: () => void
  label: string
  ertragProNutzung: Record<string, number>
  current: BaseRef[]
  onApply: (refs: BaseRef[]) => void
  variant?: 'miete' | 'verkauf'
}) {
  const istVerkauf = variant === 'verkauf'
  const titel = istVerkauf ? 'Verkaufserlös nach Nutzung' : 'Mieterträge nach Nutzung'
  const beschr = istVerkauf
    ? 'Nutzungskategorien der Verkaufsobjekte (STWEG) ankreuzen und Anteil (%) je Nutzung wählen. Basis = Verkaufserlös.'
    : 'Nutzungskategorien ankreuzen und Anteil (%) je Nutzung wählen. Basis = Jahresmietertrag dieser Eigentumsart.'
  const leer = istVerkauf ? 'Keine Verkaufsobjekte (STWEG) erfasst.' : 'Keine Mieterträge in dieser Eigentumsart erfasst.'
  const suffix = istVerkauf ? '' : '/a'
  const [sel, setSel] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {}
    for (const r of current) if (r.kind === 'nutzung') m[r.ref] = r.prozent ?? 100
    return m
  })
  const nutzungen = [...new Set([
    ...Object.keys(ertragProNutzung),
    ...current.filter((r) => r.kind === 'nutzung').map((r) => r.ref),
  ])].sort((a, b) => a.localeCompare(b, 'de'))
  const toggle = (n: string) => setSel((s) => {
    const next = { ...s }
    if (n in next) delete next[n]; else next[n] = 100
    return next
  })
  const setPct = (n: string, v: number) => setSel((s) => ({ ...s, [n]: v }))
  const basis = Object.entries(sel).reduce((sum, [n, p]) => sum + (ertragProNutzung[n] ?? 0) * (p / 100), 0)
  const refs: BaseRef[] = Object.entries(sel).map(([n, p]) => ({ kind: 'nutzung', ref: n, prozent: p }))

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{titel}</DialogTitle></DialogHeader>
        <p className="-mt-2 text-xs text-slate-500">{label} — {beschr}</p>

        <div className="max-h-[55vh] space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-3">
          {nutzungen.length === 0 && <div className="text-xs text-slate-400">{leer}</div>}
          {nutzungen.map((n) => {
            const income = ertragProNutzung[n] ?? 0
            const on = n in sel
            const p = sel[n] ?? 100
            return (
              <div key={n} className="flex items-center gap-2 text-sm">
                <label className="flex flex-1 items-center gap-2 text-slate-700">
                  <input type="checkbox" checked={on} onChange={() => toggle(n)} className="h-3.5 w-3.5" />
                  <span className="truncate">{n}</span>
                  <span className="ml-auto tabular-nums text-xs text-slate-400">{formatCurrency(income)}{suffix}</span>
                </label>
                <div className="flex items-center gap-1">
                  <input type="number" min={0} max={100} value={on ? p : ''} disabled={!on}
                    onChange={(e) => setPct(n, Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                    className="w-14 rounded border border-slate-200 px-1 py-0.5 text-right text-xs tabular-nums disabled:opacity-40" />
                  <span className="text-[10px] text-slate-400">%</span>
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex items-baseline justify-between text-sm">
          <span className="text-slate-500">Basis (Menge, {Object.keys(sel).length} Nutzungen)</span>
          <span className="font-semibold tabular-nums text-slate-900">{formatCurrency(basis)}</span>
        </div>
        <p className="-mt-1 text-[11px] text-slate-400">Diese Summe steht als Menge; der Betrag = Menge × Kennwert (%).</p>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button type="button" className="bg-[#F2D3C2] text-slate-900 hover:bg-[#E7AF90]" onClick={() => onApply(refs)}>Übernehmen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Live-Zahlenfeld für den Rechner: zeigt unfokussiert Tausender-Apostrophe,
// fokussiert den Rohwert, und meldet jede Änderung sofort (für Live-Total).
function RechnerNumInput({
  value, onChange, className,
}: {
  value: number
  onChange: (v: number) => void
  className?: string
}) {
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState<string>(String(value))
  useEffect(() => { if (!focused) setDraft(String(value)) }, [value, focused])
  return (
    <input
      type="text"
      inputMode="decimal"
      value={focused ? draft : formatInputDisplay(value)}
      onFocus={() => { setDraft(value ? String(value) : ''); setFocused(true) }}
      onChange={(e) => {
        setDraft(e.target.value)
        const n = Number(e.target.value.replace(/['\s]/g, '').replace(',', '.'))
        onChange(Number.isNaN(n) ? 0 : n)
      }}
      onBlur={() => setFocused(false)}
      className={className}
    />
  )
}

function EinheitTextInput({
  value, disabled, onCommit,
}: {
  value: string
  disabled?: boolean
  onCommit: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  return (
    <input
      type="text" value={draft} disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { const trimmed = draft.trim(); if (trimmed === value) return; onCommit(trimmed) }}
      placeholder="Einh." title="Mengen-Einheit (z.B. Stk, Tage, Pos.)"
      className={cn('w-10 rounded border border-transparent bg-transparent px-1 py-0.5 text-left text-[10px] text-slate-500 outline-none transition focus:border-slate-300 focus:bg-white focus:text-slate-900', disabled && 'cursor-not-allowed opacity-60')}
    />
  )
}

// =============================================================================
// Vergleichswerte: was wurde bei dieser Position in anderen Projekten eingesetzt?
// + Filter (Eigentumsart, Nutzung, Anlagekosten/VNF-Slider) + Projekt-Factsheet
// =============================================================================

function fmtVergleichWert(kennwert: number | null, betrag: number | null, preisEinheit: string): string {
  if (kennwert != null) {
    if (preisEinheit.startsWith('%')) return `${(kennwert * 100).toFixed(2)} %`
    if (preisEinheit.startsWith('‰')) return `${(kennwert * 1000).toFixed(2)} ‰`
    return `${formatNumber(kennwert)}${preisEinheit ? ' ' + preisEinheit : ''}`
  }
  if (betrag != null) return `${formatNumber(betrag)} CHF`
  return '—'
}

// Zwei-Daumen-Bereichsfilter (min/max) als Slider.
function RangeFilter({ label, einheit, min, max, value, onChange }: {
  label: string; einheit: string; min: number; max: number
  value: [number, number]; onChange: (v: [number, number]) => void
}) {
  if (max <= min) return null
  return (
    <div className="min-w-[180px] flex-1">
      <div className="flex items-baseline justify-between text-[11px] text-slate-500">
        <span>{label}</span>
        <span className="tabular-nums">{formatNumber(value[0])}–{formatNumber(value[1])} {einheit}</span>
      </div>
      <div className="relative h-5">
        <input type="range" min={min} max={max} value={value[0]}
          onChange={(e) => onChange([Math.min(Number(e.target.value), value[1]), value[1]])}
          className="pointer-events-none absolute inset-x-0 top-1.5 h-1 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#8B6956]" />
        <input type="range" min={min} max={max} value={value[1]}
          onChange={(e) => onChange([value[0], Math.max(Number(e.target.value), value[0])])}
          className="pointer-events-none absolute inset-x-0 top-1.5 h-1 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#8B6956]" />
        <div className="absolute inset-x-0 top-2 h-1 rounded-full bg-slate-200" />
      </div>
    </div>
  )
}

function BkpVergleichDialog({
  open, onClose, code, label, preisEinheit, onApply,
}: {
  open: boolean
  onClose: () => void
  code: string
  label: string
  preisEinheit: string
  onApply: (patch: BkpPatch) => void
}) {
  const [rows, setRows] = useState<VergleichWert[]>([])
  const [loading, setLoading] = useState(true)
  const [fEig, setFEig] = useState<string>('alle')
  const [fNutzung, setFNutzung] = useState<string>('alle')
  const [factsheet, setFactsheet] = useState<VergleichWert | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void fetchAnlagekostenVergleich(code).then((r) => { if (!cancelled) { setRows(r); setLoading(false) } })
    return () => { cancelled = true }
  }, [open, code])

  const akBounds = useMemo<[number, number]>(() => {
    const v = rows.map((r) => r.info.anlagekostenBrutto)
    return v.length ? [Math.floor(Math.min(...v)), Math.ceil(Math.max(...v))] : [0, 0]
  }, [rows])
  const vnfBounds = useMemo<[number, number]>(() => {
    const v = rows.map((r) => r.info.vnf)
    return v.length ? [Math.floor(Math.min(...v)), Math.ceil(Math.max(...v))] : [0, 0]
  }, [rows])
  const [akRange, setAkRange] = useState<[number, number]>([0, 0])
  const [vnfRange, setVnfRange] = useState<[number, number]>([0, 0])
  useEffect(() => { setAkRange(akBounds) }, [akBounds])
  useEffect(() => { setVnfRange(vnfBounds) }, [vnfBounds])

  const eigOptionen = useMemo(() => [...new Set(rows.map((r) => r.eigentumsart))], [rows])
  const nutzungen = useMemo(() => [...new Set(rows.flatMap((r) => r.info.nutzungen))].sort(), [rows])

  const gefiltert = rows.filter((r) =>
    (fEig === 'alle' || r.eigentumsart === fEig) &&
    (fNutzung === 'alle' || r.info.nutzungen.includes(fNutzung)) &&
    r.info.anlagekostenBrutto >= akRange[0] && r.info.anlagekostenBrutto <= akRange[1] &&
    r.info.vnf >= vnfRange[0] && r.info.vnf <= vnfRange[1])

  const selCls = 'rounded-md border border-slate-200 bg-white px-2 py-1 text-sm'

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-5xl">
        <DialogHeader><DialogTitle>Vergleichswerte · {label}</DialogTitle></DialogHeader>

        {/* Filter */}
        <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <label className="text-sm">
            <div className="text-[11px] text-slate-500">Eigentumsart</div>
            <select value={fEig} onChange={(e) => setFEig(e.target.value)} className={selCls}>
              <option value="alle">Alle</option>
              {eigOptionen.map((e) => <option key={e} value={e}>{EIGENTUMSART_LABEL[e]}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <div className="text-[11px] text-slate-500">Nutzung</div>
            <select value={fNutzung} onChange={(e) => setFNutzung(e.target.value)} className={selCls}>
              <option value="alle">Alle</option>
              {nutzungen.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <RangeFilter label="Anlagekosten (inkl.)" einheit="CHF" min={akBounds[0]} max={akBounds[1]} value={akRange} onChange={setAkRange} />
          <RangeFilter label="VNF (VKF)" einheit="m²" min={vnfBounds[0]} max={vnfBounds[1]} value={vnfRange} onChange={setVnfRange} />
          <span className="ml-auto whitespace-nowrap text-xs text-slate-400">{gefiltert.length}/{rows.length}</span>
        </div>

        <div className="mt-3 max-h-[55vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Wird geladen…
            </div>
          ) : gefiltert.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">Keine passenden Werte gefunden.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-xs font-medium tracking-wider text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-2 py-1.5 text-left">Projekt</th>
                  <th className="px-2 py-1.5 text-left">Variante</th>
                  <th className="px-2 py-1.5 text-left">Eigentumsart</th>
                  <th className="px-2 py-1.5 text-right">VNF</th>
                  <th className="px-2 py-1.5 text-right">Anlagekosten</th>
                  <th className="px-2 py-1.5 text-right">Wert</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {gefiltert.map((r, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1.5 text-slate-700">
                      {r.projektNummer && <span className="mr-1 text-slate-400">{r.projektNummer}</span>}{r.projektName}
                    </td>
                    <td className="px-2 py-1.5 text-slate-600">{r.variantName}</td>
                    <td className="px-2 py-1.5 text-slate-600">{EIGENTUMSART_LABEL[r.eigentumsart]}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{formatNumber(r.info.vnf)} m²</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{formatNumber(r.info.anlagekostenBrutto)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium text-slate-900">{fmtVergleichWert(r.kennwert, r.betrag, preisEinheit)}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" onClick={() => setFactsheet(r)} title="Factsheet" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-[#8B6956]">
                          <Info className="h-4 w-4" />
                        </button>
                        <button type="button"
                          onClick={() => onApply(r.kennwert != null ? { kennwert: r.kennwert } : { betrag_override: r.betrag ?? 0 })}
                          className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-600 transition hover:border-[#8B6956] hover:text-[#8B6956]">
                          Übernehmen
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Schliessen</Button>
        </DialogFooter>
      </DialogContent>

      {factsheet && <FactsheetDialog wert={factsheet} onClose={() => setFactsheet(null)} />}
    </Dialog>
  )
}

function FactsheetDialog({ wert, onClose }: { wert: VergleichWert; onClose: () => void }) {
  const { info } = wert
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {wert.projektNummer && <span className="mr-1 text-slate-400">{wert.projektNummer}</span>}
            {wert.projektName} · {wert.variantName}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto">
          {/* Bilder */}
          <div className="grid grid-cols-2 gap-3">
            <FactsheetBild url={info.bildUrl} label="Bild" />
            <FactsheetBild url={info.situationsplanUrl} label="Situationsplan" />
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <FactRow label="Adresse" value={info.adresse || '—'} />
            <FactRow label="Eigentumsart" value={info.eigentumsarten.map((e) => EIGENTUMSART_LABEL[e]).join(', ') || '—'} />
            <FactRow label="VNF (VKF) total" value={`${formatNumber(info.vnf)} m²`} />
            <FactRow label="Anzahl Wohnungen" value={formatNumber(info.anzahlWohnungen)} />
            <FactRow label="Tiefgaragen-Parkplätze" value={formatNumber(info.tiefgaragePP)} />
            <FactRow label="Anlagekosten (inkl.)" value={`${formatNumber(info.anlagekostenBrutto)} CHF`} />
          </div>

          {/* VNF nach Nutzung */}
          <FactsheetTabelle title="VNF nach Nutzung" rows={info.vnfNachNutzung.map((n) => [n.nutzung, `${formatNumber(n.m2)} m²`])} foot={['Total', `${formatNumber(info.vnf)} m²`]} />

          {/* Wohnungsmix */}
          {info.wohnungsmix.length > 0 && (
            <FactsheetTabelle title="Wohnungsmix" rows={info.wohnungsmix.map((w) => [`${w.label}${w.key !== 'joker' ? ' Zi' : ''}`, formatNumber(w.anzahl)])} foot={['Total', formatNumber(info.anzahlWohnungen)]} />
          )}

          {/* Kostengliederung BKP 0–9 */}
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Kostengliederung BKP 0–9</h4>
            <table className="w-full text-sm">
              <thead className="text-[11px] tracking-wider text-slate-400">
                <tr><th className="px-2 py-1 text-left">BKP</th><th className="px-2 py-1 text-right">exkl. MWST</th><th className="px-2 py-1 text-right">inkl. MWST</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {info.bkp.filter((b) => b.netto !== 0 || b.brutto !== 0).map((b) => (
                  <tr key={b.code}>
                    <td className="px-2 py-1 text-slate-700"><span className="mr-1 font-semibold text-slate-900">{b.code}</span>{b.label}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-900">{formatNumber(b.netto)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-900">{formatNumber(b.brutto)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-300 font-semibold text-slate-900">
                <tr>
                  <td className="px-2 py-1.5">Total</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatNumber(info.anlagekostenNetto)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatNumber(info.anlagekostenBrutto)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <DialogFooter><Button variant="ghost" onClick={onClose}>Schliessen</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FactsheetBild({ url, label }: { url: string | null; label: string }) {
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-400">{label}</div>
      {url
        ? <img src={url} alt={label} className="h-40 w-full rounded-lg border border-slate-200 object-cover" />
        : <div className="flex h-40 w-full items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-400">kein {label}</div>}
    </div>
  )
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-slate-100 py-1">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium tabular-nums text-slate-900">{value}</span>
    </div>
  )
}

function FactsheetTabelle({ title, rows, foot }: { title: string; rows: [string, string][]; foot?: [string, string] }) {
  if (rows.length === 0) return null
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h4>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {rows.map(([a, b], i) => (
            <tr key={i}><td className="px-2 py-1 text-slate-700">{a}</td><td className="px-2 py-1 text-right tabular-nums text-slate-900">{b}</td></tr>
          ))}
        </tbody>
        {foot && (
          <tfoot className="border-t-2 border-slate-300 font-semibold text-slate-900">
            <tr><td className="px-2 py-1.5">{foot[0]}</td><td className="px-2 py-1.5 text-right tabular-nums">{foot[1]}</td></tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
