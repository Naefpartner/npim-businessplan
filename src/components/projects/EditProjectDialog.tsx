import { useEffect, useState, type FormEvent } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { CustomerSelect } from '@/components/projects/CustomerSelect'
import type { Project } from '@/types'

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm outline-none transition focus:border-[#8B6956] focus:ring-2 focus:ring-[#8B6956]/20 disabled:opacity-50'

export function EditProjectDialog({
  open,
  onClose,
  project,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  project: Project
  onSaved: (p: Project) => void
}) {
  const [name, setName]                   = useState(project.name)
  const [projectNumber, setProjectNumber] = useState(project.project_number ?? '')
  const [strasse, setStrasse]             = useState(project.strasse ?? '')
  const [hausnummer, setHausnummer]       = useState(project.hausnummer ?? '')
  const [plz, setPlz]                     = useState(project.plz ?? '')
  const [ort, setOrt]                     = useState(project.ort ?? '')
  const [startYear, setStartYear]         = useState(project.start_year?.toString() ?? '')
  const [description, setDescription]     = useState(project.description ?? '')
  const [customerId, setCustomerId]       = useState<string | null>(project.customer_id)
  const [submitting, setSubmitting]       = useState(false)
  const [error, setError]                 = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(project.name)
      setProjectNumber(project.project_number ?? '')
      setStrasse(project.strasse ?? '')
      setHausnummer(project.hausnummer ?? '')
      setPlz(project.plz ?? '')
      setOrt(project.ort ?? '')
      setStartYear(project.start_year?.toString() ?? '')
      setDescription(project.description ?? '')
      setCustomerId(project.customer_id)
      setError(null)
    }
  }, [open, project])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Bitte einen Projektnamen eingeben.'); return }
    setError(null); setSubmitting(true)
    const { data, error } = await supabase
      .from('projects')
      .update({
        name:           name.trim(),
        project_number: projectNumber.trim() || null,
        strasse:        strasse.trim() || null,
        hausnummer:     hausnummer.trim() || null,
        plz:            plz.trim() || null,
        ort:            ort.trim() || null,
        start_year:     startYear ? Number(startYear) : null,
        description:    description.trim() || null,
        customer_id:    customerId,
      })
      .eq('id', project.id)
      .select()
      .single()
    setSubmitting(false)
    if (error || !data) { setError(error?.message ?? 'Speichern fehlgeschlagen.'); return }
    onSaved(data as Project)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Projekt bearbeiten</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Name</label>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} disabled={submitting} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Projektnummer</label>
              <input className={inputClass} value={projectNumber} onChange={(e) => setProjectNumber(e.target.value)} disabled={submitting} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Startjahr</label>
              <input type="number" min={1900} max={2100} className={inputClass} value={startYear} onChange={(e) => setStartYear(e.target.value)} disabled={submitting} />
            </div>
          </div>

          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Strasse</label>
              <input className={inputClass} value={strasse} onChange={(e) => setStrasse(e.target.value)} disabled={submitting} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Nummer</label>
              <input className={inputClass} value={hausnummer} onChange={(e) => setHausnummer(e.target.value)} disabled={submitting} />
            </div>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-3">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">PLZ</label>
              <input
                className={inputClass}
                value={plz}
                onChange={(e) => setPlz(e.target.value)}
                inputMode="numeric"
                maxLength={5}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Ort</label>
              <input className={inputClass} value={ort} onChange={(e) => setOrt(e.target.value)} disabled={submitting} />
            </div>
          </div>

          <CustomerSelect value={customerId} onChange={setCustomerId} disabled={submitting} />

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Beschreibung</label>
            <textarea rows={3} className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} disabled={submitting} />
          </div>
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>Abbrechen</Button>
            <Button type="submit" disabled={submitting} className="bg-[#F2D3C2] text-slate-900 hover:bg-[#E7AF90]">
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" />Speichern…</> : 'Speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
