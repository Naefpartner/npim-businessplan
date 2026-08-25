import { useEffect, useMemo, useState, Fragment, type FormEvent, type DragEvent } from 'react'
import {
  Loader2, AlertCircle, Plus, Pencil, Trash2, Save, Copy,
  Building, ChevronDown, ChevronRight, Lock, Unlock, CornerDownRight, GripVertical, Layers, Home,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useExistingBuildings } from '@/hooks/useStammdaten'
import {
  useMengengeruest,
  type VariantBuildingFull,
  type VariantBuildingInput,
} from '@/hooks/useMengengeruest'
import { useMengengeruestShared } from '@/contexts/VariantDataContext'
import { useVariantEtappen } from '@/hooks/useVariantEtappen'
import { copyEtappe } from '@/hooks/useVariants'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  BUILDING_ART_LABEL,
  DEFAULT_FAKTOR_VMF_GF,
  NUTZUNG_VORSCHLAEGE,
  USE_TYPE_LABEL,
  USE_TYPE_SELECTABLE,
  WOHNUNGSMIX_KEYS,
  WOHNUNGSMIX_LABEL,
  isNutzungWohnen,
  type BuildingArt,
  type BuildingMietflaeche,
  type BuildingMieteinheit,
  type ProjectUseType,
  type VariantEtappe,
  type Wohnungsmix,
} from '@/types'
import { USE_TYPE_COLOR, USE_TYPE_COLOR_3 } from '@/lib/kategorieFarben'
import { cn, formatCurrency } from '@/lib/utils'

const inputClass =
  'rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm text-slate-900 outline-none transition focus:border-[#8B6956] focus:bg-white focus:ring-1 focus:ring-[#8B6956]/30 disabled:opacity-50'

type MietflaechenSortMode = 'manual' | 'by-nutzung' | 'by-geschoss'
type DetailLevel = 1 | 2 | 3

// Spaltentemplate je nach Nutzungsart und Wohnungsmix-Bedarf.
// Wenn mindestens eine Zeile „Wohnen" enthält, werden für ALLE Zeilen 11
// zusätzliche Spalten gerendert (Joker, 1.5 … 5.5, >5.5) — leer wenn
// die Zeile nicht Wohnen ist. Das hält das Grid aligniert.
// Geschoss · Nutzung · GF · Höhe · GV · Fkt · VMF · Stk · VMF/Stk · CHF/m²·a · CHF/Stk·Mt · CHF/a
// Geschoss-Spalte auf 7.5rem erweitert, damit das oi/ui-Pill inline passt.
// Stk: 4rem, VMF/Stk: 5rem — zusammen +9rem nach VMF.
// Aktionsspalte (Kopieren/Löschen) — direkt nach den zwei Beschriftungsspalten
// (Geschoss + Nutzung), damit sie über alle Ebenen an gleicher Stelle liegt.
const COLS_ACTION       = '5rem'
// Aktionsspalte (Kopieren/Bearbeiten/Löschen) ganz VORNE — so bleibt bei den
// Mieteinheiten viel Platz für Nr./Name/Wohnungstyp (die über die leeren
// Mess-Spalten laufen). Danach Geschoss · Nutzung · Masse …
const COLS_MIETE_BASE   = `${COLS_ACTION} 9rem 9rem 6rem 4.5rem 6rem 4.5rem 6rem 4rem 5rem 6.5rem 6.5rem 8.5rem`
// Verkauf: identische Spalten wie Miete — CHF/m² · CHF/Stk · CHF (Total).
const COLS_VERKAUF_BASE = `${COLS_ACTION} 9rem 9rem 6rem 4.5rem 6rem 4.5rem 6rem 4rem 5rem 6.5rem 6.5rem 8.5rem`
// Erste Spalte ist ein Spacer (~3cm), um den Wohnungsmix optisch von den
// CHF-Spalten abzusetzen. Danach 13 Wohnungsgrössen (Joker bis >6.5).
const COLS_WOHNMIX      = '7rem 2.5rem 2.5rem 2.5rem 2.5rem 2.5rem 2.5rem 2.5rem 2.5rem 2.5rem 2.5rem 2.5rem 2.5rem 2.5rem'

// Wohnungstypen (bei Wohnen) — Auswahl im Dropdown; freie Eingabe bleibt möglich.
const WOHNUNGSTYP_OPTIONEN = [
  'Geschosswohnung', 'Maisonette', 'Attika', 'Dachgeschoss',
  'REFH', 'EFH', 'Atelierwohnung', 'Loft',
] as const

function buildCols(isVerkauf: boolean, hasWohnen: boolean): string {
  const base = isVerkauf ? COLS_VERKAUF_BASE : COLS_MIETE_BASE
  return hasWohnen ? `${base} ${COLS_WOHNMIX}` : base
}

function buildMinWidth(_isVerkauf: boolean, hasWohnen: boolean): string {
  // Basis: 65 + 9 = 74rem (Miete), 58.5 + 9 = 67.5rem (Verkauf).
  // Geschoss-Spalte 7.5rem (+1.5 für OI/UI-Pill), neu zwei Spalten Stk + VMF/Stk = +9rem.
  // Wohnungsmix: Spacer 7rem + 13 × 2.5rem = 39.5rem
  const baseRem = 75.5 // Geschoss-Spalte 9rem (Platz für „10.OG"); je 3 CHF-Spalten
  const wohnRem = hasWohnen ? 39.5 : 0
  // +5 = COLS_ACTION (5rem, Kopieren/Löschen nach den Beschriftungsspalten)
  return `${(baseRem + wohnRem + 5) * 16}px`
}

// ---------------------------------------------------------------------------
// Recalc — bei Änderung eines Feldes werden abhängige Felder neu berechnet.
// Eingegebenes Feld ist Source-of-Truth, alle abhängigen Werte werden
// daraus konsistent abgeleitet.
// ---------------------------------------------------------------------------

type RecalcField = 'gf' | 'vmf' | 'hoehe' | 'volumen' | 'faktor' | 'anzahl' | 'vmf_pro_stk' | 'chf_m2_pa' | 'chf_stk_mt' | 'chf_pa'

interface MietflaechePatch {
  gf_m2?: number | null
  geschosshoehe_m?: number | null
  volumen_m3?: number | null
  faktor_vmf_gf?: number | null
  flaeche_m2?: number          // VMF
  anzahl?: number | null
  vmf_pro_stk?: number | null
  miete_chf_m2_pa?: number | null
  miete_chf_stk_mt?: number | null
  miete_chf_pa?: number | null
}

function recalc(
  row: BuildingMietflaeche,
  field: RecalcField,
  newValue: number | null,
  isVerkauf = false,
): MietflaechePatch {
  const locks = new Set(row.locked_fields ?? [])
  // Eingabefeld wird IMMER auf den neuen Wert gesetzt — Lock zählt nur für
  // automatische Folge-Anpassungen, nicht für die Direkt-Eingabe selbst.
  const isLocked = (f: RecalcField) => f !== field && locks.has(f)
  // Periodenfaktor zwischen „pro Stk·Monat/m²·a" und Jahres-/Total-Wert:
  // Miete = 12 (Monat→Jahr), Verkauf = 1 (CHF/Stk = Total/Stk, kein Zeitbezug).
  const F = isVerkauf ? 1 : 12

  // Ausgangswerte
  let gf       = row.gf_m2
  let hoehe    = row.geschosshoehe_m
  let vol      = row.volumen_m3
  let faktor   = row.faktor_vmf_gf ?? DEFAULT_FAKTOR_VMF_GF
  let vmf: number | null = row.flaeche_m2 ?? null
  let cm2      = row.miete_chf_m2_pa
  let cstk     = row.miete_chf_stk_mt
  let ca       = row.miete_chf_pa
  // anz = Rechenwert (null → 1 für Multiplikationen); anzOut = was persistiert
  // wird (bleibt null/leer, wenn der User Stk nie gesetzt hat — z.B. Keller).
  let anz      = row.anzahl ?? 1
  let anzOut: number | null = row.anzahl
  let vmfPerStk = row.vmf_pro_stk

  // Eingegebenes Feld setzen
  switch (field) {
    case 'gf':         gf        = newValue; break
    case 'vmf':        vmf       = newValue; break
    case 'hoehe':      hoehe     = newValue; break
    case 'volumen':    vol       = newValue; break
    case 'faktor':     faktor    = newValue ?? DEFAULT_FAKTOR_VMF_GF; break
    case 'anzahl':
      if (newValue && newValue > 0) { anz = newValue; anzOut = newValue }
      else { anz = 1; anzOut = null } // geleert → Stk bleibt leer
      break
    case 'vmf_pro_stk': vmfPerStk = newValue; break
    case 'chf_m2_pa':  cm2       = newValue; break
    case 'chf_stk_mt': cstk      = newValue; break
    case 'chf_pa':     ca        = newValue; break
  }

  // ── Triplet anzahl / vmf_pro_stk / VMF ────────────────────────────
  // Wenn der User direkt mit „Stk × m²/Stk" arbeitet, hat dieses Triplet
  // Vorrang vor dem GF/Faktor-Triplet: VMF wird daraus berechnet.
  if (field === 'anzahl' && anz > 0 && vmfPerStk != null) {
    if (!isLocked('vmf')) vmf = anz * vmfPerStk
    else if (!isLocked('vmf_pro_stk') && vmf != null && vmf > 0) vmfPerStk = vmf / anz
  } else if (field === 'vmf_pro_stk' && vmfPerStk != null && anz > 0) {
    if (!isLocked('vmf')) vmf = anz * vmfPerStk
    else if (!isLocked('anzahl') && vmf != null && vmf > 0) { anz = vmf / vmfPerStk; anzOut = anz }
  } else if (field === 'vmf' && vmf != null) {
    // VMF-Eingabe (auch 0): vmf_pro_stk anpassen, wenn nicht gelockt; sonst Stk ableiten.
    if (anz > 0 && !isLocked('vmf_pro_stk')) vmfPerStk = vmf / anz
    else if (vmfPerStk != null && vmfPerStk > 0 && !isLocked('anzahl')) { anz = vmf / vmfPerStk; anzOut = anz }
  }

  // ── Triplet GF / Faktor / VMF ────────────────────────────────────
  // faktor darf 0 sein → VMF = GF × 0 = 0. Division (gf = vmf/faktor) braucht faktor > 0.
  if (field === 'gf' && gf != null && faktor != null) {
    if (!isLocked('vmf')) vmf = gf * faktor
    else if (!isLocked('faktor') && vmf != null && gf > 0) faktor = vmf / gf
  } else if (field === 'vmf' && vmf != null && faktor > 0) {
    if (!isLocked('gf')) gf = vmf / faktor
    else if (!isLocked('faktor') && gf != null && gf > 0) faktor = vmf / gf
  } else if (field === 'faktor' && faktor != null) {
    if (gf != null && !isLocked('vmf')) vmf = gf * faktor
    else if (vmf != null && faktor > 0 && !isLocked('gf')) gf = vmf / faktor
  }

  // ── Triplet GF / Höhe / Volumen ──────────────────────────────────
  if (field === 'volumen' && vol != null && hoehe != null && hoehe > 0) {
    if (!isLocked('gf')) {
      gf = vol / hoehe
      if (!isLocked('vmf') && faktor > 0) vmf = gf * faktor
    } else if (!isLocked('hoehe') && gf != null && gf > 0) {
      hoehe = vol / gf
    }
  } else if (field === 'hoehe' && hoehe != null && gf != null) {
    if (!isLocked('volumen')) vol = gf * hoehe
    else if (!isLocked('gf') && hoehe > 0 && vol != null) {
      gf = vol / hoehe
      if (!isLocked('vmf') && faktor > 0) vmf = gf * faktor
    }
  } else {
    // Wenn GF/Höhe vorhanden und Volumen nicht gelockt, ableiten
    if (gf != null && hoehe != null && !isLocked('volumen')) vol = gf * hoehe
  }

  // ── Mietzins-/Verkaufspreis-Triplet ───────────────────────────────
  // VMF ist die GESAMTfläche → Ertrag CHF/a = CHF/m²·a × VMF (KEIN × Stk).
  // Stk fliesst nur in die Monats-/Stückgrösse ein: CHF/Stk·Mt = CHF/a ÷ F ÷ Stk.
  if (field === 'chf_m2_pa' && cm2 != null && vmf != null && vmf > 0) {
    if (!isLocked('chf_pa'))     ca   = cm2 * vmf
    if (!isLocked('chf_stk_mt')) cstk = anz > 0 ? (cm2 * vmf) / F / anz : null
  } else if (field === 'chf_stk_mt' && cstk != null) {
    if (!isLocked('chf_pa'))    ca  = cstk * F * anz
    if (!isLocked('chf_m2_pa') && vmf != null && vmf > 0) cm2 = (cstk * F * anz) / vmf
  } else if (field === 'chf_pa' && ca != null) {
    if (!isLocked('chf_m2_pa') && vmf != null && vmf > 0) cm2  = ca / vmf
    if (!isLocked('chf_stk_mt') && anz > 0) cstk = ca / F / anz
  } else if (
    (field === 'gf' || field === 'vmf' || field === 'volumen' || field === 'faktor' ||
      field === 'hoehe' || field === 'anzahl' || field === 'vmf_pro_stk') && anz > 0
  ) {
    // Maße/Anzahl geändert → Mietzins-Felder rekonstruieren.
    //
    // Priorität: gelockte Mietzins-Werte sind Master und bleiben fix. Wenn ein
    // gelockter Master da ist, leiten wir die nicht-gelockten Mietzinse daraus
    // ab — auch wenn ein anderer Wert in der Kette ebenfalls schon gesetzt war.
    // (Beispiel: Stk + CHF/a gelockt → CHF/Stk·Mt = CHF/a / 12 / Stk, egal ob
    // CHF/Stk·Mt vorher schon einen Wert hatte.)
    const caIsMaster   = locks.has('chf_pa')     && ca   != null
    const cstkIsMaster = locks.has('chf_stk_mt') && cstk != null
    const cm2IsMaster  = locks.has('chf_m2_pa')  && cm2  != null && vmf != null && vmf > 0

    if (caIsMaster) {
      if (!locks.has('chf_stk_mt'))                          cstk = ca! / F / anz
      if (!locks.has('chf_m2_pa') && vmf != null && vmf > 0) cm2  = ca! / vmf
    } else if (cstkIsMaster) {
      if (!locks.has('chf_pa'))                              ca  = cstk! * F * anz
      if (!locks.has('chf_m2_pa') && vmf != null && vmf > 0) cm2 = (cstk! * F * anz) / vmf
    } else if (cm2IsMaster) {
      if (!locks.has('chf_pa'))                       ca   = cm2! * vmf!
      if (!locks.has('chf_stk_mt') && ca != null)     cstk = ca / F / anz
    }
    // Keine Lock-Master → bestehende "by existence"-Heuristik
    else if (cm2 != null && vmf != null && vmf > 0) {
      if (!isLocked('chf_pa'))     ca   = cm2 * vmf
      if (!isLocked('chf_stk_mt')) cstk = ca != null ? ca / F / anz : null
    } else if (ca != null && vmf != null && vmf > 0) {
      if (!isLocked('chf_m2_pa'))  cm2  = ca / vmf
      if (!isLocked('chf_stk_mt')) cstk = ca / F / anz
    } else if (cstk != null) {
      if (!isLocked('chf_pa'))                              ca  = cstk * F * anz
      if (!isLocked('chf_m2_pa') && vmf != null && vmf > 0) cm2 = (cstk * F * anz) / vmf
    } else if (ca != null) {
      if (!isLocked('chf_stk_mt')) cstk = ca / F / anz
    }
  }

  // vmf_pro_stk (= VMF/Stk) ist abgeleitet, solange nicht gelockt und nicht selbst
  // eingegeben → immer konsistent mit VMF halten (auch 0, damit alte Werte nicht
  // stehen bleiben, wenn VMF auf 0 fällt).
  if (vmf != null && anz > 0 && field !== 'vmf_pro_stk' && !isLocked('vmf_pro_stk')) {
    vmfPerStk = vmf / anz
  }

  return {
    gf_m2:           gf,
    geschosshoehe_m: hoehe,
    volumen_m3:      vol,
    faktor_vmf_gf:   faktor,
    flaeche_m2:      vmf ?? 0,
    anzahl:          anzOut,
    vmf_pro_stk:     vmfPerStk,
    miete_chf_m2_pa: cm2,
    miete_chf_stk_mt: cstk,
    miete_chf_pa:    ca,
  }
}

// Reconcile-Helper: nach Lock-Toggle prüft, ob aus den gelockten Werten
// abhängige Felder eindeutig berechnet werden können, und passt sie an.
// Beispiel: User lockt CHF/a + Stk → CHF/Stk·Mt = CHF/a / 12 / Stk.
function reconcileLocks(
  row: BuildingMietflaeche | BuildingMieteinheit,
  locks: Set<string>,
  isVerkauf = false,
): MietflaechePatch {
  const has = (f: string) => locks.has(f)
  const F = isVerkauf ? 1 : 12 // Miete: Monat→Jahr; Verkauf: CHF/Stk = Total/Stk.
  const anz = row.anzahl ?? 1
  let vmf       = row.flaeche_m2 || null
  let vmfPerStk = row.vmf_pro_stk
  let cm2       = row.miete_chf_m2_pa
  let cstk      = row.miete_chf_stk_mt
  let ca        = row.miete_chf_pa

  // ── Mietzins-/Verkaufspreis-Konsistenz ──────────────────────────────────
  // CHF/a + Stk gelockt → CHF/Stk(·Mt) rekonstruieren
  if (has('anzahl') && has('chf_pa') && !has('chf_stk_mt') && anz > 0 && ca != null) {
    cstk = ca / F / anz
  }
  // Stk + CHF/Stk(·Mt) gelockt → CHF/a rekonstruieren
  else if (has('anzahl') && has('chf_stk_mt') && !has('chf_pa') && anz > 0 && cstk != null) {
    ca = cstk * F * anz
  }
  // VMF + CHF/m²(·a) gelockt → CHF/a (und ggf. CHF/Stk) ableiten.
  // CHF/a = CHF/m²·a × VMF (VMF ist Gesamtfläche, KEIN × Stk).
  if (has('vmf') && has('chf_m2_pa') && vmf != null && vmf > 0 && cm2 != null && anz > 0) {
    if (!has('chf_pa'))                            ca   = cm2 * vmf
    if (!has('chf_stk_mt') && ca != null)          cstk = ca / F / anz
  }
  // VMF + CHF/a gelockt → CHF/m²·a = CHF/a ÷ VMF
  if (has('vmf') && has('chf_pa') && !has('chf_m2_pa') && vmf != null && vmf > 0 && ca != null) {
    cm2 = ca / vmf
  }

  // ── Maße-Triplet anzahl × vmf_pro_stk = VMF ────────────────────────────
  if (has('anzahl') && has('vmf_pro_stk') && !has('vmf') && anz > 0 && vmfPerStk != null) {
    vmf = anz * vmfPerStk
  } else if (has('vmf') && has('anzahl') && !has('vmf_pro_stk') && vmf != null && vmf > 0 && anz > 0) {
    vmfPerStk = vmf / anz
  }

  return {
    flaeche_m2:       vmf ?? 0,
    vmf_pro_stk:      vmfPerStk,
    miete_chf_m2_pa:  cm2,
    miete_chf_stk_mt: cstk,
    miete_chf_pa:     ca,
  }
}

// recalc liefert anzahl ggf. als null (= leeres Stk-Feld auf Geschossebene).
// Mieteinheiten brauchen aber immer eine Stückzahl ≥ 1 (NOT NULL) — daher
// für Unit-Updates null → 1 wandeln (undefined bleibt undefined → unverändert).
function coerceUnitAnzahl<T extends { anzahl?: number | null }>(p: T): Omit<T, 'anzahl'> & { anzahl?: number } {
  const { anzahl, ...rest } = p
  if (anzahl === null) return { ...rest, anzahl: 1 }
  if (anzahl === undefined) return rest
  return { ...rest, anzahl }
}

// =============================================================================

export function MengengeruestSection({
  projectId,
  variantId,
  defaultExpanded = false,
}: {
  projectId: string
  variantId: string
  defaultExpanded?: boolean
}) {
  const { canWrite } = useAuth()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [createOpen, setCreateOpen] = useState(false)
  const [sortMode, setSortMode] = useState<MietflaechenSortMode>('manual')
  const [detailLevel, setDetailLevel] = useState<DetailLevel>(1)
  // Ansicht: nach Etappen gruppiert ('etappen') oder konsolidiert über alle
  // Gebäude ('konsolidiert'). Nur relevant, wenn es mehrere Etappen-Gruppen gibt.
  const [etappenView, setEtappenView] = useState<'etappen' | 'konsolidiert'>('etappen')
  // Globaler Shortcut: alle Subtotal-Gruppen ein-/ausklappen.
  // tick wird inkrementiert, damit auch wiederholtes Klicken die lokalen
  // collapsed-States in den MietflaechenGrids neu synchronisiert.
  const [groupsCollapseSignal, setGroupsCollapseSignal] = useState<{ value: boolean; tick: number }>({ value: false, tick: 0 })

  const { buildings: existing } = useExistingBuildings(projectId)
  const mengen = useMengengeruestShared()
  const etappenApi = useVariantEtappen(variantId)

  // Komplette Etappe kopieren (mit Gebäuden, Flächen, Anlagekosten) und
  // danach Etappen- und Mengen-Daten neu laden.
  async function handleCopyEtappe(etappeId: string) {
    const err = await copyEtappe(variantId, etappeId)
    if (err) { alert(`Etappe konnte nicht kopiert werden: ${err}`); return }
    await Promise.all([etappenApi.reload(), mengen.reload()])
  }

  // Sicherstellen, dass mindestens eine Etappe existiert (für Zuordnung neuer
  // Gebäude + BKP-2-Kennwerte). Nur wenn schreibberechtigt.
  useEffect(() => {
    if (canWrite && !etappenApi.loading && etappenApi.etappen.length === 0) {
      void etappenApi.ensureDefault()
    }
  }, [canWrite, etappenApi.loading, etappenApi.etappen.length, etappenApi])

  // Gebäude nach Etappe gruppieren (in Etappen-Reihenfolge), plus eine
  // „ohne Etappe"-Gruppe, falls Gebäude (noch) keiner Etappe zugeordnet sind.
  const etappenGroups = useMemo(() => {
    const groups = etappenApi.etappen.map((e) => ({
      etappe: e as VariantEtappe | null,
      list: mengen.buildings.filter((b) => b.etappe_id === e.id),
    }))
    const known = new Set(etappenApi.etappen.map((e) => e.id))
    const ohne = mengen.buildings.filter((b) => !b.etappe_id || !known.has(b.etappe_id))
    if (ohne.length > 0) groups.push({ etappe: null, list: ohne })
    return groups
  }, [etappenApi.etappen, mengen.buildings])

  // Umschalter nur sinnvoll, wenn es mehr als eine Etappen-Gruppe gibt.
  const hasMehrereEtappen = etappenGroups.length > 1
  // Nach Etappen gruppieren, wenn mehrere Etappen vorhanden sind UND die Ansicht
  // nicht auf konsolidiert steht.
  const showEtappen = hasMehrereEtappen && etappenView === 'etappen'


  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 bg-[#B98C74] px-5 py-3 text-sm font-semibold text-slate-900 transition hover:brightness-95"
      >
        {expanded
          ? <ChevronDown className="h-4 w-4 text-slate-700" />
          : <ChevronRight className="h-4 w-4 text-slate-700" />}
        <Building className="h-4 w-4 text-slate-700" />
        <span>Mengen und Erträge</span>
      </button>

      {expanded && (
        <div className="space-y-3 p-5">
          {mengen.error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{mengen.error}</span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {canWrite && (
                <Button
                  size="sm"
                  onClick={() => void etappenApi.create('')}
                  title="Neue Bauetappe anlegen"
                  className="bg-[#F2D3C2] text-slate-900 hover:bg-[#E7AF90]"
                >
                  <Layers className="h-4 w-4" /> Neue Etappe
                </Button>
              )}
              {canWrite && (
                <Button
                  size="sm"
                  onClick={() => setCreateOpen(true)}
                  className="bg-[#F2D3C2] text-slate-900 hover:bg-[#E7AF90]"
                >
                  <Home className="h-4 w-4" /> Neues Gebäude
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {hasMehrereEtappen && (
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span>Ansicht:</span>
                  <div className="inline-flex overflow-hidden rounded border border-slate-300">
                    <button
                      type="button"
                      onClick={() => setEtappenView('konsolidiert')}
                      className={cn(
                        'px-2 py-0.5 text-xs transition',
                        etappenView === 'konsolidiert'
                          ? 'bg-[#F2D3C2] text-slate-900'
                          : 'bg-white text-slate-600 hover:bg-slate-100',
                      )}
                      title="Alle Gebäude konsolidiert über alle Etappen"
                    >
                      Konsolidiert
                    </button>
                    <button
                      type="button"
                      onClick={() => setEtappenView('etappen')}
                      className={cn(
                        'border-l border-slate-300 px-2 py-0.5 text-xs transition',
                        etappenView === 'etappen'
                          ? 'bg-[#F2D3C2] text-slate-900'
                          : 'bg-white text-slate-600 hover:bg-slate-100',
                      )}
                      title="Gebäude nach Bauetappe gruppiert"
                    >
                      Etappen
                    </button>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <span>Detail:</span>
                <div className="inline-flex overflow-hidden rounded border border-slate-300">
                  {([1, 2, 3] as DetailLevel[]).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setDetailLevel(lvl)}
                      className={cn(
                        'px-2 py-0.5 text-xs tabular-nums transition',
                        detailLevel === lvl
                          ? 'bg-[#F2D3C2] text-slate-900'
                          : 'bg-white text-slate-600 hover:bg-slate-100',
                      )}
                      title={
                        lvl === 1 ? 'Nur Gebäude'
                        : lvl === 2 ? 'Bis und mit Geschoss'
                        : 'Inkl. Mieteinheiten'
                      }
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                <span>Sortierung:</span>
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as MietflaechenSortMode)}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-[#8B6956]"
                >
                  <option value="manual">Manuell</option>
                  <option value="by-nutzung">Nach Nutzung</option>
                  <option value="by-geschoss">Nach Geschoss</option>
                </select>
              </label>
              {sortMode !== 'manual' && (
                <div className="inline-flex overflow-hidden rounded border border-slate-300 text-xs">
                  <button
                    type="button"
                    onClick={() => setGroupsCollapseSignal((p) => ({ value: true, tick: p.tick + 1 }))}
                    className="bg-white px-2 py-1 text-slate-600 hover:bg-slate-100"
                    title="Alle Gruppen einklappen — nur Subtotals zeigen"
                  >
                    Nur Subtotals
                  </button>
                  <button
                    type="button"
                    onClick={() => setGroupsCollapseSignal((p) => ({ value: false, tick: p.tick + 1 }))}
                    className="border-l border-slate-300 bg-white px-2 py-1 text-slate-600 hover:bg-slate-100"
                    title="Alle Gruppen ausklappen"
                  >
                    Alle ausklappen
                  </button>
                </div>
              )}
            </div>
          </div>

          {mengen.loading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Wird geladen…
            </div>
          ) : mengen.buildings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
              Hier erscheinen die Gebäude dieses Stands / Szenarios.
            </div>
          ) : !showEtappen ? (
            <GroupedBuildings
              buildings={mengen.buildings}
              existingOptions={existing}
              etappen={etappenApi.etappen}
              canWrite={canWrite}
              api={mengen}
              sortMode={sortMode}
              detailLevel={detailLevel}
              groupsCollapseSignal={groupsCollapseSignal}
            />
          ) : (
            <div className="space-y-6 pt-6">
              {etappenGroups.map(({ etappe, list }) => (
                <div key={etappe?.id ?? '__none__'} className="space-y-3">
                  <EtappeHeader
                    etappe={etappe}
                    buildingCount={list.length}
                    canWrite={canWrite}
                    api={etappenApi}
                    onCopy={handleCopyEtappe}
                  />
                  {list.length === 0 ? (
                    <p className="pl-1 text-xs text-slate-400">Noch keine Gebäude in dieser Etappe.</p>
                  ) : (
                    <GroupedBuildings
                      buildings={list}
                      existingOptions={existing}
                      etappen={etappenApi.etappen}
                      canWrite={canWrite}
                      api={mengen}
                      sortMode={sortMode}
                      detailLevel={detailLevel}
                      groupsCollapseSignal={groupsCollapseSignal}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <BuildingDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Neues Gebäude"
        existingOptions={existing}
        etappen={etappenApi.etappen}
        onSubmit={async (input) => !!(await mengen.createBuilding(input))}
      />
      <datalist id="nutzung-vorschlaege">
        {NUTZUNG_VORSCHLAEGE.map((n) => <option key={n} value={n} />)}
      </datalist>
    </section>
  )
}

// ─── Gruppierung nach Nutzungsart ─────────────────────────────────────────

// 'gemischt' ist abgeschafft — pro Gebäude genau eine Eigentumsart.
const USE_TYPE_ORDER: ProjectUseType[] = ['renditeobjekt', 'genossenschaft', 'verkaufsobjekt']

// Kopfzeile einer Bauetappe mit Inline-Umbenennung und Löschen.
function EtappeHeader({
  etappe, buildingCount, canWrite, api, onCopy,
}: {
  etappe: VariantEtappe | null
  buildingCount: number
  canWrite: boolean
  api: ReturnType<typeof useVariantEtappen>
  onCopy: (id: string) => Promise<void> | void
}) {
  const [name, setName] = useState(etappe?.name ?? '')
  const [copying, setCopying] = useState(false)
  useEffect(() => { setName(etappe?.name ?? '') }, [etappe?.name])

  if (!etappe) {
    return (
      <div className="flex items-center gap-2 border-b border-amber-200 pb-1.5">
        <Layers className="h-5 w-5 text-amber-500" />
        <span className="text-lg font-bold text-amber-700">Ohne Etappe</span>
        <span className="text-xs text-slate-400">{buildingCount} Gebäude — bitte einer Etappe zuordnen</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 border-b border-slate-200 pb-1.5">
      <Layers className="h-5 w-5 text-[#8B6956]" />
      <span className="w-7 shrink-0" />
      {canWrite ? (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => { const t = name.trim(); if (t && t !== etappe.name) void api.rename(etappe.id, t); else setName(etappe.name) }}
          className="w-[14.75rem] rounded border border-transparent bg-transparent px-1 py-0.5 text-lg font-bold text-slate-900 outline-none transition hover:bg-slate-50 focus:border-slate-300 focus:bg-white"
        />
      ) : (
        <span className="text-lg font-bold text-slate-900">{etappe.name}</span>
      )}
      {canWrite && (
        <button
          type="button"
          disabled={copying}
          onClick={async () => { setCopying(true); await onCopy(etappe.id); setCopying(false) }}
          className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-[#8B6956] disabled:opacity-50"
          title="Etappe kopieren (mit allen Gebäuden und Inhalten)"
        >
          {copying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      )}
      {canWrite && (
        <button
          type="button"
          onClick={() => { if (confirm(`Etappe „${etappe.name}" löschen? Zugeordnete Gebäude verlieren ihre Etappen-Zuordnung.`)) void api.remove(etappe.id) }}
          className="rounded p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
          title="Etappe löschen"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

function GroupedBuildings({
  buildings, existingOptions, etappen, canWrite, api, sortMode, detailLevel, groupsCollapseSignal,
}: {
  buildings: VariantBuildingFull[]
  existingOptions: ReturnType<typeof useExistingBuildings>['buildings']
  etappen: VariantEtappe[]
  canWrite: boolean
  api: ReturnType<typeof useMengengeruest>
  sortMode: MietflaechenSortMode
  detailLevel: DetailLevel
  groupsCollapseSignal: { value: boolean; tick: number }
}) {
  const grouped = USE_TYPE_ORDER
    .map((u) => ({ useType: u, list: buildings.filter((b) => b.use_type === u) }))
    .filter((g) => g.list.length > 0)

  return (
    <div className="space-y-4">
      {grouped.map(({ useType, list }) => (
        <UseTypeGroup
          key={useType}
          useType={useType}
          buildings={list}
          existingOptions={existingOptions}
          etappen={etappen}
          canWrite={canWrite}
          api={api}
          sortMode={sortMode}
          detailLevel={detailLevel}
          groupsCollapseSignal={groupsCollapseSignal}
        />
      ))}
    </div>
  )
}

function UseTypeGroup({
  useType, buildings, existingOptions, etappen, canWrite, api, sortMode, detailLevel, groupsCollapseSignal,
}: {
  useType: ProjectUseType
  buildings: VariantBuildingFull[]
  existingOptions: ReturnType<typeof useExistingBuildings>['buildings']
  etappen: VariantEtappe[]
  canWrite: boolean
  api: ReturnType<typeof useMengengeruest>
  sortMode: MietflaechenSortMode
  detailLevel: DetailLevel
  groupsCollapseSignal: { value: boolean; tick: number }
}) {
  const isVerkauf = useType === 'verkaufsobjekt'
  const flaechenKurz = isVerkauf ? 'VKF' : 'VMF'

  // Spalten-Template einheitlich pro Gruppe — damit Gruppen-, Gebäude- und
  // Mietflächen-Zeilen identisch alignieren.
  const allMietflaechen = buildings.flatMap((b) => b.mietflaechen)
  const hasWohnen = allMietflaechen.some((m) => isNutzungWohnen(m.nutzung))
  const cols = buildCols(isVerkauf, hasWohnen)
  const minW = buildMinWidth(isVerkauf, hasWohnen)

  // ── Gebäude per Drag&Drop sortieren (innerhalb der useType-Gruppe) ──────
  const [dragId, setDragId]         = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  function onCardDragStart(id: string) { setDragId(id) }
  function onCardDragOver(e: DragEvent, id: string) {
    if (!dragId || dragId === id) return
    e.preventDefault()
    setDragOverId(id)
  }
  function onCardDragLeave(id: string) {
    if (dragOverId === id) setDragOverId(null)
  }
  function onCardDrop(targetId: string) {
    if (!dragId || dragId === targetId) {
      setDragId(null); setDragOverId(null); return
    }
    const ourIds = buildings.map((b) => b.id)
    const fromIdx = ourIds.indexOf(dragId)
    const toIdx   = ourIds.indexOf(targetId)
    if (fromIdx < 0 || toIdx < 0) { setDragId(null); setDragOverId(null); return }
    const newGroupOrder = [...ourIds]
    newGroupOrder.splice(fromIdx, 1)
    newGroupOrder.splice(toIdx, 0, dragId)

    // Globale Reihenfolge konstruieren: an den Positionen unserer Gruppe in
    // api.buildings die neue Reihenfolge einsetzen, sonstige Gebäude bleiben.
    const groupSet = new Set(ourIds)
    let i = 0
    const globalIds = api.buildings.map((b) =>
      groupSet.has(b.id) ? newGroupOrder[i++] : b.id,
    )
    setDragId(null); setDragOverId(null)
    api.reorderBuildings(globalIds)
  }
  function onCardDragEnd() { setDragId(null); setDragOverId(null) }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-300 bg-slate-50/40">
      {/* Synchron scrollender Bereich: Spalten-Header, Gruppen-Zeile,
          Gebäude-Header und Mietflächen-Detailzeilen */}
      <div className="overflow-x-auto">
        <ColumnHeaderRow
          isVerkauf={isVerkauf}
          flaechenKurz={flaechenKurz}
          hasWohnen={hasWohnen}
          cols={cols}
          minW={minW}
        />
        <GroupHeaderRow
          useType={useType}
          buildings={buildings}
          isVerkauf={isVerkauf}
          flaechenKurz={flaechenKurz}
          hasWohnen={hasWohnen}
          cols={cols}
          minW={minW}
        />
        <div className="space-y-3 py-3" style={{ minWidth: minW }}>
          {buildings.map((b) => (
            <BuildingCard
              key={b.id}
              building={b}
              existingOptions={existingOptions}
              etappen={etappen}
              canWrite={canWrite}
              api={api}
              isVerkauf={isVerkauf}
              flaechenKurz={flaechenKurz}
              hasWohnen={hasWohnen}
              cols={cols}
              minW={minW}
              sortMode={sortMode}
              detailLevel={detailLevel}
              groupsCollapseSignal={groupsCollapseSignal}
              isDragging={dragId === b.id}
              isDragOver={dragOverId === b.id}
              onCardDragStart={canWrite ? () => onCardDragStart(b.id) : undefined}
              onCardDragOver={canWrite ? (e) => onCardDragOver(e, b.id) : undefined}
              onCardDragLeave={canWrite ? () => onCardDragLeave(b.id) : undefined}
              onCardDrop={canWrite ? () => onCardDrop(b.id) : undefined}
              onCardDragEnd={canWrite ? onCardDragEnd : undefined}
            />
          ))}
        </div>

      </div>
    </div>
  )
}

// ─── Spalten-Header (eine Reihe oben pro Gruppe, gilt für alle Detail-Zeilen) ──

function ColumnHeaderRow({
  isVerkauf, flaechenKurz, hasWohnen, cols, minW,
}: {
  isVerkauf: boolean
  flaechenKurz: string
  hasWohnen: boolean
  cols: string
  minW: string
}) {
  return (
    <div
      className="grid border-b border-slate-300 bg-slate-100 px-3 py-1.5 text-[11px] font-medium tracking-wider text-slate-500"
      style={{ gridTemplateColumns: cols, minWidth: minW }}
    >
      <span />
      <span />
      <span />
      <span className="text-right pr-[13px]">GF (m²)</span>
      <span className="text-right pr-[13px]">Höhe (m)</span>
      <span className="text-right pr-[13px]">GV (m³)</span>
      <span className="text-right pr-[13px]" title={`Verhältnis ${flaechenKurz} zu GF`}>{flaechenKurz}/GF</span>
      <span className="text-right pr-[13px]">{flaechenKurz} (m²)</span>
      <span className="text-right pr-[13px]">Stk</span>
      <span className="text-right pr-[13px]">{flaechenKurz}/Stk</span>
      {isVerkauf ? (
        <>
          <span className="text-right pr-[13px]">CHF/m²</span>
          <span className="text-right pr-[13px]">CHF/Stk</span>
          <span className="text-right pr-[13px]">CHF</span>
        </>
      ) : (
        <>
          <span className="text-right pr-[13px]">CHF/m²·a</span>
          <span className="text-right pr-[13px]">CHF/Stk·Mt</span>
          <span className="text-right pr-[13px]">CHF/a</span>
        </>
      )}
      {hasWohnen && (
        <>
          <span />
          {WOHNUNGSMIX_KEYS.map((k) => (
            <span key={k} className="text-center">{WOHNUNGSMIX_LABEL[k]}</span>
          ))}
        </>
      )}
    </div>
  )
}

// ─── Gruppen-Header mit aggregierten Totalen ──────────────────────────────

function GroupHeaderRow({
  useType, buildings, isVerkauf, hasWohnen, cols, minW,
}: {
  useType: ProjectUseType
  buildings: VariantBuildingFull[]
  isVerkauf: boolean
  flaechenKurz: string
  hasWohnen: boolean
  cols: string
  minW: string
}) {
  const allMietflaechen = buildings.flatMap((b) => b.mietflaechen)
  const agg = aggregateMietflaechen(allMietflaechen, isVerkauf)

  return (
    <div
      className="grid px-3 py-2 text-sm font-semibold text-slate-900"
      style={{ gridTemplateColumns: cols, minWidth: minW, backgroundColor: USE_TYPE_COLOR[useType] }}
    >
      <span />
      <div className="col-span-2 flex items-baseline gap-2">
        <span className="pl-14 text-base">{USE_TYPE_LABEL[useType]}</span>
      </div>
      <AggregateCells
        agg={agg}
        hasWohnen={hasWohnen}
        omitCurrency
        omitStk
      />
    </div>
  )
}

// Eine wiederverwendbare Block von Aggregat-Zellen (GF, Höhe, GV, Fkt, VMF, Mietzinsen, Wohnungsmix)
function AggregateCells({
  agg, hasWohnen, omitCurrency, omitStk,
}: {
  agg: MietflAggregate
  hasWohnen: boolean
  omitCurrency?: boolean
  omitStk?: boolean
}) {
  const fmt0 = (v: number | null) => v == null || v === 0 ? '–' : formatChDisplay(v, 0)
  const fmt2 = (v: number | null) => v == null ? '–' : formatChDisplay(v, 2)
  // Geschosshöhe immer mit 2 Nachkommastellen (z. B. 2.50).
  const fmtHoehe = (v: number | null) => v == null ? '–' : formatChDisplay(v, 2, 2)
  const fmtCur = (v: number | null) => {
    if (v == null || v === 0) return '–'
    return omitCurrency ? formatChDisplay(v, 0) : formatCurrency(v)
  }
  const totalChfA = agg.chf_pa ?? 0
  // 13px = Border (1px) + Input-Padding (8px) + Wrapper px-1 (4px)
  // gleiche Einrückung wie die Zahlen in den Eingabefeldern
  const numCls = 'text-right tabular-nums'
  const numStyle = { paddingRight: '13px' }
  return (
    <>
      <span className={numCls} style={numStyle}>{fmt0(agg.gf)}</span>
      <span className={numCls} style={numStyle}>{fmtHoehe(agg.hoehe_avg)}</span>
      <span className={numCls} style={numStyle}>{fmt0(agg.vol)}</span>
      <span className={numCls} style={numStyle}>{fmt2(agg.faktor_avg)}</span>
      <span className={numCls} style={numStyle}>{fmt0(agg.vmf)}</span>
      {/* Stk + VMF/Stk im Eigentumsart-Header ausblenden (Raster bleibt erhalten). */}
      <span className={numCls} style={numStyle}>{omitStk ? '' : fmt0(agg.anzahl)}</span>
      <span className={numCls} style={numStyle}>{omitStk ? '' : fmt0(agg.vmf_pro_stk_avg)}</span>
      {/* CHF/m²(·a) · CHF/Stk(·Mt) · CHF (Total/a) — Miete und Verkauf gleich. */}
      <span className={numCls} style={numStyle}>{fmtCur(agg.chf_m2_pa_avg)}</span>
      <span className={numCls} style={numStyle}>{fmtCur(agg.chf_stk_mt)}</span>
      <span className={numCls} style={numStyle}>{fmtCur(totalChfA)}</span>
      {hasWohnen && (
        <>
          <span />
          {WOHNUNGSMIX_KEYS.map((k) => (
            <span key={k} className="text-center tabular-nums">{agg.wohnungsmix[k] || ''}</span>
          ))}
        </>
      )}
    </>
  )
}

// ─── Aggregat-Helper + Übersichtstabelle ─────────────────────────────────

interface MietflAggregate {
  count: number
  gf: number
  vol: number
  vmf: number
  anzahl: number
  chf_pa: number
  chf_stk_mt: number
  hoehe_avg: number | null
  faktor_avg: number | null
  vmf_pro_stk_avg: number | null
  chf_m2_pa_avg: number | null
  wohnungsmix: Record<string, number>
}

function aggregateMietflaechen(items: BuildingMietflaeche[], isVerkauf = false): MietflAggregate {
  // Bei Mietflächen mit erfassten Mieteinheiten direkt aus den Units rechnen —
  // ein eventueller Sync-Lag in den Mietfläche-Aggregaten verfälscht das
  // Subtotal sonst (z.B. wenn alte DB-Werte vor dem Sync-Fix gespeichert wurden).
  const effAnz = (m: BuildingMietflaeche) => {
    const units = m.mieteinheiten ?? []
    return units.length > 0
      ? units.reduce((s, u) => s + (u.anzahl ?? 1), 0)
      : (m.anzahl ?? 0)
  }
  const effVmf = (m: BuildingMietflaeche) => {
    const units = m.mieteinheiten ?? []
    return units.length > 0
      ? units.reduce((s, u) => s + (u.flaeche_m2 ?? 0), 0)
      : (m.flaeche_m2 ?? 0)
  }
  const effChfPa = (m: BuildingMietflaeche) => {
    const units = m.mieteinheiten ?? []
    return units.length > 0
      ? units.reduce((s, u) => s + (u.miete_chf_pa ?? 0), 0)
      : (m.miete_chf_pa ?? 0)
  }

  const count   = items.length
  const gf      = items.reduce((s, m) => s + (m.gf_m2 ?? 0), 0)
  const vol     = items.reduce((s, m) => s + (m.volumen_m3 ?? 0), 0)
  const vmf     = items.reduce((s, m) => s + effVmf(m), 0)
  const anzahl  = items.reduce((s, m) => s + effAnz(m), 0)
  const chf_pa  = items.reduce((s, m) => s + effChfPa(m), 0)
  // Erträge nur von Flächen MIT VMF/VKF — Parkplätze o.Ä. ohne Fläche fliessen
  // nicht in CHF/m²·a ein (sonst verfälscht ihr Ertrag den m²-Preis).
  const chf_pa_mit_vmf = items.reduce((s, m) => s + (effVmf(m) > 0 ? effChfPa(m) : 0), 0)
  // CHF/Stk(·Mt) ist eine Rate — aus aggregiertem Total ableiten, nicht
  // summieren. Faktor: Miete /12 (Monat), Verkauf /1 (Total pro Stk).
  const chf_stk_mt = anzahl > 0 && chf_pa > 0 ? chf_pa / anzahl / (isVerkauf ? 1 : 12) : 0

  // Höhe = gewichteter Mittel über GF
  const sumGfForHoehe   = items.reduce((s, m) => s + (m.geschosshoehe_m != null ? (m.gf_m2 ?? 0) : 0), 0)
  const sumHoeheGewicht = items.reduce((s, m) => s + (m.geschosshoehe_m != null ? (m.geschosshoehe_m * (m.gf_m2 ?? 0)) : 0), 0)
  const hoehe_avg       = sumGfForHoehe > 0 ? sumHoeheGewicht / sumGfForHoehe : null

  // Faktor = VMF / GF
  const faktor_avg = gf > 0 && vmf > 0 ? vmf / gf : null
  // VMF/Stk = VMF / Anzahl (gesamt-gewichtet)
  const vmf_pro_stk_avg = vmf > 0 && anzahl > 0 ? vmf / anzahl : null
  // CHF/m²·a = CHF p.a. (nur Flächen mit VMF) / VMF
  const chf_m2_pa_avg = vmf > 0 && chf_pa_mit_vmf > 0 ? chf_pa_mit_vmf / vmf : null

  // Wohnungsmix Summen pro Schlüssel — bei Mieteinheiten aus den Units, sonst
  // vom Mietfläche-Wert (Aggregat oder direkt erfasst).
  const wohnungsmix: Record<string, number> = {}
  for (const k of WOHNUNGSMIX_KEYS) {
    const sum = items.reduce((s, m) => {
      const units = m.mieteinheiten ?? []
      if (units.length > 0) {
        return s + units.reduce((su, u) => su + (u.wohnungsmix?.[k] ?? 0), 0)
      }
      return s + (m.wohnungsmix?.[k] ?? 0)
    }, 0)
    if (sum > 0) wohnungsmix[k] = sum
  }

  return { count, gf, vol, vmf, anzahl, chf_pa, chf_stk_mt, hoehe_avg, faktor_avg, vmf_pro_stk_avg, chf_m2_pa_avg, wohnungsmix }
}


// ─── Eine Gebäude-Karte ────────────────────────────────────────────────────

function BuildingCard({
  building,
  existingOptions,
  etappen,
  canWrite,
  api,
  isVerkauf,
  flaechenKurz,
  hasWohnen,
  cols,
  minW,
  sortMode,
  detailLevel,
  groupsCollapseSignal,
  isDragging,
  isDragOver,
  onCardDragStart,
  onCardDragOver,
  onCardDragLeave,
  onCardDrop,
  onCardDragEnd,
}: {
  building: VariantBuildingFull
  existingOptions: ReturnType<typeof useExistingBuildings>['buildings']
  etappen: VariantEtappe[]
  canWrite: boolean
  api: ReturnType<typeof useMengengeruest>
  isVerkauf: boolean
  flaechenKurz: string
  hasWohnen: boolean
  cols: string
  minW: string
  sortMode: MietflaechenSortMode
  detailLevel: DetailLevel
  groupsCollapseSignal: { value: boolean; tick: number }
  isDragging?: boolean
  isDragOver?: boolean
  onCardDragStart?: () => void
  onCardDragOver?: (e: DragEvent) => void
  onCardDragLeave?: () => void
  onCardDrop?: () => void
  onCardDragEnd?: () => void
}) {
  // Default-Ausklapp-Zustand richtet sich nach der Detail-Stufe, lässt sich
  // aber jederzeit per Pfeil-Klick übersteuern. Beim nächsten Stufenwechsel
  // wird der Default neu gesetzt.
  const [expanded, setExpanded] = useState(detailLevel >= 2)
  useEffect(() => {
    setExpanded(detailLevel >= 2)
  }, [detailLevel])
  const [editOpen, setEditOpen] = useState(false)

  const linkedExisting = building.existing_building_id
    ? existingOptions.find((e) => e.id === building.existing_building_id)
    : null

  const agg = aggregateMietflaechen(building.mietflaechen, isVerkauf)

  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200 bg-white transition-colors',
        isDragging && 'opacity-40',
        isDragOver && 'ring-2 ring-[#8B6956]/40',
      )}
      style={{ minWidth: minW }}
      onDragOver={onCardDragOver}
      onDragLeave={onCardDragLeave}
      onDrop={onCardDrop}
    >
      <div
        className="grid cursor-pointer border-b border-slate-300 px-3 py-2 text-sm transition hover:brightness-95"
        style={{ gridTemplateColumns: cols, minWidth: minW, backgroundColor: USE_TYPE_COLOR_3[building.use_type] }}
        onClick={() => setExpanded(!expanded)}
      >
          {canWrite ? (
            <span
              className="flex items-center gap-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => api.duplicateBuilding(building.id)}
                className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                title="Gebäude duplizieren (mit Inhalten)"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Gebäude "${building.name}" und alle Zeilen löschen?`)) {
                    api.deleteBuilding(building.id)
                  }
                }}
                className="rounded p-1 text-slate-400 hover:bg-red-100 hover:text-red-600"
                title="Löschen"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                title="Bearbeiten"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </span>
          ) : <span />}
          <div className="col-span-2 flex items-center gap-2 overflow-hidden">
            {canWrite && onCardDragStart && (
              <span
                draggable
                onDragStart={onCardDragStart}
                onDragEnd={onCardDragEnd}
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 cursor-grab text-slate-500 hover:text-slate-700 active:cursor-grabbing"
                title="Zum Verschieben ziehen"
              >
                <GripVertical className="h-4 w-4" />
              </span>
            )}
            {expanded
              ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
              : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
            <span className="min-w-0 flex-1 truncate pl-2 font-semibold text-slate-900">{building.name}</span>
            {linkedExisting && (
              <span className="truncate text-xs text-slate-500">
                ↳ {linkedExisting.bezeichnung}
              </span>
            )}
          </div>
        <AggregateCells agg={agg} hasWohnen={hasWohnen} omitCurrency />
      </div>

      {expanded && (
        <div className="space-y-4 py-3">
          {building.notizen && (
            <p className="px-3 text-xs text-slate-500">{building.notizen}</p>
          )}

          <MietflaechenGrid
            building={building}
            canWrite={canWrite}
            api={api}
            flaechenKurz={flaechenKurz}
            isVerkauf={isVerkauf}
            hasWohnenForced={hasWohnen}
            colsForced={cols}
            minWForced={minW}
            sortMode={sortMode}
            detailLevel={detailLevel}
            groupsCollapseSignal={groupsCollapseSignal}
          />
        </div>
      )}

      <BuildingDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={`Gebäude "${building.name}" bearbeiten`}
        existingOptions={existingOptions}
        etappen={etappen}
        initial={building}
        onSubmit={async (input) => api.updateBuilding(building.id, input)}
      />
    </div>
  )
}

// ─── Intelligente Mietflächen-Tabelle ─────────────────────────────────────

function SubtotalRow({
  label, rows, isVerkauf, hasWohnen, cols, minW, collapsed, onToggle,
}: {
  label: string
  rows: BuildingMietflaeche[]
  isVerkauf: boolean
  hasWohnen: boolean
  cols: string
  minW: string
  collapsed?: boolean
  onToggle?: () => void
}) {
  const agg = aggregateMietflaechen(rows, isVerkauf)
  return (
    <div
      className={cn(
        'grid border-t border-slate-300 bg-slate-200/70 px-3 py-1.5 text-sm font-medium text-slate-700',
        onToggle && 'cursor-pointer hover:bg-slate-300/70',
      )}
      style={{ gridTemplateColumns: cols, minWidth: minW }}
      onClick={onToggle}
    >
      <span />
      <span className="col-span-2 flex items-center gap-1 truncate pl-4">
        {onToggle && (
          collapsed
            ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        )}
        <span className="truncate">{label}</span>
      </span>
      <AggregateCells agg={agg} hasWohnen={hasWohnen} />
    </div>
  )
}

function MieteinheitenHeaderRow({
  isVerkauf, flaechenKurz, hasWohnen, cols, minW,
}: {
  isVerkauf: boolean
  flaechenKurz: string
  hasWohnen: boolean
  cols: string
  minW: string
}) {
  return (
    <div
      className="grid border-t border-slate-300 border-l-4 border-l-[#8B6956]/50 bg-white px-3 py-1 text-[11px] font-medium tracking-wider text-slate-500"
      style={{ gridTemplateColumns: cols, minWidth: minW }}
    >
      <span />
      <span className="col-span-2 pl-2 font-semibold text-slate-600">Mieteinheiten</span>
      <span /><span /><span /><span />
      <span className="text-right pr-[13px]">{flaechenKurz} (m²)</span>
      <span className="text-right pr-[13px]">Stk</span>
      <span className="text-right pr-[13px]">{flaechenKurz}/Stk</span>
      {isVerkauf ? (
        <>
          <span className="text-right pr-[13px]">CHF/m²</span>
          <span className="text-right pr-[13px]">CHF/Stk</span>
          <span className="text-right pr-[13px]">CHF</span>
        </>
      ) : (
        <>
          <span className="text-right pr-[13px]">CHF/m²·a</span>
          <span className="text-right pr-[13px]">CHF/Stk·Mt</span>
          <span className="text-right pr-[13px]">CHF/a</span>
        </>
      )}
      {hasWohnen && (
        <>
          <span />
          {WOHNUNGSMIX_KEYS.map((k) => (
            <span key={k} className="text-center">{WOHNUNGSMIX_LABEL[k]}</span>
          ))}
        </>
      )}
    </div>
  )
}

function MietflaechenGrid({
  building, canWrite, api, flaechenKurz, isVerkauf,
  hasWohnenForced, colsForced, minWForced, sortMode = 'manual',
  detailLevel = 3, groupsCollapseSignal,
}: {
  building: VariantBuildingFull
  canWrite: boolean
  api: ReturnType<typeof useMengengeruest>
  flaechenKurz: string
  isVerkauf: boolean
  hasWohnenForced?: boolean
  colsForced?: string
  minWForced?: string
  sortMode?: MietflaechenSortMode
  detailLevel?: DetailLevel
  groupsCollapseSignal?: { value: boolean; tick: number }
}) {
  const ownHasWohnen = building.mietflaechen.some((m) => isNutzungWohnen(m.nutzung))
  const hasWohnen = hasWohnenForced ?? ownHasWohnen
  const cols = colsForced ?? buildCols(isVerkauf, hasWohnen)
  const minW = minWForced ?? buildMinWidth(isVerkauf, hasWohnen)
  // Pro Mietfläche: sind die Mieteinheiten zugeklappt?
  // Bei detailLevel < 3 standardmäßig alle zu, bei >= 3 alle offen. Manueller
  // Toggle pro Zeile übersteuert den Default — beim nächsten Stufenwechsel
  // wird der Default neu gesetzt.
  const allUnitIds = useMemo(
    () => new Set(building.mietflaechen.flatMap((m) => (m.mieteinheiten ?? []).length > 0 ? [m.id] : [])),
    [building.mietflaechen],
  )
  const [collapsedUnits, setCollapsedUnits] = useState<Set<string>>(
    () => detailLevel < 3 ? new Set(allUnitIds) : new Set(),
  )
  useEffect(() => {
    setCollapsedUnits(detailLevel < 3 ? new Set(allUnitIds) : new Set())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailLevel])
  // Pro Gruppe (bei sortMode 'by-nutzung' / 'by-geschoss'): sind die
  // Geschoss-Zeilen unterhalb der Subtotal-Zeile eingeklappt?
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const toggleGroup = (key: string) => setCollapsedGroups((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  // Globaler Shortcut "Nur Subtotals" / "Alle ausklappen": tick-basiert,
  // damit auch wiederholtes Drücken den lokalen Zustand wieder forciert.
  const collapseTick = groupsCollapseSignal?.tick ?? 0
  const collapseAll  = groupsCollapseSignal?.value ?? false
  useEffect(() => {
    if (collapseTick === 0) return
    if (collapseAll) {
      // Alle aktuell sichtbaren Gruppenschlüssel einklappen
      const allKeys = new Set<string>()
      const keyOf = (m: BuildingMietflaeche) =>
        sortMode === 'by-nutzung'
          ? (m.nutzung || '–')
          : (m.geschoss_bezeichnung?.trim() || '–')
      for (const m of building.mietflaechen) allKeys.add(keyOf(m))
      setCollapsedGroups(allKeys)
    } else {
      setCollapsedGroups(new Set())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseTick])
  const toggleUnits = (id: string) => setCollapsedUnits((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  // Drag & Drop: nur Geschoss-Zeilen einer Mietflächen-Tabelle reorderbar.
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  function onRowDragStart(id: string) { setDragId(id) }
  function onRowDragOver(e: DragEvent, id: string) {
    if (!dragId || dragId === id) return
    e.preventDefault()
    setDragOverId(id)
  }
  function onRowDragLeave(id: string) {
    if (dragOverId === id) setDragOverId(null)
  }
  function onRowDrop(targetId: string) {
    if (!dragId || dragId === targetId) {
      setDragId(null); setDragOverId(null); return
    }
    const ids = building.mietflaechen.map((m) => m.id)
    const fromIdx = ids.indexOf(dragId)
    const toIdx   = ids.indexOf(targetId)
    if (fromIdx < 0 || toIdx < 0) return
    const next = [...ids]
    next.splice(fromIdx, 1)
    next.splice(toIdx, 0, dragId)
    setDragId(null); setDragOverId(null)
    api.reorderMietflaechen(next)
  }
  function onRowDragEnd() { setDragId(null); setDragOverId(null) }

  // Drag & Drop: Mieteinheiten innerhalb ihrer Mietfläche umsortieren.
  const [unitDragId, setUnitDragId] = useState<string | null>(null)
  const [unitDragOverId, setUnitDragOverId] = useState<string | null>(null)
  function onUnitDrop(targetId: string, unitList: BuildingMieteinheit[]) {
    const id = unitDragId
    setUnitDragId(null); setUnitDragOverId(null)
    if (!id || id === targetId) return
    const ids = unitList.map((u) => u.id)
    const from = ids.indexOf(id), to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    const next = [...ids]; next.splice(from, 1); next.splice(to, 0, id)
    api.reorderMieteinheiten(next)
  }

  async function add() {
    // Leeres Geschoss anlegen — Nutzung und Werte werden danach in der Zeile ergänzt.
    await api.createMietflaeche(building.id, {
      nutzung:               '',
      flaeche_m2:            0,
      sort_order:            building.mietflaechen.length,
      geschoss_bezeichnung:  null,
      bezeichnung:           null,
      anzahl:                null,
      zimmer:                null,
      gf_m2:                 null,
      geschosshoehe_m:       null,
      volumen_m3:            null,
      faktor_vmf_gf:         null,
      miete_chf_m2_pa:       null,
      miete_chf_stk_mt:      null,
      miete_chf_pa:          null,
      locked_fields:         [],
      wohnungsmix:           null,
      unterirdisch:          false,
      vmf_pro_stk:           null,
    })
  }

  // Render-Helper für eine Mietfläche inkl. Mieteinheiten — wiederverwendet
  // für beide Sortier-Modi (manuell mit D&D oder gruppiert nach Nutzung).
  const renderMietflaeche = (m: BuildingMietflaeche) => {
    const units = m.mieteinheiten ?? []
    const draggable = sortMode === 'manual'
    // Toggle ist immer verfügbar, sobald Units existieren — User kann auch bei
    // detailLevel<3 manuell aufklappen.
    const showUnitsToggle = units.length > 0
    return (
      <Fragment key={m.id}>
        <MietflaecheRow
          row={m}
          canWrite={canWrite}
          api={api}
          cols={cols}
          minW={minW}
          isVerkauf={isVerkauf}
          hasWohnen={hasWohnen}
          hasUnits={showUnitsToggle}
          unitsCollapsed={collapsedUnits.has(m.id)}
          onToggleUnits={() => toggleUnits(m.id)}
          isDragging={draggable && dragId === m.id}
          isDragOver={draggable && dragOverId === m.id}
          onDragStart={draggable ? () => onRowDragStart(m.id) : undefined}
          onDragOver={draggable ? (e) => onRowDragOver(e, m.id) : undefined}
          onDragLeave={draggable ? () => onRowDragLeave(m.id) : undefined}
          onDrop={draggable ? () => onRowDrop(m.id) : undefined}
          onDragEnd={draggable ? onRowDragEnd : undefined}
        />
        {units.length > 0 && !collapsedUnits.has(m.id) && (
          <MieteinheitenHeaderRow
            isVerkauf={isVerkauf}
            flaechenKurz={flaechenKurz}
            hasWohnen={hasWohnen}
            cols={cols}
            minW={minW}
          />
        )}
        {units.length > 0 && !collapsedUnits.has(m.id) && units.map((u, idx) => (
          <MieteinheitRow
            key={u.id}
            unit={u}
            canWrite={canWrite}
            api={api}
            cols={cols}
            minW={minW}
            isVerkauf={isVerkauf}
            hasWohnen={hasWohnen}
            isLast={idx === units.length - 1}
            parentNutzung={m.nutzung}
            canDrag={canWrite && units.length > 1}
            isDragging={unitDragId === u.id}
            isDragOver={unitDragOverId === u.id}
            onDragStart={() => setUnitDragId(u.id)}
            onDragOver={(e) => { if (unitDragId && unitDragId !== u.id) { e.preventDefault(); setUnitDragOverId(u.id) } }}
            onDragLeave={() => { if (unitDragOverId === u.id) setUnitDragOverId(null) }}
            onDrop={() => onUnitDrop(u.id, units)}
            onDragEnd={() => { setUnitDragId(null); setUnitDragOverId(null) }}
          />
        ))}
      </Fragment>
    )
  }

  // Gruppieren nach Nutzung oder Geschoss — in Reihenfolge des ersten Vorkommens
  const groups: { key: string; rows: BuildingMietflaeche[] }[] = []
  if (sortMode === 'by-nutzung' || sortMode === 'by-geschoss') {
    const byKey = new Map<string, BuildingMietflaeche[]>()
    const keyOf = (m: BuildingMietflaeche) =>
      sortMode === 'by-nutzung'
        ? (m.nutzung || '–')
        : (m.geschoss_bezeichnung?.trim() || '–')
    for (const m of building.mietflaechen) {
      const key = keyOf(m)
      if (!byKey.has(key)) {
        byKey.set(key, [])
        groups.push({ key, rows: byKey.get(key)! })
      }
      byKey.get(key)!.push(m)
    }
  }

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-slate-200">
        {sortMode === 'manual'
          ? building.mietflaechen.map((m) => renderMietflaeche(m))
          : groups.map((g) => (
              <Fragment key={g.key}>
                <SubtotalRow
                  label={g.key}
                  rows={g.rows}
                  isVerkauf={isVerkauf}
                  hasWohnen={hasWohnen}
                  cols={cols}
                  minW={minW}
                  collapsed={collapsedGroups.has(g.key)}
                  onToggle={() => toggleGroup(g.key)}
                />
                {!collapsedGroups.has(g.key) && g.rows.map((m) => renderMietflaeche(m))}
              </Fragment>
            ))}

        {canWrite && (
          <button
            type="button"
            onClick={() => void add()}
            className="flex w-full items-center gap-1.5 border-t border-slate-100 px-3 py-2 text-left text-sm font-medium text-[#8B6956] transition hover:bg-slate-50"
          >
            <Plus className="h-4 w-4" />
            Geschoss erfassen
          </button>
        )}

      </div>
    </div>
  )
}

function MietflaecheRow({
  row, canWrite, api, cols, minW, isVerkauf, hasWohnen, hasUnits,
  unitsCollapsed = false, onToggleUnits,
  isDragging, isDragOver, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
}: {
  row: BuildingMietflaeche
  canWrite: boolean
  api: ReturnType<typeof useMengengeruest>
  cols: string
  minW: string
  isVerkauf: boolean
  hasWohnen: boolean
  hasUnits: boolean
  unitsCollapsed?: boolean
  onToggleUnits?: () => void
  isDragging?: boolean
  isDragOver?: boolean
  onDragStart?: () => void
  onDragOver?: (e: DragEvent) => void
  onDragLeave?: () => void
  onDrop?: () => void
  onDragEnd?: () => void
}) {
  // Wenn Detail-Einheiten existieren: VMF + Mietzinsen sind aus Units summiert
  // (read-only). GF, Höhe, Volumen und Faktor bleiben weiterhin direkt
  // pflegbar — der Faktor wird dann mit konstanter VMF angepasst.
  const editableMass = canWrite                          // GF, Höhe, Volumen, Faktor
  const editableSum  = canWrite && !hasUnits             // VMF, CHF-Felder
  const locked = new Set(row.locked_fields ?? [])

  function commitField(field: RecalcField, raw: string) {
    const val = raw.trim() === '' ? null : Number(raw.replace(',', '.'))
    if (val !== null && isNaN(val)) return
    // Bei aktiven Detail-Einheiten gelten VMF, Stk, VMF/Stk und CHF-Felder
    // virtuell als gelockt — Recalc darf sie nicht überschreiben (sie werden
    // aus den Mieteinheiten via syncMietflaecheFromUnits aggregiert).
    const rowForRecalc = hasUnits
      ? { ...row, locked_fields: Array.from(new Set([
          ...(row.locked_fields ?? []),
          'vmf', 'anzahl', 'vmf_pro_stk', 'chf_pa', 'chf_m2_pa', 'chf_stk_mt',
        ])) }
      : row
    const patch = recalc(rowForRecalc, field, val, isVerkauf)
    if (hasUnits) {
      delete patch.flaeche_m2
      delete patch.anzahl
      delete patch.vmf_pro_stk
      delete patch.miete_chf_m2_pa
      delete patch.miete_chf_stk_mt
      delete patch.miete_chf_pa
    }
    api.updateMietflaeche(row.id, patch)
  }

  function toggleLock(field: RecalcField) {
    const next = new Set(locked)
    if (next.has(field)) next.delete(field)
    else next.add(field)
    // Aus der neuen Lock-Konfiguration ggf. abhängige Felder neu berechnen
    const patch = reconcileLocks(row, next as Set<string>, isVerkauf)
    api.updateMietflaeche(row.id, { locked_fields: Array.from(next), ...patch })
  }

  // Helper-Builder: einheitliche Locking-Props für jede NumCell
  const lp = (f: RecalcField) => ({
    locked: locked.has(f),
    onToggleLock: canWrite ? () => toggleLock(f) : undefined,
  })

  const istWohnen = isNutzungWohnen(row.nutzung)
  const mix: Wohnungsmix = row.wohnungsmix ?? {}
  const mixTotal = WOHNUNGSMIX_KEYS.reduce((s, k) => s + (Number(mix[k] ?? 0) || 0), 0)
  // Stk wird gesperrt sobald der Wohnungsmix befüllt ist — dort kommt die Anzahl
  // dann automatisch aus der Summe der Wohnungs-Stückzahlen.
  const anzahlFromMix = istWohnen && mixTotal > 0

  function setMixNum(key: keyof Wohnungsmix, raw: string) {
    const v = raw.trim() === '' ? null : Number(raw)
    if (v !== null && isNaN(v as number)) return
    const newMix = { ...mix, [key]: v }
    const newTotal = WOHNUNGSMIX_KEYS.reduce((s, k) => s + (Number(newMix[k] ?? 0) || 0), 0)
    // Nutzung automatisch auf „Wohnen" setzen, wenn ein Wohnungsmix erfasst wird und
    // noch keine Nutzung angegeben ist — sonst fiele die Zeile aus dem Wohnungsmix.
    const nutzPatch = newTotal > 0 && !row.nutzung?.trim() ? { nutzung: 'Wohnen' } : {}
    const effWohnen = istWohnen || 'nutzung' in nutzPatch
    // Wenn Wohnungen erfasst werden, anzahl = Summe; Recalc passt VMF/Stk + Mietzinse an.
    if (effWohnen && newTotal > 0) {
      const patch = recalc(row, 'anzahl', newTotal, isVerkauf)
      api.updateMietflaeche(row.id, { ...patch, ...nutzPatch, wohnungsmix: newMix })
    } else {
      api.updateMietflaeche(row.id, { ...nutzPatch, wohnungsmix: newMix })
    }
  }

  return (
    <>
      <div
        className={cn(
          'grid border-t border-slate-200 bg-slate-100 px-3 py-1.5 transition-colors',
          isDragging && 'opacity-40',
          isDragOver && 'bg-[#8B6956]/10 ring-2 ring-inset ring-[#8B6956]/40',
        )}
        style={{ gridTemplateColumns: cols, minWidth: minW }}
        draggable={canWrite}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
      >
        {canWrite ? (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => api.duplicateMietflaeche(row.id)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              title="Zeile duplizieren"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => api.deleteMietflaeche(row.id)}
              className="rounded p-1 text-slate-400 hover:bg-red-100 hover:text-red-600"
              title="Zeile entfernen"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : <span />}
        <div className="flex min-w-0 items-center gap-0.5">
          {canWrite && (
            <span
              className="shrink-0 cursor-grab text-slate-300 hover:text-slate-600 active:cursor-grabbing"
              title="Zum Verschieben ziehen"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </span>
          )}
          {canWrite && (
            <span className="group/addunit relative inline-flex shrink-0">
              <button
                type="button"
                onClick={() => api.createMieteinheit(row.id)}
                aria-label="Mieteinheit erfassen"
                className="rounded p-0.5 text-[#8B6956] hover:bg-slate-200"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-100 group-hover/addunit:opacity-100">
                Mieteinheit erfassen
              </span>
            </span>
          )}
          {hasUnits ? (
            <span className="group/units relative inline-flex shrink-0">
              <button
                type="button"
                onClick={onToggleUnits}
                aria-label={unitsCollapsed ? 'Erfasste Mieteinheiten anzeigen' : 'Mieteinheiten zuklappen'}
                className="rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
              >
                {unitsCollapsed
                  ? <ChevronRight className="h-3.5 w-3.5" />
                  : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-100 group-hover/units:opacity-100">
                {unitsCollapsed ? 'Erfasste Mieteinheiten anzeigen' : 'Mieteinheiten zuklappen'}
              </span>
            </span>
          ) : (
            <span className="h-3.5 w-3.5 shrink-0" />
          )}
          <InlineTextInput
            value={row.geschoss_bezeichnung ?? ''}
            placeholder="EG / 1.OG"
            canWrite={canWrite}
            onCommit={(v) => api.updateMietflaeche(row.id, { geschoss_bezeichnung: v.trim() || null })}
          />
          <span className="group/oiui relative inline-flex shrink-0">
            <button
              type="button"
              onClick={() => canWrite && api.updateMietflaeche(row.id, { unterirdisch: !row.unterirdisch })}
              disabled={!canWrite}
              aria-label="Wähle OI (oberirdisch) oder UI (unterirdisch) durch Klicken"
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition',
                row.unterirdisch
                  ? 'bg-slate-700 text-white hover:bg-slate-800'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                !canWrite && 'cursor-not-allowed opacity-60',
              )}
            >
              {row.unterirdisch ? 'UI' : 'OI'}
            </button>
            <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-100 group-hover/oiui:opacity-100">
              Wähle OI (oberirdisch) oder UI (unterirdisch) durch Klicken
            </span>
          </span>
        </div>
        <TextCell
          value={row.nutzung}
          placeholder="z.B. Wohnen"
          canWrite={canWrite}
          list="nutzung-vorschlaege"
          onCommit={(v) => v.trim() && api.updateMietflaeche(row.id, { nutzung: v.trim() })}
        />
        <NumCell value={row.gf_m2}            canWrite={editableMass} onCommit={(s) => commitField('gf', s)}        digits={0} {...lp('gf')} />
        <NumCell value={row.geschosshoehe_m}  canWrite={editableMass} onCommit={(s) => commitField('hoehe', s)}     digits={2} minDigits={2} {...lp('hoehe')} />
        <NumCell value={row.volumen_m3}       canWrite={editableMass} onCommit={(s) => commitField('volumen', s)}   digits={0} {...lp('volumen')} />
        <NumCell value={row.faktor_vmf_gf}    canWrite={editableMass} onCommit={(s) => commitField('faktor', s)}    digits={2} placeholder={String(DEFAULT_FAKTOR_VMF_GF)} {...lp('faktor')} />
        <NumCell value={row.flaeche_m2}       canWrite={editableSum}  onCommit={(s) => commitField('vmf', s)}       digits={0} {...lp('vmf')} />
        {/* Stk — bei aktiven Mieteinheiten oder gefülltem Wohnungsmix gesperrt */}
        <NumCell
          value={anzahlFromMix ? mixTotal : row.anzahl}
          canWrite={editableSum && !anzahlFromMix}
          onCommit={(s) => commitField('anzahl', s)}
          digits={0}
          {...lp('anzahl')}
          locked={(anzahlFromMix || hasUnits) ? true : lp('anzahl').locked}
          onToggleLock={(anzahlFromMix || hasUnits) ? undefined : lp('anzahl').onToggleLock}
        />
        <NumCell
          value={row.vmf_pro_stk}
          canWrite={editableSum}
          onCommit={(s) => commitField('vmf_pro_stk', s)}
          digits={2}
          {...lp('vmf_pro_stk')}
          locked={hasUnits ? true : lp('vmf_pro_stk').locked}
          onToggleLock={hasUnits ? undefined : lp('vmf_pro_stk').onToggleLock}
        />
        {isVerkauf ? (
          <>
            <NumCell value={row.miete_chf_m2_pa}  canWrite={editableSum} onCommit={(s) => commitField('chf_m2_pa', s)} digits={0} {...lp('chf_m2_pa')} />
            <NumCell value={row.miete_chf_stk_mt} canWrite={editableSum} onCommit={(s) => commitField('chf_stk_mt', s)} digits={0} {...lp('chf_stk_mt')} />
            <NumCell value={row.miete_chf_pa}     canWrite={editableSum} onCommit={(s) => commitField('chf_pa', s)}    digits={0} {...lp('chf_pa')} />
          </>
        ) : (
          <>
            <NumCell value={row.miete_chf_m2_pa}  canWrite={editableSum} onCommit={(s) => commitField('chf_m2_pa', s)} digits={2} {...lp('chf_m2_pa')} />
            <NumCell value={row.miete_chf_stk_mt} canWrite={editableSum} onCommit={(s) => commitField('chf_stk_mt', s)} digits={0} {...lp('chf_stk_mt')} />
            <NumCell value={row.miete_chf_pa}     canWrite={editableSum} onCommit={(s) => commitField('chf_pa', s)}    digits={0} {...lp('chf_pa')} />
          </>
        )}
        {hasWohnen && (
          <>
            <span />
            {WOHNUNGSMIX_KEYS.map((k) => (
              istWohnen ? (
                <MiniWhgInput
                  key={k}
                  value={mix[k] ?? null}
                  canWrite={canWrite && !hasUnits}
                  onCommit={(s) => setMixNum(k, s)}
                />
              ) : <span key={k} />
            ))}
          </>
        )}
      </div>
    </>
  )
}

// ─── Wohnungsmix-Inline-Inputs (passen in einzelne Grid-Zellen) ──────────

// ─── Detail-Mieteinheit (Kindzeile einer Mietfläche) ──────────────────────

function MieteinheitRow({
  unit, canWrite, api, cols, minW, isVerkauf, hasWohnen, isLast, parentNutzung,
  canDrag, isDragging, isDragOver, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
}: {
  unit: BuildingMieteinheit
  canWrite: boolean
  api: ReturnType<typeof useMengengeruest>
  cols: string
  minW: string
  isVerkauf: boolean
  parentNutzung: string
  hasWohnen: boolean
  isLast?: boolean
  canDrag?: boolean
  isDragging?: boolean
  isDragOver?: boolean
  onDragStart?: () => void
  onDragOver?: (e: DragEvent) => void
  onDragLeave?: () => void
  onDrop?: () => void
  onDragEnd?: () => void
}) {
  const locked = new Set(unit.locked_fields ?? [])
  const istWohnen = isNutzungWohnen(parentNutzung)

  function commitField(field: RecalcField, raw: string) {
    const val = raw.trim() === '' ? null : Number(raw.replace(',', '.'))
    if (val !== null && isNaN(val)) return
    // recalc-Logik wiederverwenden — Felder/Beziehungen identisch
    const patch = recalc(unit as unknown as BuildingMietflaeche, field, val, isVerkauf)
    api.updateMieteinheit(unit.id, coerceUnitAnzahl(patch))
  }

  function toggleLock(field: RecalcField) {
    const next = new Set(locked)
    if (next.has(field)) next.delete(field)
    else next.add(field)
    const patch = reconcileLocks(unit, next as Set<string>, isVerkauf)
    api.updateMieteinheit(unit.id, coerceUnitAnzahl({ locked_fields: Array.from(next), ...patch }))
  }

  const lp = (f: RecalcField) => ({
    locked: locked.has(f),
    onToggleLock: canWrite ? () => toggleLock(f) : undefined,
  })

  const mix: Wohnungsmix = unit.wohnungsmix ?? {}
  function setMixNum(key: keyof Wohnungsmix, raw: string) {
    const v = raw.trim() === '' ? null : Number(raw)
    if (v !== null && isNaN(v as number)) return
    const newMix = { ...mix, [key]: v }
    // Anzahl wird aus dem Wohnungsmix abgeleitet — Summe aller Stückzahlen.
    // Mindestens 1, damit Mietzins-Berechnungen (anzahl × CHF/Stk·Mt) nicht 0 werden.
    const total = WOHNUNGSMIX_KEYS.reduce(
      (s, k) => s + (Number(newMix[k] ?? 0) || 0),
      0,
    )
    const newAnzahl = total > 0 ? total : 1
    // Recalc nutzen, damit CHF/a, CHF/Stk·Mt, CHF/m²·a sofort konsistent bleiben.
    const patch = recalc(unit as unknown as BuildingMietflaeche, 'anzahl', newAnzahl, isVerkauf)
    api.updateMieteinheit(unit.id, coerceUnitAnzahl({
      ...patch,
      wohnungsmix: newMix,
    }))
    // Nutzung der Eltern-Mietfläche automatisch auf „Wohnen" setzen, wenn ein
    // Wohnungsmix erfasst wird und dort noch keine Nutzung angegeben ist.
    if (total > 0 && !parentNutzung?.trim()) {
      api.updateMietflaeche(unit.mietflaeche_id, { nutzung: 'Wohnen' })
    }
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'inputs-on-white grid border-t border-slate-200/70 border-l-4 border-l-[#8B6956]/50 bg-white px-3 py-1.5 transition-colors',
        isLast && 'border-b-2 border-b-slate-300',
        isDragging && 'opacity-40',
        isDragOver && 'bg-[#8B6956]/10 ring-2 ring-inset ring-[#8B6956]/40',
      )}
      style={{ gridTemplateColumns: cols, minWidth: minW }}
    >
      {/* Aktion vorne; danach col 2–7 (über die leeren Mess-Spalten): Nr. · Name · Wohnungstyp */}
      {canWrite ? (
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => api.duplicateMieteinheit(unit.id)}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Einheit duplizieren"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => api.deleteMieteinheit(unit.id)}
            className="rounded p-1 text-slate-400 hover:bg-red-100 hover:text-red-600"
            title="Einheit entfernen"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : <span />}
      {/* col 2 (Geschoss): Grip + ↳ + Ausrichtung an das Geschoss-Feld · Wohnungsnr. */}
      <div className="flex items-center gap-0.5">
        {canDrag ? (
          <span
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            className="shrink-0 cursor-grab text-slate-300 hover:text-slate-600 active:cursor-grabbing"
            title="Mieteinheit verschieben"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
        ) : <span className="h-3.5 w-3.5 shrink-0" />}
        <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span className="w-5 shrink-0" />
        <input
          className={cn(inputClass, 'min-w-0 flex-1', !canWrite && 'border-transparent bg-transparent')}
          placeholder="Nr."
          title="Wohnungsnummer"
          defaultValue={unit.wohnungsnummer ?? ''}
          onBlur={(e) => {
            const v = e.target.value.trim() || null
            if (v !== (unit.wohnungsnummer ?? null)) api.updateMieteinheit(unit.id, { wohnungsnummer: v })
          }}
          disabled={!canWrite}
        />
      </div>
      {/* Bezeichnung immer als langes Feld (col 3–7 bzw. 4–7, bis zur VMF). */}
      {(() => {
        const bezInput = (
          <input
            className={cn(inputClass, 'min-w-0 flex-1', !canWrite && 'border-transparent bg-transparent')}
            placeholder="Bezeichnung"
            title="Bezeichnung"
            defaultValue={unit.bezeichnung ?? ''}
            onBlur={(e) => {
              const v = e.target.value.trim() || null
              if (v !== unit.bezeichnung) api.updateMieteinheit(unit.id, { bezeichnung: v })
            }}
            disabled={!canWrite}
          />
        )
        const badge = (unit.anzahl ?? 1) > 1 ? (
          <span
            className="shrink-0 rounded bg-slate-200 px-1 py-0.5 text-[10px] font-medium tabular-nums text-slate-600"
            title="Anzahl ergibt sich aus den Wohnungsgrössen"
          >
            × {unit.anzahl}
          </span>
        ) : null
        return istWohnen ? (
          <>
            {/* col 3 (Nutzung): Wohnungstyp */}
            <div className="flex items-center pr-1">
              <input
                list={`wohnungstyp-${unit.id}`}
                className={cn(inputClass, 'w-full', !canWrite && 'border-transparent bg-transparent')}
                placeholder="Wohnungstyp"
                title="Wohnungstyp"
                defaultValue={unit.wohnungstyp ?? ''}
                onBlur={(e) => {
                  const v = e.target.value.trim() || null
                  if (v !== (unit.wohnungstyp ?? null)) api.updateMieteinheit(unit.id, { wohnungstyp: v })
                }}
                disabled={!canWrite}
              />
              <datalist id={`wohnungstyp-${unit.id}`}>
                {WOHNUNGSTYP_OPTIONEN.map((o) => <option key={o} value={o} />)}
              </datalist>
            </div>
            {/* col 4–7: Bezeichnung bis zur VMF */}
            <div className="col-span-4 flex items-center gap-1 pr-1">{bezInput}{badge}</div>
          </>
        ) : (
          // col 3–7: Bezeichnung bis zur VMF (kein Wohnungstyp)
          <div className="col-span-5 flex items-center gap-1 pr-1">{bezInput}{badge}</div>
        )
      })()}
      {/* VMF (Total der Einheit) */}
      <NumCell value={unit.flaeche_m2} canWrite={canWrite} onCommit={(s) => commitField('vmf', s)} digits={0} {...lp('vmf')} />
      {/* Stk — bei Mieteinheiten kommt anzahl aus dem Wohnungsmix; gesperrt wenn Wohnungen erfasst */}
      {(() => {
        const mixTotal = WOHNUNGSMIX_KEYS.reduce((s, k) => s + (Number(mix[k] ?? 0) || 0), 0)
        const fromMix = mixTotal > 0
        return (
          <NumCell
            value={fromMix ? mixTotal : unit.anzahl}
            canWrite={canWrite && !fromMix}
            onCommit={(s) => commitField('anzahl', s)}
            digits={0}
            {...lp('anzahl')}
            locked={fromMix ? true : lp('anzahl').locked}
            onToggleLock={fromMix ? undefined : lp('anzahl').onToggleLock}
          />
        )
      })()}
      <NumCell value={unit.vmf_pro_stk} canWrite={canWrite} onCommit={(s) => commitField('vmf_pro_stk', s)} digits={2} {...lp('vmf_pro_stk')} />
      {isVerkauf ? (
        <>
          <NumCell value={unit.miete_chf_m2_pa}  canWrite={canWrite} onCommit={(s) => commitField('chf_m2_pa', s)} digits={0} {...lp('chf_m2_pa')} />
          <NumCell value={unit.miete_chf_stk_mt} canWrite={canWrite} onCommit={(s) => commitField('chf_stk_mt', s)} digits={0} {...lp('chf_stk_mt')} />
          <NumCell value={unit.miete_chf_pa}     canWrite={canWrite} onCommit={(s) => commitField('chf_pa', s)}    digits={0} {...lp('chf_pa')} />
        </>
      ) : (
        <>
          <NumCell value={unit.miete_chf_m2_pa}  canWrite={canWrite} onCommit={(s) => commitField('chf_m2_pa', s)} digits={2} {...lp('chf_m2_pa')} />
          <NumCell value={unit.miete_chf_stk_mt} canWrite={canWrite} onCommit={(s) => commitField('chf_stk_mt', s)} digits={0} {...lp('chf_stk_mt')} />
          <NumCell value={unit.miete_chf_pa}     canWrite={canWrite} onCommit={(s) => commitField('chf_pa', s)}    digits={0} {...lp('chf_pa')} />
        </>
      )}
      {hasWohnen && (
        <>
          <span />
          {WOHNUNGSMIX_KEYS.map((k) => (
            <MiniWhgInput
              key={k}
              value={mix[k] ?? null}
              canWrite={canWrite}
              onCommit={(s) => setMixNum(k, s)}
            />
          ))}
        </>
      )}
    </div>
  )
}


function MiniWhgInput({
  value, canWrite, onCommit,
}: {
  value: number | null
  canWrite: boolean
  onCommit: (raw: string) => void
}) {
  const [raw, setRaw] = useState(value != null ? String(value) : '')
  useEffect(() => { setRaw(value != null ? String(value) : '') }, [value])
  return (
    <div className="px-1">
      <input
        type="number"
        inputMode="numeric"
        step={1}
        min={0}
        className="no-spinner w-full rounded border border-slate-200 bg-slate-50 px-0.5 py-0.5 text-center text-xs tabular-nums text-slate-900 outline-none focus:border-[#8B6956] focus:bg-white disabled:opacity-50"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={() => onCommit(raw)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        disabled={!canWrite}
      />
    </div>
  )
}

// Total-Zellen für die Wohnungsmix-Spalten in der Total-Row der Tabelle
function WohnungsmixTotalCells({
  buildings,
}: {
  buildings: VariantBuildingFull[]
}) {
  const sums: Record<string, number> = {}
  buildings.forEach((b) => b.mietflaechen.forEach((m) => {
    if (!isNutzungWohnen(m.nutzung) || !m.wohnungsmix) return
    WOHNUNGSMIX_KEYS.forEach((k) => {
      sums[k] = (sums[k] ?? 0) + (m.wohnungsmix?.[k] ?? 0)
    })
  }))
  return (
    <>
      <span />
      {WOHNUNGSMIX_KEYS.map((k) => (
        <span key={k} className="text-center text-sm tabular-nums">
          {sums[k] ? sums[k] : ''}
        </span>
      ))}
    </>
  )
}

function TextCell({
  value, placeholder, canWrite, list, onCommit,
}: {
  value: string
  placeholder?: string
  canWrite: boolean
  list?: string
  onCommit: (v: string) => void
}) {
  const [raw, setRaw] = useState(value)
  useEffect(() => { setRaw(value) }, [value])
  return (
    <input
      list={list}
      className={cn(inputClass, 'mx-1', !canWrite && 'border-transparent bg-transparent')}
      placeholder={placeholder}
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={() => raw !== value && onCommit(raw)}
      disabled={!canWrite}
    />
  )
}

// Variante für Inline-Verwendung (z.B. in einem Flex-Container neben einem Toggle-Icon).
function InlineTextInput({
  value, placeholder, canWrite, onCommit,
}: {
  value: string
  placeholder?: string
  canWrite: boolean
  onCommit: (v: string) => void
}) {
  const [raw, setRaw] = useState(value)
  useEffect(() => { setRaw(value) }, [value])
  return (
    <input
      className={cn(inputClass, 'min-w-0 flex-1', !canWrite && 'border-transparent bg-transparent')}
      placeholder={placeholder}
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={() => raw !== value && onCommit(raw)}
      disabled={!canWrite}
    />
  )
}

function NumCell({
  value, canWrite, onCommit, digits = 2, minDigits = 0, placeholder,
  locked = false, onToggleLock,
}: {
  value: number | null
  canWrite: boolean
  onCommit: (raw: string) => void
  digits?: number
  /** Minimale Nachkommastellen in der Anzeige (z. B. 2 für „2.50"). */
  minDigits?: number
  placeholder?: string
  locked?: boolean
  onToggleLock?: () => void
}) {
  // Im Fokus ohne erzwungene Nullen tippen, sonst mit fixer Nachkommastellenzahl anzeigen.
  const [raw, setRaw] = useState(value != null ? formatChDisplay(value, digits, minDigits) : '')
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setRaw(value != null ? formatChDisplay(value, digits, minDigits) : '')
  }, [value, digits, minDigits, focused])

  return (
    <div className="relative px-1">
      <input
        type="text"
        inputMode="decimal"
        placeholder={placeholder}
        className={cn(
          inputClass,
          'w-full pl-5 text-right tabular-nums',
          locked && 'border-amber-300 bg-amber-50',
          !canWrite && 'border-transparent bg-transparent',
        )}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          onCommit(parseChNumber(raw))
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        disabled={!canWrite}
      />
      {onToggleLock && (
        <button
          type="button"
          onClick={onToggleLock}
          className={cn(
            'absolute left-1 top-1/2 -translate-y-1/2 rounded p-0.5 transition',
            locked
              ? 'text-amber-500 hover:text-amber-600'
              : 'text-slate-300 hover:text-slate-600',
          )}
          title={locked
            ? 'Wert eingefroren — klicken zum Lösen'
            : 'Wert anpassbar — klicken zum Einfrieren'}
          tabIndex={-1}
        >
          {locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
        </button>
      )}
    </div>
  )
}

// CH-Anzeige: 1'234'567.89 / 1'234.5 / 1'234
function formatChDisplay(v: number, digits: number, minDigits = 0): string {
  return new Intl.NumberFormat('de-CH', {
    minimumFractionDigits: Math.min(minDigits, digits),
    maximumFractionDigits: digits,
  }).format(v)
}

// Parsen: Apostroph + Leerzeichen entfernen, Komma → Punkt
function parseChNumber(raw: string): string {
  return raw.replace(/['\s’]/g, '').replace(',', '.')
}


// ─── Ertragsobjekte-Sub-Sektion ───────────────────────────────────────────

function ErtragsobjekteSection({
  building, canWrite, api,
}: {
  building: VariantBuildingFull
  canWrite: boolean
  api: ReturnType<typeof useMengengeruest>
}) {
  const [draftBez, setDraftBez] = useState('')
  const [draftAnz, setDraftAnz] = useState('1')

  async function add() {
    if (!draftBez.trim()) return
    const ok = await api.createErtragsobjekt(building.id, {
      bezeichnung: draftBez.trim(),
      anzahl:      Number(draftAnz) || 1,
      notizen:     null,
      sort_order:  building.ertragsobjekte.length,
    })
    if (ok) { setDraftBez(''); setDraftAnz('1') }
  }

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Ertragsobjekte</h4>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <div className="grid border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-400" style={{ gridTemplateColumns: '1fr 4rem 2.5rem' }}>
          <span>Bezeichnung</span>
          <span className="text-right">Anzahl</span>
          <span />
        </div>
        {building.ertragsobjekte.map((e) => (
          <ErtragsobjektRow key={e.id} ertragsobjekt={e} canWrite={canWrite} api={api} />
        ))}
        {canWrite && (
          <div className="grid border-t border-slate-100 px-3 py-1.5" style={{ gridTemplateColumns: '1fr 4rem 2.5rem' }}>
            <input
              className={inputClass}
              placeholder="z.B. Werbefläche"
              value={draftBez}
              onChange={(e) => setDraftBez(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
            />
            <input
              type="number"
              inputMode="numeric"
              step={1}
              min={1}
              className={cn(inputClass, 'ml-1 text-right tabular-nums')}
              value={draftAnz}
              onChange={(e) => setDraftAnz(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
            />
            <Button variant="ghost" size="sm" onClick={add} title="Hinzufügen">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function ErtragsobjektRow({
  ertragsobjekt, canWrite, api,
}: {
  ertragsobjekt: VariantBuildingFull['ertragsobjekte'][number]
  canWrite: boolean
  api: ReturnType<typeof useMengengeruest>
}) {
  const [bez, setBez] = useState(ertragsobjekt.bezeichnung)
  const [anz, setAnz] = useState(String(ertragsobjekt.anzahl))

  useEffect(() => { setBez(ertragsobjekt.bezeichnung) }, [ertragsobjekt.bezeichnung])
  useEffect(() => { setAnz(String(ertragsobjekt.anzahl)) }, [ertragsobjekt.anzahl])

  function commitBez() {
    if (bez.trim() && bez !== ertragsobjekt.bezeichnung) {
      api.updateErtragsobjekt(ertragsobjekt.id, { bezeichnung: bez.trim() })
    }
  }
  function commitAnz() {
    const v = Number(anz)
    if (!isNaN(v) && v !== ertragsobjekt.anzahl) {
      api.updateErtragsobjekt(ertragsobjekt.id, { anzahl: v })
    }
  }

  return (
    <div className="grid border-t border-slate-50 px-3 py-1.5" style={{ gridTemplateColumns: '1fr 4rem 2.5rem' }}>
      <input
        className={cn(inputClass, !canWrite && 'border-transparent bg-transparent')}
        value={bez}
        onChange={(e) => setBez(e.target.value)}
        onBlur={commitBez}
        disabled={!canWrite}
      />
      <input
        type="number"
        inputMode="numeric"
        step={1}
        min={1}
        className={cn(inputClass, 'ml-1 text-right tabular-nums', !canWrite && 'border-transparent bg-transparent')}
        value={anz}
        onChange={(e) => setAnz(e.target.value)}
        onBlur={commitAnz}
        disabled={!canWrite}
      />
      {canWrite && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => api.deleteErtragsobjekt(ertragsobjekt.id)}
          title="Entfernen"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}

// ─── Gebäude anlegen / bearbeiten ─────────────────────────────────────────

function BuildingDialog({
  open,
  onClose,
  title,
  existingOptions,
  etappen,
  initial,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  title: string
  existingOptions: ReturnType<typeof useExistingBuildings>['buildings']
  etappen: VariantEtappe[]
  initial?: VariantBuildingFull
  onSubmit: (input: VariantBuildingInput) => Promise<boolean>
}) {
  const [name, setName]               = useState('')
  const [art, setArt]                 = useState<BuildingArt>('neubau')
  const [useType, setUseType]         = useState<ProjectUseType>('renditeobjekt')
  const [etappeId, setEtappeId]       = useState<string>('')
  const [existingId, setExistingId]   = useState<string>('')
  const [notizen, setNotizen]         = useState('')
  const [submitting, setSubmitting]   = useState(false)
  const [error, setError]             = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '')
      setArt(initial?.art ?? 'neubau')
      // 'gemischt' ist abgeschafft — auf Renditeobjekt (Miete) zurückfallen.
      setUseType(initial?.use_type && initial.use_type !== 'gemischt' ? initial.use_type : 'renditeobjekt')
      setEtappeId(initial?.etappe_id ?? etappen[0]?.id ?? '')
      setExistingId(initial?.existing_building_id ?? '')
      setNotizen(initial?.notizen ?? '')
      setError(null)
    }
  }, [open, initial, etappen])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Bitte einen Namen eingeben.')
      return
    }
    setError(null); setSubmitting(true)

    const ok = await onSubmit({
      name:                 name.trim(),
      art,
      use_type:             useType,
      etappe_id:            etappeId || null,
      existing_building_id: existingId || null,
      nutzung_haupt:        initial?.nutzung_haupt ?? null,
      geschossflaeche_m2:   initial?.geschossflaeche_m2 ?? null,
      hauptnutzflaeche_m2:  initial?.hauptnutzflaeche_m2 ?? null,
      volumen_m3:           initial?.volumen_m3 ?? null,
      faktor_hnf_gf:        initial?.faktor_hnf_gf ?? DEFAULT_FAKTOR_VMF_GF,
      geschosshoehe_m:      initial?.geschosshoehe_m ?? null,
      notizen:              notizen.trim() || null,
      sort_order:           initial?.sort_order ?? 0,
    })
    setSubmitting(false)
    if (!ok) {
      setError('Speichern fehlgeschlagen.')
      return
    }
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" required>
              <input
                className={cn(inputClass, 'w-full px-3 py-2.5')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={submitting}
                placeholder="z.B. Haus A"
              />
            </Field>
            <Field label="Nutzungsart" required>
              <select
                className={cn(inputClass, 'w-full px-3 py-2.5')}
                value={useType}
                onChange={(e) => setUseType(e.target.value as ProjectUseType)}
                disabled={submitting}
              >
                {USE_TYPE_SELECTABLE.map((u) => (
                  <option key={u} value={u}>{USE_TYPE_LABEL[u]}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Art" required>
              <select
                className={cn(inputClass, 'w-full px-3 py-2.5')}
                value={art}
                onChange={(e) => setArt(e.target.value as BuildingArt)}
                disabled={submitting}
              >
                {(Object.keys(BUILDING_ART_LABEL) as BuildingArt[]).map((k) => (
                  <option key={k} value={k}>{BUILDING_ART_LABEL[k]}</option>
                ))}
              </select>
            </Field>
            <Field label="Etappe" hint="Bauetappe — steuert die Gruppierung der Mengen und BKP-2-Kosten">
              <select
                className={cn(inputClass, 'w-full px-3 py-2.5')}
                value={etappeId}
                onChange={(e) => setEtappeId(e.target.value)}
                disabled={submitting || etappen.length === 0}
              >
                {etappen.length === 0 && <option value="">— keine Etappe —</option>}
                {etappen.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Bestandsgebäude" hint="optional — Bezug auf ein Gebäude aus den Stammdaten">
            <select
              className={cn(inputClass, 'w-full px-3 py-2.5')}
              value={existingId}
              onChange={(e) => setExistingId(e.target.value)}
              disabled={submitting || existingOptions.length === 0}
            >
              <option value="">— keine Verknüpfung —</option>
              {existingOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.bezeichnung}{b.gvz_nummer ? ` · GVZ ${b.gvz_nummer}` : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Notizen">
            <textarea
              rows={2}
              className={cn(inputClass, 'w-full px-3 py-2.5')}
              value={notizen}
              onChange={(e) => setNotizen(e.target.value)}
              disabled={submitting}
            />
          </Field>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Abbrechen
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className="bg-[#F2D3C2] text-slate-900 hover:bg-[#E7AF90]"
            >
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" />Speichern…</> : <><Save className="h-4 w-4" />Speichern</>}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label, hint, required, children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
        {hint && <span className="ml-2 text-xs font-normal text-slate-400">{hint}</span>}
      </label>
      {children}
    </div>
  )
}
