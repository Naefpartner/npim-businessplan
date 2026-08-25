import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { type ErgaenzungDoc, LEERE_ERGAENZUNG, normalizeErgaenzung } from '@/lib/keevalue'

/**
 * Lädt/speichert die Kennwerte der von keeValue nicht abgedeckten Hauptgruppen
 * (BKP 0, 7, 8 und die Eigentümerkosten in 9) — eine JSONB-Zeile pro Variante,
 * siehe Migration 060. Überlebt bewusst einen erneuten Excel-Import.
 */
export function useKeeValueErgaenzung(variantId: string | undefined) {
  const [doc, setDoc] = useState<ErgaenzungDoc>(LEERE_ERGAENZUNG)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!variantId) { setLoading(false); return }
      setLoading(true)
      const { data, error } = await supabase
        .from('variant_keevalue_ergaenzung')
        .select('doc')
        .eq('variant_id', variantId)
        .maybeSingle()
      if (cancelled) return
      if (error) { setError(error.message); console.error('[keeValue-Ergänzung] Laden fehlgeschlagen:', error.message) }
      setDoc(normalizeErgaenzung(data?.doc as Partial<ErgaenzungDoc> | null))
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [variantId])

  /**
   * Setzt ein einzelnes Feld. Optimistisch — bei Fehler wird auf den vorherigen
   * Stand zurückgerollt, damit die Tabelle keine ungespeicherten Werte zeigt.
   */
  const setFeld = useCallback(async (feld: keyof ErgaenzungDoc, wert: number | null) => {
    if (!variantId) return
    const vorher = doc
    const next = { ...doc, [feld]: wert }
    setDoc(next)
    const { error } = await supabase
      .from('variant_keevalue_ergaenzung')
      .upsert({ variant_id: variantId, doc: next }, { onConflict: 'variant_id' })
    if (error) {
      setDoc(vorher)
      setError(error.message)
      console.error('[keeValue-Ergänzung] Speichern fehlgeschlagen:', error.message)
    }
  }, [variantId, doc])

  return { doc, setFeld, loading, error }
}
