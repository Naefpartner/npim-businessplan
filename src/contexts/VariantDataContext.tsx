import { createContext, useContext, type ReactNode } from 'react'
import { useMengengeruest } from '@/hooks/useMengengeruest'
import { useAnlagekosten } from '@/hooks/useAnlagekosten'

// Geteilte, live gehaltene Datenquellen für eine Variante. Alle Sektionen
// (Mengen & Erträge, Wohnungsmix, Anlagekosten, Benchmarks, Kostenmiete) lesen
// aus DENSELBEN Hook-Instanzen — eine Änderung wirkt sofort überall.

type MengenValue = ReturnType<typeof useMengengeruest>
type AnlagekostenValue = ReturnType<typeof useAnlagekosten>

const MengenContext = createContext<MengenValue | null>(null)
const AnlagekostenContext = createContext<AnlagekostenValue | null>(null)

export function VariantDataProvider({
  projectId, variantId, children,
}: {
  projectId: string | undefined
  variantId: string
  children: ReactNode
}) {
  const mengen = useMengengeruest(variantId)
  const anlagekosten = useAnlagekosten(projectId, variantId, mengen)
  return (
    <MengenContext.Provider value={mengen}>
      <AnlagekostenContext.Provider value={anlagekosten}>
        {children}
      </AnlagekostenContext.Provider>
    </MengenContext.Provider>
  )
}

export function useMengengeruestShared(): MengenValue {
  const ctx = useContext(MengenContext)
  if (!ctx) throw new Error('useMengengeruestShared muss innerhalb von <VariantDataProvider> verwendet werden')
  return ctx
}

export function useAnlagekostenShared(): AnlagekostenValue {
  const ctx = useContext(AnlagekostenContext)
  if (!ctx) throw new Error('useAnlagekostenShared muss innerhalb von <VariantDataProvider> verwendet werden')
  return ctx
}
