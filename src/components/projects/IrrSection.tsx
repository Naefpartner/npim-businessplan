import { useState } from 'react'
import { ChevronDown, ChevronRight, Percent } from 'lucide-react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { EIGENTUMSART_COLOR } from '@/lib/kategorieFarben'
import { eigentumsartForBuilding } from '@/types'

const EIG: 'verkaufsobjekt' = 'verkaufsobjekt'

// Hauptkategorie „IRR-Berechnung" (für Stockwerkeigentum) — Hülle analog zur
// Rendite-/Kostenmietberechnung. Inhalt folgt. Nur sichtbar, wenn in der
// Mengenerfassung Stockwerkeigentum (Verkaufsobjekt) vorhanden ist.
export function IrrSection({ defaultExpanded = false }: { defaultExpanded?: boolean }) {
  const ak = useAnlagekostenShared()
  const [expanded, setExpanded] = useState(defaultExpanded)

  const hasStockwerkeigentum = ak.buildings.some((b) => eigentumsartForBuilding(b.use_type) === EIG)
  if (!hasStockwerkeigentum) return null

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{ backgroundColor: EIGENTUMSART_COLOR.verkaufsobjekt }}
        className="flex w-full items-center gap-2 px-5 py-3 text-sm font-semibold text-slate-900 transition hover:brightness-95"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-slate-700" /> : <ChevronRight className="h-4 w-4 text-slate-700" />}
        <Percent className="h-4 w-4 text-slate-700" />
        <span>IRR-Berechnung (Stockwerkeigentum)</span>
        <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-normal text-slate-700">in Vorbereitung</span>
      </button>

      {expanded && (
        <div className="p-5">
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
            IRR-Berechnung – Inhalt folgt.
          </div>
        </div>
      )}
    </section>
  )
}
