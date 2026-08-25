import { NavLink } from 'react-router-dom'
import { NAEF_LOGO_SCHRIFT } from '@/assets/naef-logo-schrift'
import {
  FolderKanban,
  Users,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'

const navItems = [
  { to: '/projekte', icon: FolderKanban,    label: 'Projekte' },
  { to: '/kunden',   icon: Users,           label: 'Kunden' },
]

function NavItem({ to, icon: Icon, label, end }: { to: string; icon: React.ElementType; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-[#F2D3C2] text-slate-900'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={cn('h-4 w-4 shrink-0 transition-colors', isActive ? 'text-slate-700' : 'text-slate-400 group-hover:text-slate-600')} />
          {label}
        </>
      )}
    </NavLink>
  )
}

export function Sidebar() {
  const { isAdmin } = useAuth()

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      {/* Logo */}
      <div className="flex h-14 items-center border-b border-slate-200 px-5 pl-7">
        <img src={NAEF_LOGO_SCHRIFT} alt="Naef & Partner" className="h-6 w-auto" />
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-3 pt-6 space-y-0.5">
        {navItems.map(({ to, icon, label }) => (
          <NavItem key={to} to={to} icon={icon} label={label} />
        ))}
      </nav>

      {/* Einstellungen unten */}
      <div className="border-t border-slate-200 p-3 space-y-0.5">
        {isAdmin && (
          <NavItem to="/verwaltung/benutzer" icon={ShieldCheck} label="Benutzerverwaltung" />
        )}
        <NavItem to="/einstellungen" icon={Settings} label="Einstellungen" />
      </div>
    </aside>
  )
}
