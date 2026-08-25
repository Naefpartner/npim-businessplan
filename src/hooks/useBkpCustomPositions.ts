import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { VariantBkpCustomPosition, Eigentumsart } from '@/types'

// =============================================================================
// useBkpCustomPositions — eigene (benutzerdefinierte) Anlagekosten-Zeilen pro
// Block (Hauptgruppe × Eigentumsart). Werte liegen in variant_bkp_kosten
// (position_code = custom.id); hier nur Definition/Label/Sortierung.
// =============================================================================

export function useBkpCustomPositions(variantId: string | undefined) {
  const [rows, setRows]       = useState<VariantBkpCustomPosition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!variantId) { setRows([]); setLoading(false); return }
    if (!silent) setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('variant_bkp_custom_position')
      .select('*')
      .eq('variant_id', variantId)
      .order('sort_order', { ascending: true })
    if (error) setError(error.message)
    else setRows((data ?? []) as VariantBkpCustomPosition[])
    if (!silent) setLoading(false)
  }, [variantId])

  useEffect(() => { void load() }, [load])

  async function create(hauptgruppe: number, eig: Eigentumsart, label = 'Neue Position'): Promise<boolean> {
    if (!variantId) return false
    const siblings = rows.filter((r) => r.hauptgruppe === hauptgruppe && r.eigentumsart === eig)
    const next = siblings.length > 0 ? Math.max(...siblings.map((r) => r.sort_order)) + 1 : 0
    const { error } = await supabase
      .from('variant_bkp_custom_position')
      .insert({ variant_id: variantId, hauptgruppe, eigentumsart: eig, label, sort_order: next })
    if (error) { setError(error.message); return false }
    await load(true)
    return true
  }

  async function rename(id: string, label: string): Promise<boolean> {
    const { error } = await supabase.from('variant_bkp_custom_position').update({ label }).eq('id', id)
    if (error) { setError(error.message); return false }
    await load(true)
    return true
  }

  async function setCode(id: string, code: string): Promise<boolean> {
    const { error } = await supabase.from('variant_bkp_custom_position').update({ code }).eq('id', id)
    if (error) { setError(error.message); return false }
    await load(true)
    return true
  }

  async function remove(id: string): Promise<boolean> {
    // Werte in variant_bkp_kosten (position_code = id) mit entfernen.
    await supabase.from('variant_bkp_kosten').delete().eq('position_code', id)
    const { error } = await supabase.from('variant_bkp_custom_position').delete().eq('id', id)
    if (error) { setError(error.message); return false }
    await load(true)
    return true
  }

  return { rows, loading, error, reload: load, create, rename, setCode, remove }
}
