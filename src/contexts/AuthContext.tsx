import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export type UserRole = 'admin' | 'manager' | 'viewer'

export interface UserProfile {
  id: string
  full_name: string | null
  role: UserRole
  active: boolean
}

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: UserProfile | null
  loading: boolean
  isAdmin: boolean
  canWrite: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Hängt ein Auth- oder DB-Aufruf länger als das hier, brechen wir ab,
// damit die App nicht ewig im "Wird geladen" steht. Symptom war ein Token
// im localStorage, dessen User serverseitig gelöscht war – sowohl getSession()
// als auch der spätere signOut() blieben dann im Token-Refresh hängen.
//
// 10s ist im aktiven Tab großzügig (Supabase antwortet üblicherweise <500ms),
// in einem gedrosselten Hintergrund-Tab unter Umständen knapp. Wir
// kompensieren über die visibility-Heuristik unten: Token nur dann pauschal
// verwerfen, wenn der Tab gerade sichtbar ist.
const AUTH_TIMEOUT_MS = 10000

function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms)
    Promise.resolve(promise).then(
      (val) => { clearTimeout(handle); resolve(val) },
      (err) => { clearTimeout(handle); reject(err) },
    )
  })
}

// Synchron! Räumt das Auth-Token aus localStorage, ohne auf das Netzwerk zu warten.
function clearLocalAuthStorage() {
  if (typeof window === 'undefined') return
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith('sb-') && key.includes('-auth-token')) {
        window.localStorage.removeItem(key)
      }
    }
  } catch { /* localStorage evtl. nicht verfügbar (SSR, Privatmodus) */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadProfile(userId: string): Promise<UserProfile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role, active')
      .eq('id', userId)
      .maybeSingle()

    if (error || !data) return null
    return data as UserProfile
  }

  useEffect(() => {
    let cancelled = false

    async function init() {
      let initialSession: Session | null = null
      try {
        const { data } = await withTimeout(
          supabase.auth.getSession(),
          AUTH_TIMEOUT_MS,
          'getSession',
        )
        initialSession = data.session
      } catch (err) {
        // Im sichtbaren Tab darf getSession nicht hängen – Supabase liest
        // normalerweise nur localStorage. Ein Timeout heißt hier: das Token
        // ist tot und der proaktive Refresh hängt. Verwerfen, sonst feuert
        // gleich der onAuthStateChange-Listener mit der gecachten Session
        // und jeder Folge-Request hängt ebenfalls.
        // Im versteckten Tab dagegen ist Drosselung wahrscheinlicher als ein
        // echtes Token-Problem → Session beibehalten, beim nächsten DB-Zugriff
        // entscheidet der Server (401) ob das Token wirklich kaputt ist.
        const tabVisible = typeof document !== 'undefined' && document.visibilityState === 'visible'
        if (tabVisible) {
          console.warn('[AuthContext] getSession Timeout im aktiven Tab – Token verwerfen:', err)
          clearLocalAuthStorage()
          void supabase.auth.signOut({ scope: 'local' }).catch(() => { /* ignoriert */ })
        } else {
          console.warn('[AuthContext] getSession Timeout im Hintergrund-Tab – Session beibehalten:', err)
        }
        initialSession = null
      }

      if (cancelled) return
      setSession(initialSession)

      if (initialSession?.user) {
        let p: UserProfile | null = null
        let timedOut = false
        // Mehrere Versuche bei Timeout/Netzfehler — ein transienter Fehler soll
        // nicht fälschlich zu „kein Profil" / Logout führen.
        for (let attempt = 0; attempt < 3; attempt++) {
          timedOut = false
          try {
            p = await withTimeout(
              loadProfile(initialSession.user.id),
              AUTH_TIMEOUT_MS,
              'loadProfile',
            )
            break
          } catch (err) {
            console.warn(`[AuthContext] loadProfile Timeout/Fehler (Versuch ${attempt + 1}):`, err)
            timedOut = true
            p = null
          }
          if (cancelled) return
        }

        if (cancelled) return

        if (!p && !timedOut) {
          // Profil eindeutig nicht vorhanden (kein Timeout) → Token verwerfen
          console.warn('[AuthContext] Kein Profil zur Session – Token verwerfen')
          clearLocalAuthStorage()
          setSession(null)
          setProfile(null)
          void supabase.auth.signOut({ scope: 'local' }).catch(() => { /* ignoriert */ })
        } else if (p) {
          // Nur bei Erfolg setzen — bei Timeout Session beibehalten, der
          // onAuthStateChange-Listener / refreshProfile() versucht es erneut.
          setProfile(p)
        }
      }

      if (!cancelled) setLoading(false)
    }

    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      try {
        setSession(newSession)
        if (!newSession?.user) {
          setProfile(null)
          return
        }
        // TOKEN_REFRESHED feuert periodisch (und teils bei Tab-Fokus). Dabei
        // ändert sich nur das Token, nicht das Profil — kein Reload, sonst kann
        // ein transienter Fehler fälschlich „kein Profil" auslösen.
        if (event === 'TOKEN_REFRESHED') return

        let p: UserProfile | null = null
        try {
          p = await withTimeout(
            loadProfile(newSession.user.id),
            AUTH_TIMEOUT_MS,
            'loadProfile (onAuthStateChange)',
          )
        } catch (err) {
          console.warn('[AuthContext] loadProfile (Listener) Timeout/Fehler:', err)
        }
        // Nur bei erfolgreichem Laden überschreiben — ein transienter Fehler
        // (p === null wegen Timeout/Netz) darf ein bestehendes Profil nicht löschen.
        if (p) setProfile(p)
      } catch (err) {
        console.error('[AuthContext] auth state change failed:', err)
      }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  async function signIn(email: string, password: string): Promise<{ error: string | null }> {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      if (error.message === 'Invalid login credentials') {
        return { error: 'E-Mail oder Passwort ist falsch.' }
      }
      if (error.message === 'Email not confirmed') {
        return { error: 'Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse.' }
      }
      return { error: error.message }
    }
    return { error: null }
  }

  async function signOut() {
    clearLocalAuthStorage()
    setSession(null)
    setProfile(null)
    try {
      await withTimeout(supabase.auth.signOut(), AUTH_TIMEOUT_MS, 'signOut')
    } catch (err) {
      console.warn('[AuthContext] signOut Timeout/Fehler – State ist trotzdem leer:', err)
    }
  }

  async function refreshProfile() {
    if (!session?.user) return
    const p = await loadProfile(session.user.id)
    setProfile(p)
  }

  const isAdmin = profile?.role === 'admin' && profile.active === true
  const canWrite = (profile?.role === 'admin' || profile?.role === 'manager') && profile.active === true

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        isAdmin,
        canWrite,
        signIn,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth muss innerhalb von AuthProvider verwendet werden')
  return ctx
}
