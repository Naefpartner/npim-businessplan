import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { RenditeModus } from '@/types'

/**
 * Lädt/speichert die gewählte Betrachtung der Renditeobjekte einer Variante
 * (Spalte `rendite_modus` in project_variants — siehe Migration 064).
 * Optimistisch gesetzt und bei Fehler zurückgerollt, wie bei der Kostenmethode.
 */
export function useRenditeModus(variantId: string | undefined) {
  const [modus, setModus] = useState<RenditeModus>('rendite')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!variantId) { setLoading(false); return }
      setLoading(true)
      const { data, error } = await supabase
        .from('project_variants')
        .select('rendite_modus')
        .eq('id', variantId)
        .maybeSingle()
      if (cancelled) return
      if (error) { setError(error.message); console.error('[Renditemodus] Laden fehlgeschlagen:', error.message) }
      setModus((data?.rendite_modus as RenditeModus) ?? 'rendite')
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [variantId])

  const save = useCallback(async (next: RenditeModus) => {
    if (!variantId) return
    const vorher = modus
    setModus(next)
    const { error } = await supabase
      .from('project_variants')
      .update({ rendite_modus: next })
      .eq('id', variantId)
    if (error) {
      setModus(vorher)
      setError(error.message)
      console.error('[Renditemodus] Speichern fehlgeschlagen:', error.message)
    }
  }, [variantId, modus])

  return { modus, setModus: save, loading, error }
}
