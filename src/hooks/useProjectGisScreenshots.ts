import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { ProjectGisScreenshot } from '@/types'

const BUCKET = 'project-gis'

export interface ProjectGisScreenshotWithUrl extends ProjectGisScreenshot {
  publicUrl: string
}

export function useProjectGisScreenshots(projectId: string | undefined) {
  const [items, setItems] = useState<ProjectGisScreenshotWithUrl[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!projectId) return
    if (!silent) setLoading(true)
    setError(null)

    const { data, error } = await supabase
      .from('project_gis_screenshots')
      .select('*')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) {
      setError(error.message)
      setItems([])
    } else {
      const list = (data ?? []) as ProjectGisScreenshot[]
      setItems(list.map((it) => ({
        ...it,
        publicUrl: supabase.storage.from(BUCKET).getPublicUrl(it.storage_path).data.publicUrl,
      })))
    }

    if (!silent) setLoading(false)
  }, [projectId])

  useEffect(() => { void load() }, [load])

  async function upload(file: File): Promise<boolean> {
    if (!projectId) return false

    const fromName = file.name.includes('.') ? file.name.split('.').pop() : null
    const fromMime = file.type.startsWith('image/') ? file.type.split('/')[1] : null
    const ext = (fromName || fromMime || 'png').toLowerCase()
    const path = `${projectId}/${crypto.randomUUID()}.${ext}`

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { upsert: false, contentType: file.type || 'image/png' })
    if (upErr) { setError(upErr.message); return false }

    const next = items.length > 0 ? Math.max(...items.map((i) => i.sort_order)) + 1 : 0

    const { error: dbErr } = await supabase
      .from('project_gis_screenshots')
      .insert({
        project_id:   projectId,
        storage_path: path,
        file_name:    file.name || null,
        mime_type:    file.type || null,
        size_bytes:   file.size || null,
        sort_order:   next,
      })

    if (dbErr) {
      await supabase.storage.from(BUCKET).remove([path])
      setError(dbErr.message)
      return false
    }

    await load(true)
    return true
  }

  async function remove(id: string): Promise<boolean> {
    const target = items.find((i) => i.id === id)
    if (!target) return false
    const { error } = await supabase.from('project_gis_screenshots').delete().eq('id', id)
    if (error) { setError(error.message); return false }
    void supabase.storage.from(BUCKET).remove([target.storage_path]).catch(() => {})
    await load(true)
    return true
  }

  return { items, loading, error, reload: load, upload, remove }
}
