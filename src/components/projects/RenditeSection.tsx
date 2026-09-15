import { useState } from 'react'
import { useAufklappbar } from '@/hooks/useAufklappbar'
import { ChevronDown, ChevronRight, TrendingUp } from 'lucide-react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { EIGENTUMSART_COLOR } from '@/lib/kategorieFarben'
import { eigentumsartForBuilding } from '@/types'
import { RenditeBerechnung } from '@/components/projects/RenditeBerechnung'
import { etappenTabs } from '@/lib/etappenTabs'
import { useRenditeModus } from '@/hooks/useRenditeModus'
import { cn } from '@/lib/utils'

const EIG: 'renditeobjekt' = 'renditeobjekt'

// Hauptkategorie „Renditeberechnung" (für Renditeobjekte) — zwei Modi:
// Renditeberechnung und Residualwert. Inhalt folgt.
// Nur sichtbar, wenn in der Mengenerfassung Renditeobjekte vorhanden sind.
export function RenditeSection({ variantId, defaultExpanded = false }: { variantId: string; defaultExpanded?: boolean }) {
  const ak = useAnlagekostenShared()
  const [expanded, umschalten] = useAufklappbar(defaultExpanded)
  // Die Wahl gehört zur Variante, nicht zur Sitzung: der Bericht zeigt danach
  // entweder die Renditeberechnung oder den Residualwert.
  const { modus: mode, setModus: setMode } = useRenditeModus(variantId)
  const [activeTab, setActiveTab] = useState('konsolidiert')

  // Etappen, die überhaupt Renditeobjekte enthalten — nur die sind als Reiter
  // sinnvoll. Ohne Etappen bleibt es bei der konsolidierten Sicht.
  const etappenMitBlock = ak.etappen.filter((e) => ak.buildings.some(
    (b) => b.etappe_id === e.id && eigentumsartForBuilding(b.use_type) === EIG))
  // Ohne zweite Etappe gibt es nichts zu wählen — dann keine Reiterleiste.
  const tabs = etappenTabs(etappenMitBlock)
  const tabKey = tabs.some((t) => t.key === activeTab) ? activeTab : 'konsolidiert'

  const hasRenditeobjekt = ak.buildings.some((b) => eigentumsartForBuilding(b.use_type) === EIG)
  if (!hasRenditeobjekt) return null

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={umschalten}
        style={{ backgroundColor: EIGENTUMSART_COLOR.renditeobjekt }}
        className="flex w-full items-center gap-2 px-5 py-3 text-sm font-semibold text-slate-900 transition hover:brightness-95"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-slate-700" /> : <ChevronRight className="h-4 w-4 text-slate-700" />}
        <TrendingUp className="h-4 w-4 text-slate-700" />
        <span>Renditeberechnung (Renditeobjekt)</span>
        <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-normal text-slate-700">in Vorbereitung</span>
      </button>

      {expanded && (
        <div className="space-y-4 p-5">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
            {([
              { key: 'rendite', label: 'Renditeberechnung' },
              { key: 'residual', label: 'Residualwert' },
            ] as const).map((m, i) => (
              <button
                key={m.key}
                type="button"
                onClick={() => void setMode(m.key)}
                className={cn(
                  'px-4 py-1.5 text-sm font-medium transition',
                  i > 0 && 'border-l border-slate-300',
                  mode === m.key ? 'bg-[#F2D3C2] text-slate-900' : 'bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Etappenreiter — die Kosten kommen je Reiter aus der in den
              Anlagekosten gewählten Erfassungsmethode. */}
          {tabs.length > 0 && (
            <div className="flex flex-wrap gap-1 border-b border-slate-200">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveTab(t.key)}
                  className={cn(
                    'rounded-t-lg border border-b-0 px-4 py-2 text-sm font-medium transition',
                    tabKey === t.key
                      ? 'border-slate-200 bg-slate-200 text-slate-900'
                      : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          <RenditeBerechnung
            variantId={variantId}
            mode={mode}
            etappeId={tabKey === 'konsolidiert' ? null : tabKey}
          />
        </div>
      )}
    </section>
  )
}
