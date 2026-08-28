import { useCallback, useState } from 'react'
import { Loader2, Save, Trash2, Check, AlertCircle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useBericht } from '@/contexts/BerichtContext'
import { useBerichtVorlagen } from '@/hooks/useBerichtVorlagen'
import { BERICHT_KAPITEL, AUFTRAG_ANREDEN } from '@/lib/bericht'
import { PRIMARY_DARK, PRIMARY_LIGHT } from '@/lib/ci'
import { cn } from '@/lib/utils'

/**
 * Kapitelauswahl und Vorlagen — sitzt in der Sidebar, während das Hauptfenster
 * die Vorschau zeigt. So lässt sich die Wirkung jeder Änderung sofort prüfen.
 */
export function BerichtSidebarPanel() {
  const { canWrite } = useAuth()
  const { auswahl, umschalten, aktiveVorlage, vorlageLaden, vorlageGesetzt,
          anrede, setAnrede } = useBericht()
  const { vorlagen, loading, speichern, loeschen } = useBerichtVorlagen()

  const [name, setName] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const [gesichert, setGesichert] = useState(false)
  const [speichertGerade, setSpeichertGerade] = useState(false)

  const sichern = useCallback(async () => {
    setFehler(null)
    setSpeichertGerade(true)
    try {
      const v = await speichern(name, auswahl)
      if (v) {
        vorlageGesetzt(v)
        setName('')
        setGesichert(true)
        window.setTimeout(() => setGesichert(false), 3000)
      }
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.')
    } finally {
      setSpeichertGerade(false)
    }
  }, [speichern, name, auswahl, vorlageGesetzt])

  return (
    <div className="mt-6 border-t border-slate-200 pt-4">
      <h2 className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        Kapitel
      </h2>

      <ul className="mt-1.5">
        {BERICHT_KAPITEL.map((k) => {
          const gewaehlt = k.fix || auswahl.includes(k.key)
          return (
            <li key={k.key}>
              <label
                title={k.fix ? `${k.beschrieb} — immer im Bericht` : k.beschrieb}
                className={cn(
                  'flex items-start gap-2 rounded-lg px-3 py-1.5 text-sm transition',
                  k.fix ? 'cursor-default text-slate-400' : 'cursor-pointer text-slate-700 hover:bg-slate-100',
                )}
              >
                <input
                  type="checkbox"
                  checked={gewaehlt}
                  disabled={k.fix}
                  onChange={() => umschalten(k.key)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 accent-[#8B6956] disabled:opacity-40"
                />
                <span className="min-w-0 leading-snug">
                  {k.label}
                  {k.format && k.format !== 'a4' && (
                    <span className="ml-1 text-[10px] text-slate-400">
                      {k.format === 'a3' ? 'A3' : 'quer'}
                    </span>
                  )}
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      <h2 className="mt-5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        Titelblatt
      </h2>
      <div className="mt-1.5 px-3">
        <label className="block text-[11px] text-slate-500">Anrede der Kundschaft</label>
        <div className="mt-1 inline-flex rounded-lg border border-slate-200 p-0.5">
          {AUFTRAG_ANREDEN.map((a) => (
            <button
              key={a}
              type="button"
              disabled={!canWrite}
              onClick={() => setAnrede(a)}
              className={cn(
                'rounded-md px-2 py-1 text-xs font-medium transition',
                anrede === a ? 'bg-[#8B6956] text-white' : 'text-slate-600 hover:bg-slate-100',
                !canWrite && 'cursor-not-allowed opacity-60',
              )}
            >
              {a === 'Auftraggeberin' ? 'weiblich' : 'männlich'}
            </button>
          ))}
        </div>
      </div>

      <h2 className="mt-5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        Vorlagen
      </h2>

      {loading ? (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Wird geladen…
        </div>
      ) : vorlagen.length === 0 ? (
        <p className="px-3 py-2 text-xs leading-snug text-slate-400">
          Noch keine gesichert.
        </p>
      ) : (
        <ul className="mt-1.5 space-y-0.5">
          {vorlagen.map((v) => {
            const aktiv = aktiveVorlage?.id === v.id
            return (
              <li key={v.id} className="group/v flex items-center">
                <button
                  type="button"
                  onClick={() => vorlageLaden(v)}
                  style={aktiv ? { backgroundColor: PRIMARY_LIGHT, color: PRIMARY_DARK } : undefined}
                  className={cn(
                    'min-w-0 flex-1 truncate rounded-lg px-3 py-1.5 text-left text-sm transition',
                    aktiv ? 'font-medium' : 'text-slate-700 hover:bg-slate-100',
                  )}
                >
                  {v.name}
                </button>
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => void loeschen(v.id)}
                    title="Vorlage löschen"
                    className="mr-1 shrink-0 rounded p-1 text-slate-300 opacity-0 transition group-hover/v:opacity-100 hover:bg-slate-100 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {canWrite && (
        <div className="mt-2 px-3">
          <div className="flex gap-1">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) void sichern() }}
              placeholder="Auswahl sichern als…"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs focus:border-slate-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void sichern()}
              disabled={!name.trim() || speichertGerade}
              title="Auswahl als Vorlage sichern"
              className="shrink-0 rounded-lg border border-slate-200 p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {speichertGerade
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : gesichert ? <Check className="h-3.5 w-3.5" style={{ color: PRIMARY_DARK }} />
                : <Save className="h-3.5 w-3.5" />}
            </button>
          </div>
          {fehler && (
            <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-snug text-red-700">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> {fehler}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
