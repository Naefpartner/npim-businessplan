import { useEffect, useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { ParzellenTab } from '@/components/projects/StammdatenSection'
import { fetchProject } from '@/hooks/useProjects'
import type { Project } from '@/types'

export function ParzellenPage() {
  const { projektId } = useParams<{ projektId: string }>()
  const [searchParams] = useSearchParams()
  const returnTo = searchParams.get('return') ?? (projektId ? `/projekte/${projektId}` : '/')

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!projektId) return
      const proj = await fetchProject(projektId)
      if (!cancelled) { setProject(proj); setLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [projektId])

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Wird geladen…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          to={returnTo}
          className="inline-flex items-center gap-1 rounded-md bg-[#F2D3C2] px-3 py-2 text-sm font-medium text-slate-900 hover:bg-[#E7AF90]"
        >
          <ArrowLeft className="h-4 w-4" /> Zurück zur Kostenberechnung
        </Link>
        <div className="text-right">
          <h1 className="text-lg font-semibold text-slate-900">Parzellen</h1>
          <p className="text-xs text-slate-500">{project?.name}</p>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {projektId && <ParzellenTab projectId={projektId} />}
      </section>
    </div>
  )
}
