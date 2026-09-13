import { useMemo, useState, type ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { useVariantTab } from '@/contexts/VariantTabContext'
import { WOHNUNGSMIX_KEYS, WOHNUNGSMIX_LABEL } from '@/types'
import { sammleNebenNutzungen, sammleWohnungsmix, wbfMenge } from '@/lib/wohnbaufoerderung'
import { CHART_PALETTE } from '@/lib/ci'
import { USE_TYPE_COLOR_1 } from '@/lib/kategorieFarben'
import { berechneWbf, defaultNutzungRate } from '@/lib/wbf'
import { useWbfZh } from '@/hooks/useWbfZh'
import { useUndoableSetter } from '@/contexts/UndoContext'
import { etappenTabs } from '@/lib/etappenTabs'
import { cn, formatNumber } from '@/lib/utils'

const EIG: 'genossenschaft' = 'genossenschaft'
// Sehr heller Grünton (CI Genossenschaft, Stufe 1) für Zwischenresultate/Totale.
const HILITE = USE_TYPE_COLOR_1.genossenschaft

export function WbfZhBerechnung({ variantId }: { variantId: string }) {
  const ak = useAnlagekostenShared()
  const tab = useVariantTab()
  const { params: p, setParams: setParamsRaw } = useWbfZh(variantId)
  const setParams = useUndoableSetter(p, setParamsRaw, 'WBF-Anlagekostenlimiten', `wbf:${variantId}`)

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

  // Wohnungsmix und die übrigen Nutzungen der Genossenschaft aus den Mengen —
  // dieselben Funktionen, aus denen auch das Berichtskapitel liest.
  const mix = useMemo(
    () => sammleWohnungsmix(ak.buildings, isKons ? null : tabKey),
    [ak.buildings, isKons, tabKey],
  )
  const nebenNutzungen = useMemo(
    () => sammleNebenNutzungen(ak.buildings, isKons ? null : tabKey)
      .map((n) => ({ ...n, menge: wbfMenge(n) }))
      .filter((n) => n.menge > 0),
    [ak.buildings, isKons, tabKey],
  )

  const nebenKosten = nebenNutzungen.map((n) => {
    const rate = p.nutzungRates[n.nutzung] ?? defaultNutzungRate(n.nutzung, n.isPark)
    return { ...n, rate, kosten: n.menge * rate }
  })
  const nebenTotal = nebenKosten.reduce((s, n) => s + n.kosten, 0)

  // Geplante Anlagekosten (Genossenschaft, konsolidiert) brutto.
  // Investition = gesamte Anlagekosten inkl. Land; Erstellung = ohne Land,
  // d. h. Anlagekosten abzüglich Position 010 (Grundstückserwerb).
  const { geplantErstellung, geplantInvestition } = useMemo(() => {
    // Der Stand, auf dem gerechnet wird — also die in den Anlagekosten
    // gewählte Erfassungsmethode, nicht nur der Detailkatalog.
    const erg = isKons
      ? ak.konsolidiertEffektiv.get(EIG)
      : ak.blockErgebnisseEffektiv.get(`${tabKey}::${EIG}`)
    if (!erg) return { geplantErstellung: 0, geplantInvestition: 0 }
    const p010 = erg.positionen['010']
    const pos010Brutto = (p010?.betragNetto ?? 0) + (p010?.mwstBetrag ?? 0)
    return {
      geplantInvestition: erg.totalBrutto,
      geplantErstellung: erg.totalBrutto - pos010Brutto,
    }
  }, [ak.konsolidiertEffektiv, ak.blockErgebnisseEffektiv, isKons, tabKey])

  const r = berechneWbf(mix, p, nebenTotal, geplantErstellung, geplantInvestition)
  const presentKeys = WOHNUNGSMIX_KEYS.filter((k) => (mix[k as string] || 0) > 0)

  // Daten für Balken (in der Tabelle) + Kreisdiagramm: Total-Punkte je Wohnungstyp.
  const punkteData = presentKeys.map((k, i) => ({
    key: k as string,
    label: `${WOHNUNGSMIX_LABEL[k]}${k !== 'joker' ? ' Zi' : ''}`,
    nameLong: `${WOHNUNGSMIX_LABEL[k]}${k !== 'joker' ? ' Zimmer' : ''}`,
    punkte: (mix[k as string] || 0) * (p.punkte[k as string] ?? 0),
    color: CHART_PALETTE[i % CHART_PALETTE.length],
  }))
  const punkteMax = Math.max(0, ...punkteData.map((d) => d.punkte))

  const setPunkt = (k: string, v: number) => setParams({ ...p, punkte: { ...p.punkte, [k]: v } })
  const setRate = (nutzung: string, v: number) => setParams({ ...p, nutzungRates: { ...p.nutzungRates, [nutzung]: v } })

  return (
    <div className="space-y-6">
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
      {/* ── Bestimmung Punkte WBF ─────────────────────────────────────── */}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-900">Bestimmung Punkte WBF</h4>
          <a
            href="https://www.zh.ch/de/soziales/wohnbaufoerderung.html"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-[#F2D3C2] px-3 py-1.5 text-xs font-medium text-slate-900 transition hover:bg-[#E7AF90]"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Limiten WBF
          </a>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden self-start rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100 text-slate-600">
                <th className="px-3 py-2 text-left font-medium">Zimmer</th>
                <th className="px-3 py-2 text-right font-medium">Anzahl</th>
                <th className="px-3 py-2 text-right font-medium">Pt./Whg</th>
                <th className="px-3 py-2 text-right font-medium">Pt. total</th>
                <th className="w-40 px-3 py-2 text-left font-medium">Verteilung</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {punkteData.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-3 text-center text-slate-400">Kein Wohnungsmix in den Mengen erfasst.</td></tr>
              )}
              {punkteData.map((d) => {
                const anz = mix[d.key] || 0
                const pt = p.punkte[d.key] ?? 0
                return (
                  <tr
                    key={d.key}
                    onClick={() => tab?.setTab('mengen')}
                    className={tab ? 'cursor-pointer hover:bg-slate-50' : undefined}
                    title={tab ? 'In der Mengenerfassung öffnen' : undefined}
                  >
                    <td className="px-3 py-1.5 text-slate-700">
                      <span className={tab ? 'underline-offset-2 group-hover:underline hover:underline' : undefined}>{d.label}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-900">{formatNumber(anz)}</td>
                    <td className="px-3 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <PtInput value={pt} onChange={(v) => setPunkt(d.key, v)} />
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-900">{formatNumber(d.punkte, 1)}</td>
                    <td className="px-3 py-1.5">
                      <div className="h-3.5 w-full overflow-hidden rounded bg-slate-100">
                        <div className="h-full rounded" style={{ width: `${punkteMax > 0 ? (d.punkte / punkteMax) * 100 : 0}%`, backgroundColor: d.color }} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 font-semibold text-slate-900" style={{ backgroundColor: HILITE }}>
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.whgTotal)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">Ø {formatNumber(r.punkteProWhg, 1)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.punkteTotal, 1)}</td>
                <td className="px-3 py-2" />
              </tr>
            </tfoot>
          </table>
        </div>
        <PunkteKreis data={punkteData} />
        </div>
      </div>

      {/* ── Maximale Erstellungskosten ────────────────────────────────── */}
      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-900">Maximale Erstellungskosten</h4>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <KostenCols />
            <tbody className="divide-y divide-slate-100">
              <Row
                label="Max. Erstellungskosten Wohnen inkl. MWST"
                menge={`${formatNumber(r.punkteTotal, 1)} Pt. ×`}
                satz={<NumInput value={p.chfProPunktErstellung} onChange={(v) => setParams({ ...p, chfProPunktErstellung: v })} />}
                unit="CHF/Pt." chf={r.erstellungWohnen}
              />
              <Row
                label="Zusatz für energetische Massnahmen"
                menge="von Erstellung Wohnen ×"
                satz={<NumInput value={p.energiezuschlagPct * 100} onChange={(v) => setParams({ ...p, energiezuschlagPct: v / 100 })} />}
                unit="%" chf={r.energiezuschlag}
              />
              <Row label="Max. Erstellungskosten Wohnen inkl. Energiezuschlag" chf={r.erstellungWohnenInkl} strong />

              {/* Nicht-Wohn-Nutzungen aus den Mengen */}
              {nebenKosten.map((n) => (
                <Row
                  key={n.nutzung}
                  label={`Kosten ${n.nutzung}`}
                  menge={`${formatNumber(n.menge)} ${n.isPark ? 'Stk' : 'm² VMF'} ×`}
                  satz={<NumInput value={n.rate} onChange={(v) => setRate(n.nutzung, v)} />}
                  unit={n.isPark ? 'CHF/Stk' : 'CHF/m²'} chf={n.kosten}
                />
              ))}

              <Row label="Maximale Erstellungskosten Total inkl. MWST" chf={r.erstellungTotal} highlight />
              <Row label="Geplante Erstellungskosten gem. Businessplan (exkl. Land)" chf={geplantErstellung} muted />
              <Row label="Differenz Businessplan − Maximum WBF" chf={r.diffErstellung} diff />
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Maximale Investitionskosten ───────────────────────────────── */}
      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-900">Maximale Investitionskosten</h4>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <KostenCols />
            <tbody className="divide-y divide-slate-100">
              <Row label="Maximale Erstellungskosten Total inkl. MWST" chf={r.erstellungTotal} />
              <Row
                label="Max. Anlagekosten pro Punkt (Bauland + Erstellung)"
                satz={<NumInput value={p.chfProPunktInvestitionTotal} onChange={(v) => setParams({ ...p, chfProPunktInvestitionTotal: v })} />}
                unit="CHF/Pt."
              />
              <Row
                label="Maximale Kosten für Bauland Wohnen"
                mengeWide
                menge={`${formatNumber(r.punkteTotal, 1)} Pt. × (${formatNumber(p.chfProPunktInvestitionTotal)} − ${formatNumber(p.chfProPunktErstellung)}) CHF/Pt.`}
                chf={r.baulandWohnen}
              />
              <Row label="Maximale pauschalierte Investitionskosten" chf={r.investitionTotal} highlight />
              <Row label="Geplante Investitionskosten gem. Businessplan (inkl. Land)" chf={geplantInvestition} muted />
              <Row label="Differenz Businessplan − Maximum WBF" chf={r.diffInvestition} diff />
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-slate-400">
        Wohnungsmix und Nicht-Wohn-Nutzungen automatisch aus den Mengen (Genossenschaft) — Menge = VMF
        (m²), bei Parkplätzen Stk. Punkte und Ansätze sind editierbar (Defaults gem. kantonalem WBF-Modell ZH).
      </p>
    </div>
  )
}

const RADIAN = Math.PI / 180

// Beschriftung mit Leitlinie zur Fläche: «1.5 Zimmer xy%».
function renderSliceLabel(props: any) {
  const { cx, cy, midAngle, outerRadius, percent, payload } = props
  const cos = Math.cos(-midAngle * RADIAN)
  const sin = Math.sin(-midAngle * RADIAN)
  const sx = cx + (outerRadius + 2) * cos
  const sy = cy + (outerRadius + 2) * sin
  const mx = cx + (outerRadius + 14) * cos
  const my = cy + (outerRadius + 14) * sin
  const right = cos >= 0
  const ex = mx + (right ? 12 : -12)
  const anchor = right ? 'start' : 'end'
  return (
    <g>
      <path d={`M${sx},${sy}L${mx},${my}L${ex},${my}`} stroke={payload.color} fill="none" strokeWidth={1} />
      <text x={ex + (right ? 3 : -3)} y={my} textAnchor={anchor} dominantBaseline="central" fontSize={10} fill="#334155">
        {payload.nameLong} {Math.round(percent * 100)}%
      </text>
    </g>
  )
}

// Kreisdiagramm mit Leitlinien-Beschriftung (Farben wie die Balken in der Tabelle).
function PunkteKreis({ data }: { data: { label: string; nameLong: string; punkte: number; color: string }[] }) {
  const visible = data.filter((d) => d.punkte > 0)
  if (visible.length === 0) {
    return (
      <div className="flex items-center justify-center self-start rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
        Keine Punkte
      </div>
    )
  }
  return (
    <div className="self-start overflow-hidden rounded-lg border border-slate-200">
      <div className="border-b border-slate-200 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600">
        Anteil an Gesamtpunkten
      </div>
      <div className="p-2">
      <ResponsiveContainer width="100%" height={260}>
        <PieChart margin={{ top: 10, right: 80, bottom: 10, left: 80 }}>
          <Pie
            data={visible}
            dataKey="punkte"
            nameKey="nameLong"
            innerRadius={38}
            outerRadius={62}
            paddingAngle={1}
            labelLine={false}
            label={renderSliceLabel}
          >
            {visible.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Pie>
          <Tooltip formatter={(v, n) => [`${formatNumber(Number(v), 1)} Pt.`, n]} />
        </PieChart>
      </ResponsiveContainer>
      </div>
    </div>
  )
}

// Punkte-Eingabe: immer 1 Nachkommastelle mit Punkt (z. B. 5.0), füllt die
// Spalte und ist rechtsbündig (fluchtet mit Spaltenkopf und Ø).
function PtInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [raw, setRaw] = useState<string | null>(null)
  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw ?? value.toFixed(1)}
      onFocus={() => setRaw(String(value))}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={() => {
        const v = parseFloat((raw ?? '').replace(',', '.'))
        onChange(Number.isFinite(v) ? v : value)
        setRaw(null)
      }}
      className="w-full rounded border border-transparent bg-transparent px-0 text-right text-sm tabular-nums text-slate-900 outline-none transition hover:border-slate-300 focus:border-[#8B6956] focus:bg-white"
    />
  )
}

// Editierbares Zahlenfeld: ganze Zahl, rechtsbündig, mit 1000er-Trennzeichen.
function NumInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
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
      className="w-full rounded border border-slate-300 bg-white px-2 py-0.5 text-right text-sm tabular-nums outline-none focus:border-[#8B6956]"
    />
  )
}

// Gemeinsames Spaltenraster für beide Kostentabellen (Eingaben fluchten vertikal).
function KostenCols() {
  return (
    <colgroup>
      <col />
      <col style={{ width: '11rem' }} />
      <col style={{ width: '7rem' }} />
      <col style={{ width: '4.5rem' }} />
      <col style={{ width: '9.5rem' }} />
    </colgroup>
  )
}

// Zeile: Bezeichnung | Menge | Satz (Eingabe) | Einheit | CHF-Betrag.
// mengeWide: Menge läuft über Menge+Satz+Einheit (für längere Formeln ohne Eingabe).
function Row({ label, menge, satz, unit, chf, mengeWide, strong, highlight, muted, diff }: {
  label: string
  menge?: ReactNode
  satz?: ReactNode
  unit?: string
  chf?: number | null
  mengeWide?: boolean
  strong?: boolean; highlight?: boolean; muted?: boolean; diff?: boolean
}) {
  const amountCls = diff
    ? ((chf ?? 0) <= 0 ? 'text-emerald-700' : 'text-red-600')
    : muted ? 'text-slate-500' : 'text-slate-900'
  return (
    <tr
      className={cn(highlight && 'font-semibold', strong && 'font-medium')}
      style={highlight ? { backgroundColor: HILITE } : undefined}
    >
      <td className="px-3 py-2 text-slate-700">{label}</td>
      {mengeWide ? (
        <td colSpan={3} className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-slate-500">{menge}</td>
      ) : (
        <>
          <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-500">{menge}</td>
          <td className="px-3 py-2">{satz}</td>
          <td className="px-3 py-2 text-xs text-slate-400">{unit}</td>
        </>
      )}
      <td className={cn('px-3 py-2 text-right tabular-nums', amountCls)}>
        {chf != null ? `CHF ${formatNumber(chf)}` : ''}
      </td>
    </tr>
  )
}
