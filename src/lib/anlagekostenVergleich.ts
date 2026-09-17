import { supabase } from '@/lib/supabase'
import {
  eigentumsartForBuilding, isNutzungWohnen, WOHNUNGSMIX_KEYS, WOHNUNGSMIX_LABEL,
  type Eigentumsart, type ProjectUseType,
} from '@/types'
import { BKP_POSITIONEN, HAUPTGRUPPEN } from '@/lib/bkpKatalog'
import { aggregateBkp2, isGarageNutzung, EIGENTUMSART_ORDER } from '@/lib/bkp2'
import {
  bkp2GeneratedPositions, customToPositions, makeTypFor,
  konsolidiertMengen, buildKonsolidiert,
} from '@/lib/bkpBlocks'

const PHOTO_BUCKET = 'project-photos'
const GIS_BUCKET = 'project-gis'

export interface VariantInfo {
  adresse: string
  bildUrl: string | null
  situationsplanUrl: string | null
  vnf: number
  vnfNachNutzung: { nutzung: string; m2: number }[]
  nutzungen: string[]
  eigentumsarten: Eigentumsart[]
  anzahlWohnungen: number
  wohnungsmix: { key: string; label: string; anzahl: number }[]
  tiefgaragePP: number
  anlagekostenNetto: number
  anlagekostenBrutto: number
  bkp: { code: number; label: string; netto: number; brutto: number }[]
}

export interface VergleichWert {
  variantId: string
  projektId: string
  projektName: string
  projektNummer: string | null
  variantName: string
  eigentumsart: Eigentumsart
  kennwert: number | null
  betrag: number | null
  info: VariantInfo
}

type Building = {
  variant_id: string
  etappe_id: string | null
  use_type: ProjectUseType
  mietflaechen: {
    nutzung: string
    flaeche_m2: number | null
    volumen_m3: number | null
    unterirdisch: boolean
    anzahl: number | null
    wohnungsmix: Record<string, number> | null
  }[]
}

export async function fetchAnlagekostenVergleich(positionCode: string): Promise<VergleichWert[]> {
  // 1) Werte dieser Position (konsolidiert) über alle Projekte.
  const { data: wertRows } = await supabase
    .from('variant_bkp_kosten')
    .select('kennwert, betrag_override, eigentumsart, variant_id, project_variants!inner(name, project_id, projects!inner(name, project_number, strasse, hausnummer, plz, ort))')
    .eq('position_code', positionCode)
    .is('etappe_id', null)
  if (!wertRows || wertRows.length === 0) return []

  const pick = <T,>(v: T | T[] | null | undefined): T | undefined => Array.isArray(v) ? v[0] : (v ?? undefined)

  const variantIds = [...new Set(wertRows.map((r) => r.variant_id as string))]
  const projektIds = [...new Set(wertRows.map((r) => {
    const pv = pick<Record<string, unknown>>(r.project_variants as never)
    return pv?.project_id as string
  }).filter(Boolean))]

  // 2) Batch-Daten für alle Kandidaten-Varianten/-Projekte.
  const [buildingsRes, etappenRes, kostenRes, customRes, variantsRes, parcelsRes, photosRes, gisRes] = await Promise.all([
    supabase.from('variant_buildings').select('variant_id, etappe_id, use_type, mietflaechen:building_mietflaechen(nutzung, flaeche_m2, volumen_m3, unterirdisch, anzahl, wohnungsmix)').in('variant_id', variantIds),
    supabase.from('variant_etappen').select('id, variant_id').in('variant_id', variantIds),
    supabase.from('variant_bkp_kosten').select('*').in('variant_id', variantIds).is('etappe_id', null),
    supabase.from('variant_bkp_custom_position').select('*').in('variant_id', variantIds),
    supabase.from('project_variants').select('id, project_id, mwst_satz').in('id', variantIds),
    supabase.from('parcels').select('project_id, flaeche_m2').in('project_id', projektIds),
    supabase.from('project_photos').select('project_id, storage_path, sort_order').in('project_id', projektIds).order('sort_order', { ascending: true }),
    supabase.from('project_gis_screenshots').select('project_id, storage_path, sort_order').in('project_id', projektIds).order('sort_order', { ascending: true }),
  ])

  const buildingsByVariant = new Map<string, Building[]>()
  for (const b of (buildingsRes.data ?? []) as never[] as Building[]) {
    const list = buildingsByVariant.get(b.variant_id) ?? []
    list.push(b); buildingsByVariant.set(b.variant_id, list)
  }
  const etappenByVariant = new Map<string, { id: string; variant_id: string }[]>()
  for (const e of (etappenRes.data ?? []) as { id: string; variant_id: string }[]) {
    const list = etappenByVariant.get(e.variant_id) ?? []
    list.push(e); etappenByVariant.set(e.variant_id, list)
  }
  const kostenByVariant = new Map<string, never[]>()
  for (const r of (kostenRes.data ?? []) as { variant_id: string }[]) {
    const list = kostenByVariant.get(r.variant_id) ?? []
    list.push(r as never); kostenByVariant.set(r.variant_id, list)
  }
  const customByVariant = new Map<string, never[]>()
  for (const r of (customRes.data ?? []) as { variant_id: string }[]) {
    const list = customByVariant.get(r.variant_id) ?? []
    list.push(r as never); customByVariant.set(r.variant_id, list)
  }
  const mwstByVariant = new Map<string, number>()
  const projektByVariant = new Map<string, string>()
  for (const v of (variantsRes.data ?? []) as { id: string; project_id: string; mwst_satz: number }[]) {
    mwstByVariant.set(v.id, v.mwst_satz ?? 0.081)
    projektByVariant.set(v.id, v.project_id)
  }
  const gsfByProjekt = new Map<string, number>()
  for (const p of (parcelsRes.data ?? []) as { project_id: string; flaeche_m2: number | null }[]) {
    gsfByProjekt.set(p.project_id, (gsfByProjekt.get(p.project_id) ?? 0) + (p.flaeche_m2 ?? 0))
  }
  const firstByProjekt = (rows: { project_id: string; storage_path: string }[] | null) => {
    const m = new Map<string, string>()
    for (const r of rows ?? []) if (!m.has(r.project_id)) m.set(r.project_id, r.storage_path)
    return m
  }
  const photoByProjekt = firstByProjekt(photosRes.data as never)
  const gisByProjekt = firstByProjekt(gisRes.data as never)

  // 3) Pro Variante die Kennzahlen + Anlagekosten berechnen.
  const infoCache = new Map<string, VariantInfo>()
  const infoFor = (variantId: string): VariantInfo => {
    const cached = infoCache.get(variantId)
    if (cached) return cached
    const buildings = buildingsByVariant.get(variantId) ?? []
    const etappen = etappenByVariant.get(variantId) ?? []
    const konsRows = kostenByVariant.get(variantId) ?? []
    const customRows = customByVariant.get(variantId) ?? []
    const projektId = projektByVariant.get(variantId) ?? ''
    const gsfTotal = gsfByProjekt.get(projektId) ?? 0
    const mwstSatz = mwstByVariant.get(variantId) ?? 0.081

    // Mengengerüst-Kennzahlen.
    const nutzMap = new Map<string, number>()
    const mix: Record<string, number> = {}
    let vnf = 0, wohnungen = 0, tiefgaragePP = 0
    const eigSet = new Set<Eigentumsart>()
    for (const b of buildings) {
      eigSet.add(eigentumsartForBuilding(b.use_type))
      for (const m of b.mietflaechen ?? []) {
        const f = m.flaeche_m2 || 0
        vnf += f
        const nk = (m.nutzung || '').trim() || '(ohne)'
        nutzMap.set(nk, (nutzMap.get(nk) ?? 0) + f)
        if (isGarageNutzung(m.nutzung || '')) tiefgaragePP += m.anzahl ?? 0
        if (isNutzungWohnen(m.nutzung) && m.wohnungsmix) {
          for (const k of WOHNUNGSMIX_KEYS) {
            const c = m.wohnungsmix[k] ?? 0
            if (c > 0) { mix[k] = (mix[k] ?? 0) + c; wohnungen += c }
          }
        }
      }
    }

    // Anlagekosten konsolidiert je Eigentumsart (Engine-Wiederverwendung).
    const bkp2Aggregat = aggregateBkp2(buildings as never, etappen as never)
    const hgNetto: Record<number, number> = {}, hgMwst: Record<number, number> = {}
    for (let c = 0; c <= 9; c++) { hgNetto[c] = 0; hgMwst[c] = 0 }
    let totalNetto = 0, totalMwst = 0
    for (const eig of EIGENTUMSART_ORDER) {
      if (!eigSet.has(eig)) continue
      // Dieselbe Auswahl wie in der Kostenrechnung: Positionen, die nur für
      // bestimmte Eigentumsarten gelten, zählen auch nur dort.
      const positions = [
        ...BKP_POSITIONEN.filter((p) => !p.nurFuer || p.nurFuer.includes(eig)),
        ...bkp2GeneratedPositions(bkp2Aggregat, eig),
        ...customToPositions(customRows as never, eig),
      ]
      const typFor = makeTypFor(positions, konsRows as never, eig)
      const km = konsolidiertMengen({ buildings: buildings as never, eig, bkp2Aggregat, gsfTotal, mwstSatzGlobal: mwstSatz })
      const erg = buildKonsolidiert(konsRows as never, eig, km, [], positions, typFor).ergebnis
      totalNetto += erg.totalNetto; totalMwst += erg.totalMwst
      for (let c = 0; c <= 9; c++) {
        hgNetto[c] += erg.hauptgruppenSummenNetto[c as keyof typeof erg.hauptgruppenSummenNetto] ?? 0
        hgMwst[c]  += erg.hauptgruppenSummenMwst[c as keyof typeof erg.hauptgruppenSummenMwst] ?? 0
      }
    }

    const photo = photoByProjekt.get(projektId)
    const gis = gisByProjekt.get(projektId)
    const info: VariantInfo = {
      adresse: '', // wird unten aus der Projekt-Row gesetzt
      bildUrl: photo ? supabase.storage.from(PHOTO_BUCKET).getPublicUrl(photo).data.publicUrl : null,
      situationsplanUrl: gis ? supabase.storage.from(GIS_BUCKET).getPublicUrl(gis).data.publicUrl : null,
      vnf,
      vnfNachNutzung: [...nutzMap.entries()].filter(([, m2]) => m2 > 0).map(([nutzung, m2]) => ({ nutzung, m2 })).sort((a, b) => b.m2 - a.m2),
      nutzungen: [...nutzMap.keys()].filter((n) => n !== '(ohne)'),
      eigentumsarten: EIGENTUMSART_ORDER.filter((e) => eigSet.has(e)),
      anzahlWohnungen: wohnungen,
      wohnungsmix: WOHNUNGSMIX_KEYS.filter((k) => (mix[k] ?? 0) > 0).map((k) => ({ key: k, label: WOHNUNGSMIX_LABEL[k], anzahl: mix[k] })),
      tiefgaragePP,
      anlagekostenNetto: totalNetto,
      anlagekostenBrutto: totalNetto + totalMwst,
      bkp: HAUPTGRUPPEN.map((hg) => ({ code: hg.code, label: hg.label, netto: hgNetto[hg.code], brutto: hgNetto[hg.code] + hgMwst[hg.code] })),
    }
    infoCache.set(variantId, info)
    return info
  }

  return wertRows.map((r) => {
    const pv = pick<Record<string, unknown>>(r.project_variants as never)
    const pr = pick<Record<string, unknown>>(pv?.projects as never)
    const variantId = r.variant_id as string
    const info = infoFor(variantId)
    const adresse = [
      [pr?.strasse, pr?.hausnummer].filter(Boolean).join(' '),
      [pr?.plz, pr?.ort].filter(Boolean).join(' '),
    ].filter((s) => s).join(', ')
    return {
      variantId,
      projektId: (pv?.project_id as string) ?? '',
      projektName: (pr?.name as string) ?? '',
      projektNummer: (pr?.project_number as string | null) ?? null,
      variantName: (pv?.name as string) ?? '',
      eigentumsart: r.eigentumsart as Eigentumsart,
      kennwert: (r.kennwert as number | null) ?? null,
      betrag: (r.betrag_override as number | null) ?? null,
      info: { ...info, adresse },
    }
  })
}
