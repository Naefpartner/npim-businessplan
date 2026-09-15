import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type ProjectVariant } from '@/types'
import { useAnlagekosten } from '@/hooks/useAnlagekosten'
import { useHonorar, usePlanerLibrary } from '@/hooks/useHonorar'
import { useAppSettings } from '@/hooks/useAppSettings'
import {
  BKP_ZEILEN, HONORAR_KONSTANTEN, MODE_META,
  berechneHonorare, anlagekostenOf, factorOf, pauschalOf, defaultHonorarDoc,
  type HonorarInput, type Disziplin, type PlanerMode, type HonorarDoc,
} from '@/lib/honorar'
import { type BkpHauptgruppe } from '@/lib/bkpKatalog'
import { useUndoableState } from '@/contexts/UndoContext'
import { PlanerBibliothekDialog } from './PlanerBibliothekDialog'
import { Plus, X, GripVertical, Library, Lock } from 'lucide-react'
import { formatNumber, cn } from '@/lib/utils'

const EMPTY: HonorarInput = { anlagekosten: {}, factors: {}, pauschal: {} }

// Honorar-BKP: pro Hauptgruppe (0–9) die Leaf-Zeilenindizes + der Zeilenindex der Gruppenzeile.
const HONORAR_GROUP_LEAVES: Record<number, number[]> = {}
const HONORAR_GROUP_IDX: Record<number, number> = {}
;(() => {
  let cur = -1
  BKP_ZEILEN.forEach((z, i) => {
    if (z.gruppe) { cur = Number(z.code); HONORAR_GROUP_LEAVES[cur] = []; HONORAR_GROUP_IDX[cur] = i }
    else if (cur >= 0) HONORAR_GROUP_LEAVES[cur].push(i)
  })
})()

// Spaltenbreiten (rem) — gemeinsames Raster für alle Abschnitte.
const W_BEZ = 27, W_AK = 6, W_PCT = 4.5, W_EXKL = 6
const W_LEAD = W_BEZ + W_AK + W_PCT + W_EXKL
const W_FAC = 3.5, W_CHF = 6, W_DISC = W_FAC + W_CHF
const W_TOT = 6, W_GP = 6
const rem = (n: number) => `${n}rem`
// Sticky-Links-Offsets der fixierten Führungsspalten (Bezeichnung + Anlagekosten-Block).
const L_BEZ = 0, L_PCT = W_BEZ, L_EXKL = W_BEZ + W_PCT, L_AK = W_BEZ + W_PCT + W_EXKL
// z-Ebenen: fixierte Körperzellen < Kopfzeile < fixierte Kopf-Ecke.
const Z_BODY = 'z-10', Z_HEAD = 'z-20', Z_CORNER = 'z-30'
// Schatten zur optischen Trennung der fixierten Bereiche (border-collapse zeichnet an Sticky-Kanten unsauber).
const SHADOW_RIGHT = 'shadow-[2px_0_4px_-2px_rgba(0,0,0,0.18)]'
const EDIT_FAKTOREN = new Set(['tl', 'z1', 'z2', 'n', 'r', 'u', 'i', 's', 'h'])

export function HonorarrechnerSection({ projectId, variants, initialVariantId }: { projectId: string; variants: ProjectVariant[]; initialVariantId?: string }) {
  // Kommt man aus den Anlagekosten (Methode „aus Honorarrechner"), ist die Variante
  // fest vorgegeben (Deep-Link mit ?variant=…) und der Selektor gesperrt.
  const variantLocked = !!(initialVariantId && variants.some((v) => v.id === initialVariantId))
  const [variantId, setVariantId] = useState(
    () => variantLocked ? initialVariantId! : (variants[0]?.id ?? ''),
  )
  // Ein gemeinsames Dokument für den gesamten bearbeitbaren Zustand → globales Undo/Redo.
  const [doc, setDoc, setDocSilent] = useUndoableState<HonorarDoc>(defaultHonorarDoc, 'Honorarrechner')
  const input = doc.inputs[variantId] ?? EMPTY

  // Persistenz pro Projekt (JSONB). Beim ersten Laden still hydrieren, danach debounced speichern.
  const { loaded, loading: honorarLoading, save } = useHonorar(projectId)
  const { mwstDefault, loading: settingsLoading } = useAppSettings()
  const hydrated = useRef(false)
  const lastSaved = useRef<HonorarDoc | null>(null)
  // docRef/saveRef halten synchron (Layout-Effekt) den aktuellsten Stand — nötig für
  // den Flush beim Unmount. Werden zusätzlich in der Hydration gesetzt, damit sie im
  // StrictMode-Doppelmount nie auf dem Default hängen (sonst überschriebe der Flush).
  const docRef = useRef(doc)
  const saveRef = useRef(save)
  useLayoutEffect(() => { docRef.current = doc; saveRef.current = save })
  useEffect(() => {
    if (honorarLoading || settingsLoading || hydrated.current) return
    // Frisches Dokument: Standard-MWST aus den Einstellungen; sonst geladenes Dokument.
    const init = loaded ?? { ...defaultHonorarDoc(), mwstPct: mwstDefault }
    lastSaved.current = init
    docRef.current = init   // synchron mit der Hydration, VOR hydrated=true
    hydrated.current = true
    setDocSilent(init)
  }, [honorarLoading, settingsLoading, loaded, mwstDefault, setDocSilent])
  useEffect(() => {
    if (!hydrated.current || doc === lastSaved.current) return // kein Speichern durch Hydration
    // Beim Feuern IMMER den aktuellsten Stand (docRef) speichern — nie die evtl.
    // veraltete Closure `doc` (StrictMode-Doppelmount kann sie auf dem Default halten).
    const t = setTimeout(() => { lastSaved.current = docRef.current; void saveRef.current(docRef.current) }, 600)
    return () => clearTimeout(t)
  }, [doc, save])
  // Beim Verlassen der Ansicht (Navigation → Unmount) eine noch ausstehende,
  // debounced Änderung sofort speichern — sonst bricht clearTimeout oben sie ab.
  useEffect(() => () => {
    if (hydrated.current && docRef.current !== lastSaved.current) {
      lastSaved.current = docRef.current
      void saveRef.current(docRef.current)
    }
  }, [])

  // Bibliotheks-Dialog (Planer-Parameter aus anderen Projekten übernehmen).
  const [libFor, setLibFor] = useState<Disziplin | null>(null)
  // Auswahl-Dialog beim Hinzufügen eines neuen Planers.
  const [addOpen, setAddOpen] = useState(false)

  // Anlagekosten der gewählten Variante: BKP 0–9 brutto exkl. Position 010 (Grundstück).
  const ak = useAnlagekosten(projectId, variantId)
  const variantAnlagekosten = useMemo(() => {
    let total = 0, pos010 = 0
    for (const eig of ak.presentEig) {
      const erg = ak.konsolidiertEffektiv.get(eig)
      if (!erg) continue
      total += erg.totalBrutto
      const p = erg.positionen['010']
      pos010 += (p?.betragNetto ?? 0) + (p?.mwstBetrag ?? 0)
    }
    return Math.max(0, total - pos010)
  }, [ak.konsolidiertEffektiv, ak.presentEig])
  // Anlagekosten der Variante je Hauptgruppe (0–9), brutto, Gruppe 0 exkl. Position 010.
  const variantHg = useMemo(() => {
    const hg: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 }
    let pos010 = 0
    for (const eig of ak.presentEig) {
      const erg = ak.konsolidiertEffektiv.get(eig)
      if (!erg) continue
      for (let g = 0; g <= 9; g++)
        hg[g] += (erg.hauptgruppenSummenNetto[g as BkpHauptgruppe] ?? 0) + (erg.hauptgruppenSummenMwst[g as BkpHauptgruppe] ?? 0)
      const p = erg.positionen['010']
      pos010 += (p?.betragNetto ?? 0) + (p?.mwstBetrag ?? 0)
    }
    hg[0] = Math.max(0, hg[0] - pos010)
    return hg
  }, [ak.konsolidiert, ak.presentEig])
  const hasVariantAk = variantAnlagekosten > 0
  // Nutzt die Anlagekostenberechnung dieser Variante bei 690a/690b die Methode
  // „Honorarrechner"? Dann MUSS das Honorar aus der Anlagekostenberechnung stammen
  // (Kostenquelle fest, Direkteingabe gesperrt) — sonst gäbe es einen Zirkelbezug
  // zwischen 690 und dem Honorar.
  const honorarMethodeAktiv = useMemo(
    () => ak.bkpKosten.rows.some(
      (r) => r.etappe_id === null && r.calc_method === 'honorarrechner' && (r.position_code === '690a' || r.position_code === '690b'),
    ),
    [ak.bkpKosten.rows],
  )
  // Kostenquelle/Methode je Variante (aus dem Dokument).
  const akSourceMap = doc.akSourceMap
  const direktModeMap = doc.direktModeMap
  const setAkSource = (v: 'direkt' | 'anlagekosten') =>
    setDoc((d) => ({ ...d, akSourceMap: { ...d.akSourceMap, [variantId]: v } }), { label: 'Kostenquelle' })
  const setDirektMode = (v: 'positionen' | 'summe') =>
    setDoc((d) => ({ ...d, direktModeMap: { ...d.direktModeMap, [variantId]: v } }), { label: 'Methode' })
  const akSource: 'direkt' | 'anlagekosten' = honorarMethodeAktiv
    ? 'anlagekosten'
    : ((akSourceMap[variantId] ?? 'direkt') === 'anlagekosten' && hasVariantAk ? 'anlagekosten' : 'direkt')
  const direktMode = direktModeMap[variantId] ?? 'positionen'
  // Aktives Berechnungsmodell.
  const mode: 'positionen' | 'summe' | 'anlagekosten' = akSource === 'anlagekosten' ? 'anlagekosten' : direktMode
  const gesamtManuell = doc.gesamtManuell

  // Planerliste (editierbar, hinzufügbar/löschbar) — projektweit.
  const planer = doc.planer
  const updP = (id: string, patch: Partial<Disziplin>) =>
    setDoc((d) => ({ ...d, planer: d.planer.map((x) => (x.id === id ? { ...x, ...patch } : x)) }),
      { label: 'Planer bearbeitet', coalesceKey: `honorar:planer:${id}` })
  // Basisgerüst einer neuen (leeren) Planerspalte — Faktoren-Modus, alle Werte 0.
  const newPlanerBase = (): Disziplin => ({
    id: `custom${Date.now()}`, label: 'Neuer Planer', sia: '', tl: 0, z1: 0, z2: 0,
    n: 0, r: 0, u: 0, i: 0, s: 0, h: 0, mode: 'faktoren', custom: true,
    firma: 'Firma', bemerkung: 'Bemerkung',
  })
  const addEmptyPlaner = () =>
    setDoc((d) => ({ ...d, planer: [...d.planer, newPlanerBase()] }), { label: 'Leere Planerspalte' })
  const addPlanerFromParams = (patch: Partial<Disziplin>) =>
    setDoc((d) => ({ ...d, planer: [...d.planer, { ...newPlanerBase(), ...patch }] }),
      { label: `Planer «${patch.label ?? 'neu'}» hinzugefügt` })
  const removeP = (id: string) =>
    setDoc((d) => ({ ...d, planer: d.planer.filter((x) => x.id !== id) }), { label: 'Planer entfernt' })
  // Spaltenreihenfolge per Drag & Drop.
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const moveP = (fromId: string, toId: string) => {
    if (!fromId || fromId === toId) return
    setDoc((d) => {
      const from = d.planer.findIndex((x) => x.id === fromId)
      const to = d.planer.findIndex((x) => x.id === toId)
      if (from < 0 || to < 0) return d
      const next = [...d.planer]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return { ...d, planer: next }
    }, { label: 'Spalte verschoben' })
  }

  const updIn = (fn: (i: HonorarInput) => HonorarInput, opts?: { label?: string; coalesceKey?: string }) =>
    setDoc((d) => ({ ...d, inputs: { ...d.inputs, [variantId]: fn(d.inputs[variantId] ?? EMPTY) } }), opts)
  const setAk = (i: number, v: number) => updIn((inp) => ({ ...inp, anlagekosten: { ...inp.anlagekosten, [i]: v } }), { label: 'Anlagekosten', coalesceKey: `honorar:ak:${variantId}:${i}` })
  const setFac = (i: number, d: string, v: number) => updIn((inp) => ({ ...inp, factors: { ...inp.factors, [i]: { ...inp.factors[i], [d]: v } } }), { label: 'Faktor', coalesceKey: `honorar:fac:${variantId}:${i}:${d}` })
  const setPau = (i: number, s: string, v: number) => updIn((inp) => ({ ...inp, pauschal: { ...inp.pauschal, [i]: { ...inp.pauschal[i], [s]: v } } }), { label: 'Pauschale', coalesceKey: `honorar:pau:${variantId}:${i}:${s}` })

  // ── % der Kosten (pro Variante überschreibbar) ─────────────────────────────
  const povr = doc.prozentOverride[variantId] ?? {}
  const setProzent = (i: number, v: number) =>
    setDoc((d) => ({ ...d, prozentOverride: { ...d.prozentOverride, [variantId]: { ...(d.prozentOverride[variantId] ?? {}), [i]: v } } }),
      { label: 'Prozent-Verteilung', coalesceKey: `honorar:pct:${variantId}:${i}` })

  // Referenz-Beträge für die Default-%: bei 'positionen' die Eingaben, sonst die Vorlagenwerte.
  const pctRefAk = useMemo(
    () => BKP_ZEILEN.map((z, i) => (mode === 'positionen' ? anlagekostenOf(input, i) : (z.anlagekosten ?? 0))),
    [mode, input],
  )
  // Default-%: Gruppe = Anteil am Grand-Total, Unterkapitel = Anteil am BKP-Total.
  const pctInfo = useMemo(() => {
    const parentIdx: Record<number, number> = {}
    const groupSum: Record<number, number> = {}
    let curIdx = -1
    BKP_ZEILEN.forEach((z, i) => {
      if (z.gruppe) { curIdx = i; groupSum[i] = 0 }
      else { parentIdx[i] = curIdx; if (curIdx >= 0) groupSum[curIdx] += pctRefAk[i] }
    })
    const grand = Object.values(groupSum).reduce((a, b) => a + b, 0)
    const def: Record<number, number> = {}
    BKP_ZEILEN.forEach((z, i) => {
      if (z.gruppe) def[i] = grand > 0 ? (groupSum[i] / grand) * 100 : 0
      else { const gs = groupSum[parentIdx[i]] ?? 0; def[i] = gs > 0 ? (pctRefAk[i] / gs) * 100 : 0 }
    })
    return { def, parentIdx }
  }, [pctRefAk])
  // Effektives % je Zeile: 'positionen' zeigt die abgeleiteten Defaults, sonst Override ?? Default.
  const pctOf = (i: number) => (mode === 'positionen' ? (pctInfo.def[i] ?? 0) : (povr[i] ?? pctInfo.def[i] ?? 0))

  // Gesamtsumme (inkl. MWST) je Modell.
  const grandTotalInkl = useMemo(() => {
    if (mode === 'anlagekosten') return variantAnlagekosten
    if (mode === 'summe') return gesamtManuell[variantId] ?? 0
    let s = 0
    BKP_ZEILEN.forEach((z, i) => { if (!z.gruppe) s += anlagekostenOf(input, i) })
    return s
  }, [mode, variantAnlagekosten, gesamtManuell, variantId, input])
  const gesamtInkl = grandTotalInkl
  const gesamtExkl = gesamtInkl / (1 + doc.mwstPct)
  const setGesamtInkl = (v: number) =>
    setDoc((d) => ({ ...d, gesamtManuell: { ...d.gesamtManuell, [variantId]: v } }),
      { label: 'Gesamtsumme', coalesceKey: `honorar:total:${variantId}` })

  // Anzeige-% der Gruppenzeile: bei 'anlagekosten' aus der Variante, sonst wie pctOf.
  const grpPctOf = (groupIdx: number, g: number) =>
    mode === 'anlagekosten' ? (grandTotalInkl > 0 ? ((variantHg[g] ?? 0) / grandTotalInkl) * 100 : 0) : pctOf(groupIdx)

  // Effektive BKP-Beträge (inkl. MWST) je Leaf-Zeile — Grundlage der Honorarberechnung.
  const effAkMap = useMemo(() => {
    const m: Record<number, number> = {}
    if (mode === 'positionen') {
      BKP_ZEILEN.forEach((z, i) => { if (!z.gruppe) m[i] = anlagekostenOf(input, i) })
      return m
    }
    for (const [gStr, idxs] of Object.entries(HONORAR_GROUP_LEAVES)) {
      const g = Number(gStr)
      const groupIdx = HONORAR_GROUP_IDX[g]
      const groupAmount = mode === 'anlagekosten'
        ? (variantHg[g] ?? 0)
        : grandTotalInkl * ((povr[groupIdx] ?? pctInfo.def[groupIdx] ?? 0) / 100)
      idxs.forEach((i) => { m[i] = groupAmount * ((povr[i] ?? pctInfo.def[i] ?? 0) / 100) })
    }
    return m
  }, [mode, input, grandTotalInkl, variantHg, povr, pctInfo])
  const effInput = useMemo(
    () => ({ anlagekosten: effAkMap, factors: input.factors, pauschal: input.pauschal }),
    [effAkMap, input.factors, input.pauschal],
  )
  const res = useMemo(() => berechneHonorare(effInput, planer, { nebenkosten: doc.nebenkostenPct, mwst: doc.mwstPct, gp: doc.gpPct }), [effInput, planer, doc.nebenkostenPct, doc.mwstPct, doc.gpPct])
  const setGpPct = (v: number) => setDoc((d) => ({ ...d, gpPct: v }), { label: 'GP-Zuschlag-%', coalesceKey: 'honorar:gp' })
  // Durchnummerierung der Teilleistungen je Phasengruppe (z. B. 31.1, 31.2 …).
  const phaseNummern = useMemo(() => {
    const c: Record<string, number> = {}
    return res.phasen.map((ph) => { c[ph.gruppe] = (c[ph.gruppe] ?? 0) + 1; return `${ph.gruppe}.${c[ph.gruppe]}` })
  }, [res.phasen])
  // Phasengruppen (z. B. 31 Vorprojekt): Einzelpositionen + Total je Planer/GP/Gesamt aus den Positionen summiert.
  const phasenGruppen = useMemo(() => {
    const groups: { gruppe: string; gruppeLabel: string; idxs: number[]; amounts: Record<string, number>; total: number; gpZuschlag: number }[] = []
    res.phasen.forEach((ph, i) => {
      let g = groups[groups.length - 1]
      if (!g || g.gruppe !== ph.gruppe) { g = { gruppe: ph.gruppe, gruppeLabel: ph.gruppeLabel, idxs: [], amounts: {}, total: 0, gpZuschlag: 0 }; groups.push(g) }
      g.idxs.push(i)
      for (const d of planer) g.amounts[d.id] = (g.amounts[d.id] ?? 0) + (ph.amounts[d.id] ?? 0)
      g.total += ph.total
      g.gpZuschlag += ph.gpZuschlag
    })
    return groups
  }, [res.phasen, planer])

  // Effektive %-Kennwerte für die Anlagekosten-Positionen 690a/690b:
  // Honorar-Gesamttotal exkl. MWST (Honorar + GP + Nebenkosten) je Phasengruppe,
  // geteilt durch die BKP-1–4-netto der Variante → als Anteil verwendbar wie die %-Methode.
  const honorar690Werte = useMemo(() => {
    const BIS41 = new Set(['31', '32', '33', '41'])
    const AB51 = new Set(['51', '52', '53'])
    let bis41 = 0, ab51 = 0
    for (const ph of res.phasen) {
      const sub = (ph.total + ph.gpZuschlag) * (1 + doc.nebenkostenPct)
      if (BIS41.has(ph.gruppe)) bis41 += sub
      else if (AB51.has(ph.gruppe)) ab51 += sub
    }
    let hg14 = 0
    for (const eig of ak.presentEig) {
      const erg = ak.konsolidiertEffektiv.get(eig)
      if (!erg) continue
      hg14 += (erg.hauptgruppenSummenNetto[1] ?? 0) + (erg.hauptgruppenSummenNetto[2] ?? 0)
            + (erg.hauptgruppenSummenNetto[3] ?? 0) + (erg.hauptgruppenSummenNetto[4] ?? 0)
    }
    return { kennwertBis41: hg14 > 0 ? bis41 / hg14 : 0, kennwertAb51: hg14 > 0 ? ab51 / hg14 : 0 }
  }, [res.phasen, doc.nebenkostenPct, ak.presentEig, ak.konsolidiert])

  // Kennwerte je Variante still ins Dokument schreiben (persistiert, kein Undo-Eintrag),
  // damit die Anlagekostenberechnung sie als Methode „Honorarrechner" übernehmen kann.
  useEffect(() => {
    if (!hydrated.current || !variantId || ak.loading) return
    const d = docRef.current // aktuellster Stand, nie veraltete Closure (StrictMode)
    const cur = d.honorar690?.[variantId]
    const next = honorar690Werte
    if (cur && Math.abs(cur.kennwertBis41 - next.kennwertBis41) < 1e-9 && Math.abs(cur.kennwertAb51 - next.kennwertAb51) < 1e-9) return
    setDocSilent({ ...d, honorar690: { ...d.honorar690, [variantId]: next } })
  }, [honorar690Werte, variantId, doc, setDocSilent, ak.loading])

  const setNebenkostenPct = (v: number) => setDoc((d) => ({ ...d, nebenkostenPct: v }), { label: 'Nebenkosten-%', coalesceKey: 'honorar:nk' })
  const setMwstPct = (v: number) => setDoc((d) => ({ ...d, mwstPct: v }), { label: 'MwSt-%', coalesceKey: 'honorar:mwst' })

  // Warnung, wenn editierbare %-Werte nicht 100 % ergeben (nur in 'summe'/'anlagekosten').
  const prozentWarn = useMemo(() => {
    if (mode === 'positionen') return { groupSum: 100, groupOff: false, leafOff: new Set<number>() }
    const eff = (i: number) => povr[i] ?? pctInfo.def[i] ?? 0
    let groupSum = 0
    BKP_ZEILEN.forEach((z, i) => { if (z.gruppe) groupSum += eff(i) })
    const groupOff = mode === 'summe' && groupSum > 0.001 && Math.abs(groupSum - 100) > 0.05
    const leafOff = new Set<number>()
    let curIdx = -1, curSum = 0
    const flush = () => { if (curIdx >= 0 && curSum > 0.001 && Math.abs(curSum - 100) > 0.05) leafOff.add(curIdx) }
    BKP_ZEILEN.forEach((z, i) => { if (z.gruppe) { flush(); curIdx = i; curSum = 0 } else curSum += eff(i) })
    flush()
    return { groupSum: mode === 'summe' ? groupSum : 100, groupOff, leafOff }
  }, [mode, povr, pctInfo])

  const chf = (n: number) => formatNumber(n)
  const N = planer.length
  const WIDTH_ABC = W_LEAD + N * W_DISC
  const WIDTH_D = W_LEAD + N * W_DISC + W_TOT + W_GP

  const fRows: { key: string; label: string; fmt: (v: number) => string }[] = [
    { key: 'B', label: 'B · Aufwandbestimmende Baukosten', fmt: chf },
    { key: 'tl', label: 'TL · Teilleistungen', fmt: (v) => `${(v * 100).toFixed(1)} %` },
    { key: 'z1', label: 'Z1 · SIA 2016', fmt: (v) => v.toFixed(3) },
    { key: 'z2', label: 'Z2 · SIA 2016', fmt: (v) => v.toFixed(2) },
    { key: 'p', label: 'p · Grundfaktor', fmt: (v) => v.toFixed(3) },
    { key: 'n', label: 'n · Schwierigkeitsgrad', fmt: (v) => v.toFixed(2) },
    { key: 'r', label: 'r · Anpassungsfaktor', fmt: (v) => v.toFixed(2) },
    { key: 'u', label: 'U · Umbauzuschlag', fmt: (v) => v.toFixed(2) },
    { key: 'Tm', label: 'Tm · mittlerer Zeitaufwand', fmt: (v) => formatNumber(v) },
    { key: 'i', label: 'i · Teamfaktor', fmt: (v) => v.toFixed(2) },
    { key: 'Tp', label: 'Tp · prognost. Zeitaufwand', fmt: (v) => formatNumber(v) },
    { key: 's', label: 's · Sonderleistungen', fmt: (v) => v.toFixed(2) },
    { key: 'h', label: 'h · Stundensatz CHF/Std.', fmt: (v) => formatNumber(v) },
    { key: 'honorar', label: 'H · Honorar exkl. MWST', fmt: chf },
    { key: 'gp', label: 'GP-Zuschlag %', fmt: (v) => `${(v * 100).toFixed(1)} %` },
  ]
  const fVal = (d: Disziplin, key: string): number => {
    const f = res.faktoren[d.id]
    if (key === 'B') return f.B
    if (key === 'p') return f.p
    if (key === 'Tm') return f.Tm
    if (key === 'Tp') return f.Tp
    if (key === 'honorar') return f.honorar
    return (d as unknown as Record<string, number>)[key]
  }

  const discCols2 = planer.flatMap((d) => [<col key={d.id + 'f'} style={{ width: rem(W_FAC) }} />, <col key={d.id + 'c'} style={{ width: rem(W_CHF) }} />])
  const discCols1 = planer.map((d) => <col key={d.id} style={{ width: rem(W_DISC) }} />)
  const tint = (d: Disziplin) => (d.mode !== 'faktoren' ? MODE_META[d.mode].tint : '')

  // Planer-Bibliothek der anderen Projekte (persistiert) — Quelle für den Übernahme-Dialog.
  const { entries: libEntries, loading: libLoading } = usePlanerLibrary()
  // „Übernehmen"-Dialog: Planer aus anderen Projekten (aktuelles Projekt ausgeblendet).
  const otherLibEntries = useMemo(() => libEntries.filter((e) => e.projectId !== projectId), [libEntries, projectId])

  // Immer sichtbarer horizontaler Scrollbalken unten, mit dem Haupt-Scrollcontainer synchronisiert.
  // (Auf macOS blenden native Overlay-Scrollbalken automatisch aus — dieser Balken bleibt sichtbar.)
  const bodyScrollRef = useRef<HTMLDivElement>(null)
  const barScrollRef = useRef<HTMLDivElement>(null)
  const [scrollDims, setScrollDims] = useState({ scroll: 0, client: 0 })
  const syncingScroll = useRef(false)
  useEffect(() => {
    const el = bodyScrollRef.current
    if (!el) return
    const update = () => setScrollDims({ scroll: el.scrollWidth, client: el.clientWidth })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [planer.length, mode, variantId])
  const onBodyScroll = () => {
    if (syncingScroll.current) { syncingScroll.current = false; return }
    const bar = barScrollRef.current, body = bodyScrollRef.current
    if (bar && body && bar.scrollLeft !== body.scrollLeft) { syncingScroll.current = true; bar.scrollLeft = body.scrollLeft }
  }
  const onBarScroll = () => {
    if (syncingScroll.current) { syncingScroll.current = false; return }
    const bar = barScrollRef.current, body = bodyScrollRef.current
    if (bar && body && body.scrollLeft !== bar.scrollLeft) { syncingScroll.current = true; body.scrollLeft = bar.scrollLeft }
  }
  const showHScroll = scrollDims.scroll > scrollDims.client + 1

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-xl bg-[#B98C74] px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Honorarrechner — Planerhonorare SIA</h2>
        <label className="flex items-center gap-2 text-xs text-slate-800">
          Bausummen der Variante
          <select value={variantId} onChange={(e) => setVariantId(e.target.value)} disabled={variantLocked}
            className={cn('rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-[#8B6956]', variantLocked && 'cursor-not-allowed opacity-70')}>
            {variants.map((v) => <option key={v.id} value={v.id}>V{v.variant_number} · {v.name}</option>)}
          </select>
          {variantLocked && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-slate-700" title="Variante ist aus den Anlagekosten fest vorgegeben">
              <Lock className="h-3 w-3" /> aus Anlagekosten
            </span>
          )}
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-2 text-[11px]">
        <button type="button" onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1 rounded-md border border-[#B98C74] bg-[#B98C74] px-2 py-0.5 text-xs font-medium text-white transition hover:bg-[#a87c65]">
          <Plus className="h-3.5 w-3.5" /> Planer
        </button>
        {akSource === 'direkt' && (
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Methode:</span>
            <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
              <button type="button" onClick={() => setDirektMode('positionen')}
                title="Kosten je BKP-Position eingeben — % und Total werden berechnet"
                className={cn('px-2 py-0.5 text-xs transition', direktMode === 'positionen' ? 'bg-[#B98C74] font-medium text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}>
                Positionen → % &amp; Total
              </button>
              <button type="button" onClick={() => setDirektMode('summe')}
                title="Gesamtsumme eingeben und über die % verteilen"
                className={cn('border-l border-slate-300 px-2 py-0.5 text-xs transition', direktMode === 'summe' ? 'bg-[#B98C74] font-medium text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}>
                Summe → % verteilen
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">Kostenquelle:</span>
          <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
            <button type="button" onClick={() => !honorarMethodeAktiv && setAkSource('direkt')}
              disabled={honorarMethodeAktiv}
              title={honorarMethodeAktiv ? 'Gesperrt: In den Anlagekosten werden die Honorare (690a/690b) via Honorarrechner berechnet — das Honorar muss daher aus der Anlagekostenberechnung stammen (sonst Zirkelbezug).' : 'Kosten direkt im Honorarrechner eingeben'}
              className={cn('px-2 py-0.5 text-xs transition', akSource === 'direkt' ? 'bg-[#B98C74] font-medium text-white' : 'bg-white text-slate-600 hover:bg-slate-50', honorarMethodeAktiv && 'cursor-not-allowed opacity-40 hover:bg-white')}>
              Direkteingabe
            </button>
            <button type="button" onClick={() => hasVariantAk && setAkSource('anlagekosten')}
              disabled={!hasVariantAk} title={hasVariantAk ? 'Beträge aus der Anlagekostenberechnung der Variante übernehmen' : 'Keine Anlagekostenberechnung in dieser Variante vorhanden'}
              className={cn('border-l border-slate-300 px-2 py-0.5 text-xs transition', akSource === 'anlagekosten' ? 'bg-[#B98C74] font-medium text-white' : 'bg-white text-slate-600 hover:bg-slate-50', !hasVariantAk && 'cursor-not-allowed opacity-40 hover:bg-white')}>
              Aus Anlagekostenberechnung
            </button>
          </div>
          {honorarMethodeAktiv && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-amber-700"
              title="In den Anlagekosten nutzen 690a/690b die Methode „Honorarrechner“ — die Direkteingabe ist deshalb gesperrt.">
              <Lock className="h-3 w-3" /> fest, da Honorare in den Anlagekosten via Honorarrechner berechnet werden
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-slate-500">Modus:</span>
          {(['faktoren', 'pauschal', 'aufwand'] as PlanerMode[]).map((m) => (
            <span key={m} className="inline-flex items-center gap-1 text-slate-600">
              <span className={cn('inline-block h-2.5 w-2.5 rounded-full', MODE_META[m].dot)} /> {MODE_META[m].label}
            </span>
          ))}
        </div>
      </div>

      {/* Gemeinsamer Scroll-Container (beide Achsen) — ermöglicht fixierte Kopfzeilen & Führungsspalten */}
      <div ref={bodyScrollRef} onScroll={onBodyScroll} className="max-h-[calc(100vh-10rem)] overflow-auto">
        <div className="space-y-6 py-5">
          {/* ── A ──────────────────────────────────────────────────────── */}
          <Title>A · Aufwandbestimmende Baukosten</Title>
          {(prozentWarn.groupOff || prozentWarn.leafOff.size > 0) && (
            <div className="sticky left-0 max-w-3xl rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[11px] text-red-700">
              <div className="font-semibold">⚠ Prozentwerte ergeben nicht 100 %</div>
              {prozentWarn.groupOff && <div>BKP-Hauptgruppen (0–9) ergeben zusammen {prozentWarn.groupSum.toFixed(1)} % statt 100 %.</div>}
              {prozentWarn.leafOff.size > 0 && <div>Unterkapitel ergeben nicht 100 % in: {[...prozentWarn.leafOff].map((gi) => `BKP ${BKP_ZEILEN[gi].code}`).join(', ')}.</div>}
            </div>
          )}
          <table className="table-fixed border-collapse text-xs" style={{ width: rem(WIDTH_ABC) }}>
            <colgroup>
              <col style={{ width: rem(W_BEZ) }} /><col style={{ width: rem(W_PCT) }} /><col style={{ width: rem(W_EXKL) }} /><col style={{ width: rem(W_AK) }} />
              {discCols2}
            </colgroup>
            <thead className={cn('sticky top-0', Z_HEAD)}>
              <tr>
                <th rowSpan={2} style={{ left: rem(L_BEZ) }} className={cn('sticky border border-slate-200 bg-[#F2D3C2] px-2 py-1.5 text-left align-top font-semibold text-[#5A3F2E]', Z_CORNER)}>BKP · Bezeichnung</th>
                <th colSpan={3} style={{ left: rem(L_PCT) }} className={cn('sticky border border-slate-200 bg-[#F2D3C2] px-2 py-1.5 text-center align-top font-semibold text-[#5A3F2E]', Z_CORNER, SHADOW_RIGHT)}>Anlagekosten</th>
                {planer.map((d) => (
                  <th key={d.id} colSpan={2}
                    onDragOver={(e) => { if (dragId) { e.preventDefault(); if (dragOverId !== d.id) setDragOverId(d.id) } }}
                    onDragLeave={() => setDragOverId((c) => (c === d.id ? null : c))}
                    onDrop={() => { if (dragId) moveP(dragId, d.id); setDragId(null); setDragOverId(null) }}
                    className={cn('border border-slate-200 px-1 py-1 text-center align-top', MODE_META[d.mode].header,
                      dragId === d.id && 'opacity-40', dragOverId === d.id && dragId && dragId !== d.id && 'ring-2 ring-inset ring-[#8B6956]')}>
                    <div className="flex items-start gap-0.5">
                      <span draggable onDragStart={() => setDragId(d.id)} onDragEnd={() => { setDragId(null); setDragOverId(null) }}
                        title="Spalte verschieben (ziehen)" className="mt-0.5 shrink-0 cursor-grab opacity-50 hover:opacity-100 active:cursor-grabbing"><GripVertical className="h-3 w-3" /></span>
                      <LabelInput value={d.label} onChange={(v) => updP(d.id, { label: v })} className="font-semibold" />
                      <button type="button" onClick={() => setLibFor(d)} title="Planer-Parameter & Faktoren aus einem anderen Projekt übernehmen (Bibliothek)" className="mt-0.5 shrink-0 rounded p-0.5 opacity-60 hover:bg-[#F2D3C2]/60 hover:text-[#8B6956] hover:opacity-100"><Library className="h-3 w-3" /></button>
                      <button type="button" onClick={() => removeP(d.id)} title="Planer entfernen" className="mt-0.5 shrink-0 rounded p-0.5 opacity-60 hover:bg-red-50 hover:text-red-500 hover:opacity-100"><X className="h-3 w-3" /></button>
                    </div>
                    <LabelInput value={d.firma ?? ''} onChange={(v) => updP(d.id, { firma: v })} placeholder="Firma" className="mt-0.5 text-[10px] font-normal opacity-80" />
                    <LabelInput value={d.bemerkung ?? ''} onChange={(v) => updP(d.id, { bemerkung: v })} placeholder="Bemerkung" className="mt-0.5 text-[10px] font-normal italic opacity-70" />
                    <select value={d.mode} onChange={(e) => updP(d.id, { mode: e.target.value as PlanerMode })}
                      className="mt-0.5 w-full rounded border border-white/60 bg-white/60 px-0.5 py-0.5 text-[10px] font-medium outline-none">
                      <option value="faktoren">Faktoren</option>
                      <option value="pauschal">Pauschal</option>
                      <option value="aufwand">im Aufwand</option>
                    </select>
                    {d.mode === 'faktoren' && <LabelInput value={d.sia} onChange={(v) => updP(d.id, { sia: v })} className="mt-0.5 text-[10px] font-normal opacity-80" />}
                  </th>
                ))}
              </tr>
              <tr className="bg-slate-50 text-[10px] text-slate-500">
                <th style={{ left: rem(L_PCT) }} className={cn('sticky border border-slate-200 bg-[#F2D3C2] px-1 py-1 text-right align-bottom', Z_CORNER)}>
                  <div className="font-normal text-[#5A3F2E]">% der Kosten</div>
                </th>
                <th style={{ left: rem(L_EXKL) }} className={cn('sticky border border-slate-200 bg-[#F2D3C2] px-1 py-1 text-right align-bottom', Z_CORNER)}>
                  <div className="font-normal text-[#5A3F2E]">exkl. MWST</div>
                  {mode === 'summe'
                    ? <ChfCell value={gesamtExkl} onChange={(v) => setGesamtInkl(v * (1 + doc.mwstPct))} />
                    : <div className="text-xs font-normal tabular-nums text-slate-700">{formatNumber(gesamtExkl)}</div>}
                </th>
                <th style={{ left: rem(L_AK) }} className={cn('sticky border border-slate-200 bg-[#F2D3C2] px-1 py-1 text-right align-bottom', Z_CORNER, SHADOW_RIGHT)} title={mode === 'anlagekosten' ? 'Total Anlagekosten BKP 0–9 exkl. Position 010 (aus Anlagekostenberechnung)' : mode === 'summe' ? 'Gesamtsumme eingeben — wird über die % verteilt' : 'Total aus den Einzelpositionen'}>
                  <div className="font-normal text-[#5A3F2E]">inkl. MWST</div>
                  {mode === 'summe'
                    ? <ChfCell value={gesamtManuell[variantId] ?? 0} onChange={setGesamtInkl} />
                    : <div className="text-xs font-normal tabular-nums text-slate-700">{formatNumber(gesamtInkl)}</div>}
                </th>
                {planer.map((d) => (
                  <Fragment key={d.id}>
                    <th className={cn('border border-slate-200 px-1 py-0.5 text-right font-normal', MODE_META[d.mode].header)}>{d.mode === 'faktoren' ? 'Faktor' : ''}</th>
                    <th className={cn('border border-slate-200 px-1 py-0.5 text-right font-normal', MODE_META[d.mode].header)}>{d.mode === 'faktoren' ? 'CHF' : ''}</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {BKP_ZEILEN.map((z, i) => {
                const row = res.bkpRows[i]
                if (z.gruppe) return (
                  <tr key={i} className="bg-[#F5DDCD]/60 font-semibold text-slate-800">
                    <td style={{ left: rem(L_BEZ) }} className={cn('sticky whitespace-nowrap border border-slate-200 bg-[#F9EBE1] px-2 py-1', Z_BODY)}><span className="mr-1 inline-block w-9 shrink-0 tabular-nums">{z.code}</span>{z.label}</td>
                    <td style={{ left: rem(L_PCT) }} className={cn('sticky border border-slate-200 bg-[#F9EBE1] px-1 py-1 text-right', Z_BODY)}>
                      {mode === 'summe'
                        ? <PctCell value={grpPctOf(i, Number(z.code))} onChange={(v) => setProzent(i, v)} warn={prozentWarn.groupOff} title="Anteil in % an den gesamten Anlagekosten (BKP 0–9)" />
                        : <span className="pr-1 tabular-nums text-slate-600" title="Anteil in % an den gesamten Anlagekosten (BKP 0–9)">{grpPctOf(i, Number(z.code)).toFixed(1)} %</span>}
                    </td>
                    <td style={{ left: rem(L_EXKL) }} className={cn('sticky border border-slate-200 bg-[#F9EBE1] px-2 py-1 text-right tabular-nums', Z_BODY)}>{chf(row.F)}</td>
                    <td style={{ left: rem(L_AK) }} className={cn('sticky border border-slate-200 bg-[#F9EBE1] px-2 py-1 text-right tabular-nums', Z_BODY, SHADOW_RIGHT)}>{chf(row.ak)}</td>
                    {planer.map((d) => (
                      <Fragment key={d.id}>
                        <td className={cn('border border-slate-200', tint(d))} />
                        <td className={cn('border border-slate-200 px-2 py-1 text-right tabular-nums', tint(d))}>{d.mode === 'faktoren' ? chf(row.perDisc[d.id]) : ''}</td>
                      </Fragment>
                    ))}
                  </tr>
                )
                return (
                  <tr key={i}>
                    <td style={{ left: rem(L_BEZ) }} className={cn('sticky whitespace-nowrap border border-slate-200 bg-white px-2 py-1 text-slate-600', Z_BODY)}><span className="mr-1 inline-block w-9 shrink-0 tabular-nums text-slate-400">{z.code}</span>{z.label}</td>
                    <td style={{ left: rem(L_PCT) }} className={cn('sticky border border-slate-200 px-1 py-1 text-right', Z_BODY, mode === 'positionen' ? 'bg-white' : 'bg-slate-100')}>
                      {mode === 'positionen'
                        ? <span className="pr-1 tabular-nums text-slate-600" title={`Anteil in % von BKP ${BKP_ZEILEN[pctInfo.parentIdx[i]]?.code ?? ''}`}>{pctOf(i).toFixed(1)} %</span>
                        : <PctCell value={pctOf(i)} onChange={(v) => setProzent(i, v)} warn={prozentWarn.leafOff.has(pctInfo.parentIdx[i])} title={`Anteil in % von BKP ${BKP_ZEILEN[pctInfo.parentIdx[i]]?.code ?? ''}`} />}
                    </td>
                    <td style={{ left: rem(L_EXKL) }} className={cn('sticky border border-slate-200 bg-white px-2 py-1 text-right tabular-nums text-slate-500', Z_BODY)}>{chf(row.F)}</td>
                    <td style={{ left: rem(L_AK) }} className={cn('sticky border border-slate-200 px-1 py-1 text-right', Z_BODY, SHADOW_RIGHT, mode === 'positionen' ? 'bg-slate-100' : 'bg-white')}>
                      {mode === 'positionen'
                        ? <ChfCell value={anlagekostenOf(input, i)} onChange={(v) => setAk(i, v)} />
                        : <span className="pr-1 tabular-nums text-slate-500" title={mode === 'anlagekosten' ? 'Aus Anlagekostenberechnung, über % verteilt' : 'Aus Gesamtsumme, über % verteilt'}>{chf(effAkMap[i] ?? 0)}</span>}
                    </td>
                    {planer.map((d) => (
                      <Fragment key={d.id}>
                        <td className={cn('border border-slate-200 px-1 py-1 text-right', d.mode === 'faktoren' ? 'bg-slate-100' : tint(d))}>{d.mode === 'faktoren' ? <FacCell value={factorOf(input, i, d.id, d.factorRef)} onChange={(v) => setFac(i, d.id, v)} /> : null}</td>
                        <td className={cn('border border-slate-200 px-2 py-1 text-right tabular-nums text-slate-500', tint(d))}>{d.mode === 'faktoren' && row.perDisc[d.id] ? chf(row.perDisc[d.id]) : ''}</td>
                      </Fragment>
                    ))}
                  </tr>
                )
              })}
              <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold text-slate-900">
                <td style={{ left: rem(L_BEZ) }} className={cn('sticky border border-slate-200 bg-slate-100 px-2 py-1.5', Z_BODY)}>Total aufwandbestimmende Baukosten</td>
                <td style={{ left: rem(L_PCT) }} className={cn('sticky border border-slate-200 bg-slate-100 px-2 py-1.5 text-right tabular-nums', Z_BODY)}>{prozentWarn.groupSum.toFixed(1)} %</td>
                <td style={{ left: rem(L_EXKL) }} className={cn('sticky border border-slate-200 bg-slate-100', Z_BODY)} />
                <td style={{ left: rem(L_AK) }} className={cn('sticky border border-slate-200 bg-slate-100', Z_BODY, SHADOW_RIGHT)} />
                {planer.map((d) => (
                  <Fragment key={d.id}>
                    <td className={cn('border border-slate-200', MODE_META[d.mode].header)} />
                    <td className={cn('border border-slate-200 px-2 py-1.5 text-right tabular-nums', MODE_META[d.mode].header)}>{d.mode === 'faktoren' ? chf(res.faktoren[d.id].B) : ''}</td>
                  </Fragment>
                ))}
              </tr>
            </tbody>
          </table>

          {/* ── B/C ────────────────────────────────────────────────────── */}
          <Title>B / C · Faktoren &amp; Honorar</Title>
          <table className="table-fixed border-collapse text-xs" style={{ width: rem(WIDTH_ABC) }}>
            <colgroup><col style={{ width: rem(W_LEAD) }} />{discCols1}</colgroup>
            <thead className={cn('sticky top-0', Z_HEAD)}>
              <tr>
                <th className={cn('sticky left-0 border border-slate-200 bg-[#F2D3C2] px-2 py-1.5 text-left font-medium text-[#5A3F2E]', Z_CORNER, SHADOW_RIGHT)}>Faktor</th>
                {planer.map((d) => <th key={d.id} className={cn('border border-slate-200 px-2 py-1.5 text-right font-semibold', MODE_META[d.mode].header)}>{d.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {fRows.map((fr) => (
                <tr key={fr.key} className={cn(fr.key === 'honorar' && 'border-t-2 border-slate-300 bg-slate-100 font-semibold text-slate-900')}>
                  <td className={cn('sticky left-0 whitespace-nowrap border border-slate-200 px-2 py-1 text-slate-600', Z_BODY, SHADOW_RIGHT, fr.key === 'honorar' ? 'bg-slate-100' : 'bg-white')}>
                    {fr.key === 'gp'
                      ? <span className="inline-flex items-center gap-1"><span className="mr-1 inline-block w-9 shrink-0" />GP-Zuschlag<PctMini value={doc.gpPct} onChange={setGpPct} /></span>
                      : (() => { const [abbr, ...rest] = fr.label.split(' · '); return <><span className="mr-1 inline-block w-9 shrink-0 tabular-nums text-slate-400">{abbr}</span>{rest.join(' · ')}</> })()}
                  </td>
                  {planer.map((d) => (
                    <td key={d.id} className={cn('border border-slate-200 px-1 py-1 text-right tabular-nums',
                      fr.key === 'honorar' ? MODE_META[d.mode].header
                        : d.mode === 'faktoren' && EDIT_FAKTOREN.has(fr.key) ? 'bg-slate-100'
                          : tint(d))}>
                      {fr.key === 'honorar'
                        ? chf(res.honorarProDisz[d.id])
                        : fr.key === 'gp'
                          ? <div className="flex justify-center"><input type="checkbox" checked={d.imGp !== false} onChange={(e) => updP(d.id, { imGp: e.target.checked })} title="Planer in den GP-Zuschlag einbeziehen" className="h-3.5 w-3.5 accent-[#8B6956]" /></div>
                          : d.mode !== 'faktoren'
                            ? <span className="text-slate-300">—</span>
                            : fr.key === 'tl'
                              ? <PctFaktorInput value={d.tl} onChange={(v) => updP(d.id, { tl: v })} />
                              : EDIT_FAKTOREN.has(fr.key)
                                ? <FaktorInput value={(d as unknown as Record<string, number>)[fr.key]} onChange={(v) => updP(d.id, { [fr.key]: v } as Partial<Disziplin>)} />
                                : fr.fmt(fVal(d, fr.key))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {/* ── D ──────────────────────────────────────────────────────── */}
          <Title>D · Aufteilung nach Phasen (SIA 31–53)</Title>
          <table className="table-fixed border-collapse text-xs" style={{ width: rem(WIDTH_D) }}>
            <colgroup><col style={{ width: rem(W_LEAD) }} />{discCols1}<col style={{ width: rem(W_GP) }} /><col style={{ width: rem(W_TOT) }} /></colgroup>
            <thead className={cn('sticky top-0', Z_HEAD)}>
              <tr>
                <th className={cn('sticky left-0 border border-slate-200 bg-[#F2D3C2] px-2 py-1.5 text-left font-medium text-[#5A3F2E]', Z_CORNER, SHADOW_RIGHT)}>Phase / Teilleistung</th>
                {planer.map((d) => <th key={d.id} className={cn('border border-slate-200 px-2 py-1.5 text-right font-semibold', MODE_META[d.mode].header)}>{d.label}</th>)}
                <th className="border border-slate-300 bg-[#F5DDCD]/60 px-2 py-1.5 text-right font-semibold text-slate-900" title={`GP-Zuschlag ${(HONORAR_KONSTANTEN.gpZuschlag * 100).toFixed(0)} % auf einbezogene Planer`}>GP-Zuschlag</th>
                <th className="border border-slate-300 bg-slate-100 px-2 py-1.5 text-right font-semibold text-slate-900">Total</th>
              </tr>
            </thead>
            <tbody>
              {phasenGruppen.map((g) => (
                <Fragment key={g.gruppe}>
                  {/* Gruppen-Titelzeile: Total aus den Einzelpositionen (31.1 + 31.2 …) */}
                  <tr className="border-t border-slate-300 bg-[#F5DDCD]/50 font-semibold text-slate-800">
                    <td className={cn('sticky left-0 whitespace-nowrap border border-slate-200 bg-[#F9EBE1] px-2 py-1', Z_BODY, SHADOW_RIGHT)}>
                      <span className="mr-1 inline-block w-12 shrink-0 tabular-nums text-slate-500">{g.gruppe}</span>{g.gruppeLabel}
                    </td>
                    {planer.map((d) => (
                      <td key={d.id} className="border border-slate-200 px-1 py-1 text-right tabular-nums">{g.amounts[d.id] ? chf(g.amounts[d.id]) : ''}</td>
                    ))}
                    <td className="border border-slate-300 bg-[#F5DDCD]/40 px-2 py-1 text-right tabular-nums">{g.gpZuschlag ? chf(g.gpZuschlag) : ''}</td>
                    <td className="border border-slate-300 px-2 py-1 text-right tabular-nums">{chf(g.total + g.gpZuschlag)}</td>
                  </tr>
                  {/* Einzelpositionen */}
                  {g.idxs.map((i) => {
                    const ph = res.phasen[i]
                    return (
                      <tr key={i}>
                        <td className={cn('sticky left-0 whitespace-nowrap border border-slate-200 bg-white px-2 py-1 text-slate-600', Z_BODY, SHADOW_RIGHT)}>
                          <span className="mr-1 inline-block w-12 shrink-0 tabular-nums text-slate-400">{phaseNummern[i]}</span>{ph.label}
                        </td>
                        {planer.map((d) => (
                          <td key={d.id} className={cn('border border-slate-200 px-1 py-1 text-right tabular-nums text-slate-700', d.mode === 'faktoren' ? '' : 'bg-slate-100')}>
                            {d.mode === 'faktoren'
                              ? (ph.amounts[d.id] ? chf(ph.amounts[d.id]) : '')
                              : <ChfCell value={pauschalOf(input, i, d.id)} onChange={(v) => setPau(i, d.id, v)} small />}
                          </td>
                        ))}
                        <td className="border border-slate-300 bg-[#F5DDCD]/25 px-2 py-1 text-right tabular-nums text-slate-700">{ph.gpZuschlag ? chf(ph.gpZuschlag) : ''}</td>
                        <td className="border border-slate-300 px-2 py-1 text-right tabular-nums font-medium text-slate-900">{chf(ph.total + ph.gpZuschlag)}</td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
              {/* Zusammenfassung je Planer (Honorar → GP → Nebenkosten → exkl. → MWST → inkl.) */}
              <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold text-slate-900">
                <td className={cn('sticky left-0 border border-slate-200 bg-slate-100 px-2 py-1.5', Z_BODY, SHADOW_RIGHT)}>Total Honorar exkl. MWST</td>
                {planer.map((d) => <td key={d.id} className={cn('border border-slate-200 px-2 py-1.5 text-right tabular-nums', MODE_META[d.mode].header)}>{chf(res.honorarProDisz[d.id])}</td>)}
                <td className="border border-slate-300 bg-[#F5DDCD]/60 px-2 py-1.5 text-right tabular-nums">{chf(res.gpZuschlag)}</td>
                <td className="border border-slate-300 px-2 py-1.5 text-right tabular-nums">{chf(res.subtotal)}</td>
              </tr>
              <tr className="text-slate-700">
                <td className={cn('sticky left-0 border border-slate-200 bg-white px-2 py-1', Z_BODY, SHADOW_RIGHT)}>
                  <span className="inline-flex items-center gap-1">Nebenkosten<PctMini value={doc.nebenkostenPct} onChange={setNebenkostenPct} /></span>
                </td>
                {planer.map((d) => <td key={d.id} className="border border-slate-200 px-2 py-1 text-right tabular-nums">{chf(res.nebenkostenProDisz[d.id])}</td>)}
                <td className="border border-slate-300" />
                <td className="border border-slate-300 px-2 py-1 text-right tabular-nums">{chf(res.nebenkosten)}</td>
              </tr>
              <tr className="bg-slate-50 font-semibold text-slate-900">
                <td className={cn('sticky left-0 border border-slate-200 bg-slate-50 px-2 py-1.5', Z_BODY, SHADOW_RIGHT)}>Gesamttotal exkl. MWST</td>
                {planer.map((d) => <td key={d.id} className={cn('border border-slate-200 px-2 py-1.5 text-right tabular-nums', MODE_META[d.mode].header)}>{chf(res.gesamtExklProDisz[d.id])}</td>)}
                <td className="border border-slate-300" />
                <td className="border border-slate-300 px-2 py-1.5 text-right tabular-nums">{chf(res.gesamtExkl)}</td>
              </tr>
              <tr className="text-slate-700">
                <td className={cn('sticky left-0 border border-slate-200 bg-white px-2 py-1', Z_BODY, SHADOW_RIGHT)}>
                  <span className="inline-flex items-center gap-1">Mehrwertsteuer<PctMini value={doc.mwstPct} onChange={setMwstPct} /></span>
                </td>
                {planer.map((d) => <td key={d.id} className="border border-slate-200 px-2 py-1 text-right tabular-nums">{chf(res.mwstProDisz[d.id])}</td>)}
                <td className="border border-slate-300" />
                <td className="border border-slate-300 px-2 py-1 text-right tabular-nums">{chf(res.mwstBetrag)}</td>
              </tr>
              <tr className="border-t-2 border-slate-300 bg-[#F2D3C2]/40 font-semibold text-slate-900">
                <td className={cn('sticky left-0 border border-slate-200 bg-[#F9E4D6] px-2 py-1.5', Z_BODY, SHADOW_RIGHT)}>Total inkl. MWST</td>
                {planer.map((d) => <td key={d.id} className={cn('border border-slate-200 px-2 py-1.5 text-right tabular-nums', MODE_META[d.mode].header)}>{chf(res.gesamtInklProDisz[d.id])}</td>)}
                <td className="border border-slate-300" />
                <td className="border border-slate-300 px-2 py-1.5 text-right tabular-nums">{chf(res.gesamtInkl)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Dauerhaft sichtbarer horizontaler Scrollbalken, synchron zum Haupt-Container. */}
      {showHScroll && (
        <>
          <style>{`
            .honorar-hscroll { overflow-x: scroll; overflow-y: hidden; }
            .honorar-hscroll::-webkit-scrollbar { height: 14px; }
            .honorar-hscroll::-webkit-scrollbar-track { background: #f1f5f9; }
            .honorar-hscroll::-webkit-scrollbar-thumb { background: #B98C74; border-radius: 7px; border: 3px solid #f1f5f9; }
            .honorar-hscroll::-webkit-scrollbar-thumb:hover { background: #a87c65; }
          `}</style>
          <div ref={barScrollRef} onScroll={onBarScroll} className="honorar-hscroll sticky bottom-0 z-30 border-t border-slate-200 bg-white">
            <div style={{ width: scrollDims.scroll, height: 1 }} />
          </div>
        </>
      )}

      <p className="px-5 pb-4 text-[11px] text-slate-400">
        Kostenquelle: <b>Direkteingabe</b> mit Methode <b>Positionen → % &amp; Total</b> (Beträge je BKP eingeben, % und Total
        werden berechnet) oder <b>Summe → % verteilen</b> (Gesamtsumme eingeben, über die % auf die Positionen verteilen);
        alternativ <b>Aus Anlagekostenberechnung</b> (Hauptgruppen-Totale BKP 0–9 exkl. Position 010 aus der Variante,
        innerhalb der Gruppe über die % verteilt). Je Planer wählbar: <b>Faktoren</b>, <b>Pauschal</b> oder <b>im Aufwand</b>.
        Über das Bibliotheks-Symbol beim Planernamen lassen sich Parameter/Faktoren aus anderen Projekten übernehmen.
      </p>

      {libFor && (
        <PlanerBibliothekDialog
          entries={otherLibEntries}
          loading={libLoading}
          currentLabel={libFor.label}
          onApply={(patch) => updP(libFor.id, patch)}
          onClose={() => setLibFor(null)}
        />
      )}

      {addOpen && (
        <PlanerBibliothekDialog
          entries={libEntries}
          loading={libLoading}
          currentLabel=""
          title="Planer hinzufügen — Funktion wählen (Standardwerte werden übernommen)"
          applyLabel="Hinzufügen"
          onAddEmpty={addEmptyPlaner}
          onApply={addPlanerFromParams}
          onClose={() => setAddOpen(false)}
        />
      )}
    </section>
  )
}

function Title({ children }: { children: React.ReactNode }) {
  return <h3 className="sticky left-0 text-sm font-semibold text-slate-900">{children}</h3>
}
function LabelInput({ value, onChange, className, placeholder, list }: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string; list?: string }) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} title={placeholder ?? 'Bezeichnung anpassen'} list={list}
      className={cn('w-full rounded bg-transparent px-1 text-center text-xs outline-none placeholder:text-slate-400/70 hover:bg-white/70 focus:bg-white focus:ring-1 focus:ring-[#8B6956]', className)} />
  )
}
// Kompaktes %-Eingabefeld (intern 0–1, angezeigt als %) — für Nebenkosten-/MwSt-Satz.
function PctMini({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [raw, setRaw] = useState<string | null>(null)
  const disp = value ? String(+(value * 100).toFixed(1)) : ''
  return (
    <span className="inline-flex items-center gap-0.5">
      <input type="text" inputMode="decimal" value={raw ?? disp}
        onFocus={() => setRaw(disp)} onChange={(e) => setRaw(e.target.value)}
        onBlur={() => { const n = parseFloat((raw ?? '').replace(',', '.')); onChange(Number.isFinite(n) ? n / 100 : value); setRaw(null) }}
        className="w-12 rounded bg-slate-100 px-1 py-0.5 text-right text-[11px] tabular-nums text-slate-900 outline-none focus:bg-slate-200" />
      <span className="text-[10px] text-slate-400">%</span>
    </span>
  )
}
function FaktorInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [raw, setRaw] = useState<string | null>(null)
  return (
    <input type="text" inputMode="decimal" value={raw ?? String(value)}
      onFocus={() => setRaw(String(value))} onChange={(e) => setRaw(e.target.value)}
      onBlur={() => { const n = parseFloat((raw ?? '').replace(',', '.')); onChange(Number.isFinite(n) ? n : value); setRaw(null) }}
      className="w-full rounded bg-slate-100 px-1 py-0.5 text-right text-[11px] tabular-nums text-slate-900 outline-none focus:bg-slate-200" />
  )
}
// Faktor als Prozentzahl (intern 0–1, angezeigt/eingegeben als %). Für Teilleistungen (TL).
function PctFaktorInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [raw, setRaw] = useState<string | null>(null)
  const disp = value ? String(+(value * 100).toFixed(1)) : ''
  return (
    <span className="inline-flex w-full items-center justify-end gap-0.5">
      <input type="text" inputMode="decimal" value={raw ?? disp}
        onFocus={() => setRaw(disp)} onChange={(e) => setRaw(e.target.value)}
        onBlur={() => { const n = parseFloat((raw ?? '').replace(',', '.')); onChange(Number.isFinite(n) ? n / 100 : value); setRaw(null) }}
        className="w-14 rounded bg-slate-100 px-1 py-0.5 text-right text-[11px] tabular-nums text-slate-900 outline-none focus:bg-slate-200" />
      <span className="text-[10px] text-slate-400">%</span>
    </span>
  )
}
function ChfCell({ value, onChange, small }: { value: number; onChange: (v: number) => void; small?: boolean }) {
  const [raw, setRaw] = useState<string | null>(null)
  return (
    <input type="text" inputMode="numeric" value={raw ?? (value ? formatNumber(value, 0) : '')}
      onFocus={() => setRaw(value ? String(Math.round(value)) : '')} onChange={(e) => setRaw(e.target.value)}
      onBlur={() => { const n = parseFloat((raw ?? '').replace(/['’\s]/g, '').replace(',', '.')); onChange(Number.isFinite(n) ? n : 0); setRaw(null) }}
      className={cn('w-full rounded bg-slate-100 px-1 py-0.5 text-right tabular-nums text-slate-900 outline-none focus:bg-slate-200', small ? 'text-[11px]' : 'text-xs')} />
  )
}
function PctCell({ value, onChange, warn, title }: { value: number; onChange: (v: number) => void; warn?: boolean; title?: string }) {
  const [raw, setRaw] = useState<string | null>(null)
  const disp = value ? String(+value.toFixed(1)) : ''
  return (
    <span className="inline-flex w-full items-center justify-end gap-0.5" title={title}>
      <input type="text" inputMode="decimal" value={raw ?? disp}
        onFocus={() => setRaw(disp)} onChange={(e) => setRaw(e.target.value)}
        onBlur={() => { const n = parseFloat((raw ?? '').replace(',', '.')); onChange(Number.isFinite(n) ? n : 0); setRaw(null) }}
        className={cn('w-11 rounded px-0.5 py-0.5 text-right text-[11px] tabular-nums outline-none focus:bg-slate-200', warn ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-900')} />
      <span className="text-[10px] text-slate-400">%</span>
    </span>
  )
}
function FacCell({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [raw, setRaw] = useState<string | null>(null)
  const disp = value ? String(+(value * 100).toFixed(0)) : ''
  return (
    <span className="inline-flex w-full items-center justify-end gap-0.5">
      <input type="text" inputMode="decimal" value={raw ?? disp}
        onFocus={() => setRaw(disp)} onChange={(e) => setRaw(e.target.value)}
        onBlur={() => { const n = parseFloat((raw ?? '').replace(',', '.')); onChange(Number.isFinite(n) ? n / 100 : 0); setRaw(null) }}
        className="w-8 rounded bg-slate-100 px-0.5 py-0.5 text-right text-[11px] tabular-nums text-slate-900 outline-none focus:bg-slate-200" />
      <span className="text-[10px] text-slate-400">%</span>
    </span>
  )
}
