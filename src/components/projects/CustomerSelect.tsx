import { Link } from 'react-router-dom'
import { useCustomers } from '@/hooks/useCustomers'

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm outline-none transition focus:border-[#8B6956] focus:ring-2 focus:ring-[#8B6956]/20 disabled:opacity-50'

export function CustomerSelect({
  value,
  onChange,
  disabled,
}: {
  value: string | null
  onChange: (id: string | null) => void
  disabled?: boolean
}) {
  const { customers, loading } = useCustomers()

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-slate-700">Kunde</label>
        <Link
          to="/kunden"
          className="text-xs text-slate-500 hover:text-[#8B6956]"
          target="_blank"
          rel="noopener noreferrer"
        >
          Neuen Kunden anlegen ↗
        </Link>
      </div>
      <select
        className={inputClass}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled || loading}
      >
        <option value="">— kein Kunde zugewiesen —</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </div>
  )
}
