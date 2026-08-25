import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { BWO_DEFAULTS, type BwoParams } from '@/lib/bwo'

// DB-Zeile aus variant_bwo (snake_case).
interface BwoRow {
  energie_zuschlag_pct: number | null
  baugrund_zusatz: number | null
  wohn_limits: Record<string, number> | null
  nutzung_limits: Record<string, number> | null
}

function rowToParams(r: BwoRow): BwoParams {
  return {
    wohnLimits:         r.wohn_limits         ?? {},
    nutzungLimits:      r.nutzung_limits      ?? {},
    energieZuschlagPct: r.energie_zuschlag_pct ?? BWO_DEFAULTS.energieZuschlagPct,
    baugrundZusatz:     r.baugrund_zusatz      ?? BWO_DEFAULTS.baugrundZusatz,
  }
}

function toRow(variantId: string, p: BwoParams) {
  return {
    variant_id:           variantId,
    energie_zuschlag_pct: p.energieZuschlagPct,
    baugrund_zusatz:      p.baugrundZusatz,
    wohn_limits:          p.wohnLimits,
    nutzung_limits:       p.nutzungLimits,
  }
}

/** Lädt/speichert die BWO-Parameter (Bundesamt für Wohnungswesen) einer Variante. */
export function useBwo(variantId: string) {
  const [params, setParamsState] = useState<BwoParams>(BWO_DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!variantId) { setLoading(false); return }
      setLoading(true)
      const { data, error } = await supabase
        .from('variant_bwo')
        .select('*')
        .eq('variant_id', variantId)
        .maybeSingle()
      if (cancelled) return
      if (error) setError(error.message)
      setParamsState(data ? rowToParams(data as BwoRow) : BWO_DEFAULTS)
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [variantId])

  const setParams = useCallback(async (next: BwoParams) => {
    setParamsState(next)
    if (!variantId) return
    const { error } = await supabase
      .from('variant_bwo')
      .upsert(toRow(variantId, next), { onConflict: 'variant_id' })
    if (error) setError(error.message)
  }, [variantId])

  return { params, setParams, loading, error }
}
