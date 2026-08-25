import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { ProjectPhoto } from '@/types'

const BUCKET = 'project-photos'

export interface ProjectPhotoWithUrl extends ProjectPhoto {
  publicUrl: string
}

export function useProjectPhotos(projectId: string | undefined) {
  const [photos, setPhotos] = useState<ProjectPhotoWithUrl[]>([])
  const [thumbnailPhotoId, setThumbnailPhotoId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!projectId) return
    if (!silent) setLoading(true)
    setError(null)

    const [photosRes, projectRes] = await Promise.all([
      supabase
        .from('project_photos')
        .select('*')
        .eq('project_id', projectId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('projects')
        .select('thumbnail_photo_id')
        .eq('id', projectId)
        .single(),
    ])

    if (photosRes.error) {
      setError(photosRes.error.message)
      setPhotos([])
    } else {
      const list = (photosRes.data ?? []) as ProjectPhoto[]
      const enriched: ProjectPhotoWithUrl[] = list.map((p) => ({
        ...p,
        publicUrl: supabase.storage.from(BUCKET).getPublicUrl(p.storage_path).data.publicUrl,
      }))
      setPhotos(enriched)
    }
    if (projectRes.error) {
      // nicht fatal — thumbnailPhotoId bleibt null
      setThumbnailPhotoId(null)
    } else {
      setThumbnailPhotoId(projectRes.data?.thumbnail_photo_id ?? null)
    }

    if (!silent) setLoading(false)
  }, [projectId])

  useEffect(() => { void load() }, [load])

  async function uploadPhoto(file: File): Promise<boolean> {
    if (!projectId) return false
    const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg'
    const path = `${projectId}/${crypto.randomUUID()}.${ext}`

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { upsert: false, contentType: file.type })
    if (upErr) { setError(upErr.message); return false }

    // Nächste sort_order
    const next = photos.length > 0 ? Math.max(...photos.map((p) => p.sort_order)) + 1 : 0

    const { data: inserted, error: dbErr } = await supabase
      .from('project_photos')
      .insert({
        project_id:   projectId,
        storage_path: path,
        file_name:    file.name,
        mime_type:    file.type || null,
        size_bytes:   file.size || null,
        sort_order:   next,
      })
      .select('*')
      .single()
    if (dbErr) {
      // Rollback im Storage
      await supabase.storage.from(BUCKET).remove([path])
      setError(dbErr.message)
      return false
    }

    // Erstes Foto automatisch als Thumbnail markieren
    if (photos.length === 0 && inserted) {
      await supabase.from('projects').update({ thumbnail_photo_id: inserted.id }).eq('id', projectId)
    }

    await load(true)
    return true
  }

  async function deletePhoto(photoId: string): Promise<boolean> {
    const target = photos.find((p) => p.id === photoId)
    if (!target) return false
    const { error: delErr } = await supabase.from('project_photos').delete().eq('id', photoId)
    if (delErr) { setError(delErr.message); return false }
    await supabase.storage.from(BUCKET).remove([target.storage_path])
    await load(true)
    return true
  }

  async function setThumbnail(photoId: string | null): Promise<boolean> {
    if (!projectId) return false
    const { error: err } = await supabase
      .from('projects')
      .update({ thumbnail_photo_id: photoId })
      .eq('id', projectId)
    if (err) { setError(err.message); return false }
    setThumbnailPhotoId(photoId)
    return true
  }

  return {
    photos,
    thumbnailPhotoId,
    loading,
    error,
    reload: load,
    uploadPhoto,
    deletePhoto,
    setThumbnail,
  }
}
