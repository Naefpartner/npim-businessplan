import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  type BenchmarkDoc, type BenchmarkKennwerte, type BenchmarkZahlfeld,
  type BenchmarkModus, type Bkp2Methode,
  LEERE_KENNWERTE, normalizeBenchmark,
} from '@/lib/benchmark'

const LEERES_DOC: BenchmarkDoc = { modus: 'total', total: LEERE_KENNWERTE, bloecke: {} }

/**
 * Lädt/speichert die Kennwerte der Benchmark-Kostenberechnung einer Variante
 * (eine JSONB-Zeile pro Variante, siehe Migration 061).
 *
 * Das Dokument hält beide Erfassungstiefen nebeneinander: den Gesamtsatz und
 * die Sätze je Block. Ein Moduswechsel schaltet nur um, verwirft also nichts.
 * `blockKey` = null adressiert den Gesamtsatz.
 */
export function useBenchmarkKosten(variantId: string | undefined) {
  const [doc, setDoc] = useState<BenchmarkDoc>(LEERES_DOC)
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

  /** Kennwertsatz einer Ebene lesen — null = Gesamtsatz. */
  const kennwerte = useCallback(
    (key: string | null): BenchmarkKennwerte =>
      key == null ? doc.total : (doc.bloecke[key] ?? LEERE_KENNWERTE),
    [doc],
  )

  /** Kennwertsatz einer Ebene ändern und speichern. */
  const aendere = useCallback(
    (key: string | null, patch: Partial<BenchmarkKennwerte>) => {
      if (key == null) {
        void speichere({ ...doc, total: { ...doc.total, ...patch } })
        return
      }
      const vorher = doc.bloecke[key] ?? LEERE_KENNWERTE
      void speichere({ ...doc, bloecke: { ...doc.bloecke, [key]: { ...vorher, ...patch } } })
    },
    [doc, speichere],
  )

  const setFeld = useCallback(
    (key: string | null, feld: BenchmarkZahlfeld, wert: number | null) =>
      aendere(key, { [feld]: wert } as Partial<BenchmarkKennwerte>),
    [aendere],
  )

  /** Bezugsgrösse für BKP 2. Die Kennwerte der anderen Bezugsgrössen bleiben
   *  stehen, damit ein versehentlicher Wechsel nichts vernichtet. */
  const setBkp2Methode = useCallback(
    (key: string | null, bkp2Methode: Bkp2Methode) => aendere(key, { bkp2Methode }),
    [aendere],
  )

  const setModus = useCallback(
    (modus: BenchmarkModus) => void speichere({ ...doc, modus }),
    [doc, speichere],
  )

  return { doc, kennwerte, setFeld, setBkp2Methode, setModus, loading, error }
}
