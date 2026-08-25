import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchDefaultMwst } from '@/hooks/useAppSettings'
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

// Volatile Felder, die beim Kopieren neu vergeben werden.
function stripRow(row: Row): Row {
  const rest = { ...row }
  delete rest.id
  delete rest.created_at
  delete rest.updated_at
  return rest
}

/**
 * Kopiert ALLE variantengebundenen Inhalte von `sourceId` in `targetId`
 * (Mengengerüst, Erträge, Anlagekosten, Kostenmiete …) mit Neuvergabe der
 * IDs und Remapping der Fremdschlüssel. Projektgebundene Stammdaten
 * (Parzellen, Bestandsbauten, Fotos) bleiben geteilt und werden nicht kopiert.
 * Gibt `null` bei Erfolg zurück, sonst eine Fehlermeldung.
 */
export async function copyVariantContents(sourceId: string, targetId: string): Promise<string | null> {
  try {
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
      if (eos.length) {
        const { error } = await supabase
          .from('building_ertragsobjekte')
          .insert((eos as Row[]).map((x) => ({ ...stripRow(x), variant_building_id: newB })))
        if (error) throw error
      }
    }

    // 4) Mieteinheiten je Mietfläche
    for (const [oldMf, newMf] of mfMap) {
      const mes = (await supabase.from('building_mieteinheiten').select('*').eq('mietflaeche_id', oldMf)).data ?? []
      if (mes.length) {
        const { error } = await supabase
          .from('building_mieteinheiten')
          .insert((mes as Row[]).map((m) => ({ ...stripRow(m), mietflaeche_id: newMf })))
        if (error) throw error
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

    // 7) Kostenmiete + WBF + BWO + Rendite-Parameter (nur variant_id umsetzen)
    for (const table of ['variant_kostenmiete', 'variant_wbf_zh', 'variant_bwo', 'variant_rendite'] as const) {
      const rows = (await supabase.from(table).select('*').eq('variant_id', sourceId)).data ?? []
      if (rows.length) {
        const { error } = await supabase
          .from(table)
          .insert((rows as Row[]).map((r) => ({ ...stripRow(r), variant_id: targetId })))
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
    const payload: Record<string, unknown> = {
      project_id:  projectId,
      name:        input.name,
      phase:       input.phase  ?? 'loi',
      status:      input.status ?? 'entwurf',
      notes:       input.notes ?? null,
      snapshot_of: input.snapshot_of ?? null,
      created_by:  user?.id ?? null,
    }
    if (input.snapshot_of) {
      payload.snapshot_taken_at = new Date().toISOString()
      // Snapshot: MWST-Satz vom Quell-Stand übernehmen.
      const src = (await supabase.from('project_variants').select('mwst_satz').eq('id', input.snapshot_of).maybeSingle()).data
      if (src?.mwst_satz != null) payload.mwst_satz = src.mwst_satz
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
