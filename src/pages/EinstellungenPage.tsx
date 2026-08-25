import { useState } from 'react'
import { Settings, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useAppSettings } from '@/hooks/useAppSettings'

const ROLE_LABEL: Record<string, string> = {
  admin:   'Administrator',
  manager: 'Bearbeiter',
  viewer:  'Betrachter',
}

export function EinstellungenPage() {
  const { user, profile } = useAuth()
  const canWrite = profile?.role === 'admin' || profile?.role === 'manager'
  const { mwstDefault, saveMwstDefault, loading } = useAppSettings()

  // MWST als %-Zahl bearbeiten (intern 0–1).
  const [raw, setRaw] = useState<string | null>(null)
  const disp = (mwstDefault * 100).toFixed(1)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#FAEFE9]">
          <Settings className="h-5 w-5 text-[#8B6956]" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Einstellungen</h1>
          <p className="text-sm text-slate-500">Persönliche Angaben und Anwendung</p>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-700">Konto</h2>
        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
          <div>
            <dt className="text-slate-500">Name</dt>
            <dd className="text-slate-900">{profile?.full_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">E-Mail</dt>
            <dd className="text-slate-900">{user?.email ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Rolle</dt>
            <dd className="text-slate-900">{profile ? (ROLE_LABEL[profile.role] ?? profile.role) : '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Status</dt>
            <dd className="text-slate-900">{profile?.active ? 'aktiv' : 'gesperrt'}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-700">Standardwerte</h2>
        <p className="mt-1 text-xs text-slate-500">
          Gilt anwendungsweit für neu erstellte Projekte/Varianten und den Honorarrechner.
        </p>
        <div className="mt-4 flex items-center gap-3 text-sm">
          <label className="text-slate-600">Mehrwertsteuer (Standard)</label>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
          ) : (
            <div className="inline-flex items-center gap-1">
              <input
                type="text" inputMode="decimal" disabled={!canWrite}
                value={raw ?? disp}
                onFocus={() => setRaw(disp)}
                onChange={(e) => setRaw(e.target.value)}
                onBlur={() => {
                  const n = parseFloat((raw ?? '').replace(',', '.'))
                  if (Number.isFinite(n)) void saveMwstDefault(n / 100)
                  setRaw(null)
                }}
                className="w-20 rounded border border-slate-300 px-2 py-1 text-right tabular-nums text-slate-900 outline-none focus:border-[#8B6956] disabled:bg-slate-50 disabled:text-slate-400"
              />
              <span className="text-slate-400">%</span>
            </div>
          )}
          {!canWrite && <span className="text-xs text-slate-400">(nur Bearbeiter/Administrator)</span>}
        </div>
      </section>
    </div>
  )
}
