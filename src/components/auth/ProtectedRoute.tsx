import { Navigate, Outlet } from 'react-router-dom'
import { Loader2, ShieldAlert } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'

interface Props {
  requireAdmin?: boolean
}

export function ProtectedRoute({ requireAdmin = false }: Props) {
  const { session, profile, loading, signOut, isAdmin } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="h-7 w-7 animate-spin text-[#8B6956]" />
          <span className="text-sm">Wird geladen…</span>
        </div>
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/anmelden" replace />
  }

  // Kein Profil oder gesperrt → Daten bleiben durch RLS unsichtbar, hier nur UX
  if (!profile || profile.active === false) {
    return (
      <BlockedScreen
        title={profile ? 'Konto gesperrt' : 'Konto noch nicht aktiv'}
        message={
          profile
            ? 'Ihr Konto wurde durch einen Administrator deaktiviert. Bitte wenden Sie sich an Ihren Administrator.'
            : 'Für Ihren Account wurde noch kein Profil hinterlegt. Bitte wenden Sie sich an Ihren Administrator.'
        }
        onSignOut={signOut}
      />
    )
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}

function BlockedScreen({
  title,
  message,
  onSignOut,
}: {
  title: string
  message: string
  onSignOut: () => Promise<void>
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
          <ShieldAlert className="h-6 w-6 text-amber-600" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <Button
          onClick={() => onSignOut()}
          className="mt-6 w-full bg-slate-900 text-white hover:bg-slate-700"
        >
          Abmelden
        </Button>
      </div>
    </div>
  )
}
