import { useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  FolderKanban, Plus, Loader2, AlertCircle, Archive, ArchiveRestore, Pencil,
  Search, Image as ImageIcon, Users, X,
} from 'lucide-react'
import { useProjects, type ProjectInput } from '@/hooks/useProjects'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
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
import { CustomerSelect } from '@/components/projects/CustomerSelect'
import type { Project } from '@/types'
import { formatDate, cn } from '@/lib/utils'

type SortField = 'name' | 'project_number' | 'customer' | 'address' | 'plz' | 'ort' | 'updated_at'
type SortDir = 'asc' | 'desc'

function getThumbnailUrl(p: Project): string | null {
  if (p.thumbnail_photo?.storage_path) {
    return supabase.storage.from('project-photos').getPublicUrl(p.thumbnail_photo.storage_path).data.publicUrl
  }
  return null
}

function projectInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('') || '–'
}

function projectSortValue(p: Project, field: SortField): string | number | null {
  switch (field) {
    case 'name':           return p.name.toLowerCase()
    case 'project_number': return p.project_number?.toLowerCase() ?? null
    case 'customer':       return p.customer?.name.toLowerCase() ?? null
    case 'address':        return [p.strasse, p.hausnummer].filter(Boolean).join(' ').toLowerCase() || null
    case 'plz':            return p.plz ?? null
    case 'ort':            return p.ort?.toLowerCase() ?? null
    case 'updated_at':     return p.updated_at
  }
}

function compareSort(a: string | number | null, b: string | number | null, dir: SortDir): number {
  // null/leer immer ans Ende
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  if (a < b) return dir === 'asc' ? -1 : 1
  if (a > b) return dir === 'asc' ? 1 : -1
  return 0
}

function projectMatchesSearch(p: Project, term: string): boolean {
  if (!term) return true
  const haystack = [
    p.name,
    p.project_number,
    p.customer?.name,
    p.strasse,
    p.hausnummer,
    p.plz,
    p.ort,
    p.description,
  ].filter(Boolean).join(' ').toLowerCase()
  return haystack.includes(term)
}

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm outline-none transition focus:border-[#8B6956] focus:ring-2 focus:ring-[#8B6956]/20 disabled:opacity-50'

export function ProjekteListPage() {
  const { canWrite } = useAuth()
  const { projects, loading, error, createProject, updateProject, reload } = useProjects()
  const [showArchived, setShowArchived] = useState(false)
  const [createOpen, setCreateOpen]     = useState(false)
  const [editTarget, setEditTarget]     = useState<Project | null>(null)
  const [search, setSearch]             = useState('')
  const [sortField, setSortField]       = useState<SortField>('updated_at')
  const [sortDir, setSortDir]           = useState<SortDir>('desc')

  const [searchParams, setSearchParams] = useSearchParams()
  const kundeId = searchParams.get('kunde')
  const kundeName = kundeId
    ? (projects.find((p) => p.customer_id === kundeId)?.customer?.name ?? null)
    : null
  const clearKunde = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('kunde')
    setSearchParams(next, { replace: true })
  }

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    const filtered = projects.filter((p) =>
      (showArchived || !p.archived)
      && (!kundeId || p.customer_id === kundeId)
      && projectMatchesSearch(p, term),
    )
    return [...filtered].sort((a, b) =>
      compareSort(projectSortValue(a, sortField), projectSortValue(b, sortField), sortDir),
    )
  }, [projects, showArchived, search, sortField, sortDir, kundeId])

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir(field === 'updated_at' ? 'desc' : 'asc')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#FAEFE9]">
            <FolderKanban className="h-5 w-5 text-[#8B6956]" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Projekte</h1>
            <p className="text-sm text-slate-500">
              Alle Projektbusinesspläne. Pro Projekt können beliebig viele Projektstände / Szenarien erfasst werden.
            </p>
          </div>
        </div>
        {canWrite && (
          <Button
            onClick={() => setCreateOpen(true)}
            className="bg-[#F2D3C2] text-slate-900 hover:bg-[#E7AF90]"
          >
            <Plus className="h-4 w-4" />
            Neues Projekt
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suche nach Auftraggeber, Objektname, Projektnummer, Adresse…"
            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-[#8B6956] focus:ring-2 focus:ring-[#8B6956]/20"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Archivierte einblenden
        </label>
        {kundeId && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FAEFE9] py-1 pl-3 pr-1.5 text-sm font-medium text-[#8B6956]">
            <Users className="h-3.5 w-3.5" />
            Kunde: {kundeName ?? 'ausgewählt'}
            <button
              type="button"
              onClick={clearKunde}
              title="Kundenfilter entfernen"
              className="rounded-full p-0.5 text-[#8B6956]/70 transition hover:bg-[#8B6956]/10 hover:text-[#8B6956]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>Sortierung:</span>
        {([
          ['updated_at',     'Aktualisiert'],
          ['name',           'Name'],
          ['project_number', 'Projektnummer'],
          ['customer',       'Kunde'],
          ['ort',            'Ort'],
        ] as [SortField, string][]).map(([field, label]) => (
          <button
            key={field}
            type="button"
            onClick={() => handleSort(field)}
            className={cn(
              'rounded-md border px-2 py-1 transition',
              sortField === field
                ? 'border-[#B98C74] bg-[#F2D3C2] text-slate-900'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100',
            )}
          >
            {label} {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
          <div className="inline-flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Wird geladen…
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          {projects.length === 0
            ? 'Noch keine Projekte angelegt.'
            : kundeId
              ? `Keine Projekte für diesen Kunden${search.trim() ? ', die zur Suche passen' : ''}.`
              : search.trim()
                ? 'Keine Projekte gefunden, die zur Suche passen.'
                : 'Keine sichtbaren Projekte (archivierte sind ausgeblendet).'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((p) => {
            const thumbUrl = getThumbnailUrl(p)
            return (
              <div
                key={p.id}
                className={cn(
                  'group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:shadow-md',
                  p.archived && 'opacity-60',
                )}
              >
                <Link to={`/projekte/${p.id}`} className="block">
                  <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100">
                    {thumbUrl ? (
                      <img
                        src={thumbUrl}
                        alt={p.name}
                        className="h-full w-full object-cover transition group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400">
                        <ImageIcon className="h-8 w-8" />
                        <span className="text-2xl font-semibold tracking-wider">
                          {projectInitials(p.name)}
                        </span>
                      </div>
                    )}
                    {p.archived && (
                      <span className="absolute left-2 top-2 rounded-md bg-slate-700/90 px-2 py-0.5 text-xs font-medium text-white">
                        archiviert
                      </span>
                    )}
                  </div>
                </Link>

                <div className="flex flex-1 flex-col gap-1 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      to={`/projekte/${p.id}`}
                      className="line-clamp-2 text-sm font-semibold text-slate-900 hover:text-[#8B6956]"
                    >
                      {p.name}
                    </Link>
                    {p.project_number && (
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium tabular-nums text-slate-600">
                        {p.project_number}
                      </span>
                    )}
                  </div>
                  {p.customer?.name && (
                    <p className="text-xs text-slate-600">{p.customer.name}</p>
                  )}
                  <p className="text-xs text-slate-500">
                    {[
                      [p.strasse, p.hausnummer].filter(Boolean).join(' ') || null,
                      [p.plz, p.ort].filter(Boolean).join(' ') || null,
                    ].filter(Boolean).join(', ') || '—'}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Aktualisiert {formatDate(p.updated_at)}
                  </p>

                  {canWrite && (
                    <div className="mt-2 flex items-center justify-end gap-1 border-t border-slate-100 pt-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditTarget(p)}
                        title="Bearbeiten"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => updateProject(p.id, { archived: !p.archived })}
                        title={p.archived ? 'Wiederherstellen' : 'Archivieren'}
                      >
                        {p.archived
                          ? <ArchiveRestore className="h-3.5 w-3.5" />
                          : <Archive className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <CreateProjectDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createProject}
      />
      {editTarget && (
        <EditProjectDialog
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          project={editTarget}
          onSaved={() => { setEditTarget(null); reload() }}
        />
      )}
    </div>
  )
}

function CreateProjectDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (input: ProjectInput) => Promise<{ id: string } | null>
}) {
  const [name, setName]                 = useState('')
  const [projectNumber, setProjectNumber] = useState('')
  const [strasse, setStrasse]           = useState('')
  const [hausnummer, setHausnummer]     = useState('')
  const [plz, setPlz]                   = useState('')
  const [ort, setOrt]                   = useState('')
  const [startYear, setStartYear]       = useState('')
  const [customerId, setCustomerId]     = useState<string | null>(null)
  const [submitting, setSubmitting]     = useState(false)
  const [error, setError]               = useState<string | null>(null)

  function reset() {
    setName(''); setProjectNumber('')
    setStrasse(''); setHausnummer(''); setPlz(''); setOrt('')
    setStartYear(''); setCustomerId(null)
    setError(null); setSubmitting(false)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) { setError('Bitte einen Projektnamen eingeben.'); return }

    setSubmitting(true)
    const created = await onCreate({
      name:           name.trim(),
      project_number: projectNumber.trim() || null,
      strasse:        strasse.trim() || null,
      hausnummer:     hausnummer.trim() || null,
      plz:            plz.trim() || null,
      ort:            ort.trim() || null,
      start_year:     startYear ? Number(startYear) : null,
      customer_id:    customerId,
    })
    setSubmitting(false)

    if (!created) {
      setError('Projekt konnte nicht angelegt werden.')
      return
    }
    reset()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose() } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Neues Projekt</DialogTitle>
          <DialogDescription>
            Anschliessend können Sie Projektstände / Szenarien anlegen und mit Daten füllen.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">
              Projektname <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Areal Birch"
              className={inputClass}
              disabled={submitting}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Projektnummer</label>
              <input
                type="text"
                value={projectNumber}
                onChange={(e) => setProjectNumber(e.target.value)}
                placeholder="2025-014"
                className={inputClass}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Startjahr</label>
              <input
                type="number"
                min={1900}
                max={2100}
                value={startYear}
                onChange={(e) => setStartYear(e.target.value)}
                placeholder="2026"
                className={inputClass}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Strasse</label>
              <input
                type="text"
                value={strasse}
                onChange={(e) => setStrasse(e.target.value)}
                placeholder="Hauptstrasse"
                className={inputClass}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Nummer</label>
              <input
                type="text"
                value={hausnummer}
                onChange={(e) => setHausnummer(e.target.value)}
                placeholder="12"
                className={inputClass}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="grid grid-cols-[120px_1fr] gap-3">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">PLZ</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={5}
                value={plz}
                onChange={(e) => setPlz(e.target.value)}
                placeholder="8000"
                className={inputClass}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Ort</label>
              <input
                type="text"
                value={ort}
                onChange={(e) => setOrt(e.target.value)}
                placeholder="Zürich"
                className={inputClass}
                disabled={submitting}
              />
            </div>
          </div>

          <CustomerSelect value={customerId} onChange={setCustomerId} disabled={submitting} />

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => { reset(); onClose() }} disabled={submitting}>
              Abbrechen
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className="bg-[#F2D3C2] text-slate-900 hover:bg-[#E7AF90]"
            >
              {submitting ? (
                <><Loader2 className="h-4 w-4 animate-spin" />Wird angelegt…</>
              ) : 'Projekt anlegen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
