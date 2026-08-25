import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { VariantEtappeGsfAlloc, Eigentumsart } from '@/types'

// =============================================================================
// useGsfAllocation — Aufteilung der projektweiten Grundstücksfläche je
// Etappe × Eigentumsart (prozentual oder in m²). Reine Persistenz; den
// effektiven Block-Anteil berechnet `gsfBlockShare` aus '@/lib/bkpBlocks'.
// =============================================================================

export interface GsfAllocPatch {
  mode?: 'pct' | 'm2'
  value?: number | null
}

function keyOf(etappeId: string, eig: Eigentumsart): string {
  return `${etappeId}::${eig}`
}

export function useGsfAllocation(variantId: string | undefined) {
  const [rows, setRows]       = useState<VariantEtappeGsfAlloc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!variantId) { setRows([]); setLoading(false); return }
    setLoading(true); setError(null)
    const { data, error } = await supabase
      .from('variant_etappe_gsf_alloc')
      .select('*')
      .eq('variant_id', variantId)
    if (error) setError(error.message)
    else setRows((data ?? []) as VariantEtappeGsfAlloc[])
    setLoading(false)
  }, [variantId])

  useEffect(() => { void load() }, [load])

  const byKey = useMemo(() => {
    const m = new Map<string, VariantEtappeGsfAlloc>()
    for (const r of rows) m.set(keyOf(r.etappe_id, r.eigentumsart), r)
    return m
  }, [rows])

  const get = useCallback(
    (etappeId: string, eig: Eigentumsart): VariantEtappeGsfAlloc | null =>
      byKey.get(keyOf(etappeId, eig)) ?? null,
    [byKey],
  )

  async function upsert(etappeId: string, eig: Eigentumsart, patch: GsfAllocPatch): Promise<boolean> {
    if (!variantId) return false
    const existing = byKey.get(keyOf(etappeId, eig))
    const has = (k: keyof GsfAllocPatch) => Object.prototype.hasOwnProperty.call(patch, k)
    const payload = {
      variant_id:   variantId,
      etappe_id:    etappeId,
      eigentumsart: eig,
      mode:  has('mode')  ? patch.mode!  : (existing?.mode  ?? 'pct'),
      value: has('value') ? patch.value! : (existing?.value ?? null),
    }
    const { error } = await supabase
      .from('variant_etappe_gsf_alloc')
      .upsert(payload, { onConflict: 'variant_id,etappe_id,eigentumsart' })
    if (error) { setError(error.message); return false }
    await load()
    return true
  }

  return { rows, loading, error, reload: load, get, upsert }
}
