import { useMemo } from 'react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { useRendite } from '@/hooks/useRendite'
import { useTragbarkeit } from '@/hooks/useTragbarkeit'
import { defaultTragbarkeitDoc } from '@/lib/tragbarkeit'
import { rechneTragbarkeit } from '@/lib/tragbarkeitRechnung'
import { tragbarkeitKapitel } from '@/components/bericht/tragbarkeitKapitel'
import type { BereichsKapitelDaten } from '@/components/bericht/BerichtDokument'

const EIG = 'renditeobjekt' as const

/**
 * Stellt das Kapitel „Tragbarkeit" zusammen — mit derselben Rechnung wie der
 * Reiter der Variante. Fehlt, wo es keine Renditeobjekte gibt.
 */
export function useTragbarkeitDaten(variantId: string | undefined): BereichsKapitelDaten | undefined {
  const ak = useAnlagekostenShared()
  const { params: rParams } = useRendite(variantId ?? '')
  const { loaded, loading } = useTragbarkeit(variantId)

  return useMemo(() => {
    if (loading || !ak.presentEig.includes(EIG)) return undefined
    const r = rechneTragbarkeit({
      doc: loaded ?? defaultTragbarkeitDoc(),
      rParams,
      ertragDetail: ak.ertragDetailByEig.get(EIG) ?? [],
      buildings: ak.buildings,
      ergebnis: ak.konsolidiertEffektiv.get(EIG),
      gsf: ak.gsfTotal,
    })
    return tragbarkeitKapitel(r, ak.presentEig.length > 1)
  }, [loading, loaded, rParams, ak.presentEig, ak.ertragDetailByEig, ak.buildings,
    ak.konsolidiertEffektiv, ak.gsfTotal])
}
