import { useMemo } from 'react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { ermittleKeeValueMengen } from '@/lib/keevalue'
import { ertragProNutzung, gsfBlockShare, blockKey } from '@/lib/bkpBlocks'
import { eigentumsartForBuilding, EIGENTUMSART_LABEL, type Eigentumsart } from '@/types'
import type { BenchmarkBezug } from '@/lib/benchmark'
import type { VariantBuildingFull } from '@/hooks/useMengengeruest'

/** Der leere Schlüssel adressiert die Gesamtebene über die ganze Variante. */
export const GESAMT_BLOCK = ''

/**
 * Ein Erfassungsblock: entweder die ganze Variante oder eine Kombination aus
 * Etappe und Nutzungsart.
 */
export interface KostenBlock {
  /** '' = Gesamtebene, sonst '<etappe_id>::<eigentumsart>'. */
  key: string
  titel: string
  /** Nutzungsart des Blocks; null bei gemischtem oder Gesamtbezug. */
  eig: Eigentumsart | null
  /** Alle Bezugsgrössen dieses Blocks für die Kostenrechnung. */
  bezug: BenchmarkBezug
  /** Die Gebäude dieses Blocks — für Ableitungen, die mehr als die Summen brauchen. */
  gebaeude: VariantBuildingFull[]
}

/**
 * Liefert die Erfassungsblöcke der gewählten Tiefe samt ihren Bezugsgrössen.
 * Wird von der Benchmark- und der keeValue-Methode gemeinsam genutzt, damit
 * beide identisch aufteilen.
 *
 * Der Grundstücksanteil eines Blocks folgt der Aufteilung aus den Anlagekosten
 * (gsfAlloc), ersatzweise dem VMF-Anteil — gleiche Regel wie beim
 * Detailkatalog, damit die Landkosten in allen Methoden gleich fallen.
 */
export function useKostenBloecke(modus: 'total' | 'aufgeteilt'): KostenBlock[] {
  const {
    buildings, gsfTotal, totalVmf, mwstSatz, presentEig, etappen, blockList, gsfAlloc,
  } = useAnlagekostenShared()

  return useMemo(() => {
    const bezugFuer = (gebaeude: typeof buildings, gsfAnteil: number): BenchmarkBezug => {
      const m = ermittleKeeValueMengen(gebaeude, gsfAnteil)
      return {
        gsfTotal: gsfAnteil,
        gfM2: m.gfM2,
        gvM3: m.gvM3,
        gvUiM3: m.gvUnterirdischM3,
        vmfM2: gebaeude.reduce(
          (s, b) => s + b.mietflaechen.reduce((a, f) => a + (f.flaeche_m2 || 0), 0), 0),
        bufM2: m.bufM2,
        ertragBasis: Object.values(ertragProNutzung(gebaeude)).reduce((s, v) => s + v, 0),
        mwstSatz,
      }
    }

    if (modus === 'total') {
      return [{
        key: GESAMT_BLOCK,
        titel: presentEig.length > 0
          ? presentEig.map((e) => EIGENTUMSART_LABEL[e]).join(' · ')
          : 'Keine Nutzungsart erfasst',
        eig: presentEig.length === 1 ? presentEig[0] : null,
        bezug: bezugFuer(buildings, gsfTotal),
        gebaeude: buildings,
      }]
    }

    return blockList.map(({ etappeId, eig }) => {
      const gebaeude = buildings.filter(
        (b) => b.etappe_id === etappeId && eigentumsartForBuilding(b.use_type) === eig,
      )
      const blockVmfM2 = gebaeude.reduce(
        (s, b) => s + b.mietflaechen.reduce((a, f) => a + (f.flaeche_m2 || 0), 0), 0)
      const defaultShare = totalVmf > 0
        ? blockVmfM2 / totalVmf
        : (blockList.length ? 1 / blockList.length : 0)
      const share = gsfBlockShare(gsfAlloc.get(etappeId, eig), gsfTotal, defaultShare)
      const etappenName = etappen.find((e) => e.id === etappeId)?.name ?? 'Etappe'
      return {
        key: blockKey(etappeId, eig),
        titel: `${etappenName} · ${EIGENTUMSART_LABEL[eig]}`,
        eig,
        bezug: bezugFuer(gebaeude, gsfTotal * share),
        gebaeude,
      }
    })
  }, [modus, buildings, gsfTotal, totalVmf, mwstSatz, presentEig, etappen, blockList, gsfAlloc])
}
