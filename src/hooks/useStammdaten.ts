import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type {
  Parcel,
  ExistingBuilding,
  ExistingBuildingOwner,
  ZoneRegulation,
} from '@/types'

// ─── Parzellen ──────────────────────────────────────────────────────────────

export type ParcelInput = Omit<Parcel, 'id' | 'created_at' | 'updated_at' | 'project_id'>

export function useParcels(projectId: string | undefined) {
  const [parcels, setParcels] = useState<Parcel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectId) { setParcels([]); setLoading(false); return }
    setLoading(true); setError(null)
    const { data, error } = await supabase
      .from('parcels')
      .select('*')
      .eq('project_id', projectId)
      .order('parzelle_nummer', { ascending: true })
    if (error) setError(error.message)
    else setParcels((data ?? []) as Parcel[])
    setLoading(false)
  }, [projectId])

  useEffect(() => { load() }, [load])

  async function createParcel(input: ParcelInput): Promise<Parcel | null> {
    if (!projectId) return null
    const { data, error } = await supabase
      .from('parcels')
      .insert({ project_id: projectId, ...input })
      .select()
      .single()
    if (error) { setError(error.message); return null }
    await load()
    return data as Parcel
  }

  async function updateParcel(id: string, patch: Partial<ParcelInput>) {
    const { error } = await supabase.from('parcels').update(patch).eq('id', id)
    if (error) { setError(error.message); return false }
    await load()
    return true
  }

  async function deleteParcel(id: string) {
    const { error } = await supabase.from('parcels').delete().eq('id', id)
    if (error) { setError(error.message); return false }
    await load()
    return true
  }

  return { parcels, loading, error, reload: load, createParcel, updateParcel, deleteParcel }
}

// ─── Bestandsgebäude ────────────────────────────────────────────────────────

export type ExistingBuildingInput = Omit<
  ExistingBuilding,
  'id' | 'created_at' | 'updated_at' | 'project_id' | 'owners'
>

export function useExistingBuildings(projectId: string | undefined) {
  const [buildings, setBuildings] = useState<ExistingBuilding[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectId) { setBuildings([]); setLoading(false); return }
    setLoading(true); setError(null)
    const { data, error } = await supabase
      .from('existing_buildings')
      .select('*, owners:existing_building_owners(id, existing_building_id, name, anteil_pct, sort_order, created_at, updated_at)')
      .eq('project_id', projectId)
      .order('bezeichnung', { ascending: true })
    if (error) {
      setError(error.message)
    } else {
      const list = ((data ?? []) as ExistingBuilding[]).map((b) => ({
        ...b,
        owners: (b.owners ?? []).slice().sort(
          (a, c) => (a.sort_order - c.sort_order) || a.created_at.localeCompare(c.created_at),
        ),
      }))
      setBuildings(list)
    }
    setLoading(false)
  }, [projectId])

  useEffect(() => { load() }, [load])

  async function createBuilding(input: ExistingBuildingInput): Promise<ExistingBuilding | null> {
    if (!projectId) return null
    const { data, error } = await supabase
      .from('existing_buildings')
      .insert({ project_id: projectId, ...input })
      .select()
      .single()
    if (error) { setError(error.message); return null }
    await load()
    return data as ExistingBuilding
  }

  async function updateBuilding(id: string, patch: Partial<ExistingBuildingInput>) {
    const { error } = await supabase.from('existing_buildings').update(patch).eq('id', id)
    if (error) { setError(error.message); return false }
    await load()
    return true
  }

  async function deleteBuilding(id: string) {
    const { error } = await supabase.from('existing_buildings').delete().eq('id', id)
    if (error) { setError(error.message); return false }
    await load()
    return true
  }

  return {
    buildings, loading, error, reload: load,
    createBuilding, updateBuilding, deleteBuilding,
  }
}

// ─── Eigentümer-Anteile pro Bestandsgebäude ─────────────────────────────────

export interface ExistingBuildingOwnerInput {
  name: string
  anteil_pct: number
  sort_order?: number
}

export function useExistingBuildingOwners(buildingId: string | undefined) {
  const [owners, setOwners] = useState<ExistingBuildingOwner[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!buildingId) { setOwners([]); setLoading(false); return }
    setLoading(true); setError(null)
    const { data, error } = await supabase
      .from('existing_building_owners')
      .select('*')
      .eq('existing_building_id', buildingId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) setError(error.message)
    else setOwners((data ?? []) as ExistingBuildingOwner[])
    setLoading(false)
  }, [buildingId])

  useEffect(() => { load() }, [load])

  async function add(input: ExistingBuildingOwnerInput) {
    if (!buildingId) return false
    const sort_order = input.sort_order ?? (
      owners.length > 0 ? Math.max(...owners.map((o) => o.sort_order)) + 1 : 0
    )
    const { error } = await supabase.from('existing_building_owners').insert({
      existing_building_id: buildingId,
      name:                 input.name,
      anteil_pct:           input.anteil_pct,
      sort_order,
    })
    if (error) { setError(error.message); return false }
    await load()
    return true
  }

  async function update(id: string, patch: Partial<ExistingBuildingOwnerInput>) {
    const { error } = await supabase.from('existing_building_owners').update(patch).eq('id', id)
    if (error) { setError(error.message); return false }
    await load()
    return true
  }

  async function remove(id: string) {
    const { error } = await supabase.from('existing_building_owners').delete().eq('id', id)
    if (error) { setError(error.message); return false }
    await load()
    return true
  }

  return { owners, loading, error, reload: load, add, update, remove }
}

// ─── Zone-Regulations (für Ausnutzungsberechnung) ──────────────────────────

export type ZoneRegulationInput = Omit<
  ZoneRegulation,
  'id' | 'created_at' | 'updated_at' | 'project_id'
>

export function useZoneRegulations(projectId: string | undefined) {
  const [regs, setRegs] = useState<ZoneRegulation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectId) { setRegs([]); setLoading(false); return }
    setLoading(true); setError(null)
    const { data, error } = await supabase
      .from('zone_regulations')
      .select('*')
      .eq('project_id', projectId)
      .order('zone_type', { ascending: true })
    if (error) setError(error.message)
    else setRegs((data ?? []) as ZoneRegulation[])
    setLoading(false)
  }, [projectId])

  useEffect(() => { load() }, [load])

  // Upsert per (project_id, zone_type) — schreibt eine Regulation für eine Zone,
  // legt sie an, falls sie noch nicht existiert.
  async function upsertRegulation(zoneType: string, patch: Partial<ZoneRegulationInput>) {
    if (!projectId) return false
    const { error } = await supabase
      .from('zone_regulations')
      .upsert(
        { project_id: projectId, zone_type: zoneType, ...patch },
        { onConflict: 'project_id,zone_type' },
      )
    if (error) { setError(error.message); return false }
    await load()
    return true
  }

  return { regs, loading, error, reload: load, upsertRegulation }
}
