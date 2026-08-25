import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { KostenMethode } from '@/types'

/**
 * Lädt/speichert die gewählte Erfassungsmethode der Anlagekosten einer Variante
 * (Spalte `kosten_methode` in project_variants — siehe Migration 059).
 * Wird beim Speichern optimistisch gesetzt und bei Fehler zurückgerollt.
 */
export function useKostenMethode(variantId: string | undefined) {
  const [methode, setMethode] = useState<KostenMethode>('detail')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!variantId) { setLoading(false); return }
      setLoading(true)
      const { data, error } = await supabase
        .from('project_variants')
        .select('kosten_methode')
        .eq('id', variantId)
        .maybeSingle()
      if (cancelled) return
      if (error) { setError(error.message); console.error('[Kostenmethode] Laden fehlgeschlagen:', error.message) }
      setMethode((data?.kosten_methode as KostenMethode) ?? 'detail')
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [variantId])

  const save = useCallback(async (next: KostenMethode) => {
    if (!variantId) return
    const vorher = methode
    setMethode(next)
    const { error } = await supabase
      .from('project_variants')
      .update({ kosten_methode: next })
      .eq('id', variantId)
    if (error) {
      setMethode(vorher)
      setError(error.message)
      console.error('[Kostenmethode] Speichern fehlgeschlagen:', error.message)
    }
  }, [variantId, methode])

  return { methode, setMethode: save, loading, error }
}
