import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Anwendungsweiter Default-MWST-Satz (Fallback, falls DB nicht erreichbar / Migration fehlt).
export const MWST_FALLBACK = 0.081

/**
 * Lädt/speichert die globalen Anwendungs-Einstellungen (Singleton-Zeile id = 1).
 */
export function useAppSettings() {
  const [mwstDefault, setMwstDefault] = useState<number>(MWST_FALLBACK)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('app_settings')
        .select('mwst_default')
        .eq('id', 1)
        .maybeSingle()
      if (cancelled) return
      if (error) setError(error.message)
      if (data?.mwst_default != null) setMwstDefault(Number(data.mwst_default))
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const saveMwstDefault = useCallback(async (satz: number) => {
    setMwstDefault(satz)
    const { error } = await supabase
      .from('app_settings')
      .upsert({ id: 1, mwst_default: satz }, { onConflict: 'id' })
    if (error) setError(error.message)
  }, [])

  return { mwstDefault, saveMwstDefault, loading, error }
}

/** Einmaliger Lesezugriff (z. B. beim Anlegen neuer Varianten). */
export async function fetchDefaultMwst(): Promise<number> {
  const { data } = await supabase
    .from('app_settings')
    .select('mwst_default')
    .eq('id', 1)
    .maybeSingle()
  return data?.mwst_default != null ? Number(data.mwst_default) : MWST_FALLBACK
}
