import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { type HonorarDoc, type Disziplin, normalizeHonorarDoc } from '@/lib/honorar'

/**
 * Lädt/speichert das Honorar-Dokument eines Projekts (eine JSONB-Zeile pro Projekt).
 * Speichern erfolgt debounced beim Aufrufer über `save(doc)`.
 */
export function useHonorar(projectId: string | undefined) {
  const [loaded, setLoaded] = useState<HonorarDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!projectId) { setLoading(false); return }
      setLoading(true)
      const { data, error } = await supabase
        .from('project_honorar')
        .select('doc')
        .eq('project_id', projectId)
        .maybeSingle()
      if (cancelled) return
      if (error) { setError(error.message); console.error('[Honorarrechner] Laden fehlgeschlagen:', error.message) }
      setLoaded(data ? normalizeHonorarDoc(data.doc as Partial<HonorarDoc>) : null)
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [projectId])

  const save = useCallback(async (doc: HonorarDoc) => {
    if (!projectId) return
    const { error } = await supabase
      .from('project_honorar')
      .upsert({ project_id: projectId, doc }, { onConflict: 'project_id' })
    if (error) { setError(error.message); console.error('[Honorarrechner] Speichern fehlgeschlagen:', error.message) }
  }, [projectId])

  return { loaded, loading, error, save }
}

export interface PlanerLibraryEntry {
  source: string       // Herkunft (Projektname o. „Standard (SIA)")
  projectId: string | null
  planer: Disziplin
}

/**
 * Sammelt Planer-Definitionen (Bezeichnung + SIA-Parameter/Faktoren) aus ALLEN
 * zugänglichen Projekten (RLS) — als Vorschläge/Übernahme-Quelle für die Planer.
 * Jeder Eintrag trägt `projectId`, damit der Aufrufer bei Bedarf einzelne Projekte
 * (z. B. das aktuelle) herausfiltern kann. Der Standard-SIA-Katalog wird vom
 * Aufrufer separat vorangestellt.
 */
export function usePlanerLibrary() {
  const [entries, setEntries] = useState<PlanerLibraryEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('project_honorar')
        .select('project_id, doc, projects(name, project_number)')
      if (cancelled) return
      if (error) { setLoading(false); return }
      const out: PlanerLibraryEntry[] = []
      for (const row of (data ?? []) as Array<{ project_id: string; doc: Partial<HonorarDoc>; projects: { name?: string; project_number?: string } | null }>) {
        const planer = Array.isArray(row.doc?.planer) ? row.doc.planer : []
        const projName = row.projects?.name ?? 'Projekt'
        const nr = row.projects?.project_number ? `${row.projects.project_number} · ` : ''
        for (const p of planer) {
          if (p && typeof p === 'object' && p.label) out.push({ source: `${nr}${projName}`, projectId: row.project_id, planer: p as Disziplin })
        }
      }
      setEntries(out)
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [])

  return { entries, loading }
}
