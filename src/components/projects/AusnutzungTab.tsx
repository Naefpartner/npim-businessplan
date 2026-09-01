import { useEffect, useMemo, useState } from 'react'
import { Loader2, Layers, ChevronDown, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { fetchProject } from '@/hooks/useProjects'
import { useParcels, useZoneRegulations } from '@/hooks/useStammdaten'
import { useAuth } from '@/contexts/AuthContext'
import type { Project, ZoneRegulation } from '@/types'
import { berechneAusnutzung } from '@/lib/ausnutzung'
import { cn } from '@/lib/utils'

// =============================================================================
// AusnutzungTab
//
// Berechnet die maximal mögliche Vermietungsfläche (VMF) eines Projekts nach
// vier Methoden — Ausnutzungsziffer, Baumassenziffer, Überbauungsziffer und
// Freiflächenziffer — und nimmt das Minimum als verbindlichen Wert.
//
// Logik 1:1 übernommen aus immo-portfolio (AusnuetzungTab.tsx). Anpassungen:
//   - Property → Project
//   - parcels.plot_area_m2 → flaeche_m2
//   - parcels.agf_m2 → agsf_m2
//   - parcels.zone_type → zone
//   - zone_regulations als eigene Tabelle (pro Projekt + Zone)
//   - "VMF Ist" / "Potenzial" entfallen (kommen erst mit dem Mengengerüst)
// =============================================================================

const fmt = (v: number | null | undefined): string =>
  v == null ? '–' : Math.round(v).toLocaleString('de-CH', { maximumFractionDigits: 0 })

const fmtDec = (v: number | null | undefined, digits = 2): string =>
  v == null ? '–' : v.toLocaleString('de-CH', { minimumFractionDigits: digits, maximumFractionDigits: digits })

// ─── Eingabe-Feld (Auto-Save bei Blur/Enter) ──────────────────────────────

function InlineNum({
  value,
  onChange,
  saving,
}: {
  value: number | null
  onChange: (v: number | null) => void
  saving?: boolean
}) {
  const [raw, setRaw] = useState(value != null ? String(value) : '')
  useEffect(() => { setRaw(value != null ? String(value) : '') }, [value])

  function commit() {
    const parsed = raw.trim() ? parseFloat(raw.replace(',', '.')) : NaN
    onChange(isNaN(parsed) ? null : parsed)
  }
  return (
    <div className="relative">
      <input
        type="number"
        value={raw}
        placeholder="–"
        onChange={(e) => setRaw(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
        className="w-24 rounded border border-slate-200 bg-white px-2 py-1 text-right text-sm tabular-nums text-slate-900 focus:border-[#8B6956] focus:outline-none"
      />
      {saving && <Loader2 className="absolute -right-5 top-1.5 h-3.5 w-3.5 animate-spin text-slate-400" />}
    </div>
  )
}

// ─── Tile (Berechnungskachel) ─────────────────────────────────────────────

function Tile({
  title, subtitle, result, isMin, resultLabel = 'Resultat', resultNeutral = false, children, footer,
}: {
  title: string
  subtitle: string
  result: number | null
  isMin: boolean
  resultLabel?: string
  resultNeutral?: boolean
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const highlight = result != null && isMin && !resultNeutral
  return (
    <div className={cn(
      'rounded-xl border bg-white p-4 space-y-3 transition-shadow',
      highlight ? 'border-[#7A9AB8] shadow-sm' : 'border-slate-200',
    )}>
      <div>
        <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
        <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
      </div>
      <div className="space-y-2">{children}</div>
      <div className={cn(
        'flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold',
        result != null ? 'bg-slate-100 text-slate-700' : 'bg-slate-50 text-slate-400',
      )}>
        <span>{resultLabel}</span>
        <span className="tabular-nums">{result != null ? `${fmt(result)} m²` : '–'}</span>
      </div>
      {footer}
    </div>
  )
}

// ─── ZoneRegCard (Eingabe pro Zone) ───────────────────────────────────────

const inputClass =
  'rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-right tabular-nums text-slate-900 outline-none transition focus:border-[#8B6956] focus:ring-1 focus:ring-[#8B6956]/30 disabled:opacity-50'

function ZoneRegCard({
  zoneType,
  reg,
  onCommit,
  disabled,
}: {
  zoneType: string
  reg: ZoneRegulation | undefined
  onCommit: (patch: Partial<Omit<ZoneRegulation, 'id' | 'project_id' | 'zone_type' | 'created_at' | 'updated_at'>>) => void
  disabled: boolean
}) {
  const fields: { key: keyof ZoneRegulation; label: string; integer?: boolean; placeholder: string }[] = [
    { key: 'az',            label: 'AZ',    placeholder: '0.500' },
    { key: 'bmz',           label: 'BMZ',   placeholder: '0.000' },
    { key: 'uez',           label: 'ÜZ',    placeholder: '0.000' },
    { key: 'ffz',           label: 'FFZ',   placeholder: '0.000' },
    { key: 'vollgeschosse', label: 'VG',    placeholder: '3',   integer: true },
    { key: 'anrech_ug',     label: 'UG',    placeholder: '1',   integer: true },
    { key: 'anrech_ug_pct', label: 'UG %',  placeholder: '50',  integer: true },
    { key: 'dg',            label: 'DG',    placeholder: '0',   integer: true },
    { key: 'dg_pct',        label: 'DG %',  placeholder: '100', integer: true },
  ]

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
        <span className="text-xs font-medium text-slate-500">Zone</span>
        <span className="rounded-md bg-[#E4EBF3] px-2 py-0.5 text-sm font-bold text-[#8B6956]">
          {zoneType}
        </span>
      </div>
      <div className="grid grid-cols-2 divide-x divide-slate-100">
        {/* Linke Hälfte: 3×3-Grid mit Eckwerten */}
        <div className="divide-y divide-slate-100">
          {[fields.slice(0, 3), fields.slice(3, 6), fields.slice(6, 9)].map((row, i) => (
            <div key={i} className="grid grid-cols-3 gap-x-4 px-4 py-2.5">
              {row.map(({ key, label, integer, placeholder }) => (
                <label key={key} className="flex items-center gap-2">
                  <span className="w-10 shrink-0 text-sm text-slate-600 whitespace-nowrap">{label}</span>
                  <NumCell
                    value={(reg?.[key] as number | null | undefined) ?? null}
                    integer={integer}
                    placeholder={placeholder}
                    disabled={disabled}
                    onCommit={(v) => onCommit({ [key]: v } as Partial<ZoneRegulation>)}
                  />
                </label>
              ))}
            </div>
          ))}
        </div>

        {/* Rechte Hälfte: Bemerkungen */}
        <div className="flex flex-col px-4 py-2.5">
          <span className="mb-1.5 text-sm text-slate-600">Bemerkungen</span>
          <NotesCell
            value={reg?.notes ?? null}
            disabled={disabled}
            onCommit={(v) => onCommit({ notes: v })}
          />
        </div>
      </div>
    </div>
  )
}

function NotesCell({
  value, disabled, onCommit,
}: {
  value: string | null
  disabled: boolean
  onCommit: (v: string | null) => void
}) {
  const [raw, setRaw] = useState(value ?? '')
  useEffect(() => { setRaw(value ?? '') }, [value])

  function commit() {
    const trimmed = raw.trim()
    onCommit(trimmed === '' ? null : trimmed)
  }
  return (
    <textarea
      className="flex-1 resize-none rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none transition focus:border-[#8B6956] focus:ring-1 focus:ring-[#8B6956]/30 disabled:opacity-50"
      placeholder="z.B. Sondernutzungsvorschriften, Auflagen, Quellen…"
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={commit}
      disabled={disabled}
      rows={4}
    />
  )
}

function NumCell({
  value, integer, placeholder, disabled, onCommit,
}: {
  value: number | null
  integer?: boolean
  placeholder: string
  disabled: boolean
  onCommit: (v: number | null) => void
}) {
  const [raw, setRaw] = useState(value != null ? String(value) : '')
  useEffect(() => { setRaw(value != null ? String(value) : '') }, [value])

  function commit() {
    if (raw.trim() === '') { onCommit(null); return }
    const parsed = parseFloat(raw.replace(',', '.'))
    onCommit(isNaN(parsed) ? null : parsed)
  }
  return (
    <input
      type="number"
      step={integer ? 1 : 'any'}
      min={0}
      placeholder={placeholder}
      className={cn(inputClass, 'w-20')}
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      disabled={disabled}
    />
  )
}

// ─── Hauptkomponente ──────────────────────────────────────────────────────

export function AusnutzungTab({ projectId }: { projectId: string }) {
  const { canWrite } = useAuth()
  const { parcels, loading: parcelsLoading } = useParcels(projectId)
  const { regs, loading: regsLoading, error: regsError, upsertRegulation } = useZoneRegulations(projectId)

  const [project, setProject] = useState<Project | null>(null)
  const [savingField, setSavingField] = useState<string | null>(null)
  const [zonesExpanded, setZonesExpanded] = useState(true)

  useEffect(() => {
    fetchProject(projectId).then(setProject)
  }, [projectId])

  // ── Project-Felder (VMF-Inputs) per Auto-Save ────────────────────────
  async function saveProjectField(key: keyof Project, value: number | string | null) {
    setSavingField(key as string)
    const { data, error } = await supabase
      .from('projects')
      .update({ [key]: value })
      .eq('id', projectId)
      .select()
      .single()
    setSavingField(null)
    if (!error && data) setProject(data as Project)
  }

  // ── Eindeutige Zonen aus Parzellen ───────────────────────────────────
  // Die ganze Rechnung steht als reine Funktion in lib/ausnutzung — der
  // Bericht zeigt damit garantiert dieselben Zahlen wie dieser Reiter.
  const {
    uniqueZones, regByZone, gsf, agsf, uebertrag, totalAgsf,
    hasAZ, hasBM, hasUZ, hasFF,
    azRows, azPerFloorRows, resultAZwithUG, vmfMaxAZ,
    bmRows, totalBaumasse, korrigierteBaumasse, geschossflaecheBM, vmfMaxBM,
    uzZoneRows, totalGfUZ, vmfMaxUZ,
    ffZoneRows, totalGfFF, vmfMaxFF,
    vmfMaxCalc,
  } = useMemo(() => berechneAusnutzung(parcels, regs, project), [parcels, regs, project])
  const minVal = vmfMaxCalc

  if (parcelsLoading || regsLoading || !project) {
    return (
      <div className="flex h-32 items-center justify-center text-slate-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Daten werden geladen…
      </div>
    )
  }

  if (uniqueZones.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
        Bitte zuerst im Tab „Parzellen" Bauzonen erfassen, damit die Ausnutzung
        berechnet werden kann.
      </div>
    )
  }

  return (
    <div className="space-y-4">

      {regsError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Speichern fehlgeschlagen: {regsError}
        </div>
      )}

      {/* Kenngrößen */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-2.5">
          <h3 className="text-sm font-semibold text-slate-700">Kenngrössen</h3>
        </div>
        <div className="divide-y divide-slate-100">
          <KennRow label="GSF (Grundstücksfläche)" value={fmt(gsf)} />
          <KennRow label="aGSF (anrechenbare GSF)" value={fmt(agsf)} />
          <div className="flex items-center px-5 py-2">
            <span className="flex-1 text-sm text-slate-600">Ausnützungsübertragung</span>
            <InlineNum
              value={uebertrag}
              onChange={(v) => saveProjectField('vmf_ausnuetzungsuebertragung_m2', v)}
              saving={savingField === 'vmf_ausnuetzungsuebertragung_m2'}
            />
            <span className="ml-1 w-8 text-right text-sm text-slate-400">m²</span>
          </div>
          <KennRow label="Total aGSF" value={fmt(totalAgsf)} bold />
        </div>
      </div>

      {/* Zonen-Eckwerte */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setZonesExpanded(!zonesExpanded)}
            className="flex items-center gap-2 text-sm font-semibold text-slate-700 transition hover:text-[#8B6956]"
          >
            {zonesExpanded
              ? <ChevronDown className="h-4 w-4 text-slate-400" />
              : <ChevronRight className="h-4 w-4 text-slate-400" />}
            <Layers className="h-4 w-4 text-slate-400" />
            <span>Zonen-Eckwerte</span>
          </button>
          {zonesExpanded && (
            <p className="text-xs text-slate-400">Werte werden beim Verlassen des Felds gespeichert</p>
          )}
        </div>
        {zonesExpanded && (
          <div className="space-y-2">
            {uniqueZones.map((zone) => (
              <ZoneRegCard
                key={zone}
                zoneType={zone}
                reg={regByZone.get(zone)}
                disabled={!canWrite}
                onCommit={(patch) => upsertRegulation(zone, patch)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Berechnungskacheln */}
      {(hasAZ || hasBM || hasUZ || hasFF) ? (
        <div className="grid grid-cols-2 gap-3">
          {hasAZ && (
            <Tile
              title="Ausnutzungsziffer"
              subtitle="Σ (AZ × aGSF) pro Parzelle"
              result={resultAZwithUG}
              resultLabel="Total aBGF"
              resultNeutral
              isMin={vmfMaxAZ != null && vmfMaxAZ === minVal}
              footer={
                <div className="space-y-1 border-t border-slate-100 pt-2">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Verhältnis VMF / aBGF</span>
                    <div className="flex items-center gap-1">
                      <InlineNum
                        value={project.vmf_az_anrechenbar_pct}
                        onChange={(v) => saveProjectField('vmf_az_anrechenbar_pct', v)}
                        saving={savingField === 'vmf_az_anrechenbar_pct'}
                      />
                      <span className="text-slate-400">%</span>
                    </div>
                  </div>
                  <ResultBar label="VMF max." value={vmfMaxAZ} />
                </div>
              }
            >
              {/* Parzelle/Zone × AZ × aGSF = aGF */}
              <div className="overflow-hidden rounded-lg border border-slate-100">
                <div style={{ gridTemplateColumns: '1fr 2rem 4rem 4rem 4rem' }} className="grid gap-x-2 border-b border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-400">
                  <span>Parzelle / Zone</span>
                  <span className="text-right">AZ</span>
                  <span className="text-right">aGSF</span>
                  <span className="col-span-2 text-right">= aGF</span>
                </div>
                {azRows.map((r, i) => (
                  <div key={i} style={{ gridTemplateColumns: '1fr 2rem 4rem 4rem 4rem' }} className="grid gap-x-2 border-t border-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                    <span className="truncate">{r.parcel_number} <span className="text-slate-400">{r.zone_type}</span></span>
                    <span className="text-right tabular-nums">{r.az != null ? fmtDec(r.az) : <span className="text-slate-300">–</span>}</span>
                    <span className="text-right tabular-nums">{r.agsf != null ? fmt(r.agsf) : <span className="text-slate-300">–</span>}</span>
                    <span className="col-span-2 text-right tabular-nums font-medium">
                      {r.contribution != null ? <>{fmt(r.contribution)} <span className="text-slate-400">m²</span></> : <span className="text-slate-300">–</span>}
                    </span>
                  </div>
                ))}
              </div>

              {/* aBGF pro Vollgeschoss pro Zone */}
              {azPerFloorRows.some((r) => r.abgfPerFloor != null) && (
                <div className="overflow-hidden rounded-lg border border-slate-100">
                  <div style={{ gridTemplateColumns: '1fr 2.5rem 4rem 4rem' }} className="grid gap-x-2 border-b border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-400">
                    <span>Zone</span>
                    <span className="text-right">VG</span>
                    <span className="col-span-2 text-right">aBGF / VG</span>
                  </div>
                  {azPerFloorRows.map((r, i) => (
                    <div key={i} style={{ gridTemplateColumns: '1fr 2.5rem 4rem 4rem' }} className="grid gap-x-2 border-t border-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                      <span>{r.zone_type}</span>
                      <span className="text-right tabular-nums">{r.vg ?? <span className="text-slate-300">–</span>}</span>
                      <span className="col-span-2 text-right tabular-nums font-medium">
                        {r.abgfPerFloor != null ? <>{fmt(r.abgfPerFloor)} <span className="text-slate-400">m²</span></> : <span className="text-slate-300">–</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* aBGF UG */}
              {azPerFloorRows.some((r) => r.abgfUG != null) && (
                <div className="overflow-hidden rounded-lg border border-slate-100">
                  <div style={{ gridTemplateColumns: '1fr 2rem 2.5rem 4rem 4rem' }} className="grid gap-x-2 border-b border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-400">
                    <span>Zone</span>
                    <span className="text-right">UG</span>
                    <span className="text-right">%</span>
                    <span className="col-span-2 text-right">aBGF UG</span>
                  </div>
                  {azPerFloorRows.map((r, i) => (
                    <div key={i} style={{ gridTemplateColumns: '1fr 2rem 2.5rem 4rem 4rem' }} className="grid gap-x-2 border-t border-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                      <span>{r.zone_type}</span>
                      <span className="text-right tabular-nums">{r.ugFlr ?? <span className="text-slate-300">–</span>}</span>
                      <span className="text-right tabular-nums">{r.ugPct != null ? `${r.ugPct}%` : <span className="text-slate-300">–</span>}</span>
                      <span className="col-span-2 text-right tabular-nums font-medium">
                        {r.abgfUG != null ? <>{fmt(r.abgfUG)} <span className="text-slate-400">m²</span></> : <span className="text-slate-300">–</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* aBGF DG */}
              {azPerFloorRows.some((r) => r.abgfDG != null) && (
                <div className="overflow-hidden rounded-lg border border-slate-100">
                  <div style={{ gridTemplateColumns: '1fr 2rem 2.5rem 4rem 4rem' }} className="grid gap-x-2 border-b border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-400">
                    <span>Zone</span>
                    <span className="text-right">DG</span>
                    <span className="text-right">%</span>
                    <span className="col-span-2 text-right">aBGF DG</span>
                  </div>
                  {azPerFloorRows.map((r, i) => (
                    <div key={i} style={{ gridTemplateColumns: '1fr 2rem 2.5rem 4rem 4rem' }} className="grid gap-x-2 border-t border-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                      <span>{r.zone_type}</span>
                      <span className="text-right tabular-nums">{r.dgFlr ?? <span className="text-slate-300">–</span>}</span>
                      <span className="text-right tabular-nums">{r.dgPct != null ? `${r.dgPct}%` : <span className="text-slate-300">–</span>}</span>
                      <span className="col-span-2 text-right tabular-nums font-medium">
                        {r.abgfDG != null ? <>{fmt(r.abgfDG)} <span className="text-slate-400">m²</span></> : <span className="text-slate-300">–</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Tile>
          )}

          {hasBM && (
            <Tile
              title="Baumassenziffer"
              subtitle="Σ (BMZ × aGSF) ÷ Ø Geschosshöhe"
              result={geschossflaecheBM}
              resultLabel="Geschossfläche"
              resultNeutral
              isMin={vmfMaxBM != null && vmfMaxBM === minVal}
              footer={
                <div className="space-y-1 border-t border-slate-100 pt-2">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Verhältnis VMF / GF</span>
                    <div className="flex items-center gap-1">
                      <InlineNum
                        value={project.vmf_bm_vmf_gf_pct}
                        onChange={(v) => saveProjectField('vmf_bm_vmf_gf_pct', v)}
                        saving={savingField === 'vmf_bm_vmf_gf_pct'}
                      />
                      <span className="text-slate-400">%</span>
                    </div>
                  </div>
                  <ResultBar label="VMF max." value={vmfMaxBM} />
                </div>
              }
            >
              <div className="overflow-hidden rounded-lg border border-slate-100">
                <div style={{ gridTemplateColumns: '1fr 2rem 4rem 4rem 4rem' }} className="grid gap-x-2 border-b border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-400">
                  <span>Parzelle / Zone</span>
                  <span className="text-right">BMZ</span>
                  <span className="text-right">aGSF</span>
                  <span className="col-span-2 text-right">= m³</span>
                </div>
                {bmRows.map((r, i) => (
                  <div key={i} style={{ gridTemplateColumns: '1fr 2rem 4rem 4rem 4rem' }} className="grid gap-x-2 border-t border-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                    <span className="truncate">{r.parcel_number} <span className="text-slate-400">{r.zone_type}</span></span>
                    <span className="text-right tabular-nums">{r.bmz != null ? fmtDec(r.bmz) : <span className="text-slate-300">–</span>}</span>
                    <span className="text-right tabular-nums">{r.agsf != null ? fmt(r.agsf) : <span className="text-slate-300">–</span>}</span>
                    <span className="col-span-2 text-right tabular-nums font-medium">
                      {r.baumasse != null ? <>{fmt(r.baumasse)} <span className="text-slate-400">m³</span></> : <span className="text-slate-300">–</span>}
                    </span>
                  </div>
                ))}
                {totalBaumasse != null && (
                  <div style={{ gridTemplateColumns: '1fr 2rem 4rem 4rem 4rem' }} className="grid gap-x-2 border-t border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700">
                    <span className="col-span-3">Total Baumasse</span>
                    <span className="col-span-2 text-right tabular-nums">{fmt(totalBaumasse)} <span className="font-normal text-slate-400">m³</span></span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-slate-100 px-2.5 py-1.5 text-xs text-slate-500">
                  <span>Korrektur Geländeverlauf</span>
                  <div className="flex items-center gap-1">
                    <InlineNum
                      value={project.vmf_bm_gelaendekorrektur_pct}
                      onChange={(v) => saveProjectField('vmf_bm_gelaendekorrektur_pct', v)}
                      saving={savingField === 'vmf_bm_gelaendekorrektur_pct'}
                    />
                    <span className="text-slate-400">%</span>
                  </div>
                </div>
                {korrigierteBaumasse != null && project.vmf_bm_gelaendekorrektur_pct != null && (
                  <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700">
                    <span>Zur Verfügung stehende Baumasse</span>
                    <span className="tabular-nums">{fmt(korrigierteBaumasse)} <span className="font-normal text-slate-400">m³</span></span>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Ø Geschosshöhe</span>
                <div className="flex items-center gap-1">
                  <InlineNum
                    value={project.vmf_bm_geschosshoehe_m}
                    onChange={(v) => saveProjectField('vmf_bm_geschosshoehe_m', v)}
                    saving={savingField === 'vmf_bm_geschosshoehe_m'}
                  />
                  <span className="text-slate-400">m</span>
                </div>
              </div>
            </Tile>
          )}

          {hasUZ && (
            <Tile
              title="Überbauungsziffer"
              subtitle="aGSF × ÜZ × VG (+DG) × % VMF/GF"
              result={totalGfUZ}
              resultLabel="Total GF"
              resultNeutral
              isMin={vmfMaxUZ != null && vmfMaxUZ === minVal}
              footer={
                <div className="space-y-1 border-t border-slate-100 pt-2">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Verhältnis VMF / GF</span>
                    <div className="flex items-center gap-1">
                      <InlineNum
                        value={project.vmf_uz_vmf_gf_pct}
                        onChange={(v) => saveProjectField('vmf_uz_vmf_gf_pct', v)}
                        saving={savingField === 'vmf_uz_vmf_gf_pct'}
                      />
                      <span className="text-slate-400">%</span>
                    </div>
                  </div>
                  <ResultBar label="VMF max." value={vmfMaxUZ} />
                </div>
              }
            >
              <div className="overflow-hidden rounded-lg border border-slate-100">
                <div style={{ gridTemplateColumns: '1fr 2rem 4rem 3rem 4rem 4rem' }} className="grid gap-x-2 border-b border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-400">
                  <span>Zone</span>
                  <span className="text-right">ÜZ</span>
                  <span className="text-right">aGSF</span>
                  <span className="text-right">VG</span>
                  <span className="text-right">max.GF/VG</span>
                  <span className="text-right">GF VG</span>
                </div>
                {uzZoneRows.map((r, i) => (
                  <div key={i} style={{ gridTemplateColumns: '1fr 2rem 4rem 3rem 4rem 4rem' }} className="grid gap-x-2 border-t border-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                    <span>{r.zone_type}</span>
                    <span className="text-right tabular-nums">{r.ziffer != null ? fmtDec(r.ziffer) : <span className="text-slate-300">–</span>}</span>
                    <span className="text-right tabular-nums">{r.agsf != null ? fmt(r.agsf) : <span className="text-slate-300">–</span>}</span>
                    <span className="text-right tabular-nums">{r.vg ?? <span className="text-slate-300">–</span>}</span>
                    <span className="text-right tabular-nums">{r.maxGfVg != null ? fmt(r.maxGfVg) : <span className="text-slate-300">–</span>}</span>
                    <span className="text-right tabular-nums font-medium">{r.gfVg != null ? <>{fmt(r.gfVg)} <span className="text-slate-400 font-normal">m²</span></> : <span className="text-slate-300">–</span>}</span>
                  </div>
                ))}
              </div>
              {uzZoneRows.some((r) => r.dg != null) && (
                <div className="overflow-hidden rounded-lg border border-slate-100">
                  <div style={{ gridTemplateColumns: '1fr 2rem 2.5rem 4rem 4rem' }} className="grid gap-x-2 border-b border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-400">
                    <span>Zone</span>
                    <span className="text-right">DG</span>
                    <span className="text-right">%</span>
                    <span className="col-span-2 text-right">GF DG</span>
                  </div>
                  {uzZoneRows.map((r, i) => (
                    <div key={i} style={{ gridTemplateColumns: '1fr 2rem 2.5rem 4rem 4rem' }} className="grid gap-x-2 border-t border-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                      <span>{r.zone_type}</span>
                      <span className="text-right tabular-nums">{r.dg ?? <span className="text-slate-300">–</span>}</span>
                      <span className="text-right tabular-nums">{r.dgPct != null ? `${r.dgPct}%` : <span className="text-slate-300">–</span>}</span>
                      <span className="col-span-2 text-right tabular-nums font-medium">{r.gfDg != null ? <>{fmt(r.gfDg)} <span className="text-slate-400 font-normal">m²</span></> : <span className="text-slate-300">–</span>}</span>
                    </div>
                  ))}
                </div>
              )}
            </Tile>
          )}

          {hasFF && (
            <Tile
              title="Freiflächenziffer"
              subtitle="(1 − FFZ) × aGSF × VG (+DG) × % VMF/GF"
              result={totalGfFF}
              resultLabel="Total GF"
              resultNeutral
              isMin={vmfMaxFF != null && vmfMaxFF === minVal}
              footer={
                <div className="space-y-1 border-t border-slate-100 pt-2">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Verhältnis VMF / GF</span>
                    <div className="flex items-center gap-1">
                      <InlineNum
                        value={project.vmf_ff_vmf_gf_pct}
                        onChange={(v) => saveProjectField('vmf_ff_vmf_gf_pct', v)}
                        saving={savingField === 'vmf_ff_vmf_gf_pct'}
                      />
                      <span className="text-slate-400">%</span>
                    </div>
                  </div>
                  <ResultBar label="VMF max." value={vmfMaxFF} />
                </div>
              }
            >
              <div className="overflow-hidden rounded-lg border border-slate-100">
                <div style={{ gridTemplateColumns: '1fr 2rem 4rem 3rem 4rem 4rem' }} className="grid gap-x-2 border-b border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-400">
                  <span>Zone</span>
                  <span className="text-right">FFZ</span>
                  <span className="text-right">aGSF</span>
                  <span className="text-right">VG</span>
                  <span className="text-right">max.GF/VG</span>
                  <span className="text-right">GF VG</span>
                </div>
                {ffZoneRows.map((r, i) => (
                  <div key={i} style={{ gridTemplateColumns: '1fr 2rem 4rem 3rem 4rem 4rem' }} className="grid gap-x-2 border-t border-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                    <span>{r.zone_type}</span>
                    <span className="text-right tabular-nums">{r.ziffer != null ? fmtDec(r.ziffer) : <span className="text-slate-300">–</span>}</span>
                    <span className="text-right tabular-nums">{r.agsf != null ? fmt(r.agsf) : <span className="text-slate-300">–</span>}</span>
                    <span className="text-right tabular-nums">{r.vg ?? <span className="text-slate-300">–</span>}</span>
                    <span className="text-right tabular-nums">{r.maxGfVg != null ? fmt(r.maxGfVg) : <span className="text-slate-300">–</span>}</span>
                    <span className="text-right tabular-nums font-medium">{r.gfVg != null ? <>{fmt(r.gfVg)} <span className="text-slate-400 font-normal">m²</span></> : <span className="text-slate-300">–</span>}</span>
                  </div>
                ))}
              </div>
              {ffZoneRows.some((r) => r.dg != null) && (
                <div className="overflow-hidden rounded-lg border border-slate-100">
                  <div style={{ gridTemplateColumns: '1fr 2rem 2.5rem 4rem 4rem' }} className="grid gap-x-2 border-b border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-400">
                    <span>Zone</span>
                    <span className="text-right">DG</span>
                    <span className="text-right">%</span>
                    <span className="col-span-2 text-right">GF DG</span>
                  </div>
                  {ffZoneRows.map((r, i) => (
                    <div key={i} style={{ gridTemplateColumns: '1fr 2rem 2.5rem 4rem 4rem' }} className="grid gap-x-2 border-t border-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                      <span>{r.zone_type}</span>
                      <span className="text-right tabular-nums">{r.dg ?? <span className="text-slate-300">–</span>}</span>
                      <span className="text-right tabular-nums">{r.dgPct != null ? `${r.dgPct}%` : <span className="text-slate-300">–</span>}</span>
                      <span className="col-span-2 text-right tabular-nums font-medium">{r.gfDg != null ? <>{fmt(r.gfDg)} <span className="text-slate-400 font-normal">m²</span></> : <span className="text-slate-300">–</span>}</span>
                    </div>
                  ))}
                </div>
              )}
            </Tile>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
          Erfassen Sie pro Zone mindestens eine Berechnungsgrösse (AZ, BMZ, ÜZ oder FFZ).
        </div>
      )}

      {/* Resultat */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-2.5">
          <h3 className="text-sm font-semibold text-slate-700">Resultat</h3>
        </div>
        <div className="px-5 py-3">
          <div className="flex items-center">
            <span className="flex-1 text-sm text-slate-600">VMF Max (Minimum aller Methoden)</span>
            <span className={cn(
              'w-28 text-right tabular-nums text-base font-semibold',
              vmfMaxCalc != null ? 'text-[#8B6956]' : 'text-slate-400',
            )}>
              {fmt(vmfMaxCalc)}
            </span>
            <span className="w-8 text-right text-sm text-slate-400">m²</span>
          </div>
        </div>
      </div>

      {/* Bemerkungen — was die Zahlen nicht hergeben: Sonderbauvorschriften,
          Gestaltungsplan, Absprachen. Erscheint so auch im Bericht. */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-2.5">
          <h3 className="text-sm font-semibold text-slate-700">Bemerkungen</h3>
        </div>
        <div className="px-5 py-3">
          <textarea
            key={project.id}
            defaultValue={project.ausnutzung_bemerkungen ?? ''}
            disabled={!canWrite}
            rows={3}
            placeholder="Sonderbauvorschriften, Gestaltungsplan, Absprachen mit der Gemeinde …"
            onBlur={(e) => {
              const wert = e.target.value.trim() || null
              if (wert !== (project.ausnutzung_bemerkungen ?? null)) {
                void saveProjectField('ausnutzung_bemerkungen', wert)
              }
            }}
            className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#8B6956] focus:ring-2 focus:ring-[#8B6956]/20 disabled:opacity-60"
          />
          {savingField === 'ausnutzung_bemerkungen' && (
            <p className="mt-1 text-xs text-slate-400">Wird gespeichert…</p>
          )}
        </div>
      </div>

    </div>
  )
}

// ─── Hilfs-Bausteine ──────────────────────────────────────────────────────

function KennRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={cn('flex items-center px-5 py-2', bold && 'border-t border-slate-200 bg-slate-50/60')}>
      <span className={cn('flex-1 text-sm', bold ? 'font-medium text-slate-700' : 'text-slate-600')}>{label}</span>
      <span className="w-24 text-right tabular-nums text-sm font-semibold text-slate-900">{value}</span>
      <span className="w-8 text-right text-sm text-slate-400">m²</span>
    </div>
  )
}

function ResultBar({ label, value }: { label: string; value: number | null }) {
  return (
    <div
      className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold text-white"
      style={{ backgroundColor: '#4B5563' }}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value != null ? `${fmt(value)} m²` : '–'}</span>
    </div>
  )
}
