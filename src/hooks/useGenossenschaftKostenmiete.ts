// =============================================================================
// Kostenmiete Wohnen (Genossenschaft) für Auswertungen ausserhalb der
// Kostenmiete-Sektion.
//
// Bei der Eigentumsart Genossenschaft ist der Wohnungsertrag KEIN Marktmietzins:
// er ergibt sich aus dem Kostenmietmodell (Verzinsung + Betriebskosten abzüglich
// der Erträge der übrigen Nutzungen). Der im Mengengerüst erfasste Mietzins ist
// dort nur ein Vergleichs-/Benchmarkwert.
//
// Verteilt wird der max. Mietertrag Wohnen — wie in der Kostenmiete-Sektion —
// über die WBF-Punkte des Wohnungsmix, nicht über die Fläche:
//   Miete je Wohnung = max. Mietertrag Wohnen / Punkte-Total × Punkte des Typs
// =============================================================================

import { useMemo } from 'react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { useKostenmiete } from '@/hooks/useKostenmiete'
import { useWbfZh } from '@/hooks/useWbfZh'
import { basisFromErgebnis, berechneKostenmiete, sammleKostenmieteMengen } from '@/lib/kostenmiete'

const EIG = 'genossenschaft' as const

export interface GenossenschaftKostenmiete {
  /** Konsolidierter max. Mietertrag Wohnen (CHF/a) über alle Etappen. */
  maxMietertragWohnenPa: number | null
  /** WBF-Punkte je Zimmer-Kategorie (Verteilschlüssel auf die einzelnen Wohnungen). */
  punkte: Record<string, number>
  /** Konsolidierter Ansatz in CHF/m²·a (nur informativ, z. B. für Hinweistexte). */
  konsolidiertProM2Jahr: number | null
  loading: boolean
}

export function useGenossenschaftKostenmiete(variantId: string): GenossenschaftKostenmiete {
  const ak = useAnlagekostenShared()
  const { params, loading } = useKostenmiete(variantId)
  const { params: wbf } = useWbfZh(variantId)

  return useMemo(() => {
    // Konsolidiert über alle Etappen — identisch zum Reiter «Konsolidiert» der
    // Kostenmiete-Sektion, dessen Wohnungsmieten der Massstab sind.
    const erg = ak.konsolidiertEffektiv.get(EIG)
    const { vmf, wohnenFlaeche, wohnungen, ertragsNutzungen } = sammleKostenmieteMengen(ak.buildings, null)
    const kons = erg && wohnenFlaeche > 0
      ? berechneKostenmiete(basisFromErgebnis(erg, vmf, wohnenFlaeche, wohnungen), params, ertragsNutzungen)
      : null
    return {
      maxMietertragWohnenPa: kons?.maxMietertragWohnen ?? null,
      punkte: wbf.punkte,
      konsolidiertProM2Jahr: kons?.proM2Jahr ?? null,
      loading,
    }
  }, [ak.buildings, ak.konsolidiertEffektiv, params, wbf.punkte, loading])
}
