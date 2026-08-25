import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { type MittelflussDoc, normalizeMittelflussDoc } from '@/lib/mittelfluss'

/**
 * Lädt/speichert das Mittelfluss-Dokument einer Variante (eine JSONB-Zeile pro
 * Variante). Speichern erfolgt debounced beim Aufrufer über `save(doc)`.
 */
export function useMittelfluss(variantId: string | undefined) {
  const [loaded, setLoaded] = useState<MittelflussDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!variantId) { setLoading(false); return }
      setLoading(true)
      const { data, error } = await supabase
        .from('variant_mittelfluss')
        .select('doc')
        .eq('variant_id', variantId)
        .maybeSingle()
      if (cancelled) return
      if (error) { setError(error.message); console.error('[Mittelfluss] Laden fehlgeschlagen:', error.message) }
      setLoaded(data ? normalizeMittelflussDoc(data.doc as Partial<MittelflussDoc>) : null)
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [variantId])

  const save = useCallback(async (doc: MittelflussDoc) => {
    if (!variantId) return
    const { error } = await supabase
      .from('variant_mittelfluss')
      .upsert({ variant_id: variantId, doc }, { onConflict: 'variant_id' })
    if (error) { setError(error.message); console.error('[Mittelfluss] Speichern fehlgeschlagen:', error.message) }
  }, [variantId])

  return { loaded, loading, error, save }
}
