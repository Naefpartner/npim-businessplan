import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Users,
  Plus,
  Search,
  AlertCircle,
  Loader2,
  Mail,
  Shield,
  ShieldOff,
  CheckCircle2,
  XCircle,
  FolderOpen,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth, type UserRole } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/** Ein Projekt, wie es die Zuordnung braucht. */
interface ProjektRow {
  id: string
  name: string
  project_number: string | null
  archived: boolean
}

interface ProfileRow {
  id: string
  full_name: string | null
  role: UserRole
  active: boolean
  created_at: string
  email?: string | null
}

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm outline-none transition focus:border-[#8B6956] focus:ring-2 focus:ring-[#8B6956]/20 disabled:opacity-50'

const roleLabel: Record<UserRole, string> = {
  admin:   'Administrator',
  manager: 'Bearbeiter',
  viewer:  'Betrachter',
}

const roleBadgeClass: Record<UserRole, string> = {
  admin:   'bg-amber-100 text-amber-800',
  manager: 'bg-blue-100 text-blue-800',
  viewer:  'bg-slate-100 text-slate-700',
}

export function BenutzerverwaltungPage() {
  const { user: currentUser } = useAuth()
  const [rows, setRows]         = useState<ProfileRow[]>([])
  const [projekte, setProjekte] = useState<ProjektRow[]>([])
  /** Zugeordnete Projekte je Benutzer. */
  const [zuordnung, setZuordnung] = useState<Record<string, string[]>>({})
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [search, setSearch]     = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  /** Benutzer, dessen Projekte gerade zugeordnet werden. */
  const [zuordnenFuer, setZuordnenFuer] = useState<ProfileRow | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    const [profileRes, projektRes, memberRes] = await Promise.all([
      supabase.from('profiles')
        .select('id, full_name, role, active, created_at')
        .order('created_at', { ascending: false }),
      supabase.from('projects')
        .select('id, name, project_number, archived')
        .order('name'),
      supabase.from('project_members').select('project_id, user_id'),
    ])

    const fehler = profileRes.error ?? projektRes.error ?? memberRes.error
    if (fehler) setError(fehler.message)
    else {
      setRows((profileRes.data ?? []) as ProfileRow[])
      setProjekte((projektRes.data ?? []) as ProjektRow[])
      const nach: Record<string, string[]> = {}
      for (const m of (memberRes.data ?? []) as { project_id: string; user_id: string }[]) {
        (nach[m.user_id] ??= []).push(m.project_id)
      }
      setZuordnung(nach)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      (r.full_name ?? '').toLowerCase().includes(q) ||
      r.role.toLowerCase().includes(q),
    )
  }, [rows, search])

  async function changeRole(id: string, role: UserRole) {
    const { error } = await supabase.from('profiles').update({ role }).eq('id', id)
    if (error) { setError(error.message); return }
    await load()
  }

  async function toggleActive(id: string, active: boolean) {
    const { error } = await supabase.from('profiles').update({ active }).eq('id', id)
    if (error) { setError(error.message); return }
    await load()
  }

  return (
    <div className="space-y-6">
      {/* Kopf */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#FAEFE9]">
            <Users className="h-5 w-5 text-[#8B6956]" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Benutzerverwaltung</h1>
            <p className="text-sm text-slate-500">
              Einladungen versenden, Rollen vergeben, Konten aktivieren oder sperren.
            </p>
          </div>
        </div>
        <Button
          onClick={() => setInviteOpen(true)}
          className="bg-[#F2D3C2] text-slate-900 hover:bg-[#E7AF90]"
        >
          <Plus className="h-4 w-4" />
          Benutzer einladen
        </Button>
      </div>

      {/* Suche */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Suchen…"
          className={cn(inputClass, 'pl-9')}
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Tabelle */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Wird geladen…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">
            Keine Benutzer gefunden.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Rolle</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Projekte</th>
                <th className="px-4 py-3 text-right font-medium">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((row) => {
                const isSelf = row.id === currentUser?.id
                return (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">
                        {row.full_name ?? '—'}
                        {isSelf && <span className="ml-2 text-xs font-normal text-slate-400">(Sie)</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={row.role}
                        disabled={isSelf}
                        onChange={(e) => changeRole(row.id, e.target.value as UserRole)}
                        className={cn(
                          'rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium',
                          roleBadgeClass[row.role],
                          isSelf && 'cursor-not-allowed opacity-60',
                        )}
                      >
                        <option value="admin">{roleLabel.admin}</option>
                        <option value="manager">{roleLabel.manager}</option>
                        <option value="viewer">{roleLabel.viewer}</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {row.active ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                          <CheckCircle2 className="h-3 w-3" /> Aktiv
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800">
                          <XCircle className="h-3 w-3" /> Gesperrt
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.role === 'admin' ? (
                        <span className="text-xs text-slate-500">
                          alle ({projekte.length})
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setZuordnenFuer(row)}
                          className="gap-1.5 px-2 text-xs font-medium text-slate-700"
                        >
                          <FolderOpen className="h-3.5 w-3.5 text-[#8B6956]" />
                          {(zuordnung[row.id] ?? []).length} von {projekte.length}
                        </Button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {row.active ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isSelf}
                            onClick={() => toggleActive(row.id, false)}
                            title="Konto sperren"
                          >
                            <ShieldOff className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleActive(row.id, true)}
                            title="Konto entsperren"
                          >
                            <Shield className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={load}
      />

      <ProjektZuordnungModal
        benutzer={zuordnenFuer}
        projekte={projekte}
        zugeordnet={zuordnenFuer ? (zuordnung[zuordnenFuer.id] ?? []) : []}
        onClose={() => setZuordnenFuer(null)}
        onGespeichert={load}
      />
    </div>
  )
}

// ─── Projektzuordnung ─────────────────────────────────────────────────────────

/**
 * Ordnet einem Benutzer Projekte zu. Wer kein Administrator ist, sieht in der
 * ganzen Anwendung nur die hier angehakten Projekte — die Datenbank setzt das
 * durch (Migration 071), nicht die Oberfläche.
 */
function ProjektZuordnungModal({
  benutzer,
  projekte,
  zugeordnet,
  onClose,
  onGespeichert,
}: {
  benutzer: ProfileRow | null
  projekte: ProjektRow[]
  zugeordnet: string[]
  onClose: () => void
  onGespeichert: () => void
}) {
  const [gewaehlt, setGewaehlt] = useState<Set<string>>(new Set())
  const [suche, setSuche] = useState('')
  const [speichert, setSpeichert] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)

  useEffect(() => {
    if (benutzer) { setGewaehlt(new Set(zugeordnet)); setSuche(''); setFehler(null) }
    // Nur beim Öffnen setzen: während des Bearbeitens soll die Liste stehen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [benutzer])

  const gefiltert = useMemo(() => {
    const q = suche.trim().toLowerCase()
    if (!q) return projekte
    return projekte.filter((p) =>
      p.name.toLowerCase().includes(q)
      || (p.project_number ?? '').toLowerCase().includes(q))
  }, [projekte, suche])

  if (!benutzer) return null

  const umschalten = (id: string) => setGewaehlt((alt) => {
    const neu = new Set(alt)
    if (neu.has(id)) neu.delete(id)
    else neu.add(id)
    return neu
  })

  async function speichern() {
    if (!benutzer) return
    setSpeichert(true)
    setFehler(null)
    const vorher = new Set(zugeordnet)
    const dazu = [...gewaehlt].filter((id) => !vorher.has(id))
    const weg  = [...vorher].filter((id) => !gewaehlt.has(id))

    if (dazu.length > 0) {
      const { error } = await supabase.from('project_members')
        .insert(dazu.map((project_id) => ({ project_id, user_id: benutzer.id })))
      if (error) { setFehler(error.message); setSpeichert(false); return }
    }
    if (weg.length > 0) {
      const { error } = await supabase.from('project_members')
        .delete().eq('user_id', benutzer.id).in('project_id', weg)
      if (error) { setFehler(error.message); setSpeichert(false); return }
    }
    setSpeichert(false)
    onGespeichert()
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Projekte zuordnen</DialogTitle>
          <DialogDescription>
            {benutzer.full_name ?? 'Benutzer'} sieht in der ganzen Anwendung nur die
            angehakten Projekte — samt Varianten, Mengen, Kosten und Berichten.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder="Projekt suchen…"
            className={cn(inputClass, 'pl-9')}
          />
        </div>

        <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1">
          {gefiltert.length === 0 ? (
            <p className="p-4 text-center text-sm text-slate-500">Kein Projekt gefunden.</p>
          ) : gefiltert.map((p) => (
            <label
              key={p.id}
              className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={gewaehlt.has(p.id)}
                onChange={() => umschalten(p.id)}
                className="h-4 w-4 accent-[#8B6956]"
              />
              <span className="min-w-0 flex-1 truncate text-slate-800">{p.name}</span>
              {p.project_number && (
                <span className="shrink-0 text-xs text-slate-400">{p.project_number}</span>
              )}
              {p.archived && (
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                  archiviert
                </span>
              )}
            </label>
          ))}
        </div>

        {fehler && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{fehler}</span>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={speichert}>Abbrechen</Button>
          <Button
            onClick={speichern}
            disabled={speichert}
            className="bg-[#F2D3C2] text-slate-900 hover:bg-[#E7AF90]"
          >
            {speichert
              ? <><Loader2 className="h-4 w-4 animate-spin" />Wird gespeichert…</>
              : `${gewaehlt.size} Projekt${gewaehlt.size === 1 ? '' : 'e'} zuordnen`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Einladungs-Modal ─────────────────────────────────────────────────────────

function InviteModal({
  open,
  onClose,
  onInvited,
}: {
  open: boolean
  onClose: () => void
  onInvited: () => void
}) {
  const [email, setEmail]       = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole]         = useState<UserRole>('viewer')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [success, setSuccess]   = useState(false)

  useEffect(() => {
    if (open) {
      setEmail(''); setFullName(''); setRole('viewer')
      setError(null); setSuccess(false)
    }
  }, [open])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const { data, error } = await supabase.functions.invoke('invite-user', {
      body: { email, full_name: fullName, role },
    })

    setSubmitting(false)

    if (error) {
      // supabase-js verbirgt den eigentlichen Function-Fehler hinter
      // "non-2xx status code". Den echten Text aus der Response lesen.
      let detail = error.message
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.text === 'function') {
        try {
          const body = await ctx.text()
          const parsed = body ? JSON.parse(body) : null
          if (parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error) {
            detail = String(parsed.error)
          } else if (body) {
            detail = body
          }
        } catch {
          /* Body kein JSON oder schon konsumiert – generische Meldung behalten */
        }
      }
      setError(detail)
      return
    }
    if (data && typeof data === 'object' && 'error' in data && data.error) {
      setError(String(data.error))
      return
    }

    setSuccess(true)
    onInvited()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-[#8B6956]" />
            Benutzer einladen
          </DialogTitle>
          <DialogDescription>
            Es wird eine E-Mail mit Einladungslink versendet. Der Empfänger setzt
            beim ersten Zugriff sein Passwort.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-6 text-center">
            <CheckCircle2 className="h-7 w-7 text-emerald-600" />
            <p className="text-sm text-slate-700">
              Einladung an <span className="font-medium">{email}</span> versendet.
            </p>
            <Button onClick={onClose} className="bg-slate-900 text-white hover:bg-slate-700">
              Schliessen
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">
                Vollständiger Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Max Muster"
                className={inputClass}
                disabled={submitting}
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">
                E-Mail-Adresse <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="max.muster@beispiel.ch"
                className={inputClass}
                disabled={submitting}
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">
                Rolle <span className="text-red-500">*</span>
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className={inputClass}
                disabled={submitting}
              >
                <option value="viewer">Betrachter — nur lesen</option>
                <option value="manager">Bearbeiter — lesen und ändern</option>
                <option value="admin">Administrator — Vollzugriff inkl. Benutzerverwaltung</option>
              </select>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={submitting}
              >
                Abbrechen
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-[#F2D3C2] text-slate-900 hover:bg-[#E7AF90]"
              >
                {submitting ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Sende Einladung…</>
                ) : 'Einladung senden'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
