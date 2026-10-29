import {
  Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Landmark, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useUndoableState } from '@/contexts/UndoContext'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { useKapitalSteuern } from '@/hooks/useKapitalSteuern'
import { useAufklappbar } from '@/hooks/useAufklappbar'
import {
  berechneGesellschaft, berechneKapital, defaultKapitalSteuernDoc, zeilenBetrag,
  type KapitalSteuernDoc, type KsGesellschaft, type KsKostenZeile,
} from '@/lib/kapitalSteuern'
import { ertragProNutzung } from '@/lib/bkpBlocks'
import { HAUPTGRUPPEN, posSortKey } from '@/lib/bkpKatalog'
import { EIGENTUMSART_COLOR, USE_TYPE_COLOR_1, USE_TYPE_COLOR_3 } from '@/lib/kategorieFarben'
import { CI } from '@/lib/ci'
import { eigentumsartForBuilding } from '@/types'
import { cn, formatNumber } from '@/lib/utils'
import { useEingabe } from '@/hooks/useEingabe'

const EIG = 'verkaufsobjekt' as const
const HILITE = USE_TYPE_COLOR_1.verkaufsobjekt
const TOTALFLAECHE = USE_TYPE_COLOR_3.verkaufsobjekt

/**
 * Farben eines Kapitelteils: Kopf des Unterkapitels, Summen- und Totalzeilen,
 * hervorgehobene Zwischenzeilen. Landprovider und Totalunternehmer tragen je
 * eine eigene CI-Familie — Gelb und Mint sind frei, Blau/Grün/Rot stehen für
 * die Nutzungsarten, Violett für gemischt —, damit man beim Blättern weiss,
 * bei welcher Gesellschaft man ist.
 */
interface Farbe { kopf: string; summe: string; zeile: string }
const FARBE_VERKAUF: Farbe = { kopf: TOTALFLAECHE, summe: TOTALFLAECHE, zeile: HILITE }
const FARBE_LP: Farbe = { kopf: CI.gelb[5], summe: CI.gelb[3], zeile: CI.gelb[1] }
const FARBE_TU: Farbe = { kopf: CI.mint[5], summe: CI.mint[3], zeile: CI.mint[1] }

/** Abweichung, ab der die Kontrolle warnt (Rundung der Positionen). */
const KONTROLLE_TOLERANZ = 1

/**
 * Eine wählbare Position aus der Kostenberechnung. `sortierung` ist die
 * BKP-Nummer als Zahl — der interne Code taugt nicht dafür: eigene Zeilen
 * führen dort ihre Id.
 */
interface Wahlposition {
  code: string
  label: string
  betrag: number
  hauptgruppe: number
  sortierung: number
}

/** Positionen nach BKP-Nummer, aufsteigend. */
function nachBkp(a: Wahlposition, b: Wahlposition): number {
  return a.hauptgruppe - b.hauptgruppe || a.sortierung - b.sortierung
    || a.label.localeCompare(b.label)
}

function neueId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Kapitel „Kapital und Steuern" (Verkaufsobjekte). Es hält zusammen, was
 * ausserhalb der Baurechnung über den Erfolg entscheidet: wer wie viel Kapital
 * einbringt und wie der Gewinn verteilt wird, und wie sich Landprovider und
 * Totalunternehmer die Kosten, den Gewinn und die Steuern teilen.
 */
export function KapitalSteuernSection({ variantId, defaultExpanded = false }: {
  variantId: string
  defaultExpanded?: boolean
}) {
  const { canWrite } = useAuth()
  const ak = useAnlagekostenShared()
  const [expanded, umschalten] = useAufklappbar(defaultExpanded)

  // ── Persistenz (JSONB je Variante) + globales Undo/Redo ────────────────────
  const { loaded, loading, save } = useKapitalSteuern(variantId)
  const [doc, setDoc, setDocSilent] = useUndoableState<KapitalSteuernDoc>(
    defaultKapitalSteuernDoc, 'Kapital und Steuern')
  const hydriert = useRef(false)
  const zuletztGespeichert = useRef<KapitalSteuernDoc | null>(null)
  const docRef = useRef(doc)
  const saveRef = useRef(save)
  useLayoutEffect(() => { docRef.current = doc; saveRef.current = save })
  useEffect(() => {
    if (loading || hydriert.current) return
    const init = loaded ?? defaultKapitalSteuernDoc()
    zuletztGespeichert.current = init
    docRef.current = init
    hydriert.current = true
    setDocSilent(init)
  }, [loading, loaded, setDocSilent])
  useEffect(() => {
    if (!hydriert.current || doc === zuletztGespeichert.current) return
    const t = setTimeout(() => {
      zuletztGespeichert.current = docRef.current
      void saveRef.current(docRef.current)
    }, 600)
    return () => clearTimeout(t)
  }, [doc, save])
  useEffect(() => () => {
    if (hydriert.current && docRef.current !== zuletztGespeichert.current) {
      zuletztGespeichert.current = docRef.current
      void saveRef.current(docRef.current)
    }
  }, [])

  // ── Grundlagen aus der Variante ───────────────────────────────────────────
  const hatVerkauf = ak.presentEig.includes(EIG)

  /** Wählbare Positionen der Verkaufsobjekte — je nach Erfassungsmethode. */
  const wahlpositionen = useMemo<Wahlposition[]>(() => {
    const erg = ak.konsolidiertEffektiv.get(EIG)
    if (!erg) return []
    // Benchmark und keeValue rechnen auf Hauptgruppen; dort gibt es keine
    // einzelnen Positionen zu wählen.
    if (ak.benchmarkAktiv || ak.keeValueAktiv) {
      return HAUPTGRUPPEN.map((h) => {
        const k = h.code as keyof typeof erg.hauptgruppenSummenNetto
        const betrag = (erg.hauptgruppenSummenNetto[k] ?? 0) + (erg.hauptgruppenSummenMwst[k] ?? 0)
        return {
          code: `hg${h.code}`, label: `${h.code} · ${h.label}`, betrag,
          hauptgruppe: h.code, sortierung: h.code,
        }
      }).filter((p) => Math.abs(p.betrag) >= 0.5)
    }
    const katalog = new Map((ak.positionsByEig.get(EIG) ?? []).map((p) => [p.code, p]))
    return Object.entries(erg.positionen)
      .map(([code, p]) => {
        const kat = katalog.get(code)
        return {
          code,
          label: `${kat?.displayCode ?? code} · ${kat?.label ?? ''}`,
          betrag: (p.betragNetto ?? 0) + (p.mwstBetrag ?? 0),
          // Ohne Katalogeintrag (eigene Zeile) sagt die erste Ziffer die
          // Hauptgruppe; taugt auch die nicht, landet sie bei 9.
          hauptgruppe: kat?.hauptgruppe ?? (Number(code[0]) || 9),
          sortierung: kat ? posSortKey(kat) : (Number(code) || Number.POSITIVE_INFINITY),
        }
      })
      .filter((p) => Math.abs(p.betrag) >= 0.5)
      // Nach BKP-Nummer, aufsteigend — die Liste soll sich lesen wie die
      // Kostenberechnung selbst.
      .sort(nachBkp)
  }, [ak.konsolidiertEffektiv, ak.positionsByEig, ak.benchmarkAktiv, ak.keeValueAktiv])

  const positionsBetraege = useMemo(
    () => new Map(wahlpositionen.map((p) => [p.code, p.betrag])),
    [wahlpositionen],
  )

  /** Landpreis (Position 010, brutto) — Bezug der Anteilszeilen beim Landprovider. */
  const landpreis = useMemo(() => {
    const p010 = ak.konsolidiertEffektiv.get(EIG)?.positionen['010']
    return (p010?.betragNetto ?? 0) + (p010?.mwstBetrag ?? 0)
  }, [ak.konsolidiertEffektiv])

  /** Verkaufserlös der Variante — Vorgabe für den Ertrag des Totalunternehmers. */
  const verkaufserloes = useMemo(() => {
    const gebaeude = ak.buildings.filter((b) => eigentumsartForBuilding(b.use_type) === EIG)
    return Object.values(ertragProNutzung(gebaeude)).reduce((s, v) => s + v, 0)
  }, [ak.buildings])

  // ── Ergebnisse ────────────────────────────────────────────────────────────
  const lp = useMemo(
    () => berechneGesellschaft(doc.landprovider, positionsBetraege, landpreis),
    [doc.landprovider, positionsBetraege, landpreis],
  )
  /*
   * Werkerlös = Gesamterlös der Einheiten abzüglich des Landanteils, den der
   * Landprovider verrechnet. Er ist deshalb keine Eingabe, sondern folgt aus
   * den Mengen und dem Landanteil oben.
   */
  const werkerloes = verkaufserloes - doc.landprovider.ertrag
  const tu = useMemo(
    () => berechneGesellschaft(doc.totalunternehmer, positionsBetraege, landpreis, werkerloes),
    [doc.totalunternehmer, positionsBetraege, landpreis, werkerloes],
  )
  const gewinnTotal = lp.gewinnNachSteuern + tu.gewinnNachSteuern

  /*
   * Kontrolle: Landprovider und Totalunternehmer zusammen sollen genau die
   * Anlagekosten der Verkaufsobjekte tragen — nicht mehr (Position doppelt
   * zugeordnet) und nicht weniger (Position vergessen). Die Hinweise sagen,
   * wo eine Abweichung herkommen kann; frei erfasste Zeilen können eine
   * fehlende Position bewusst ersetzen, darum stehen sie nur als Hinweis da.
   */
  const kontrolle = useMemo(() => {
    const anlagekosten = ak.konsolidiertEffektiv.get(EIG)?.totalBrutto ?? 0
    const zugeteilt = lp.kostenTotal + tu.kostenTotal
    const alle = [
      ...doc.landprovider.landkosten, ...doc.landprovider.anlagekosten,
      ...doc.totalunternehmer.anlagekosten,
    ]
    const anzahl = new Map<string, number>()
    for (const z of alle) if (z.code) anzahl.set(z.code, (anzahl.get(z.code) ?? 0) + 1)
    const freieZeilen = alle.filter((z) => !z.code)
    return {
      anlagekosten,
      zugeteilt,
      differenz: zugeteilt - anlagekosten,
      doppelt: wahlpositionen.filter((p) => (anzahl.get(p.code) ?? 0) > 1),
      offen: wahlpositionen.filter((p) => !anzahl.has(p.code)),
      freiBetrag: freieZeilen.reduce(
        (s, z) => s + zeilenBetrag(z, undefined, landpreis), 0),
      freiAnzahl: freieZeilen.length,
    }
  }, [ak.konsolidiertEffektiv, lp.kostenTotal, tu.kostenTotal, doc.landprovider,
    doc.totalunternehmer, wahlpositionen, landpreis])
  const kapital = useMemo(
    () => berechneKapital(doc.investoren, gewinnTotal),
    [doc.investoren, gewinnTotal],
  )

  // ── Setter ────────────────────────────────────────────────────────────────
  const setGesellschaft = (
    welche: 'landprovider' | 'totalunternehmer', patch: Partial<KsGesellschaft>,
  ) => setDoc((d) => ({ ...d, [welche]: { ...d[welche], ...patch } }),
    { label: 'Kapital und Steuern', coalesceKey: `ks:${welche}` })

  const setZeilen = (
    welche: 'landprovider' | 'totalunternehmer',
    feld: 'landkosten' | 'anlagekosten',
    zeilen: KsKostenZeile[],
  ) => setGesellschaft(welche, { [feld]: zeilen })

  if (!hatVerkauf) return null

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={umschalten}
        style={{ backgroundColor: EIGENTUMSART_COLOR.verkaufsobjekt }}
        className="flex w-full items-center gap-2 px-5 py-3 text-sm font-semibold text-slate-900 transition hover:brightness-95"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-slate-700" /> : <ChevronRight className="h-4 w-4 text-slate-700" />}
        <Landmark className="h-4 w-4 text-slate-700" />
        <span>Kapital und Steuern</span>
      </button>

      {expanded && (loading ? (
        <div className="p-6 text-sm text-slate-500">Wird geladen…</div>
      ) : (
        <div className="space-y-5 p-5">
          {/* ── Kapitalstruktur ────────────────────────────────────────── */}
          <UnterKapitel titel="Kapitalstruktur und Gewinnverteilung">
            <InvestorenTabelle
              investoren={kapital}
              canWrite={canWrite}
              onAdd={() => setDoc((d) => ({
                ...d,
                investoren: [...d.investoren,
                  { id: neueId('inv'), name: '', kapital: 0, gewinnanteilPct: null, zinssatzPct: 0 }],
              }), { label: 'Investor' })}
              onSet={(id, patch) => setDoc((d) => ({
                ...d,
                investoren: d.investoren.map((i) => (i.id === id ? { ...i, ...patch } : i)),
              }), { label: 'Investor', coalesceKey: `ks:inv:${id}` })}
              onDel={(id) => setDoc((d) => ({
                ...d, investoren: d.investoren.filter((i) => i.id !== id),
              }), { label: 'Investor entfernt' })}
            />
          </UnterKapitel>

          {/* ── Gesellschaften ─────────────────────────────────────────── */}
          <UnterKapitel titel="Gesellschaften">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs text-slate-600">
                <div className="mb-1 flex items-center gap-1.5 font-medium text-slate-700">
                  <Farbpunkt farbe={FARBE_LP} />Landprovider
                </div>
                <input type="text" value={doc.landprovider.name} disabled={!canWrite}
                  onChange={(e) => setGesellschaft('landprovider', { name: e.target.value })}
                  className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm" />
              </label>
              <label className="text-xs text-slate-600">
                <div className="mb-1 flex items-center gap-1.5 font-medium text-slate-700">
                  <Farbpunkt farbe={FARBE_TU} />Totalunternehmer
                </div>
                <input type="text" value={doc.totalunternehmer.name} disabled={!canWrite}
                  onChange={(e) => setGesellschaft('totalunternehmer', { name: e.target.value })}
                  className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm" />
              </label>
            </div>
          </UnterKapitel>

          {/* ── Landprovider ───────────────────────────────────────────── */}
          <UnterKapitel titel={`Kosten ${doc.landprovider.name}`} farbe={FARBE_LP}>
            <div className="space-y-5">
              <KostenBlock
                farbe={FARBE_LP}
                gruppenSchalter
                titel="Kosten Land"
                hinweis={`Zusammensetzung und Finanzierung des Landerwerbs. Anteile rechnen auf dem Landpreis aus den Anlagekosten (CHF ${formatNumber(landpreis)}).`}
                zeilen={doc.landprovider.landkosten}
                bezug={landpreis}
                positionen={wahlpositionen}
                positionsBetraege={positionsBetraege}
                canWrite={canWrite}
                mitAnteil
                onChange={(z) => setZeilen('landprovider', 'landkosten', z)}
              />
              <KostenBlock
                farbe={FARBE_LP}
                gruppenSchalter
                titel="Anlagekosten aufgrund Händlertätigkeit"
                hinweis="Positionen aus der Kostenberechnung übernehmen oder eigene Zeilen erfassen."
                zeilen={doc.landprovider.anlagekosten}
                bezug={landpreis}
                positionen={wahlpositionen}
                positionsBetraege={positionsBetraege}
                canWrite={canWrite}
                onChange={(z) => setZeilen('landprovider', 'anlagekosten', z)}
              />
              <SummenZeile label="Kosten total" betrag={lp.kostenTotal} farbe={FARBE_LP} />
            </div>
          </UnterKapitel>

          <UnterKapitel titel={`Gewinn und Steuern ${doc.landprovider.name}`} farbe={FARBE_LP}>
            <GewinnBlock
              farbe={FARBE_LP}
              g={doc.landprovider}
              erg={lp}
              ertragVorschlag={0}
              ertragLabel="Verkaufserlös Landanteil"
              kostenLabel="Anlagekosten aufgrund Händlertätigkeit (Land und Kosten)"
              steuerLabel="Steuern Landprovider"
              canWrite={canWrite}
              onSet={(patch) => setGesellschaft('landprovider', patch)}
              hinweis="Gewinn vor Steuern = Verkaufserlös Landanteil abzüglich der oben erfassten Kosten (Land und Händlertätigkeit). Der Steuersatz beginnt bei 30 % und ist überschreibbar."
            />
          </UnterKapitel>

          {/* ── Totalunternehmer ───────────────────────────────────────── */}
          <UnterKapitel titel={`Kosten ${doc.totalunternehmer.name}`} farbe={FARBE_TU}>
            <div className="space-y-5">
              <KostenBlock
                farbe={FARBE_TU}
                gruppenSchalter
                titel="Anlagekosten"
                hinweis="Positionen aus der Kostenberechnung übernehmen oder eigene Zeilen erfassen."
                zeilen={doc.totalunternehmer.anlagekosten}
                bezug={landpreis}
                positionen={wahlpositionen}
                positionsBetraege={positionsBetraege}
                canWrite={canWrite}
                onChange={(z) => setZeilen('totalunternehmer', 'anlagekosten', z)}
              />
              <SummenZeile label="Kosten total" betrag={tu.kostenTotal} farbe={FARBE_TU} />
            </div>
          </UnterKapitel>

          <UnterKapitel titel={`Gewinn und Steuern ${doc.totalunternehmer.name}`} farbe={FARBE_TU}>
            <GewinnBlockWerk
              farbe={FARBE_TU}
              g={doc.totalunternehmer}
              erg={tu}
              verkaufserloesTotal={verkaufserloes}
              landanteil={doc.landprovider.ertrag}
              werkerloes={werkerloes}
              canWrite={canWrite}
              onSet={(patch) => setGesellschaft('totalunternehmer', patch)}
            />
          </UnterKapitel>

          {/* ── Kontrolle: Kosten der Gesellschaften = Anlagekosten ────── */}
          <KontrolleKosten
            kontrolle={kontrolle}
            lpName={doc.landprovider.name}
            tuName={doc.totalunternehmer.name}
            lpKosten={lp.kostenTotal}
            tuKosten={tu.kostenTotal}
          />

          {/* ── Abschluss ──────────────────────────────────────────────── */}
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col />
                <col style={{ width: '11rem' }} />
                <col style={{ width: '2.5rem' }} />
              </colgroup>
              <tbody>
                <tr className="border-b border-slate-50">
                  <td className="px-3 py-1.5 text-slate-700">
                    <span className="inline-flex items-center gap-1.5">
                      <Farbpunkt farbe={FARBE_LP} />Gewinn nach Steuern · {doc.landprovider.name}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(Math.round(lp.gewinnNachSteuern))}</td>
                </tr>
                <tr className="border-b border-slate-50">
                  <td className="px-3 py-1.5 text-slate-700">
                    <span className="inline-flex items-center gap-1.5">
                      <Farbpunkt farbe={FARBE_TU} />Gewinn nach Steuern · {doc.totalunternehmer.name}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(Math.round(tu.gewinnNachSteuern))}</td>
                </tr>
                <tr className="text-base font-bold" style={{ backgroundColor: TOTALFLAECHE }}>
                  <td className="px-3 py-2.5">Gewinn nach Steuern total</td>
                  <td className={cn('px-3 py-2.5 text-right tabular-nums', gewinnTotal < 0 && 'text-red-700')}>
                    {formatNumber(Math.round(gewinnTotal))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  )
}

interface Kontrolle {
  anlagekosten: number
  zugeteilt: number
  differenz: number
  doppelt: Wahlposition[]
  offen: Wahlposition[]
  freiBetrag: number
  freiAnzahl: number
}

/**
 * Kontrollfeld: Stimmen die Kosten beider Gesellschaften mit den Anlagekosten
 * der Verkaufsobjekte überein? Bei einer Abweichung ein Warnhinweis samt den
 * wahrscheinlichen Ursachen.
 */
function KontrolleKosten({ kontrolle: k, lpName, tuName, lpKosten, tuKosten }: {
  kontrolle: Kontrolle
  lpName: string
  tuName: string
  lpKosten: number
  tuKosten: number
}) {
  const stimmt = Math.abs(k.differenz) < KONTROLLE_TOLERANZ
  const MAX = 8
  const liste = (ps: Wahlposition[]) => (
    <ul className="mt-0.5 space-y-0.5">
      {ps.slice(0, MAX).map((p) => (
        <li key={p.code} className="flex justify-between gap-3">
          <span>{p.label}</span>
          <span className="tabular-nums">{formatNumber(Math.round(p.betrag))}</span>
        </li>
      ))}
      {ps.length > MAX && <li>… und {ps.length - MAX} weitere</li>}
    </ul>
  )
  // Kopf wie die übrigen allgemeinen Unterkapitel; der Befund steht als
  // Abzeichen darin, damit er auch zugeklappt sichtbar bleibt.
  const status = (
    <span className={cn('ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-normal',
      stimmt ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-200 text-amber-900')}>
      {stimmt
        ? <CheckCircle2 className="h-3 w-3 text-emerald-600" />
        : <AlertTriangle className="h-3 w-3 text-amber-700" />}
      {stimmt ? 'stimmt mit den Anlagekosten überein' : 'Abweichung zu den Anlagekosten'}
    </span>
  )
  return (
    <UnterKapitel titel="Kontrolle Kosten" status={status}>
      <div className="space-y-3">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col />
            <col style={{ width: '11rem' }} />
            <col style={{ width: '2.5rem' }} />
          </colgroup>
          <tbody>
            <tr className="border-b border-slate-50">
              <td className="px-1 py-1.5 text-slate-700">
                <span className="inline-flex items-center gap-1.5"><Farbpunkt farbe={FARBE_LP} />Kosten total {lpName}</span>
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(Math.round(lpKosten))}</td>
            </tr>
            <tr className="border-b border-slate-50">
              <td className="px-1 py-1.5 text-slate-700">
                <span className="inline-flex items-center gap-1.5"><Farbpunkt farbe={FARBE_TU} />Kosten total {tuName}</span>
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(Math.round(tuKosten))}</td>
            </tr>
            <tr className="border-t border-slate-200 font-medium">
              <td className="px-1 py-1.5">Kosten beider Gesellschaften</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(Math.round(k.zugeteilt))}</td>
            </tr>
            <tr className="border-b border-slate-50">
              <td className="px-1 py-1.5 text-slate-700">Anlagekosten Verkaufsobjekte (inkl. MWST)</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(Math.round(k.anlagekosten))}</td>
            </tr>
            <tr className={cn('font-semibold', stimmt ? 'bg-emerald-50' : 'bg-amber-50')}>
              <td className="px-1 py-2">Differenz</td>
              <td className={cn('py-2 pr-3 text-right tabular-nums', !stimmt && 'text-amber-800')}>
                {k.differenz > 0 ? '+' : ''}{formatNumber(Math.round(k.differenz))}
              </td>
            </tr>
          </tbody>
        </table>

        {!stimmt && (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
            <p className="font-medium">
              {k.differenz > 0
                ? `Die Gesellschaften tragen ${formatNumber(Math.round(k.differenz))} mehr als die Anlagekosten.`
                : `Den Gesellschaften fehlen ${formatNumber(Math.round(-k.differenz))} gegenüber den Anlagekosten.`}
            </p>
            {k.doppelt.length > 0 && (
              <div>
                <div className="font-medium">Mehrfach zugeordnete Positionen:</div>
                {liste(k.doppelt)}
              </div>
            )}
            {k.offen.length > 0 && (
              <div>
                <div className="font-medium">Keiner Gesellschaft zugeordnete Positionen:</div>
                {liste(k.offen)}
              </div>
            )}
            {k.freiAnzahl > 0 && (
              <p>
                Frei erfasste Zeilen: {k.freiAnzahl} mit zusammen {formatNumber(Math.round(k.freiBetrag))} —
                sie können eine Position ersetzen oder zusätzlich zählen.
              </p>
            )}
          </div>
        )}
      </div>
    </UnterKapitel>
  )
}

/** Kleiner Farbpunkt — ordnet eine Zeile ihrer Gesellschaft zu. */
function Farbpunkt({ farbe }: { farbe: Farbe }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: farbe.kopf }} />
}

/**
 * Aufklappbares Unterkapitel — in der Farbe der Verkaufsobjekte oder, bei den
 * Teilen einer Gesellschaft, in deren Farbe.
 */
function UnterKapitel({ titel, badge, status, farbe = FARBE_VERKAUF, children }: {
  titel: string
  badge?: string
  /** Eigenes Abzeichen im Kopf (z.B. Befund der Kontrolle). */
  status?: ReactNode
  farbe?: Farbe
  children: ReactNode
}) {
  const [offen, setOffen] = useState(true)
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200">
      <button
        type="button"
        onClick={() => setOffen((o) => !o)}
        style={{ backgroundColor: farbe.kopf }}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:brightness-95"
      >
        {offen ? <ChevronDown className="h-4 w-4 text-slate-700" /> : <ChevronRight className="h-4 w-4 text-slate-700" />}
        <span>{titel}</span>
        {badge && (
          <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-normal text-slate-700">
            {badge}
          </span>
        )}
        {status}
      </button>
      {offen && <div className="bg-white p-4">{children}</div>}
    </section>
  )
}

/**
 * Investoren mit Einlage, Gewinnanteil und Verzinsung. Der Gewinnanteil folgt
 * dem Kapitalanteil, solange nichts anderes erfasst ist — dann steht er grau
 * da und lässt sich überschreiben.
 */
function InvestorenTabelle({ investoren, canWrite, onAdd, onSet, onDel }: {
  investoren: ReturnType<typeof berechneKapital>
  canWrite: boolean
  onAdd: () => void
  onSet: (id: string, patch: Partial<{ name: string; kapital: number; gewinnanteilPct: number | null; zinssatzPct: number }>) => void
  onDel: (id: string) => void
}) {
  const abweichung = investoren.investoren.length > 0
    && Math.abs(investoren.gewinnAnteilTotal - 1) > 0.001
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] table-fixed text-sm">
          <colgroup>
            <col />
            <col style={{ width: '9rem' }} />
            <col style={{ width: '7rem' }} />
            <col style={{ width: '8rem' }} />
            <col style={{ width: '6rem' }} />
            {/* Betrag und Aktionsspalte gleich breit wie in den übrigen
                Tabellen des Kapitels — so stehen die Zahlen untereinander. */}
            <col style={{ width: '11rem' }} />
            <col style={{ width: '2.5rem' }} />
          </colgroup>
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-3 font-medium">Investor</th>
              <th className="py-2 pr-3 text-right font-medium">Kapital CHF</th>
              <th className="py-2 pr-3 text-right font-medium">Anteil</th>
              <th className="py-2 pr-3 text-right font-medium">Gewinnanteil</th>
              <th className="py-2 pr-3 text-right font-medium">Zins % p.a.</th>
              <th className="py-2 pr-3 text-right font-medium">Gewinn CHF</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {investoren.investoren.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-xs text-slate-400">
                  Noch keine Investoren erfasst.
                </td>
              </tr>
            )}
            {investoren.investoren.map((inv) => (
              <tr key={inv.id} className="border-b border-slate-50">
                <td className="py-1 pr-3">
                  <input type="text" value={inv.name} disabled={!canWrite} placeholder="Name"
                    onChange={(e) => onSet(inv.id, { name: e.target.value })}
                    className="w-full rounded border border-transparent px-1 py-0.5 text-sm hover:border-slate-300 focus:border-[#8B6956] focus:bg-white focus:outline-none" />
                </td>
                <td className="py-1 pr-3">
                  <ZahlFeld value={inv.kapital} disabled={!canWrite}
                    onChange={(v) => onSet(inv.id, { kapital: v })} />
                </td>
                <td className="py-1 pr-3 text-right tabular-nums text-slate-500">
                  {(inv.kapitalAnteil * 100).toFixed(1)} %
                </td>
                <td className="py-1 pr-3">
                  <ZahlFeld
                    value={inv.gewinnanteilPct ?? Number((inv.kapitalAnteil * 100).toFixed(1))}
                    disabled={!canWrite}
                    // Leeres Feld heisst „nach Kapitalanteil" — die Vorgabe
                    // steht dann grau da, statt als erfasster Wert.
                    grau={inv.gewinnanteilPct == null}
                    schritt={0.1}
                    onChange={(v) => onSet(inv.id, { gewinnanteilPct: v })}
                    onLeer={() => onSet(inv.id, { gewinnanteilPct: null })} />
                </td>
                <td className="py-1 pr-3">
                  <ZahlFeld value={inv.zinssatzPct} disabled={!canWrite} schritt={0.1}
                    onChange={(v) => onSet(inv.id, { zinssatzPct: v })} />
                </td>
                <td className="py-1 pr-3 text-right tabular-nums text-slate-700">
                  {formatNumber(Math.round(inv.gewinnAnteilChf))}
                </td>
                <td className="py-1 text-right">
                  {canWrite && (
                    <button type="button" onClick={() => onDel(inv.id)}
                      className="rounded p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                      title="Investor entfernen">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            <tr className="font-semibold" style={{ backgroundColor: HILITE }}>
              <td className="py-2 pr-3">Total</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(Math.round(investoren.kapitalTotal))}</td>
              <td className="py-2 pr-3 text-right tabular-nums">100.0 %</td>
              <td className={cn('py-2 pr-3 text-right tabular-nums', abweichung && 'text-amber-700')}>
                {(investoren.gewinnAnteilTotal * 100).toFixed(1)} %
              </td>
              <td className="py-2 pr-3" />
              <td className="py-2 pr-3 text-right tabular-nums">
                {formatNumber(Math.round(investoren.investoren.reduce((s, i) => s + i.gewinnAnteilChf, 0)))}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {abweichung && (
        <p className="text-xs text-amber-700">
          Die Gewinnanteile ergeben zusammen {(investoren.gewinnAnteilTotal * 100).toFixed(1)} %
          statt 100 % — der ausgewiesene Gewinn wird damit nicht vollständig verteilt.
        </p>
      )}
      {canWrite && (
        <button type="button" onClick={onAdd}
          className="inline-flex items-center gap-1 rounded-md border border-[#B98C74] bg-[#F2D3C2]/40 px-2 py-1 text-xs font-medium text-[#5A3F2E] hover:bg-[#F2D3C2]/70">
          <Plus className="h-3.5 w-3.5" /> Investor
        </button>
      )}
      <p className="text-[11px] text-slate-400">
        Der Zins läuft auf der Einlage und ist hier als Jahresbetrag ausgewiesen; die
        Gewinnverteilung folgt dem Kapitalanteil, wo kein eigener Anteil erfasst ist.
      </p>
    </div>
  )
}

/**
 * Kostenblock einer Gesellschaft: Zeilen aus der Kostenberechnung und frei
 * erfasste Zeilen nebeneinander. Übernommene Positionen führen ihren Betrag
 * nicht selbst — er kommt aus den Anlagekosten und bleibt damit aktuell.
 */
function KostenBlock({
  farbe, titel, hinweis, zeilen, bezug, positionen, positionsBetraege, canWrite, mitAnteil,
  gruppenSchalter, onChange,
}: {
  farbe: Farbe
  titel: string
  hinweis: string
  zeilen: KsKostenZeile[]
  bezug: number
  positionen: Wahlposition[]
  positionsBetraege: Map<string, number>
  canWrite: boolean
  mitAnteil?: boolean
  /** Knopf, der alle Hauptgruppen zu- oder aufklappt (BKP 1-stellig ↔ detailliert). */
  gruppenSchalter?: boolean
  onChange: (zeilen: KsKostenZeile[]) => void
}) {
  const [wahlOffen, setWahlOffen] = useState(false)
  const [markiert, setMarkiert] = useState<Set<string>>(new Set())
  const total = zeilen.reduce(
    (s, z) => s + zeilenBetrag(z, z.code ? positionsBetraege.get(z.code) : undefined, bezug), 0)

  const setZeile = (id: string, patch: Partial<KsKostenZeile>) =>
    onChange(zeilen.map((z) => (z.id === id ? { ...z, ...patch } : z)))

  /*
   * Angezeigt wird nach BKP-Nummer, unabhängig davon, in welcher Reihenfolge
   * die Zeilen übernommen wurden. Frei erfasste Zeilen haben keine Nummer und
   * stehen darunter, in ihrer Eingabereihenfolge.
   */
  const ordnung = new Map(positionen.map((p, i) => [p.code, i]))
  const sortierteZeilen = [...zeilen].sort((a, b) => {
    if (!a.code && !b.code) return 0
    if (!a.code) return 1
    if (!b.code) return -1
    return (ordnung.get(a.code) ?? Number.MAX_SAFE_INTEGER)
      - (ordnung.get(b.code) ?? Number.MAX_SAFE_INTEGER)
  })

  /*
   * Zeilen nach Hauptgruppe gebündelt, jede mit Zwischentotal und zuklappbar —
   * eine Liste aus dreissig Positionen liest sich sonst nicht.
   */
  const gruppen = useMemo(() => {
    const posNach = new Map(positionen.map((p) => [p.code, p]))
    const map = new Map<number, KsKostenZeile[]>()
    for (const z of sortierteZeilen) {
      // Freie Zeilen haben keine Nummer; sie sammeln sich unter „Weitere" (99).
      const hg = z.code ? (posNach.get(z.code)?.hauptgruppe ?? 99) : 99
      const liste = map.get(hg) ?? []
      liste.push(z)
      map.set(hg, liste)
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([hg, liste]) => ({
        hg,
        zeilen: liste,
        summe: liste.reduce(
          (sum, z) => sum + zeilenBetrag(
            z, z.code ? positionsBetraege.get(z.code) : undefined, bezug), 0),
      }))
  }, [sortierteZeilen, positionen, positionsBetraege, bezug])

  // Aufgeklappte Hauptgruppen. Leer = alles BKP 1-stellig — so beginnt die
  // Tabelle; auch später hinzukommende Gruppen stehen erst zugeklappt da.
  const [auf, setAuf] = useState<Set<number>>(new Set())
  const alleZu = gruppen.every((g) => !auf.has(g.hg))

  /** Auswahl mit den bereits übernommenen Positionen vorbelegen. */
  function wahlOeffnen() {
    setMarkiert(new Set(zeilen.map((z) => z.code).filter((c): c is string => !!c)))
    setWahlOffen(true)
  }

  /**
   * Übernimmt die Auswahl: je angehakter Position eine Zeile. Abgewählte
   * Positionen fallen weg, frei erfasste Zeilen bleiben unberührt.
   */
  function wahlUebernehmen() {
    const behalten = zeilen.filter((z) => !z.code || markiert.has(z.code))
    const vorhanden = new Set(behalten.map((z) => z.code).filter(Boolean))
    const neue = positionen
      .filter((p) => markiert.has(p.code) && !vorhanden.has(p.code))
      .map((p) => ({
        id: neueId('z'), code: p.code, label: p.label, betrag: 0,
        anteilPct: null, zinssatzPct: 0,
      }))
    onChange([...behalten, ...neue])
    setWahlOffen(false)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-900">{titel}</h4>
        {gruppenSchalter && gruppen.length > 0 && (
          <button
            type="button"
            onClick={() => setAuf(alleZu ? new Set(gruppen.map((g) => g.hg)) : new Set())}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50"
            title={alleZu ? 'Alle Positionen einzeln zeigen' : 'Nur die BKP-Hauptgruppen zeigen'}
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', alleZu && '-rotate-90')} />
            {alleZu ? 'Detailliert' : 'BKP 1-stellig'}
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] table-fixed text-sm">
          <colgroup>
            <col />
            {mitAnteil && <col style={{ width: '7rem' }} />}
            <col style={{ width: '11rem' }} />
            <col style={{ width: '2.5rem' }} />
          </colgroup>
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-3 font-medium">Bezeichnung</th>
              {mitAnteil && <th className="py-2 pr-3 text-right font-medium">Anteil %</th>}
              <th className="py-2 pr-3 text-right font-medium">Betrag CHF</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {zeilen.length === 0 && (
              <tr>
                <td colSpan={mitAnteil ? 4 : 3} className="py-3 text-center text-xs text-slate-400">
                  Noch keine Zeilen erfasst.
                </td>
              </tr>
            )}
            {gruppen.map((g) => (
              <Fragment key={g.hg}>
                <tr
                  className="cursor-pointer border-b border-slate-100 bg-slate-50/80 text-xs"
                  onClick={() => setAuf((m) => {
                    const neu = new Set(m)
                    if (neu.has(g.hg)) neu.delete(g.hg); else neu.add(g.hg)
                    return neu
                  })}
                >
                  <td className="py-1.5 pr-3 font-semibold text-slate-600" colSpan={mitAnteil ? 2 : 1}>
                    <span className="inline-flex items-center gap-1">
                      {!auf.has(g.hg)
                        ? <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                        : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
                      {g.hg === 99
                        ? 'Weitere Zeilen'
                        : `BKP ${g.hg} · ${HAUPTGRUPPEN.find((h) => h.code === g.hg)?.label ?? ''}`}
                      <span className="text-[10px] font-normal text-slate-400">
                        {g.zeilen.length} {g.zeilen.length === 1 ? 'Zeile' : 'Zeilen'}
                      </span>
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 text-right font-semibold tabular-nums text-slate-600">
                    {formatNumber(Math.round(g.summe))}
                  </td>
                  <td />
                </tr>
                {auf.has(g.hg) && g.zeilen.map((z) => {
              const ausKosten = z.code ? positionsBetraege.get(z.code) : undefined
              const betrag = zeilenBetrag(z, ausKosten, bezug)
              return (
                <tr key={z.id} className="border-b border-slate-50">
                  <td className="py-1 pr-3">
                    {z.code ? (
                      <span className="text-slate-700">
                        {z.label}
                        <span className="ml-1.5 text-[10px] text-slate-400">aus der Kostenberechnung</span>
                      </span>
                    ) : (
                      <input type="text" value={z.label} disabled={!canWrite} placeholder="Bezeichnung"
                        onChange={(e) => setZeile(z.id, { label: e.target.value })}
                        className="w-full rounded border border-transparent px-1 py-0.5 text-sm hover:border-slate-300 focus:border-[#8B6956] focus:bg-white focus:outline-none" />
                    )}
                  </td>
                  {mitAnteil && (
                    <td className="py-1 pr-3">
                      {z.code ? <div className="text-right text-xs text-slate-300">—</div> : (
                        <ZahlFeld value={z.anteilPct ?? 0} disabled={!canWrite} schritt={1}
                          grau={z.anteilPct == null}
                          onChange={(v) => setZeile(z.id, { anteilPct: v })}
                          onLeer={() => setZeile(z.id, { anteilPct: null })} />
                      )}
                    </td>
                  )}
                  <td className="py-1 pr-3">
                    {z.code || z.anteilPct != null ? (
                      <div className="px-1 text-right tabular-nums text-slate-500">{formatNumber(Math.round(betrag))}</div>
                    ) : (
                      <ZahlFeld value={z.betrag} disabled={!canWrite}
                        onChange={(v) => setZeile(z.id, { betrag: v })} />
                    )}
                  </td>
                  <td className="py-1 text-right">
                    {canWrite && (
                      <button type="button" onClick={() => onChange(zeilen.filter((x) => x.id !== z.id))}
                        className="rounded p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                        title="Zeile entfernen">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
                )
              })}
              </Fragment>
            ))}
            <tr className="font-medium" style={{ backgroundColor: farbe.zeile }}>
              <td className="py-2 pr-3" colSpan={mitAnteil ? 2 : 1}>Total {titel}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(Math.round(total))}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {canWrite && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={wahlOeffnen} disabled={positionen.length === 0}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 transition hover:border-[#8B6956] hover:text-[#8B6956] disabled:opacity-50">
              <Plus className="h-3.5 w-3.5" /> Positionen wählen
            </button>
            <button type="button"
              onClick={() => {
                onChange([...zeilen, {
                  id: neueId('z'), code: null, label: '', betrag: 0, anteilPct: null, zinssatzPct: 0,
                }])
                // Die neue Zeile steht unter „Weitere Zeilen" — die Gruppe
                // öffnen, sonst sähe man nicht, was man eben angelegt hat.
                setAuf((m) => new Set(m).add(99))
              }}
              className="inline-flex items-center gap-1 rounded-md border border-[#B98C74] bg-[#F2D3C2]/40 px-2 py-1 text-xs font-medium text-[#5A3F2E] hover:bg-[#F2D3C2]/70">
              <Plus className="h-3.5 w-3.5" /> Eigene Zeile
            </button>
          </div>

          {wahlOffen && (
            <PositionsWahl
              positionen={positionen}
              markiert={markiert}
              onToggle={(code) => setMarkiert((m) => {
                const neu = new Set(m)
                if (neu.has(code)) neu.delete(code); else neu.add(code)
                return neu
              })}
              onAlle={(codes, an) => setMarkiert((m) => {
                const neu = new Set(m)
                for (const c of codes) { if (an) neu.add(c); else neu.delete(c) }
                return neu
              })}
              onUebernehmen={wahlUebernehmen}
              onAbbrechen={() => setWahlOffen(false)}
            />
          )}
        </div>
      )}
      <p className="text-[11px] text-slate-400">{hinweis}</p>
    </div>
  )
}

/**
 * Auswahl der zu übernehmenden Positionen: die ganze Kostenberechnung als
 * Liste mit Haken, nach BKP geordnet und je Hauptgruppe gruppiert. Ein Haken
 * je Position ist schneller als eine Auswahl nach der anderen — und man sieht,
 * was schon übernommen ist.
 */
function PositionsWahl({ positionen, markiert, onToggle, onAlle, onUebernehmen, onAbbrechen }: {
  positionen: Wahlposition[]
  markiert: Set<string>
  onToggle: (code: string) => void
  onAlle: (codes: string[], an: boolean) => void
  onUebernehmen: () => void
  onAbbrechen: () => void
}) {
  const gruppen = useMemo(() => {
    const map = new Map<number, Wahlposition[]>()
    for (const p of positionen) {
      const liste = map.get(p.hauptgruppe) ?? []
      liste.push(p)
      map.set(p.hauptgruppe, liste)
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  }, [positionen])

  const alleCodes = positionen.map((p) => p.code)
  const gewaehlt = positionen.filter((p) => markiert.has(p.code))
  const summe = gewaehlt.reduce((s, p) => s + p.betrag, 0)

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <span className="text-xs font-medium text-slate-700">
          Positionen aus der Kostenberechnung
        </span>
        <span className="flex items-center gap-2 text-[11px] text-slate-500">
          <button type="button" onClick={() => onAlle(alleCodes, true)}
            className="rounded border border-slate-300 px-1.5 py-0.5 hover:border-[#8B6956] hover:text-[#8B6956]">
            alle
          </button>
          <button type="button" onClick={() => onAlle(alleCodes, false)}
            className="rounded border border-slate-300 px-1.5 py-0.5 hover:border-[#8B6956] hover:text-[#8B6956]">
            keine
          </button>
        </span>
      </div>

      <div className="max-h-72 overflow-y-auto px-3 py-2">
        {gruppen.map(([hg, liste]) => {
          const codes = liste.map((p) => p.code)
          const alleAn = codes.every((c) => markiert.has(c))
          return (
            <div key={hg} className="mb-2 last:mb-0">
              <button type="button" onClick={() => onAlle(codes, !alleAn)}
                className="mb-1 w-full rounded px-1 py-0.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:bg-slate-50"
                title={alleAn ? 'Hauptgruppe abwählen' : 'Ganze Hauptgruppe wählen'}>
                BKP {hg} · {HAUPTGRUPPEN.find((h) => h.code === hg)?.label ?? ''}
              </button>
              {liste.map((p) => (
                <label key={p.code}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-slate-50">
                  <input type="checkbox" checked={markiert.has(p.code)}
                    onChange={() => onToggle(p.code)} className="h-3.5 w-3.5" />
                  <span className="flex-1 text-slate-700">{p.label}</span>
                  <span className="tabular-nums text-slate-500">{formatNumber(Math.round(p.betrag))}</span>
                </label>
              ))}
            </div>
          )
        })}
        {positionen.length === 0 && (
          <p className="py-3 text-center text-xs text-slate-400">
            Keine Positionen in der Kostenberechnung.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-2">
        <span className="text-[11px] text-slate-500">
          {gewaehlt.length} gewählt · {formatNumber(Math.round(summe))} CHF
        </span>
        <span className="flex items-center gap-2">
          <button type="button" onClick={onAbbrechen}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
            Abbrechen
          </button>
          <button type="button" onClick={onUebernehmen}
            className="rounded-md border border-[#B98C74] bg-[#F2D3C2]/60 px-2 py-1 text-xs font-medium text-[#5A3F2E] hover:bg-[#F2D3C2]">
            Übernehmen
          </button>
        </span>
      </div>
    </div>
  )
}

/** Ertrag, Kosten, Gewinn und Steuern einer Gesellschaft. */
function GewinnBlock({
  farbe, g, erg, ertragVorschlag, ertragLabel, kostenLabel, steuerLabel, canWrite, onSet, hinweis,
}: {
  farbe: Farbe
  g: KsGesellschaft
  erg: ReturnType<typeof berechneGesellschaft>
  ertragVorschlag: number
  ertragLabel: string
  kostenLabel: string
  steuerLabel: string
  canWrite: boolean
  onSet: (patch: Partial<KsGesellschaft>) => void
  hinweis: string
}) {
  return (
    <div className="space-y-2">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col />
          <col style={{ width: '8rem' }} />
          <col style={{ width: '11rem' }} />
          {/* Leere Spalte in der Breite der Abfalleimer — damit die Beträge
              auf derselben Flucht stehen wie in den Tabellen darüber. */}
          <col style={{ width: '2.5rem' }} />
        </colgroup>
        <tbody>
          <tr className="border-b border-slate-50">
            <td className="px-1 py-1.5 text-slate-700">{ertragLabel}</td>
            <td className="px-1 py-1.5">
              {canWrite && ertragVorschlag > 0 && g.ertrag !== ertragVorschlag && (
                <button type="button" onClick={() => onSet({ ertrag: ertragVorschlag })}
                  className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-[#8B6956] hover:text-[#8B6956]">
                  aus den Mengen
                </button>
              )}
            </td>
            <td className="px-1 py-1.5">
              <ZahlFeld value={g.ertrag} disabled={!canWrite} onChange={(v) => onSet({ ertrag: v })} />
            </td>
          </tr>
          <tr className="border-b border-slate-50">
            <td className="px-1 py-1.5 text-slate-700" colSpan={2}>{kostenLabel}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">−{formatNumber(Math.round(erg.kostenTotal))}</td>
          </tr>
          <tr className="border-t border-slate-200 font-medium" style={{ backgroundColor: farbe.zeile }}>
            <td className="px-1 py-2 text-slate-700" colSpan={2}>Gewinn vor Steuern</td>
            <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(Math.round(erg.gewinnVorSteuern))}</td>
          </tr>
          <tr className="border-b border-slate-50">
            <td className="px-1 py-1.5 text-slate-700">{steuerLabel}</td>
            <td className="px-1 py-1.5">
              <span className="inline-flex items-center gap-1">
                <ZahlFeld value={g.steuersatzPct} disabled={!canWrite} schritt={0.5}
                  onChange={(v) => onSet({ steuersatzPct: v })} />
                <span className="text-[10px] text-slate-400">%</span>
              </span>
              {/* Worauf der Satz rechnet — sonst bleibt unklar, warum bei
                  einem Verlust nichts dasteht. */}
              <div className="mt-0.5 text-[10px] text-slate-400">
                {erg.gewinnVorSteuern > 0
                  ? `von ${formatNumber(Math.round(erg.gewinnVorSteuern))}`
                  : 'kein Gewinn'}
              </div>
            </td>
            <td className="py-1.5 pr-3 text-right tabular-nums">
              {erg.gewinnVorSteuern > 0 ? `−${formatNumber(Math.round(erg.steuern))}` : '—'}
            </td>
          </tr>
          <tr className="font-semibold" style={{ backgroundColor: farbe.summe }}>
            <td className="px-1 py-2" colSpan={2}>Gewinn nach Steuern</td>
            <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(Math.round(erg.gewinnNachSteuern))}</td>
          </tr>
        </tbody>
      </table>

      <label className="block text-xs text-slate-600">
        <div className="mb-1">Bemerkungen zur Steuerberechnung</div>
        <textarea value={g.bemerkung} disabled={!canWrite} rows={2}
          onChange={(e) => onSet({ bemerkung: e.target.value })}
          className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm" />
      </label>
      <p className="text-[11px] text-slate-400">{hinweis}</p>
    </div>
  )
}

/**
 * Gewinn und Steuern des Totalunternehmers. Sein Erlös ist keine Eingabe: er
 * ist der Gesamterlös der Einheiten abzüglich des Landanteils, den der
 * Landprovider verrechnet — was der eine einnimmt, zahlt der andere.
 */
function GewinnBlockWerk({
  farbe, g, erg, verkaufserloesTotal, landanteil, werkerloes, canWrite, onSet,
}: {
  farbe: Farbe
  g: KsGesellschaft
  erg: ReturnType<typeof berechneGesellschaft>
  verkaufserloesTotal: number
  landanteil: number
  werkerloes: number
  canWrite: boolean
  onSet: (patch: Partial<KsGesellschaft>) => void
}) {
  return (
    <div className="space-y-2">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col />
          <col style={{ width: '8rem' }} />
          <col style={{ width: '11rem' }} />
          {/* Leere Spalte in der Breite der Abfalleimer — damit die Beträge
              auf derselben Flucht stehen wie in den Tabellen darüber. */}
          <col style={{ width: '2.5rem' }} />
        </colgroup>
        <tbody>
          <tr className="border-b border-slate-50">
            <td className="px-1 py-1.5 text-slate-700" colSpan={2}>
              Verkaufserlös Werk
              <span className="ml-1.5 text-[10px] text-slate-400">
                Gesamterlös {formatNumber(Math.round(verkaufserloesTotal))} − Landanteil {formatNumber(Math.round(landanteil))}
              </span>
            </td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(Math.round(werkerloes))}</td>
          </tr>
          <tr className="border-b border-slate-50">
            <td className="px-1 py-1.5 text-slate-700" colSpan={2}>Kosten Werk</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">−{formatNumber(Math.round(erg.kostenTotal))}</td>
          </tr>
          <tr className="border-t border-slate-200 font-medium" style={{ backgroundColor: farbe.zeile }}>
            <td className="px-1 py-2 text-slate-700" colSpan={2}>Gewinn vor Steuern</td>
            <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(Math.round(erg.gewinnVorSteuern))}</td>
          </tr>
          <tr className="border-b border-slate-50">
            <td className="px-1 py-1.5 text-slate-700">Gewinnsteuer Totalunternehmer</td>
            <td className="px-1 py-1.5">
              <span className="inline-flex items-center gap-1">
                <ZahlFeld value={g.steuersatzPct} disabled={!canWrite} schritt={0.5}
                  onChange={(v) => onSet({ steuersatzPct: v })} />
                <span className="text-[10px] text-slate-400">%</span>
              </span>
              {/* Worauf der Satz rechnet — sonst bleibt unklar, warum bei
                  einem Verlust nichts dasteht. */}
              <div className="mt-0.5 text-[10px] text-slate-400">
                {erg.gewinnVorSteuern > 0
                  ? `von ${formatNumber(Math.round(erg.gewinnVorSteuern))}`
                  : 'kein Gewinn'}
              </div>
            </td>
            <td className="py-1.5 pr-3 text-right tabular-nums">
              {erg.gewinnVorSteuern > 0 ? `−${formatNumber(Math.round(erg.steuern))}` : '—'}
            </td>
          </tr>
          <tr className="font-semibold" style={{ backgroundColor: farbe.summe }}>
            <td className="px-1 py-2" colSpan={2}>Gewinn nach Steuern</td>
            <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(Math.round(erg.gewinnNachSteuern))}</td>
          </tr>
        </tbody>
      </table>

      <label className="block text-xs text-slate-600">
        <div className="mb-1">Bemerkungen zur Steuerberechnung</div>
        <textarea value={g.bemerkung} disabled={!canWrite} rows={2}
          onChange={(e) => onSet({ bemerkung: e.target.value })}
          className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm" />
      </label>
      <p className="text-[11px] text-slate-400">
        Der Gesamterlös kommt aus den Mengen (Verkaufsobjekte), der Landanteil aus dem Feld
        „Verkaufserlös Landanteil" beim Landprovider. Besteuert wird nur ein positiver Gewinn.
      </p>
    </div>
  )
}

/**
 * Abschlusszeile eines Kostenblocks. Sie steht ausserhalb der Tabelle, hält
 * aber deren rechte Geometrie — Betragsspalte und die leere Spalte der
 * Abfalleimer —, damit die Zahl unter den Beträgen darüber steht.
 */
function SummenZeile({ label, betrag, farbe }: { label: string; betrag: number; farbe: Farbe }) {
  return (
    <div className="flex items-center rounded-lg py-2 text-sm font-semibold"
      style={{ backgroundColor: farbe.summe }}>
      <span className="flex-1 px-3">{label}</span>
      <span className="w-44 pr-3 text-right tabular-nums">{formatNumber(Math.round(betrag))}</span>
      <span className="w-10" />
    </div>
  )
}

/**
 * Zahlenfeld mit Tausendertrennung. `onLeer` macht das Feld löschbar — dort,
 * wo „leer" etwas anderes heisst als „null": keine eigene Vorgabe.
 */
function ZahlFeld({ value, disabled, schritt = 1, grau, onChange, onLeer }: {
  value: number
  disabled?: boolean
  schritt?: number
  grau?: boolean
  onChange: (v: number) => void
  onLeer?: () => void
}) {
  const eingabe = useEingabe()
  return (
    <input
      type="text"
      inputMode="decimal"
      value={eingabe.text(String(value), formatNumber(value, schritt < 1 ? 1 : 0))}
      disabled={disabled}
      onFocus={eingabe.onFocus}
      onChange={eingabe.onChange}
      onBlur={() => {
        const roh = eingabe.verlassen()
        if (roh == null) return
        const text = roh.trim()
        if (text === '' && onLeer) { onLeer(); return }
        const n = parseFloat(text.replace(/['’\s]/g, '').replace(',', '.'))
        onChange(Number.isFinite(n) ? n : value)
      }}
      className={cn(
        'w-full rounded border border-slate-300 bg-white px-2 py-0.5 text-right text-sm tabular-nums outline-none focus:border-[#8B6956]',
        grau && 'text-slate-400',
      )}
    />
  )
}
