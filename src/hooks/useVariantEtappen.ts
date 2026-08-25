import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { VariantEtappe } from '@/types'

// =============================================================================
// useVariantEtappen — Bauetappen einer Variante laden und verwalten.
// Jedes Gebäude gehört zu genau einer Etappe (variant_buildings.etappe_id).
// ensureDefault() stellt sicher, dass mindestens eine Etappe existiert.
// =============================================================================

export function useVariantEtappen(variantId: string | undefined) {
  const [etappen, setEtappen] = useState<VariantEtappe[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const ensuringRef = useRef(false)

  const load = useCallback(async (silent = false) => {
    if (!variantId) { setEtappen([]); setLoading(false); return }
    if (!silent) setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('variant_etappen')
      .select('*')
      .eq('variant_id', variantId)
      .order('sort_order', { ascending: true })
    if (error) setError(error.message)
    else setEtappen((data ?? []) as VariantEtappe[])
    if (!silent) setLoading(false)
  }, [variantId])

  useEffect(() => { void load() }, [load])

  /** Legt „Etappe 1" an, falls die Variante noch keine Etappe hat. */
  async function ensureDefault(): Promise<VariantEtappe | null> {
    if (!variantId || ensuringRef.current) return null
    // Frischen Stand prüfen, damit wir nicht doppelt anlegen.
    const { data: existing } = await supabase
      .from('variant_etappen')
      .select('*')
      .eq('variant_id', variantId)
      .order('sort_order', { ascending: true })
      .limit(1)
    if (existing && existing.length > 0) return existing[0] as VariantEtappe
    ensuringRef.current = true
    const { data, error } = await supabase
      .from('variant_etappen')
      .insert({ variant_id: variantId, name: 'Etappe 1', sort_order: 0 })
      .select()
      .single()
    ensuringRef.current = false
    if (error) { setError(error.message); return null }
    await load(true)
    return data as VariantEtappe
  }

  async function create(name: string): Promise<boolean> {
    if (!variantId) return false
    const next = etappen.length > 0 ? Math.max(...etappen.map((e) => e.sort_order)) + 1 : 0
    const { error } = await supabase
      .from('variant_etappen')
      .insert({ variant_id: variantId, name: name.trim() || `Etappe ${next + 1}`, sort_order: next })
    if (error) { setError(error.message); return false }
    await load(true)
    return true
  }

  async function rename(id: string, name: string): Promise<boolean> {
    const { error } = await supabase.from('variant_etappen').update({ name: name.trim() }).eq('id', id)
    if (error) { setError(error.message); return false }
    await load(true)
    return true
  }

  async function remove(id: string): Promise<boolean> {
    const { error } = await supabase.from('variant_etappen').delete().eq('id', id)
    if (error) { setError(error.message); return false }
    await load(true)
    return true
  }

  async function reorder(orderedIds: string[]): Promise<boolean> {
    const updates = orderedIds.map((id, idx) =>
      supabase.from('variant_etappen').update({ sort_order: idx }).eq('id', id),
    )
    const results = await Promise.all(updates)
    const firstError = results.find((r) => r.error)?.error
    if (firstError) { setError(firstError.message); return false }
    await load(true)
    return true
  }

  return { etappen, loading, error, reload: load, ensureDefault, create, rename, remove, reorder }
}
