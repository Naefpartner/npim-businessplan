import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  type BenchmarkDoc, type BenchmarkZahlfeld, type Bkp2Methode,
  LEERER_BENCHMARK, normalizeBenchmark,
} from '@/lib/benchmark'

/**
 * Lädt/speichert die Kennwerte der Benchmark-Kostenberechnung einer Variante
 * (eine JSONB-Zeile pro Variante, siehe Migration 061).
 */
export function useBenchmarkKosten(variantId: string | undefined) {
  const [doc, setDoc] = useState<BenchmarkDoc>(LEERER_BENCHMARK)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!variantId) { setLoading(false); return }
      setLoading(true)
      const { data, error } = await supabase
        .from('variant_benchmark_kosten')
        .select('doc')
        .eq('variant_id', variantId)
        .maybeSingle()
      if (cancelled) return
      if (error) { setError(error.message); console.error('[Benchmark] Laden fehlgeschlagen:', error.message) }
      setDoc(normalizeBenchmark(data?.doc as Partial<BenchmarkDoc> | null))
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [variantId])

  /**
   * Schreibt einen geänderten Stand. Optimistisch — bei Fehler wird auf den
   * vorherigen zurückgerollt, damit die Tabelle keine ungespeicherten Werte zeigt.
   */
  const speichere = useCallback(async (next: BenchmarkDoc) => {
    if (!variantId) return
    const vorher = doc
    setDoc(next)
    const { error } = await supabase
      .from('variant_benchmark_kosten')
      .upsert({ variant_id: variantId, doc: next }, { onConflict: 'variant_id' })
    if (error) {
      setDoc(vorher)
      setError(error.message)
      console.error('[Benchmark] Speichern fehlgeschlagen:', error.message)
    }
  }, [variantId, doc])

  const setFeld = useCallback(
    (feld: BenchmarkZahlfeld, wert: number | null) => void speichere({ ...doc, [feld]: wert }),
    [doc, speichere],
  )

  /** Bezugsgrösse für BKP 2. Die Kennwerte der anderen Methoden bleiben stehen,
   *  damit ein versehentlicher Wechsel nichts vernichtet. */
  const setMethode = useCallback(
    (bkp2Methode: Bkp2Methode) => void speichere({ ...doc, bkp2Methode }),
    [doc, speichere],
  )

  return { doc, setFeld, setMethode, loading, error }
}
