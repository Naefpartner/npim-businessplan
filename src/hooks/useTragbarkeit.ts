import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { normalizeTragbarkeitDoc, type TragbarkeitDoc } from '@/lib/tragbarkeit'

/**
 * Lädt und speichert die Annahmen der Tragbarkeitsrechnung einer Variante
 * (eine JSONB-Zeile je Variante, Migration 072). Gespeichert wird vom Aufrufer
 * debounced über `save(doc)` — wie bei Mittelfluss und Kapital und Steuern.
 */
export function useTragbarkeit(variantId: string | undefined) {
  const [loaded, setLoaded] = useState<TragbarkeitDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let abgebrochen = false
    async function laden() {
      if (!variantId) { setLoading(false); return }
      setLoading(true)
      const { data, error } = await supabase
        .from('variant_tragbarkeit')
        .select('doc')
        .eq('variant_id', variantId)
        .maybeSingle()
      if (abgebrochen) return
      if (error) {
        setError(error.message)
        console.error('[Tragbarkeit] Laden fehlgeschlagen:', error.message)
      }
      setLoaded(data ? normalizeTragbarkeitDoc(data.doc as Partial<TragbarkeitDoc>) : null)
      setLoading(false)
    }
    void laden()
    return () => { abgebrochen = true }
  }, [variantId])

  const save = useCallback(async (doc: TragbarkeitDoc) => {
    if (!variantId) return
    const { error } = await supabase
      .from('variant_tragbarkeit')
      .upsert({ variant_id: variantId, doc }, { onConflict: 'variant_id' })
    if (error) {
      setError(error.message)
      console.error('[Tragbarkeit] Speichern fehlgeschlagen:', error.message)
    }
  }, [variantId])

  return { loaded, loading, error, save }
}
