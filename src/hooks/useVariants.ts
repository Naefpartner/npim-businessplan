import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchDefaultMwst } from '@/hooks/useAppSettings'
import { HONORAR_JE_VARIANTE } from '@/lib/honorar'
import type {
  ProjectPhase,
  ProjectVariant,
  VariantStatus,
} from '@/types'

interface VariantInput {
  name: string
  phase?: ProjectPhase
  status?: VariantStatus
  notes?: string | null
  snapshot_of?: string | null
}

type Row = Record<string, unknown>

/*
 * ────────────────────────────────────────────────────────────────────────────
 * Was zu einem Stand gehört
 *
 * Wird ein Stand kopiert, muss alles mit, was an der Variante hängt — sonst
 * steht der Nutzer vor einer Kopie, in der einzelne Reiter leer sind, und
 * merkt es erst spät. Die Tabellen stehen deshalb hier und nicht verstreut im
 * Code:
 *
 *   • EINFACHE_TABELLEN — eine `variant_id`, sonst keine Fremdschlüssel. Sie
 *     werden Zeile für Zeile übernommen; meist ist es genau eine Zeile mit
 *     einem JSON-Dokument.
 *   • Die übrigen brauchen eine Umsetzung ihrer Fremdschlüssel und stehen
 *     einzeln in `copyVariantContents`: variant_etappen, variant_buildings,
 *     building_mietflaechen, building_mieteinheiten, building_ertragsobjekte,
 *     variant_bkp_custom_position, variant_bkp_kosten,
 *     variant_etappe_gsf_alloc.
 *   • Dazu die nach Variante geschlüsselten Felder in `project_honorar` —
 *     der Honorarrechner hängt am Projekt, seine Eingaben an der Variante.
 *
 * NEUE TABELLE MIT `variant_id`? Hier eintragen (oder, wenn sie eigene
 * Fremdschlüssel hat, in `copyVariantContents` einbauen). `npm run check:kopie`
 * vergleicht die Migrationen mit dieser Datei und meldet, was fehlt.
 * ────────────────────────────────────────────────────────────────────────────
 */
const EINFACHE_TABELLEN = [
  // Wirtschaftlichkeit
  'variant_kostenmiete',
  'variant_rendite',
  'variant_tragbarkeit',
  // Vorgaben der öffentlichen Hand
  'variant_wbf_zh',
  'variant_bwo',
  // Kostenmethoden
  'variant_benchmark_kosten',
  'variant_keevalue_import',
  'variant_keevalue_ergaenzung',
  // Zeit und Kapital
  'variant_mittelfluss',
  'variant_kapital_steuern',
] as const

/*
 * Felder des Stands selbst (`project_variants`), die die Kopie NICHT vom
 * Original übernimmt: sie bekommt eine eigene Identität, Nummer und Herkunft.
 * Alles andere — Status, MWST-Satz, Kostenmethode, Rendite-Modus, Bemerkungen,
 * Berichtseinstellungen, Umbrüche und jede künftig angehängte Spalte — geht
 * 1:1 mit. Name, Phase und Notizen kommen aus dem Dialog und überschreiben.
 * `npm run check:kopie` meldet Einträge, die es als Spalte nicht (mehr) gibt.
 */
export const STAND_NEU_VERGEBEN = [
  'id',
  'project_id',
  'variant_number',
  'snapshot_of',
  'snapshot_taken_at',
  'created_by',
  'created_at',
  'updated_at',
] as const

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/**
 * Setzt in einem gespeicherten Wert jede ID des Originals auf die der Kopie
 * um — in Texten und in Objektschlüsseln, beliebig tief. Die JSON-Dokumente
 * führen IDs auf vielerlei Art: als Schlüssel ('<etappe_id>|<eig>' in der
 * Mittelfluss-Verteilung, '<mieteinheit_id>' bzw. '<mietflaeche_id>-fl' bei den
 * Verkaufsobjekten), als Block-Schlüssel ('<etappe_id>::<eig>') oder als Liste
 * (Etappenauswahl im Bericht). Statt jede Stelle einzeln zu kennen, wird jede
 * UUID ersetzt, die zu einem kopierten Datensatz gehört; fremde IDs (Nutzer,
 * Projekt) stehen nicht in der Map und bleiben.
 */
function remapIds<T>(wert: T, idMap: Map<string, string>): T {
  if (typeof wert === 'string') {
    return wert.replace(UUID_RE, (id) => idMap.get(id.toLowerCase()) ?? id) as T
  }
  if (Array.isArray(wert)) return wert.map((x) => remapIds(x, idMap)) as T
  if (wert && typeof wert === 'object') {
    const out: Row = {}
    for (const [k, v] of Object.entries(wert as Row)) out[remapIds(k, idMap)] = remapIds(v, idMap)
    return out as T
  }
  return wert
}

// Volatile Felder, die beim Kopieren neu vergeben werden.
function stripRow(row: Row): Row {
  const rest = { ...row }
  delete rest.id
  delete rest.created_at
  delete rest.updated_at
  return rest
}

/**
 * Kopiert ALLE variantengebundenen Inhalte von `sourceId` in `targetId` — mit
 * Neuvergabe der IDs und Remapping der Fremdschlüssel. Was dazugehört, steht
 * in der Liste oben; projektgebundene Stammdaten (Parzellen, Bestandsbauten,
 * Fotos) bleiben geteilt und werden nicht kopiert.
 * Gibt `null` bei Erfolg zurück, sonst eine Fehlermeldung.
 */
export async function copyVariantContents(sourceId: string, targetId: string): Promise<string | null> {
  try {
    // Alt → neu für alles, was kopiert wird (Grundlage für remapIds).
    const idMap = new Map<string, string>()

    // 1) Etappen — id-Map für Gebäude & GSF-Allokation
    const etappeMap = new Map<string, string>()
    const etappen = (await supabase.from('variant_etappen').select('*').eq('variant_id', sourceId)).data ?? []
    for (const e of etappen as Row[]) {
      const { data, error } = await supabase
        .from('variant_etappen')
        .insert({ ...stripRow(e), variant_id: targetId })
        .select('id').single()
      if (error) throw error
      etappeMap.set(e.id as string, (data as Row).id as string)
    }

    // 2) Gebäude — id-Map für Mietflächen/Ertragsobjekte; etappe_id remappen
    const buildingMap = new Map<string, string>()
    const buildings = (await supabase.from('variant_buildings').select('*').eq('variant_id', sourceId)).data ?? []
    for (const b of buildings as Row[]) {
      const oldEt = b.etappe_id as string | null
      const { data, error } = await supabase
        .from('variant_buildings')
        .insert({ ...stripRow(b), variant_id: targetId, etappe_id: oldEt ? etappeMap.get(oldEt) ?? null : null })
        .select('id').single()
      if (error) throw error
      buildingMap.set(b.id as string, (data as Row).id as string)
    }

    // 3) Mietflächen (+ Ertragsobjekte) je Gebäude — id-Map für Mieteinheiten
    const mfMap = new Map<string, string>()
    for (const [oldB, newB] of buildingMap) {
      const mfs = (await supabase.from('building_mietflaechen').select('*').eq('variant_building_id', oldB)).data ?? []
      for (const mf of mfs as Row[]) {
        const { data, error } = await supabase
          .from('building_mietflaechen')
          .insert({ ...stripRow(mf), variant_building_id: newB })
          .select('id').single()
        if (error) throw error
        mfMap.set(mf.id as string, (data as Row).id as string)
      }
      const eos = (await supabase.from('building_ertragsobjekte').select('*').eq('variant_building_id', oldB)).data ?? []
      for (const x of eos as Row[]) {
        const { data, error } = await supabase
          .from('building_ertragsobjekte')
          .insert({ ...stripRow(x), variant_building_id: newB })
          .select('id').single()
        if (error) throw error
        idMap.set(x.id as string, (data as Row).id as string)
      }
    }

    // 4) Mieteinheiten je Mietfläche — einzeln, damit die id-Map stimmt: die
    //    Verkaufsobjekte der Mittelflussrechnung sind nach ihnen geschlüsselt.
    for (const [oldMf, newMf] of mfMap) {
      const mes = (await supabase.from('building_mieteinheiten').select('*').eq('mietflaeche_id', oldMf)).data ?? []
      for (const m of mes as Row[]) {
        const { data, error } = await supabase
          .from('building_mieteinheiten')
          .insert({ ...stripRow(m), mietflaeche_id: newMf })
          .select('id').single()
        if (error) throw error
        idMap.set(m.id as string, (data as Row).id as string)
      }
    }

    // 5) Eigene Anlagekosten-Positionen — id-Map. Wichtig: in variant_bkp_kosten
    //    ist die position_code dieser Zeilen die UUID der Custom-Position, daher
    //    muss sie unten remappt werden. Zuerst kopieren, um die Map zu haben.
    const customMap = new Map<string, string>()
    const custom = (await supabase.from('variant_bkp_custom_position').select('*').eq('variant_id', sourceId)).data ?? []
    for (const c of custom as Row[]) {
      const { data, error } = await supabase
        .from('variant_bkp_custom_position')
        .insert({ ...stripRow(c), variant_id: targetId })
        .select('id').single()
      if (error) throw error
      customMap.set(c.id as string, (data as Row).id as string)
    }

    // 6) Anlagekosten je Etappe × Eigentumsart — etappe_id remappen (NULL =
    //    konsolidiert bleibt NULL), position_code für Custom-Positionen auf die
    //    neue id umsetzen; generierte Spalte etappe_key NICHT mitschreiben.
    const bkp = (await supabase.from('variant_bkp_kosten').select('*').eq('variant_id', sourceId)).data ?? []
    if (bkp.length) {
      const { error } = await supabase.from('variant_bkp_kosten').insert((bkp as Row[]).map((r) => {
        const row = stripRow(r)
        delete row.etappe_key
        const oldEt = r.etappe_id as string | null
        const pc = r.position_code as string
        return {
          ...row,
          variant_id: targetId,
          etappe_id: oldEt ? etappeMap.get(oldEt) ?? null : null,
          position_code: customMap.get(pc) ?? pc,
        }
      }))
      if (error) throw error
    }

    // Alle bisher vergebenen IDs in eine Map — für die Verweise in den
    // JSON-Dokumenten unten (siehe remapIds).
    idMap.set(sourceId, targetId)
    for (const m of [etappeMap, buildingMap, mfMap, customMap]) {
      for (const [alt, neu] of m) idMap.set(alt, neu)
    }

    // 7) Alle Tabellen, die nur an der variant_id hängen (siehe Liste oben).
    //    Ihre Dokumente und Schlüssel (z.B. block_key, Mittelfluss-Verteilung
    //    je Etappe und je Verkaufsobjekt) zeigen danach auf die Kopie.
    for (const table of EINFACHE_TABELLEN) {
      const rows = (await supabase.from(table).select('*').eq('variant_id', sourceId)).data ?? []
      if (rows.length) {
        const { error } = await supabase
          .from(table)
          .insert((rows as Row[]).map((r) => ({ ...remapIds(stripRow(r), idMap), variant_id: targetId })))
        if (error) throw error
      }
    }

    // 8) GSF-Allokation (variant_id + etappe_id umsetzen)
    const gsf = (await supabase.from('variant_etappe_gsf_alloc').select('*').eq('variant_id', sourceId)).data ?? []
    if (gsf.length) {
      const { error } = await supabase
        .from('variant_etappe_gsf_alloc')
        .insert((gsf as Row[]).map((r) => ({
          ...stripRow(r),
          variant_id: targetId,
          etappe_id: etappeMap.get(r.etappe_id as string) ?? r.etappe_id,
        })))
      if (error) throw error
    }

    // 9) Berichtseinstellungen und Umbrüche: kamen schon mit dem Stand, die
    //    Etappenauswahl führt aber Etappen-IDs — auf die Kopie umsetzen.
    const ziel = (await supabase.from('project_variants')
      .select('bericht_einstellungen, bericht_umbrueche').eq('id', targetId).maybeSingle()).data as Row | null
    if (ziel) {
      const { error } = await supabase.from('project_variants')
        .update({
          bericht_einstellungen: remapIds(ziel.bericht_einstellungen, idMap),
          bericht_umbrueche: remapIds(ziel.bericht_umbrueche, idMap),
        })
        .eq('id', targetId)
      if (error) throw error
    }

    // 10) Honorarrechner: er hängt am Projekt, seine Eingaben aber an der
    //    Variante. Die nach Variante geschlüsselten Felder bekommen einen
    //    Eintrag für den neuen Stand — eine tiefe Kopie, damit die beiden
    //    Stände sich nachher nicht gegenseitig verändern.
    const quelle = (await supabase.from('project_variants')
      .select('project_id').eq('id', sourceId).maybeSingle()).data as Row | null
    const projectId = quelle?.project_id as string | undefined
    if (projectId) {
      const hon = (await supabase.from('project_honorar')
        .select('id, doc').eq('project_id', projectId).maybeSingle()).data as Row | null
      const doc = hon?.doc as Record<string, unknown> | undefined
      if (hon && doc) {
        let geaendert = false
        for (const key of HONORAR_JE_VARIANTE) {
          const map = doc[key]
          if (!map || typeof map !== 'object') continue
          const jeVariante = map as Record<string, unknown>
          if (!(sourceId in jeVariante)) continue
          jeVariante[targetId] = remapIds(JSON.parse(JSON.stringify(jeVariante[sourceId])), idMap)
          geaendert = true
        }
        if (geaendert) {
          const { error } = await supabase.from('project_honorar')
            .update({ doc }).eq('id', hon.id as string)
          if (error) throw error
        }
      }
    }

    return null
  } catch (e) {
    const msg = e instanceof Error ? e.message : ((e as { message?: string })?.message ?? 'Unbekannter Fehler')
    console.error('[copyVariantContents]', msg)
    return msg
  }
}

/**
 * Kopiert eine komplette Etappe innerhalb derselben Variante: die Etappe selbst
 * plus alle zugehörigen Gebäude (mit Mietflächen, Mieteinheiten, Ertragsobjekten),
 * die etappenbezogenen Anlagekosten und die GSF-Allokation. Custom-Positionen
 * sind variantenweit und werden nur referenziert (nicht dupliziert).
 * Gibt `null` bei Erfolg zurück, sonst eine Fehlermeldung.
 */
export async function copyEtappe(variantId: string, etappeId: string): Promise<string | null> {
  try {
    // 1) Etappe duplizieren (gleiche Variante, neuer Name, ans Ende)
    const src = (await supabase.from('variant_etappen').select('*').eq('id', etappeId).single()).data as Row | null
    if (!src) return 'Etappe nicht gefunden'
    const sortRows = (await supabase.from('variant_etappen').select('sort_order').eq('variant_id', variantId)).data as Row[] | null
    const nextSort = (sortRows ?? []).reduce((m, r) => Math.max(m, (r.sort_order as number) ?? 0), -1) + 1
    const newEt = await supabase.from('variant_etappen')
      .insert({ ...stripRow(src), name: `${src.name as string} (Kopie)`, sort_order: nextSort })
      .select('id').single()
    if (newEt.error) throw newEt.error
    const newEtId = (newEt.data as Row).id as string

    // 2) Gebäude dieser Etappe
    const buildingMap = new Map<string, string>()
    const buildings = (await supabase.from('variant_buildings').select('*').eq('etappe_id', etappeId)).data ?? []
    for (const b of buildings as Row[]) {
      const { data, error } = await supabase.from('variant_buildings')
        .insert({ ...stripRow(b), etappe_id: newEtId }).select('id').single()
      if (error) throw error
      buildingMap.set(b.id as string, (data as Row).id as string)
    }

    // 3) Mietflächen (+ Ertragsobjekte) je Gebäude; Mieteinheiten je Mietfläche
    const mfMap = new Map<string, string>()
    for (const [oldB, newB] of buildingMap) {
      const mfs = (await supabase.from('building_mietflaechen').select('*').eq('variant_building_id', oldB)).data ?? []
      for (const mf of mfs as Row[]) {
        const { data, error } = await supabase.from('building_mietflaechen')
          .insert({ ...stripRow(mf), variant_building_id: newB }).select('id').single()
        if (error) throw error
        mfMap.set(mf.id as string, (data as Row).id as string)
      }
      const eos = (await supabase.from('building_ertragsobjekte').select('*').eq('variant_building_id', oldB)).data ?? []
      if (eos.length) {
        const { error } = await supabase.from('building_ertragsobjekte')
          .insert((eos as Row[]).map((x) => ({ ...stripRow(x), variant_building_id: newB })))
        if (error) throw error
      }
    }
    for (const [oldMf, newMf] of mfMap) {
      const mes = (await supabase.from('building_mieteinheiten').select('*').eq('mietflaeche_id', oldMf)).data ?? []
      if (mes.length) {
        const { error } = await supabase.from('building_mieteinheiten')
          .insert((mes as Row[]).map((m) => ({ ...stripRow(m), mietflaeche_id: newMf })))
        if (error) throw error
      }
    }

    // 4) Anlagekosten dieser Etappe (etappe_id umsetzen, etappe_key weglassen)
    const bkp = (await supabase.from('variant_bkp_kosten').select('*')
      .eq('variant_id', variantId).eq('etappe_id', etappeId)).data ?? []
    if (bkp.length) {
      const { error } = await supabase.from('variant_bkp_kosten').insert((bkp as Row[]).map((r) => {
        const row = stripRow(r)
        delete row.etappe_key
        return { ...row, etappe_id: newEtId }
      }))
      if (error) throw error
    }

    // 5) GSF-Allokation dieser Etappe
    const gsf = (await supabase.from('variant_etappe_gsf_alloc').select('*').eq('etappe_id', etappeId)).data ?? []
    if (gsf.length) {
      const { error } = await supabase.from('variant_etappe_gsf_alloc')
        .insert((gsf as Row[]).map((r) => ({ ...stripRow(r), etappe_id: newEtId })))
      if (error) throw error
    }

    return null
  } catch (e) {
    const msg = e instanceof Error ? e.message : ((e as { message?: string })?.message ?? 'Unbekannter Fehler')
    console.error('[copyEtappe]', msg)
    return msg
  }
}

export function useVariants(projectId: string | undefined) {
  const [variants, setVariants] = useState<ProjectVariant[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectId) { setVariants([]); setLoading(false); return }
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('project_variants')
      .select('*')
      .eq('project_id', projectId)
      .order('variant_number', { ascending: true })
    if (error) setError(error.message)
    else setVariants((data ?? []) as ProjectVariant[])
    setLoading(false)
  }, [projectId])

  useEffect(() => { load() }, [load])

  async function createVariant(input: VariantInput): Promise<ProjectVariant | null> {
    if (!projectId) return null
    const { data: { user } } = await supabase.auth.getUser()
    let payload: Record<string, unknown> = {
      project_id:  projectId,
      name:        input.name,
      phase:       input.phase  ?? 'loi',
      status:      input.status ?? 'entwurf',
      notes:       input.notes ?? null,
      snapshot_of: input.snapshot_of ?? null,
      created_by:  user?.id ?? null,
    }
    if (input.snapshot_of) {
      /*
       * Snapshot: ALLE Felder des Stands selbst mitnehmen, ausser denen, die
       * die Kopie neu bekommt (STAND_NEU_VERGEBEN). Der Status kommt vom
       * Original, sofern der Aufrufer keinen vorgibt.
       */
      const { data: src, error: srcErr } = await supabase.from('project_variants')
        .select('*').eq('id', input.snapshot_of).single()
      if (srcErr || !src) { setError(srcErr?.message ?? 'Quell-Stand nicht gefunden'); return null }
      const uebernommen: Row = { ...(src as Row) }
      for (const feld of STAND_NEU_VERGEBEN) delete uebernommen[feld]
      payload = {
        ...uebernommen,
        ...payload,
        status: input.status ?? (src as Row).status ?? 'entwurf',
        snapshot_taken_at: new Date().toISOString(),
      }
    } else {
      // Neuer Stand: anwendungsweiten Standard-MWST-Satz verwenden.
      payload.mwst_satz = await fetchDefaultMwst()
    }

    const { data, error } = await supabase
      .from('project_variants')
      .insert(payload)
      .select()
      .single()
    if (error) { setError(error.message); return null }
    const created = data as ProjectVariant

    // Beim Kopieren: alle Inhalte des Quell-Stands tief mitkopieren.
    if (input.snapshot_of) {
      const copyErr = await copyVariantContents(input.snapshot_of, created.id)
      if (copyErr) setError(`Stand angelegt, aber Inhalte konnten nicht vollständig kopiert werden: ${copyErr}`)
    }

    await load()
    return created
  }

  async function updateVariant(id: string, patch: Partial<VariantInput>) {
    const { error } = await supabase.from('project_variants').update(patch).eq('id', id)
    if (error) { setError(error.message); return false }
    await load()
    return true
  }

  async function deleteVariant(id: string) {
    const { error } = await supabase.from('project_variants').delete().eq('id', id)
    if (error) { setError(error.message); return false }
    await load()
    return true
  }

  /**
   * Ordnet die Stände neu: vergibt `variant_number` gemäss `orderedIds` neu
   * (1..N). Zweiphasig, um die UNIQUE(project_id, variant_number)-Kollision zu
   * vermeiden — zuerst temporäre Hochnummern, dann die finalen. Optimistisch.
   */
  async function reorderVariants(orderedIds: string[]): Promise<boolean> {
    const byId = new Map(variants.map((v) => [v.id, v]))
    if (orderedIds.length !== variants.length || orderedIds.some((id) => !byId.has(id))) return false
    // Optimistisch neu ordnen + umnummerieren.
    setVariants(orderedIds.map((id, i) => ({ ...byId.get(id)!, variant_number: i + 1 })))
    const maxN = variants.reduce((m, v) => Math.max(m, v.variant_number), 0)
    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await supabase.from('project_variants').update({ variant_number: maxN + 1 + i }).eq('id', orderedIds[i])
      if (error) { setError(error.message); await load(); return false }
    }
    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await supabase.from('project_variants').update({ variant_number: i + 1 }).eq('id', orderedIds[i])
      if (error) { setError(error.message); await load(); return false }
    }
    await load()
    return true
  }

  return { variants, loading, error, reload: load, createVariant, updateVariant, deleteVariant, reorderVariants }
}

export async function fetchVariant(id: string): Promise<ProjectVariant | null> {
  const { data, error } = await supabase
    .from('project_variants')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[useVariants] fetchVariant:', error.message)
    return null
  }
  return data as ProjectVariant | null
}
