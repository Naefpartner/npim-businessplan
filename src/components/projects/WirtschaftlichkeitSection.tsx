import { useState } from 'react'
import { ChevronDown, ChevronRight, Coins, Info } from 'lucide-react'
import { KostenmieteSection } from '@/components/projects/KostenmieteSection'
import { RenditeSection } from '@/components/projects/RenditeSection'
import { GewinnSection } from '@/components/projects/GewinnSection'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { KOSTEN_METHODE_LABEL } from '@/types'

// Hauptkapitel „Wirtschaftlichkeit" (Kupfer-Header) — bündelt Kostenmiete-,
// Rendite- und Gewinnberechnung. Die Unterkapitel tragen ihre
// Eigentumsart-Farbe; zugeklappt beginnen sie nur, wo mehrere Nutzungsarten
// nebeneinander stehen.
export function WirtschaftlichkeitSection({ variantId, defaultExpanded = false }: {
  variantId: string
  defaultExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const ak = useAnlagekostenShared()
  const { kostenMethode, keeValueAktiv, kostenModus } = ak
  /*
   * Kommt nur eine Nutzungsart vor, gibt es hier genau eine Berechnung — sie
   * zugeklappt zu zeigen kostete bloss einen Klick. Bei mehreren bleiben sie
   * geschlossen, sonst wächst der Reiter über den Bildschirm hinaus.
   */
  const nurEineNutzungsart = ak.presentEig.length === 1
  const tiefe = kostenModus === 'total'
    ? 'gesamthaft für die Variante erfasst; Etappenwerte sind nach VMF-Anteil abgeleitet'
    : 'je Etappe und Nutzungsart erfasst'

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
          {/* Woher die Kosten stammen — sonst ist unklar, welcher Stand gerechnet wird. */}
          <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            {kostenMethode === 'keevalue' && !keeValueAktiv ? (
              <span>
                Erfassungsmethode <strong>keeValue</strong> gewählt, aber noch kein Ergebnis-Excel
                eingelesen — gerechnet wird bis dahin mit dem Detailkatalog.
              </span>
            ) : (
              <span>
                Kostenbasis: <strong>{KOSTEN_METHODE_LABEL[kostenMethode]}</strong> aus den
                Anlagekosten, {tiefe}.
              </span>
            )}
          </div>

          <KostenmieteSection variantId={variantId} defaultExpanded={nurEineNutzungsart} />
          <RenditeSection variantId={variantId} defaultExpanded={nurEineNutzungsart} />
          <GewinnSection defaultExpanded={nurEineNutzungsart} />
        </div>
      )}
    </section>
  )
}
