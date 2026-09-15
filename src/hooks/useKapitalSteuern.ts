import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  normalizeKapitalSteuernDoc, type KapitalSteuernDoc,
} from '@/lib/kapitalSteuern'

/**
 * Lädt und speichert das Kapital-und-Steuern-Dokument einer Variante (eine
 * JSONB-Zeile je Variante, Migration 069). Gespeichert wird vom Aufrufer
 * debounced über `save(doc)` — wie bei der Mittelflussrechnung.
 */
export function useKapitalSteuern(variantId: string | undefined) {
  const [loaded, setLoaded] = useState<KapitalSteuernDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let abgebrochen = false
    async function laden() {
      if (!variantId) { setLoading(false); return }
      setLoading(true)
      const { data, error } = await supabase
        .from('variant_kapital_steuern')
        .select('doc')
        .eq('variant_id', variantId)
        .maybeSingle()
      if (abgebrochen) return
      if (error) {
        setError(error.message)
        console.error('[Kapital und Steuern] Laden fehlgeschlagen:', error.message)
      }
      setLoaded(data
        ? normalizeKapitalSteuernDoc(data.doc as Partial<KapitalSteuernDoc>)
        : null)
      setLoading(false)
    }
    void laden()
    return () => { abgebrochen = true }
  }, [variantId])

  const save = useCallback(async (doc: KapitalSteuernDoc) => {
    if (!variantId) return
    const { error } = await supabase
      .from('variant_kapital_steuern')
      .upsert({ variant_id: variantId, doc }, { onConflict: 'variant_id' })
    if (error) {
      setError(error.message)
      console.error('[Kapital und Steuern] Speichern fehlgeschlagen:', error.message)
    }
  }, [variantId])

  return { loaded, loading, error, save }
}
