import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Project } from '@/types'

export interface ProjectInput {
  name: string
  project_number?: string | null
  strasse?: string | null
  hausnummer?: string | null
  plz?: string | null
  ort?: string | null
  description?: string | null
  start_year?: number | null
  customer_id?: string | null
  gis_url?: string | null
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('projects')
      .select('*, customer:customers(id, name), thumbnail_photo:project_photos!projects_thumbnail_photo_id_fkey(id, storage_path)')
      .order('updated_at', { ascending: false })
    if (error) setError(error.message)
    else setProjects((data ?? []) as Project[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function createProject(input: ProjectInput): Promise<Project | null> {
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('projects')
      .insert({
        name:           input.name,
        project_number: input.project_number ?? null,
        strasse:        input.strasse ?? null,
        hausnummer:     input.hausnummer ?? null,
        plz:            input.plz ?? null,
        ort:            input.ort ?? null,
        description:    input.description ?? null,
        start_year:     input.start_year ?? null,
        customer_id:    input.customer_id ?? null,
        created_by:     user?.id ?? null,
      })
      .select()
      .single()
    if (error) { setError(error.message); return null }
    await load()
    return data as Project
  }

  async function updateProject(id: string, patch: Partial<ProjectInput> & { archived?: boolean }) {
    const { error } = await supabase.from('projects').update(patch).eq('id', id)
    if (error) { setError(error.message); return false }
    await load()
    return true
  }

  async function deleteProject(id: string) {
    const { error } = await supabase.from('projects').delete().eq('id', id)
    if (error) { setError(error.message); return false }
    await load()
    return true
  }

  return { projects, loading, error, reload: load, createProject, updateProject, deleteProject }
}

export async function fetchProject(id: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[useProjects] fetchProject:', error.message)
    return null
  }
  return data as Project | null
}
