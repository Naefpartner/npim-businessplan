import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, GitBranch, Loader2 } from 'lucide-react'
import { fetchProject } from '@/hooks/useProjects'
import { useVariants } from '@/hooks/useVariants'
import {
  PHASE_LABEL,
  VARIANT_STATUS_LABEL,
  type Project,
} from '@/types'
import { formatDate } from '@/lib/utils'

export function VariantenVergleichPage() {
  const { projektId } = useParams<{ projektId: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const { variants, loading } = useVariants(projektId)

  useEffect(() => {
    if (projektId) fetchProject(projektId).then(setProject)
  }, [projektId])

  if (!projektId) return null

  return (
    <div className="space-y-6">
      <Link
        to={`/projekte/${projektId}`}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" />
        {project?.name ?? 'Projekt'}
      </Link>

      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#FAEFE9]">
          <GitBranch className="h-5 w-5 text-[#8B6956]" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Projektstände / Szenarien — Vergleich</h1>
          <p className="text-sm text-slate-500">
            Übersicht aller Projektstände / Szenarien dieses Projekts.
            Inhaltlicher Vergleich (Kosten, Erträge, KPIs) folgt mit den Modulen ab Phase 2.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Wird geladen…
        </div>
      ) : variants.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Keine Projektstände / Szenarien vorhanden.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Kennzahl</th>
                {variants.map((v) => (
                  <th key={v.id} className="px-4 py-3 text-left font-medium text-slate-700">
                    V{v.variant_number} – {v.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="px-4 py-3 font-medium text-slate-600">Phase</td>
                {variants.map((v) => <td key={v.id} className="px-4 py-3">{PHASE_LABEL[v.phase]}</td>)}
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium text-slate-600">Status</td>
                {variants.map((v) => <td key={v.id} className="px-4 py-3">{VARIANT_STATUS_LABEL[v.status]}</td>)}
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium text-slate-600">Aktualisiert</td>
                {variants.map((v) => <td key={v.id} className="px-4 py-3 text-slate-500">{formatDate(v.updated_at)}</td>)}
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium text-slate-600">Snapshot von</td>
                {variants.map((v) => (
                  <td key={v.id} className="px-4 py-3 text-slate-500">
                    {v.snapshot_of
                      ? `V${variants.find((x) => x.id === v.snapshot_of)?.variant_number ?? '?'}`
                      : '—'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
