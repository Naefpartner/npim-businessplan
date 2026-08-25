import { useMemo, useState } from 'react'
import { X, Loader2, Search } from 'lucide-react'
import { DEFAULT_PLANER, MODE_META, type Disziplin } from '@/lib/honorar'
import { type PlanerLibraryEntry } from '@/hooks/useHonorar'
import { cn } from '@/lib/utils'

// Felder, die bei „Übernehmen" auf den Ziel-Planer angewendet werden.
export function applyPlanerParams(src: Disziplin): Partial<Disziplin> {
  return {
    label: src.label, sia: src.sia, mode: src.mode,
    tl: src.tl, z1: src.z1, z2: src.z2, n: src.n, r: src.r, u: src.u, i: src.i, s: src.s, h: src.h,
    phaseRef: src.phaseRef ?? src.id,   // Phasen-% korrekt auflösen
    factorRef: src.factorRef ?? src.id, // BKP-Faktoren der Quell-Funktion übernehmen
  }
}

/**
 * Bibliothek der Planer-Definitionen (Standard-SIA-Katalog + alle anderen Projekte).
 * Zeigt Bezeichnung, Herkunft und die SIA-Parameter/Faktoren; „Übernehmen" lädt sie
 * in den gewählten Planer.
 */
export function PlanerBibliothekDialog({
  entries, loading, currentLabel, onApply, onClose,
  title = 'Planer-Parameter aus anderen Projekten übernehmen',
  applyLabel = 'Übernehmen', onAddEmpty,
}: {
  entries: PlanerLibraryEntry[]
  loading: boolean
  currentLabel: string
  onApply: (patch: Partial<Disziplin>) => void
  onClose: () => void
  title?: string
  applyLabel?: string
  onAddEmpty?: () => void
}) {
  const [filter, setFilter] = useState(currentLabel)
  const [projektFilter, setProjektFilter] = useState('alle')

  // Standard-Katalog + Bibliothek; Projekt-Optionen für den Filter (inkl. „Standard (SIA)").
  const alle: PlanerLibraryEntry[] = useMemo(() => {
    const std: PlanerLibraryEntry[] = DEFAULT_PLANER.map((p) => ({ source: 'Standard (SIA)', projectId: null, planer: p }))
    return [...std, ...entries]
  }, [entries])
  const projektOptionen = useMemo(
    () => Array.from(new Set(alle.map((e) => e.source))).sort((a, b) => a.localeCompare(b, 'de')),
    [alle],
  )
  const rows: PlanerLibraryEntry[] = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return alle.filter((e) =>
      (projektFilter === 'alle' || e.source === projektFilter) &&
      (!q || e.planer.label.toLowerCase().includes(q) || e.source.toLowerCase().includes(q)))
  }, [alle, filter, projektFilter])

  const pct = (v: number) => `${(v * 100).toFixed(1)} %`
  const num = (v: number, d = 2) => (v ?? 0).toFixed(d)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#B98C74] px-5 py-3">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-700 hover:bg-black/10"><X className="h-4 w-4" /></button>
        </div>

        {/* Filter (analog Anlagekosten-Vergleich) */}
        <div className="flex flex-wrap items-end gap-4 border-b border-slate-100 bg-slate-50 px-5 py-3">
          <label className="text-sm">
            <div className="text-[11px] text-slate-500">Projekt</div>
            <select value={projektFilter} onChange={(e) => setProjektFilter(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:border-[#8B6956]">
              <option value="alle">Alle Projekte</option>
              {projektOptionen.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="flex-1 text-sm">
            <div className="text-[11px] text-slate-500">Suche</div>
            <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Nach Bezeichnung filtern …"
                className="w-full text-sm outline-none" />
            </div>
          </label>
          {onAddEmpty && (
            <button onClick={() => { onAddEmpty(); onClose() }}
              className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50">
              + Leere Spalte
            </button>
          )}
          <span className={cn('whitespace-nowrap pb-1 text-xs text-slate-400', !onAddEmpty && 'ml-auto')}>{rows.length}/{alle.length}</span>
        </div>

        <div className="overflow-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 p-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Lade Planer aus anderen Projekten …
            </div>
          )}
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-100 text-slate-600">
              <tr>
                <th className="border border-slate-200 px-2 py-1.5 text-left">Bezeichnung</th>
                <th className="border border-slate-200 px-2 py-1.5 text-left">Herkunft</th>
                <th className="border border-slate-200 px-2 py-1.5 text-left">SIA</th>
                <th className="border border-slate-200 px-2 py-1.5 text-left">Modus</th>
                <th className="border border-slate-200 px-2 py-1.5 text-right">TL</th>
                <th className="border border-slate-200 px-2 py-1.5 text-right">Z1</th>
                <th className="border border-slate-200 px-2 py-1.5 text-right">Z2</th>
                <th className="border border-slate-200 px-2 py-1.5 text-right">n</th>
                <th className="border border-slate-200 px-2 py-1.5 text-right">r</th>
                <th className="border border-slate-200 px-2 py-1.5 text-right">U</th>
                <th className="border border-slate-200 px-2 py-1.5 text-right">i</th>
                <th className="border border-slate-200 px-2 py-1.5 text-right">s</th>
                <th className="border border-slate-200 px-2 py-1.5 text-right">h</th>
                <th className="border border-slate-200 px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e, k) => (
                <tr key={k} className="hover:bg-[#F5DDCD]/30">
                  <td className="border border-slate-200 px-2 py-1 font-medium text-slate-800">{e.planer.label}</td>
                  <td className="border border-slate-200 px-2 py-1 text-slate-500">{e.source}</td>
                  <td className="border border-slate-200 px-2 py-1 text-slate-600">{e.planer.sia || '—'}</td>
                  <td className="border border-slate-200 px-2 py-1">
                    <span className="inline-flex items-center gap-1 text-slate-600">
                      <span className={cn('inline-block h-2 w-2 rounded-full', MODE_META[e.planer.mode]?.dot)} />
                      {MODE_META[e.planer.mode]?.label ?? e.planer.mode}
                    </span>
                  </td>
                  <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">{e.planer.mode === 'faktoren' ? pct(e.planer.tl) : '—'}</td>
                  <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">{e.planer.mode === 'faktoren' ? num(e.planer.z1, 3) : '—'}</td>
                  <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">{e.planer.mode === 'faktoren' ? num(e.planer.z2, 2) : '—'}</td>
                  <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">{e.planer.mode === 'faktoren' ? num(e.planer.n) : '—'}</td>
                  <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">{e.planer.mode === 'faktoren' ? num(e.planer.r) : '—'}</td>
                  <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">{e.planer.mode === 'faktoren' ? num(e.planer.u) : '—'}</td>
                  <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">{e.planer.mode === 'faktoren' ? num(e.planer.i) : '—'}</td>
                  <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">{e.planer.mode === 'faktoren' ? num(e.planer.s) : '—'}</td>
                  <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">{e.planer.mode === 'faktoren' ? num(e.planer.h, 0) : '—'}</td>
                  <td className="border border-slate-200 px-1 py-1 text-center">
                    <button onClick={() => { onApply(applyPlanerParams(e.planer)); onClose() }}
                      className="whitespace-nowrap rounded-md border border-[#8B6956] bg-[#F2D3C2]/40 px-2 py-0.5 text-[11px] font-medium text-slate-900 transition hover:bg-[#F2D3C2]/80">
                      {applyLabel}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={14} className="px-4 py-6 text-center text-sm text-slate-400">Keine Planer gefunden.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
