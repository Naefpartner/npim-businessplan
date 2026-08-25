import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Plus,
  Loader2,
  AlertCircle,
  GitBranch,
  Copy,
  Trash2,
  Pencil,
  MapPin,
  Database,
  Map as MapIcon,
  GitCompare,
  Calculator,
  GripVertical,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { fetchProject } from '@/hooks/useProjects'
import { fetchCustomer } from '@/hooks/useCustomers'
import { useVariants } from '@/hooks/useVariants'
import { useAnlagekosten } from '@/hooks/useAnlagekosten'
import { EIGENTUMSART_COLOR } from '@/lib/kategorieFarben'
import { CHART_PALETTE } from '@/lib/ci'
import { isGarageNutzung } from '@/lib/bkp2'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EditProjectDialog } from '@/components/projects/EditProjectDialog'
import { StammdatenSection } from '@/components/projects/StammdatenSection'
import { VariantenVergleich } from '@/components/projects/VariantenVergleich'
import { HonorarrechnerSection } from '@/components/projects/HonorarrechnerSection'
import { ProjectMediaSection } from '@/components/projects/ProjectMediaSection'
import { ProjectGisSection } from '@/components/projects/ProjectGisSection'
import { useProjectPhotos } from '@/hooks/useProjectPhotos'
import {
  PHASE_LABEL,
  PHASE_ORDER,
  VARIANT_STATUS_LABEL,
  EIGENTUMSART_LABEL,
  eigentumsartForBuilding,
  projectAddressLine,
  type Customer,
  type Eigentumsart,
  type Project,
  type ProjectPhase,
  type ProjectVariant,
  type VariantStatus,
} from '@/types'
import { formatDate, formatNumber, cn } from '@/lib/utils'

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm outline-none transition focus:border-[#8B6956] focus:ring-2 focus:ring-[#8B6956]/20 disabled:opacity-50'

const phaseBadgeClass: Record<ProjectPhase, string> = {
  grundstuecksakquisition:  'bg-stone-100 text-stone-700',
  machbarkeit:              'bg-zinc-100 text-zinc-700',
  loi:                      'bg-slate-100 text-slate-700',
  wettbewerb:               'bg-sky-100 text-sky-800',
  ueberarbeitung_wettbewerb:'bg-cyan-100 text-cyan-800',
  gestaltungsplan:          'bg-blue-100 text-blue-800',
  vorprojekt:               'bg-indigo-100 text-indigo-800',
  bauprojekt:               'bg-purple-100 text-purple-800',
  bewilligungsverfahren:    'bg-amber-100 text-amber-800',
  ausschreibung:            'bg-orange-100 text-orange-800',
  realisierung:             'bg-emerald-100 text-emerald-800',
}

const statusBadgeClass: Record<VariantStatus, string> = {
  entwurf:    'bg-slate-100 text-slate-700',
  aktiv:      'bg-emerald-100 text-emerald-800',
  archiviert: 'bg-slate-200 text-slate-500',
}

// Hauptreiter unter dem Projekt-Banner.
const TABS = [
  { key: 'staende',    label: 'Projektstände / Szenarien', icon: GitBranch },
  { key: 'vergleich',  label: 'Variantenvergleich',        icon: GitCompare },
  { key: 'honorar',    label: 'Honorarrechner',            icon: Calculator },
  { key: 'lage',       label: 'Lage und Fotos',            icon: MapPin },
  { key: 'stammdaten', label: 'Stammdaten',                icon: Database },
  { key: 'gis',        label: 'GIS-Informationen',         icon: MapIcon },
] as const

export function ProjektDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { canWrite } = useAuth()

  const [project, setProject] = useState<Project | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loadingProject, setLoadingProject] = useState(true)
  const [editOpen, setEditOpen] = useState(false)

  const { variants, loading: loadingVariants, error, createVariant, deleteVariant, reorderVariants } = useVariants(id)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [snapshotFrom, setSnapshotFrom] = useState<ProjectVariant | null>(null)
  const [variantsExpanded, setVariantsExpanded] = useState(true)
  // Deep-Link: ?tab=… (z. B. aus den Anlagekosten „Zum Honorarrechner"), ?variant=… (Vorauswahl).
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<string>(() => searchParams.get('tab') || 'staende')
  const initialVariantId = searchParams.get('variant') ?? undefined
  const returnTo = searchParams.get('return')

  const { photos, thumbnailPhotoId } = useProjectPhotos(id)
  const thumbnail = photos.find((p) => p.id === thumbnailPhotoId) ?? photos[0] ?? null

  useEffect(() => {
    if (!id) return
    setLoadingProject(true)
    fetchProject(id).then((p) => {
      setProject(p)
      setLoadingProject(false)
    })
  }, [id])

  useEffect(() => {
    if (project?.customer_id) {
      fetchCustomer(project.customer_id).then(setCustomer)
    } else {
      setCustomer(null)
    }
  }, [project?.customer_id])

  if (!id) return null

  if (loadingProject) {
    return (
      <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Wird geladen…
      </div>
    )
  }

  if (!project) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        Projekt nicht gefunden.
        <div className="mt-3">
          <Link to="/projekte"><Button variant="ghost">Zurück zur Übersicht</Button></Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb + Aktionen */}
      <div className="flex items-center justify-between">
        <Link
          to="/projekte"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" /> Projekte
        </Link>
        <div className="flex gap-2">
          {canWrite && (
            <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" /> Bearbeiten
            </Button>
          )}
          {variants.length >= 2 && (
            <Link to={`/projekte/${id}/vergleich`}>
              <Button variant="ghost" size="sm" className="text-[#8B6956]">
                <GitBranch className="h-4 w-4" /> Projektstände / Szenarien vergleichen
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Projekt-Kopf */}
      <header className="flex overflow-hidden rounded-xl border border-slate-200 bg-white">
        {thumbnail && (
          <div className="w-48 shrink-0 self-stretch bg-slate-100">
            <img
              src={thumbnail.publicUrl}
              alt={`Thumbnail ${project.name}`}
              className="h-full w-full object-cover"
            />
          </div>
        )}
        <div className="flex-1 p-6">
          <h1 className="text-2xl font-semibold text-slate-900">{project.name}</h1>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
            {project.project_number && <span><span className="text-slate-400">Nr.</span> {project.project_number}</span>}
            {projectAddressLine(project) && <span><span className="text-slate-400">Adresse:</span> {projectAddressLine(project)}</span>}
            {project.start_year     && <span><span className="text-slate-400">Start:</span> {project.start_year}</span>}
            {customer && (
              <span>
                <span className="text-slate-400">Kunde:</span>{' '}
                <Link to="/kunden" className="hover:text-[#8B6956]">{customer.name}</Link>
              </span>
            )}
          </div>
          {project.description && (
            <p className="mt-3 text-sm text-slate-700">{project.description}</p>
          )}
        </div>
      </header>

      {/* Hauptreiter */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.filter((t) => (t.key !== 'vergleich' || variants.length >= 2) && (t.key !== 'honorar' || variants.length >= 1)).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={cn(
              '-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition',
              activeTab === t.key
                ? 'border-[#8B6956] text-[#8B6956]'
                : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Variantenvergleich */}
      {activeTab === 'vergleich' && variants.length >= 2 && (
        <VariantenVergleich projectId={id} variants={variants} />
      )}

      {/* Honorarrechner — sprengt den max-w-Container und füllt den ganzen Hauptbereich
          (Viewport minus Sidebar w-60/15rem), damit möglichst viele Berechnungsspalten sichtbar sind. */}
      {activeTab === 'honorar' && variants.length > 0 && (
        <div className="relative left-1/2 w-[calc(100vw-15rem)] -translate-x-1/2 px-4">
          {returnTo && (
            <Link to={returnTo} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 transition hover:text-[#8B6956]">
              <ArrowLeft className="h-4 w-4" /> Zurück zu den Anlagekosten
            </Link>
          )}
          <HonorarrechnerSection projectId={id} variants={variants} initialVariantId={initialVariantId} />
        </div>
      )}

      {/* Lage und Fotos */}
      {activeTab === 'lage' && <ProjectMediaSection project={project} defaultExpanded />}

      {/* Stammdaten */}
      {activeTab === 'stammdaten' && <StammdatenSection projectId={id} defaultExpanded />}

      {/* GIS-Informationen */}
      {activeTab === 'gis' && (
        <ProjectGisSection project={project} onProjectUpdated={(p) => setProject(p)} defaultExpanded />
      )}

      {/* Projektstände / Szenarien */}
      {activeTab === 'staende' && (
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <header className="flex items-center justify-between bg-[#B98C74] pr-5">
          <button
            type="button"
            onClick={() => setVariantsExpanded(!variantsExpanded)}
            className="flex flex-1 items-center gap-2 px-5 py-3 text-left text-sm font-semibold text-slate-900 transition hover:brightness-95"
          >
            {variantsExpanded
              ? <ChevronDown className="h-4 w-4 text-slate-700" />
              : <ChevronRight className="h-4 w-4 text-slate-700" />}
            <GitBranch className="h-4 w-4 text-slate-700" />
            Projektstände / Szenarien <span className="text-slate-700">({variants.length})</span>
          </button>
          {canWrite && variantsExpanded && (
            <Button
              size="sm"
              onClick={() => { setSnapshotFrom(null); setCreateOpen(true) }}
              className="bg-[#F2D3C2] text-slate-900 hover:bg-[#E7AF90]"
            >
              <Plus className="h-4 w-4" /> Neuer Stand / Szenario
            </Button>
          )}
        </header>

        {variantsExpanded && error && (
          <div className="m-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {variantsExpanded && (loadingVariants ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Wird geladen…
          </div>
        ) : variants.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Noch kein Stand / Szenario angelegt.
          </div>
        ) : (
          <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
            {variants.map((v, idx) => (
              <div
                key={v.id}
                onDragOver={(e) => { if (dragIdx !== null) { e.preventDefault(); if (overIdx !== idx) setOverIdx(idx) } }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragIdx !== null && dragIdx !== idx) {
                    const ids = variants.map((x) => x.id)
                    const [moved] = ids.splice(dragIdx, 1)
                    ids.splice(idx, 0, moved)
                    void reorderVariants(ids)
                  }
                  setDragIdx(null); setOverIdx(null)
                }}
                className={`relative rounded-xl transition ${dragIdx === idx ? 'opacity-40' : ''} ${overIdx === idx && dragIdx !== null && dragIdx !== idx ? 'ring-2 ring-[#8B6956]' : ''}`}
              >
                {canWrite && (
                  <span
                    draggable
                    onDragStart={(e) => { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)) }}
                    onDragEnd={() => { setDragIdx(null); setOverIdx(null) }}
                    title="Zum Umsortieren ziehen"
                    className="absolute -left-2.5 top-1/2 z-10 -translate-y-1/2 cursor-grab rounded-md border border-slate-200 bg-white p-1 text-slate-400 shadow-sm hover:text-slate-700 active:cursor-grabbing"
                  >
                    <GripVertical className="h-4 w-4" />
                  </span>
                )}
                <VariantCard
                  projectId={id!}
                  variant={v}
                  canWrite={canWrite}
                  onSnapshot={() => { setSnapshotFrom(v); setCreateOpen(true) }}
                  onDelete={() => { if (confirm(`Stand / Szenario "${v.name}" löschen?`)) deleteVariant(v.id) }}
                />
              </div>
            ))}
          </div>
        ))}
      </section>
      )}

      <CreateVariantDialog
        open={createOpen}
        onClose={() => { setCreateOpen(false); setSnapshotFrom(null) }}
        onCreate={createVariant}
        snapshotFrom={snapshotFrom}
      />
      <EditProjectDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        project={project}
        onSaved={(p) => setProject(p)}
      />
    </div>
  )
}

// ─── Projektstand als Karteikarte ────────────────────────────────────────────

function VariantCard({
  projectId, variant: v, canWrite, onSnapshot, onDelete,
}: {
  projectId: string
  variant: ProjectVariant
  canWrite: boolean
  onSnapshot: () => void
  onDelete: () => void
}) {
  const navigate = useNavigate()
  const ak = useAnlagekosten(projectId, v.id)

  const { eigs, vmf, vkf, nutzItems, nutzTotal } = useMemo(() => {
    let vmf = 0, vkf = 0
    const nutz = new Map<string, number>()
    const eigSet = new Set<Eigentumsart>()
    for (const b of ak.buildings) {
      const eig = eigentumsartForBuilding(b.use_type)
      eigSet.add(eig)
      for (const m of b.mietflaechen) {
        const f = m.flaeche_m2 || 0
        if (f <= 0) continue
        if (eig === 'verkaufsobjekt') vkf += f
        else vmf += f
        if (!isGarageNutzung(m.nutzung || '')) {
          const n = (m.nutzung || '').trim() || '(ohne Nutzung)'
          nutz.set(n, (nutz.get(n) ?? 0) + f)
        }
      }
    }
    const order: Eigentumsart[] = ['renditeobjekt', 'genossenschaft', 'verkaufsobjekt']
    const eigs = order.filter((e) => eigSet.has(e))
    const nutzItems = [...nutz.entries()].sort((a, b) => b[1] - a[1])
    const nutzTotal = nutzItems.reduce((s, [, a]) => s + a, 0)
    return { eigs, vmf, vkf, nutzItems, nutzTotal }
  }, [ak.buildings])

  return (
    <div
      onClick={() => navigate(`/projekte/${projectId}/varianten/${v.id}`)}
      className="flex cursor-pointer flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-[#8B6956]/40 hover:shadow-md"
    >
      {/* Kopf: Nummer, Name, Aktionen */}
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">V{v.variant_number}</span>
        <span className="min-w-0 flex-1 truncate font-semibold text-slate-900" title={v.name}>{v.name}</span>
        {canWrite && (
          <div className="-mr-1 -mt-1 flex shrink-0 items-center">
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onSnapshot() }} title="Als neuen Stand abspeichern"><Copy className="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onDelete() }} title="Stand / Szenario löschen"><Trash2 className="h-4 w-4" /></Button>
          </div>
        )}
      </div>

      {/* Phase + Status */}
      <div className="flex flex-wrap gap-1.5">
        <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', phaseBadgeClass[v.phase])}>{PHASE_LABEL[v.phase]}</span>
        <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', statusBadgeClass[v.status])}>{VARIANT_STATUS_LABEL[v.status]}</span>
        {v.snapshot_of && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Snapshot</span>}
      </div>

      {/* Eigentumsarten */}
      <div className="flex flex-wrap gap-1.5">
        {eigs.length === 0
          ? <span className="text-xs text-slate-400">— keine Gebäude —</span>
          : eigs.map((e) => (
              <span key={e} className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium text-slate-900" style={{ backgroundColor: EIGENTUMSART_COLOR[e] }}>
                {EIGENTUMSART_LABEL[e]}
              </span>
            ))}
      </div>

      {/* Nutzungsmix */}
      <div>
        <div className="mb-1 text-[11px] font-medium text-slate-500">Nutzungsmix</div>
        {nutzTotal > 0 ? (
          <>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              {nutzItems.map(([n, a], i) => (
                <div
                  key={n}
                  title={`${n} · ${formatNumber(a)} m² (${Math.round((a / nutzTotal) * 100)}%)`}
                  style={{ width: `${(a / nutzTotal) * 100}%`, backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length] }}
                />
              ))}
            </div>
            <div className="mt-1 truncate text-[11px] text-slate-500">
              {nutzItems.slice(0, 3).map(([n, a]) => `${n} ${Math.round((a / nutzTotal) * 100)}%`).join(' · ')}
            </div>
          </>
        ) : <span className="text-xs text-slate-400">—</span>}
      </div>

      {/* Kennzahlen */}
      <div className="mt-auto grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
        <Figure label="Anlagekosten (BKP 0–9)" value={ak.loading ? '…' : `CHF ${formatNumber(ak.grandTotalBrutto)}`} />
        <Figure label="VMF / VKF" value={ak.loading ? '…' : `${formatNumber(vmf)} / ${formatNumber(vkf)} m²`} />
      </div>

      <div className="text-[11px] text-slate-400">aktualisiert {formatDate(v.updated_at)}</div>
    </div>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-slate-900">{value}</div>
    </div>
  )
}

// ─── Variante anlegen ─────────────────────────────────────────────────────────

function CreateVariantDialog({
  open,
  onClose,
  onCreate,
  snapshotFrom,
}: {
  open: boolean
  onClose: () => void
  onCreate: (input: {
    name: string
    phase?: ProjectPhase
    notes?: string | null
    snapshot_of?: string | null
  }) => Promise<ProjectVariant | null>
  snapshotFrom: ProjectVariant | null
}) {
  const [name, setName]       = useState('')
  const [phase, setPhase]     = useState<ProjectPhase>('loi')
  const [notes, setNotes]     = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      if (snapshotFrom) {
        setName(`${snapshotFrom.name} (Kopie)`)
        setPhase(snapshotFrom.phase)
        setNotes(snapshotFrom.notes ?? '')
      } else {
        setName('')
        setPhase('loi')
        setNotes('')
      }
      setError(null)
    }
  }, [open, snapshotFrom])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Bitte einen Namen eingeben.'); return }
    setError(null); setSubmitting(true)
    const created = await onCreate({
      name:        name.trim(),
      phase,
      notes:       notes.trim() || null,
      snapshot_of: snapshotFrom?.id ?? null,
    })
    setSubmitting(false)
    if (!created) { setError('Stand / Szenario konnte nicht angelegt werden.'); return }
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{snapshotFrom ? 'Stand abspeichern (Kopie)' : 'Neuer Stand / Szenario'}</DialogTitle>
          <DialogDescription>
            {snapshotFrom
              ? `Erstellt einen neuen Stand / Szenario als vollständige Kopie von "${snapshotFrom.name}" — inkl. Mengengerüst, Erträgen, Anlagekosten und Kostenmiete.`
              : 'Ein neuer, leerer Stand / Szenario. Inhalte erfassen Sie anschliessend in der Detailseite.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="V1 LOI / V2 Wettbewerb / V3 Optimiert"
              className={inputClass}
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Projektphase</label>
            <select
              value={phase}
              onChange={(e) => setPhase(e.target.value as ProjectPhase)}
              className={inputClass}
              disabled={submitting}
            >
              {PHASE_ORDER.map((p) => (
                <option key={p} value={p}>{PHASE_LABEL[p]}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Notizen</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className={inputClass}
              disabled={submitting}
            />
          </div>

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
            <Button type="submit" disabled={submitting} className="bg-[#F2D3C2] text-slate-900 hover:bg-[#E7AF90]">
              {submitting
                ? <><Loader2 className="h-4 w-4 animate-spin" />Wird angelegt…</>
                : 'Anlegen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

