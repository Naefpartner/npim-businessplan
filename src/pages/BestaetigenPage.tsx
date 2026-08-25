import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { NAEF_LOGO_SCHRIFT } from '@/assets/naef-logo-schrift'
import { LOGIN_BG } from '@/assets/login-bg'

// Diese Seite ist Ziel des Links in Invite-/Recovery-Mails. Sie ruft den
// One-Time-Token NICHT automatisch ab, sondern erst nach Klick auf den Button.
// Damit überleben die Tokens automatische Link-Scanner (z.B. Microsoft
// Defender Safe Links), die sonst beim Eingangs-Scan den Token verbrauchen
// und der User sieht "otp_expired".

type VerifyType = 'invite' | 'recovery' | 'signup' | 'magiclink' | 'email_change'

const VALID_TYPES = new Set<VerifyType>([
  'invite', 'recovery', 'signup', 'magiclink', 'email_change',
])

type Status =
  | { kind: 'idle';      tokenHash: string; type: VerifyType }
  | { kind: 'verifying'; type: VerifyType }
  | { kind: 'error';     message: string }

function readInitialStatus(): Status {
  if (typeof window === 'undefined') {
    return { kind: 'error', message: 'Bestätigung nicht möglich.' }
  }
  const params = new URLSearchParams(window.location.search)
  const tokenHash = params.get('token_hash')
  const rawType = params.get('type') as VerifyType | null
  if (!tokenHash || !rawType || !VALID_TYPES.has(rawType)) {
    return {
      kind: 'error',
      message: 'Der Bestätigungslink ist unvollständig. Bitte fordern Sie eine neue Einladung an.',
    }
  }
  return { kind: 'idle', tokenHash, type: rawType }
}

function friendly(message: string): string {
  if (/expired|invalid|not\s*found/i.test(message)) {
    return 'Der Link ist abgelaufen oder bereits verwendet. Bitte fordern Sie eine neue Einladung an.'
  }
  return message
}

export function BestaetigenPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<Status>(readInitialStatus)

  async function handleConfirm() {
    if (status.kind !== 'idle') return
    const type = status.type
    setStatus({ kind: 'verifying', type })

    const { error } = await supabase.auth.verifyOtp({
      token_hash: status.tokenHash,
      type,
    })

    if (error) {
      setStatus({ kind: 'error', message: friendly(error.message) })
      return
    }

    // Token wurde gerade in eine Session umgewandelt. URL bereinigen, damit
    // ein Reload nicht erneut verify versucht.
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/auth/bestaetigen')
    }

    // LoginPage übernimmt den Passwort-Setzen-Flow anhand des Hash-Werts.
    const hashType = type === 'recovery' ? 'recovery' : 'invite'
    navigate({ pathname: '/anmelden', hash: `#type=${hashType}` }, { replace: true })
  }

  const isRecovery =
    status.kind === 'idle' || status.kind === 'verifying'
      ? status.type === 'recovery'
      : false

  return (
    <div className="flex min-h-screen">
      <div className="hidden lg:block lg:w-1/2 relative">
        <img src={LOGIN_BG} alt="" className="absolute inset-0 h-full w-full object-cover" />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center bg-white px-10 py-16">
        <div className="w-full max-w-sm space-y-10">
          <img src={NAEF_LOGO_SCHRIFT} alt="Naef & Partner" className="w-full h-auto" />

          {status.kind === 'error' ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{status.message}</span>
              </div>
              <Button
                onClick={() => navigate('/anmelden', { replace: true })}
                className="w-full bg-slate-900 text-white hover:bg-slate-700"
              >
                Zur Anmeldung
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-900">
                  {isRecovery ? 'Passwort zurücksetzen' : 'Konto aktivieren'}
                </h2>
                <p className="text-xs text-slate-500">
                  {isRecovery
                    ? 'Bitte bestätigen Sie den Vorgang, um ein neues Passwort zu setzen.'
                    : 'Willkommen. Bitte bestätigen Sie die Einladung, um Ihren Zugang einzurichten.'}
                </p>
              </div>
              <Button
                onClick={handleConfirm}
                disabled={status.kind === 'verifying'}
                className="w-full bg-slate-900 text-white hover:bg-slate-700"
              >
                {status.kind === 'verifying' ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Wird bestätigt…</>
                ) : (
                  isRecovery ? 'Passwort-Reset bestätigen' : 'Einladung annehmen'
                )}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
