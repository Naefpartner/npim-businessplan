import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Waves, Plus, Trash2, ChevronDown, ChevronRight, AlertTriangle, GripVertical } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useUndoableState } from '@/contexts/UndoContext'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { useMittelfluss } from '@/hooks/useMittelfluss'
import { useHonorar } from '@/hooks/useHonorar'
import { posSortKey } from '@/hooks/useAnlagekosten'
import { berechneHonorare, type HonorarInput } from '@/lib/honorar'
import { EIGENTUMSART_LABEL, type Eigentumsart } from '@/types'
import { HAUPTGRUPPEN, type BkpPosition } from '@/lib/bkpKatalog'
import type { BkpErgebnis } from '@/lib/bkpBerechnung'
import { formatNumber } from '@/lib/utils'
import { CI } from '@/lib/ci'
import {
  type MittelflussDoc, type MfPhase, type MfQuartal,
  defaultMittelflussDoc, quartaleZwischen,
  monatDiff, monatAdd, honorarPhasenGewichte, resolvePhasen,
} from '@/lib/mittelfluss'

const EMPTY_HON: HonorarInput = { anlagekosten: {}, factors: {}, pauschal: {} }

// Gemeinsame Spaltengeometrie für Terminplan UND Kostentabelle (px), damit die
// Quartalsspalten exakt übereinanderstehen.
const LEFT_POS = 420
const COL_GESAMT = 104
const COL_Q = 78
const COL_CTRL = 84
const COL_SUM = 96

// Farbton (hex + Alpha) für Quartals-Einfärbung; undefined → kein Ton.
const tint = (c: string | undefined, a: string) => (c ? `${c}${a}` : undefined)

// Segment-Verlauf über die Monate eines Quartals (harte Farbwechsel je Monat).
// Bei nur einer Farbe → einfarbig; ohne Phase → undefined.
function segBackground(monthColors: (string | undefined)[] | undefined, alpha: string): string | undefined {
  if (!monthColors || monthColors.length === 0 || monthColors.every((c) => !c)) return undefined
  const m = monthColors.length
  if (m === 1) return tint(monthColors[0], alpha)
  const stops: string[] = []
  for (let j = 0; j < m; j++) {
    const col = monthColors[j] ? `${monthColors[j]}${alpha}` : 'transparent'
    stops.push(`${col} ${(j / m) * 100}%`, `${col} ${((j + 1) / m) * 100}%`)
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

interface MfRow {
  key: string
  label: string
  hauptgruppe: number
  netto: number
  mwst: number
  brutto: number
  kind: 'normal' | 'honorar' | 'finanzierung'
  rate?: number
  share?: number
}
interface QCell { pct: number; netto: number; mwst: number; brutto: number }
interface QGeo { monthStart: number; months: number }

// Anzeige-Zeile: Basis-Zeile + Verteilungs-Scope, Einrückung, Kopf/Editier-Flag.
interface MfDispRow extends MfRow {
  scope: string      // Verteilungs-Scope `${etappe}|${eig}`
  posKey: string     // Verteilungs-Positionsschlüssel
  indent: number     // 0 = Position/Gesamt, 1 = Etappen-Unterzeile
  isHeader: boolean  // Kopfzeile im Etappen-Modus (read-only, Summe der Kinder)
  editable: boolean  // hat %-Eingabefelder
  groupId?: string   // verbindet Kopfzeile mit ihren Etappen-Kindern
}

export function MittelflussSection({ projectId, variantId, defaultExpanded = false }: {
  projectId: string
  variantId: string
  defaultExpanded?: boolean
}) {
  const { canWrite } = useAuth()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const ak = useAnlagekostenShared()

  // ── Persistenz (JSONB pro Variante) + globales Undo/Redo, robuster Save ──────
  const { loaded, loading, save } = useMittelfluss(variantId)
  const [doc, setDoc, setDocSilent] = useUndoableState<MittelflussDoc>(defaultMittelflussDoc, 'Mittelfluss')
  const hydrated = useRef(false)
  const lastSaved = useRef<MittelflussDoc | null>(null)
  const docRef = useRef(doc)
  const saveRef = useRef(save)
  useLayoutEffect(() => { docRef.current = doc; saveRef.current = save })
  useEffect(() => {
    if (loading || hydrated.current) return
    const init = loaded ?? defaultMittelflussDoc()
    lastSaved.current = init
    docRef.current = init
    hydrated.current = true
    setDocSilent(init)
  }, [loading, loaded, setDocSilent])
  useEffect(() => {
    if (!hydrated.current || doc === lastSaved.current) return
    const t = setTimeout(() => { lastSaved.current = docRef.current; void saveRef.current(docRef.current) }, 600)
    return () => clearTimeout(t)
  }, [doc, save])
  useEffect(() => () => {
    if (hydrated.current && docRef.current !== lastSaved.current) {
      lastSaved.current = docRef.current
      void saveRef.current(docRef.current)
    }
  }, [])

  // ── Honorar-Phasen-Gewichte (für die Aufteilung 690a/690b) ───────────────────
  const { loaded: honorarDoc } = useHonorar(projectId)
  const honGewichte = useMemo(() => {
    if (!honorarDoc) return []
    const input = honorarDoc.inputs[variantId] ?? EMPTY_HON
    const res = berechneHonorare(input, honorarDoc.planer, {
      nebenkosten: honorarDoc.nebenkostenPct, mwst: honorarDoc.mwstPct, gp: honorarDoc.gpPct,
    })
    return honorarPhasenGewichte(res.phasen)
  }, [honorarDoc, variantId])

  // ── Ansicht: Verteilungs-Modus (Gesamt / nach Etappe) × Eigentumsart ─────────
  const [verteilModus, setVerteilModus] = useState<'gesamt' | 'etappe'>('gesamt')
  const [eigSel, setEigSel] = useState('gesamt')
  const eigsInScope = useMemo<Eigentumsart[]>(
    () => (eigSel === 'gesamt' ? ak.presentEig : [eigSel as Eigentumsart]),
    [eigSel, ak.presentEig],
  )
  const etappen = useMemo(() => ak.etappen ?? [], [ak.etappen])
  // Fremdfinanzierung/Zins beziehen sich auf den Gesamt-Saldo (je Eigentumsart-Ansicht).
  const fremdScope = `fremd|${eigSel}`

  const rows = useMemo<MfDispRow[]>(() => {
    const posMeta = new Map<string, BkpPosition>()
    for (const eig of eigsInScope) for (const p of (ak.positionsByEig.get(eig) ?? [])) if (!posMeta.has(p.code)) posMeta.set(p.code, p)
    const istFinanz = (code: string) => eigsInScope.some((eig) => ak.typForByEig.get(eig)?.(code)?.kind === 'finanzierung')
    const sumBis41 = honGewichte.filter((g) => g.group === 'bis41').reduce((s, g) => s + g.weight, 0)
    const sumAb51 = honGewichte.filter((g) => g.group === 'ab51').reduce((s, g) => s + g.weight, 0)
    const bkp2Label = `2 · ${HAUPTGRUPPEN.find((h) => h.code === 2)?.label ?? 'Gebäude'} (BKP 2 gesamt)`

    // Basiszeilen (Positionen/Honorarphasen/BKP2/Finanzierung) für einen Kosten-Scope.
    const buildBase = (ergFor: (eig: Eigentumsart) => BkpErgebnis | undefined): MfRow[] => {
      const acc = new Map<string, { netto: number; mwst: number; brutto: number; kennwert: number | null; kennwert2: number | null }>()
      for (const eig of eigsInScope) {
        const erg = ergFor(eig)
        if (!erg) continue
        for (const code of Object.keys(erg.positionen)) {
          const p = erg.positionen[code]
          const cur = acc.get(code) ?? { netto: 0, mwst: 0, brutto: 0, kennwert: null, kennwert2: null }
          cur.netto += p.betragNetto ?? 0
          cur.mwst += p.mwstBetrag ?? 0
          cur.brutto += p.betragBrutto ?? 0
          if (cur.kennwert == null) cur.kennwert = p.kennwert
          if (cur.kennwert2 == null) cur.kennwert2 = p.kennwert2 ?? null
          acc.set(code, cur)
        }
      }
      const codes = [...acc.keys()].sort((a, b) => {
        const pa = posMeta.get(a), pb = posMeta.get(b)
        return (pa?.hauptgruppe ?? 9) - (pb?.hauptgruppe ?? 9) || posSortKey(pa ?? ({} as BkpPosition)) - posSortKey(pb ?? ({} as BkpPosition))
      })
      const bkp2 = { netto: 0, mwst: 0, brutto: 0 }
      for (const code of codes) if (posMeta.get(code)?.hauptgruppe === 2) { const a = acc.get(code)!; bkp2.netto += a.netto; bkp2.mwst += a.mwst; bkp2.brutto += a.brutto }
      let bkp2Pushed = false
      const out: MfRow[] = []
      for (const code of codes) {
        const a = acc.get(code)!
        const meta = posMeta.get(code)
        const hg = meta?.hauptgruppe ?? 9
        if (hg === 2) {
          if (!bkp2Pushed) { if (Math.abs(bkp2.brutto) >= 0.5) out.push({ key: 'hg2', label: bkp2Label, hauptgruppe: 2, netto: bkp2.netto, mwst: bkp2.mwst, brutto: bkp2.brutto, kind: 'normal' }); bkp2Pushed = true }
          continue
        }
        const disp = meta?.displayCode ?? meta?.code ?? code
        if (Math.abs(a.brutto) < 0.5 && !(code === '690a' || code === '690b')) continue
        if (istFinanz(code)) { out.push({ key: code, label: `${disp} · ${meta?.label ?? ''}`, hauptgruppe: hg, netto: a.netto, mwst: a.mwst, brutto: a.brutto, kind: 'finanzierung', rate: a.kennwert ?? 0, share: a.kennwert2 ?? 0.5 }); continue }
        if (code === '690a' && sumBis41 > 0 && Math.abs(a.brutto) >= 0.5) { for (const g of honGewichte) if (g.group === 'bis41') { const f = g.weight / sumBis41; out.push({ key: `hon:${g.gruppe}`, label: `690a · Phase ${g.gruppe} ${g.label}`, hauptgruppe: hg, netto: a.netto * f, mwst: a.mwst * f, brutto: a.brutto * f, kind: 'honorar' }) } continue }
        if (code === '690b' && sumAb51 > 0 && Math.abs(a.brutto) >= 0.5) { for (const g of honGewichte) if (g.group === 'ab51') { const f = g.weight / sumAb51; out.push({ key: `hon:${g.gruppe}`, label: `690b · Phase ${g.gruppe} ${g.label}`, hauptgruppe: hg, netto: a.netto * f, mwst: a.mwst * f, brutto: a.brutto * f, kind: 'honorar' }) } continue }
        out.push({ key: code, label: `${disp} · ${meta?.label ?? ''}`, hauptgruppe: hg, netto: a.netto, mwst: a.mwst, brutto: a.brutto, kind: 'normal' })
      }
      return out
    }

    const konsRows = buildBase((eig) => ak.konsolidiert.get(eig)?.ergebnis)
    const konsScope = `kons|${eigSel}`

    if (verteilModus === 'gesamt') {
      return konsRows.map((r) => ({ ...r, scope: konsScope, posKey: r.key, indent: 0, isHeader: false, editable: r.kind !== 'finanzierung' }))
    }

    // Etappen-Modus: je Position eine Kopfzeile + je Etappe eine editierbare Unterzeile.
    const etAmt = new Map<string, Map<string, MfRow>>()
    for (const et of etappen) {
      const rws = buildBase((eig) => ak.blockErgebnisse.get(`${et.id}::${eig}`))
      etAmt.set(et.id, new Map(rws.map((r) => [r.key, r])))
    }
    const disp: MfDispRow[] = []
    for (const r of konsRows) {
      if (r.kind === 'finanzierung') { disp.push({ ...r, scope: konsScope, posKey: r.key, indent: 0, isHeader: false, editable: false }); continue }
      disp.push({ ...r, scope: konsScope, posKey: r.key, indent: 0, isHeader: true, editable: false, groupId: r.key })
      for (const et of etappen) {
        const er = etAmt.get(et.id)?.get(r.key)
        disp.push({ key: `${r.key}@@${et.id}`, label: et.name, hauptgruppe: r.hauptgruppe, netto: er?.netto ?? 0, mwst: er?.mwst ?? 0, brutto: er?.brutto ?? 0, kind: r.kind, scope: `${et.id}|${eigSel}`, posKey: r.key, indent: 1, isHeader: false, editable: true, groupId: r.key })
      }
    }
    return disp
  }, [ak, eigsInScope, verteilModus, eigSel, etappen, honGewichte])

  // ── Zeitachse (Quartale + Monatsgeometrie je Quartal) ────────────────────────
  const quartale = useMemo<MfQuartal[]>(() => quartaleZwischen(doc.startMonat, doc.endMonat), [doc.startMonat, doc.endMonat])
  const quartalGeo = useMemo<QGeo[]>(() => {
    const geo: QGeo[] = []
    let acc = 0
    for (const q of quartale) { geo.push({ monthStart: acc, months: q.monate }); acc += q.monate }
    return geo
  }, [quartale])
  const monthCount = quartalGeo.reduce((s, g) => s + g.months, 0)
  // Verkettete Phasen (an Vorgänger) auflösen — für Balken und Zell-Einfärbung.
  const resolvedPhasen = useMemo(() => resolvePhasen(doc.phasen), [doc.phasen])

  // Phasenfarbe je MONAT innerhalb jedes Quartals — für den Segment-Verlauf der
  // Zellen (mehrere Phasen im selben Quartal werden sichtbar aufgeteilt).
  const quartalMonthColors = useMemo<(string | undefined)[][]>(() => {
    return quartale.map((_, qi) => {
      const g = quartalGeo[qi]
      const arr: (string | undefined)[] = []
      for (let m = 0; m < g.months; m++) {
        const idx = g.monthStart + m
        let color: string | undefined
        for (const p of resolvedPhasen) {
          const s = monatDiff(doc.startMonat, p.startMonat)
          const e = s + p.dauerMonate - 1
          if (idx >= s && idx <= e) color = p.farbe // spätere Phase gewinnt bei Überlappung
        }
        arr.push(color)
      }
      return arr
    })
  }, [quartale, quartalGeo, resolvedPhasen, doc.startMonat])

  // ── Berechnung je Quartal ────────────────────────────────────────────────────
  const calc = useMemo(() => {
    const vert = doc.verteilung
    const qKeys = quartale.map((q) => q.key)
    const cells: Record<string, QCell[]> = {}
    const cumBase = new Array(qKeys.length).fill(0)
    // Editierbare Zeilen (Gesamt-Positionen bzw. Etappen-Unterzeilen) aus ihrem Scope.
    for (const r of rows) {
      if (!r.editable) continue
      const rc = qKeys.map((qk) => {
        const pct = vert[r.scope]?.[r.posKey]?.[qk] ?? 0
        return { pct, netto: (pct / 100) * r.netto, mwst: (pct / 100) * r.mwst, brutto: (pct / 100) * r.brutto }
      })
      cells[r.key] = rc
      rc.forEach((c, i) => { cumBase[i] += c.brutto })
    }
    const cum: number[] = []
    let run = 0
    for (let i = 0; i < qKeys.length; i++) { run += cumBase[i]; cum.push(run) }
    // Finanzierung: abgeleitet aus dem kumulierten Bedarf.
    for (const r of rows) if (r.kind === 'finanzierung') {
      cells[r.key] = qKeys.map((_, i) => {
        const zins = cum[i] * (r.rate ?? 0) * (r.share ?? 0.5) / 4
        return { pct: 0, netto: zins, mwst: 0, brutto: zins }
      })
    }
    // Kopfzeilen (Etappen-Modus): Summe ihrer Etappen-Kinder.
    for (const r of rows) if (r.isHeader) {
      const kids = rows.filter((x) => x.editable && x.groupId === r.groupId)
      cells[r.key] = qKeys.map((_, i) => {
        let n = 0, m = 0, b = 0
        for (const k of kids) { const c = cells[k.key]?.[i]; if (c) { n += c.netto; m += c.mwst; b += c.brutto } }
        return { pct: 0, netto: n, mwst: m, brutto: b }
      })
    }
    // Summen: editierbare Zeilen + Finanzierung (Kopfzeilen NICHT, sonst doppelt).
    const contrib = (r: MfDispRow) => r.editable || r.kind === 'finanzierung'
    const totNetto = qKeys.map((_, i) => rows.reduce((s, r) => s + (contrib(r) ? (cells[r.key]?.[i]?.netto ?? 0) : 0), 0))
    // Anlagekosten netto OHNE Finanzierung (Zinsen fliessen nur ins Brutto-Total).
    const totNettoAK = qKeys.map((_, i) => rows.reduce((s, r) => s + (r.editable ? (cells[r.key]?.[i]?.netto ?? 0) : 0), 0))
    const totMwst = qKeys.map((_, i) => rows.reduce((s, r) => s + (contrib(r) ? (cells[r.key]?.[i]?.mwst ?? 0) : 0), 0))
    const totBrutto = totNetto.map((n, i) => n + totMwst[i])
    return { qKeys, cells, totNetto, totNettoAK, totMwst, totBrutto }
  }, [rows, doc.verteilung, quartale])

  // ── Setter ───────────────────────────────────────────────────────────────────
  const setPct = (scope: string, posKey: string, qKey: string, val: number) => setDoc((d) => {
    const sc = d.verteilung[scope] ?? {}
    const posMap = sc[posKey] ?? {}
    return { ...d, verteilung: { ...d.verteilung, [scope]: { ...sc, [posKey]: { ...posMap, [qKey]: val } } } }
  }, { label: 'Mittelfluss %', coalesceKey: `mf:${scope}:${posKey}:${qKey}` })

  const setRange = (patch: Partial<Pick<MittelflussDoc, 'startMonat' | 'endMonat'>>) =>
    setDoc((d) => ({ ...d, ...patch }), { label: 'Zeitfenster', coalesceKey: 'mf:range' })
  const setFremdZins = (v: number) =>
    setDoc((d) => ({ ...d, fremdZinssatz: v }), { label: 'Zinssatz Fremdfinanzierung', coalesceKey: 'mf:zins' })
  const setPhase = (id: string, patch: Partial<MfPhase>) =>
    setDoc((d) => ({ ...d, phasen: d.phasen.map((p) => (p.id === id ? { ...p, ...patch } : p)) }), { label: 'Terminplan', coalesceKey: `mf:phase:${id}` })
  const addPhase = () => setDoc((d) => {
    const id = `p-${Math.random().toString(36).slice(2, 8)}`
    const last = d.phasen[d.phasen.length - 1]
    const start = last ? monatAdd(last.startMonat, last.dauerMonate) : d.startMonat
    return { ...d, phasen: [...d.phasen, { id, label: 'Neue Phase', startMonat: start, dauerMonate: 3, farbe: CI.kupfer[7] }] }
  }, { label: 'Phase hinzufügen' })
  const delPhase = (id: string) => setDoc((d) => ({ ...d, phasen: d.phasen.filter((p) => p.id !== id) }), { label: 'Phase löschen' })
  const movePhase = (from: number, to: number) => setDoc((d) => {
    if (from === to || from < 0 || to < 0 || from >= d.phasen.length || to >= d.phasen.length) return d
    const arr = [...d.phasen]
    const [moved] = arr.splice(from, 1)
    arr.splice(to, 0, moved)
    return { ...d, phasen: arr }
  }, { label: 'Phase verschieben' })

  const N = quartale.length
  const tableCols = `${LEFT_POS}px ${COL_GESAMT}px repeat(${N}, ${COL_Q}px) ${COL_CTRL}px ${COL_SUM}px`
  const ganttCols = `${LEFT_POS}px ${COL_GESAMT}px repeat(${N}, ${COL_Q}px)`
  const totalW = LEFT_POS + COL_GESAMT + N * COL_Q + COL_CTRL + COL_SUM

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 bg-[#B98C74] px-5 py-3 text-sm font-semibold text-slate-900 transition hover:brightness-95"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-slate-700" /> : <ChevronRight className="h-4 w-4 text-slate-700" />}
        <Waves className="h-4 w-4 text-slate-700" />
        <span>Mittelfluss / Liquiditätsplanung</span>
      </button>

      {expanded && (loading ? (
        <div className="p-6 text-sm text-slate-500">Wird geladen…</div>
      ) : (
        <div className="space-y-5 p-5">
          {/* Zeitfenster */}
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-xs text-slate-600">
              <div className="mb-0.5">Projektstart</div>
              <input type="month" value={doc.startMonat} disabled={!canWrite}
                onChange={(e) => setRange({ startMonat: e.target.value })}
                className="rounded-md border border-slate-200 px-2 py-1 text-sm" />
            </label>
            <label className="text-xs text-slate-600">
              <div className="mb-0.5">Projektende</div>
              <input type="month" value={doc.endMonat} disabled={!canWrite}
                onChange={(e) => setRange({ endMonat: e.target.value })}
                className="rounded-md border border-slate-200 px-2 py-1 text-sm" />
            </label>
            <div className="text-xs text-slate-400">{N} Quartale · {monthCount} Monate</div>
          </div>

          {/* Ansicht-Umschalter */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[11px] uppercase tracking-wider text-slate-400">Verteilung:</span>
              <TabButton active={verteilModus === 'gesamt'} onClick={() => setVerteilModus('gesamt')}>Gesamt</TabButton>
              <TabButton active={verteilModus === 'etappe'} onClick={() => setVerteilModus('etappe')}>nach Etappe</TabButton>
              {verteilModus === 'etappe' && etappen.length === 0 && <span className="text-[11px] text-amber-600">(keine Etappen erfasst)</span>}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[11px] uppercase tracking-wider text-slate-400">Eigentumsart:</span>
              <TabButton active={eigSel === 'gesamt'} onClick={() => setEigSel('gesamt')}>Gesamt</TabButton>
              {ak.presentEig.map((eig) => (
                <TabButton key={eig} active={eigSel === eig} onClick={() => setEigSel(eig)}>{EIGENTUMSART_LABEL[eig]}</TabButton>
              ))}
            </div>
          </div>

          {canWrite && (
            <div className="flex justify-start">
              <button type="button" onClick={addPhase}
                className="inline-flex items-center gap-1 rounded-md border border-[#B98C74] bg-[#F2D3C2]/40 px-2 py-1 text-xs font-medium text-[#5A3F2E] hover:bg-[#F2D3C2]/70">
                <Plus className="h-3.5 w-3.5" /> Phase
              </button>
            </div>
          )}

          {/* Gemeinsamer horizontaler Scroll → Terminplan und Tabelle bleiben ausgerichtet */}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <div style={{ minWidth: totalW }}>
              <TerminplanGantt
                phasen={resolvedPhasen} quartale={quartale} quartalGeo={quartalGeo} startMonat={doc.startMonat}
                cols={ganttCols} canWrite={canWrite} onSetPhase={setPhase} onDelPhase={delPhase} onReorder={movePhase}
              />
              <KostenTabelle
                rows={rows} quartale={quartale} calc={calc} quartalMonthColors={quartalMonthColors}
                cols={tableCols} canWrite={canWrite} onSetPct={setPct}
                fremdScope={fremdScope}
                ekVert={doc.verteilung[fremdScope]?.['eigenkapital'] ?? {}}
                trancheVert={doc.verteilung[fremdScope]?.['tranche'] ?? {}}
                fremdZinssatz={doc.fremdZinssatz} onSetFremdZins={setFremdZins}
              />
            </div>
          </div>
        </div>
      ))}
    </section>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${active ? 'bg-[#8B6956] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
      {children}
    </button>
  )
}

const stickyLeft: React.CSSProperties = { position: 'sticky', left: 0, zIndex: 5 }

// ── Terminplan (quartalsbasiert, anteilige Balkenfüllung je Quartal) ──────────
function TerminplanGantt({ phasen, quartale, quartalGeo, startMonat, cols, canWrite, onSetPhase, onDelPhase, onReorder }: {
  phasen: MfPhase[]
  quartale: MfQuartal[]
  quartalGeo: QGeo[]
  startMonat: string
  cols: string
  canWrite: boolean
  onSetPhase: (id: string, patch: Partial<MfPhase>) => void
  onDelPhase: (id: string) => void
  onReorder: (from: number, to: number) => void
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  // Jahres-Gruppierung (aufeinanderfolgende Quartale gleichen Jahres).
  const jahre: { jahr: number; span: number }[] = []
  for (const q of quartale) {
    const last = jahre[jahre.length - 1]
    if (last && last.jahr === q.jahr) last.span++
    else jahre.push({ jahr: q.jahr, span: 1 })
  }

  return (
    <div className="border-b-2 border-slate-200 bg-slate-50/40">
      {/* Jahres-Kopf */}
      <div className="grid items-stretch" style={{ gridTemplateColumns: cols }}>
        <div style={stickyLeft} className="bg-slate-50/40 px-3 py-1 text-[11px] font-semibold text-slate-500">Terminplan</div>
        <div className="bg-slate-50/40" />
        {jahre.map((y, i) => (
          <div key={i} style={{ gridColumn: `span ${y.span}` }} className="border-l border-slate-200 py-1 text-center text-[11px] font-semibold text-slate-600">{y.jahr}</div>
        ))}
      </div>
      {/* Quartals-Kopf */}
      <div className="grid items-stretch border-b border-slate-200" style={{ gridTemplateColumns: cols }}>
        <div style={stickyLeft} className="bg-slate-50/40" />
        <div className="bg-slate-50/40" />
        {quartale.map((q) => (
          <div key={q.key} className="border-l border-slate-100 py-0.5 text-center text-[10px] font-medium text-slate-400">Q{q.q}</div>
        ))}
      </div>
      {/* Phasen-Zeilen */}
      {phasen.map((p, idx) => {
        const s = monatDiff(startMonat, p.startMonat)
        const e = s + p.dauerMonate - 1
        return (
          <div key={p.id}
            onDragOver={(ev) => { if (dragIdx !== null) { ev.preventDefault(); if (overIdx !== idx) setOverIdx(idx) } }}
            onDrop={(ev) => { ev.preventDefault(); if (dragIdx !== null && dragIdx !== idx) onReorder(dragIdx, idx); setDragIdx(null); setOverIdx(null) }}
            className={`grid items-center border-b border-slate-100 last:border-0 hover:bg-white/60 ${dragIdx === idx ? 'opacity-40' : ''} ${overIdx === idx && dragIdx !== null && dragIdx !== idx ? (idx < dragIdx ? 'border-t-2 border-t-[#8B6956]' : 'border-b-2 border-b-[#8B6956]') : ''}`}
            style={{ gridTemplateColumns: cols }}>
            <div style={stickyLeft} className="flex flex-col gap-0.5 bg-white px-2 py-1">
              <div className="flex items-center gap-1">
                <span
                  draggable={canWrite}
                  onDragStart={(ev) => { setDragIdx(idx); ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(idx)) }}
                  onDragEnd={() => { setDragIdx(null); setOverIdx(null) }}
                  title="Zum Umsortieren ziehen"
                  className={`shrink-0 ${canWrite ? 'cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600' : 'text-slate-300'}`}>
                  <GripVertical className="h-3.5 w-3.5" />
                </span>
                <input value={p.label} disabled={!canWrite}
                  onChange={(ev) => onSetPhase(p.id, { label: ev.target.value })}
                  className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-100 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#B98C74]" />
                {canWrite && (
                  <button type="button" onClick={() => onDelPhase(p.id)} title="Phase löschen"
                    className="shrink-0 rounded p-0.5 text-slate-300 hover:bg-red-50 hover:text-red-500">
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1 pl-4">
                <input type="month" value={p.startMonat} disabled={!canWrite || !!p.anVorgaenger}
                  title={p.anVorgaenger ? 'Start folgt automatisch dem Vorgänger' : undefined}
                  onChange={(ev) => onSetPhase(p.id, { startMonat: ev.target.value })}
                  className="rounded border border-slate-200 px-1 py-0.5 text-[10px] text-slate-500 disabled:bg-slate-50 disabled:text-slate-400" />
                <input type="number" min={1} value={p.dauerMonate} disabled={!canWrite}
                  onChange={(ev) => onSetPhase(p.id, { dauerMonate: Math.max(1, Number(ev.target.value) || 1) })}
                  className="w-10 rounded border border-slate-200 px-1 py-0.5 text-right text-[10px] text-slate-500" />
                <span className="text-[9px] text-slate-400">Mt</span>
                {idx > 0 && (
                  <label className="ml-1 flex items-center gap-0.5 text-[9px] text-slate-400" title="Start direkt an das Ende der vorherigen Phase koppeln">
                    <input type="checkbox" checked={!!p.anVorgaenger} disabled={!canWrite}
                      onChange={(ev) => {
                        if (ev.target.checked) {
                          const prev = phasen[idx - 1]
                          onSetPhase(p.id, { anVorgaenger: true, startMonat: prev ? monatAdd(prev.startMonat, prev.dauerMonate) : p.startMonat })
                        } else {
                          onSetPhase(p.id, { anVorgaenger: false })
                        }
                      }}
                      className="h-3 w-3" />
                    an Vorgänger
                  </label>
                )}
              </div>
            </div>
            <div className="bg-white" />
            {quartale.map((q, qi) => {
              const g = quartalGeo[qi]
              const a = Math.max(s, g.monthStart)
              const b = Math.min(e, g.monthStart + g.months - 1)
              const has = a <= b
              const left = has ? ((a - g.monthStart) / g.months) * 100 : 0
              const width = has ? ((b - a + 1) / g.months) * 100 : 0
              const roundL = a === s
              const roundR = b === e
              return (
                <div key={q.key} className="relative border-l border-slate-100 py-2">
                  {has && (
                    <div className="absolute top-1.5 bottom-1.5" style={{
                      left: `${left}%`, width: `${width}%`, backgroundColor: p.farbe,
                      borderTopLeftRadius: roundL ? 5 : 0, borderBottomLeftRadius: roundL ? 5 : 0,
                      borderTopRightRadius: roundR ? 5 : 0, borderBottomRightRadius: roundR ? 5 : 0,
                    }} />
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
      {phasen.length === 0 && <div className="px-4 py-3 text-xs text-slate-400">Keine Phasen — mit „+ Phase" hinzufügen.</div>}
    </div>
  )
}

// ── Kostentabelle (Positionen × Quartale), gleiche Geometrie wie der Terminplan ──
function KostenTabelle({ rows, quartale, calc, quartalMonthColors, cols, canWrite, onSetPct, fremdScope, ekVert, trancheVert, fremdZinssatz, onSetFremdZins }: {
  rows: MfDispRow[]
  quartale: MfQuartal[]
  calc: { qKeys: string[]; cells: Record<string, QCell[]>; totNetto: number[]; totNettoAK: number[]; totMwst: number[]; totBrutto: number[] }
  quartalMonthColors: (string | undefined)[][]
  cols: string
  canWrite: boolean
  onSetPct: (scope: string, posKey: string, qKey: string, val: number) => void
  fremdScope: string
  ekVert: Record<string, number>
  trancheVert: Record<string, number>
  fremdZinssatz: number
  onSetFremdZins: (v: number) => void
}) {
  const anzWarn = rows.filter((r) => {
    if (!r.editable) return false
    const sum = (calc.cells[r.key] ?? []).reduce((s, c) => s + c.brutto, 0)
    return Math.abs(sum - r.brutto) > Math.max(1, Math.abs(r.brutto) * 0.001)
  }).length
  const sumTotNettoAK = calc.totNettoAK.reduce((s, v) => s + v, 0)
  const sumTotMwst = calc.totMwst.reduce((s, v) => s + v, 0)
  // Anlagekosten inkl. MWST, aber ohne Finanzierung (= netto AK + MwSt).
  const totAKInkl = calc.totNettoAK.map((n, i) => n + calc.totMwst[i])
  const sumTotAKInkl = sumTotNettoAK + sumTotMwst
  // Saldo = kumulierter Mittelbedarf (laufende Summe des Brutto-Finanzbedarfs).
  const saldo: number[] = []
  { let run = 0; for (const v of calc.totBrutto) { run += v; saldo.push(run) } }
  // Eingebrachtes Eigenkapital je Quartal (Eingabe, CHF) + kumuliert.
  const ek = calc.qKeys.map((qk) => ekVert[qk] ?? 0)
  const cumEK: number[] = []; { let r = 0; for (const v of ek) { r += v; cumEK.push(r) } }
  const sumEK = ek.reduce((s, v) => s + v, 0)
  // Benötigtes Fremdkapital (Stock) = kumulierter Saldo − kumuliertes Eigenkapital.
  const fremdKapital = saldo.map((s, i) => s - cumEK[i])
  // Finanzierungstranchen je Quartal (Eingabe, CHF) + kumuliert (= ausstehendes FK).
  const tranche = calc.qKeys.map((qk) => trancheVert[qk] ?? 0)
  const cumTranche: number[] = []; { let r = 0; for (const v of tranche) { r += v; cumTranche.push(r) } }
  const sumTranche = tranche.reduce((s, v) => s + v, 0)
  // Zinsaufwand des Quartals auf die kumulierten Tranchen (Jahreszins/4).
  const zins = cumTranche.map((c) => c * (fremdZinssatz / 100) / 4)
  const sumZins = zins.reduce((s, v) => s + v, 0)

  return (
    <div>
      {/* Kopf */}
      <div className="grid items-stretch border-b border-slate-200 bg-slate-50 text-slate-500" style={{ gridTemplateColumns: cols }}>
        <div style={stickyLeft} className="bg-slate-50 px-3 py-2 text-left text-xs font-medium">Position</div>
        <div className="px-2 py-2 text-right text-[11px] font-medium">Gesamt</div>
        {quartale.map((q, i) => (
          <div key={q.key} className="border-l border-slate-100 px-1 py-2 text-center text-[10px] font-medium"
            style={{ background: segBackground(quartalMonthColors[i], '22') }}>Q{q.q}</div>
        ))}
        <div className="px-2 py-2 text-right text-[10px] font-medium">nicht verteilt</div>
        <div className="px-2 py-2 text-right text-[11px] font-medium">Σ Quartale</div>
      </div>

      {/* Zeilen */}
      {rows.map((r) => {
        const rc = calc.cells[r.key] ?? []
        const sumPct = rc.reduce((s, c) => s + c.pct, 0)
        const sumBrutto = rc.reduce((s, c) => s + c.brutto, 0)
        const unverteilt = 100 - sumPct
        const isFin = r.kind === 'finanzierung'
        const readOnly = !r.editable // Kopfzeile oder Finanzierung → keine %-Eingabe
        const abweichung = r.editable && Math.abs(sumBrutto - r.brutto) > Math.max(1, Math.abs(r.brutto) * 0.001)
        return (
          <div key={r.key} className={`grid items-stretch border-b border-slate-100 text-xs hover:bg-slate-50/40 ${r.isHeader ? 'bg-slate-50/70' : ''}`} style={{ gridTemplateColumns: cols }}>
            <div style={stickyLeft} className={`flex items-start gap-1 px-3 py-1.5 ${r.isHeader ? 'bg-slate-50/70 font-medium text-slate-800' : 'bg-white text-slate-700'}`} title={r.label}>
              {r.indent > 0 && <span className="w-4 shrink-0" />}
              {r.kind === 'honorar' && r.indent === 0 && <span className="mt-px shrink-0 rounded bg-[#F2D3C2] px-1 text-[9px] text-[#5A3F2E]">Honorar</span>}
              {isFin && <span className="mt-px shrink-0 rounded bg-blue-100 px-1 text-[9px] text-blue-700">Zins</span>}
              <span className={`min-w-0 leading-tight ${r.indent > 0 ? 'text-slate-500' : ''}`}>{r.label}</span>
            </div>
            <div className="px-2 py-1.5 text-right tabular-nums text-slate-500">{formatNumber(r.brutto)}</div>
            {rc.map((c, i) => (
              <div key={i} className="flex flex-col justify-center border-l border-slate-100 px-1 py-1"
                style={{ background: segBackground(quartalMonthColors[i], '14') }}>
                {readOnly ? (
                  <span className={`text-right text-[11px] tabular-nums ${isFin ? 'text-blue-700' : 'text-slate-500'}`}>{isFin || c.brutto ? formatNumber(c.brutto) : ''}</span>
                ) : (
                  <>
                    <div className="flex items-center justify-end gap-0.5 rounded px-0.5" style={{ background: segBackground(quartalMonthColors[i], '40') ?? '#f1f5f9' }}>
                      <input type="number" min={0} max={100}
                        value={c.pct} disabled={!canWrite}
                        onChange={(e) => onSetPct(r.scope, r.posKey, calc.qKeys[i], Math.max(0, Number(e.target.value) || 0))}
                        className="min-w-0 flex-1 border-0 bg-transparent py-0.5 text-right text-[11px] tabular-nums text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#B98C74] [appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                      <span className="text-[9px] text-slate-500">%</span>
                    </div>
                    <span className="mt-0.5 text-right text-[9px] tabular-nums text-slate-400">{formatNumber(c.brutto)}</span>
                  </>
                )}
              </div>
            ))}
            <div className={`px-2 py-1.5 text-right tabular-nums ${readOnly ? 'text-slate-300' : Math.abs(unverteilt) < 0.1 ? 'text-emerald-600' : 'text-amber-600'}`}>
              {readOnly ? '—' : `${formatNumber(unverteilt, 1)} %`}
            </div>
            <div className="flex items-center justify-end gap-1 px-2 py-1.5 text-right tabular-nums font-medium text-slate-700">
              {abweichung && <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />}
              {formatNumber(sumBrutto)}
            </div>
          </div>
        )
      })}
      {rows.length === 0 && <div className="px-3 py-4 text-center text-xs text-slate-400">Keine Kostenpositionen in dieser Ansicht.</div>}

      {/* Abschluss: Netto / MwSt / Brutto je Quartal */}
      <FootRow label="Anlagekosten exkl. MWST exkl. Finanzierung" values={calc.totNettoAK} total={sumTotNettoAK} cols={cols} quartalMonthColors={quartalMonthColors} />
      <FootRow label="MwSt" values={calc.totMwst} total={sumTotMwst} cols={cols} quartalMonthColors={quartalMonthColors} />
      <FootRow label="Anlagekosten inkl. MWST exkl. Finanzierung" values={totAKInkl} total={sumTotAKInkl} cols={cols} quartalMonthColors={quartalMonthColors} />
      <FootRow label="Saldo (kumulierter Mittelbedarf)" values={saldo} total={saldo[saldo.length - 1] ?? 0} cols={cols} quartalMonthColors={quartalMonthColors} strong />

      {/* Eingebrachtes Eigenkapital (Eingabe, CHF je Quartal) */}
      <ChfInputRow label="Eingebrachtes Eigenkapital" scope={fremdScope} posKey="eigenkapital" values={ek} total={sumEK}
        qKeys={calc.qKeys} cols={cols} quartalMonthColors={quartalMonthColors} canWrite={canWrite} onSet={onSetPct} />

      {/* Benötigtes Fremdkapital = kumulierter Saldo − kumuliertes Eigenkapital */}
      <FootRow label="Benötigtes Fremdkapital (Saldo − Eigenkapital)" values={fremdKapital} total={fremdKapital[fremdKapital.length - 1] ?? 0} cols={cols} quartalMonthColors={quartalMonthColors} />

      {/* Finanzierungstranchen (Eingabe, CHF je Quartal) */}
      <ChfInputRow label="Finanzierungstranchen" scope={fremdScope} posKey="tranche" values={tranche} total={sumTranche}
        qKeys={calc.qKeys} cols={cols} quartalMonthColors={quartalMonthColors} canWrite={canWrite} onSet={onSetPct} />

      {/* Zinsaufwand auf die kumulierten Tranchen — Zinssatz vorne, Gesamtsumme in der Gesamt-Spalte */}
      <div className="grid items-stretch border-t border-slate-100 text-xs" style={{ gridTemplateColumns: cols }}>
        <div style={stickyLeft} className="flex items-center gap-2 bg-white px-3 py-1.5 text-slate-700">
          <span className="font-medium">Zinsaufwand</span>
          <div className="flex items-center gap-0.5 rounded bg-slate-100 px-1">
            <input type="number" min={0} step={0.1} value={fremdZinssatz} disabled={!canWrite}
              onChange={(e) => onSetFremdZins(Math.max(0, Number(e.target.value) || 0))}
              className="w-12 border-0 bg-transparent py-0.5 text-right text-[11px] tabular-nums text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#B98C74] [appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
            <span className="text-[9px] text-slate-500">% p.a.</span>
          </div>
        </div>
        <div className="bg-white px-2 py-1.5 text-right tabular-nums font-semibold text-slate-800">{formatNumber(sumZins)}</div>
        {zins.map((v, i) => (
          <div key={i} className="border-l border-slate-100 px-1 py-1.5 text-right text-[11px] tabular-nums text-slate-700"
            style={{ background: segBackground(quartalMonthColors[i], '10') }}>{v ? formatNumber(v) : ''}</div>
        ))}
        <div className="bg-white" />
        <div className="bg-white px-2 py-1.5 text-right tabular-nums font-medium text-slate-700">{formatNumber(sumZins)}</div>
      </div>

      {anzWarn > 0 && (
        <div className="flex items-center gap-2 border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {anzWarn} Position(en): Summe der Quartale weicht vom Anlagekosten-Betrag ab (nicht 100 % verteilt).
        </div>
      )}
    </div>
  )
}

function FootRow({ label, values, total, cols, quartalMonthColors, muted, strong, gesamt }: {
  label: string
  values: number[]
  total: number
  cols: string
  quartalMonthColors: (string | undefined)[][]
  muted?: boolean
  strong?: boolean
  gesamt?: number
}) {
  const bg = strong ? '#FAEFE9' : muted ? 'rgb(248 250 252 / 0.6)' : 'rgb(248 250 252 / 0.6)'
  const txt = strong ? 'font-semibold text-slate-800' : muted ? 'text-slate-400' : 'text-slate-700'
  return (
    <div className={`grid items-stretch ${strong ? 'border-t border-slate-300' : 'border-t border-slate-200'}`} style={{ gridTemplateColumns: cols }}>
      <div style={{ ...stickyLeft, backgroundColor: bg }} className={`px-3 py-1.5 text-left ${txt}`}>{label}</div>
      <div className="px-2 py-1.5 text-right tabular-nums text-slate-400" style={{ backgroundColor: bg }}>{gesamt != null ? formatNumber(gesamt) : ''}</div>
      {values.map((v, i) => (
        <div key={i} className={`border-l border-slate-100 px-1 py-1.5 text-right text-[11px] tabular-nums ${txt}`} style={{ background: segBackground(quartalMonthColors[i], strong ? '20' : '10') ?? bg }}>{v ? formatNumber(v) : ''}</div>
      ))}
      <div style={{ backgroundColor: bg }} />
      <div className={`px-2 py-1.5 text-right tabular-nums ${txt}`} style={{ backgroundColor: bg }}>{formatNumber(total)}</div>
    </div>
  )
}

// Editierbare CHF-Zeile je Quartal (Eigenkapital, Finanzierungstranchen).
function ChfInputRow({ label, scope, posKey, values, total, qKeys, cols, quartalMonthColors, canWrite, onSet }: {
  label: string
  scope: string
  posKey: string
  values: number[]
  total: number
  qKeys: string[]
  cols: string
  quartalMonthColors: (string | undefined)[][]
  canWrite: boolean
  onSet: (scope: string, posKey: string, qKey: string, val: number) => void
}) {
  return (
    <div className="grid items-stretch border-t border-slate-100 text-xs" style={{ gridTemplateColumns: cols }}>
      <div style={stickyLeft} className="flex items-center bg-white px-3 py-1.5 font-medium text-slate-700">{label}</div>
      <div className="bg-white px-2 py-1.5 text-right tabular-nums text-slate-500">{formatNumber(total)}</div>
      {values.map((v, i) => (
        <div key={i} className="flex items-center border-l border-slate-100 px-1 py-1" style={{ background: segBackground(quartalMonthColors[i], '14') }}>
          <div className="flex w-full items-center rounded px-0.5" style={{ background: segBackground(quartalMonthColors[i], '40') ?? '#f1f5f9' }}>
            <input type="number" min={0} value={v || ''} disabled={!canWrite} placeholder="0"
              onChange={(e) => onSet(scope, posKey, qKeys[i], Math.max(0, Number(e.target.value) || 0))}
              className="w-full min-w-0 border-0 bg-transparent py-0.5 text-right text-[11px] tabular-nums text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#B98C74] [appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
          </div>
        </div>
      ))}
      <div className="bg-white" />
      <div className="bg-white px-2 py-1.5 text-right tabular-nums font-medium text-slate-700">{formatNumber(total)}</div>
    </div>
  )
}
