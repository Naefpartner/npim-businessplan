import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useMengengeruest } from '@/hooks/useMengengeruest'
import { useVariantEtappen } from '@/hooks/useVariantEtappen'
import { useGsfAllocation } from '@/hooks/useGsfAllocation'
import { useBkpKosten, type BkpScope } from '@/hooks/useBkpKosten'
import { useBkpCustomPositions } from '@/hooks/useBkpCustomPositions'
import { BKP_POSITIONEN, type BkpPosition } from '@/lib/bkpKatalog'
import { berechneAnlagekosten, type BkpErgebnis } from '@/lib/bkpBerechnung'
import { aggregateBkp2, EIGENTUMSART_ORDER } from '@/lib/bkp2'
import {
  effectiveEintraege, blockMengen, blockVmf, gsfBlockShare,
  konsolidiertMengen, buildKonsolidiert, customToPositions, makeTypFor,
  bkp2GeneratedPositions, ertragProNutzung, type TypFor,
} from '@/lib/bkpBlocks'
import {
  eigentumsartForBuilding,
  type ProjectVariant, type Eigentumsart, type PauschalPosten, type KostenMethode,
} from '@/types'
import { fetchVariant } from '@/hooks/useVariants'
import { useHonorar } from '@/hooks/useHonorar'
import { useKeeValueImport } from '@/hooks/useKeeValueImport'
import { useKeeValueErgaenzung } from '@/hooks/useKeeValueErgaenzung'
import { anlagekostenZeilen, alsBkpErgebnis, ermittleKeeValueMengen } from '@/lib/keevalue'

// Sortierschlüssel aus der Positionsnummer (führende Ziffern); ohne Nummer ans Ende.
export function posSortKey(p: BkpPosition): number {
  const m = (p.displayCode ?? p.code).match(/^\d+/)
  return m ? Number(m[0]) : Number.POSITIVE_INFINITY
}

/**
 * Zentrale Anlagekosten-Berechnung für eine Variante. Liefert die Block- und
 * Konsolidiert-Ergebnisse je Eigentumsart sowie alle Hilfsdaten. Wird von der
 * Anlagekosten-Sektion und der Benchmarks-Sektion gemeinsam genutzt, damit die
 * Zahlen garantiert identisch sind.
 */
export function useAnlagekosten(
  projectId: string | undefined,
  variantId: string,
  sharedMengen?: ReturnType<typeof useMengengeruest>,
) {
  const [variant, setVariant] = useState<ProjectVariant | null>(null)
  const [gsfTotal, setGsfTotal] = useState(0)
  const [loadingMeta, setLoadingMeta] = useState(true)

  // Geteiltes Mengengerüst aus dem Context bevorzugen (Live-Sync über Sektionen),
  // sonst eine eigene Instanz laden (z. B. wenn ohne Provider verwendet).
  const ownMengen = useMengengeruest(sharedMengen ? undefined : variantId)
  const mengen = sharedMengen ?? ownMengen
  const { etappen } = useVariantEtappen(variantId)
  const gsfAlloc = useGsfAllocation(variantId)
  const bkpKosten = useBkpKosten(variantId)
  const custom = useBkpCustomPositions(variantId)
  // Honorarrechner-Kennwerte der Variante (für Methode „honorarrechner" auf 690a/690b).
  const { loaded: honorarDoc } = useHonorar(projectId)
  const honorar690 = honorarDoc?.honorar690?.[variantId]

  // Rows mit überschriebenem Kennwert für 690a/690b, wenn dort die Methode
  // „honorarrechner" gewählt ist: Kennwert = Honorar-Anteil an BKP 1–4 (aus dem
  // Honorarrechner), sonst 0 (Variante noch nicht im Honorarrechner erfasst).
  const rowsEff = useMemo(() => {
    const has = bkpKosten.rows.some(
      (r) => r.etappe_id === null && r.calc_method === 'honorarrechner' && (r.position_code === '690a' || r.position_code === '690b'),
    )
    if (!has) return bkpKosten.rows
    return bkpKosten.rows.map((r) => {
      if (r.etappe_id !== null || r.calc_method !== 'honorarrechner') return r
      if (r.position_code === '690a') return { ...r, kennwert: honorar690?.kennwertBis41 ?? 0 }
      if (r.position_code === '690b') return { ...r, kennwert: honorar690?.kennwertAb51 ?? 0 }
      return r
    })
  }, [bkpKosten.rows, honorar690])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!projectId || !variantId) return
      setLoadingMeta(true)
      const [variantRow, parcels] = await Promise.all([
        fetchVariant(variantId),
        supabase.from('parcels').select('flaeche_m2').eq('project_id', projectId),
      ])
      if (cancelled) return
      setVariant(variantRow)
      const gsf = (parcels.data ?? []).reduce((s, p) => s + (p.flaeche_m2 ?? 0), 0)
      setGsfTotal(gsf)
      setLoadingMeta(false)
    }
    void load()
    return () => { cancelled = true }
  }, [projectId, variantId])

  const mwstSatz = variant?.mwst_satz ?? 0.081
  const buildings = mengen.buildings

  const bkp2Aggregat = useMemo(() => aggregateBkp2(buildings, etappen), [buildings, etappen])

  const presentEig = useMemo<Eigentumsart[]>(() => {
    const s = new Set<Eigentumsart>()
    for (const b of buildings) s.add(eigentumsartForBuilding(b.use_type))
    const order = EIGENTUMSART_ORDER.filter((e) => s.has(e))
    return order.length ? order : ['renditeobjekt']
  }, [buildings])

  // Jahresmietertrag je Nutzung je Eigentumsart (für die Methode „Mieterträge nach
  // Nutzung" bei 710/720 — Anzeige im Picker, deckt sich mit der Engine-Aggregation).
  const ertragProNutzungByEig = useMemo(() => {
    const m = new Map<Eigentumsart, Record<string, number>>()
    for (const eig of presentEig) {
      m.set(eig, ertragProNutzung(buildings.filter((b) => eigentumsartForBuilding(b.use_type) === eig)))
    }
    return m
  }, [presentEig, buildings])

  const blockList = useMemo(() => {
    const combos: { etappeId: string; eig: Eigentumsart }[] = []
    for (const et of etappen) {
      for (const eig of EIGENTUMSART_ORDER) {
        if (buildings.some((b) => b.etappe_id === et.id && eigentumsartForBuilding(b.use_type) === eig)) {
          combos.push({ etappeId: et.id, eig })
        }
      }
    }
    return combos
  }, [etappen, buildings])

  const totalVmf = useMemo(
    () => buildings.reduce((s, b) => s + b.mietflaechen.reduce((a, m) => a + (m.flaeche_m2 || 0), 0), 0),
    [buildings],
  )

  const positionsByEig = useMemo(() => {
    const m = new Map<Eigentumsart, BkpPosition[]>()
    for (const eig of presentEig) {
      const list = [
        ...BKP_POSITIONEN,
        ...bkp2GeneratedPositions(bkp2Aggregat, eig),
        ...customToPositions(custom.rows, eig),
      ]
      list.sort((a, b) => a.hauptgruppe - b.hauptgruppe || posSortKey(a) - posSortKey(b))
      m.set(eig, list)
    }
    return m
  }, [presentEig, custom.rows, bkp2Aggregat])

  const typForByEig = useMemo(() => {
    const m = new Map<Eigentumsart, TypFor>()
    for (const eig of presentEig) m.set(eig, makeTypFor(positionsByEig.get(eig) ?? BKP_POSITIONEN, rowsEff, eig))
    return m
  }, [presentEig, positionsByEig, rowsEff])

  function defaultShare(etappeId: string, eig: Eigentumsart): number {
    if (totalVmf > 0) return blockVmf(buildings, etappeId, eig) / totalVmf
    return blockList.length ? 1 / blockList.length : 0
  }

  const blockErgebnisse = useMemo(() => {
    const map = new Map<string, BkpErgebnis>()
    for (const { etappeId, eig } of blockList) {
      // Land-Anteil (für GSF/Grundstück): relativ zur GESAMT-VMF aller Blöcke.
      const dShare = totalVmf > 0
        ? blockVmf(buildings, etappeId, eig) / totalVmf
        : (blockList.length ? 1 / blockList.length : 0)
      const share = gsfBlockShare(gsfAlloc.get(etappeId, eig), gsfTotal, dShare)
      // Kosten-Push-down-Anteil: konsolidierte (eigentumsart-bezogene) Werte werden
      // NUR auf die Etappen DIESER Eigentumsart verteilt → relativ zur VMF dieser
      // Eigentumsart (Summe über alle ihre Etappen ergibt 100 %).
      const eigBlocks = blockList.filter((b) => b.eig === eig)
      const eigVmf = eigBlocks.reduce((s, b) => s + blockVmf(buildings, b.etappeId, eig), 0)
      const costShare = eigVmf > 0
        ? blockVmf(buildings, etappeId, eig) / eigVmf
        : (eigBlocks.length ? 1 / eigBlocks.length : 0)
      const mengenB = blockMengen({
        buildings, etappeId, eig, bkp2Aggregat,
        gsfForBlock: gsfTotal * share, mwstSatzGlobal: mwstSatz,
      })
      const positions = positionsByEig.get(eig) ?? BKP_POSITIONEN
      const typFor = typForByEig.get(eig)!
      const eff = effectiveEintraege(rowsEff, etappeId, eig, costShare, positions, typFor)
      map.set(`${etappeId}::${eig}`, berechneAnlagekosten(eff, mengenB, positions, typFor))
    }
    return map
  }, [blockList, gsfAlloc.get, gsfTotal, buildings, totalVmf, bkp2Aggregat, rowsEff, mwstSatz, positionsByEig, typForByEig])

  const konsolidiert = useMemo(() => {
    const map = new Map<Eigentumsart, { ergebnis: BkpErgebnis; aggregatCodes: Set<string> }>()
    for (const eig of presentEig) {
      const bloecke = blockList
        .filter((b) => b.eig === eig)
        .map((b) => blockErgebnisse.get(`${b.etappeId}::${eig}`))
        .filter((x): x is BkpErgebnis => !!x)
      const km = konsolidiertMengen({ buildings, eig, bkp2Aggregat, gsfTotal, mwstSatzGlobal: mwstSatz })
      const positions = positionsByEig.get(eig) ?? BKP_POSITIONEN
      map.set(eig, buildKonsolidiert(rowsEff, eig, km, bloecke, positions, typForByEig.get(eig)!))
    }
    return map
  }, [presentEig, blockList, blockErgebnisse, buildings, bkp2Aggregat, gsfTotal, rowsEff, mwstSatz, positionsByEig, typForByEig])

  const aggregateFlags = useMemo(() => {
    const m = new Map<Eigentumsart, Set<string>>()
    for (const r of bkpKosten.rows) {
      if (r.etappe_id === null && r.aggregate_from_etappen) {
        if (!m.has(r.eigentumsart)) m.set(r.eigentumsart, new Set())
        m.get(r.eigentumsart)!.add(r.position_code)
      }
    }
    return m
  }, [bkpKosten.rows])

  const hasOhneEtappe = useMemo(() => {
    const known = new Set(etappen.map((e) => e.id))
    return buildings.some((b) => !b.etappe_id || !known.has(b.etappe_id))
  }, [buildings, etappen])

  const totalAllocatedGsf = useMemo(() => {
    let sum = 0
    for (const { etappeId, eig } of blockList) {
      const dShare = totalVmf > 0
        ? blockVmf(buildings, etappeId, eig) / totalVmf
        : (blockList.length ? 1 / blockList.length : 0)
      sum += gsfTotal * gsfBlockShare(gsfAlloc.get(etappeId, eig), gsfTotal, dShare)
    }
    return sum
  }, [blockList, gsfAlloc.get, gsfTotal, buildings, totalVmf])
  const gsfMismatch = gsfTotal > 0 && Math.abs(totalAllocatedGsf - gsfTotal) > 1

  const getDetail = useCallback(
    (code: string, sc: BkpScope): PauschalPosten[] | null => {
      const r = bkpKosten.rows.find(
        (x) => x.etappe_id === sc.etappeId && x.eigentumsart === sc.eigentumsart && x.position_code === code,
      )
      return r?.pauschal_detail ?? null
    },
    [bkpKosten.rows],
  )

  const setGlobalMwstSatz = useCallback(async (newSatz: number) => {
    if (!variantId || !variant) return
    const { error } = await supabase.from('project_variants').update({ mwst_satz: newSatz }).eq('id', variantId)
    if (!error) setVariant({ ...variant, mwst_satz: newSatz })
  }, [variantId, variant])

  // ── Anlagekosten gemäss gewählter Erfassungsmethode ────────────────────────
  // Die Wirtschaftlichkeit soll mit den Kosten der angewählten Methode rechnen,
  // nicht zwingend mit dem Detailkatalog. `konsolidiert` bleibt der Detailstand
  // (die Anlagekosten-Tabelle lebt davon); `konsolidiertEffektiv` ist der Stand,
  // auf dem gerechnet wird.
  const keeValueImport = useKeeValueImport(variantId)
  const keeValueErgaenzung = useKeeValueErgaenzung(variantId)
  const kostenMethode: KostenMethode = variant?.kosten_methode ?? 'detail'
  const keeValueAktiv = kostenMethode === 'keevalue' && keeValueImport.imp != null

  // VMF je Eigentumsart — Verteilschlüssel für das keeValue-Variantentotal.
  const vmfByEig = useMemo(() => {
    const m = new Map<Eigentumsart, number>()
    for (const b of buildings) {
      const eig = eigentumsartForBuilding(b.use_type)
      const vmf = b.mietflaechen.reduce((a, mf) => a + (mf.flaeche_m2 || 0), 0)
      m.set(eig, (m.get(eig) ?? 0) + vmf)
    }
    return m
  }, [buildings])

  const konsolidiertEffektiv = useMemo(() => {
    const map = new Map<Eigentumsart, BkpErgebnis>()
    if (!keeValueAktiv || !keeValueImport.imp) {
      for (const eig of presentEig) {
        const erg = konsolidiert.get(eig)?.ergebnis
        if (erg) map.set(eig, erg)
      }
      return map
    }
    const ertragBasis = presentEig.reduce(
      (s, eig) => s + Object.values(ertragProNutzungByEig.get(eig) ?? {}).reduce((a, v) => a + v, 0), 0)
    const gesamt = anlagekostenZeilen(keeValueImport.imp, keeValueErgaenzung.doc, {
      gsfTotal,
      gfM2: ermittleKeeValueMengen(buildings, gsfTotal).gfM2,
      ertragBasis,
      mwstSatz,
    })
    for (const eig of presentEig) {
      // Ohne VMF (z.B. reine Parkierung) gleichmässig verteilen, damit die
      // Kosten nicht verschwinden.
      const anteil = totalVmf > 0
        ? (vmfByEig.get(eig) ?? 0) / totalVmf
        : (presentEig.length ? 1 / presentEig.length : 0)
      map.set(eig, alsBkpErgebnis(gesamt, anteil))
    }
    return map
  }, [keeValueAktiv, keeValueImport.imp, keeValueErgaenzung.doc, presentEig, konsolidiert,
      buildings, gsfTotal, mwstSatz, totalVmf, vmfByEig, ertragProNutzungByEig])

  // Gesamttotal (inkl. MwSt) über alle Eigentumsarten.
  const grandTotalBrutto = presentEig.reduce((s, eig) => s + (konsolidiert.get(eig)?.ergebnis.totalBrutto ?? 0), 0)

  const loading = loadingMeta || mengen.loading

  return {
    loading,
    variant, mwstSatz, setGlobalMwstSatz,
    buildings, etappen, presentEig, gsfTotal, totalVmf,
    blockList, positionsByEig, typForByEig,
    blockErgebnisse, konsolidiert, grandTotalBrutto,
    konsolidiertEffektiv, kostenMethode, keeValueAktiv,
    aggregateFlags, hasOhneEtappe, totalAllocatedGsf, gsfMismatch,
    getDetail, defaultShare,
    bkpKosten, custom, gsfAlloc, bkp2Aggregat,
    ertragProNutzungByEig,
  }
}
