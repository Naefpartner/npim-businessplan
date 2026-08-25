import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, User, ChevronDown, Sun, Moon, Undo2, Redo2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'
import { useUndo } from '@/contexts/UndoContext'

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = IS_MAC ? '⌘' : 'Ctrl'

export function Header() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const { theme, toggle } = useTheme()
  const { undo, redo, canUndo, canRedo, undoLabel, redoLabel } = useUndo()

  const displayName = user?.user_metadata?.full_name ?? user?.email ?? 'Benutzer'
  const initials = displayName
    .split(' ')
    .map((w: string) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  async function handleSignOut() {
    setMenuOpen(false)
    await signOut()
    navigate('/anmelden', { replace: true })
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6 shrink-0">
      {/* Linke Seite: Seitenkontext (leer – Titel kommt aus der Page) */}
      <div />

      {/* Rechte Seite: Undo/Redo + Theme-Toggle + Benutzer-Menü */}
      <div className="flex items-center gap-2">
        <div className="flex items-center">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-30"
            title={canUndo ? `Rückgängig${undoLabel ? ': ' + undoLabel : ''} (${MOD}+Z)` : `Rückgängig (${MOD}+Z)`}
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-30"
            title={canRedo ? `Wiederherstellen${redoLabel ? ': ' + redoLabel : ''} (${MOD}+Shift+Z)` : `Wiederherstellen (${MOD}+Shift+Z)`}
          >
            <Redo2 className="h-4 w-4" />
          </button>
        </div>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button
          onClick={toggle}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100"
          title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
        >
          {theme === 'dark'
            ? <Sun className="h-4 w-4" />
            : <Moon className="h-4 w-4" />}
        </button>

      <div className="relative">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-slate-700 transition hover:bg-slate-100"
          aria-expanded={menuOpen}
          aria-haspopup="true"
        >
          {/* Avatar */}
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#8B6956] text-xs font-semibold text-white">
            {initials || <User className="h-3.5 w-3.5" />}
          </span>
          <span className="hidden max-w-[140px] truncate sm:block font-medium">
            {displayName}
          </span>
          <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
        </button>

        {menuOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-10"
              onClick={() => setMenuOpen(false)}
            />
            {/* Dropdown */}
            <div className="absolute right-0 z-20 mt-1.5 w-56 rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg">
              <div className="border-b border-slate-100 px-4 py-2.5">
                <p className="truncate text-xs font-medium text-slate-900">{displayName}</p>
                {user?.email && displayName !== user.email && (
                  <p className="truncate text-xs text-slate-500">{user.email}</p>
                )}
              </div>

              <button
                onClick={handleSignOut}
                className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
              >
                <LogOut className="h-4 w-4 text-slate-400" />
                Abmelden
              </button>
            </div>
          </>
        )}
      </div>
      </div>
    </header>
  )
}
