import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Waves, Plus, Trash2, ChevronDown, ChevronRight, AlertTriangle, GripVertical } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useUndoableState } from '@/contexts/UndoContext'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { useMittelfluss } from '@/hooks/useMittelfluss'
import { useKapitalSteuern } from '@/hooks/useKapitalSteuern'
import {
  gewinnsteuern, mittelflussCalc, mittelflussZeilen, objektErloesReihen,
  type MfCalc, type MfDispRow, type MfRow,
} from '@/lib/mittelflussRechnung'
import { useHonorar } from '@/hooks/useHonorar'
import { berechneHonorare, type HonorarInput } from '@/lib/honorar'
import { EIGENTUMSART_LABEL, eigentumsartForBuilding, type Eigentumsart } from '@/types'
import type { BkpErgebnis } from '@/lib/bkpBerechnung'
import { formatNumber } from '@/lib/utils'
import { ertragProNutzung } from '@/lib/bkpBlocks'
import { buildUnits } from '@/lib/mengenAnalyse'
import {
  analysiereReihe, ekKontoverzinsung, finanzierungsreihe,
  type EkKonto, type FinanzierungsReihe, type ReihenKennzahlen,
} from '@/lib/irr'
import { CI } from '@/lib/ci'
import {
  verkaufsVerteilung, type MfVerkauf, type VerkaufModell, type VerteilEbene,
  type MittelflussDoc, type MfPhase, type MfQuartal,
  defaultMittelflussDoc, quartaleZwischen,
  monatDiff, monatAdd, honorarPhasenGewichte, resolvePhasen, projektEnde,
} from '@/lib/mittelfluss'

const EMPTY_HON: HonorarInput = { anlagekosten: {}, factors: {}, pauschal: {} }

// Gemeinsame Spaltengeometrie für Terminplan UND Kostentabelle (px), damit die
// Quartalsspalten exakt übereinanderstehen.
const LEFT_POS = 420
const COL_GESAMT = 104
const COL_Q = 78
const COL_CTRL = 84
const COL_SUM = 96

// Farbton (hex + Alpha) für Quartals-Einfärbung; undefined → kein Ton.
const tint = (c: string | undefined, a: string) => (c ? `${c}${a}` : undefined)

// Segment-Verlauf über die Monate eines Quartals (harte Farbwechsel je Monat).
// Bei nur einer Farbe → einfarbig; ohne Phase → undefined.
function segBackground(monthColors: (string | undefined)[] | undefined, alpha: string): string | undefined {
  if (!monthColors || monthColors.length === 0 || monthColors.every((c) => !c)) return undefined
  const m = monthColors.length
  if (m === 1) return tint(monthColors[0], alpha)
  const stops: string[] = []
  for (let j = 0; j < m; j++) {
    const col = monthColors[j] ? `${monthColors[j]}${alpha}` : 'transparent'
    stops.push(`${col} ${(j / m) * 100}%`, `${col} ${((j + 1) / m) * 100}%`)
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

interface QGeo { monthStart: number; months: number }


export function MittelflussSection({ projectId, variantId, defaultExpanded = false }: {
  projectId: string
  variantId: string
  defaultExpanded?: boolean
}) {
  const { canWrite } = useAuth()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const ak = useAnlagekostenShared()

  /*
   * Der Landanteil am Verkaufserlös steht in „Kapital und Steuern" — hier wird
   * er nur gelesen, um ihn auf die Wohnungen zu verteilen.
   */
  const { loaded: ksDoc } = useKapitalSteuern(variantId)
  const landerloes = ksDoc?.landprovider.ertrag ?? 0
  /*
   * Was die Kapitalstruktur in „Kapital und Steuern" an Eigenkapital führt —
   * die Bezugsgrösse zu den Einlagen, die hier über die Quartale verteilt
   * werden. Sie steht in der Spalte „Gesamt" der Eingabezeile, wie bei den
   * Kostenpositionen der erfasste Betrag neben der verteilten Summe.
   */
  const ekErfasst = (ksDoc?.investoren ?? []).reduce((s, i) => s + i.kapital, 0)

  // ── Persistenz (JSONB pro Variante) + globales Undo/Redo, robuster Save ──────
  const { loaded, loading, save } = useMittelfluss(variantId)
  const [doc, setDoc, setDocSilent] = useUndoableState<MittelflussDoc>(defaultMittelflussDoc, 'Mittelfluss')
  const hydrated = useRef(false)
  const lastSaved = useRef<MittelflussDoc | null>(null)
  const docRef = useRef(doc)
  const saveRef = useRef(save)
  useLayoutEffect(() => { docRef.current = doc; saveRef.current = save })
  useEffect(() => {
    if (loading || hydrated.current) return
    const init = loaded ?? defaultMittelflussDoc()
    lastSaved.current = init
    docRef.current = init
    hydrated.current = true
    setDocSilent(init)
  }, [loading, loaded, setDocSilent])
  useEffect(() => {
    if (!hydrated.current || doc === lastSaved.current) return
    const t = setTimeout(() => { lastSaved.current = docRef.current; void saveRef.current(docRef.current) }, 600)
    return () => clearTimeout(t)
  }, [doc, save])
  useEffect(() => () => {
    if (hydrated.current && docRef.current !== lastSaved.current) {
      lastSaved.current = docRef.current
      void saveRef.current(docRef.current)
    }
  }, [])

  // ── Honorar-Phasen-Gewichte (für die Aufteilung 690a/690b) ───────────────────
  const { loaded: honorarDoc } = useHonorar(projectId)
  const honGewichte = useMemo(() => {
    if (!honorarDoc) return []
    const input = honorarDoc.inputs[variantId] ?? EMPTY_HON
    const res = berechneHonorare(input, honorarDoc.planer, {
      nebenkosten: honorarDoc.nebenkostenPct, mwst: honorarDoc.mwstPct, gp: honorarDoc.gpPct,
    })
    return honorarPhasenGewichte(res.phasen)
  }, [honorarDoc, variantId])

  // ── Ansicht: Verteilungs-Modus (Gesamt / nach Etappe) × Eigentumsart ─────────
  const [verteilModus, setVerteilModus] = useState<'gesamt' | 'etappe'>('gesamt')
  const [eigSel, setEigSel] = useState('gesamt')
  const eigsInScope = useMemo<Eigentumsart[]>(
    () => (eigSel === 'gesamt' ? ak.presentEig : [eigSel as Eigentumsart]),
    [eigSel, ak.presentEig],
  )
  const etappen = useMemo(() => ak.etappen ?? [], [ak.etappen])
  // Fremdfinanzierung/Zins beziehen sich auf den Gesamt-Saldo (je Eigentumsart-Ansicht).
  const fremdScope = `fremd|${eigSel}`

  const rows = useMemo<MfDispRow[]>(() => {
    // Benchmark und keeValue kennen keine Positionen; sonst entscheidet die
    // gewählte Ebene.
    const aufHauptgruppen = ak.benchmarkAktiv || ak.keeValueAktiv
      || doc.verteilEbene === 'hauptgruppe'
    const zeilen = (ergFor: (eig: Eigentumsart) => BkpErgebnis | undefined) => mittelflussZeilen({
      eigs: eigsInScope,
      positionsByEig: ak.positionsByEig,
      typForByEig: ak.typForByEig,
      ergFor,
      honGewichte: honGewichte,
      aufHauptgruppen,
    })

    const konsRows = zeilen((eig) => ak.konsolidiertEffektiv.get(eig))
    const konsScope = `kons|${eigSel}`

    if (verteilModus === 'gesamt') {
      return konsRows.map((r) => ({
        ...r, scope: konsScope, posKey: r.key, indent: 0, isHeader: false,
        editable: r.kind !== 'finanzierung',
      }))
    }

    // Etappen-Modus: je Position eine Kopfzeile + je Etappe eine editierbare Unterzeile.
    const etAmt = new Map<string, Map<string, MfRow>>()
    for (const et of etappen) {
      const rws = zeilen((eig) => ak.blockErgebnisseEffektiv.get(`${et.id}::${eig}`))
      etAmt.set(et.id, new Map(rws.map((r) => [r.key, r])))
    }
    const disp: MfDispRow[] = []
    for (const r of konsRows) {
      if (r.kind === 'finanzierung') {
        disp.push({ ...r, scope: konsScope, posKey: r.key, indent: 0, isHeader: false, editable: false })
        continue
      }
      disp.push({ ...r, scope: konsScope, posKey: r.key, indent: 0, isHeader: true, editable: false, groupId: r.key })
      for (const et of etappen) {
        const er = etAmt.get(et.id)?.get(r.key)
        disp.push({
          key: `${r.key}@@${et.id}`, label: et.name, hauptgruppe: r.hauptgruppe,
          netto: er?.netto ?? 0, mwst: er?.mwst ?? 0, brutto: er?.brutto ?? 0, kind: r.kind,
          scope: `${et.id}|${eigSel}`, posKey: r.key, indent: 1, isHeader: false,
          editable: true, groupId: r.key,
        })
      }
    }
    return disp
  }, [ak, eigsInScope, verteilModus, eigSel, etappen, honGewichte, doc.verteilEbene])

  // ── Zeitachse (Quartale + Monatsgeometrie je Quartal) ────────────────────────
  /*
   * Das Ende folgt dem Terminplan: zwei Quartale nach dem letzten Eintrag.
   * Von Hand gesetzt, blieb es beim Verschieben einer Phase stehen — und die
   * Zahlungsreihe brach ab, bevor das Geld zurückkam. Ohne Termineintrag gilt
   * weiter das gespeicherte Ende.
   */
  const endMonat = useMemo(
    () => projektEnde(doc.phasen) ?? doc.endMonat,
    [doc.phasen, doc.endMonat],
  )
  const quartale = useMemo<MfQuartal[]>(() => quartaleZwischen(doc.startMonat, endMonat), [doc.startMonat, endMonat])
  const quartalGeo = useMemo<QGeo[]>(() => {
    const geo: QGeo[] = []
    let acc = 0
    for (const q of quartale) { geo.push({ monthStart: acc, months: q.monate }); acc += q.monate }
    return geo
  }, [quartale])
  const monthCount = quartalGeo.reduce((s, g) => s + g.months, 0)
  // Verkettete Phasen (an Vorgänger) auflösen — für Balken und Zell-Einfärbung.
  const resolvedPhasen = useMemo(() => resolvePhasen(doc.phasen), [doc.phasen])

  // Phasenfarbe je MONAT innerhalb jedes Quartals — für den Segment-Verlauf der
  // Zellen (mehrere Phasen im selben Quartal werden sichtbar aufgeteilt).
  const quartalMonthColors = useMemo<(string | undefined)[][]>(() => {
    return quartale.map((_, qi) => {
      const g = quartalGeo[qi]
      const arr: (string | undefined)[] = []
      for (let m = 0; m < g.months; m++) {
        const idx = g.monthStart + m
        let color: string | undefined
        for (const p of resolvedPhasen) {
          const s = monatDiff(doc.startMonat, p.startMonat)
          const e = s + p.dauerMonate - 1
          if (idx >= s && idx <= e) color = p.farbe // spätere Phase gewinnt bei Überlappung
        }
        arr.push(color)
      }
      return arr
    })
  }, [quartale, quartalGeo, resolvedPhasen, doc.startMonat])

  // ── Berechnung je Quartal ────────────────────────────────────────────────────
  const calc = useMemo(
    () => mittelflussCalc(rows, doc.verteilung, quartale.map((q) => q.key)),
    [rows, doc.verteilung, quartale],
  )

  // ── Verkaufserlöse je Quartal ────────────────────────────────────────────────
  // Nur Verkaufsobjekte bringen Einnahmen während der Projektdauer; Rendite-
  // und Genossenschaftsbauten bleiben im Bestand. Der Betrag kommt aus dem
  // Mengengerüst, die zeitliche Verteilung aus dem gewählten Verkaufsmodell.
  const erloesScope = `erloes|${eigSel}`
  const erloesTotal = useMemo(() => {
    if (!eigsInScope.includes('verkaufsobjekt')) return 0
    const gebaeude = ak.buildings.filter(
      (b) => eigentumsartForBuilding(b.use_type) === 'verkaufsobjekt')
    return Object.values(ertragProNutzung(gebaeude)).reduce((s, v) => s + v, 0)
  }, [ak.buildings, eigsInScope])

  const verkaufPct = useMemo(
    () => verkaufsVerteilung(
      { ...doc, endMonat }, quartale, doc.verteilung[erloesScope]?.['erloes'] ?? {}),
    [doc, endMonat, quartale, erloesScope],
  )
  /**
   * Die einzelnen Verkaufsobjekte — Wohnungen, Parkplätze, was im Mengengerüst
   * als Verkaufseinheit steht. Wer den Verkaufsplan Objekt für Objekt kennt,
   * verteilt hier statt am Gesamterlös.
   */
  const verkaufsObjekte = useMemo(() => {
    if (erloesTotal <= 0) return []
    return buildUnits(ak.buildings, ak.etappen)
      .filter((u) => u.eig === 'verkaufsobjekt' && u.mietePa * u.anzahl > 0)
      .map((u) => ({
        id: u.id,
        label: [u.haus, u.geschoss !== '–' ? u.geschoss : null,
          u.wohnungsnummer || u.bezeichnung || u.zimmerLabel || u.nutzung]
          .filter(Boolean).join(' · '),
        betrag: u.mietePa * u.anzahl,
        /** Verkaufsfläche — nur Einheiten mit Fläche tragen Land. */
        vkf: u.vmf * u.anzahl,
      }))
  }, [ak.buildings, ak.etappen, erloesTotal])

  const objektReihen = useMemo(
    () => objektErloesReihen(
      verkaufsObjekte, quartale.map((q) => q.key),
      doc.verteilung[erloesScope], landerloes),
    [verkaufsObjekte, quartale, doc.verteilung, erloesScope, landerloes],
  )

  const erloese = useMemo(() => {
    if (doc.verkauf.modell === 'objekte') {
      return quartale.map((_, i) => objektReihen.reduce((s, o) => s + (o.betraege[i] ?? 0), 0))
    }
    return verkaufPct.map((p) => (p / 100) * erloesTotal)
  }, [doc.verkauf.modell, objektReihen, quartale, verkaufPct, erloesTotal])

  /*
   * Die beiden Gewinnsteuern stehen in „Kapital und Steuern"; hier fliessen sie
   * als Zahlungen ein. Ihre Höhe wird dort gerechnet, ihre Fälligkeit hier
   * verteilt — sie fallen meist erst nach dem Verkauf an.
   */
  const steuerScope = `steuer|${eigSel}`
  const steuern = useMemo(
    () => gewinnsteuern(
      ksDoc, ak.konsolidiertEffektiv.get('verkaufsobjekt'),
      ak.benchmarkAktiv || ak.keeValueAktiv, erloesTotal),
    [ksDoc, ak.konsolidiertEffektiv, ak.benchmarkAktiv, ak.keeValueAktiv, erloesTotal],
  )

  const steuerReihen = useMemo(() => {
    const reihe = (key: string, label: string, betrag: number) => {
      const pct = quartale.map((q) => doc.verteilung[steuerScope]?.[key]?.[q.key] ?? 0)
      return { key, label, betrag, pct, betraege: pct.map((p) => (p / 100) * betrag) }
    }
    return [
      reihe('ggst', 'Grundstückgewinnsteuer', steuern.grundstueckgewinn),
      reihe('gewinnsteuer_tu', 'Gewinnsteuer Totalunternehmer', steuern.gewinnTu),
    ]
  }, [steuern, quartale, doc.verteilung, steuerScope])

  /** Steuerzahlungen je Quartal — sie mindern den Mittelfluss wie Kosten. */
  const steuerJeQuartal = useMemo(
    () => quartale.map((_, i) => steuerReihen.reduce((s, r) => s + (r.betraege[i] ?? 0), 0)),
    [steuerReihen, quartale],
  )

  // ── Zahlungsreihen und interner Zinsfuss ─────────────────────────────────────
  /*
   * Tabelle und Kennzahlen rechnen aus derselben Reihe: der Bedarf je Quartal
   * (Kosten und Steuern abzüglich Erlöse) wird zuerst vom erfassten
   * Eigenkapital getragen, der Rest vom Fremdkapital. Früher lief das
   * beanspruchte Eigenkapital über eine eigene Formel und der interne Zinsfuss
   * über ein Wasserfallmodell — die beiden konnten sich widersprechen, und
   * ohne erfasste Einlagen fehlte dem Zinsfuss jede Auszahlung. Jetzt kommt
   * beides aus `finanzierungsreihe`. Die Tabelle zeigt davon die Stände bis
   * zum Saldo Fremdkapital; die abgeleiteten Reihen tragen nur noch die
   * Kennzahlen.
   */
  /**
   * Anlagekosten inklusive Mehrwertsteuer und Gewinnsteuern — die Kopfzeile der
   * Tabelle und zugleich die Kostenseite der Zahlungsreihe. Die Bauzinsen sind
   * darin enthalten: sie stehen als Positionen in den Eigentümerkosten, und
   * zwei Zahlen für dieselbe Sache gaben nur Verwirrung.
   */
  const kostenJeQuartal = useMemo(
    () => calc.qKeys.map(
      (_, i) => (calc.totNetto[i] ?? 0) + (calc.totMwst[i] ?? 0) + (steuerJeQuartal[i] ?? 0)),
    [calc, steuerJeQuartal],
  )

  /*
   * Zahlungstage der Quartale: das Quartalsende, auf einer fortlaufenden
   * Tagesachse. Damit rechnet der Zinsfuss kalendergenau wie XINTZINSFUSS im
   * Excel — Quartale sind unterschiedlich lang, und die Hochrechnung über
   * (1+q)^4 trifft es nur näherungsweise.
   */
  const zahlungsTage = useMemo(
    () => quartale.map((q) => Date.UTC(q.jahr, q.q * 3, 0) / 86_400_000),
    [quartale],
  )

  const irr = useMemo(() => {
    const ek = calc.qKeys.map((qk) => doc.verteilung[fremdScope]?.['eigenkapital']?.[qk] ?? 0)
    const tranche = calc.qKeys.map((qk) => doc.verteilung[fremdScope]?.['tranche']?.[qk] ?? 0)
    // Einnahmen abzüglich Ausgaben — die Sicht des Projekts.
    const projekt = erloese.map((e, i) => e - (kostenJeQuartal[i] ?? 0))
    const fin = finanzierungsreihe(projekt.map((v) => -v), ek, tranche)
    // Satz für den modifizierten Zinsfuss: der erfasste Finanzierungssatz.
    const satzProQuartal = doc.fremdZinssatz / 100 / 4
    const projektKennzahlen = analysiereReihe(projekt, { satzProQuartal, tage: zahlungsTage })
    return {
      ek,
      fin,
      projektReihe: projekt,
      projekt: projektKennzahlen,
      // Spitze der Beanspruchung — die Bezugsgrösse des Eigenkapital-Zinsfusses.
      spitzeEk: fin.beanspruchtesEk.reduce((m, v) => Math.max(m, v), 0),
      /*
       * Neben dem internen Zinsfuss die Verzinsung des eingebrachten
       * Eigenkapitals als Konto: die Einlagen quartalsweise verzinst, der
       * Endstand ist das Kapital zurück und der Projektgewinn obendrauf. Der
       * Gewinn ist die Summe der Projektreihe — Erlöse abzüglich aller Kosten
       * inklusive Bau- und Steuerzahlungen; das Fremdkapital ist darin mit
       * seinem Zins enthalten, sein Kapital geht rein und wieder raus.
       */
      konto: ekKontoverzinsung(ek, projektKennzahlen.summe),
    }
  }, [calc, doc.verteilung, doc.fremdZinssatz, fremdScope, erloese, kostenJeQuartal, zahlungsTage])

  // ── Setter ───────────────────────────────────────────────────────────────────
  const setPct = (scope: string, posKey: string, qKey: string, val: number) => setDoc((d) => {
    const sc = d.verteilung[scope] ?? {}
    const posMap = sc[posKey] ?? {}
    return { ...d, verteilung: { ...d.verteilung, [scope]: { ...sc, [posKey]: { ...posMap, [qKey]: val } } } }
  }, { label: 'Mittelfluss %', coalesceKey: `mf:${scope}:${posKey}:${qKey}` })

  const setRange = (patch: Partial<Pick<MittelflussDoc, 'startMonat' | 'endMonat'>>) =>
    setDoc((d) => ({ ...d, ...patch }), { label: 'Zeitfenster', coalesceKey: 'mf:range' })
  const setEbene = (e: VerteilEbene) =>
    setDoc((d) => ({ ...d, verteilEbene: e }), { label: 'Verteilungsebene' })
  const setVerkauf = (patch: Partial<MfVerkauf>) =>
    setDoc((d) => ({ ...d, verkauf: { ...d.verkauf, ...patch } }),
      { label: 'Verkaufserlöse', coalesceKey: 'mf:verkauf' })
  const setFremdZins = (v: number) =>
    setDoc((d) => ({ ...d, fremdZinssatz: v }), { label: 'Zinssatz Fremdfinanzierung', coalesceKey: 'mf:zins' })
  const setPhase = (id: string, patch: Partial<MfPhase>) =>
    setDoc((d) => ({ ...d, phasen: d.phasen.map((p) => (p.id === id ? { ...p, ...patch } : p)) }), { label: 'Terminplan', coalesceKey: `mf:phase:${id}` })
  const addPhase = () => setDoc((d) => {
    const id = `p-${Math.random().toString(36).slice(2, 8)}`
    const last = d.phasen[d.phasen.length - 1]
    const start = last ? monatAdd(last.startMonat, last.dauerMonate) : d.startMonat
    return { ...d, phasen: [...d.phasen, { id, label: 'Neue Phase', startMonat: start, dauerMonate: 3, farbe: CI.kupfer[7] }] }
  }, { label: 'Phase hinzufügen' })
  const delPhase = (id: string) => setDoc((d) => ({ ...d, phasen: d.phasen.filter((p) => p.id !== id) }), { label: 'Phase löschen' })
  const movePhase = (from: number, to: number) => setDoc((d) => {
    if (from === to || from < 0 || to < 0 || from >= d.phasen.length || to >= d.phasen.length) return d
    const arr = [...d.phasen]
    const [moved] = arr.splice(from, 1)
    arr.splice(to, 0, moved)
    return { ...d, phasen: arr }
  }, { label: 'Phase verschieben' })

  const N = quartale.length
  const tableCols = `${LEFT_POS}px ${COL_GESAMT}px repeat(${N}, ${COL_Q}px) ${COL_CTRL}px ${COL_SUM}px`
  const ganttCols = `${LEFT_POS}px ${COL_GESAMT}px repeat(${N}, ${COL_Q}px)`
  const totalW = LEFT_POS + COL_GESAMT + N * COL_Q + COL_CTRL + COL_SUM

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 bg-[#B98C74] px-5 py-3 text-sm font-semibold text-slate-900 transition hover:brightness-95"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-slate-700" /> : <ChevronRight className="h-4 w-4 text-slate-700" />}
        <Waves className="h-4 w-4 text-slate-700" />
        <span>Mittelfluss / Liquiditätsplanung</span>
      </button>

      {expanded && (loading ? (
        <div className="p-6 text-sm text-slate-500">Wird geladen…</div>
      ) : (
        <div className="space-y-5 p-5">
          {/* Zeitfenster */}
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-xs text-slate-600">
              <div className="mb-0.5">Projektstart</div>
              <input type="month" value={doc.startMonat} disabled={!canWrite}
                onChange={(e) => setRange({ startMonat: e.target.value })}
                className="rounded-md border border-slate-200 px-2 py-1 text-sm" />
            </label>
            <div className="text-xs text-slate-600">
              <div className="mb-0.5">Projektende</div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm text-slate-500">
                {endMonat}
              </div>
              <div className="mt-0.5 text-[10px] text-slate-400">
                zwei Quartale nach dem Terminplan
              </div>
            </div>
            <div className="text-xs text-slate-400">{N} Quartale · {monthCount} Monate</div>
          </div>

          {/* Ansicht-Umschalter */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[11px] uppercase tracking-wider text-slate-400">Verteilung:</span>
              <TabButton active={verteilModus === 'gesamt'} onClick={() => setVerteilModus('gesamt')}>Gesamt</TabButton>
              <TabButton active={verteilModus === 'etappe'} onClick={() => setVerteilModus('etappe')}>nach Etappe</TabButton>
              {verteilModus === 'etappe' && etappen.length === 0 && <span className="text-[11px] text-amber-600">(keine Etappen erfasst)</span>}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[11px] uppercase tracking-wider text-slate-400">Ebene:</span>
              <TabButton
                active={doc.verteilEbene === 'position' && !ak.benchmarkAktiv && !ak.keeValueAktiv}
                onClick={() => setEbene('position')}
              >
                Positionen
              </TabButton>
              <TabButton
                active={doc.verteilEbene === 'hauptgruppe' || ak.benchmarkAktiv || ak.keeValueAktiv}
                onClick={() => setEbene('hauptgruppe')}
              >
                Hauptgruppen
              </TabButton>
              {(ak.benchmarkAktiv || ak.keeValueAktiv) && (
                <span className="text-[11px] text-slate-400">
                  (die gewählte Erfassungsmethode rechnet auf Hauptgruppen)
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[11px] uppercase tracking-wider text-slate-400">Eigentumsart:</span>
              <TabButton active={eigSel === 'gesamt'} onClick={() => setEigSel('gesamt')}>Gesamt</TabButton>
              {ak.presentEig.map((eig) => (
                <TabButton key={eig} active={eigSel === eig} onClick={() => setEigSel(eig)}>{EIGENTUMSART_LABEL[eig]}</TabButton>
              ))}
            </div>
            {/*
              Der Finanzierungssatz steht nicht mehr in der Tabelle: die
              Bauzinsen stehen als Positionen in den Eigentümerkosten. Hier
              dient er allein dem modifizierten Zinsfuss — Fehlbeträge und
              Überschüsse werden zu diesem Satz verzinst.
            */}
            <div className="flex items-center gap-1">
              <span className="text-[11px] uppercase tracking-wider text-slate-400">
                Finanzierungssatz:
              </span>
              <div className="flex items-center gap-0.5 rounded bg-slate-100 px-1">
                <NumFeld value={doc.fremdZinssatz} disabled={!canWrite} onChange={setFremdZins}
                  className="w-14 border-0 bg-transparent py-0.5 text-right text-xs tabular-nums text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#B98C74]" />
                <span className="text-[10px] text-slate-500">% p. a.</span>
              </div>
              <span className="text-[11px] text-slate-400">(für den modifizierten Zinsfuss)</span>
            </div>
          </div>

          {canWrite && (
            <div className="flex justify-start">
              <button type="button" onClick={addPhase}
                className="inline-flex items-center gap-1 rounded-md border border-[#B98C74] bg-[#F2D3C2]/40 px-2 py-1 text-xs font-medium text-[#5A3F2E] hover:bg-[#F2D3C2]/70">
                <Plus className="h-3.5 w-3.5" /> Phase
              </button>
            </div>
          )}

          {/* Gemeinsamer horizontaler Scroll → Terminplan und Tabelle bleiben ausgerichtet */}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <div style={{ minWidth: totalW }}>
              <TerminplanGantt
                phasen={resolvedPhasen} quartale={quartale} quartalGeo={quartalGeo} startMonat={doc.startMonat}
                cols={ganttCols} canWrite={canWrite} onSetPhase={setPhase} onDelPhase={delPhase} onReorder={movePhase}
              />
              <KostenTabelle
                rows={rows} quartale={quartale} calc={calc} quartalMonthColors={quartalMonthColors}
                cols={tableCols} canWrite={canWrite} onSetPct={setPct}
                fremdScope={fremdScope}
                ekVert={doc.verteilung[fremdScope]?.['eigenkapital'] ?? {}}
                ekErfasst={ekErfasst}
                trancheVert={doc.verteilung[fremdScope]?.['tranche'] ?? {}}
                erloesScope={erloesScope} erloesTotal={erloesTotal}
                erloese={erloese} verkaufPct={verkaufPct} objektReihen={objektReihen}
                steuerScope={steuerScope} steuerReihen={steuerReihen} fin={irr.fin} konto={irr.konto}
                kostenJeQuartal={kostenJeQuartal}
                verkauf={doc.verkauf} onSetVerkauf={setVerkauf}
              />
            </div>
          </div>

          {/*
            * Kennzahlen und Erläuterung stehen auf der Breite der Tabelle, nicht
            * auf der des Containers: die Tabelle ist aus festen Spalten gebaut
            * und endet bei `totalW`, der Rest rechts davon ist leerer Grund.
            * Ohne diese Fessel liefen die Kacheln auf einem breiten Bildschirm
            * weit über die letzte Spalte hinaus. Ist die Tabelle breiter als das
            * Fenster, scrollt sie — dann bleiben die Kacheln bei 100 %.
            */}
          <div style={{ width: totalW, maxWidth: '100%' }}>
            <IrrKennzahlen
              quartale={quartale}
              erloesTotal={erloesTotal}
              projekt={irr.projekt}
              unterdeckung={irr.fin.deckungsluecke.some((v) => v > 0.5)}
              spitzeEk={irr.spitzeEk}
              eingelegt={irr.ek.reduce((a, v) => a + v, 0)}
              konto={irr.konto}
            />
          </div>
        </div>
      ))}
    </section>
  )
}

/**
 * Kennzahlen der Zahlungsreihe: was das Eigenkapital abwirft, wie viel Geld
 * das Projekt maximal bindet, wann es dreht und was unter dem Strich bleibt.
 * Die internen Zinsfüsse stehen im Bericht, nicht mehr hier.
 */
function IrrKennzahlen({
  quartale, erloesTotal, projekt, unterdeckung, spitzeEk, eingelegt, konto,
}: {
  quartale: MfQuartal[]
  erloesTotal: number
  projekt: ReihenKennzahlen
  unterdeckung: boolean
  spitzeEk: number
  eingelegt: number
  konto: EkKonto
}) {
  if (erloesTotal <= 0) {
    return (
      <p className="text-xs text-slate-400">
        Für die Kennzahlen braucht es Einnahmen: in „Mengen und Erträge" Verkaufspreise
        bei den Verkaufsobjekten erfassen. Rendite- und Genossenschaftsbauten bleiben im
        Bestand und haben während der Projektdauer keine Verkaufserlöse.
      </p>
    )
  }
  const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)} %`)
  const quartalLabel = (i: number | null) =>
    (i == null || !quartale[i] ? '—' : `${quartale[i].jahr} Q${quartale[i].q}`)

  return (
    <div className="space-y-2">
      {/* Vier Kacheln auf der Breite der Tabelle darüber — `minmax(0,1fr)`
          über `min-w-0` in der Kachel, sonst sperrt sich eine lange Zahl gegen
          das Schrumpfen und die Reihe schiebt sich über den Rand hinaus. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        {/* Das Eigenkapital als verzinstes Konto — die Zahl, die sich gegen
            eine andere Anlage halten lässt. */}
        <Kennzahl label="Verzinsung Eigenkapital" wert={pct(konto.satz)}
          hinweis={konto.satz != null
            ? `p. a., höchster Einsatz ${formatNumber(konto.spitzeEinsatz)} CHF, quartalsweise verzinst`
            : konto.spitzeEinsatz <= 0
              ? 'keine Einlagen erfasst'
              : 'kein Satz führt auf den Endwert'} />
        <Kennzahl label="Kapitalbindung" wert={formatNumber(projekt.kapitalbindung)}
          hinweis="grösster Mittelbedarf, CHF" />
        <Kennzahl label="Break-even" wert={quartalLabel(projekt.breakEven)}
          hinweis="Quartal, in dem die Reihe dreht" />
        <Kennzahl label="Projektgewinn" wert={formatNumber(projekt.summe)}
          hinweis="Summe der Zahlungsreihe, CHF" />
      </div>

      {/* Herleitung — die Rechnung soll man in der Tabelle nachlesen können,
          dort stehen Zins und Kontostand Quartal für Quartal. */}
      {konto.satz != null && (
        <p className="text-xs text-slate-500">
          <span className="font-medium text-slate-700">Verzinsung des Eigenkapitals:</span>{' '}
          Das eingebrachte Eigenkapital wird gerechnet wie ein Konto mit Quartalszins. Jedes
          Quartal gilt: Saldo des Vorquartals + Zins des Vorquartals + Einlage des laufenden
          Quartals; verzinst wird dieser Saldo mit einem Viertel des Jahreszinses, und der Zins
          kommt im nächsten Quartal dazu und verzinst sich mit. Gesucht ist der Satz, bei dem das
          Konto am Schluss genau auf den Gewinn kommt:
          {konto.zurueckgezogen > 0.5 ? (
            <>
              {' '}{formatNumber(konto.eingezahlt)} CHF Einlagen abzüglich
              {' '}{formatNumber(konto.zurueckgezogen)} CHF, die wieder herausgenommen wurden —
              netto {formatNumber(konto.einlagen)} CHF —, plus
            </>
          ) : (
            <>{' '}{formatNumber(konto.einlagen)} CHF Einlagen plus</>
          )}
          {' '}{formatNumber(konto.gewinn)} CHF Projektgewinn ergeben einen Endstand von
          {' '}{formatNumber(konto.endwert)} CHF. Das leistet ein Zins von
          {' '}<span className="font-medium text-slate-700">{pct(konto.satz)} p. a.</span> Der
          Kontostand steht in der Tabelle unter dem eingebrachten Eigenkapital. Anders als der interne
          Zinsfuss unterstellt diese Rechnung keine Wiederanlage von Rückflüssen.
          {konto.zurueckgezogen > 0.5 && (
            <> Zurückgezogenes Kapital verlässt das Konto und wird ab dann nicht mehr verzinst;
            die bis dahin angefallenen Zinsen bleiben liegen und laufen weiter — auch wenn das
            eingebrachte Kapital vollständig zurück ist.</>
          )}
        </p>
      )}
      {konto.satz == null && konto.spitzeEinsatz <= 0 && projekt.summe > 0 && (
        <p className="text-xs text-amber-700">
          Für die Verzinsung des Eigenkapitals braucht es Einlagen — die Zeile „Eingebrachtes
          Eigenkapital" ist leer. Ohne eingesetztes Kapital gibt es keinen Satz, auf den sich
          der Gewinn beziehen liesse.
        </p>
      )}
      {projekt.summe <= 0 && (
        <p className="text-xs text-amber-700">
          Die Zahlungsreihe summiert sich auf {formatNumber(projekt.summe)} CHF — ohne
          Überschuss gibt es keine Verzinsung, die sich ausweisen liesse.
        </p>
      )}
      {unterdeckung && (
        <p className="text-xs text-amber-700">
          Eigenkapital und Finanzierungstranchen decken den Mittelbedarf zeitweise nicht —
          die Lücke steht in der Tabelle als benötigtes Fremdkapital über dem Saldo Fremdkapital.
        </p>
      )}
      {eingelegt > 0 && eingelegt + 0.5 < spitzeEk && (
        <p className="text-xs text-amber-700">
          Das erfasste Eigenkapital von {formatNumber(eingelegt)} CHF liegt unter der
          Beanspruchung von {formatNumber(spitzeEk)} CHF — die Zeile „Eingebrachtes
          Eigenkapital" deckt den Bedarf nicht.
        </p>
      )}
    </div>
  )
}

function Kennzahl({ label, wert, hinweis }: { label: string; wert: string; hinweis: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
      {/* Die Beschriftung darf kürzen — sie steht vollständig im Tooltip. Zahl
          und Hinweis brechen lieber um, als dass etwas verloren geht. */}
      <div className="truncate text-[11px] font-medium text-slate-500" title={label}>{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900 [overflow-wrap:anywhere]">{wert}</div>
      <div className="text-[10px] text-slate-400 [overflow-wrap:anywhere]">{hinweis}</div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${active ? 'bg-[#8B6956] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
      {children}
    </button>
  )
}

/*
 * Die Beschriftungsspalte bleibt beim seitlichen Scrollen stehen. Damit die
 * Zahlen nicht unter ihr durchscheinen, braucht jede Zelle darin einen
 * deckenden Hintergrund — durchscheinende Tailwind-Töne wie `bg-slate-50/60`
 * genügen nicht. Die Farben unten sind dieselben Töne, fertig auf dem weissen
 * Grund der Sektion verrechnet. Die Linie rechts markiert die Kante, an der
 * die Tabelle wegläuft.
 */
const stickyLeft: React.CSSProperties = {
  position: 'sticky', left: 0, zIndex: 5, borderRight: '1px solid rgb(226 232 240)',
}
/** slate-50 auf Weiss: deckend statt `bg-slate-50/40`. */
const STICKY_ZART = '#fcfdfe'
/** slate-50 auf Weiss: deckend statt `bg-slate-50/70`. */
const STICKY_TON = '#fafcfd'

// ── Terminplan (quartalsbasiert, anteilige Balkenfüllung je Quartal) ──────────
function TerminplanGantt({ phasen, quartale, quartalGeo, startMonat, cols, canWrite, onSetPhase, onDelPhase, onReorder }: {
  phasen: MfPhase[]
  quartale: MfQuartal[]
  quartalGeo: QGeo[]
  startMonat: string
  cols: string
  canWrite: boolean
  onSetPhase: (id: string, patch: Partial<MfPhase>) => void
  onDelPhase: (id: string) => void
  onReorder: (from: number, to: number) => void
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  // Jahres-Gruppierung (aufeinanderfolgende Quartale gleichen Jahres).
  const jahre: { jahr: number; span: number }[] = []
  for (const q of quartale) {
    const last = jahre[jahre.length - 1]
    if (last && last.jahr === q.jahr) last.span++
    else jahre.push({ jahr: q.jahr, span: 1 })
  }

  return (
    <div className="border-b-2 border-slate-200 bg-slate-50/40">
      {/* Jahres-Kopf */}
      <div className="grid items-stretch" style={{ gridTemplateColumns: cols }}>
        <div style={{ ...stickyLeft, backgroundColor: STICKY_ZART }} className="px-3 py-1 text-[11px] font-semibold text-slate-500">Terminplan</div>
        <div className="bg-slate-50/40" />
        {jahre.map((y, i) => (
          <div key={i} style={{ gridColumn: `span ${y.span}` }} className="border-l border-slate-200 py-1 text-center text-[11px] font-semibold text-slate-600">{y.jahr}</div>
        ))}
      </div>
      {/* Quartals-Kopf */}
      <div className="grid items-stretch border-b border-slate-200" style={{ gridTemplateColumns: cols }}>
        <div style={{ ...stickyLeft, backgroundColor: STICKY_ZART }} />
        <div className="bg-slate-50/40" />
        {quartale.map((q) => (
          <div key={q.key} className="border-l border-slate-100 py-0.5 text-center text-[10px] font-medium text-slate-400">Q{q.q}</div>
        ))}
      </div>
      {/* Phasen-Zeilen */}
      {phasen.map((p, idx) => {
        const s = monatDiff(startMonat, p.startMonat)
        const e = s + p.dauerMonate - 1
        return (
          <div key={p.id}
            onDragOver={(ev) => { if (dragIdx !== null) { ev.preventDefault(); if (overIdx !== idx) setOverIdx(idx) } }}
            onDrop={(ev) => { ev.preventDefault(); if (dragIdx !== null && dragIdx !== idx) onReorder(dragIdx, idx); setDragIdx(null); setOverIdx(null) }}
            className={`grid items-center border-b border-slate-100 last:border-0 hover:bg-white/60 ${dragIdx === idx ? 'opacity-40' : ''} ${overIdx === idx && dragIdx !== null && dragIdx !== idx ? (idx < dragIdx ? 'border-t-2 border-t-[#8B6956]' : 'border-b-2 border-b-[#8B6956]') : ''}`}
            style={{ gridTemplateColumns: cols }}>
            <div style={stickyLeft} className="flex flex-col gap-0.5 bg-white px-2 py-1">
              <div className="flex items-center gap-1">
                <span
                  draggable={canWrite}
                  onDragStart={(ev) => { setDragIdx(idx); ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(idx)) }}
                  onDragEnd={() => { setDragIdx(null); setOverIdx(null) }}
                  title="Zum Umsortieren ziehen"
                  className={`shrink-0 ${canWrite ? 'cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600' : 'text-slate-300'}`}>
                  <GripVertical className="h-3.5 w-3.5" />
                </span>
                <input value={p.label} disabled={!canWrite}
                  onChange={(ev) => onSetPhase(p.id, { label: ev.target.value })}
                  className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-100 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#B98C74]" />
                {canWrite && (
                  <button type="button" onClick={() => onDelPhase(p.id)} title="Phase löschen"
                    className="shrink-0 rounded p-0.5 text-slate-300 hover:bg-red-50 hover:text-red-500">
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1 pl-4">
                <input type="month" value={p.startMonat} disabled={!canWrite || !!p.anVorgaenger}
                  title={p.anVorgaenger ? 'Start folgt automatisch dem Vorgänger' : undefined}
                  onChange={(ev) => onSetPhase(p.id, { startMonat: ev.target.value })}
                  className="rounded border border-slate-200 px-1 py-0.5 text-[10px] text-slate-500 disabled:bg-slate-50 disabled:text-slate-400" />
                <input type="number" min={1} value={p.dauerMonate} disabled={!canWrite}
                  onChange={(ev) => onSetPhase(p.id, { dauerMonate: Math.max(1, Number(ev.target.value) || 1) })}
                  className="w-10 rounded border border-slate-200 px-1 py-0.5 text-right text-[10px] text-slate-500" />
                <span className="text-[9px] text-slate-400">Mt</span>
                {idx > 0 && (
                  <label className="ml-1 flex items-center gap-0.5 text-[9px] text-slate-400" title="Start direkt an das Ende der vorherigen Phase koppeln">
                    <input type="checkbox" checked={!!p.anVorgaenger} disabled={!canWrite}
                      onChange={(ev) => {
                        if (ev.target.checked) {
                          const prev = phasen[idx - 1]
                          onSetPhase(p.id, { anVorgaenger: true, startMonat: prev ? monatAdd(prev.startMonat, prev.dauerMonate) : p.startMonat })
                        } else {
                          onSetPhase(p.id, { anVorgaenger: false })
                        }
                      }}
                      className="h-3 w-3" />
                    an Vorgänger
                  </label>
                )}
              </div>
            </div>
            <div className="bg-white" />
            {quartale.map((q, qi) => {
              const g = quartalGeo[qi]
              const a = Math.max(s, g.monthStart)
              const b = Math.min(e, g.monthStart + g.months - 1)
              const has = a <= b
              const left = has ? ((a - g.monthStart) / g.months) * 100 : 0
              const width = has ? ((b - a + 1) / g.months) * 100 : 0
              const roundL = a === s
              const roundR = b === e
              return (
                <div key={q.key} className="relative border-l border-slate-100 py-2">
                  {has && (
                    <div className="absolute top-1.5 bottom-1.5" style={{
                      left: `${left}%`, width: `${width}%`, backgroundColor: p.farbe,
                      borderTopLeftRadius: roundL ? 5 : 0, borderBottomLeftRadius: roundL ? 5 : 0,
                      borderTopRightRadius: roundR ? 5 : 0, borderBottomRightRadius: roundR ? 5 : 0,
                    }} />
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
      {phasen.length === 0 && <div className="px-4 py-3 text-xs text-slate-400">Keine Phasen — mit „+ Phase" hinzufügen.</div>}
    </div>
  )
}

// ── Kostentabelle (Positionen × Quartale), gleiche Geometrie wie der Terminplan ──
function KostenTabelle({ rows, quartale, calc, quartalMonthColors, cols, canWrite, onSetPct, fremdScope, ekVert, ekErfasst, trancheVert, erloesScope, erloesTotal, erloese, verkaufPct, objektReihen, steuerScope, steuerReihen, verkauf, onSetVerkauf, fin, konto, kostenJeQuartal }: {
  rows: MfDispRow[]
  quartale: MfQuartal[]
  calc: MfCalc
  quartalMonthColors: (string | undefined)[][]
  cols: string
  canWrite: boolean
  onSetPct: (scope: string, posKey: string, qKey: string, val: number) => void
  fremdScope: string
  ekVert: Record<string, number>
  /** Eigenkapital der Investoren aus „Kapital und Steuern". */
  ekErfasst: number
  trancheVert: Record<string, number>
  erloesScope: string
  erloesTotal: number
  erloese: number[]
  verkaufPct: number[]
  objektReihen: { id: string; label: string; betrag: number; pct: number[]; betraege: number[] }[]
  steuerScope: string
  steuerReihen: { key: string; label: string; betrag: number; pct: number[]; betraege: number[] }[]
  verkauf: MfVerkauf
  onSetVerkauf: (patch: Partial<MfVerkauf>) => void
  fin: FinanzierungsReihe
  /** Das Eigenkapital als verzinstes Konto — Zins und Stand je Quartal. */
  konto: EkKonto
  kostenJeQuartal: number[]
}) {
  const anzWarn = rows.filter((r) => {
    if (!r.editable) return false
    const sum = (calc.cells[r.key] ?? []).reduce((s, c) => s + c.brutto, 0)
    return Math.abs(sum - r.brutto) > Math.max(1, Math.abs(r.brutto) * 0.001)
  }).length
  // Die BKP-Zeilen lassen sich zuklappen — die Kopfzeile darüber führt das
  // Total, und wer die Zahlungsreihe liest, braucht die Positionen nicht.
  const [kostenZu, setKostenZu] = useState(false)
  const [erloesZu, setErloesZu] = useState(false)
  const sumTotNetto = calc.totNetto.reduce((s, v) => s + v, 0)
  const sumTotMwst = calc.totMwst.reduce((s, v) => s + v, 0)
  /*
   * Kopfzeile: BKP 0–9 mit Mehrwertsteuer, dazu die beiden Gewinnsteuern —
   * gerechnet in der Sektion, damit Tabelle und Kennzahlen auf derselben
   * Kostenseite stehen. Draussen bleibt allein die Finanzierung; sie läuft
   * unten für sich, auf dem Kapitalbedarf, den diese Zeile erst ergibt.
   */
  const totAKInkl = kostenJeQuartal
  const sumTotAKInkl = totAKInkl.reduce((s, v) => s + v, 0)
  /*
   * Saldo = laufende Summe aus Verkaufserlösen abzüglich der Anlagekosten
   * inklusive Mehrwertsteuer und Gewinnsteuern — also die Differenz der beiden
   * Kopfzeilen darüber. Positiv heisst: das Projekt hat mehr eingenommen als
   * ausgegeben.
   */
  const saldo: number[] = []
  {
    let run = 0
    totAKInkl.forEach((kosten, i) => {
      run += (erloese[i] ?? 0) - kosten
      saldo.push(run)
    })
  }
  /*
   * Die erfassten Summen — was Kostenberechnung und Mengengerüst führen. Sie
   * stehen in der Spalte „Gesamt" neben der Summe der verteilten Quartale: wo
   * die beiden auseinandergehen, ist eine Position nicht zu hundert Prozent
   * verteilt, und der Saldo ist entsprechend kleiner oder grösser.
   */
  const gesamtKosten = rows.reduce(
    (sum, r) => sum + (r.editable || r.kind === 'finanzierung' ? r.brutto : 0), 0)
    + steuerReihen.reduce((sum, r) => sum + r.betrag, 0)
  const gesamtErloes = verkauf.modell === 'objekte'
    ? objektReihen.reduce((sum, o) => sum + o.betrag, 0)
    : erloesTotal

  // Die beiden Eingabezeilen: eingebrachtes Eigenkapital und Tranchen.
  const ek = calc.qKeys.map((qk) => ekVert[qk] ?? 0)
  const sumEK = ek.reduce((s, v) => s + v, 0)
  const tranche = calc.qKeys.map((qk) => trancheVert[qk] ?? 0)
  const sumTranche = tranche.reduce((s, v) => s + v, 0)
  /*
   * Alles Abgeleitete — Schuldstand, beanspruchtes Eigenkapital und dessen
   * Zahlungsfluss — kommt aus `finanzierungsreihe` in der Sektion. Damit
   * rechnen die Kennzahlen auf genau den Zahlen, die hier stehen.
   */

  return (
    <div>
      {/* Kopf */}
      <div className="grid items-stretch border-b border-slate-200 bg-slate-50 text-slate-500" style={{ gridTemplateColumns: cols }}>
        <div style={stickyLeft} className="bg-slate-50 px-3 py-1.5 text-left text-xs font-medium">Position</div>
        <div className="px-2 py-1.5 text-right text-[11px] font-medium">Gesamt</div>
        {quartale.map((q, i) => (
          <div key={q.key} className="border-l border-slate-100 px-1 py-1.5 text-center text-[10px] font-medium"
            style={{ background: segBackground(quartalMonthColors[i], '22') }}>Q{q.q}</div>
        ))}
        <div className="px-2 py-1.5 text-right text-[10px] font-medium">nicht verteilt</div>
        <div className="px-2 py-1.5 text-right text-[11px] font-medium">Σ Quartale</div>
      </div>

      {/* Anlagekosten als Kopfzeile über ihren Positionen — zuklappbar */}
      <KopfZeile
        label="Anlagekosten inkl. MWST"
        values={totAKInkl} total={sumTotAKInkl} gesamt={gesamtKosten} cols={cols}
        quartalMonthColors={quartalMonthColors}
        zu={kostenZu} onToggle={() => setKostenZu((z) => !z)}
      />

      {/* Zeilen */}
      {!kostenZu && rows.map((r) => {
        const rc = calc.cells[r.key] ?? []
        const sumPct = rc.reduce((s, c) => s + c.pct, 0)
        const sumBrutto = rc.reduce((s, c) => s + c.brutto, 0)
        const unverteilt = 100 - sumPct
        const isFin = r.kind === 'finanzierung'
        const readOnly = !r.editable // Kopfzeile oder Finanzierung → keine %-Eingabe
        const abweichung = r.editable && Math.abs(sumBrutto - r.brutto) > Math.max(1, Math.abs(r.brutto) * 0.001)
        return (
          <div key={r.key} className={`grid items-stretch border-b border-slate-100 text-xs hover:bg-slate-50/40 ${r.isHeader ? 'bg-slate-50/70' : ''}`} style={{ gridTemplateColumns: cols }}>
            <div style={{ ...stickyLeft, backgroundColor: r.isHeader ? STICKY_TON : '#ffffff' }}
              className={`flex items-start gap-1 px-3 py-1 ${r.isHeader ? 'font-medium text-slate-800' : 'text-slate-700'}`} title={r.label}>
              {r.indent > 0 && <span className="w-4 shrink-0" />}
              {r.kind === 'honorar' && r.indent === 0 && <span className="mt-px shrink-0 rounded bg-[#F2D3C2] px-1 text-[9px] text-[#5A3F2E]">Honorar</span>}
              {isFin && <span className="mt-px shrink-0 rounded bg-blue-100 px-1 text-[9px] text-blue-700">Zins</span>}
              <span className={`min-w-0 leading-tight ${r.indent > 0 ? 'text-slate-500' : ''}`}>{r.label}</span>
            </div>
            <div className="px-2 py-1 text-right tabular-nums text-slate-500">{formatNumber(r.brutto)}</div>
            {rc.map((c, i) => (
              <div key={i} className="flex flex-col justify-center border-l border-slate-100 px-1 py-0.5"
                style={{ background: segBackground(quartalMonthColors[i], '14') }}>
                {readOnly ? (
                  <span className={`text-right text-[11px] tabular-nums ${isFin ? 'text-blue-700' : 'text-slate-500'}`}>{isFin || c.brutto ? formatNumber(c.brutto) : ''}</span>
                ) : (
                  <>
                    <div className="flex items-center justify-end gap-0.5 rounded px-0.5" style={{ background: segBackground(quartalMonthColors[i], '40') ?? '#f1f5f9' }}>
                      <NumFeld value={c.pct} disabled={!canWrite} negativ
                        onChange={(v) => onSetPct(r.scope, r.posKey, calc.qKeys[i], v)}
                        className="min-w-0 flex-1 border-0 bg-transparent py-0 text-right text-[11px] leading-tight tabular-nums text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#B98C74]" />
                      <span className="text-[9px] leading-none text-slate-500">%</span>
                    </div>
                    <span className="text-right text-[9px] leading-tight tabular-nums text-slate-400">{formatNumber(c.brutto)}</span>
                  </>
                )}
              </div>
            ))}
            <div className={`px-2 py-1 text-right tabular-nums ${readOnly ? 'text-slate-300' : Math.abs(unverteilt) < 0.1 ? 'text-emerald-600' : 'text-amber-600'}`}>
              {readOnly ? '—' : `${formatNumber(unverteilt, 1)} %`}
            </div>
            <div className="flex items-center justify-end gap-1 px-2 py-1 text-right tabular-nums font-medium text-slate-700">
              {abweichung && <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />}
              {formatNumber(sumBrutto)}
            </div>
          </div>
        )
      })}
      {!kostenZu && rows.length === 0 && <div className="px-3 py-4 text-center text-xs text-slate-400">Keine Kostenpositionen in dieser Ansicht.</div>}

      {/* Aufschlüsselung der Kopfzeile — sie klappt mit ihr zu */}
      {!kostenZu && (
        <>
          <FootRow label="Anlagekosten exkl. MWST" values={calc.totNetto} total={sumTotNetto} cols={cols} quartalMonthColors={quartalMonthColors} wieZeile />
          <FootRow label="Mehrwertsteuer" values={calc.totMwst} total={sumTotMwst} cols={cols} quartalMonthColors={quartalMonthColors} wieZeile />
        </>
      )}
      {/* ── Gewinnsteuern ──────────────────────────────────────────────────── */}
      {/* Höhe aus „Kapital und Steuern", Fälligkeit hier verteilt — sie fallen
          meist erst nach dem Verkauf an. */}
      {!kostenZu && steuerReihen.some((r) => Math.abs(r.betrag) >= 0.5) && steuerReihen.map((r) => (
        <PctInputRow key={r.key} label={r.label} scope={steuerScope} posKey={r.key}
          werte={r.pct} betraege={r.betraege} total={r.betrag}
          qKeys={calc.qKeys} cols={cols} quartalMonthColors={quartalMonthColors}
          canWrite={canWrite} onSet={onSetPct} />
      ))}

      {/* ── Verkaufserlöse ─────────────────────────────────────────────────── */}
      {/* Sie stehen direkt unter den Anlagekosten: Einnahmen und Ausgaben
          gehören nebeneinander, die Finanzierung folgt darunter. */}
      {erloesTotal > 0 && (
        <>
          {/* Luft zwischen Ausgaben und Einnahmen — die beiden Blöcke sollen
              sich nicht wie eine fortlaufende Liste lesen. */}
          <div className="h-[25px] bg-white" />
          <KopfZeile
            label="Verkaufserlöse total"
            values={erloese}
            total={erloese.reduce((sum, v) => sum + v, 0)}
            gesamt={gesamtErloes}
            cols={cols} quartalMonthColors={quartalMonthColors}
            zu={erloesZu} onToggle={() => setErloesZu((z) => !z)}
          />
          {!erloesZu && (
            <>
              <VerkaufSteuerung verkauf={verkauf} canWrite={canWrite} onSet={onSetVerkauf} cols={cols} />
              {verkauf.modell === 'frei' && (
                <PctInputRow label="Verkaufserlöse" scope={erloesScope} posKey="erloes"
                  werte={verkaufPct} betraege={erloese} total={erloesTotal}
                  qKeys={calc.qKeys} cols={cols} quartalMonthColors={quartalMonthColors}
                  canWrite={canWrite} onSet={onSetPct} />
              )}
              {/* Je Objekt eine Zeile: der Verkaufsplan, Wohnung für Wohnung. */}
              {verkauf.modell === 'objekte' && objektReihen.map((o) => (
                <PctInputRow key={o.id} label={o.label} scope={erloesScope} posKey={`obj:${o.id}`}
                  werte={o.pct} betraege={o.betraege} total={o.betrag} einzug
                  qKeys={calc.qKeys} cols={cols} quartalMonthColors={quartalMonthColors}
                  canWrite={canWrite} onSet={onSetPct} />
              ))}
            </>
          )}
        </>
      )}

      {/* Luft vor der Finanzierung — sie ist der dritte Block der Tabelle. */}
      <div className="h-[25px] bg-white" />
      {/* Σ Quartale = Stand am Ende der verteilten Reihe, Gesamt = derselbe
          Saldo aus den erfassten Beträgen. Zwei verschiedene Zahlen heissen:
          es ist nicht alles verteilt. */}
      <FootRow label="Saldo" values={saldo} total={saldo[saldo.length - 1] ?? 0}
        gesamt={gesamtErloes - gesamtKosten}
        cols={cols} quartalMonthColors={quartalMonthColors} strong />

      {/* Eingebrachtes Eigenkapital (Eingabe, CHF je Quartal) */}
      <ChfInputRow label="Eingebrachtes Eigenkapital" scope={fremdScope} posKey="eigenkapital" values={ek} total={sumEK}
        gesamt={ekErfasst > 0 ? ekErfasst : undefined} gesamtTitel={'Eigenkapital der Investoren aus \u201eKapital und Steuern\u201c'}
        qKeys={calc.qKeys} cols={cols} quartalMonthColors={quartalMonthColors} canWrite={canWrite} onSet={onSetPct} />

      {/* Erst der blosse Stand der Einlagen, dann dasselbe Konto verzinst: die
          Differenz der beiden Zeilen sind die aufgelaufenen Zinsen. Der
          Endstand ist das eingebrachte Eigenkapital plus den Projektgewinn —
          dafür wurde der Satz gesucht; er steht in der Spalte „Gesamt" noch
          einmal als Probe. Ohne Einlagen gibt es keinen Satz, dann bleibt es
          beim blossen Saldo. */}
      <FootRow label="Saldo Eigenkapital ohne Zinsen" values={fin.eingelegt}
        total={fin.eingelegt[fin.eingelegt.length - 1] ?? 0}
        cols={cols} quartalMonthColors={quartalMonthColors} />

      {konto.satz != null && (
        <>
          <FootRow label={`Saldo Eigenkapital mit Zins (${(konto.satz * 100).toFixed(2)} % p. a.)`}
            values={konto.stand} total={konto.stand[konto.stand.length - 1] ?? 0}
            gesamt={konto.endwert}
            cols={cols} quartalMonthColors={quartalMonthColors} />
          {/* Kontrolle: der Zins, den der Saldo des Quartals abwirft — er kommt
              im nächsten Quartal dazu. Seine Summe hinten muss dem Gewinn in
              der Spalte „Gesamt" entsprechen, sonst passt der Satz nicht. */}
          <FootRow label={`Zins je Quartal (${(konto.satz * 100 / 4).toFixed(3)} % des Saldos)`}
            values={konto.zins} total={konto.zins.reduce((sum, v) => sum + v, 0)}
            gesamt={konto.gewinn}
            cols={cols} quartalMonthColors={quartalMonthColors} />
        </>
      )}

      {/* Benötigtes Fremdkapital = kumulierter Saldo − kumuliertes Eigenkapital */}
      <FootRow label="Benötigtes Fremdkapital (Saldo − Eigenkapital)" values={fin.benoetigtesFk} total={fin.benoetigtesFk[fin.benoetigtesFk.length - 1] ?? 0} cols={cols} quartalMonthColors={quartalMonthColors} />

      {/* Finanzierungstranchen (Eingabe, CHF je Quartal) */}
      <ChfInputRow label="Finanzierungstranchen" scope={fremdScope} posKey="tranche" values={tranche} total={sumTranche}
        qKeys={calc.qKeys} cols={cols} quartalMonthColors={quartalMonthColors} canWrite={canWrite} onSet={onSetPct} />

      {/* Stand des aufgenommenen Fremdkapitals — Bezugsgrösse des Zinses darunter */}
      <FootRow label="Saldo Fremdkapital" values={fin.schuld}
        total={fin.schuld[fin.schuld.length - 1] ?? 0}
        cols={cols} quartalMonthColors={quartalMonthColors} />

      {/* Was bereitsteht und noch nicht gebraucht ist: der Saldo — während des
          Baus negativ — plus die beiden Finanzierungsstände. Negativ ist die
          Deckungslücke, dann reichen Eigenkapital und Tranchen zusammen nicht. */}
      <FootRow label="Finanzierungsreserven (Saldo + Eigenkapital + Fremdkapital)" values={fin.reserveFk}
        total={fin.reserveFk[fin.reserveFk.length - 1] ?? 0}
        cols={cols} quartalMonthColors={quartalMonthColors} />

      {anzWarn > 0 && (
        <div className="flex items-center gap-2 border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {anzWarn} Position(en): Summe der Quartale weicht vom Anlagekosten-Betrag ab (nicht 100 % verteilt).
        </div>
      )}
      {/* Der Saldo kann nur enthalten, was verteilt ist — fehlt ein Teil der
          Erlöse auf der Zeitachse, fehlt er auch im Saldo. */}
      {Math.abs(gesamtErloes - erloese.reduce((sum, v) => sum + v, 0)) > 1 && (
        <div className="flex items-center gap-2 border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Verkaufserlöse: von {formatNumber(Math.round(gesamtErloes))} CHF sind
          {' '}{formatNumber(Math.round(erloese.reduce((sum, v) => sum + v, 0)))} CHF auf
          Quartale verteilt — die Differenz von
          {' '}{formatNumber(Math.round(gesamtErloes - erloese.reduce((sum, v) => sum + v, 0)))} CHF
          fehlt im Saldo und im Zinsfuss.
        </div>
      )}
    </div>
  )
}

/**
 * Steuerzeile der Verkaufserlöse: Modell und, wo es darauf ankommt, Absatzdauer
 * und Anzahlung. Sie steht über der Erlöszeile, weil sie deren Verteilung
 * bestimmt.
 */
function VerkaufSteuerung({ verkauf, canWrite, onSet, cols }: {
  verkauf: MfVerkauf
  canWrite: boolean
  onSet: (patch: Partial<MfVerkauf>) => void
  cols: string
}) {
  return (
    <div className="grid items-stretch border-t border-slate-200 bg-slate-50/60 text-xs"
      style={{ gridTemplateColumns: cols }}>
      <div style={stickyLeft} className="flex flex-wrap items-center gap-2 bg-slate-50 px-3 py-1.5">
        <span className="font-medium text-slate-700">Verkauf</span>
        <select value={verkauf.modell} disabled={!canWrite}
          onChange={(e) => onSet({ modell: e.target.value as VerkaufModell })}
          className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#B98C74]">
          <option value="uebergabe">Zahlung bei Übergabe</option>
          <option value="baufortschritt">Anzahlung und Baufortschritt</option>
          <option value="frei">Gesamterlös frei verteilen</option>
          <option value="objekte">Je Verkaufsobjekt verteilen</option>
        </select>
        {verkauf.modell === 'baufortschritt' && (
          <>
            <label className="flex items-center gap-1 text-[11px] text-slate-500">
              Anzahlung
              <NumFeld value={verkauf.anzahlungPct} disabled={!canWrite}
                onChange={(v) => onSet({ anzahlungPct: Math.min(100, v) })}
                className="w-12 rounded border border-slate-300 bg-white px-1 py-0.5 text-right tabular-nums text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#B98C74]" />
              %
            </label>
            <label className="flex items-center gap-1 text-[11px] text-slate-500">
              über
              <NumFeld value={verkauf.dauerQuartale} disabled={!canWrite}
                onChange={(v) => onSet({ dauerQuartale: Math.max(1, Math.round(v)) })}
                className="w-10 rounded border border-slate-300 bg-white px-1 py-0.5 text-right tabular-nums text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#B98C74]" />
              Quartale
            </label>
          </>
        )}
      </div>
      <div className="bg-slate-50" />
      <div className="col-span-full" style={{ gridColumn: '3 / -1' }} />
    </div>
  )
}

/**
 * Erlöszeile mit Prozenteingabe je Quartal — dieselbe Mechanik wie bei den
 * Kosten, nur zeigt sie unter dem Feld den Betrag, den der Anteil ergibt.
 */
function PctInputRow({ label, scope, posKey, werte, betraege, total, einzug, qKeys, cols, quartalMonthColors, canWrite, onSet }: {
  label: string
  scope: string
  posKey: string
  werte: number[]
  betraege: number[]
  total: number
  /** Untergeordnete Zeile — ein einzelnes Objekt unter seiner Summe. */
  einzug?: boolean
  qKeys: string[]
  cols: string
  quartalMonthColors: (string | undefined)[][]
  canWrite: boolean
  onSet: (scope: string, posKey: string, qKey: string, val: number) => void
}) {
  const verteilt = werte.reduce((s, v) => s + v, 0)
  return (
    <div className="grid items-stretch border-t border-slate-100 text-xs" style={{ gridTemplateColumns: cols }}>
      <div style={stickyLeft}
        className={`flex items-center bg-white py-1.5 ${einzug ? 'pl-6 pr-3 text-slate-600' : 'px-3 font-medium text-slate-700'}`}>
        {label}
      </div>
      <div className="bg-white px-2 py-1.5 text-right tabular-nums text-slate-500">{formatNumber(total)}</div>
      {werte.map((v, i) => (
        <div key={i} className="flex flex-col border-l border-slate-100 px-1 py-0.5"
          style={{ background: segBackground(quartalMonthColors[i], '14') }}>
          <div className="flex w-full items-center rounded px-0.5"
            style={{ background: segBackground(quartalMonthColors[i], '40') ?? '#f1f5f9' }}>
            <NumFeld value={v} disabled={!canWrite} placeholder="0" negativ
              onChange={(neu) => onSet(scope, posKey, qKeys[i], neu)}
              className="w-full min-w-0 border-0 bg-transparent py-0 text-right text-[11px] leading-tight tabular-nums text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#B98C74]" />
          </div>
          <div className="px-0.5 text-right text-[10px] leading-tight tabular-nums text-slate-400">
            {betraege[i] ? formatNumber(betraege[i]) : ''}
          </div>
        </div>
      ))}
      <div className="bg-white px-2 py-1.5 text-right text-[10px] tabular-nums text-slate-400">
        {formatNumber(100 - verteilt, 1)} %
      </div>
      <div className="bg-white px-2 py-1.5 text-right tabular-nums font-medium text-slate-700">
        {formatNumber(betraege.reduce((s, v) => s + v, 0))}
      </div>
    </div>
  )
}

/**
 * Zahlenfeld, das den Zwischenstand als Text hält. Ein `type="number"` meldet
 * bei „1." einen leeren Wert — daraus würde beim Tippen eine 0, und das Komma
 * liesse sich gar nicht setzen. Übernommen wird beim Verlassen des Felds;
 * Komma und Punkt gelten beide als Dezimaltrennzeichen.
 */
function NumFeld({ value, disabled, placeholder, className, negativ, onChange }: {
  value: number
  disabled?: boolean
  placeholder?: string
  className: string
  /** Lässt negative Beträge zu — etwa die Rückzahlung einer Tranche. */
  negativ?: boolean
  onChange: (v: number) => void
}) {
  const [roh, setRoh] = useState<string | null>(null)
  /*
   * Ausser Gebrauch steht die Zahl gesetzt da — mit Tausenderzeichen wie
   * überall sonst in der Tabelle. Beim Tippen bleibt sie roh, sonst käme das
   * Trennzeichen der Eingabe in die Quere; beim Verlassen des Feldes wird es
   * ohnehin wieder weggeputzt.
   */
  const gesetzt = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 10 }).format(value)
  return (
    <input
      type="text"
      inputMode="decimal"
      value={roh ?? (value || value === 0 ? gesetzt : '')}
      disabled={disabled}
      placeholder={placeholder}
      onFocus={() => setRoh(String(value))}
      onChange={(e) => setRoh(e.target.value)}
      onBlur={() => {
        const n = parseFloat((roh ?? '').replace(/['’\s]/g, '').replace(',', '.'))
        onChange(Number.isFinite(n) ? (negativ ? n : Math.max(0, n)) : 0)
        setRoh(null)
      }}
      className={className}
    />
  )
}

/**
 * Zuklappbare Kopfzeile über einem Block: sie trägt das Total je Quartal und
 * blendet auf Klick alles aus, was darin steckt.
 */
function KopfZeile({ label, values, total, gesamt, cols, quartalMonthColors, zu, onToggle }: {
  label: string
  values: number[]
  /** Summe der verteilten Beträge — sie steht in der Spalte „Σ Quartale". */
  total: number
  /**
   * Erfasster Betrag, wie ihn Kostenberechnung oder Mengengerüst führen — er
   * steht in der Spalte „Gesamt". Weicht er von der Summe der Quartale ab, ist
   * nicht alles verteilt; genau dafür stehen die beiden Spalten nebeneinander.
   */
  gesamt?: number
  cols: string
  quartalMonthColors: (string | undefined)[][]
  zu: boolean
  onToggle: () => void
}) {
  return (
    <div className="grid items-stretch border-t border-slate-300" style={{ gridTemplateColumns: cols }}>
      <button
        type="button"
        onClick={onToggle}
        style={{ ...stickyLeft, backgroundColor: '#FAEFE9' }}
        className="flex items-center gap-1 px-3 py-1 text-left font-semibold text-slate-800"
      >
        {zu
          ? <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
          : <ChevronDown className="h-3.5 w-3.5 text-slate-500" />}
        {label}
      </button>
      <div className="px-2 py-1.5 text-right font-semibold tabular-nums text-slate-800"
        style={{ backgroundColor: '#FAEFE9' }}>
        {gesamt == null ? '' : formatNumber(gesamt)}
      </div>
      {values.map((v, i) => (
        <div key={i} className="border-l border-slate-100 px-1 py-1.5 text-right text-[11px] font-semibold tabular-nums text-slate-800"
          style={{ background: segBackground(quartalMonthColors[i], '20') ?? '#FAEFE9' }}>
          {v ? formatNumber(v) : ''}
        </div>
      ))}
      <div style={{ backgroundColor: '#FAEFE9' }} />
      <div className="px-2 py-1.5 text-right font-semibold tabular-nums text-slate-800" style={{ backgroundColor: '#FAEFE9' }}>
        {formatNumber(total)}
      </div>
    </div>
  )
}

/*
 * Abgeleitete Zeile. Sie ist im Satz genau gleich gebaut wie die Eingabezeile
 * darüber oder darunter — dieselbe Schriftgrösse, dasselbe Gewicht, dieselben
 * Farben: im Finanzierungsblock stehen Eingaben und Abgeleitetes gleichwertig
 * nebeneinander, und nichts davon soll wichtiger aussehen als der Rest.
 * Abgesetzt wird nur, was wirklich eine Summe ist: `strong` für den Saldo,
 * `wieZeile` für eine Zwischensumme innerhalb der Positionen.
 */
function FootRow({ label, values, total, cols, quartalMonthColors, strong, wieZeile, gesamt }: {
  label: string
  values: number[]
  total: number
  cols: string
  quartalMonthColors: (string | undefined)[][]
  strong?: boolean
  /** Im Grad der Positionszeilen gesetzt, nur fett — eine Zwischensumme, die
   *  zu den Zeilen darüber gehört und nicht über ihnen stehen soll. */
  wieZeile?: boolean
  gesamt?: number
}) {
  const bg = strong ? '#FAEFE9' : 'rgb(248 250 252 / 0.6)'
  // Derselbe Ton, deckend — die Beschriftung steht still, die Zahlen laufen darunter durch.
  const bgFest = strong ? '#FAEFE9' : '#fbfcfd'
  const hervor = strong || wieZeile
  // Beschriftung und Summe halbfett, die Quartalszahlen mager — wie in ChfInputRow.
  const txtLabel = hervor ? 'font-semibold text-slate-800' : 'font-medium text-slate-700'
  const txtZahl = hervor ? 'font-semibold text-slate-800' : 'text-slate-700'
  return (
    <div className={`grid items-stretch text-xs ${strong ? 'border-t border-slate-300' : 'border-t border-slate-100'}`} style={{ gridTemplateColumns: cols }}>
      <div style={{ ...stickyLeft, backgroundColor: bgFest }} className={`flex items-center px-3 py-1.5 text-left ${txtLabel}`}>{label}</div>
      <div className={`px-2 py-1.5 text-right tabular-nums ${strong ? txtLabel : 'text-slate-500'}`} style={{ backgroundColor: bg }}>{gesamt != null ? formatNumber(gesamt) : ''}</div>
      {values.map((v, i) => (
        <div key={i} className={`border-l border-slate-100 px-1 py-1.5 text-right text-[11px] tabular-nums ${txtZahl}`} style={{ background: segBackground(quartalMonthColors[i], strong ? '20' : '10') ?? bg }}>{v ? formatNumber(v) : ''}</div>
      ))}
      <div style={{ backgroundColor: bg }} />
      <div className={`px-2 py-1.5 text-right tabular-nums ${txtLabel}`} style={{ backgroundColor: bg }}>{formatNumber(total)}</div>
    </div>
  )
}

// Editierbare CHF-Zeile je Quartal (Eigenkapital, Finanzierungstranchen).
function ChfInputRow({ label, scope, posKey, values, total, qKeys, cols, quartalMonthColors, canWrite, onSet, gesamt, gesamtTitel }: {
  label: string
  scope: string
  posKey: string
  values: number[]
  total: number
  qKeys: string[]
  cols: string
  quartalMonthColors: (string | undefined)[][]
  canWrite: boolean
  onSet: (scope: string, posKey: string, qKey: string, val: number) => void
  /** Erfasster Betrag für die Spalte „Gesamt"; ohne ihn steht dort die
   *  verteilte Summe. Geht er mit ihr auseinander, wird er gelb. */
  gesamt?: number
  gesamtTitel?: string
}) {
  const abweichung = gesamt != null
    && Math.abs(gesamt - total) > Math.max(1, Math.abs(gesamt) * 0.001)
  return (
    <div className="grid items-stretch border-t border-slate-100 text-xs" style={{ gridTemplateColumns: cols }}>
      <div style={stickyLeft} className="flex items-center bg-white px-3 py-1.5 font-medium text-slate-700">{label}</div>
      <div title={gesamtTitel}
        className={`bg-white px-2 py-1.5 text-right tabular-nums ${abweichung ? 'text-amber-600' : 'text-slate-500'}`}>
        {formatNumber(gesamt ?? total)}
      </div>
      {values.map((v, i) => (
        <div key={i} className="flex items-center border-l border-slate-100 px-1 py-1" style={{ background: segBackground(quartalMonthColors[i], '14') }}>
          <div className="flex w-full items-center rounded px-0.5" style={{ background: segBackground(quartalMonthColors[i], '40') ?? '#f1f5f9' }}>
            {/* Beträge dürfen ins Minus — eine zurückgezahlte Tranche etwa. */}
            <NumFeld value={v} disabled={!canWrite} placeholder="0" negativ
              onChange={(neu) => onSet(scope, posKey, qKeys[i], neu)}
              className="w-full min-w-0 border-0 bg-transparent py-0.5 text-right text-[11px] tabular-nums text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#B98C74]" />
          </div>
        </div>
      ))}
      <div className="bg-white" />
      <div className="bg-white px-2 py-1.5 text-right tabular-nums font-medium text-slate-700">{formatNumber(total)}</div>
    </div>
  )
}
