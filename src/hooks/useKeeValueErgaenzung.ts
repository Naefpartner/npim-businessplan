import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  type ErgaenzungDoc, type ErgaenzungsDokument, type KeeValueModus,
  LEERE_ERGAENZUNG, normalizeErgaenzung,
} from '@/lib/keevalue'
import { GESAMT_KEY } from '@/hooks/useKeeValueImport'

const LEERES_DOC: ErgaenzungsDokument = { modus: 'total', total: LEERE_ERGAENZUNG, bloecke: {} }

/**
 * Lädt/speichert die Erfassungstiefe und die ergänzenden Kennwerte der
 * keeValue-Methode (BKP 0, 7, 8 sowie Reserve und Eigentümerkosten in 9) —
 * eine JSONB-Zeile pro Variante, siehe Migration 060.
 *
 * Wie bei den Benchmarks liegen Gesamtsatz und Blocksätze nebeneinander; ein
 * Moduswechsel schaltet nur um. Überlebt bewusst einen erneuten Excel-Import.
 */
export function useKeeValueErgaenzung(variantId: string | undefined) {
  const [doc, setDoc] = useState<ErgaenzungsDokument>(LEERES_DOC)
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
      setDoc(normalizeErgaenzung(data?.doc as Partial<ErgaenzungsDokument> | null))
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [variantId])

  /**
   * Schreibt einen geänderten Stand. Optimistisch — bei Fehler wird auf den
   * vorherigen zurückgerollt, damit die Tabelle keine ungespeicherten Werte zeigt.
   */
  const speichere = useCallback(async (next: ErgaenzungsDokument) => {
    if (!variantId) return
    const vorher = doc
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

  /** Kennwertsatz einer Ebene — der leere Schlüssel meint den Gesamtsatz. */
  const kennwerte = useCallback(
    (key: string): ErgaenzungDoc =>
      key === GESAMT_KEY ? doc.total : (doc.bloecke[key] ?? LEERE_ERGAENZUNG),
    [doc],
  )

  const setFeld = useCallback(
    (key: string, feld: keyof ErgaenzungDoc, wert: number | null) => {
      if (key === GESAMT_KEY) {
        void speichere({ ...doc, total: { ...doc.total, [feld]: wert } })
        return
      }
      const vorher = doc.bloecke[key] ?? LEERE_ERGAENZUNG
      void speichere({ ...doc, bloecke: { ...doc.bloecke, [key]: { ...vorher, [feld]: wert } } })
    },
    [doc, speichere],
  )

  const setModus = useCallback(
    (modus: KeeValueModus) => void speichere({ ...doc, modus }),
    [doc, speichere],
  )

  return { doc, kennwerte, setFeld, setModus, loading, error }
}
