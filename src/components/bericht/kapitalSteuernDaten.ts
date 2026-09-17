import { useMemo } from 'react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { useKapitalSteuern } from '@/hooks/useKapitalSteuern'
import { positionsBetraegeAus } from '@/lib/kapitalSteuern'
import { ertragProNutzung } from '@/lib/bkpBlocks'
import { eigentumsartForBuilding } from '@/types'
import { kapitalSteuernKapitel } from '@/components/bericht/kapitalSteuernKapitel'
import type { BereichsKapitelDaten } from '@/components/bericht/BerichtDokument'

const EIG = 'verkaufsobjekt' as const

/**
 * Stellt das Kapitel „Kapital und Steuern" zusammen. Gerechnet wird mit
 * denselben Funktionen wie im Reiter der Variante; die Beträge der
 * übernommenen Positionen kommen live aus der Kostenberechnung der gewählten
 * Methode.
 */
export function useKapitalSteuernDaten(
  variantId: string | undefined,
): BereichsKapitelDaten | undefined {
  const ak = useAnlagekostenShared()
  const { loaded: ksDoc } = useKapitalSteuern(variantId ?? '')

  return useMemo(() => {
    if (!ksDoc || !ak.presentEig.includes(EIG)) return undefined
    const erg = ak.konsolidiertEffektiv.get(EIG)
    const p010 = erg?.positionen['010']
    const gebaeude = ak.buildings.filter((b) => eigentumsartForBuilding(b.use_type) === EIG)
    return kapitalSteuernKapitel({
      doc: ksDoc,
      betraege: positionsBetraegeAus(erg, ak.benchmarkAktiv || ak.keeValueAktiv),
      landpreis: (p010?.betragNetto ?? 0) + (p010?.mwstBetrag ?? 0),
      verkaufserloes: Object.values(ertragProNutzung(gebaeude)).reduce((s, v) => s + v, 0),
      mehrereEig: ak.presentEig.length > 1,
    })
  }, [ksDoc, ak.presentEig, ak.konsolidiertEffektiv, ak.benchmarkAktiv, ak.keeValueAktiv,
    ak.buildings])
}
