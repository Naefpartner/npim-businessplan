import { useMemo, useState } from 'react'
import { PieChart, ChevronDown, ChevronRight } from 'lucide-react'
import {
  useMengengeruestShared, useVariantEtappenGeteilt,
} from '@/contexts/VariantDataContext'
import { useVariantEtappen } from '@/hooks/useVariantEtappen'
import { useGenossenschaftKostenmiete } from '@/hooks/useGenossenschaftKostenmiete'
import { EIGENTUMSART_LABEL, WOHNUNGSMIX_KEYS, type Eigentumsart } from '@/types'
import { CI, type CiFamily } from '@/lib/ci'
import { EIGENTUMSART_ORDER } from '@/lib/bkp2'
import { EIGENTUMSART_COLOR, EIGENTUMSART_FAMILY, HEADER_TEXT } from '@/lib/kategorieFarben'
import { formatNumber, cn } from '@/lib/utils'
import {
  buildUnits, filterUnits, emptyFilter, isFiltered as isFilteredFn,
  flaecheOf, mieteMonat, chfM2a, spanne, regression, histogram, sumW, countW, wohnungsmixKey,
  type AnalyseUnit, type AnalyseFilter, type FlaecheBasis,
} from '@/lib/mengenAnalyse'
import { HBars, Cols, RangeRows, StackedBars, Scatter, rampOf, readableText, useTip } from '@/lib/mengenCharts'

const nf = (n: number | null | undefined, d = 0) => (n == null || !Number.isFinite(n) ? '–' : formatNumber(n, d))
const pct = (n: number, d = 1) => (Number.isFinite(n) ? `${nf(n * 100, d)} %` : '–')

type SubTab = 'overview' | 'spiegel' | 'mix' | 'preis' | 'tabelle'
type MetricKey = 'chfm2a' | 'miete' | 'flaeche' | 'zimmer'
/**
 * Verkaufsobjekte (Stockwerkeigentum) haben keinen wiederkehrenden Jahresertrag,
 * sondern einen einmaligen Verkaufserlös. Sie werden darum in einem eigenen
 * Board mit eigener Beschriftung ausgewertet — Monats-/Jahresgrössen fallen weg.
 */
type Modus = 'miete' | 'verkauf'

interface ModusLabels {
  titel: string
  hint: string
  total: string        // KPI: Gesamtwert
  totalEinheit: string
  wert: string         // Spaltenkopf: Wert je Einheit
  proM2: string
  spiegel: string
  spiegelHint: string
  streuung: string     // Titel Preisverteilung
  metrics: [MetricKey, string][]
  binWert: number      // Klassenbreite Histogramm Wert
  binM2: number        // Klassenbreite Histogramm CHF/m²
}

const LBL: Record<Modus, ModusLabels> = {
  miete: {
    titel: 'Mietobjekte', hint: 'Rendite- und Genossenschaftsobjekte — wiederkehrender Jahresertrag.',
    total: 'Nettomiete / Monat', totalEinheit: 'CHF', wert: 'Netto/Mt', proM2: 'CHF/m²·a',
    spiegel: 'Mietspiegel', spiegelHint: 'Einfärbung nach Mietzins über den gesamten Bestand.',
    streuung: 'Verteilung Nettomiete / Monat',
    metrics: [['chfm2a', 'CHF/m²·a'], ['miete', 'Miete / Mt'], ['flaeche', 'Fläche m²'], ['zimmer', 'Zimmer']],
    binWert: 250, binM2: 25,
  },
  verkauf: {
    titel: 'Verkaufsobjekte', hint: 'Stockwerkeigentum — einmaliger Verkaufserlös, kein Jahresertrag.',
    total: 'Verkaufserlös', totalEinheit: 'CHF', wert: 'Erlös', proM2: 'CHF/m²',
    spiegel: 'Preisspiegel', spiegelHint: 'Einfärbung nach Verkaufspreis über den gesamten Bestand.',
    streuung: 'Verteilung Verkaufserlös',
    metrics: [['chfm2a', 'CHF/m²'], ['miete', 'Verkaufspreis'], ['flaeche', 'Fläche m²'], ['zimmer', 'Zimmer']],
    binWert: 100_000, binM2: 500,
  },
}

/** Wert je Einheit: Miete pro Monat bzw. Verkaufserlös (einmalig). */
const wertOf = (u: AnalyseUnit, m: Modus) => (m === 'verkauf' ? u.mietePa : mieteMonat(u))

const zimmerSort = (key: string) => { const n = Number(key); return Number.isFinite(n) ? n : (key.startsWith('nutzung:') ? 900 : 800) }

// Feste Farbe je Zimmerkategorie über die vollständige Wohnungsmix-Skala —
// unabhängig davon, welche Kategorien im jeweiligen Board vorkommen. So ist
// 2.5 Zi bei Mietobjekten und Verkaufsobjekten identisch eingefärbt.
// Ausgeschriebener Wohnungstyp für Mouseover-Texte ('3.5' → «3.5 Zimmer»).
const zimmerTitel = (zimmerKey: string, fallback: string) =>
  Number.isFinite(Number(zimmerKey)) ? `${zimmerKey} Zimmer` : fallback

const ZIM_SKALA = WOHNUNGSMIX_KEYS as readonly string[]
const zimmerFarbe = (zimmerKey: string, familie: CiFamily = 'kupfer'): string => {
  const i = ZIM_SKALA.indexOf(wohnungsmixKey(zimmerKey))
  return i >= 0 ? rampOf(familie, i / (ZIM_SKALA.length - 1)) : CI.neutral[5]
}

export function MengenAnalyseSection({ variantId, defaultExpanded = false }: { variantId: string; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const { buildings } = useMengengeruestShared()
  const etappenGeteilt = useVariantEtappenGeteilt()
  const etappenEigen = useVariantEtappen(etappenGeteilt ? undefined : variantId)
  const { etappen } = etappenGeteilt ?? etappenEigen
  // Genossenschaft: Wohnungsertrag = Kostenmiete, nicht der im Mengengerüst
  // erfasste Vergleichsmietzins.
  const km = useGenossenschaftKostenmiete(variantId)

  const units = useMemo(
    () => buildUnits(buildings, etappen, km.maxMietertragWohnenPa != null
      ? { genossenschaftWohnen: { maxMietertragWohnenPa: km.maxMietertragWohnenPa, punkte: km.punkte } }
      : {}),
    [buildings, etappen, km],
  )
  const [pick, setPick] = useState<{ u: AnalyseUnit; modus: Modus; basis: FlaecheBasis } | null>(null)

  const mietUnits = useMemo(() => units.filter((u) => u.eig !== 'verkaufsobjekt'), [units])
  const verkaufUnits = useMemo(() => units.filter((u) => u.eig === 'verkaufsobjekt'), [units])

  // Reiter, Filter und Flächenbasis gelten für beide Bereiche gemeinsam.
  const [filter, setFilter] = useState<AnalyseFilter>(emptyFilter)
  const [basis, setBasis] = useState<FlaecheBasis>('vmf')
  const [sub, setSub] = useState<SubTab>('overview')
  const filtered = isFilteredFn(filter)

  // Für die Nutzungsart-Leiste: alle Filter AUSSER Eigentumsart, damit die
  // Verteilung immer vollständig sichtbar bleibt (Segmente filtern die Eig-Art).
  const fuNoEig = useMemo(() => filterUnits(units, { ...filter, eig: new Set() }), [units, filter])

  // ── Filter-Optionen (nur Dimensionen mit >1 Wert) ──────────────────────────
  const opts = useMemo(() => {
    const etOpts = [...etappen.map((e) => ({ k: e.id, l: e.name })), { k: 'none', l: 'Ohne Etappe' }]
      .filter((o) => units.some((u) => (u.etappeId ?? 'none') === o.k))
    const eigOpts = EIGENTUMSART_ORDER.filter((e) => units.some((u) => u.eig === e)).map((e) => ({ k: e as string, l: EIGENTUMSART_LABEL[e] }))
    const hausOpts = [...new Map(units.map((u) => [u.hausId, u.haus])).entries()].map(([k, l]) => ({ k, l }))
    const nutzOpts = [...new Set(units.map((u) => u.nutzung))].map((k) => ({ k, l: k }))
    const zimOpts = [...new Set(units.filter((u) => u.istWohnen).map((u) => u.zimmerKey))]
      .sort((a, b) => zimmerSort(a) - zimmerSort(b)).map((k) => ({ k, l: units.find((u) => u.zimmerKey === k)!.zimmerLabel }))
    const typOpts = [...new Set(units.map((u) => u.wohnungstyp).filter((x): x is string => !!x))].map((k) => ({ k, l: k }))
    const geschOpts = [...new Map(units.map((u) => [u.geschoss, u.geschossRang])).entries()]
      .sort((a, b) => b[1] - a[1]).map(([k]) => ({ k, l: k }))
    return { etOpts, eigOpts, hausOpts, nutzOpts, zimOpts, typOpts, geschOpts }
  }, [units, etappen])

  const toggle = (dim: keyof AnalyseFilter, v: string) => setFilter((f) => {
    const s = new Set(f[dim]); if (s.has(v)) s.delete(v); else s.add(v)
    return { ...f, [dim]: s }
  })

  // Ein Bereich verschwindet komplett (Titel, Kennzahlen, Auswertungen), sobald
  // der Filter keine seiner Einheiten mehr durchlässt — etwa bei Auswahl der
  // Nutzungsart Genossenschaft: dann bleiben die Verkaufsobjekte ganz weg.
  const mietSichtbar = useMemo(() => filterUnits(mietUnits, filter).length > 0, [mietUnits, filter])
  const verkaufSichtbar = useMemo(() => filterUnits(verkaufUnits, filter).length > 0, [verkaufUnits, filter])
  const beideSichtbar = mietSichtbar && verkaufSichtbar

  // Reiter- und Flächenbeschriftung folgen dem, was tatsächlich sichtbar ist.
  const nurVerkauf = verkaufSichtbar && !mietSichtbar
  const spiegelLabel = beideSichtbar ? 'Miet- & Preisspiegel' : LBL[nurVerkauf ? 'verkauf' : 'miete'].spiegel
  const vmfLabel = beideSichtbar ? 'VMF/VKF' : (nurVerkauf ? 'VKF' : 'VMF')

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button type="button" onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 bg-[#B98C74] px-5 py-3 text-sm font-semibold text-slate-900 transition hover:brightness-95">
        {expanded ? <ChevronDown className="h-4 w-4 text-slate-700" /> : <ChevronRight className="h-4 w-4 text-slate-700" />}
        <PieChart className="h-4 w-4 text-slate-700" />
        <span>Wohnungs- &amp; Nutzungsmix · Mietzins- und Preisanalyse</span>
      </button>

      {expanded && (units.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-500">Noch keine Mengen erfasst — erfasse Gebäude, Geschosse und (optional) Mieteinheiten unter „Mengen und Erträge".</div>
      ) : (
        <div className="p-5">
          {/* Sub-Tabs — gelten für alle Nutzungsarten */}
          <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
            {([['overview', 'Übersicht'], ['spiegel', spiegelLabel], ['mix', 'Wohnungs- & Nutzungsmix'],
               ['preis', 'Preisanalyse'], ['tabelle', 'Tabelle']] as [SubTab, string][]).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setSub(k)}
                className={cn('border-b-2 px-3 py-2 text-[13px] transition', sub === k ? 'border-[#B98C74] font-medium text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800')}>{l}</button>
            ))}
          </div>

          {/* Nutzungsart-Verteilung — nur sinnvoll bei mehreren Eigentumsarten */}
          <EigBand units={fuNoEig} basis={basis} sel={filter.eig} onToggle={(v) => toggle('eig', v)} />

          {/* Filterleiste */}
          <div className="mb-5 flex flex-wrap items-start gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
            {opts.etOpts.length > 1 && <FilterGroup label="Etappe" items={opts.etOpts} sel={filter.etappe} onToggle={(v) => toggle('etappe', v)} />}
            {opts.eigOpts.length > 1 && <FilterGroup label="Eigentumsart" items={opts.eigOpts} sel={filter.eig} onToggle={(v) => toggle('eig', v)} dot={(k) => EIGENTUMSART_COLOR[k as Eigentumsart]} />}
            {opts.hausOpts.length > 1 && <FilterGroup label="Gebäude" items={opts.hausOpts} sel={filter.haus} onToggle={(v) => toggle('haus', v)} />}
            {opts.nutzOpts.length > 1 && <FilterGroup label="Nutzung" items={opts.nutzOpts} sel={filter.nutzung} onToggle={(v) => toggle('nutzung', v)} />}
            {opts.zimOpts.length > 1 && <FilterGroup label="Zimmer" items={opts.zimOpts} sel={filter.zimmer} onToggle={(v) => toggle('zimmer', v)} />}
            {opts.typOpts.length > 1 && <FilterGroup label="Wohnungstyp" items={opts.typOpts} sel={filter.wohnungstyp} onToggle={(v) => toggle('wohnungstyp', v)} />}
            {opts.geschOpts.length > 1 && <FilterGroup label="Geschoss" items={opts.geschOpts} sel={filter.geschoss} onToggle={(v) => toggle('geschoss', v)} />}
            <div className="ml-auto flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-slate-900">Fläche</span>
                {(['vmf', 'gf'] as FlaecheBasis[]).map((b) => (
                  <Chip key={b} on={basis === b} onClick={() => setBasis(b)}>{b === 'vmf' ? vmfLabel : 'GF'}</Chip>
                ))}
              </div>
              {filtered && <button type="button" onClick={() => setFilter(emptyFilter())} className="text-[#8B6956] underline">Filter zurücksetzen</button>}
            </div>
          </div>

          <div className="space-y-6">
            {mietSichtbar && (
              <AnalyseBoard units={mietUnits} modus="miete" mitTitel={beideSichtbar} km={km}
                filter={filter} basis={basis} sub={sub}
                onPick={(u) => setPick({ u, modus: 'miete', basis })} />
            )}
            {verkaufSichtbar && (
              <AnalyseBoard units={verkaufUnits} modus="verkauf" mitTitel={beideSichtbar}
                filter={filter} basis={basis} sub={sub}
                onPick={(u) => setPick({ u, modus: 'verkauf', basis })} />
            )}
            {!mietSichtbar && !verkaufSichtbar && (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-400">
                Keine Einheiten mit den aktuellen Filtern.
              </p>
            )}
          </div>
        </div>
      ))}

      {pick && <Drawer u={pick.u} basis={pick.basis} modus={pick.modus} onClose={() => setPick(null)} />}
    </section>
  )
}

// ── Ein Auswertungs-Bereich (Mietobjekte bzw. Verkaufsobjekte) ───────────────
// Reiter, Filter und Flächenbasis kommen von aussen und gelten für beide
// Bereiche; eigen bleibt hier nur die Einfärbung des Spiegels.
function AnalyseBoard({ units, modus, mitTitel, km, filter, basis, sub, onPick }: {
  units: AnalyseUnit[]
  modus: Modus
  mitTitel: boolean
  km?: ReturnType<typeof useGenossenschaftKostenmiete>
  filter: AnalyseFilter
  basis: FlaecheBasis
  sub: SubTab
  onPick: (u: AnalyseUnit) => void
}) {
  const L = LBL[modus]
  const hatKostenmiete = units.some((u) => u.ausKostenmiete)
  const [metric, setMetric] = useState<MetricKey>('chfm2a')

  const fu = useMemo(() => filterUnits(units, filter), [units, filter])
  const filtered = isFilteredFn(filter)

  // Farbfamilie der Auswertungen: bleibt genau eine Eigentumsart übrig, wird
  // deren Familie genutzt (Genossenschaft = Grün, Rendite = Blau, Verkauf =
  // Rot); bei gemischter Auswahl die neutrale Kupfer-Familie.
  const eigsAktiv = EIGENTUMSART_ORDER.filter((e) => fu.some((u) => u.eig === e))
  const familie: CiFamily = eigsAktiv.length === 1 ? EIGENTUMSART_FAMILY[eigsAktiv[0]] : 'kupfer'

  const metricOf = (u: AnalyseUnit): number =>
    metric === 'chfm2a' ? chfM2a(u, basis) : metric === 'miete' ? wertOf(u, modus) : metric === 'flaeche' ? flaecheOf(u, basis) : (u.zimmer ?? 0)
  const metricFmt = (v: number) => metric === 'flaeche' ? nf(v, 1) : metric === 'zimmer' ? nf(v, 1) : nf(v, 0)

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const flLbl = basis === 'gf' ? 'GF' : (modus === 'verkauf' ? 'VKF' : 'VMF')
  const kAnz = countW(fu), kFl = sumW(fu, (u) => flaecheOf(u, basis)), kPa = sumW(fu, (u) => u.mietePa)
  const kpis = modus === 'verkauf' ? [
    { l: 'Einheiten', v: nf(kAnz), foot: filtered ? `von ${countW(units)} gefiltert` : 'Gesamtbestand' },
    { l: `Fläche ${flLbl}`, v: nf(kFl, 0), u: 'm²', foot: `Ø ${nf(kAnz > 0 ? kFl / kAnz : 0, 1)} m² je Einheit` },
    { l: 'Verkaufserlös', v: nf(kPa), u: 'CHF', foot: `Ø ${nf(kAnz > 0 ? kPa / kAnz : 0)} CHF je Einheit` },
    { l: 'Ø Verkaufspreis', v: nf(kFl > 0 ? kPa / kFl : 0), u: 'CHF/m²', foot: 'einmaliger Erlös, kein Jahresertrag' },
  ] : [
    { l: 'Einheiten', v: nf(kAnz), foot: filtered ? `von ${countW(units)} gefiltert` : 'Gesamtbestand' },
    { l: `Fläche ${flLbl}`, v: nf(kFl, 0), u: 'm²', foot: `Ø ${nf(kAnz > 0 ? kFl / kAnz : 0, 1)} m² je Einheit` },
    { l: 'Nettomiete / Monat', v: nf(kPa / 12), u: 'CHF', foot: `${nf(kPa)} CHF p.a.` },
    { l: 'Ø Nettomiete', v: nf(kFl > 0 ? kPa / kFl : 0), u: 'CHF/m²·a', foot: `${nf(kFl > 0 ? kPa / kFl / 12 : 0, 2)} CHF/m² pro Monat` },
  ]

  return (
    <div>
      {mitTitel && (
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 border-b-2 pb-1.5"
          style={{ borderColor: EIGENTUMSART_COLOR[modus === 'verkauf' ? 'verkaufsobjekt' : 'renditeobjekt'] }}>
          <h3 className="text-lg font-semibold text-slate-900">{L.titel}</h3>
          <span className="text-[11.5px] text-slate-500">{L.hint}</span>
        </div>
      )}

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-4">
        {kpis.map((k, i) => (
          <div key={i} className="bg-white px-4 py-3">
            <div className="text-[9.5px] uppercase tracking-[0.13em] text-slate-500">{k.l}</div>
            <div className="mt-1 text-2xl font-light tabular-nums text-slate-900">{k.v}{k.u && <span className="ml-1 text-xs text-slate-500">{k.u}</span>}</div>
            <div className="mt-0.5 text-[11px] tabular-nums text-slate-500">{k.foot}</div>
          </div>
        ))}
      </div>

      {hatKostenmiete && km && (
        <div className="mb-4 rounded-lg border border-[#E7AF90] bg-[#FAEFE9] px-3 py-2 text-[11.5px] leading-snug text-[#8B6956]">
          <b>Genossenschaft:</b> Die Wohnungsmieten stammen aus der Kostenmiete — der konsolidierte max. Mietertrag Wohnen
          {km.maxMietertragWohnenPa != null && <> ({nf(km.maxMietertragWohnenPa)} CHF/a, {nf(km.konsolidiertProM2Jahr ?? 0)} CHF/m²·a)</>}
          {' '}wird über die WBF-Punkte des Wohnungsmix auf die einzelnen Wohnungen verteilt — gleiche Wohnungskategorie = gleiche Miete, unabhängig von Etappe und Gebäude. Die Miete je Haus folgt aus dessen Wohnungsmix.
          Der im Mengengerüst erfasste Mietzins gilt als Vergleichswert und ist im Datenblatt je Einheit ausgewiesen.
          Übrige Nutzungen (Gewerbe, Parkplätze …) behalten ihren erfassten Ertrag.
        </div>
      )}

      {sub === 'overview' && <OverviewTab fu={fu} basis={basis} modus={modus} familie={familie} />}
      {sub === 'spiegel' && <SpiegelTab units={units} fu={fu} basis={basis} modus={modus} metric={metric} setMetric={setMetric} metricOf={metricOf} metricFmt={metricFmt} onPick={onPick} />}
      {sub === 'mix' && <MixTab fu={fu} basis={basis} familie={familie} />}
      {sub === 'preis' && <PreisTab fu={fu} basis={basis} modus={modus} familie={familie} onPick={onPick} />}
      {sub === 'tabelle' && <TabelleTab fu={fu} basis={basis} modus={modus} onPick={onPick} />}
    </div>
  )
}

// ── kleine UI-Bausteine ──────────────────────────────────────────────────────
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick}
    className={cn('rounded border px-2 py-1 text-xs transition', on ? 'border-[#B98C74] bg-[#B98C74] text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-[#B98C74]')}>{children}</button>
}
function FilterGroup({ label, items, sel, onToggle, dot }: { label: string; items: { k: string; l: string }[]; sel: Set<string>; onToggle: (v: string) => void; dot?: (k: string) => string | undefined }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-slate-900">{label}</span>
      {items.map((it) => (
        <button key={it.k} type="button" onClick={() => onToggle(it.k)}
          className={cn('inline-flex items-center gap-1 rounded border px-2 py-1 text-xs transition', sel.has(it.k) ? 'border-[#B98C74] bg-[#B98C74] text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-[#B98C74]')}>
          {dot && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: dot(it.k) }} />}{it.l}
        </button>
      ))}
    </div>
  )
}
function Card({ title, hint, children, className }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-slate-200 bg-white p-4', className)}>
      <h3 className="text-[15px] font-medium text-slate-800">{title}</h3>
      {hint && <p className="mb-3 mt-0.5 text-[11.5px] leading-snug text-slate-500">{hint}</p>}
      {children}
    </div>
  )
}
// Immer sichtbare Verteilung nach Nutzungsart (Eigentumsart), farbig, klickbar.
function EigBand({ units, basis, sel, onToggle }: { units: AnalyseUnit[]; basis: FlaecheBasis; sel: Set<string>; onToggle: (eig: string) => void }) {
  const [measure, setMeasure] = useState<'flaeche' | 'anzahl' | 'miete'>('flaeche')
  const valOf = (s: AnalyseUnit[]) => measure === 'anzahl' ? countW(s) : measure === 'flaeche' ? sumW(s, (u) => flaecheOf(u, basis)) : sumW(s, (u) => u.mietePa)
  const segs = EIGENTUMSART_ORDER.map((eig) => { const s = units.filter((u) => u.eig === eig); return { eig: eig as string, label: EIGENTUMSART_LABEL[eig], val: valOf(s), n: countW(s), color: EIGENTUMSART_COLOR[eig] } }).filter((s) => s.val > 0)
  const tot = segs.reduce((a, s) => a + s.val, 0) || 1
  const unit = measure === 'anzahl' ? '' : measure === 'flaeche' ? ' m²' : ' CHF'
  const fmt = (v: number) => nf(v, measure === 'flaeche' ? 0 : 0)
  const active = (eig: string) => !sel.size || sel.has(eig)
  const { bind, layer } = useTip()
  // Bei nur einer Eigentumsart ist die Leiste ohne Aussage.
  if (segs.length < 2) return null
  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-white p-3">
      {layer}
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium text-slate-900">Verteilung nach Nutzungsart</div>
        <div className="flex gap-1.5">
          {([['flaeche', 'Fläche'], ['anzahl', 'Einheiten'], ['miete', 'Nettomiete']] as const).map(([k, l]) => (
            <Chip key={k} on={measure === k} onClick={() => setMeasure(k)}>{l}</Chip>
          ))}
        </div>
      </div>
      <div className="flex h-9 overflow-hidden rounded border border-slate-200">
        {segs.map((s) => (
          <button key={s.eig} type="button" onClick={() => onToggle(s.eig)} {...bind(`${s.label}: ${fmt(s.val)}${unit} · ${pct(s.val / tot)} · ${nf(s.n)} Einheiten`)}
            style={{ flex: s.val, background: s.color, opacity: active(s.eig) ? 1 : 0.25 }}
            className="flex items-center justify-center overflow-hidden whitespace-nowrap px-1 text-[16px] font-medium text-slate-900 transition hover:brightness-95">
            {s.val / tot > 0.08 ? `${s.label} · ${pct(s.val / tot, 0)}` : ''}
          </button>
        ))}
      </div>
      {/* Gleiche Optik wie die Filter-Chips der Filterleiste (siehe FilterGroup). */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {segs.map((s) => { const gewaehlt = sel.has(s.eig)
          return (
            <button key={s.eig} type="button" onClick={() => onToggle(s.eig)}
              className={cn('inline-flex items-center gap-1 rounded border px-2 py-1 text-xs transition',
                gewaehlt ? 'border-[#B98C74] bg-[#B98C74] text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-[#B98C74]')}>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
              <span className={cn('tabular-nums', gewaehlt ? 'text-white/80' : 'text-slate-500')}>{fmt(s.val)}{unit} · {pct(s.val / tot, 0)} · {nf(s.n)} Einh.</span>
            </button>
          ) })}
      </div>
    </div>
  )
}

const thc = 'px-2 py-1.5 text-right text-sm font-medium text-slate-900 border-b border-slate-300'
const tdc = 'px-2 py-1.5 text-right tabular-nums border-b border-slate-100'

// ── Übersicht ────────────────────────────────────────────────────────────────
function OverviewTab({ fu, basis, modus, familie }: { fu: AnalyseUnit[]; basis: FlaecheBasis; modus: Modus; familie: CiFamily }) {
  const L = LBL[modus]
  const verkauf = modus === 'verkauf'
  const byHaus = [...new Map(fu.map((u) => [u.hausId, u.haus])).entries()].map(([id, haus]) => ({ id, haus, s: fu.filter((u) => u.hausId === id) }))
  const totA = sumW(fu, (u) => flaecheOf(u, basis)), totP = sumW(fu, (u) => u.mietePa), totN = countW(fu)
  const zimKeys = [...new Set(fu.filter((u) => u.istWohnen).map((u) => u.zimmerKey))].sort((a, b) => zimmerSort(a) - zimmerSort(b))
  const zimSeg = zimKeys.map((z) => { const s = fu.filter((u) => u.zimmerKey === z); return { z, label: s[0]?.zimmerLabel ?? z, n: countW(s), a: sumW(s, (u) => flaecheOf(u, basis)), col: zimmerFarbe(z, familie), s } }).filter((m) => m.n > 0)
  const spn = zimSeg.map((m) => ({ label: m.label, ...(spanne(m.s, (u) => chfM2a(u, basis)) ?? {}) }))

  return (
    // 50/50: links die Ertragstabelle, rechts Wohnungsmix über Miet-/Preisspanne.
    <div className="grid gap-4 lg:grid-cols-2">
      <Card
        title={verkauf ? 'Verkaufserlös nach Gebäude' : 'Ertrag nach Gebäude'}
        hint={verkauf
          ? `Einmaliger Verkaufserlös und CHF/m², Flächenbasis „${basis === 'gf' ? 'GF' : 'VKF'}".`
          : `Nettomiete p.a. und CHF/m²·a, Flächenbasis „${basis === 'gf' ? 'GF' : 'VMF'}".`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead><tr>
              <th className="px-2 py-1.5 text-left text-sm font-medium text-slate-900 border-b border-slate-300">Gebäude</th>
              {(verkauf
                ? ['Einheiten', 'Fläche m²', 'Ø m²', 'Erlös', 'Ø je Einheit', 'CHF/m²', 'Anteil']
                : ['Einheiten', 'Fläche m²', 'Ø m²', 'Netto/Mt', 'p.a.', 'CHF/m²·a', 'Anteil']
              ).map((h) => <th key={h} className={thc}>{h}</th>)}
            </tr></thead>
            <tbody>
              {byHaus.map(({ id, haus, s }) => { const a = sumW(s, (u) => flaecheOf(u, basis)), p = sumW(s, (u) => u.mietePa), n = countW(s)
                return <tr key={id} className="hover:bg-[#FAEFE9]">
                  <td className="px-2 py-1.5 text-left border-b border-slate-100"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: s[0] ? EIGENTUMSART_COLOR[s[0].eig] : undefined }} title={s[0]?.eigLabel} /><b>{haus}</b> <span className="text-[10px] text-slate-500">{s[0]?.eigLabel ?? ''}</span></td>
                  <td className={tdc}>{nf(n)}</td><td className={tdc}>{nf(a, 0)}</td><td className={tdc}>{nf(n > 0 ? a / n : 0, 1)}</td>
                  {verkauf
                    ? <><td className={tdc}>{nf(p)}</td><td className={tdc}>{nf(n > 0 ? p / n : 0)}</td></>
                    : <><td className={tdc}>{nf(p / 12)}</td><td className={tdc}>{nf(p)}</td></>}
                  <td className={tdc}>{nf(a > 0 ? p / a : 0)}</td><td className={tdc}>{pct(totP > 0 ? p / totP : 0)}</td>
                </tr> })}
            </tbody>
            <tfoot><tr className="font-bold">
              <td className="px-2 py-1.5 text-left border-t border-slate-300">Total</td>
              <td className="px-2 py-1.5 text-right tabular-nums border-t border-slate-300">{nf(totN)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums border-t border-slate-300">{nf(totA, 0)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums border-t border-slate-300">{nf(totN > 0 ? totA / totN : 0, 1)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums border-t border-slate-300">{nf(verkauf ? totP : totP / 12)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums border-t border-slate-300">{nf(verkauf ? (totN > 0 ? totP / totN : 0) : totP)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums border-t border-slate-300">{nf(totA > 0 ? totP / totA : 0)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums border-t border-slate-300">100 %</td>
            </tr></tfoot>
          </table>
        </div>
      </Card>

      <div className="space-y-4">
        <Card title="Wohnungsmix" hint="Oben nach Anzahl, unten nach Flächenanteil.">
          {zimSeg.length > 0 ? <>
            {/* Beide Balken in identischen Farben je Zimmerkategorie — oben Anzahl, unten Flächenanteil. */}
            <StackBar segs={zimSeg.map((m) => ({ flex: m.n, col: m.col, text: String(m.n), dark: readableText(m.col) === '#fff',
              label: `${zimmerTitel(m.z, m.label)} · ${nf(m.n)} Einheiten · ${pct(totN > 0 ? m.n / totN : 0, 0)} · Ø ${nf(m.n > 0 ? m.a / m.n : 0, 1)} m²` }))} />
            <div className="mt-2"><StackBar segs={zimSeg.map((m) => ({ flex: m.a, col: m.col, text: pct(totA > 0 ? m.a / totA : 0, 0), dark: readableText(m.col) === '#fff',
              label: `${zimmerTitel(m.z, m.label)} · ${nf(m.a, 0)} m² · ${pct(totA > 0 ? m.a / totA : 0, 0)} der Fläche` }))} /></div>
            <div className="mt-3 overflow-x-auto"><table className="w-full border-collapse text-sm"><thead><tr>
              <th className="px-2 py-1 text-left text-sm font-medium text-slate-900 border-b border-slate-300">Typ</th>
              {['Einheiten', 'Anteil', 'Ø m²', `Ø ${L.proM2}`].map((h) => <th key={h} className={thc}>{h}</th>)}</tr></thead>
              <tbody>{zimSeg.map((m) => <tr key={m.z}>
                <td className="px-2 py-1 text-left border-b border-slate-100"><span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: m.col }} />{m.label}</td>
                <td className={tdc}>{nf(m.n)}</td><td className={tdc}>{pct(totN > 0 ? m.n / totN : 0)}</td><td className={tdc}>{nf(m.n > 0 ? m.a / m.n : 0, 1)}</td>
                <td className={tdc}>{nf((spanne(m.s, (u) => chfM2a(u, basis))?.avg) ?? 0)}</td></tr>)}</tbody></table></div>
          </> : <p className="text-xs text-slate-400">Keine Wohnungen erfasst.</p>}
        </Card>

        <Card title={verkauf ? 'Preisspanne je Wohnungstyp' : 'Mietzinsspanne je Wohnungstyp'} hint={`${L.proM2} — Balken Min bis Max, ● Ø, kleiner Punkt Median.`}>
          {spn.length > 0 ? <RangeRows items={spn} dec={0} labW={92} familie={familie} /> : <p className="text-xs text-slate-400">Keine Wohnungen erfasst.</p>}
        </Card>
      </div>
    </div>
  )
}
function StackBar({ segs }: { segs: { flex: number; label: string; col: string; text: string; dark: boolean }[] }) {
  const tot = segs.reduce((s, x) => s + x.flex, 0) || 1
  const { bind, layer } = useTip()
  return <div className="flex h-8 overflow-hidden rounded border border-slate-200">
    {layer}
    {segs.map((s, i) => <div key={i} {...bind(s.label)} style={{ flex: s.flex, background: s.col, color: s.dark ? '#fff' : '#1A1A1A' }}
      className="flex items-center justify-center overflow-hidden whitespace-nowrap text-[11px]">{s.flex / tot > 0.05 ? s.text : ''}</div>)}
  </div>
}

// ── Miet-/Preisspiegel (Kacheln) ─────────────────────────────────────────────
function SpiegelTab({ units, fu, basis, modus, metric, setMetric, metricOf, metricFmt, onPick }: {
  units: AnalyseUnit[]; fu: AnalyseUnit[]; basis: FlaecheBasis; modus: Modus; metric: MetricKey
  setMetric: (m: MetricKey) => void; metricOf: (u: AnalyseUnit) => number; metricFmt: (v: number) => string; onPick: (u: AnalyseUnit) => void
}) {
  const L = LBL[modus]
  const selIds = new Set(fu.map((u) => u.id))
  const vals = units.map(metricOf)
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const t = (v: number) => (hi > lo ? (v - lo) / (hi - lo) : 0.5)
  const byHaus = [...new Map(units.map((u) => [u.hausId, u.haus])).entries()]
  // Einfärbung in der Farbfamilie der Nutzungsart (Blau / Grün / Rot), damit die
  // Kacheln zur Verteilungsleiste und zu den Gebäude-Headern oben passen.
  const eigsPresent = EIGENTUMSART_ORDER.filter((e) => units.some((u) => u.eig === e))
  const { bind, layer } = useTip()
  return (
    <Card title={L.spiegel} hint="Gebäude als Spalten, Geschosse von oben nach unten. Einfärbung über den gesamten Bestand (Häuser vergleichbar); ausgefilterte Einheiten sind ausgegraut. Klick auf eine Kachel öffnet das Datenblatt.">
      {layer}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[9.5px] uppercase tracking-wider text-slate-400">Einfärbung</span>
        {L.metrics.map(([k, l]) => <Chip key={k} on={metric === k} onClick={() => setMetric(k)}>{l}</Chip>)}
      </div>
      <div className="grid gap-3.5" style={{ gridTemplateColumns: `repeat(${Math.min(byHaus.length, 5)}, minmax(180px, 1fr))` }}>
        {byHaus.map(([hid, haus]) => {
          const hu = units.filter((u) => u.hausId === hid)
          const eig = hu[0]?.eig
          const floors = [...new Map(hu.map((u) => [u.geschoss, u.geschossRang])).entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g)
          const a = sumW(hu, (u) => flaecheOf(u, basis)), p = sumW(hu, (u) => u.mietePa)
          // Kein Treffer im Haus → ganze Karte inkl. Header ausbleichen,
          // statt nur die Kacheln.
          const hausAktiv = hu.some((u) => selIds.has(u.id))
          return (
            <div key={hid} className="overflow-hidden rounded-lg border border-slate-200"
              style={{ opacity: hausAktiv ? 1 : 0.25 }}>
              <div className="border-b border-slate-200 px-3 py-2" style={{ backgroundColor: eig ? EIGENTUMSART_COLOR[eig] : undefined, color: HEADER_TEXT }}>
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-sm font-semibold">{haus}</div>
                  <div className="text-[10px] tabular-nums opacity-80">{nf(countW(hu))} · {nf(a, 0)} m²</div>
                </div>
                <div className="text-[10px] tabular-nums opacity-80">{hu[0]?.eigLabel ?? ''} · Ø {nf(a > 0 ? p / a : 0)} {L.proM2}</div>
              </div>
              {floors.map((g) => {
                const gu = hu.filter((u) => u.geschoss === g).sort((x, y) => (x.wohnungsnummer || x.bezeichnung || '').localeCompare(y.wohnungsnummer || y.bezeichnung || ''))
                return (
                  <div key={g} className="border-b border-dashed border-slate-100 px-2.5 py-2 last:border-0">
                    <div className="mb-1.5 text-[9.5px] uppercase tracking-[0.12em] text-slate-400">{g}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {gu.map((u) => { const tv = t(metricOf(u)), bg = rampOf(EIGENTUMSART_FAMILY[u.eig], tv), fg = readableText(bg)
                        // Innerhalb einer aktiven Karte einzelne Treffer hervorheben;
                        // ist die ganze Karte ausgeblichen, bleiben die Kacheln normal.
                        const dim = hausAktiv && !selIds.has(u.id)
                        const code = u.wohnungsnummer || u.bezeichnung || u.zimmerLabel
                        return (
                          <button key={u.id} type="button" onClick={() => onPick(u)} {...bind(`${code} · ${u.zimmerLabel} · ${nf(flaecheOf(u, basis), 1)} m² · ${nf(wertOf(u, modus))} ${modus === 'verkauf' ? 'CHF' : 'CHF/Mt'}`)}
                            className="min-w-[76px] flex-1 rounded border border-black/5 px-1.5 py-1.5 text-left transition hover:outline hover:outline-2 hover:outline-slate-900"
                            style={{ background: bg, color: fg, opacity: dim ? 0.2 : 1, pointerEvents: selIds.has(u.id) ? 'auto' : 'none' }}>
                            <div className="truncate text-[11px] font-bold">{code}{u.anzahl > 1 ? ` ×${u.anzahl}` : ''}</div>
                            <div className="text-[10px] opacity-75">{u.zimmerLabel} · {nf(u.vmf, 0)} m²</div>
                            <div className="mt-0.5 text-[13px] tabular-nums">{metricFmt(metricOf(u))}</div>
                          </button>
                        ) })}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      <div className="mt-3 space-y-1 text-[11px] text-slate-500">
        <div className="text-[9.5px] uppercase tracking-wider text-slate-400">Skala: {L.metrics.find((m) => m[0] === metric)![1]} — je Nutzungsart in ihrer Farbfamilie</div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          {eigsPresent.map((e) => (
            <span key={e} className="inline-flex items-center gap-1.5">
              <span className="text-slate-600">{EIGENTUMSART_LABEL[e]}</span>
              <span className="tabular-nums">{metricFmt(lo)}</span>
              {[0, 0.25, 0.5, 0.75, 1].map((v) => <span key={v} className="inline-block h-3 w-5 border border-black/10" style={{ background: rampOf(EIGENTUMSART_FAMILY[e], v) }} />)}
              <span className="tabular-nums">{metricFmt(hi)}</span>
            </span>
          ))}
        </div>
      </div>
    </Card>
  )
}

// ── Wohnungs- & Nutzungsmix ──────────────────────────────────────────────────
function MixTab({ fu, basis, familie }: { fu: AnalyseUnit[]; basis: FlaecheBasis; familie: CiFamily }) {
  const wohn = fu.filter((u) => u.istWohnen)
  const zimKeys = [...new Set(wohn.map((u) => u.zimmerKey))].sort((a, b) => zimmerSort(a) - zimmerSort(b))
  const zLabel = (k: string) => wohn.find((u) => u.zimmerKey === k)?.zimmerLabel ?? k
  const haeuser = [...new Map(fu.map((u) => [u.hausId, u.haus])).entries()]
  const maxCell = Math.max(1, ...haeuser.flatMap(([hid]) => zimKeys.map((z) => countW(wohn.filter((u) => u.hausId === hid && u.zimmerKey === z)))))

  // Farbe je Nutzung — Helligkeitsstufen derselben Kupfer-Familie, sortiert nach
  // Flächenanteil (grösste Nutzung am dunkelsten). Nutzungsmix und
  // Geschossverteilung verwenden dieselbe Zuordnung.
  const nutzungen = [...new Set(fu.map((u) => u.nutzung))]
    .map((n) => ({ n, fl: sumW(fu.filter((u) => u.nutzung === n), (x) => flaecheOf(x, basis)) }))
    .sort((a, b) => b.fl - a.fl).map((x) => x.n)
  const nutzFarbe: Record<string, string> = {}
  nutzungen.forEach((n, i) => {
    const t = nutzungen.length > 1 ? i / (nutzungen.length - 1) : 0
    nutzFarbe[n] = rampOf(familie, 1 - 0.8 * t) // dunkel → hell, ohne den fast weissen Rand
  })

  const nutz = nutzungen.map((n) => { const s = fu.filter((u) => u.nutzung === n); const fl = sumW(s, (u) => flaecheOf(u, basis))
    return { label: n, segs: [{ label: n, value: fl, color: nutzFarbe[n] }], text: `${nf(fl, 0)} m² · ${nf(countW(s))}` } })
  const typenRoh = [...new Set(fu.map((u) => u.wohnungstyp).filter((x): x is string => !!x))].map((t) => { const s = fu.filter((u) => u.wohnungstyp === t); return { label: t, value: countW(s), text: String(countW(s)) } }).sort((a, b) => b.value - a.value)
  const typen = typenRoh.map((t, i) => ({ ...t, color: rampOf(familie, 1 - 0.8 * (typenRoh.length > 1 ? i / (typenRoh.length - 1) : 0)) }))
  // Geschosse: Balken nach Nutzung unterteilt, in denselben Farben.
  const gesch = [...new Map(fu.map((u) => [u.geschoss, u.geschossRang])).entries()].sort((a, b) => b[1] - a[1]).map(([g]) => {
    const s = fu.filter((u) => u.geschoss === g)
    return { label: g, text: nf(countW(s)), segs: nutzungen.map((n) => ({ label: n, value: countW(s.filter((u) => u.nutzung === n)), color: nutzFarbe[n] })) }
  })
  // Wohnungstypen in denselben Farben wie im Reiter «Übersicht».
  const groessen = zimKeys.map((z) => { const s = wohn.filter((u) => u.zimmerKey === z); return { label: zLabel(z), value: countW(s), text: String(countW(s)), color: zimmerFarbe(z, familie), sub: `Ø ${nf(spanne(s, (u) => flaecheOf(u, basis))?.avg ?? 0, 0)} m²` } })

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Nutzungsmix" hint={`Fläche „${basis === 'gf' ? 'GF' : 'VMF'}" und Anzahl je Nutzung.`}>
          {nutz.length ? <StackedBars items={nutz} labW={120} valW={130} rowH={28} einheit=" m²" /> : <p className="text-xs text-slate-400">–</p>}
        </Card>
        <Card title="Wohnungsgrössen" hint="Anzahl Wohnungen je Zimmerzahl, mit Ø-Fläche.">
          {groessen.length ? <Cols items={groessen} h={210} /> : <p className="text-xs text-slate-400">Keine Wohnungen.</p>}
        </Card>
      </div>

      {/* Mix-Matrix und Geschoss-/Typverteilung nebeneinander */}
      <div className="grid gap-4 lg:grid-cols-2">
        {wohn.length > 0 && haeuser.length > 0 && zimKeys.length > 0 && (
        <Card title="Mix nach Gebäude und Zimmerzahl" hint="Anzahl Wohnungen. Dunklere Felder = mehr Einheiten desselben Typs.">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm"><thead><tr>
              <th className="px-2 py-1.5 text-left text-sm font-medium text-slate-900 border-b border-slate-300">Gebäude</th>
              {zimKeys.map((z) => <th key={z} className={thc}>{zLabel(z)}</th>)}
              <th className={thc}>Total</th><th className={thc}>Fläche m²</th></tr></thead>
              <tbody>{haeuser.map(([hid, haus]) => { const hu = wohn.filter((u) => u.hausId === hid); if (!hu.length) return null
                return <tr key={hid}><td className="px-2 py-1.5 text-left border-b border-slate-100"><b>{haus}</b></td>
                  {zimKeys.map((z) => { const n = countW(hu.filter((u) => u.zimmerKey === z))
                    const bg = n ? rampOf(familie, n / maxCell) : undefined
                    return <td key={z} className="px-2 py-1.5 text-right tabular-nums border-b border-slate-100" style={{ background: bg, color: n && n / maxCell > 0.58 ? '#fff' : undefined }}>{n || '–'}</td> })}
                  <td className={tdc}><b>{nf(countW(hu))}</b></td><td className={tdc}>{nf(sumW(hu, (u) => flaecheOf(u, basis)), 0)}</td></tr> })}</tbody>
              <tfoot><tr className="font-bold"><td className="px-2 py-1.5 text-left border-t border-slate-300">Total</td>
                {zimKeys.map((z) => <td key={z} className="px-2 py-1.5 text-right tabular-nums border-t border-slate-300">{nf(countW(wohn.filter((u) => u.zimmerKey === z)))}</td>)}
                <td className="px-2 py-1.5 text-right tabular-nums border-t border-slate-300">{nf(countW(wohn))}</td>
                <td className="px-2 py-1.5 text-right tabular-nums border-t border-slate-300">{nf(sumW(wohn, (u) => flaecheOf(u, basis)), 0)}</td></tr></tfoot>
            </table>
          </div>
        </Card>
        )}
        <div className="space-y-4">
          <Card title="Geschossverteilung" hint="Anzahl Einheiten je Geschoss, unterteilt nach Nutzung."><StackedBars items={gesch} labW={80} valW={44} rowH={24} /></Card>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-[11px] text-slate-600">
            {nutzungen.map((n) => (
              <span key={n} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: nutzFarbe[n] }} />{n}
              </span>
            ))}
          </div>
          {typen.length > 0 && <Card title="Wohnungstyp" hint="Verteilung nach erfasstem Wohnungstyp."><HBars items={typen} labW={130} valW={50} rowH={26} /></Card>}
        </div>
      </div>
    </div>
  )
}

// ── Preisanalyse ─────────────────────────────────────────────────────────────
function PreisTab({ fu, basis, modus, familie, onPick }: { fu: AnalyseUnit[]; basis: FlaecheBasis; modus: Modus; familie: CiFamily; onPick: (u: AnalyseUnit) => void }) {
  const L = LBL[modus]
  const verkauf = modus === 'verkauf'
  const wert = (u: AnalyseUnit) => wertOf(u, modus)
  const wertLab = verkauf ? 'Verkaufserlös CHF' : 'Netto CHF/Mt'
  const byId = new Map(fu.map((u) => [u.id, u]))
  const zimKeys = [...new Set(fu.filter((u) => u.istWohnen).map((u) => u.zimmerKey))].sort((a, b) => zimmerSort(a) - zimmerSort(b))
  const eigs = EIGENTUMSART_ORDER.filter((e) => fu.some((u) => u.eig === e))
  const useEig = eigs.length > 1
  const zcol = (u: AnalyseUnit) => zimmerFarbe(u.zimmerKey, familie)
  const colorOf = (u: AnalyseUnit) => (useEig ? EIGENTUMSART_COLOR[u.eig] : zcol(u))
  const legend = useEig
    ? eigs.map((e) => ({ label: EIGENTUMSART_LABEL[e], color: EIGENTUMSART_COLOR[e] }))
    : zimKeys.map((z) => ({ label: fu.find((u) => u.zimmerKey === z)?.zimmerLabel ?? z, color: zimmerFarbe(z, familie) }))
  const pts = fu.map((u) => ({ x: flaecheOf(u, basis), y: wert(u), color: colorOf(u), id: u.id, label: `${u.wohnungsnummer || u.bezeichnung || u.zimmerLabel} · ${u.eigLabel} · ${nf(flaecheOf(u, basis), 1)} m² · ${nf(wert(u))} ${verkauf ? 'CHF' : 'CHF/Mt'} · ${nf(chfM2a(u, basis))} ${L.proM2}` }))
  const pts2 = fu.map((u) => ({ x: flaecheOf(u, basis), y: chfM2a(u, basis), color: colorOf(u), id: u.id, label: `${u.wohnungsnummer || u.bezeichnung || u.zimmerLabel} · ${u.eigLabel} · ${nf(flaecheOf(u, basis), 1)} m² · ${nf(chfM2a(u, basis))} ${L.proM2}` }))
  const reg1 = regression(pts), reg2 = regression(pts2)
  const spBy = (keyFn: (u: AnalyseUnit) => string, order: string[]) => order.map((k) => { const s = fu.filter((u) => keyFn(u) === k); const sp = spanne(s, (u) => chfM2a(u, basis)); return sp ? { label: k, ...sp } : null }).filter((x): x is NonNullable<typeof x> => !!x)
  const spZim = zimKeys.map((z) => { const s = fu.filter((u) => u.zimmerKey === z); const sp = spanne(s, (u) => chfM2a(u, basis)); return sp ? { label: `${s[0]?.zimmerLabel ?? z} (${countW(s)})`, ...sp } : null }).filter((x): x is NonNullable<typeof x> => !!x)
  const spGesch = spBy((u) => u.geschoss, [...new Map(fu.map((u) => [u.geschoss, u.geschossRang])).entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g))
  const spHaus = spBy((u) => u.haus, [...new Set(fu.map((u) => u.haus))])
  const hist1 = histogram(fu, wert, L.binWert), hist2 = histogram(fu, (u) => chfM2a(u, basis), L.binM2)
  const ranked = fu.slice().sort((a, b) => chfM2a(b, basis) - chfM2a(a, basis))

  const rankTable = (arr: AnalyseUnit[], title: string) => (
    <table className="w-full border-collapse text-sm"><thead><tr>
      <th className="px-2 py-1.5 text-left text-sm font-medium text-slate-900 border-b border-slate-300">{title}</th>
      {['Zi', 'm²', verkauf ? 'CHF' : 'CHF/Mt', L.proM2].map((h) => <th key={h} className={thc}>{h}</th>)}</tr></thead>
      <tbody>{arr.map((u) => <tr key={u.id} onClick={() => onPick(u)} className="cursor-pointer hover:bg-[#FAEFE9]">
        <td className="px-2 py-1.5 text-left border-b border-slate-100"><b>{u.wohnungsnummer || u.bezeichnung || u.zimmerLabel}</b> <span className="rounded-full bg-[#FAEFE9] px-1.5 text-[10px] text-[#8B6956]">{u.haus}</span></td>
        <td className={tdc}>{u.zimmer ?? '–'}</td><td className={tdc}>{nf(flaecheOf(u, basis), 1)}</td><td className={tdc}>{nf(wert(u))}</td><td className={tdc}><b>{nf(chfM2a(u, basis))}</b></td></tr>)}</tbody></table>
  )

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={verkauf ? 'Fläche und Verkaufspreis' : 'Fläche und Mietzins'} hint={`Jeder Punkt eine Einheit, eingefärbt nach Nutzungsart bzw. Zimmerzahl (siehe Legende). Gestrichelt die lineare Regression (${verkauf ? 'CHF' : 'CHF/Mt'} pro zusätzlichem m²).`}>
          <Scatter pts={pts} xLab="Fläche m²" yLab={wertLab} trend={reg1 ? { ...reg1, unit: 'CHF', xunit: 'm²' } : null} onPick={(id) => byId.get(id) && onPick(byId.get(id)!)} />
        </Card>
        <Card title="Flächendegression" hint={`${L.proM2} über die Fläche. Ein fallender Trend ist erwünscht — grosse Wohnungen kosten pro m² weniger.`}>
          <Scatter pts={pts2} xLab="Fläche m²" yLab={L.proM2} trend={reg2 ? { ...reg2, unit: 'CHF/m²', xunit: 'm²' } : null} onPick={(id) => byId.get(id) && onPick(byId.get(id)!)} />
        </Card>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="uppercase tracking-wider text-slate-400">Farbe: {useEig ? 'Nutzungsart' : 'Zimmerzahl'}</span>
        {legend.map((l, i) => <span key={i} className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />{l.label}</span>)}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Spanne je Zimmerzahl" hint={L.proM2}>{spZim.length ? <RangeRows items={spZim} dec={0} labW={104} familie={familie} /> : <p className="text-xs text-slate-400">–</p>}</Card>
        <Card title="Spanne je Geschoss" hint={L.proM2}>{spGesch.length ? <RangeRows items={spGesch} dec={0} labW={80} familie={familie} /> : <p className="text-xs text-slate-400">–</p>}</Card>
        <Card title="Spanne je Gebäude" hint={L.proM2}>{spHaus.length ? <RangeRows items={spHaus} dec={0} labW={80} familie={familie} /> : <p className="text-xs text-slate-400">–</p>}</Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={L.streuung} hint={`Klassenbreite ${nf(L.binWert)} CHF.`}><Cols items={hist1.map((h) => ({ label: nf(h.label), value: h.count, text: h.count ? String(h.count) : '' }))} h={200} color={CI[familie][7]} /></Card>
        <Card title={`Verteilung ${L.proM2}`} hint={`Klassenbreite ${nf(L.binM2)} CHF. Breite Streuung bei gleicher Zimmerzahl = uneinheitliche Ansätze.`}><Cols items={hist2.map((h) => ({ label: nf(h.label), value: h.count, text: h.count ? String(h.count) : '' }))} h={200} color={CI[familie][7]} /></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Teuerste je m²" hint={`Höchste ${L.proM2}.`}>{rankTable(ranked.slice(0, 10), 'Einheit')}</Card>
        <Card title="Günstigste je m²" hint={`Tiefste ${L.proM2}.`}>{rankTable(ranked.slice(-10).reverse(), 'Einheit')}</Card>
      </div>
    </div>
  )
}

// ── Tabelle ──────────────────────────────────────────────────────────────────
function TabelleTab({ fu, basis, modus, onPick }: { fu: AnalyseUnit[]; basis: FlaecheBasis; modus: Modus; onPick: (u: AnalyseUnit) => void }) {
  const L = LBL[modus]
  const verkauf = modus === 'verkauf'
  const [sortK, setSortK] = useState<string>('haus')
  const [dir, setDir] = useState(1)
  const [q, setQ] = useState('')
  const cols: { k: string; l: string; val: (u: AnalyseUnit) => number | string; num?: boolean }[] = [
    { k: 'haus', l: 'Gebäude', val: (u) => u.haus }, { k: 'geschoss', l: 'Geschoss', val: (u) => u.geschossRang, num: true },
    { k: 'nr', l: 'Nr.', val: (u) => u.wohnungsnummer || u.bezeichnung || '' }, { k: 'nutzung', l: 'Nutzung', val: (u) => u.nutzung },
    { k: 'typ', l: 'Wohnungstyp', val: (u) => u.wohnungstyp || '' }, { k: 'zimmer', l: 'Zi', val: (u) => u.zimmer ?? -1, num: true },
    { k: 'flaeche', l: 'Fläche m²', val: (u) => flaecheOf(u, basis), num: true },
    ...(verkauf
      ? [{ k: 'wert', l: 'Verkaufserlös', val: (u: AnalyseUnit) => u.mietePa, num: true }]
      : [{ k: 'wert', l: 'Netto/Mt', val: (u: AnalyseUnit) => u.mietePa / 12, num: true },
         { k: 'pa', l: 'p.a.', val: (u: AnalyseUnit) => u.mietePa, num: true }]),
    { k: 'm2a', l: L.proM2, val: (u) => chfM2a(u, basis), num: true },
  ]
  const ql = q.trim().toLowerCase()
  const rows = fu.filter((u) => !ql || `${u.haus} ${u.geschoss} ${u.wohnungsnummer ?? ''} ${u.bezeichnung ?? ''} ${u.nutzung} ${u.wohnungstyp ?? ''} ${u.zimmerLabel}`.toLowerCase().includes(ql))
  const col = cols.find((c) => c.k === sortK)!
  const sorted = rows.slice().sort((a, b) => { const va = col.val(a), vb = col.val(b); const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb)); return c * dir })
  const setSort = (k: string) => { if (k === sortK) setDir((d) => -d); else { setSortK(k); setDir(1) } }
  return (
    <Card title="Alle Einheiten" hint="Sortier- und durchsuchbar. Klick auf eine Zeile öffnet das Datenblatt.">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suche Gebäude, Nr., Nutzung, Typ …"
        className="mb-2 w-full max-w-sm rounded-md border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#8B6956] sm:w-72" />
      <div className="max-h-[600px] overflow-auto rounded border border-slate-200">
        <table className="w-full border-collapse text-sm">
          <thead><tr>{cols.map((c) => (
            <th key={c.k} onClick={() => setSort(c.k)} className={cn('sticky top-0 z-10 cursor-pointer select-none bg-white px-2 py-1.5 text-sm font-medium text-slate-900 border-b border-slate-300', c.num ? 'text-right' : 'text-left')}>
              {c.l}{sortK === c.k ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>))}</tr></thead>
          {/* Zeilen im hellsten Ton der Nutzungsart-Farbe (Rendite blau,
              Genossenschaft grün, Verkauf rot) — Hover über brightness, weil
              eine Klassen-Hintergrundfarbe gegen das Inline-Style verliert. */}
          <tbody>{sorted.map((u) => <tr key={u.id} onClick={() => onPick(u)} className="cursor-pointer transition hover:brightness-95"
            style={{ backgroundColor: CI[EIGENTUMSART_FAMILY[u.eig]][1] }}>
            <td className="px-2 py-1 text-left border-b border-slate-100"><b>{u.haus}</b></td>
            <td className="px-2 py-1 text-left border-b border-slate-100">{u.geschoss}</td>
            <td className="px-2 py-1 text-left border-b border-slate-100">{u.wohnungsnummer || u.bezeichnung || '–'}{u.anzahl > 1 ? ` ×${u.anzahl}` : ''}</td>
            <td className="px-2 py-1 text-left border-b border-slate-100">{u.nutzung}</td>
            <td className="px-2 py-1 text-left border-b border-slate-100">{u.wohnungstyp || '–'}</td>
            <td className={tdc}>{u.zimmer ?? '–'}</td><td className={tdc}>{nf(flaecheOf(u, basis), 1)}</td>
            <td className={tdc}>{nf(wertOf(u, modus))}</td>{!verkauf && <td className={tdc}>{nf(u.mietePa)}</td>}<td className={tdc}><b>{nf(chfM2a(u, basis))}</b></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="mt-1 text-[11px] text-slate-400">{nf(countW(sorted))} Einheiten</div>
    </Card>
  )
}

// ── Detail-Drawer ────────────────────────────────────────────────────────────
function Drawer({ u, basis, modus, onClose }: { u: AnalyseUnit; basis: FlaecheBasis; modus: Modus; onClose: () => void }) {
  const L = LBL[modus]
  const verkauf = modus === 'verkauf'
  const row = (l: string, v: React.ReactNode) => <><div className="text-slate-500">{l}</div><div className="text-right tabular-nums text-slate-800">{v}</div></>
  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 z-[80] h-full w-[390px] max-w-[92vw] overflow-y-auto border-l border-slate-300 bg-white p-6 shadow-2xl">
        <button type="button" onClick={onClose} className="absolute right-4 top-3 text-xl text-slate-400 hover:text-slate-700">×</button>
        <div className="text-[9.5px] uppercase tracking-[0.13em] text-[#8B6956]">{u.eigLabel} · {u.etappe}</div>
        <h3 className="mt-1 text-2xl font-light text-slate-900">{u.wohnungsnummer || u.bezeichnung || u.zimmerLabel}</h3>
        <div className="text-xs text-slate-500">{u.haus} · {u.geschoss} · {u.nutzung}</div>
        <div className="mt-4 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[12.5px]">
          {row('Wohnungstyp', u.wohnungstyp || '–')}
          {row('Zimmer', u.zimmer ?? '–')}
          {row(basis === 'gf' ? 'Fläche GF' : 'Fläche VMF', `${nf(flaecheOf(u, basis), 1)} m²`)}
          {u.anzahl > 1 && row('Anzahl gleicher Einheiten', `×${u.anzahl}`)}
        </div>
        <div className="mt-5 border-b border-slate-200 pb-1 text-[9.5px] uppercase tracking-[0.13em] text-[#8B6956]">
          {verkauf ? 'Verkauf' : `Ertrag${u.ausKostenmiete ? ' (Kostenmiete)' : ''}`}
        </div>
        <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[12.5px]">
          {verkauf ? <>
            {row('Verkaufserlös', `${nf(u.mietePa)} CHF`)}
            {row('CHF/m²', nf(chfM2a(u, basis)))}
            {row('Zeitbezug', <span className="text-slate-400">einmalig</span>)}
          </> : <>
            {row('Nettomiete / Monat', `${nf(u.mietePa / 12)} CHF`)}
            {row('Nettomiete p.a.', `${nf(u.mietePa)} CHF`)}
            {row(L.proM2, nf(chfM2a(u, basis)))}
            {row('CHF/m² pro Monat', nf(chfM2a(u, basis) / 12, 2))}
          </>}
        </div>
        {u.ausKostenmiete && (
          <>
            <div className="mt-4 border-b border-slate-200 pb-1 text-[9.5px] uppercase tracking-[0.13em] text-slate-400">Vergleichswert Mengengerüst</div>
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[12.5px]">
              {row('Erfasster Mietzins / Monat', u.benchmarkPa ? `${nf(u.benchmarkPa / 12)} CHF` : '–')}
              {row('Erfasst CHF/m²·a', u.benchmarkPa && u.vmf > 0 ? nf(u.benchmarkPa / flaecheOf(u, basis)) : '–')}
              {row('Differenz zur Kostenmiete', u.benchmarkPa ? `${u.mietePa >= u.benchmarkPa ? '+' : ''}${nf(u.mietePa - u.benchmarkPa)} CHF p.a.` : '–')}
            </div>
          </>
        )}
      </div>
    </>
  )
}
