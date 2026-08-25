import { Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { UndoProvider, useUndo } from '@/contexts/UndoContext'

// Leert den Undo-Verlauf bei Seitenwechsel (Navigationsgrenze).
function ClearUndoOnNavigate() {
  const { pathname } = useLocation()
  const { clear } = useUndo()
  useEffect(() => { clear() }, [pathname, clear])
  return null
}

export function AppLayout() {
  return (
    <UndoProvider>
      <ClearUndoOnNavigate />
      <div className="flex h-screen overflow-hidden bg-slate-50">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto overflow-x-hidden">
            {/* Max. Breite so, dass die Mengen-Tabelle (inkl. Wohnungsmix) vollständig
                sichtbar ist; auf grossen Bildschirmen wird zentriert statt gestreckt. */}
            <div className="mx-auto max-w-[2000px] px-8 py-6">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </UndoProvider>
  )
}
