import { createContext, useContext, type ReactNode } from 'react'
import { useMengengeruest } from '@/hooks/useMengengeruest'
import { useVariantEtappen } from '@/hooks/useVariantEtappen'
import { useAnlagekosten } from '@/hooks/useAnlagekosten'

// Geteilte, live gehaltene Datenquellen für eine Variante. Alle Sektionen
// (Mengen & Erträge, Wohnungsmix, Anlagekosten, Benchmarks, Kostenmiete) lesen
// aus DENSELBEN Hook-Instanzen — eine Änderung wirkt sofort überall.
//
// Auch die Etappen gehören dazu: hatte jede Sektion ihre eigene Liste, kannte
// die Anlagekostenberechnung eine frisch angelegte Etappe nicht und hielt die
// ihr zugeordneten Gebäude für unzugeordnet — bis zum nächsten Neuladen.

type MengenValue = ReturnType<typeof useMengengeruest>
type EtappenValue = ReturnType<typeof useVariantEtappen>
type AnlagekostenValue = ReturnType<typeof useAnlagekosten>

const MengenContext = createContext<MengenValue | null>(null)
const EtappenContext = createContext<EtappenValue | null>(null)
const AnlagekostenContext = createContext<AnlagekostenValue | null>(null)

export function VariantDataProvider({
  projectId, variantId, children,
}: {
  projectId: string | undefined
  variantId: string
  children: ReactNode
}) {
  const mengen = useMengengeruest(variantId)
  const etappen = useVariantEtappen(variantId)
  const anlagekosten = useAnlagekosten(projectId, variantId, mengen, etappen)
  return (
    <MengenContext.Provider value={mengen}>
      <EtappenContext.Provider value={etappen}>
        <AnlagekostenContext.Provider value={anlagekosten}>
          {children}
        </AnlagekostenContext.Provider>
      </EtappenContext.Provider>
    </MengenContext.Provider>
  )
}

export function useMengengeruestShared(): MengenValue {
  const ctx = useContext(MengenContext)
  if (!ctx) throw new Error('useMengengeruestShared muss innerhalb von <VariantDataProvider> verwendet werden')
  return ctx
}

/**
 * Die geteilten Etappen, sofern die Sektion in einem Provider steckt. Gibt
 * `null` zurück, wo es keinen gibt (Berichtssidebar) — dort lädt der Aufrufer
 * seine eigene Liste.
 */
export function useVariantEtappenGeteilt(): EtappenValue | null {
  return useContext(EtappenContext)
}

export function useAnlagekostenShared(): AnlagekostenValue {
  const ctx = useContext(AnlagekostenContext)
  if (!ctx) throw new Error('useAnlagekostenShared muss innerhalb von <VariantDataProvider> verwendet werden')
  return ctx
}
