import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, HandCoins } from 'lucide-react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { EIGENTUMSART_COLOR, USE_TYPE_COLOR_5 } from '@/lib/kategorieFarben'
import { eigentumsartForBuilding } from '@/types'
import { WbfZhBerechnung } from '@/components/projects/WbfZhBerechnung'
import { BwoBerechnung } from '@/components/projects/BwoBerechnung'

const EIG: 'genossenschaft' = 'genossenschaft'

// Sektion „Wohnbauförderung" (für Genossenschaften) — Herleitung der maximalen
// Erstellungs- und Investitionskosten. Inhalt folgt. Nur sichtbar, wenn in der
// Mengenerfassung Genossenschaft vorhanden ist.
export function WohnbaufoerderungSection({ variantId, defaultExpanded = false }: { variantId: string; defaultExpanded?: boolean }) {
  const ak = useAnlagekostenShared()
  const [expanded, setExpanded] = useState(defaultExpanded)

  const hasGenossenschaft = ak.buildings.some((b) => eigentumsartForBuilding(b.use_type) === EIG)
  if (!hasGenossenschaft) return null

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{ backgroundColor: EIGENTUMSART_COLOR.genossenschaft }}
        className="flex w-full items-center gap-2 px-5 py-3 text-sm font-semibold text-slate-900 transition hover:brightness-95"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-slate-700" /> : <ChevronRight className="h-4 w-4 text-slate-700" />}
        <HandCoins className="h-4 w-4 text-slate-700" />
        <span>Anlagekostenlimiten</span>
      </button>

      {expanded && (
        <div className="space-y-4 p-5">
          <SubChapter title="Kantonale Wohnbauförderung ZH">
            <WbfZhBerechnung variantId={variantId} />
          </SubChapter>
          <SubChapter title="Bundesamt für Wohnungswesen BWO">
            <BwoBerechnung variantId={variantId} />
          </SubChapter>
        </div>
      )}
    </section>
  )
}

// Unterkapitel innerhalb der Wohnbauförderung (nächst-hellere Genossenschaftsstufe).
function SubChapter({ title, defaultOpen = false, children }: {
  title: string; defaultOpen?: boolean; children?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ backgroundColor: USE_TYPE_COLOR_5.genossenschaft }}
        className="flex w-full items-center gap-1.5 px-4 py-2 text-left text-sm font-semibold text-slate-900 transition hover:brightness-95"
      >
        {open ? <ChevronDown className="h-4 w-4 text-slate-700" /> : <ChevronRight className="h-4 w-4 text-slate-700" />}
        <span>{title}</span>
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  )
}
