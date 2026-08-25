import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, AlertCircle, Pencil, Save, Ruler, PieChart, Calculator, Gauge, Coins, Waves, ShieldAlert } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { fetchProject } from '@/hooks/useProjects'
import { fetchVariant, useVariants } from '@/hooks/useVariants'
import { useProjectPhotos } from '@/hooks/useProjectPhotos'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { MengengeruestSection } from '@/components/projects/MengengeruestSection'
import { MengenAnalyseSection } from '@/components/projects/MengenAnalyseSection'
import { AnlagekostenSection } from '@/pages/AnlagekostenPage'
import { WohnbaufoerderungSection } from '@/components/projects/WohnbaufoerderungSection'
import { BenchmarksSection } from '@/components/projects/BenchmarksSection'
import { WirtschaftlichkeitSection } from '@/components/projects/WirtschaftlichkeitSection'
import { MittelflussSection } from '@/components/projects/MittelflussSection'
import { VariantDataProvider } from '@/contexts/VariantDataContext'
import { VariantTabContext } from '@/contexts/VariantTabContext'
import {
  PHASE_LABEL,
  PHASE_ORDER,
  VARIANT_STATUS_LABEL,
  type Project,
  type ProjectPhase,
  type ProjectVariant,
  type VariantStatus,
} from '@/types'
import { cn, formatDate } from '@/lib/utils'

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[#8B6956] focus:ring-2 focus:ring-[#8B6956]/20 disabled:opacity-50'

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

// Hauptreiter unter dem Szenario-Banner.
const TABS = [
  { key: 'mengen',             label: 'Mengen und Erträge',        icon: Ruler },
  { key: 'wohnungsmix',        label: 'Wohnungs- und Nutzungsmix', icon: PieChart },
  { key: 'anlagekosten',       label: 'Anlagekosten',              icon: Calculator },
  { key: 'benchmarks',         label: 'Benchmarks',                icon: Gauge },
  { key: 'wirtschaftlichkeit', label: 'Wirtschaftlichkeit',        icon: Coins },
  { key: 'mittelfluss',        label: 'Mittelfluss',               icon: Waves },
  { key: 'pqm',                label: 'PQM',                       icon: ShieldAlert },
] as const


export function VarianteDetailPage() {
  const { projektId, id } = useParams<{ projektId: string; id: string }>()
  const { canWrite } = useAuth()
  const navigate = useNavigate()
  const { variants, reload: reloadVariants } = useVariants(projektId)
  const { photos, thumbnailPhotoId } = useProjectPhotos(projektId)
  const thumbnail = photos.find((p) => p.id === thumbnailPhotoId) ?? photos[0] ?? null

  const [project, setProject] = useState<Project | null>(null)
  const [variant, setVariant] = useState<ProjectVariant | null>(null)
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<string>('mengen')

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!projektId || !id) return
      setLoading(true)
      const [p, v] = await Promise.all([fetchProject(projektId), fetchVariant(id)])
      if (cancelled) return
      setProject(p)
      setVariant(v)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [projektId, id])

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Wird geladen…
      </div>
    )
  }

  if (!project || !variant) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        Stand / Szenario nicht gefunden.
      </div>
    )
  }

  return (
    <VariantTabContext.Provider value={{ setTab: setActiveTab }}>
    <div className="space-y-6">
      <Link
        to={`/projekte/${project.id}`}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" />
        {project.name}
      </Link>

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
        <div className="flex flex-1 items-start justify-between gap-4 p-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                V{variant.variant_number}
              </span>
              {variants.length > 0 ? (
                <select
                  value={variant.id}
                  onChange={(e) => navigate(`/projekte/${projektId}/varianten/${e.target.value}`)}
                  title="Stand / Szenario wechseln"
                  className="-ml-1 max-w-full cursor-pointer truncate rounded-md border border-transparent bg-transparent px-1 text-2xl font-semibold text-slate-900 outline-none transition hover:bg-slate-50 focus:border-slate-300 focus:bg-white"
                >
                  {variants.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              ) : (
                <h1 className="truncate text-2xl font-semibold text-slate-900">{variant.name}</h1>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', phaseBadgeClass[variant.phase])}>
                {PHASE_LABEL[variant.phase]}
              </span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-600">{VARIANT_STATUS_LABEL[variant.status]}</span>
            </div>
            {variant.notes && (
              <p className="mt-3 text-sm text-slate-700">{variant.notes}</p>
            )}
            <p className="mt-3 text-xs text-slate-400">
              Aktualisiert {formatDate(variant.updated_at)}
              {variant.snapshot_of && variant.snapshot_taken_at && (
                <> · Snapshot vom {formatDate(variant.snapshot_taken_at)}</>
              )}
            </p>
          </div>
          {canWrite && (
            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" /> Bearbeiten
            </Button>
          )}
        </div>
      </header>

      {/* Hauptreiter */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
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

      <VariantDataProvider projectId={project.id} variantId={variant.id}>
        {activeTab === 'mengen' && (
          <MengengeruestSection projectId={project.id} variantId={variant.id} defaultExpanded />
        )}
        {activeTab === 'wohnungsmix' && (
          <MengenAnalyseSection variantId={variant.id} defaultExpanded />
        )}
        {activeTab === 'anlagekosten' && (
          <div className="space-y-6">
            <AnlagekostenSection projectId={project.id} variantId={variant.id} defaultExpanded />
            <WohnbaufoerderungSection variantId={variant.id} />
          </div>
        )}
        {activeTab === 'benchmarks' && (
          <BenchmarksSection defaultExpanded />
        )}
        {activeTab === 'wirtschaftlichkeit' && (
          <WirtschaftlichkeitSection variantId={variant.id} defaultExpanded />
        )}
        {/* Mittelfluss — sprengt den max-w-Container und füllt den ganzen Hauptbereich
            (Viewport minus Sidebar w-60/15rem), damit möglichst viele Quartalsspalten sichtbar sind. */}
        {activeTab === 'mittelfluss' && (
          <div className="relative left-1/2 w-[calc(100vw-15rem)] -translate-x-1/2 px-4">
            <MittelflussSection projectId={project.id} variantId={variant.id} defaultExpanded />
          </div>
        )}
        {activeTab === 'pqm' && <TabPlaceholder title="PQM-Risikoanalyse" />}
      </VariantDataProvider>

      <EditVariantDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        variant={variant}
        onSaved={(v) => { setVariant(v); reloadVariants() }}
      />
    </div>
    </VariantTabContext.Provider>
  )
}

function TabPlaceholder({ title }: { title: string }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2 bg-[#B98C74] px-5 py-3 text-sm font-semibold text-slate-900">
        <span>{title}</span>
        <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-normal text-slate-700">in Vorbereitung</span>
      </div>
      <div className="p-5">
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
          {title} – Inhalt folgt.
        </div>
      </div>
    </section>
  )
}

function EditVariantDialog({
  open,
  onClose,
  variant,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  variant: ProjectVariant
  onSaved: (v: ProjectVariant) => void
}) {
  const [name, setName]       = useState(variant.name)
  const [phase, setPhase]     = useState<ProjectPhase>(variant.phase)
  const [status, setStatus]   = useState<VariantStatus>(variant.status)
  const [notes, setNotes]     = useState(variant.notes ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(variant.name)
      setPhase(variant.phase)
      setStatus(variant.status)
      setNotes(variant.notes ?? '')
      setError(null)
    }
  }, [open, variant])

  if (!open) return null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Bitte einen Namen eingeben.'); return }
    setError(null); setSubmitting(true)
    const { data, error } = await supabase
      .from('project_variants')
      .update({
        name: name.trim(),
        phase,
        status,
        notes: notes.trim() || null,
      })
      .eq('id', variant.id)
      .select()
      .single()
    setSubmitting(false)
    if (error || !data) { setError(error?.message ?? 'Speichern fehlgeschlagen.'); return }
    onSaved(data as ProjectVariant)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Stand / Szenario bearbeiten</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Name</label>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} disabled={submitting} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Phase</label>
              <select className={inputClass} value={phase} onChange={(e) => setPhase(e.target.value as ProjectPhase)} disabled={submitting}>
                {PHASE_ORDER.map((p) => <option key={p} value={p}>{PHASE_LABEL[p]}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Status</label>
              <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as VariantStatus)} disabled={submitting}>
                {(Object.keys(VARIANT_STATUS_LABEL) as VariantStatus[]).map((s) => (
                  <option key={s} value={s}>{VARIANT_STATUS_LABEL[s]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Notizen</label>
            <textarea rows={3} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={submitting} />
          </div>
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>Abbrechen</Button>
            <Button type="submit" disabled={submitting} className="bg-[#F2D3C2] text-slate-900 hover:bg-[#E7AF90]">
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" />Speichern…</> : <><Save className="h-4 w-4" />Speichern</>}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
