import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Lädt/speichert die Bemerkungen zu den Anlagekosten einer Variante (Spalte
 * `anlagekosten_bemerkungen`, Migration 068). Sie halten fest, was die Zahlen
 * nicht hergeben — Abgrenzungen, ausgenommene Leistungen, Annahmen — und
 * erscheinen unter der Kostentabelle im Bericht.
 *
 * Optimistisch gesetzt und bei Fehler zurückgerollt, wie die übrigen Felder
 * der Variante.
 */
export function useAnlagekostenBemerkungen(variantId: string | undefined) {
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [speichert, setSpeichert] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let abgebrochen = false
    async function laden() {
      if (!variantId) { setLoading(false); return }
      setLoading(true)
      const { data, error } = await supabase
        .from('project_variants')
        .select('anlagekosten_bemerkungen')
        .eq('id', variantId)
        .maybeSingle()
      if (abgebrochen) return
      if (error) {
        setError(error.message)
        console.error('[Anlagekosten] Bemerkungen laden fehlgeschlagen:', error.message)
      }
      setText((data?.anlagekosten_bemerkungen as string | null) ?? null)
      setLoading(false)
    }
    void laden()
    return () => { abgebrochen = true }
  }, [variantId])

  const speichern = useCallback(async (naechst: string | null) => {
    if (!variantId) return
    const vorher = text
    setText(naechst)
    setSpeichert(true)
    const { error } = await supabase
      .from('project_variants')
      .update({ anlagekosten_bemerkungen: naechst })
      .eq('id', variantId)
    setSpeichert(false)
    if (error) {
      setText(vorher)
      setError(error.message)
      console.error('[Anlagekosten] Bemerkungen speichern fehlgeschlagen:', error.message)
    }
  }, [variantId, text])

  return { text, speichern, loading, speichert, error }
}
