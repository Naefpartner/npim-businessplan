import { useState } from 'react'
import { ChevronDown, ChevronRight, Coins } from 'lucide-react'
import { KostenmieteSection } from '@/components/projects/KostenmieteSection'
import { RenditeSection } from '@/components/projects/RenditeSection'
import { IrrSection } from '@/components/projects/IrrSection'

// Hauptkapitel „Wirtschaftlichkeit" (Kupfer-Header) — bündelt Kostenmiete-,
// Rendite- und IRR-Berechnung. Die Unterkapitel tragen ihre Eigentumsart-Farbe
// und sind standardmässig zugeklappt.
export function WirtschaftlichkeitSection({ variantId, defaultExpanded = false }: {
  variantId: string
  defaultExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 bg-[#B98C74] px-5 py-3 text-sm font-semibold text-slate-900 transition hover:brightness-95"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-slate-700" /> : <ChevronRight className="h-4 w-4 text-slate-700" />}
        <Coins className="h-4 w-4 text-slate-700" />
        <span>Wirtschaftlichkeit</span>
      </button>

      {expanded && (
        <div className="space-y-4 p-5">
          <KostenmieteSection variantId={variantId} />
          <RenditeSection variantId={variantId} />
          <IrrSection />
        </div>
      )}
    </section>
  )
}
