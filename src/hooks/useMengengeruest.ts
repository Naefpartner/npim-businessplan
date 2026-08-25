import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type {
  VariantBuilding,
  BuildingMietflaeche,
  BuildingMieteinheit,
  BuildingErtragsobjekt,
  Wohnungsmix,
} from '@/types'
import { WOHNUNGSMIX_KEYS } from '@/types'

// =============================================================================
// useMengengeruest — lädt alle Gebäude einer Variante inklusive ihrer
// Mietflächen, Mengen und Ertragsobjekte in einem Roundtrip (Supabase JOIN).
// =============================================================================

export interface VariantBuildingFull extends VariantBuilding {
  mietflaechen:   BuildingMietflaeche[]
  ertragsobjekte: BuildingErtragsobjekt[]
}

export type VariantBuildingInput = Omit<
  VariantBuilding,
  'id' | 'created_at' | 'updated_at' | 'variant_id'
>

export type MietflaecheInput = Omit<
  BuildingMietflaeche,
  'id' | 'created_at' | 'updated_at' | 'variant_building_id' | 'mieteinheiten'
>

export type MieteinheitInput = Omit<
  BuildingMieteinheit,
  'id' | 'created_at' | 'updated_at' | 'mietflaeche_id'
>

export type ErtragsobjektInput = Omit<
  BuildingErtragsobjekt,
  'id' | 'created_at' | 'updated_at' | 'variant_building_id'
>

export function useMengengeruest(variantId: string | undefined) {
  const [buildings, setBuildings] = useState<VariantBuildingFull[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!variantId) { setBuildings([]); setLoading(false); return }
    if (!silent) setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('variant_buildings')
      .select(`
        *,
        mietflaechen:building_mietflaechen(
          *,
          mieteinheiten:building_mieteinheiten(*)
        ),
        ertragsobjekte:building_ertragsobjekte(*)
      `)
      .eq('variant_id', variantId)
      .order('sort_order', { ascending: true })
    if (error) {
      setError(error.message)
      setBuildings([])
    } else {
      const mapped: VariantBuildingFull[] = (data ?? []).map((row: VariantBuildingFull) => ({
        ...row,
        mietflaechen: [...(row.mietflaechen ?? [])]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((m) => ({
            ...m,
            mieteinheiten: [...(m.mieteinheiten ?? [])].sort((a, b) => a.sort_order - b.sort_order),
          })),
        ertragsobjekte: [...(row.ertragsobjekte ?? [])].sort((a, b) => a.sort_order - b.sort_order),
      }))
      setBuildings(mapped)
    }

    if (!silent) setLoading(false)
  }, [variantId])

  useEffect(() => { load() }, [load])

  // ─── Gebäude-CRUD ────────────────────────────────────────────────────────

  async function createBuilding(input: VariantBuildingInput): Promise<VariantBuilding | null> {
    if (!variantId) return null
    // sort_order ans Ende
    const next = buildings.length > 0 ? Math.max(...buildings.map((b) => b.sort_order)) + 1 : 0
    const { data, error } = await supabase
      .from('variant_buildings')
      .insert({ variant_id: variantId, ...input, sort_order: input.sort_order || next })
      .select()
      .single()
    if (error) { setError(error.message); return null }
    await load(true)
    return data as VariantBuilding
  }

  async function updateBuilding(id: string, patch: Partial<VariantBuildingInput>) {
    const { error } = await supabase.from('variant_buildings').update(patch).eq('id', id)
    if (error) { setError(error.message); return false }
    await load(true)
    return true
  }

  async function deleteBuilding(id: string) {
    const { error } = await supabase.from('variant_buildings').delete().eq('id', id)
    if (error) { setError(error.message); return false }
    await load(true)
    return true
  }

  // Dupliziert ein Gebäude inklusive aller Mietflächen + Ertragsobjekte
  async function duplicateBuilding(id: string): Promise<boolean> {
    if (!variantId) return false
    const source = buildings.find((b) => b.id === id)
    if (!source) { setError('Gebäude nicht gefunden'); return false }

    const nextSort = buildings.length > 0
      ? Math.max(...buildings.map((b) => b.sort_order)) + 1
      : 0

    const { mietflaechen, ertragsobjekte, id: _srcId, created_at: _ct, updated_at: _ut, ...rest } = source
    void _srcId; void _ct; void _ut
    const newPayload = { ...rest, name: `${source.name} (Kopie)`, sort_order: nextSort }

    const { data: created, error: bErr } = await supabase
      .from('variant_buildings')
      .insert(newPayload)
      .select()
      .single()
    if (bErr || !created) { setError(bErr?.message ?? 'Duplizieren fehlgeschlagen'); return false }

    // Mietflächen einzeln duplizieren, damit wir pro neue Zeile die Mieteinheiten
    // mit der korrekten neuen mietflaeche_id einfügen können.
    for (const m of mietflaechen) {
      const {
        id: _mid, created_at: _mct, updated_at: _mut, variant_building_id: _vbid,
        mieteinheiten: srcUnits,
        ...mRest
      } = m
      void _mid; void _mct; void _mut; void _vbid

      const { data: newMf, error: mErr } = await supabase
        .from('building_mietflaechen')
        .insert({ ...mRest, variant_building_id: created.id })
        .select('id')
        .single()
      if (mErr || !newMf) { setError(mErr?.message ?? 'Mietfläche-Kopie fehlgeschlagen'); await load(true); return false }

      const units = srcUnits ?? []
      if (units.length > 0) {
        const unitRows = units.map((u) => {
          const { id: _uid, created_at: _uct, updated_at: _uut, mietflaeche_id: _mfid, ...uRest } = u
          void _uid; void _uct; void _uut; void _mfid
          return { ...uRest, mietflaeche_id: newMf.id }
        })
        const { error: uErr } = await supabase.from('building_mieteinheiten').insert(unitRows)
        if (uErr) { setError(uErr.message); await load(true); return false }
      }
    }

    if (ertragsobjekte.length > 0) {
      const newE = ertragsobjekte.map((e) => {
        const { id: _id, created_at: _ect, updated_at: _eut, variant_building_id: _vbid, ...eRest } = e
        void _id; void _ect; void _eut; void _vbid
        return { ...eRest, variant_building_id: created.id }
      })
      const { error: eErr } = await supabase.from('building_ertragsobjekte').insert(newE)
      if (eErr) { setError(eErr.message); await load(true); return false }
    }

    await load(true)
    return true
  }

  // ─── Mietflächen ─────────────────────────────────────────────────────────

  async function createMietflaeche(buildingId: string, input: MietflaecheInput) {
    const { error } = await supabase
      .from('building_mietflaechen')
      .insert({ variant_building_id: buildingId, ...input })
    if (error) { setError(error.message); return false }
    await load(true)
    return true
  }

  async function updateMietflaeche(id: string, patch: Partial<MietflaecheInput>) {
    const { error } = await supabase.from('building_mietflaechen').update(patch).eq('id', id)
    if (error) { setError(error.message); return false }
    await load(true)
    return true
  }

  async function deleteMietflaeche(id: string) {
    const { error } = await supabase.from('building_mietflaechen').delete().eq('id', id)
    if (error) { setError(error.message); return false }
    await load(true)
    return true
  }

  async function duplicateMietflaeche(id: string): Promise<boolean> {
    const source = buildings.flatMap((b) => b.mietflaechen).find((m) => m.id === id)
    if (!source) { setError('Mietfläche nicht gefunden'); return false }
    // mieteinheiten ist ein nested-Array vom JOIN, keine echte Spalte —
    // separat behandeln und die id/created_at/updated_at aus dem Insert nehmen.
    const {
      id: _id, created_at: _ct, updated_at: _ut,
      mieteinheiten: sourceUnits,
      ...rest
    } = source
    void _id; void _ct; void _ut

    // sort_order ist smallint — max + 1 unter den Geschwistern verwenden.
    const siblings = buildings
      .find((b) => b.id === source.variant_building_id)?.mietflaechen ?? []
    const nextSort = siblings.length > 0
      ? Math.max(...siblings.map((m) => m.sort_order ?? 0)) + 1
      : 0

    const { data: inserted, error: insertErr } = await supabase
      .from('building_mietflaechen')
      .insert({ ...rest, sort_order: nextSort })
      .select('id')
      .single()
    if (insertErr || !inserted) {
      setError(insertErr?.message ?? 'Insert fehlgeschlagen')
      return false
    }

    // Mieteinheiten der Quelle mitkopieren — mietflaeche_id auf die neue Zeile.
    const units = sourceUnits ?? []
    if (units.length > 0) {
      const unitPayload = units.map((u) => {
        const { id: _uid, created_at: _uct, updated_at: _uut, ...rest } = u
        void _uid; void _uct; void _uut
        return { ...rest, mietflaeche_id: inserted.id }
      })
      const { error: unitsErr } = await supabase
        .from('building_mieteinheiten')
        .insert(unitPayload)
      if (unitsErr) { setError(unitsErr.message); return false }
    }

    await load(true)
    return true
  }

  async function reorderBuildings(orderedIds: string[]): Promise<boolean> {
    const updates = orderedIds.map((id, idx) =>
      supabase.from('variant_buildings').update({ sort_order: idx }).eq('id', id),
    )
    const results = await Promise.all(updates)
    const firstError = results.find((r) => r.error)?.error
    if (firstError) { setError(firstError.message); return false }
    await load(true)
    return true
  }

  async function reorderMietflaechen(orderedIds: string[]): Promise<boolean> {
    const updates = orderedIds.map((id, idx) =>
      supabase.from('building_mietflaechen').update({ sort_order: idx }).eq('id', id),
    )
    const results = await Promise.all(updates)
    const firstError = results.find((r) => r.error)?.error
    if (firstError) { setError(firstError.message); return false }
    await load(true)
    return true
  }

  async function reorderMieteinheiten(orderedIds: string[]): Promise<boolean> {
    const updates = orderedIds.map((id, idx) =>
      supabase.from('building_mieteinheiten').update({ sort_order: idx }).eq('id', id),
    )
    const results = await Promise.all(updates)
    const firstError = results.find((r) => r.error)?.error
    if (firstError) { setError(firstError.message); return false }
    await load(true)
    return true
  }

  // ─── Mieteinheiten (Detail-Zeilen pro Mietfläche) ──────────────────────

  // Aggregiert nur die "Einheiten-eigenen" Werte (VMF + Mietzinsen) der
  // Mieteinheiten und schreibt sie zurück in die Mietfläche. GF, Höhe,
  // Volumen und Faktor bleiben unangetastet — der User kann sie weiterhin
  // auf der Geschoss-Zeile pflegen.
  async function syncMietflaecheFromUnits(mietflaecheId: string) {
    const [unitsRes, parentRes] = await Promise.all([
      supabase.from('building_mieteinheiten').select('*').eq('mietflaeche_id', mietflaecheId),
      supabase.from('building_mietflaechen').select('gf_m2, locked_fields').eq('id', mietflaecheId).single(),
    ])
    const units = unitsRes.data
    if (!units) return

    const list = units as BuildingMieteinheit[]
    if (list.length === 0) return

    const parentGf    = (parentRes.data?.gf_m2 ?? null) as number | null
    const parentLocks = new Set((parentRes.data?.locked_fields ?? []) as string[])
    // Verkaufsobjekt? Dann ist CHF/Stk ein Total pro Stk (Faktor 1) statt
    // CHF/Stk·Mt (Miete, Faktor 12).
    const parentBuilding = buildings.find((b) => b.mietflaechen.some((m) => m.id === mietflaecheId))
    const periodF = parentBuilding?.use_type === 'verkaufsobjekt' ? 1 : 12

    const sumOrNull = (vals: number[]) =>
      vals.some((v) => v > 0) ? vals.reduce((s, v) => s + v, 0) : null

    // Wichtig: flaeche_m2, miete_chf_pa & Co. sind in der Mieteinheit bereits
    // das Total für ihre anzahl-Stk (recalc setzt z.B. flaeche_m2 = anzahl ×
    // vmf_pro_stk). Daher hier einfach summieren — NICHT nochmal × anzahl.
    const vmf       = list.reduce((s, u) => s + (u.flaeche_m2 ?? 0), 0)
    const anzahl    = list.reduce((s, u) => s + (u.anzahl ?? 1), 0)
    const vmfProStk = anzahl > 0 && vmf > 0 ? vmf / anzahl : null
    const chfPa     = sumOrNull(list.map((u) => u.miete_chf_pa ?? 0))
    // CHF/Stk·Mt und CHF/m²·a sind Raten — auf der Mietfläche aus den
    // aggregierten Totals abgeleitet, damit sie zur Summe konsistent sind.
    const chfStkMt  = anzahl > 0 && chfPa != null && chfPa > 0 ? chfPa / anzahl / periodF : null
    // CHF/m²·a nur aus Einheiten MIT VMF/VKF — Parkplätze o.Ä. ohne Fläche
    // zählen nicht zum m²-Preis (verfälschen ihn sonst).
    const chfPaMitVmf = list.reduce((s, u) => s + ((u.flaeche_m2 ?? 0) > 0 ? (u.miete_chf_pa ?? 0) : 0), 0)
    const chfM2     = vmf > 0 && chfPaMitVmf > 0 ? chfPaMitVmf / vmf : null

    // Wohnungsmix aus Units summieren (anzahl × wert je Schlüssel).
    // Liefert nur Werte zurück, wenn mindestens eine Unit einen Wert > 0 hat;
    // sonst null, damit alte/leere Mietfläche nicht mit lauter Nullen gefüllt wird.
    let mixAggregate: Wohnungsmix | null = null
    const hasAnyMix = list.some(
      (u) => u.wohnungsmix && WOHNUNGSMIX_KEYS.some((k) => (u.wohnungsmix?.[k] ?? 0) > 0),
    )
    if (hasAnyMix) {
      // Anzahl der Mieteinheit ist bereits aus dem Wohnungsmix abgeleitet
      // (Summe aller Stückzahlen) — daher hier KEINE Multiplikation mit anzahl,
      // sonst würde doppelt gezählt.
      const agg: Wohnungsmix = {}
      for (const k of WOHNUNGSMIX_KEYS) {
        const sum = list.reduce((s, u) => s + (u.wohnungsmix?.[k] ?? 0), 0)
        if (sum > 0) agg[k] = sum
      }
      mixAggregate = agg
    }

    // GF aus den Mieteinheiten hochrechnen (Default, sofern GF nicht gelockt):
    // je Einheit die erfasste GF, sonst aus VMF/Faktor abgeleitet.
    const gfPerUnit = (u: BuildingMieteinheit) => {
      if (u.gf_m2 != null && u.gf_m2 > 0) return u.gf_m2
      if (u.faktor_vmf_gf != null && u.faktor_vmf_gf > 0 && (u.flaeche_m2 ?? 0) > 0) return (u.flaeche_m2 ?? 0) / u.faktor_vmf_gf
      return 0
    }
    const gfAggregiert = sumOrNull(list.map(gfPerUnit))
    const gfToSet = gfAggregiert != null && gfAggregiert > 0 && !parentLocks.has('gf') ? gfAggregiert : null

    // Faktor VMF/GF aus der (neuen) GF ableiten — bevorzugt aus der summierten
    // GF der Einheiten, sonst aus einer bestehenden GF auf der Mietfläche.
    const effektiveGf = gfToSet ?? (parentGf != null && parentGf > 0 ? parentGf : null)
    const faktorAbgeleitet =
      effektiveGf != null && effektiveGf > 0 && vmf > 0 && !parentLocks.has('faktor')
        ? vmf / effektiveGf
        : null

    const payload: Partial<BuildingMietflaeche> = {
      flaeche_m2:       vmf,
      anzahl:           anzahl > 0 ? anzahl : 1,
      vmf_pro_stk:      vmfProStk,
      miete_chf_pa:     chfPa,
      miete_chf_stk_mt: chfStkMt,
      miete_chf_m2_pa:  chfM2,
      wohnungsmix:      mixAggregate,
    }
    if (gfToSet != null) payload.gf_m2 = gfToSet
    if (faktorAbgeleitet != null) payload.faktor_vmf_gf = faktorAbgeleitet

    await supabase.from('building_mietflaechen').update(payload).eq('id', mietflaecheId)
  }

  async function createMieteinheit(mietflaecheId: string, input?: Partial<MieteinheitInput>) {
    // Bestimme nächste sort_order
    const parent = buildings.flatMap((b) => b.mietflaechen).find((m) => m.id === mietflaecheId)
    const next = parent && parent.mieteinheiten && parent.mieteinheiten.length > 0
      ? Math.max(...parent.mieteinheiten.map((u) => u.sort_order)) + 1
      : 0

    // Ersteinheit: übernimmt die aktuellen Mietflächen-Werte als Startwert,
    // damit beim Wechsel ins Detail-Modell keine Daten verloren gehen.
    const isFirst = !parent?.mieteinheiten || parent.mieteinheiten.length === 0
    const seed: Partial<MieteinheitInput> = isFirst && parent
      ? {
          bezeichnung:      parent.bezeichnung ?? null,
          zimmer:           parent.zimmer ?? null,
          anzahl:           parent.anzahl ?? 1,
          gf_m2:            parent.gf_m2 ?? null,
          geschosshoehe_m:  parent.geschosshoehe_m ?? null,
          volumen_m3:       parent.volumen_m3 ?? null,
          faktor_vmf_gf:    parent.faktor_vmf_gf ?? null,
          flaeche_m2:       parent.flaeche_m2 ?? 0,
          miete_chf_m2_pa:  parent.miete_chf_m2_pa ?? null,
          miete_chf_stk_mt: parent.miete_chf_stk_mt ?? null,
          miete_chf_pa:     parent.miete_chf_pa ?? null,
          locked_fields:    parent.locked_fields ?? [],
        }
      : {}

    const payload = {
      mietflaeche_id:   mietflaecheId,
      sort_order:       next,
      bezeichnung:      input?.bezeichnung ?? seed.bezeichnung ?? null,
      zimmer:           input?.zimmer ?? seed.zimmer ?? null,
      anzahl:           input?.anzahl ?? seed.anzahl ?? 1,
      gf_m2:            input?.gf_m2 ?? seed.gf_m2 ?? null,
      geschosshoehe_m:  input?.geschosshoehe_m ?? seed.geschosshoehe_m ?? null,
      volumen_m3:       input?.volumen_m3 ?? seed.volumen_m3 ?? null,
      faktor_vmf_gf:    input?.faktor_vmf_gf ?? seed.faktor_vmf_gf ?? null,
      flaeche_m2:       input?.flaeche_m2 ?? seed.flaeche_m2 ?? 0,
      miete_chf_m2_pa:  input?.miete_chf_m2_pa ?? seed.miete_chf_m2_pa ?? null,
      miete_chf_stk_mt: input?.miete_chf_stk_mt ?? seed.miete_chf_stk_mt ?? null,
      miete_chf_pa:     input?.miete_chf_pa ?? seed.miete_chf_pa ?? null,
      locked_fields:    input?.locked_fields ?? seed.locked_fields ?? [],
    }

    const { error } = await supabase.from('building_mieteinheiten').insert(payload)
    if (error) { setError(error.message); return false }
    await syncMietflaecheFromUnits(mietflaecheId)
    await load(true)
    return true
  }

  async function updateMieteinheit(id: string, patch: Partial<MieteinheitInput>) {
    // Parent suchen für anschließenden Sync
    const parent = buildings
      .flatMap((b) => b.mietflaechen)
      .find((m) => (m.mieteinheiten ?? []).some((u) => u.id === id))
    const { error } = await supabase.from('building_mieteinheiten').update(patch).eq('id', id)
    if (error) { setError(error.message); return false }
    if (parent) await syncMietflaecheFromUnits(parent.id)
    await load(true)
    return true
  }

  async function deleteMieteinheit(id: string) {
    const parent = buildings
      .flatMap((b) => b.mietflaechen)
      .find((m) => (m.mieteinheiten ?? []).some((u) => u.id === id))
    const { error } = await supabase.from('building_mieteinheiten').delete().eq('id', id)
    if (error) { setError(error.message); return false }
    if (parent) await syncMietflaecheFromUnits(parent.id)
    await load(true)
    return true
  }

  async function duplicateMieteinheit(id: string) {
    const source = buildings
      .flatMap((b) => b.mietflaechen)
      .flatMap((m) => m.mieteinheiten ?? [])
      .find((u) => u.id === id)
    if (!source) return false
    const { id: _id, created_at: _ct, updated_at: _ut, ...rest } = source
    void _id; void _ct; void _ut

    // sort_order ist smallint — max + 1 unter den Geschwistern verwenden.
    const siblings = buildings
      .flatMap((b) => b.mietflaechen)
      .find((m) => m.id === source.mietflaeche_id)?.mieteinheiten ?? []
    const nextSort = siblings.length > 0
      ? Math.max(...siblings.map((u) => u.sort_order ?? 0)) + 1
      : 0

    const { error } = await supabase
      .from('building_mieteinheiten')
      .insert({ ...rest, sort_order: nextSort })
    if (error) { setError(error.message); return false }
    await syncMietflaecheFromUnits(source.mietflaeche_id)
    await load(true)
    return true
  }

  // ─── Ertragsobjekte ─────────────────────────────────────────────────────

  async function createErtragsobjekt(buildingId: string, input: ErtragsobjektInput) {
    const { error } = await supabase
      .from('building_ertragsobjekte')
      .insert({ variant_building_id: buildingId, ...input })
    if (error) { setError(error.message); return false }
    await load(true)
    return true
  }

  async function updateErtragsobjekt(id: string, patch: Partial<ErtragsobjektInput>) {
    const { error } = await supabase.from('building_ertragsobjekte').update(patch).eq('id', id)
    if (error) { setError(error.message); return false }
    await load(true)
    return true
  }

  async function deleteErtragsobjekt(id: string) {
    const { error } = await supabase.from('building_ertragsobjekte').delete().eq('id', id)
    if (error) { setError(error.message); return false }
    await load(true)
    return true
  }

  return {
    buildings, loading, error, reload: load,
    createBuilding, updateBuilding, deleteBuilding, duplicateBuilding, reorderBuildings,
    createMietflaeche, updateMietflaeche, deleteMietflaeche, duplicateMietflaeche, reorderMietflaechen,
    createMieteinheit, updateMieteinheit, deleteMieteinheit, duplicateMieteinheit, reorderMieteinheiten,
    createErtragsobjekt, updateErtragsobjekt, deleteErtragsobjekt,
  }
}
