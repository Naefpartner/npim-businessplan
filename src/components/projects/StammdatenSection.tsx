import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Loader2, AlertCircle, Plus, Pencil, Trash2, Save, Copy,
  Database, Building2, Calculator, KeyRound, ChevronDown, ChevronRight,
  Users, Check, AlertTriangle,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useParcels, useExistingBuildings, useExistingBuildingOwners,
  type ParcelInput, type ExistingBuildingInput,
} from '@/hooks/useStammdaten'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  BUILDING_CONDITION_LABEL,
  type BuildingCondition,
  type ExistingBuilding,
  type Parcel,
} from '@/types'
import { cn, formatNumber, formatCurrency } from '@/lib/utils'
import { AusnutzungTab } from '@/components/projects/AusnutzungTab'

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[#8B6956] focus:ring-2 focus:ring-[#8B6956]/20 disabled:opacity-50'

type Tab = 'parzellen' | 'bestand' | 'ausnutzung'

const TAB_DEF: { key: Tab; label: string; icon: typeof Database }[] = [
  { key: 'parzellen',  label: 'Parzellen',       icon: Database },
  { key: 'bestand',    label: 'Bestandsgebäude', icon: Building2 },
  { key: 'ausnutzung', label: 'Ausnutzung',      icon: Calculator },
]

export function StammdatenSection({ projectId, defaultExpanded = false }: { projectId: string; defaultExpanded?: boolean }) {
  const [tab, setTab] = useState<Tab>('parzellen')
  const [expanded, setExpanded] = useState(defaultExpanded)

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
        <Database className="h-4 w-4 text-slate-700" />
        <span>Stammdaten</span>
        {!expanded && (
          <span className="ml-2 flex items-center gap-1 text-xs font-normal text-slate-700">
            {TAB_DEF.map(({ key, label }, i) => (
              <span key={key} className="flex items-center gap-1">
                {i > 0 && <span className="text-slate-400">·</span>}
                <span>{label}</span>
              </span>
            ))}
          </span>
        )}
      </button>

      {expanded && (
        <>
          <nav className="-mb-px flex gap-6 border-b border-slate-200 px-5" aria-label="Stammdaten-Bereich">
            {TAB_DEF.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  'flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition',
                  tab === key
                    ? 'border-[#8B6956] text-[#8B6956]'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>

          <div className="p-5">
            {tab === 'parzellen'  && <ParzellenTab projectId={projectId} />}
            {tab === 'bestand'    && <BestandsgebaeudeTab projectId={projectId} />}
            {tab === 'ausnutzung' && <AusnutzungTab projectId={projectId} />}
          </div>
        </>
      )}
    </section>
  )
}

// ─── Parzellen-Tab ─────────────────────────────────────────────────────────

export function ParzellenTab({ projectId }: { projectId: string }) {
  const { canWrite } = useAuth()
  const { parcels, loading, error, createParcel, updateParcel, deleteParcel } = useParcels(projectId)
  const [editTarget, setEditTarget] = useState<Parcel | null>(null)
  const [duplicateSource, setDuplicateSource] = useState<Parcel | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const totalGSF  = parcels.reduce((sum, p) => sum + (p.flaeche_m2 ?? 0), 0)
  const totalAGSF = parcels.reduce((sum, p) => sum + (p.agsf_m2 ?? 0), 0)

  // Beim Duplizieren startet der Dialog mit den Werten der Quell-Parzelle und
  // einem "(Kopie)"-Suffix in der Nummer; gespeichert wird via createParcel.
  const duplicateInitial = useMemo<Parcel | undefined>(
    () => duplicateSource
      ? { ...duplicateSource, parzelle_nummer: `${duplicateSource.parzelle_nummer} (Kopie)` }
      : undefined,
    [duplicateSource],
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {parcels.length === 0
            ? 'Noch keine Parzelle erfasst.'
            : <>Insgesamt <strong>{parcels.length}</strong> Parzelle{parcels.length === 1 ? '' : 'n'}.</>}
        </p>
        {canWrite && (
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="bg-[#F2D3C2] text-slate-900 hover:bg-[#E7AF90]"
          >
            <Plus className="h-4 w-4" /> Neue Parzelle
          </Button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Wird geladen…
        </div>
      ) : parcels.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
          Hier erscheinen die zum Projekt gehörenden Parzellen.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Nr.</th>
                <th className="px-4 py-3 text-left font-medium">Gemeinde / Kanton</th>
                <th className="px-4 py-3 text-right font-medium">GSF (m²)</th>
                <th className="px-4 py-3 text-right font-medium">aGSF (m²)</th>
                <th className="px-4 py-3 text-left font-medium">Zone</th>
                <th className="px-4 py-3 text-left font-medium">Eigentümer</th>
                <th className="px-4 py-3 text-right font-medium">Erwerbspreis</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {parcels.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{p.parzelle_nummer}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {[p.gemeinde, p.kanton].filter(Boolean).join(' / ') || '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700 tabular-nums">
                    {p.flaeche_m2 != null ? formatNumber(p.flaeche_m2) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700 tabular-nums">
                    {p.agsf_m2 != null ? formatNumber(p.agsf_m2) : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{p.zone ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-700">
                    <div className="flex items-center gap-1.5">
                      <span>{p.eigentuemer ?? '—'}</span>
                      {p.has_building_right && (
                        <span
                          title={
                            p.building_right_fee_chf_pa != null
                              ? `Baurecht – Zins ${formatCurrency(p.building_right_fee_chf_pa)} p.a.`
                              : 'Baurecht vorhanden'
                          }
                          className="inline-flex"
                        >
                          <KeyRound className="h-3.5 w-3.5 text-amber-600" aria-label="Baurecht vorhanden" />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700 tabular-nums">
                    {p.erwerbspreis_chf != null ? formatCurrency(p.erwerbspreis_chf) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canWrite && (
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditTarget(p)} title="Bearbeiten">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDuplicateSource(p)}
                          title="Duplizieren"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm(`Parzelle ${p.parzelle_nummer} löschen?`)) deleteParcel(p.id)
                          }}
                          title="Löschen"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 text-sm font-medium text-slate-700">
              <tr>
                <td className="px-4 py-3" colSpan={2}>Total</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatNumber(totalGSF)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatNumber(totalAGSF)}</td>
                <td className="px-4 py-3" colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <ParzelleDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Neue Parzelle"
        onSubmit={async (input) => !!(await createParcel(input))}
      />
      <ParzelleDialog
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={editTarget ? `Parzelle ${editTarget.parzelle_nummer} bearbeiten` : ''}
        initial={editTarget ?? undefined}
        onSubmit={async (input) => {
          if (!editTarget) return false
          return updateParcel(editTarget.id, input)
        }}
      />
      <ParzelleDialog
        open={!!duplicateSource}
        onClose={() => setDuplicateSource(null)}
        title={duplicateSource ? `Parzelle ${duplicateSource.parzelle_nummer} duplizieren` : ''}
        initial={duplicateInitial}
        onSubmit={async (input) => !!(await createParcel(input))}
      />
    </div>
  )
}

// ─── Parzelle anlegen/bearbeiten ───────────────────────────────────────────

function ParzelleDialog({
  open,
  onClose,
  title,
  initial,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  title: string
  initial?: Parcel
  onSubmit: (input: ParcelInput) => Promise<boolean>
}) {
  const [parzelleNummer, setParzelleNummer] = useState('')
  const [gemeinde, setGemeinde]             = useState('')
  const [kanton, setKanton]                 = useState('')
  const [flaeche, setFlaeche]               = useState('')
  const [agsf, setAgsf]                     = useState('')
  const [zone, setZone]                     = useState('')
  const [eigentuemer, setEigentuemer]       = useState('')
  const [erwerbsdatum, setErwerbsdatum]     = useState('')
  const [erwerbspreis, setErwerbspreis]     = useState('')
  const [hasBaurecht, setHasBaurecht]       = useState(false)
  const [zinsPa, setZinsPa]                 = useState('')
  const [ablauf, setAblauf]                 = useState('')
  const [notizen, setNotizen]               = useState('')
  const [submitting, setSubmitting]         = useState(false)
  const [error, setError]                   = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setParzelleNummer(initial?.parzelle_nummer ?? '')
      setGemeinde(initial?.gemeinde ?? '')
      setKanton(initial?.kanton ?? '')
      setFlaeche(initial?.flaeche_m2?.toString() ?? '')
      setAgsf(initial?.agsf_m2?.toString() ?? '')
      setZone(initial?.zone ?? '')
      setEigentuemer(initial?.eigentuemer ?? '')
      setErwerbsdatum(initial?.erwerbsdatum ?? '')
      setErwerbspreis(initial?.erwerbspreis_chf?.toString() ?? '')
      setHasBaurecht(initial?.has_building_right ?? false)
      setZinsPa(initial?.building_right_fee_chf_pa?.toString() ?? '')
      setAblauf(initial?.building_right_expiry ?? '')
      setNotizen(initial?.notizen ?? '')
      setError(null)
    }
  }, [open, initial])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!parzelleNummer.trim()) {
      setError('Bitte eine Parzellen-Nummer eingeben.')
      return
    }
    setError(null); setSubmitting(true)

    const input: ParcelInput = {
      parzelle_nummer:           parzelleNummer.trim(),
      gemeinde:                  gemeinde.trim() || null,
      kanton:                    kanton.trim() || null,
      flaeche_m2:                flaeche !== '' ? Number(flaeche) : null,
      agsf_m2:                   agsf !== '' ? Number(agsf) : null,
      zone:                      zone.trim() || null,
      eigentuemer:               eigentuemer.trim() || null,
      erwerbsdatum:              erwerbsdatum || null,
      erwerbspreis_chf:          erwerbspreis !== '' ? Number(erwerbspreis) : null,
      has_building_right:        hasBaurecht,
      building_right_fee_chf_pa: hasBaurecht && zinsPa !== '' ? Number(zinsPa) : null,
      building_right_expiry:     hasBaurecht && ablauf ? ablauf : null,
      notizen:                   notizen.trim() || null,
    }

    const ok = await onSubmit(input)
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
            <Field label="Parzellen-Nr." required>
              <input
                className={inputClass}
                value={parzelleNummer}
                onChange={(e) => setParzelleNummer(e.target.value)}
                disabled={submitting}
                placeholder="z.B. 1234"
              />
            </Field>
            <Field label="Zone">
              <input
                className={inputClass}
                value={zone}
                onChange={(e) => setZone(e.target.value)}
                disabled={submitting}
                placeholder="z.B. W3"
              />
            </Field>
            <Field label="Gemeinde">
              <input
                className={inputClass}
                value={gemeinde}
                onChange={(e) => setGemeinde(e.target.value)}
                disabled={submitting}
              />
            </Field>
            <Field label="Kanton">
              <input
                className={inputClass}
                value={kanton}
                onChange={(e) => setKanton(e.target.value)}
                disabled={submitting}
                placeholder="z.B. ZH"
                maxLength={2}
              />
            </Field>
            <Field label="GSF (m²)" hint="Grundstücksfläche">
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                className={inputClass}
                value={flaeche}
                onChange={(e) => setFlaeche(e.target.value)}
                disabled={submitting}
              />
            </Field>
            <Field label="aGSF (m²)" hint="anrechenbare Grundstücksfläche">
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                className={inputClass}
                value={agsf}
                onChange={(e) => setAgsf(e.target.value)}
                disabled={submitting}
              />
            </Field>
            <Field label="Eigentümer">
              <input
                className={inputClass}
                value={eigentuemer}
                onChange={(e) => setEigentuemer(e.target.value)}
                disabled={submitting}
              />
            </Field>
            <Field label="Erwerbsdatum">
              <input
                type="date"
                className={inputClass}
                value={erwerbsdatum}
                onChange={(e) => setErwerbsdatum(e.target.value)}
                disabled={submitting}
              />
            </Field>
            <Field label="Erwerbspreis (CHF)">
              <input
                type="number"
                inputMode="decimal"
                step="1"
                min="0"
                className={inputClass}
                value={erwerbspreis}
                onChange={(e) => setErwerbspreis(e.target.value)}
                disabled={submitting}
              />
            </Field>
          </div>

          {/* Baurecht-Block (analog immo-portfolio) */}
          <div className="rounded-xl border border-slate-200 p-4 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <button
                type="button"
                onClick={() => !submitting && setHasBaurecht(!hasBaurecht)}
                className={cn(
                  'relative h-5 w-9 rounded-full transition-colors',
                  hasBaurecht ? 'bg-[#F2D3C2]' : 'bg-slate-200',
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                    hasBaurecht ? 'translate-x-4' : 'translate-x-0.5',
                  )}
                />
              </button>
              <span className="text-sm font-medium text-slate-700">Baurecht vorhanden</span>
            </label>

            {hasBaurecht && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <Field label="Baurechtszins (CHF / Jahr)">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="1"
                    min="0"
                    className={inputClass}
                    value={zinsPa}
                    onChange={(e) => setZinsPa(e.target.value)}
                    disabled={submitting}
                  />
                </Field>
                <Field label="Ablaufdatum Baurecht">
                  <input
                    type="date"
                    className={inputClass}
                    value={ablauf}
                    onChange={(e) => setAblauf(e.target.value)}
                    disabled={submitting}
                  />
                </Field>
              </div>
            )}
          </div>

          <Field label="Notizen">
            <textarea
              rows={3}
              className={inputClass}
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

          <DialogFooter className="mt-4">
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
  label,
  hint,
  required,
  children,
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

// ─── Bestandsgebäude-Tab ───────────────────────────────────────────────────

function BestandsgebaeudeTab({ projectId }: { projectId: string }) {
  const { canWrite } = useAuth()
  const {
    buildings, loading, error, reload,
    createBuilding, updateBuilding, deleteBuilding,
  } = useExistingBuildings(projectId)
  const [editTarget, setEditTarget] = useState<ExistingBuilding | null>(null)
  const [duplicateSource, setDuplicateSource] = useState<ExistingBuilding | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const totalGF  = buildings.reduce((sum, b) => sum + (b.geschossflaeche_m2 ?? 0), 0)
  const totalVol = buildings.reduce((sum, b) => sum + (b.volumen_m3 ?? 0), 0)

  const duplicateInitial = useMemo<ExistingBuilding | undefined>(
    () => duplicateSource
      ? { ...duplicateSource, bezeichnung: `${duplicateSource.bezeichnung} (Kopie)` }
      : undefined,
    [duplicateSource],
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {buildings.length === 0
            ? 'Noch kein Bestandsgebäude erfasst.'
            : <>Insgesamt <strong>{buildings.length}</strong> Gebäude
                {totalGF > 0 && <> · GF <strong>{formatNumber(totalGF)} m²</strong></>}
                {totalVol > 0 && <> · Volumen <strong>{formatNumber(totalVol)} m³</strong></>}.</>}
        </p>
        {canWrite && (
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="bg-[#F2D3C2] text-slate-900 hover:bg-[#E7AF90]"
          >
            <Plus className="h-4 w-4" /> Neues Gebäude
          </Button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Wird geladen…
        </div>
      ) : buildings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
          Hier erscheinen die zum Projekt gehörenden Bestandsgebäude.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Bezeichnung</th>
                <th className="px-4 py-3 text-left font-medium">GVZ-Nr.</th>
                <th className="px-4 py-3 text-right font-medium">Baujahr</th>
                <th className="px-4 py-3 text-left font-medium">Nutzung</th>
                <th className="px-4 py-3 text-right font-medium">GF (m²)</th>
                <th className="px-4 py-3 text-right font-medium">Volumen (m³)</th>
                <th className="px-4 py-3 text-left font-medium">Zustand</th>
                <th className="px-4 py-3 text-left font-medium">Vermietet</th>
                <th className="px-4 py-3 text-right font-medium">Jahresertrag</th>
                <th className="px-4 py-3 text-left font-medium">Eigentümer</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {buildings.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{b.bezeichnung}</td>
                  <td className="px-4 py-3 text-slate-700">{b.gvz_nummer ?? '—'}</td>
                  <td className="px-4 py-3 text-right text-slate-700 tabular-nums">{b.baujahr ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{b.nutzung ?? '—'}</td>
                  <td className="px-4 py-3 text-right text-slate-700 tabular-nums">
                    {b.geschossflaeche_m2 != null ? formatNumber(b.geschossflaeche_m2) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700 tabular-nums">
                    {b.volumen_m3 != null ? formatNumber(b.volumen_m3) : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {b.zustand ? BUILDING_CONDITION_LABEL[b.zustand] : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{b.vermietet ? 'Ja' : 'Nein'}</td>
                  <td className="px-4 py-3 text-right text-slate-700 tabular-nums">
                    {b.jahresertrag_chf != null ? formatCurrency(b.jahresertrag_chf) : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <OwnerSummary owners={b.owners ?? []} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canWrite && (
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditTarget(b)} title="Bearbeiten">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDuplicateSource(b)}
                          title="Duplizieren"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm(`Gebäude "${b.bezeichnung}" löschen?`)) deleteBuilding(b.id)
                          }}
                          title="Löschen"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BestandsgebaeudeDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Neues Bestandsgebäude"
        onSubmit={async (input) => !!(await createBuilding(input))}
      />
      <BestandsgebaeudeDialog
        open={!!editTarget}
        onClose={() => { setEditTarget(null); void reload() }}
        title={editTarget ? `Gebäude "${editTarget.bezeichnung}" bearbeiten` : ''}
        initial={editTarget ?? undefined}
        onSubmit={async (input) => {
          if (!editTarget) return false
          return updateBuilding(editTarget.id, input)
        }}
      />
      <BestandsgebaeudeDialog
        open={!!duplicateSource}
        onClose={() => setDuplicateSource(null)}
        title={duplicateSource ? `Gebäude "${duplicateSource.bezeichnung}" duplizieren` : ''}
        initial={duplicateInitial}
        onSubmit={async (input) => !!(await createBuilding(input))}
      />
    </div>
  )
}

// ─── Bestandsgebäude anlegen/bearbeiten ────────────────────────────────────

function BestandsgebaeudeDialog({
  open,
  onClose,
  title,
  initial,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  title: string
  initial?: ExistingBuilding
  onSubmit: (input: ExistingBuildingInput) => Promise<boolean>
}) {
  const [bezeichnung, setBezeichnung] = useState('')
  const [gvz, setGvz]                 = useState('')
  const [baujahr, setBaujahr]         = useState('')
  const [nutzung, setNutzung]         = useState('')
  const [gf, setGf]                   = useState('')
  const [volumen, setVolumen]         = useState('')
  const [zustand, setZustand]         = useState<BuildingCondition | ''>('')
  const [vermietet, setVermietet]     = useState(false)
  const [jahresertrag, setJahresertrag] = useState('')
  const [notizen, setNotizen]         = useState('')
  const [submitting, setSubmitting]   = useState(false)
  const [error, setError]             = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setBezeichnung(initial?.bezeichnung ?? '')
      setGvz(initial?.gvz_nummer ?? '')
      setBaujahr(initial?.baujahr?.toString() ?? '')
      setNutzung(initial?.nutzung ?? '')
      setGf(initial?.geschossflaeche_m2?.toString() ?? '')
      setVolumen(initial?.volumen_m3?.toString() ?? '')
      setZustand(initial?.zustand ?? '')
      setVermietet(initial?.vermietet ?? false)
      setJahresertrag(initial?.jahresertrag_chf?.toString() ?? '')
      setNotizen(initial?.notizen ?? '')
      setError(null)
    }
  }, [open, initial])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!bezeichnung.trim()) {
      setError('Bitte eine Bezeichnung eingeben.')
      return
    }
    setError(null); setSubmitting(true)

    const input: ExistingBuildingInput = {
      bezeichnung:        bezeichnung.trim(),
      gvz_nummer:         gvz.trim() || null,
      baujahr:            baujahr !== '' ? Number(baujahr) : null,
      nutzung:            nutzung.trim() || null,
      geschossflaeche_m2: gf !== '' ? Number(gf) : null,
      volumen_m3:         volumen !== '' ? Number(volumen) : null,
      zustand:            zustand || null,
      vermietet,
      jahresertrag_chf:   jahresertrag !== '' ? Number(jahresertrag) : null,
      notizen:            notizen.trim() || null,
    }

    const ok = await onSubmit(input)
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
          <div className="grid grid-cols-[1fr_180px_120px] gap-3">
            <Field label="Bezeichnung" required>
              <input
                className={inputClass}
                value={bezeichnung}
                onChange={(e) => setBezeichnung(e.target.value)}
                disabled={submitting}
                placeholder="z.B. Wohnhaus Süd"
              />
            </Field>
            <Field label="GVZ-Nummer">
              <input
                className={inputClass}
                value={gvz}
                onChange={(e) => setGvz(e.target.value)}
                disabled={submitting}
              />
            </Field>
            <Field label="Baujahr">
              <input
                type="number"
                inputMode="numeric"
                min={1500}
                max={2100}
                step={1}
                className={inputClass}
                value={baujahr}
                onChange={(e) => setBaujahr(e.target.value)}
                disabled={submitting}
              />
            </Field>
          </div>

          <Field label="Nutzung" hint="z.B. Wohnen, Gewerbe, gemischt">
            <input
              className={inputClass}
              value={nutzung}
              onChange={(e) => setNutzung(e.target.value)}
              disabled={submitting}
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Geschossfläche (m²)">
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                className={inputClass}
                value={gf}
                onChange={(e) => setGf(e.target.value)}
                disabled={submitting}
              />
            </Field>
            <Field label="Volumen (m³)">
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                className={inputClass}
                value={volumen}
                onChange={(e) => setVolumen(e.target.value)}
                disabled={submitting}
              />
            </Field>
            <Field label="Zustand">
              <select
                className={inputClass}
                value={zustand}
                onChange={(e) => setZustand(e.target.value as BuildingCondition | '')}
                disabled={submitting}
              >
                <option value="">— nicht angegeben —</option>
                {(Object.keys(BUILDING_CONDITION_LABEL) as BuildingCondition[]).map((c) => (
                  <option key={c} value={c}>{BUILDING_CONDITION_LABEL[c]}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Vermietet</label>
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={vermietet}
                  onChange={(e) => setVermietet(e.target.checked)}
                  disabled={submitting}
                  className="h-4 w-4 rounded border-slate-300"
                />
                {vermietet ? 'Ja' : 'Nein'}
              </label>
            </div>
            <Field label="Jahresertrag (CHF)" hint="bei Vermietung">
              <input
                type="number"
                inputMode="decimal"
                step="1"
                min="0"
                className={inputClass}
                value={jahresertrag}
                onChange={(e) => setJahresertrag(e.target.value)}
                disabled={submitting}
              />
            </Field>
          </div>

          <Field label="Notizen">
            <textarea
              rows={3}
              className={inputClass}
              value={notizen}
              onChange={(e) => setNotizen(e.target.value)}
              disabled={submitting}
            />
          </Field>

          <OwnerEditor buildingId={initial?.id ?? null} />

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <DialogFooter className="mt-4">
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

// ─── Eigentümer-Editor (für Bestandsgebäude) ────────────────────────────────

function OwnerSummary({ owners }: { owners: { name: string; anteil_pct: number }[] }) {
  if (owners.length === 0) return <span className="text-slate-400">—</span>
  const total = owners.reduce((s, o) => s + (o.anteil_pct || 0), 0)
  const totalRounded = Math.round(total * 100) / 100
  const off = Math.abs(totalRounded - 100) > 0.01

  if (owners.length <= 2) {
    return (
      <div className="flex flex-col gap-0.5">
        {owners.map((o, i) => (
          <span key={i} className="text-xs text-slate-700">
            {o.name || '—'}
            <span className="ml-1 tabular-nums text-slate-500">{formatNumber(o.anteil_pct)}%</span>
          </span>
        ))}
        {off && (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-600">
            <AlertTriangle className="h-3 w-3" />
            Total {formatNumber(totalRounded)}%
          </span>
        )}
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Users className="h-3.5 w-3.5 text-slate-400" />
      <span className="text-slate-700">{owners.length} Eigentümer</span>
      {off
        ? <span className="inline-flex items-center gap-1 text-amber-600"><AlertTriangle className="h-3 w-3" />{formatNumber(totalRounded)}%</span>
        : <span className="text-slate-400">·&nbsp;100%</span>}
    </div>
  )
}

function OwnerEditor({ buildingId }: { buildingId: string | null }) {
  const { canWrite } = useAuth()

  if (!buildingId) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
        <div className="flex items-center gap-2 font-medium text-slate-600">
          <Users className="h-4 w-4" />
          Eigentümer
        </div>
        <p className="mt-1 text-xs">
          Eigentümer können nach dem ersten Speichern des Gebäudes erfasst werden.
        </p>
      </div>
    )
  }

  return <OwnerEditorInner buildingId={buildingId} canWrite={canWrite} />
}

function OwnerEditorInner({ buildingId, canWrite }: { buildingId: string; canWrite: boolean }) {
  const { owners, loading, error, add, update, remove } = useExistingBuildingOwners(buildingId)
  const [newName, setNewName] = useState('')
  const [newPct, setNewPct]   = useState('')
  const [busy, setBusy]       = useState(false)

  const total = owners.reduce((s, o) => s + (o.anteil_pct || 0), 0)
  const totalRounded = Math.round(total * 100) / 100
  const totalOk = Math.abs(totalRounded - 100) < 0.01

  async function handleAdd() {
    const name = newName.trim()
    if (!name) return
    const pct = newPct === '' ? 0 : Number(newPct)
    if (Number.isNaN(pct) || pct < 0) return
    setBusy(true)
    const ok = await add({ name, anteil_pct: pct })
    setBusy(false)
    if (ok) { setNewName(''); setNewPct('') }
  }

  async function handleSaveRow(id: string, patch: { name?: string; anteil_pct?: number }) {
    setBusy(true)
    await update(id, patch)
    setBusy(false)
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Eigentümer "${name || '—'}" entfernen?`)) return
    setBusy(true)
    await remove(id)
    setBusy(false)
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Users className="h-4 w-4 text-slate-500" />
          Eigentümer
        </div>
        {owners.length > 0 && (
          <div
            className={cn(
              'inline-flex items-center gap-1 text-xs font-medium',
              totalOk ? 'text-emerald-600' : 'text-amber-600',
            )}
          >
            {totalOk ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            Total: {formatNumber(totalRounded)}%
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Wird geladen…
        </div>
      ) : owners.length === 0 ? (
        <p className="text-xs text-slate-500">Noch keine Eigentümer erfasst.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-right font-medium w-32">Anteil %</th>
                <th className="px-3 py-2 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {owners.map((o) => (
                <OwnerRow
                  key={o.id}
                  initialName={o.name}
                  initialPct={o.anteil_pct}
                  disabled={!canWrite || busy}
                  onCommit={(patch) => handleSaveRow(o.id, patch)}
                  onDelete={() => handleDelete(o.id, o.name)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canWrite && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600">Name</label>
            <input
              className={inputClass}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="z.B. Müller AG"
              disabled={busy}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAdd() } }}
            />
          </div>
          <div className="w-32">
            <label className="block text-xs font-medium text-slate-600">Anteil %</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              className={cn(inputClass, 'text-right tabular-nums')}
              value={newPct}
              onChange={(e) => setNewPct(e.target.value)}
              disabled={busy}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAdd() } }}
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={handleAdd}
            disabled={busy || !newName.trim()}
            className="bg-[#F2D3C2] text-slate-900 hover:bg-[#E7AF90]"
          >
            <Plus className="h-3.5 w-3.5" />
            Hinzufügen
          </Button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}

function OwnerRow({
  initialName, initialPct, disabled, onCommit, onDelete,
}: {
  initialName: string
  initialPct: number
  disabled: boolean
  onCommit: (patch: { name?: string; anteil_pct?: number }) => Promise<void>
  onDelete: () => void
}) {
  const [name, setName] = useState(initialName)
  const [pct, setPct]   = useState(initialPct.toString())

  useEffect(() => { setName(initialName) }, [initialName])
  useEffect(() => { setPct(initialPct.toString()) }, [initialPct])

  function commitName() {
    const trimmed = name.trim()
    if (trimmed === initialName) return
    if (!trimmed) { setName(initialName); return }
    void onCommit({ name: trimmed })
  }

  function commitPct() {
    if (pct === '' || pct === initialPct.toString()) return
    const n = Number(pct)
    if (Number.isNaN(n) || n < 0) { setPct(initialPct.toString()); return }
    void onCommit({ anteil_pct: n })
  }

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-3 py-2">
        <input
          className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm outline-none transition focus:border-slate-200 focus:bg-white"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          disabled={disabled}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-right text-sm tabular-nums outline-none transition focus:border-slate-200 focus:bg-white"
          value={pct}
          onChange={(e) => setPct(e.target.value)}
          onBlur={commitPct}
          disabled={disabled}
        />
      </td>
      <td className="px-2 py-1 text-right">
        {!disabled && (
          <Button variant="ghost" size="sm" onClick={onDelete} title="Eigentümer entfernen">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </td>
    </tr>
  )
}
