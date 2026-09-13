import { useMemo, useState, type ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { useVariantTab } from '@/contexts/VariantTabContext'
import { WOHNUNGSMIX_KEYS, WOHNUNGSMIX_LABEL } from '@/types'
import { sammleNebenNutzungen, sammleWohnungsmix } from '@/lib/wohnbaufoerderung'
import { USE_TYPE_COLOR_1 } from '@/lib/kategorieFarben'
import { berechneBwo, defaultWohnLimit, defaultNutzungLimit } from '@/lib/bwo'
import { useBwo } from '@/hooks/useBwo'
import { useUndoableSetter } from '@/contexts/UndoContext'
import { etappenTabs } from '@/lib/etappenTabs'
import { cn, formatNumber } from '@/lib/utils'

const EIG: 'genossenschaft' = 'genossenschaft'
const HILITE = USE_TYPE_COLOR_1.genossenschaft

export function BwoBerechnung({ variantId }: { variantId: string }) {
  const ak = useAnlagekostenShared()
  const tab = useVariantTab()
  const { params: p, setParams: setParamsRaw } = useBwo(variantId)
  const setParams = useUndoableSetter(p, setParamsRaw, 'BWO-Anlagekostenlimiten', `bwo:${variantId}`)

  // Reiter: Konsolidiert + Etappen mit Genossenschafts-Block.
  const [activeTab, setActiveTab] = useState('konsolidiert')
  const etappenMitBlock = useMemo(
    () => ak.etappen.filter((e) => ak.blockErgebnisse.has(`${e.id}::${EIG}`)),
    [ak.etappen, ak.blockErgebnisse],
  )
  // Ohne zweite Etappe gibt es nichts zu wählen — dann keine Reiterleiste.
  const tabs = etappenTabs(etappenMitBlock)
  const tabKey = tabs.some((t) => t.key === activeTab) ? activeTab : 'konsolidiert'
  const isKons = tabKey === 'konsolidiert'

  // Wohnungsmix und Nebenflächen der Genossenschaft aus den Mengen — hier
  // zählen die Einheiten, nicht die Flächen.
  const mix = useMemo(
    () => sammleWohnungsmix(ak.buildings, isKons ? null : tabKey),
    [ak.buildings, isKons, tabKey],
  )
  const nebenNutzungen = useMemo(
    () => sammleNebenNutzungen(ak.buildings, isKons ? null : tabKey)
      .filter((n) => n.anzahl > 0),
    [ak.buildings, isKons, tabKey],
  )

  const nebenKosten = nebenNutzungen.map((n) => {
    const limit = p.nutzungLimits[n.nutzung] ?? defaultNutzungLimit(n.nutzung, n.isPark)
    return { ...n, limit, kosten: n.anzahl * limit }
  })
  const nebenTotal = nebenKosten.reduce((s, n) => s + n.kosten, 0)

  // Geplante Anlagekosten (Genossenschaft, konsolidiert, inkl. Land) brutto.
  const geplant = useMemo(() => {
    // Der Stand, auf dem gerechnet wird — also die in den Anlagekosten
    // gewählte Erfassungsmethode, nicht nur der Detailkatalog.
    const erg = isKons
      ? ak.konsolidiertEffektiv.get(EIG)
      : ak.blockErgebnisseEffektiv.get(`${tabKey}::${EIG}`)
    return erg ? erg.totalBrutto : 0
  }, [ak.konsolidiertEffektiv, ak.blockErgebnisseEffektiv, isKons, tabKey])

  const r = berechneBwo(mix, p, nebenTotal, geplant)
  const presentKeys = WOHNUNGSMIX_KEYS.filter((k) => (mix[k as string] || 0) > 0)

  const setWohnLimit = (k: string, v: number) => setParams({ ...p, wohnLimits: { ...p.wohnLimits, [k]: v } })
  const setNutzungLimit = (nutzung: string, v: number) => setParams({ ...p, nutzungLimits: { ...p.nutzungLimits, [nutzung]: v } })

  return (
    <div className="space-y-2">
      {tabs.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-slate-200">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={cn(
                'rounded-t-lg border border-b-0 px-4 py-1.5 text-sm font-medium transition',
                tabKey === t.key
                  ? 'border-slate-200 bg-slate-200 text-slate-900'
                  : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-900">Zulässige Anlagekostenlimite für Mietwohnungen</h4>
        <a
          href="https://www.bwo.admin.ch/de/anlagekostenlimiten"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md bg-[#F2D3C2] px-3 py-1.5 text-xs font-medium text-slate-900 transition hover:bg-[#E7AF90]"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Aktuelle Werte BWO
        </a>
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <colgroup>
            <col />
            <col style={{ width: '9rem' }} />
            <col style={{ width: '6rem' }} />
            <col style={{ width: '10rem' }} />
          </colgroup>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-100 text-slate-600">
              <th className="px-3 py-2 text-left font-medium">Kostenstufe</th>
              <th className="px-3 py-2 text-right font-medium">CHF/Einheit</th>
              <th className="px-3 py-2 text-right font-medium">Einheiten</th>
              <th className="px-3 py-2 text-right font-medium">Zulässige Kosten</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {presentKeys.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-3 text-center text-slate-400">Kein Wohnungsmix in den Mengen erfasst.</td></tr>
            )}
            {presentKeys.map((k) => {
              const anz = mix[k as string] || 0
              const limit = p.wohnLimits[k as string] ?? defaultWohnLimit(k as string)
              return (
                <tr
                  key={k as string}
                  onClick={() => tab?.setTab('mengen')}
                  className={tab ? 'cursor-pointer hover:bg-slate-50' : undefined}
                  title={tab ? 'In der Mengenerfassung öffnen' : undefined}
                >
                  <td className="px-3 py-1.5 text-slate-700">{WOHNUNGSMIX_LABEL[k]}{k !== 'joker' ? ' Zimmer' : ''}</td>
                  <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <NumInput value={limit} onChange={(v) => setWohnLimit(k as string, v)} />
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-900">{formatNumber(anz)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-900">CHF {formatNumber(anz * limit)}</td>
                </tr>
              )
            })}

            <Sub label="Total Wohnteil" chf={r.wohnTotal} />
            <tr>
              <td className="px-3 py-2 text-slate-700">Zuschlag Energie (max. 10 %)</td>
              <td className="px-3 py-2 text-right">
                <span className="inline-flex items-center gap-1">
                  <NumInput value={p.energieZuschlagPct * 100} onChange={(v) => setParams({ ...p, energieZuschlagPct: v / 100 })} w="w-16" />
                  <span className="text-xs text-slate-400">%</span>
                </span>
              </td>
              <td />
              <td className="px-3 py-2 text-right tabular-nums text-slate-900">CHF {formatNumber(r.energie)}</td>
            </tr>
            <Sub label="Total Wohnteil inkl. Zuschlag Energie" chf={r.wohnInklEnergie} strong />

            {/* Nebenflächen / Parkplätze aus den Mengen (Einheiten = Anzahl) */}
            {nebenKosten.map((n) => (
              <tr key={n.nutzung}>
                <td className="px-3 py-1.5 text-slate-700">{n.nutzung}</td>
                <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                  <NumInput value={n.limit} onChange={(v) => setNutzungLimit(n.nutzung, v)} />
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-900">{formatNumber(n.anzahl)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-900">CHF {formatNumber(n.kosten)}</td>
              </tr>
            ))}

            <tr>
              <td className="px-3 py-2 text-slate-700">Zusatzaufwand schlechter Baugrund</td>
              <td colSpan={2} />
              <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                <NumInput value={p.baugrundZusatz} onChange={(v) => setParams({ ...p, baugrundZusatz: v })} />
              </td>
            </tr>

            <Sub label="Zulässige Anlagekostenlimite" chf={r.zulaessigeLimite} highlight />
            <tr>
              <td className="px-3 py-2 text-slate-700">Anlagekosten gemäss Businessplan (inkl. Land)</td>
              <td colSpan={2} />
              <td className="px-3 py-2 text-right tabular-nums text-slate-500">CHF {formatNumber(geplant)}</td>
            </tr>
            <tr>
              <td className="px-3 py-2 text-slate-700">Differenz Anlagekosten − Limite</td>
              <td colSpan={2} />
              <td className={cn('px-3 py-2 text-right tabular-nums', r.differenz <= 0 ? 'text-emerald-700' : 'text-red-600')}>
                CHF {formatNumber(r.differenz)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-400">
        Einheiten automatisch aus den Mengen (Genossenschaft) — Wohnungen aus dem Wohnungsmix, Nebenflächen/
        Parkplätze aus der Anzahl je Nutzung. Limiten editierbar (Defaults gem. BWO-Kostenlimiten).
      </p>
    </div>
  )
}

// Editierbares Zahlenfeld: ganze Zahl, rechtsbündig, mit 1000er-Trennzeichen.
function NumInput({ value, onChange, w = 'w-full' }: { value: number; onChange: (v: number) => void; w?: string }) {
  const [raw, setRaw] = useState<string | null>(null)
  return (
    <input
      type="text"
      inputMode="numeric"
      value={raw ?? formatNumber(value, 0)}
      onFocus={() => setRaw(String(value))}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={() => {
        const v = parseFloat((raw ?? '').replace(/['’\s]/g, '').replace(',', '.'))
        onChange(Number.isFinite(v) ? v : value)
        setRaw(null)
      }}
      className={cn('rounded border border-slate-300 bg-white px-2 py-0.5 text-right text-sm tabular-nums outline-none focus:border-[#8B6956]', w)}
    />
  )
}

// Subtotal-/Total-Zeile (Bezeichnung … CHF), optional hervorgehoben.
function Sub({ label, chf, strong, highlight }: { label: ReactNode; chf: number; strong?: boolean; highlight?: boolean }) {
  return (
    <tr
      className={cn(highlight && 'font-semibold', strong && 'font-medium', 'border-t border-slate-200')}
      style={highlight ? { backgroundColor: HILITE } : undefined}
    >
      <td className="px-3 py-2 text-slate-700" colSpan={3}>{label}</td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-900">CHF {formatNumber(chf)}</td>
    </tr>
  )
}
