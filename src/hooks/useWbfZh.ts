import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { WBF_DEFAULTS, type WbfParams } from '@/lib/wbf'

// DB-Zeile aus variant_wbf_zh (snake_case).
interface WbfRow {
  chf_pro_punkt_erstellung: number | null
  energiezuschlag_pct: number | null
  chf_pro_punkt_investition_total: number | null
  punkte: Record<string, number> | null
  nutzung_rates: Record<string, number> | null
}

function rowToParams(r: WbfRow): WbfParams {
  return {
    // Punkte: gespeicherte Werte über die Defaults legen (neue Kategorien erhalten Defaults).
    punkte: { ...WBF_DEFAULTS.punkte, ...(r.punkte ?? {}) },
    chfProPunktErstellung:       r.chf_pro_punkt_erstellung        ?? WBF_DEFAULTS.chfProPunktErstellung,
    energiezuschlagPct:          r.energiezuschlag_pct             ?? WBF_DEFAULTS.energiezuschlagPct,
    chfProPunktInvestitionTotal: r.chf_pro_punkt_investition_total ?? WBF_DEFAULTS.chfProPunktInvestitionTotal,
    nutzungRates:                r.nutzung_rates                   ?? {},
  }
}

function toRow(variantId: string, p: WbfParams) {
  return {
    variant_id:                      variantId,
    chf_pro_punkt_erstellung:        p.chfProPunktErstellung,
    energiezuschlag_pct:             p.energiezuschlagPct,
    chf_pro_punkt_investition_total: p.chfProPunktInvestitionTotal,
    punkte:                          p.punkte,
    nutzung_rates:                   p.nutzungRates,
  }
}

/** Lädt/speichert die WBF-Parameter (kantonale Wohnbauförderung ZH) einer Variante. */
export function useWbfZh(variantId: string) {
  const [params, setParamsState] = useState<WbfParams>(WBF_DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!variantId) { setLoading(false); return }
      setLoading(true)
      const { data, error } = await supabase
        .from('variant_wbf_zh')
        .select('*')
        .eq('variant_id', variantId)
        .maybeSingle()
      if (cancelled) return
      if (error) setError(error.message)
      setParamsState(data ? rowToParams(data as WbfRow) : WBF_DEFAULTS)
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [variantId])

  const setParams = useCallback(async (next: WbfParams) => {
    setParamsState(next)
    if (!variantId) return
    const { error } = await supabase
      .from('variant_wbf_zh')
      .upsert(toRow(variantId, next), { onConflict: 'variant_id' })
    if (error) setError(error.message)
  }, [variantId])

  return { params, setParams, loading, error }
}
