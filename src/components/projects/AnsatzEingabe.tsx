import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export type AnsatzEinheit = 'CHF/m²' | 'CHF/m³' | '%'

/**
 * Zahleneingabe für die Kennwerte der Kostenberechnung (keeValue-Ergänzung und
 * Benchmarks). Prozentwerte werden als Zahl angezeigt (3.5 für 3.5 %), intern
 * aber als Faktor (0.035) geführt — gleiche Konvention wie in den Anlagekosten.
 */
export function AnsatzEingabe({
  wert, einheit, disabled, onCommit,
}: {
  wert: number | null
  einheit: AnsatzEinheit
  disabled: boolean
  onCommit: (wert: number | null) => void
}) {
  const istProzent = einheit === '%'
  const anzeige = (w: number | null) =>
    w == null ? '' : String(istProzent ? Number((w * 100).toFixed(4)) : w)

  const [text, setText] = useState(() => anzeige(wert))
  const [fokus, setFokus] = useState(false)
  // Externe Änderungen (Laden, Rollback nach Speicherfehler) übernehmen —
  // aber nie während der Eingabe, sonst springt der Cursor.
  useEffect(() => { if (!fokus) setText(anzeige(wert)) }, [wert, fokus])  // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    setFokus(false)
    const roh = text.trim().replace(/'/g, '').replace(',', '.')
    if (roh === '') { onCommit(null); return }
    const n = Number(roh)
    if (!Number.isFinite(n)) { setText(anzeige(wert)); return }
    onCommit(istProzent ? n / 100 : n)
  }

  return (
    <span className="inline-flex items-baseline gap-1">
      <input
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        onFocus={() => setFokus(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        placeholder="—"
        className={cn(
          'w-20 rounded border border-slate-200 px-1.5 py-0.5 text-right text-sm tabular-nums',
          'focus:border-slate-400 focus:outline-none',
          disabled && 'cursor-not-allowed bg-slate-50 text-slate-400',
        )}
      />
      <span className="text-xs text-slate-400">{einheit}</span>
    </span>
  )
}
