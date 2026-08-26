import type { ReactNode } from 'react'
import { BarChart3, Globe, Table2, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PRIMARY_DARK, PRIMARY_LIGHT } from '@/lib/ci'
import type { KostenMethode } from '@/types'

interface MethodeMeta {
  key: KostenMethode
  titel: string
  /** Ein Satz — was die Methode rechnet. */
  beschrieb: string
  /** Welche BKP-Hauptgruppen die Methode abdeckt (Kurzform für die Fusszeile). */
  umfang: string
  icon: typeof BarChart3
}

const METHODEN: MethodeMeta[] = [
  {
    key: 'benchmark',
    titel: 'Benchmarks',
    beschrieb: 'Grobschätzung über Kennwerte je Hauptgruppe — für frühe Phasen ohne Projektstand.',
    umfang: 'BKP 0–9',
    icon: BarChart3,
  },
  {
    key: 'keevalue',
    titel: 'keeValue',
    beschrieb: 'Erstellungskosten im Onlinetool keevalue.ch ermitteln und als Excel einlesen.',
    umfang: 'BKP 1–5',
    icon: Globe,
  },
  {
    key: 'detail',
    titel: 'Detailkatalog',
    beschrieb: 'Positionsweise Erfassung nach Naef-Katalog, je Etappe und Eigentumsart.',
    umfang: 'BKP 0–9',
    icon: Table2,
  },
]

/**
 * Auswahl der Erfassungsmethode als Kacheln. Die Wahl gilt pro Variante und
 * bestimmt, welcher Erfassungsbereich in den Anlagekosten angezeigt wird.
 */
export function KostenMethodeKacheln({
  methode, onChange, disabled = false, kopfRechts,
}: {
  methode: KostenMethode
  onChange: (m: KostenMethode) => void
  disabled?: boolean
  /** Zusatzsteuerung rechts im Kopf, z.B. der MwSt-Satz der Variante. */
  kopfRechts?: ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-slate-700">Erfassungsmethode</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Bestimmt, wie die Anlagekosten dieser Variante ermittelt werden. Jederzeit umschaltbar —
            die Daten der anderen Methoden bleiben erhalten.
          </p>
        </div>
        {kopfRechts}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {METHODEN.map((m) => {
          const aktiv = m.key === methode
          return (
            <button
              key={m.key}
              type="button"
              disabled={disabled}
              aria-pressed={aktiv}
              onClick={() => !aktiv && onChange(m.key)}
              style={aktiv ? { borderColor: PRIMARY_DARK, backgroundColor: PRIMARY_LIGHT } : undefined}
              className={cn(
                'group relative flex flex-col rounded-xl border-2 p-4 text-left transition',
                aktiv ? 'shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <m.icon
                  className="h-5 w-5 shrink-0"
                  style={{ color: aktiv ? PRIMARY_DARK : '#64748b' }}
                />
                {aktiv && (
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white"
                    style={{ backgroundColor: PRIMARY_DARK }}
                  >
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </div>

              <span
                className="mt-2 text-sm font-semibold"
                style={{ color: aktiv ? PRIMARY_DARK : '#0f172a' }}
              >
                {m.titel}
              </span>
              <span className="mt-1 text-xs leading-snug text-slate-600">{m.beschrieb}</span>
              <span className="mt-2 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                {m.umfang}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
