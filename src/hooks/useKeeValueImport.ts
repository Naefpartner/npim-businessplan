import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { KeeValueImport } from '@/lib/keevalue'
import type { VariantKeeValueImport } from '@/types'

/** Der leere Schlüssel adressiert den Gesamtimport über die ganze Variante. */
export const GESAMT_KEY = ''

/**
 * Lädt/speichert die keeValue-Excel-Importe einer Variante — einen je Block
 * (Etappe × Nutzungsart) plus den Gesamtimport unter dem leeren Schlüssel,
 * siehe Migration 062. Ein erneuter Upload ersetzt den Import seines Blocks.
 */
export function useKeeValueImport(variantId: string | undefined) {
  const [rows, setRows] = useState<VariantKeeValueImport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!variantId) { setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase
      .from('variant_keevalue_import')
      .select('*')
      .eq('variant_id', variantId)
    if (error) { setError(error.message); console.error('[keeValue] Laden fehlgeschlagen:', error.message) }
    setRows((data as VariantKeeValueImport[] | null) ?? [])
    setLoading(false)
  }, [variantId])

  useEffect(() => { void load() }, [load])

  /** Die gespeicherte Zeile eines Blocks; null = noch kein Import. */
  const row = useCallback(
    (key: string): VariantKeeValueImport | null =>
      rows.find((r) => (r.block_key ?? GESAMT_KEY) === key) ?? null,
    [rows],
  )

  /** Das geparste keeValue-Dokument eines Blocks. */
  const imp = useCallback(
    (key: string): KeeValueImport | null =>
      (row(key)?.doc as KeeValueImport | undefined) ?? null,
    [row],
  )

  /** Speichert einen frisch geparsten Import und ersetzt den des Blocks. */
  const save = useCallback(async (key: string, parsed: KeeValueImport, fileName: string) => {
    if (!variantId) return
    const { data: auth } = await supabase.auth.getUser()
    const { error } = await supabase
      .from('variant_keevalue_import')
      .upsert({
        variant_id: variantId,
        block_key: key,
        file_name: fileName,
        preisstand: parsed.preisstand,
        version: parsed.version,
        doc: parsed,
        imported_by: auth.user?.id ?? null,
      }, { onConflict: 'variant_id,block_key' })
    if (error) {
      setError(error.message)
      console.error('[keeValue] Speichern fehlgeschlagen:', error.message)
      throw new Error(error.message)
    }
    setError(null)
    await load()
  }, [variantId, load])

  const remove = useCallback(async (key: string) => {
    if (!variantId) return
    const { error } = await supabase
      .from('variant_keevalue_import')
      .delete()
      .eq('variant_id', variantId)
      .eq('block_key', key)
    if (error) { setError(error.message); console.error('[keeValue] Löschen fehlgeschlagen:', error.message); return }
    await load()
  }, [variantId, load])

  /** Gibt es überhaupt einen Import? Steuert den Rückfall auf den Detailkatalog. */
  const hatImport = rows.length > 0

  return { rows, row, imp, hatImport, loading, error, save, remove, reload: load }
}
