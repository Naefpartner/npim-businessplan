import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, Plus, Loader2, AlertCircle, Pencil, Trash2, Save, FolderKanban,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useCustomers, type CustomerInput } from '@/hooks/useCustomers'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  CUSTOMER_KIND_LABEL,
  customerAddressLine,
  type Customer,
  type CustomerKind,
} from '@/types'

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm outline-none transition focus:border-[#8B6956] focus:ring-2 focus:ring-[#8B6956]/20 disabled:opacity-50'

export function KundenPage() {
  const { canWrite } = useAuth()
  const navigate = useNavigate()
  const { customers, loading, error, createCustomer, updateCustomer, deleteCustomer } = useCustomers()
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Customer | null>(null)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#FAEFE9]">
            <Users className="h-5 w-5 text-[#8B6956]" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Kunden</h1>
            <p className="text-sm text-slate-500">
              Auftraggeber/Bauherren, die einem Projekt zugewiesen werden können.
            </p>
          </div>
        </div>
        {canWrite && (
          <Button
            onClick={() => setCreateOpen(true)}
            className="bg-[#F2D3C2] text-slate-900 hover:bg-[#E7AF90]"
          >
            <Plus className="h-4 w-4" />
            Neuer Kunde
          </Button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Wird geladen…
          </div>
        ) : customers.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">
            Noch keine Kunden erfasst.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Typ</th>
                <th className="px-4 py-3 text-left font-medium">Adresse</th>
                <th className="px-4 py-3 text-left font-medium">Kontakt</th>
                <th className="px-4 py-3 text-right font-medium">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customers.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/projekte?kunde=${c.id}`)}
                  title={`Projekte von „${c.name}" anzeigen`}
                  className="cursor-pointer hover:bg-slate-50"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{c.name}</div>
                    {c.typ === 'privat' && (c.vorname || c.nachname) && (
                      <div className="text-xs text-slate-500">
                        {[c.vorname, c.nachname].filter(Boolean).join(' ')}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{CUSTOMER_KIND_LABEL[c.typ]}</td>
                  <td className="px-4 py-3 text-slate-600">{customerAddressLine(c) ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">
                    <div className="space-y-0.5">
                      {c.email && <div className="text-xs">{c.email}</div>}
                      {c.telefon && <div className="text-xs">{c.telefon}</div>}
                      {!c.email && !c.telefon && '—'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); navigate(`/projekte?kunde=${c.id}`) }}
                        title="Projekte dieses Kunden anzeigen"
                      >
                        <FolderKanban className="h-4 w-4" />
                      </Button>
                      {canWrite && (
                        <>
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setEditTarget(c) }} title="Bearbeiten">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (confirm(`Kunde "${c.name}" löschen? Bestehende Projekte verlieren die Verknüpfung.`)) {
                                deleteCustomer(c.id)
                              }
                            }}
                            title="Löschen"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CustomerDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Neuer Kunde"
        onSubmit={async (input) => !!(await createCustomer(input))}
      />
      <CustomerDialog
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={editTarget ? `Kunde "${editTarget.name}" bearbeiten` : ''}
        initial={editTarget ?? undefined}
        onSubmit={async (input) => {
          if (!editTarget) return false
          return updateCustomer(editTarget.id, input)
        }}
      />
    </div>
  )
}

// ─── Kunden-Dialog (Anlegen + Bearbeiten) ───────────────────────────────────

function CustomerDialog({
  open,
  onClose,
  title,
  initial,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  title: string
  initial?: Customer
  onSubmit: (input: CustomerInput) => Promise<boolean>
}) {
  const [name, setName]       = useState('')
  const [typ, setTyp]         = useState<CustomerKind>('firma')
  const [vorname, setVorname] = useState('')
  const [nachname, setNachname] = useState('')
  const [strasse, setStrasse] = useState('')
  const [hausnummer, setHausnummer] = useState('')
  const [plz, setPlz]         = useState('')
  const [ort, setOrt]         = useState('')
  const [land, setLand]       = useState('Schweiz')
  const [email, setEmail]     = useState('')
  const [telefon, setTelefon] = useState('')
  const [website, setWebsite] = useState('')
  const [notizen, setNotizen] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '')
      setTyp(initial?.typ ?? 'firma')
      setVorname(initial?.vorname ?? '')
      setNachname(initial?.nachname ?? '')
      setStrasse(initial?.strasse ?? '')
      setHausnummer(initial?.hausnummer ?? '')
      setPlz(initial?.plz ?? '')
      setOrt(initial?.ort ?? '')
      setLand(initial?.land ?? 'Schweiz')
      setEmail(initial?.email ?? '')
      setTelefon(initial?.telefon ?? '')
      setWebsite(initial?.website ?? '')
      setNotizen(initial?.notizen ?? '')
      setError(null)
    }
  }, [open, initial])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Bitte einen Namen eingeben.')
      return
    }
    setError(null); setSubmitting(true)

    const input: CustomerInput = {
      name:       name.trim(),
      typ,
      vorname:    typ === 'privat' ? (vorname.trim() || null) : null,
      nachname:   typ === 'privat' ? (nachname.trim() || null) : null,
      strasse:    strasse.trim() || null,
      hausnummer: hausnummer.trim() || null,
      plz:        plz.trim() || null,
      ort:        ort.trim() || null,
      land:       land.trim() || null,
      email:      email.trim() || null,
      telefon:    telefon.trim() || null,
      website:    website.trim() || null,
      notizen:    notizen.trim() || null,
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
          <DialogDescription>
            {typ === 'privat'
              ? 'Anzeigename als Pflichtfeld; Vor-/Nachname für strukturierte Eingabe.'
              : 'Name als Pflichtfeld; Adresse und Kontaktdaten optional.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-[1fr_180px] gap-3">
            <Field label="Name / Firma" required>
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={submitting}
                placeholder={typ === 'privat' ? 'Müller, Hans' : typ === 'genossenschaft' ? 'Wohnbaugenossenschaft Limmat' : 'Müller AG'}
              />
            </Field>
            <Field label="Typ">
              <select
                className={inputClass}
                value={typ}
                onChange={(e) => setTyp(e.target.value as CustomerKind)}
                disabled={submitting}
              >
                {(Object.keys(CUSTOMER_KIND_LABEL) as CustomerKind[]).map((k) => (
                  <option key={k} value={k}>{CUSTOMER_KIND_LABEL[k]}</option>
                ))}
              </select>
            </Field>
          </div>

          {typ === 'privat' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Vorname">
                <input
                  className={inputClass}
                  value={vorname}
                  onChange={(e) => setVorname(e.target.value)}
                  disabled={submitting}
                />
              </Field>
              <Field label="Nachname">
                <input
                  className={inputClass}
                  value={nachname}
                  onChange={(e) => setNachname(e.target.value)}
                  disabled={submitting}
                />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-[1fr_120px] gap-3">
            <Field label="Strasse">
              <input
                className={inputClass}
                value={strasse}
                onChange={(e) => setStrasse(e.target.value)}
                disabled={submitting}
              />
            </Field>
            <Field label="Nummer">
              <input
                className={inputClass}
                value={hausnummer}
                onChange={(e) => setHausnummer(e.target.value)}
                disabled={submitting}
              />
            </Field>
          </div>

          <div className="grid grid-cols-[120px_1fr_160px] gap-3">
            <Field label="PLZ">
              <input
                className={inputClass}
                value={plz}
                onChange={(e) => setPlz(e.target.value)}
                inputMode="numeric"
                maxLength={5}
                disabled={submitting}
              />
            </Field>
            <Field label="Ort">
              <input
                className={inputClass}
                value={ort}
                onChange={(e) => setOrt(e.target.value)}
                disabled={submitting}
              />
            </Field>
            <Field label="Land">
              <input
                className={inputClass}
                value={land}
                onChange={(e) => setLand(e.target.value)}
                disabled={submitting}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="E-Mail">
              <input
                type="email"
                className={inputClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
            </Field>
            <Field label="Telefon">
              <input
                className={inputClass}
                value={telefon}
                onChange={(e) => setTelefon(e.target.value)}
                disabled={submitting}
              />
            </Field>
          </div>

          <Field label="Website">
            <input
              className={inputClass}
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              disabled={submitting}
              placeholder="https://"
            />
          </Field>

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
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  )
}
