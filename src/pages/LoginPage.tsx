import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { NAEF_LOGO_SCHRIFT } from '@/assets/naef-logo-schrift'
import { LOGIN_BG } from '@/assets/login-bg'

type Mode =
  | { kind: 'login' }
  | { kind: 'invite' }
  | { kind: 'recovery' }
  | { kind: 'error'; message: string }

function readInitialMode(): Mode {
  if (typeof window === 'undefined') return { kind: 'login' }
  const hash = window.location.hash
  if (!hash || hash.length < 2) return { kind: 'login' }

  const params = new URLSearchParams(hash.slice(1))
  const errorCode = params.get('error_code') ?? params.get('error')
  if (errorCode) {
    return { kind: 'error', message: friendlyError(errorCode, params.get('error_description')) }
  }

  const type = params.get('type')
  if (type === 'invite' || type === 'signup') return { kind: 'invite' }
  if (type === 'recovery')                    return { kind: 'recovery' }
  return { kind: 'login' }
}

function friendlyError(code: string, description: string | null): string {
  const desc = description ? description.replace(/\+/g, ' ') : ''
  if (code === 'otp_expired') {
    return 'Der Einladungs- oder Bestätigungslink ist abgelaufen oder wurde bereits verwendet. Bitte fordern Sie bei Ihrem Administrator eine neue Einladung an.'
  }
  if (code === 'access_denied') {
    return 'Der Zugriff wurde verweigert. Möglicherweise ist der Link nicht mehr gültig. Bitte wenden Sie sich an Ihren Administrator.'
  }
  return desc || 'Der Link ist ungültig. Bitte wenden Sie sich an Ihren Administrator.'
}

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:opacity-50'

export function LoginPage() {
  const { session, loading, signIn } = useAuth()
  const [mode, setMode] = useState<Mode>(readInitialMode)

  // Eingeloggter User ohne Sonderfall → ins Dashboard.
  // Im Invite/Recovery-Modus muss er erst sein Passwort setzen.
  if (!loading && session && mode.kind !== 'invite' && mode.kind !== 'recovery') {
    return <Navigate to="/" replace />
  }

  if (mode.kind === 'invite' || mode.kind === 'recovery') {
    return (
      <Frame>
        <SetPasswordForm
          isInvite={mode.kind === 'invite'}
          onDone={() => setMode({ kind: 'login' })}
        />
      </Frame>
    )
  }

  return (
    <Frame>
      <SignInForm signIn={signIn} initialError={mode.kind === 'error' ? mode.message : null} />
    </Frame>
  )
}

// ─── Layout-Hülle ─────────────────────────────────────────────────────────────

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <div className="hidden lg:block lg:w-1/2 relative">
        <img src={LOGIN_BG} alt="" className="absolute inset-0 h-full w-full object-cover" />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center bg-white px-10 py-16">
        <div className="w-full max-w-sm space-y-10">
          <img src={NAEF_LOGO_SCHRIFT} alt="Naef & Partner" className="w-full h-auto" />
          {children}
        </div>
      </div>
    </div>
  )
}

// ─── Login-Formular ───────────────────────────────────────────────────────────

function SignInForm({
  signIn,
  initialError,
}: {
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  initialError: string | null
}) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(initialError)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error } = await signIn(email, password)
    if (error) setError(error)
    setSubmitting(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="E-Mail"
        className={inputClass}
        disabled={submitting}
      />
      <input
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Passwort"
        className={inputClass}
        disabled={submitting}
      />

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button
        type="submit"
        className="w-full bg-slate-900 text-white hover:bg-slate-700"
        disabled={submitting}
      >
        {submitting ? (
          <><Loader2 className="h-4 w-4 animate-spin" />Anmeldung läuft…</>
        ) : 'Anmelden'}
      </Button>

      <p className="pt-4 text-center text-xs text-slate-500">
        Der Zugang erfolgt ausschliesslich auf Einladung.<br />
        Wenden Sie sich bei Bedarf an Ihren Administrator.
      </p>
    </form>
  )
}

// ─── Passwort-Setzen-Formular (Invite & Recovery) ─────────────────────────────

function SetPasswordForm({
  isInvite,
  onDone,
}: {
  isInvite: boolean
  onDone: () => void
}) {
  const { refreshProfile } = useAuth()
  const [password, setPassword]       = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [submitting, setSubmitting]   = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [success, setSuccess]         = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Das Passwort muss mindestens 8 Zeichen lang sein.')
      return
    }
    if (password !== confirmation) {
      setError('Die beiden Passwörter stimmen nicht überein.')
      return
    }

    setSubmitting(true)
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setSubmitting(false)
      setError(error.message)
      return
    }

    // Profil im AuthContext laden, BEVOR wir auf geschützte Routen navigieren –
    // sonst sieht ProtectedRoute kurz session ohne profile und zeigt
    // "Konto noch nicht aktiv".
    await refreshProfile()
    setSubmitting(false)
    setSuccess(true)
    // Hash bereinigen, damit ein Neuladen nicht in den Invite-Modus zurückspringt
    if (typeof window !== 'undefined' && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
    // Kurz Erfolgsmeldung zeigen, dann normalen Login-Flow auslösen.
    // Da bereits eine Session besteht, leitet LoginPage automatisch auf / weiter.
    setTimeout(onDone, 1200)
  }

  if (success) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-6 text-center">
        <CheckCircle2 className="h-7 w-7 text-emerald-600" />
        <p className="text-sm text-slate-700">
          Passwort gespeichert. Sie werden weitergeleitet…
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-slate-900">
          {isInvite ? 'Konto aktivieren' : 'Neues Passwort setzen'}
        </h2>
        <p className="text-xs text-slate-500">
          {isInvite
            ? 'Willkommen. Bitte legen Sie für Ihren Zugang ein Passwort fest.'
            : 'Bitte legen Sie ein neues Passwort für Ihren Zugang fest.'}
        </p>
      </div>

      <input
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Neues Passwort (min. 8 Zeichen)"
        className={inputClass}
        disabled={submitting}
      />
      <input
        type="password"
        autoComplete="new-password"
        required
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
        placeholder="Passwort bestätigen"
        className={inputClass}
        disabled={submitting}
      />

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button
        type="submit"
        className="w-full bg-slate-900 text-white hover:bg-slate-700"
        disabled={submitting}
      >
        {submitting ? (
          <><Loader2 className="h-4 w-4 animate-spin" />Wird gespeichert…</>
        ) : 'Passwort speichern'}
      </Button>
    </form>
  )
}
