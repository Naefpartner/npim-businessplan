import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
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

/**
 * Felder im Auftritt der Website: rechte Winkel, schwarze Linie, kein Schatten.
 * Der Fokus greift die Primärfarbe des Designsystems auf (Kupfer 7).
 */
const inputClass =
  'w-full border border-black/20 bg-white px-3.5 py-3 text-sm text-black '
  + 'placeholder:text-black/40 outline-none transition '
  + 'focus:border-[#B98C74] focus:ring-1 focus:ring-[#B98C74] disabled:opacity-50'

/** Knopf ebenso: schwarze Fläche, im Überfahren Kupfer. */
const buttonClass =
  'inline-flex w-full items-center justify-center gap-2 bg-black px-4 py-3 '
  + 'text-sm font-bold text-white transition hover:bg-[#8B6956] '
  + 'disabled:cursor-not-allowed disabled:opacity-60'

export function LoginPage() {
  const { session, loading, signIn } = useAuth()
  const [mode, setMode] = useState<Mode>(readInitialMode)

  // Eingeloggter User ohne Sonderfall → ins Dashboard.
  // Im Invite/Recovery-Modus muss er erst sein Passwort setzen.
  if (!loading && session && mode.kind !== 'invite' && mode.kind !== 'recovery') {
    return <Navigate to="/" replace />
  }

  if (mode.kind === 'invite' || mode.kind === 'recovery') {
    const invite = mode.kind === 'invite'
    return (
      <Frame
        titel={invite ? 'Konto aktivieren' : 'Neues Passwort'}
        lead={invite
          ? 'Willkommen. Legen Sie für Ihren Zugang ein Passwort fest.'
          : 'Legen Sie ein neues Passwort für Ihren Zugang fest.'}
      >
        <SetPasswordForm onDone={() => setMode({ kind: 'login' })} />
      </Frame>
    )
  }

  return (
    <Frame titel="Anmelden" lead="Projektbusinesspläne für Immobilienprojekte.">
      <SignInForm signIn={signIn} initialError={mode.kind === 'error' ? mode.message : null} />
    </Frame>
  )
}

// ─── Layout-Hülle ─────────────────────────────────────────────────────────────

/**
 * Die Anmeldeseite tritt auf wie die Titelseite von naefpartner.com: weisse
 * Fläche, die Wortmarke gross über die ganze Satzbreite, darunter eine Linie
 * mit dem Namen des Werkzeugs, dann ein Bild, dem unten rechts ein weisser
 * Kasten überlappt. Der Kasten trägt hier das Formular statt des Claims.
 *
 * Gesetzt in der Hausschrift Euclid NP; rechte Winkel, keine Schatten, schwarz
 * auf weiss — die Kupferfarbe erscheint nur im Fokus und im Überfahren.
 */
function Frame({ titel, lead, children }: {
  /** Überschrift im weissen Kasten. */
  titel: string
  /** Satz darunter; entfällt, wo der Kasten für sich spricht. */
  lead?: string
  children: React.ReactNode
}) {
  return (
    <div className="schrift-naef flex min-h-screen flex-col bg-white text-black lg:justify-center">
      <div className="mx-auto w-full max-w-[1180px] px-6 pb-12 pt-10 sm:px-10 lg:py-10">
        {/* Wortmarke — als Schrift, damit sie in jeder Breite scharf bleibt. */}
        {/* Auf schmalen Schirmen darf sie umbrechen: als eine Zeile zog sie die
            Seite in die Breite. */}
        <h1
          className="font-bold leading-[0.88] tracking-[-0.035em]"
          style={{ fontSize: 'clamp(2.25rem, 9.1vw, 7.6rem)' }}
        >
          Naef &amp; Partner
        </h1>

        <div className="mt-4 border-t border-black/15 pt-3">
          <span className="text-sm font-bold sm:text-base">Businessplan</span>
        </div>

        {/* Bild und Kasten: auf breiten Schirmen überlappt der Kasten die
            untere rechte Ecke, auf schmalen steht er darunter. */}
        <div className="relative mt-6">
          <img
            src={LOGIN_BG}
            alt=""
            className="h-[38vh] w-full object-cover sm:h-[46vh] lg:h-[54vh] lg:min-h-[400px]"
          />
          {/* Auf breiten Schirmen hängt der Kasten wie auf der Website über die
              untere rechte Ecke des Bildes hinaus. */}
          <div className="relative z-10 -mt-10 ml-auto w-full max-w-[26rem] bg-white px-7 pb-8 pt-7 sm:-mt-16 sm:px-10 lg:absolute lg:-bottom-10 lg:right-0 lg:mt-0">
            <h2
              className="font-bold leading-[1.05] tracking-[-0.02em]"
              style={{ fontSize: 'clamp(1.6rem, 3.2vw, 2.4rem)' }}
            >
              {titel}
            </h2>
            {lead && <p className="mt-2 text-sm text-black/60">{lead}</p>}
            <div className="mt-6">{children}</div>
          </div>
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
        <div className="flex items-start gap-2 border border-[#CC6666] bg-[#FFE6E6] px-3 py-2.5 text-sm text-[#994D4D]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button type="submit" className={buttonClass} disabled={submitting}>
        {submitting ? (
          <><Loader2 className="h-4 w-4 animate-spin" />Anmeldung läuft…</>
        ) : 'Anmelden'}
      </button>

      <p className="pt-2 text-xs leading-relaxed text-black/50">
        Der Zugang erfolgt ausschliesslich auf Einladung. Wenden Sie sich bei Bedarf
        an Ihren Administrator.
      </p>
    </form>
  )
}

// ─── Passwort-Setzen-Formular (Invite & Recovery) ─────────────────────────────

function SetPasswordForm({ onDone }: { onDone: () => void }) {
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
      <div className="flex items-start gap-3 border border-[#82AB92] bg-[#EDF7F1] px-4 py-4">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#62806E]" />
        <p className="text-sm text-black/70">
          Passwort gespeichert. Sie werden weitergeleitet…
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
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
        <div className="flex items-start gap-2 border border-[#CC6666] bg-[#FFE6E6] px-3 py-2.5 text-sm text-[#994D4D]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button type="submit" className={buttonClass} disabled={submitting}>
        {submitting ? (
          <><Loader2 className="h-4 w-4 animate-spin" />Wird gespeichert…</>
        ) : 'Passwort speichern'}
      </button>
    </form>
  )
}
