import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { KeeValueImport } from '@/lib/keevalue'
import type { VariantKeeValueImport } from '@/types'

/**
 * Lädt/speichert den keeValue-Excel-Import einer Variante (eine Zeile pro
 * Variante — ein neuer Upload ersetzt den vorherigen, siehe Migration 059).
 */
export function useKeeValueImport(variantId: string | undefined) {
  const [row, setRow] = useState<VariantKeeValueImport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!variantId) { setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase
      .from('variant_keevalue_import')
      .select('*')
      .eq('variant_id', variantId)
      .maybeSingle()
    if (error) { setError(error.message); console.error('[keeValue] Laden fehlgeschlagen:', error.message) }
    setRow((data as VariantKeeValueImport | null) ?? null)
    setLoading(false)
  }, [variantId])

  useEffect(() => { void load() }, [load])

  /** Speichert einen frisch geparsten Import und ersetzt einen bestehenden. */
  const save = useCallback(async (imp: KeeValueImport, fileName: string) => {
    if (!variantId) return
    const { data: auth } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('variant_keevalue_import')
      .upsert({
        variant_id: variantId,
        file_name: fileName,
        preisstand: imp.preisstand,
        version: imp.version,
        doc: imp,
        imported_by: auth.user?.id ?? null,
      }, { onConflict: 'variant_id' })
      .select()
      .maybeSingle()
    if (error) {
      setError(error.message)
      console.error('[keeValue] Speichern fehlgeschlagen:', error.message)
      throw new Error(error.message)
    }
    setRow((data as VariantKeeValueImport | null) ?? null)
    setError(null)
  }, [variantId])

  const remove = useCallback(async () => {
    if (!variantId) return
    const { error } = await supabase
      .from('variant_keevalue_import')
      .delete()
      .eq('variant_id', variantId)
    if (error) { setError(error.message); console.error('[keeValue] Löschen fehlgeschlagen:', error.message); return }
    setRow(null)
  }, [variantId])

  /** Das geparste Dokument des gespeicherten Imports, falls vorhanden. */
  const imp = (row?.doc as KeeValueImport | undefined) ?? null

  return { row, imp, loading, error, save, remove, reload: load }
}
