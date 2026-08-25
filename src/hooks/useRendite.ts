import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { RENDITE_DEFAULTS, type RenditeParams } from '@/lib/rendite'

// DB-Zeile aus variant_rendite (snake_case).
interface RenditeRow {
  leerstand: number | null
  betriebskosten: number | null
  instandhaltung_pro_m2: number | null
  baurechtszins: number | null
  instandsetzung_pro_m2: number | null
  netto_kap_satz: number | null
}

function rowToParams(r: RenditeRow): RenditeParams {
  return {
    leerstand:           r.leerstand            ?? RENDITE_DEFAULTS.leerstand,
    betriebskosten:      r.betriebskosten       ?? RENDITE_DEFAULTS.betriebskosten,
    instandhaltungProM2: r.instandhaltung_pro_m2 ?? RENDITE_DEFAULTS.instandhaltungProM2,
    baurechtszins:       r.baurechtszins        ?? RENDITE_DEFAULTS.baurechtszins,
    instandsetzungProM2: r.instandsetzung_pro_m2 ?? RENDITE_DEFAULTS.instandsetzungProM2,
    nettoKapSatz:        r.netto_kap_satz       ?? RENDITE_DEFAULTS.nettoKapSatz,
  }
}

function toRow(variantId: string, p: RenditeParams) {
  return {
    variant_id:            variantId,
    leerstand:             p.leerstand,
    betriebskosten:        p.betriebskosten,
    instandhaltung_pro_m2: p.instandhaltungProM2,
    baurechtszins:         p.baurechtszins,
    instandsetzung_pro_m2: p.instandsetzungProM2,
    netto_kap_satz:        p.nettoKapSatz,
  }
}

/** Lädt/speichert die Rendite-Parameter einer Variante. */
export function useRendite(variantId: string) {
  const [params, setParamsState] = useState<RenditeParams>(RENDITE_DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!variantId) { setLoading(false); return }
      setLoading(true)
      const { data, error } = await supabase
        .from('variant_rendite')
        .select('*')
        .eq('variant_id', variantId)
        .maybeSingle()
      if (cancelled) return
      if (error) setError(error.message)
      setParamsState(data ? rowToParams(data as RenditeRow) : RENDITE_DEFAULTS)
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [variantId])

  const setParams = useCallback(async (next: RenditeParams) => {
    setParamsState(next)
    if (!variantId) return
    const { error } = await supabase
      .from('variant_rendite')
      .upsert(toRow(variantId, next), { onConflict: 'variant_id' })
    if (error) setError(error.message)
  }, [variantId])

  return { params, setParams, loading, error }
}
