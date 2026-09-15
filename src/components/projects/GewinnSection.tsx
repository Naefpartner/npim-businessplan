import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Percent, Coins } from 'lucide-react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { EIGENTUMSART_COLOR, USE_TYPE_COLOR_1, USE_TYPE_COLOR_3 } from '@/lib/kategorieFarben'
import { HAUPTGRUPPEN } from '@/lib/bkpKatalog'
import { ertragProNutzung } from '@/lib/bkpBlocks'
import { eigentumsartForBuilding } from '@/types'
import { etappenTabs } from '@/lib/etappenTabs'
import { cn, formatNumber } from '@/lib/utils'

const EIG = 'verkaufsobjekt' as const
const HILITE = USE_TYPE_COLOR_1.verkaufsobjekt   // helle Fläche für Zwischensummen
const TOTALFLAECHE = USE_TYPE_COLOR_3.verkaufsobjekt // kräftiger für die Totalzeilen

/**
 * Hauptkategorie „Gewinnberechnung (Stockwerkeigentum)" — bündelt die
 * Verkaufsgewinn- und die IRR-Berechnung. Nur sichtbar, wenn in der
 * Mengenerfassung Verkaufsobjekte vorhanden sind.
 */
export function GewinnSection({ defaultExpanded = false }: { defaultExpanded?: boolean }) {
  const ak = useAnlagekostenShared()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [activeTab, setActiveTab] = useState('konsolidiert')

  const hasStockwerkeigentum = ak.buildings.some((b) => eigentumsartForBuilding(b.use_type) === EIG)

  // Etappen, die Verkaufsobjekte enthalten — nur die sind als Reiter sinnvoll.
  const etappenMitBlock = ak.etappen.filter((e) => ak.buildings.some(
    (b) => b.etappe_id === e.id && eigentumsartForBuilding(b.use_type) === EIG))
  // Ohne zweite Etappe gibt es nichts zu wählen — dann keine Reiterleiste.
  const tabs = etappenTabs(etappenMitBlock)
  const tabKey = tabs.some((t) => t.key === activeTab) ? activeTab : 'konsolidiert'
  const etappeId = tabKey === 'konsolidiert' ? null : tabKey

  if (!hasStockwerkeigentum) return null

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{ backgroundColor: EIGENTUMSART_COLOR.verkaufsobjekt }}
        className="flex w-full items-center gap-2 px-5 py-3 text-sm font-semibold text-slate-900 transition hover:brightness-95"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-slate-700" /> : <ChevronRight className="h-4 w-4 text-slate-700" />}
        <Coins className="h-4 w-4 text-slate-700" />
        <span>Gewinnberechnung STWEG</span>
      </button>

      {expanded && (
        <div className="space-y-4 p-5">
          {tabs.length > 0 && (
            <div className="flex flex-wrap gap-1 border-b border-slate-200">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveTab(t.key)}
                  className={cn(
                    'rounded-t-lg border border-b-0 px-4 py-2 text-sm font-medium transition',
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

          <UnterKapitel titel="Berechnung Verkaufsgewinn" defaultExpanded>
            <VerkaufsgewinnTabelle etappeId={etappeId} />
          </UnterKapitel>

          <UnterKapitel titel="IRR-Berechnung" badge="in Vorbereitung">
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
              IRR-Berechnung – Inhalt folgt.
            </div>
          </UnterKapitel>
        </div>
      )}
    </section>
  )
}

/** Aufklappbares Unterkapitel in der Farbe der Verkaufsobjekte (Stufe 1). */
function UnterKapitel({
  titel, badge, defaultExpanded = false, children,
}: {
  titel: string
  badge?: string
  defaultExpanded?: boolean
  children: React.ReactNode
}) {
  const [offen, setOffen] = useState(defaultExpanded)
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200">
      <button
        type="button"
        onClick={() => setOffen((o) => !o)}
        style={{ backgroundColor: TOTALFLAECHE }}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:brightness-95"
      >
        {offen ? <ChevronDown className="h-4 w-4 text-slate-700" /> : <ChevronRight className="h-4 w-4 text-slate-700" />}
        <Percent className="h-4 w-4 text-slate-700" />
        <span>{titel}</span>
        {badge && (
          <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-normal text-slate-700">
            {badge}
          </span>
        )}
      </button>
      {offen && <div className="bg-white p-4">{children}</div>}
    </section>
  )
}

/**
 * Gemeinsames Spaltenraster der drei Tabellen. Ohne es bemisst jede Tabelle
 * ihre Spalten nach dem eigenen Inhalt, und die Beträge stünden von Tabelle zu
 * Tabelle versetzt — Grobkosten, Erlöse und Gewinn sind aber dieselbe
 * Rechnung und sollen untereinander zu lesen sein.
 *
 * Die Tabellen tragen dazu `table-fixed`: im automatischen Satz sind die
 * Spaltenbreiten bloss ein Vorschlag, den der Browser je nach Inhalt der
 * Tabelle anders verteilt — genau das liess die Beträge auseinanderlaufen.
 */
function GewinnCols() {
  return (
    <colgroup>
      {/* BKP-Nummer */}
      <col style={{ width: '3.5rem' }} />
      {/* Bezeichnung */}
      <col />
      {/* Betrag: exkl. MwSt. · Verkaufserlös · Gewinn */}
      <col style={{ width: '11rem' }} />
      {/* Zweite Zahl: inkl. MwSt. · Anteil · Marge */}
      <col style={{ width: '11rem' }} />
    </colgroup>
  )
}

/**
 * Gegenüberstellung von Anlagekosten und Verkaufserlösen der Verkaufsobjekte.
 *
 * Die Kosten stammen aus der in den Anlagekosten gewählten Erfassungsmethode —
 * konsolidiert oder je Etappe. Die Erlöse kommen aus dem Mengengerüst: bei
 * Verkaufsobjekten sind die Mietzinsfelder Verkaufspreise, gruppiert nach
 * Nutzung (Wohnungen, Parkplätze, Garagen … je nach Erfassung).
 */
function VerkaufsgewinnTabelle({ etappeId }: { etappeId: string | null }) {
  const ak = useAnlagekostenShared()

  const ergebnis = etappeId == null
    ? ak.konsolidiertEffektiv.get(EIG)
    : ak.blockErgebnisseEffektiv.get(`${etappeId}::${EIG}`)

  // Kosten je Hauptgruppe, netto und brutto.
  const kosten = useMemo(() => {
    const zeilen = HAUPTGRUPPEN.map((h) => {
      const k = h.code as keyof NonNullable<typeof ergebnis>['hauptgruppenSummenNetto']
      const netto = ergebnis?.hauptgruppenSummenNetto[k] ?? 0
      const mwst = ergebnis?.hauptgruppenSummenMwst[k] ?? 0
      return { code: h.code, label: h.label, netto, brutto: netto + mwst }
    })
    const teil = (von: number, bis: number) => zeilen
      .filter((z) => z.code >= von && z.code <= bis)
      .reduce((s, z) => ({ netto: s.netto + z.netto, brutto: s.brutto + z.brutto }), { netto: 0, brutto: 0 })
    return { zeilen, erstellung: teil(1, 9), total: teil(0, 9) }
  }, [ergebnis])

  // Verkaufserlöse je Nutzung. Bei Verkaufsobjekten liefert ertragProNutzung()
  // den Verkaufserlös statt eines Jahresmietertrags.
  const erloese = useMemo(() => {
    const gebaeude = ak.buildings.filter(
      (b) => eigentumsartForBuilding(b.use_type) === EIG
        && (etappeId == null || b.etappe_id === etappeId))
    return Object.entries(ertragProNutzung(gebaeude))
      .filter(([, betrag]) => betrag > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([nutzung, betrag]) => ({ nutzung, betrag }))
  }, [ak.buildings, etappeId])

  const erloesTotal = erloese.reduce((s, e) => s + e.betrag, 0)
  const gewinn = erloesTotal - kosten.total.brutto
  const marge = erloesTotal > 0 ? gewinn / erloesTotal : 0
  const kostenmarge = kosten.total.brutto > 0 ? gewinn / kosten.total.brutto : 0

  return (
    <div className="space-y-6">
      {/* ── Anlagekosten ────────────────────────────────────────────────── */}
      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-900">Grobkosten</h4>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] table-fixed text-sm">
            <GewinnCols />
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3 font-medium">BKP</th>
                <th className="py-2 pr-3 font-medium">Hauptgruppe</th>
                <th className="py-2 pr-3 text-right font-medium">exkl. MwSt.</th>
                <th className="py-2 text-right font-medium">inkl. MwSt.</th>
              </tr>
            </thead>
            <tbody>
              {kosten.zeilen.map((z) => (
                <tr key={z.code} className="border-b border-slate-50">
                  <td className="py-1.5 pr-3 tabular-nums text-slate-500">{z.code}</td>
                  <td className="py-1.5 pr-3 text-slate-800">{z.label}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(Math.round(z.netto))}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatNumber(Math.round(z.brutto))}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 font-medium" style={{ backgroundColor: HILITE }}>
                <td className="py-2 pr-3" colSpan={2}>Erstellungskosten BKP 1–9</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(Math.round(kosten.erstellung.netto))}</td>
                <td className="py-2 text-right tabular-nums">{formatNumber(Math.round(kosten.erstellung.brutto))}</td>
              </tr>
              <tr className="border-t-2 border-slate-300 font-semibold" style={{ backgroundColor: TOTALFLAECHE }}>
                <td className="py-2 pr-3" colSpan={2}>Anlagekosten BKP 0–9</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(Math.round(kosten.total.netto))}</td>
                <td className="py-2 text-right tabular-nums">{formatNumber(Math.round(kosten.total.brutto))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Verkaufserlöse ──────────────────────────────────────────────── */}
      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-900">Verkaufserlöse nach Nutzung</h4>
        {erloese.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
            Keine Verkaufspreise erfasst — in „Mengen und Erträge" bei den Verkaufsobjekten eintragen.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] table-fixed text-sm">
              <GewinnCols />
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3 font-medium" colSpan={2}>Nutzung</th>
                  <th className="py-2 pr-3 text-right font-medium">Verkaufserlös</th>
                  <th className="py-2 text-right font-medium">Anteil</th>
                </tr>
              </thead>
              <tbody>
                {erloese.map((e) => (
                  <tr key={e.nutzung} className="border-b border-slate-50">
                    <td className="py-1.5 pr-3 text-slate-800" colSpan={2}>{e.nutzung}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(Math.round(e.betrag))}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">
                      {erloesTotal > 0 ? `${((e.betrag / erloesTotal) * 100).toFixed(1)} %` : '—'}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-300 font-semibold" style={{ backgroundColor: TOTALFLAECHE }}>
                  <td className="py-2 pr-3" colSpan={2}>Verkaufserlös total</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(Math.round(erloesTotal))}</td>
                  <td className="py-2 text-right tabular-nums">100.0 %</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Verkaufsgewinn ──────────────────────────────────────────────── */}
      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-900">Verkaufsgewinn</h4>
        <table className="w-full min-w-[520px] table-fixed text-sm">
          <GewinnCols />
          <tbody>
            <tr className="border-b border-slate-50">
              <td className="py-1.5 pr-3 text-slate-800" colSpan={2}>Verkaufserlös total</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(Math.round(erloesTotal))}</td>
              <td />
            </tr>
            <tr className="border-b border-slate-50">
              <td className="py-1.5 pr-3 text-slate-800" colSpan={2}>abzüglich Anlagekosten BKP 0–9 (inkl. MwSt.)</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">−{formatNumber(Math.round(kosten.total.brutto))}</td>
              <td />
            </tr>
            <tr className="border-t-2 border-slate-300 text-base font-bold" style={{ backgroundColor: TOTALFLAECHE }}>
              <td className="py-2.5 pr-3" colSpan={2}>Verkaufsgewinn</td>
              <td className={cn('py-2.5 pr-3 text-right tabular-nums', gewinn < 0 && 'text-red-700')}>
                {formatNumber(Math.round(gewinn))}
              </td>
              <td />
            </tr>
            {/* Die Margen sind Prozentwerte und stehen deshalb in der Spalte
                der Anteile, nicht unter den Beträgen. */}
            <tr className="text-xs text-slate-500">
              <td className="pt-1.5 pr-3" colSpan={2}>Marge auf dem Verkaufserlös</td>
              <td />
              <td className="pt-1.5 text-right tabular-nums">{(marge * 100).toFixed(1)} %</td>
            </tr>
            <tr className="text-xs text-slate-500">
              <td className="pr-3" colSpan={2}>Marge auf den Anlagekosten</td>
              <td />
              <td className="text-right tabular-nums">{(kostenmarge * 100).toFixed(1)} %</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-xs text-slate-400">
          Die Anlagekosten stammen aus der in den Anlagekosten gewählten Erfassungsmethode. Das
          Grundstück (BKP 0) ist im Abzug enthalten — ohne es wäre der Gewinn zu hoch ausgewiesen;
          die Zwischensumme BKP 1–9 zeigt die Erstellungskosten separat.
        </p>
      </div>
    </div>
  )
}
