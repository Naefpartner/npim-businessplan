import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { VariantBkpKosten, Eigentumsart, PauschalPosten, CalcMethod, BaseRef } from '@/types'

// =============================================================================
// useBkpKosten — Anlagekosten-Einträge pro Variante × Etappe × Eigentumsart.
// etappe_id NULL = Konsolidiert-Ebene (etappenübergreifender Default).
// Reine Persistenz: liefert alle Rows + scope-basiertes upsert. Die Berechnung
// (Block-Ergebnisse, Konsolidiert-Aggregat) macht die Seite via '@/lib/bkpBlocks'.
// =============================================================================

export interface BkpScope {
  /** null = Konsolidiert-Ebene */
  etappeId: string | null
  eigentumsart: Eigentumsart
}

export interface BkpPatch {
  status?: VariantBkpKosten['status']
  kennwert?: number | null
  kennwert2?: number | null
  bezugsmenge_override?: number | null
  betrag_override?: number | null
  mengen_einheit_override?: string | null
  mwst_anwenden?: boolean | null
  mwst_satz_override?: number | null
  notiz?: string | null
  aggregate_from_etappen?: boolean
  pauschal_detail?: PauschalPosten[] | null
  calc_method?: CalcMethod | null
  calc_base?: BaseRef[] | null
}

export function useBkpKosten(variantId: string | undefined) {
  const [rows, setRows]       = useState<VariantBkpKosten[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!variantId) { setRows([]); setLoading(false); return }
    setLoading(true); setError(null)
    const { data, error } = await supabase
      .from('variant_bkp_kosten')
      .select('*')
      .eq('variant_id', variantId)
    if (error) setError(error.message)
    else setRows((data ?? []) as VariantBkpKosten[])
    setLoading(false)
  }, [variantId])

  useEffect(() => { void load() }, [load])

  /**
   * Setzt/aktualisiert einen Eintrag im gegebenen Scope (find-by-key →
   * update/insert; kein onConflict, da der Unique-Key die generierte
   * Sentinel-Spalte etappe_key nutzt). Die Richtung (Konsolidiert verteilt vs.
   * aus Etappen aggregiert) steuert das Flag aggregate_from_etappen, nicht ein
   * Löschen der Etappen-Rows.
   */
  async function upsert(positionCode: string, patch: BkpPatch, scope: BkpScope): Promise<boolean> {
    if (!variantId) return false

    const existing = rows.find(
      (r) =>
        r.etappe_id === scope.etappeId &&
        r.eigentumsart === scope.eigentumsart &&
        r.position_code === positionCode,
    )
    const has = (k: keyof BkpPatch) => Object.prototype.hasOwnProperty.call(patch, k)
    const fields = {
      status:                  has('status')                  ? patch.status                  : (existing?.status                  ?? 'beruecksichtigt'),
      kennwert:                has('kennwert')                ? patch.kennwert                : (existing?.kennwert                ?? null),
      kennwert2:               has('kennwert2')               ? patch.kennwert2               : (existing?.kennwert2               ?? null),
      bezugsmenge_override:    has('bezugsmenge_override')    ? patch.bezugsmenge_override    : (existing?.bezugsmenge_override    ?? null),
      betrag_override:         has('betrag_override')         ? patch.betrag_override         : (existing?.betrag_override         ?? null),
      mengen_einheit_override: has('mengen_einheit_override') ? patch.mengen_einheit_override : (existing?.mengen_einheit_override ?? null),
      mwst_anwenden:           has('mwst_anwenden')           ? patch.mwst_anwenden           : (existing?.mwst_anwenden           ?? null),
      mwst_satz_override:      has('mwst_satz_override')      ? patch.mwst_satz_override      : (existing?.mwst_satz_override      ?? null),
      notiz:                   has('notiz')                   ? patch.notiz                   : (existing?.notiz                   ?? null),
      aggregate_from_etappen:  has('aggregate_from_etappen')  ? patch.aggregate_from_etappen  : (existing?.aggregate_from_etappen  ?? false),
      pauschal_detail:         has('pauschal_detail')         ? patch.pauschal_detail         : (existing?.pauschal_detail         ?? null),
      calc_method:             has('calc_method')             ? patch.calc_method             : (existing?.calc_method             ?? null),
      calc_base:               has('calc_base')               ? patch.calc_base               : (existing?.calc_base               ?? null),
    }

    if (existing) {
      const { error } = await supabase.from('variant_bkp_kosten').update(fields).eq('id', existing.id)
      if (error) { setError(error.message); return false }
    } else {
      const { error } = await supabase.from('variant_bkp_kosten').insert({
        variant_id:    variantId,
        etappe_id:     scope.etappeId,
        eigentumsart:  scope.eigentumsart,
        position_code: positionCode,
        ...fields,
      })
      if (error) { setError(error.message); return false }
    }
    await load()
    return true
  }

  return { rows, loading, error, reload: load, upsert }
}
