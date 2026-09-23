// =============================================================================
// Planerhonorare nach SIA — vollständiger Rechenkern (identisch zur Excel-Vorlage
// «Planerhonorare Vorlage.xlsx», Blatt Bausumme-Faktoren-Honorar-Phase).
// Daten (Disziplinen, BKP-Faktoren, Phasen) in ./honorarDaten.ts.
// =============================================================================

import {
  DISZIPLINEN, PAUSCHAL_DISZIPLINEN, BKP_ZEILEN, PHASEN, HONORAR_KONSTANTEN,
  type HonorarDisziplin,
} from './honorarDaten'

export { DISZIPLINEN, PAUSCHAL_DISZIPLINEN, BKP_ZEILEN, PHASEN, HONORAR_KONSTANTEN }
export type { HonorarDisziplin }

// Berechnungsart je Planer.
export type PlanerMode = 'faktoren' | 'pauschal' | 'aufwand'
// Disziplin/Planer (evtl. benutzerdefiniert). phaseRef = Planer, dessen Phasen-% übernommen werden.
// phaseRef = Planer, dessen Phasen-% übernommen werden; factorRef = Planer, dessen BKP-Faktoren übernommen werden.
export type Disziplin = HonorarDisziplin & { phaseRef?: string; factorRef?: string; custom?: boolean; mode: PlanerMode; firma?: string; bemerkung?: string; imGp?: boolean }

// Modus-Farben (Tailwind-Tokens) für die Darstellung.
export const MODE_META: Record<PlanerMode, { label: string; header: string; tint: string; dot: string }> = {
  faktoren: { label: 'Faktoren', header: 'bg-[#F2D3C2] text-[#5A3F2E]', tint: 'bg-[#F5DDCD]/30', dot: 'bg-[#B98C74]' },
  pauschal: { label: 'Pauschal', header: 'bg-emerald-100 text-emerald-900', tint: 'bg-emerald-50/40', dot: 'bg-emerald-500' },
  aufwand:  { label: 'im Aufwand', header: 'bg-amber-100 text-amber-900', tint: 'bg-amber-50/40', dot: 'bg-yellow-400' },
}

const PAUSCHAL_MODE: Record<string, PlanerMode> = {
  bauphysik: 'pauschal', brandschutz: 'pauschal', werkleitungen: 'pauschal',
  nachhaltigkeit: 'aufwand', retension: 'aufwand', baumexperte: 'aufwand',
  fassade: 'aufwand', signaletik: 'aufwand', xx: 'aufwand',
}

// Standard-Planerliste: 10 SIA-Disziplinen (Faktoren) + Spezialisten (Pauschal/Aufwand).
export const DEFAULT_PLANER: Disziplin[] = [
  ...DISZIPLINEN.map((d): Disziplin => ({ ...d, mode: 'faktoren', firma: 'Firma', bemerkung: 'Bemerkung' })),
  ...PAUSCHAL_DISZIPLINEN.map((s): Disziplin => ({
    id: s.id, label: s.label, sia: '', tl: 0, z1: 0, z2: 0, n: 0, r: 0, u: 0, i: 0, s: 0, h: 0,
    mode: PAUSCHAL_MODE[s.id] ?? 'pauschal', firma: 'Firma', bemerkung: 'Bemerkung',
  })),
]

// Überschreibungen (pro Variante); Defaults kommen aus BKP_ZEILEN/PHASEN.
export interface HonorarInput {
  anlagekosten: Record<number, number>            // BKP-Zeilenindex → CHF inkl. MWST
  factors: Record<number, Record<string, number>> // BKP-Zeilenindex → Disziplin → Faktor
  pauschal: Record<number, Record<string, number>> // Phasenindex → Spezialist → CHF
}

// Gesamter bearbeitbarer Zustand des Honorarrechners (JSONB-persistiert pro Projekt).
export interface HonorarDoc {
  inputs: Record<string, HonorarInput>              // je Variante
  planer: Disziplin[]                               // projektweit
  prozentOverride: Record<string, Record<number, number>>
  gesamtManuell: Record<string, number>
  akSourceMap: Record<string, 'direkt' | 'anlagekosten'>
  direktModeMap: Record<string, 'positionen' | 'summe'>
  gpPct: number
  nebenkostenPct: number
  mwstPct: number
  // Effektive %-Kennwerte je Variante für die Anlagekosten-Positionen 690a/690b
  // (Honorar-Gesamttotal exkl. MWST je Phasengruppe ÷ BKP-1–4-netto der Variante).
  honorar690?: Record<string, Honorar690>
}

/**
 * Die Felder des Honorardokuments, die nach Variante geschlüsselt sind.
 *
 * Der Honorarrechner hängt am Projekt, seine Eingaben aber an der Variante —
 * wird ein Stand kopiert, muss jeder dieser Schlüssel mitkopiert werden
 * (`copyVariantContents`). Kommt ein neues Feld je Variante dazu, gehört es
 * hier hinein, sonst fehlt es in der Kopie.
 */
export const HONORAR_JE_VARIANTE = [
  'inputs', 'prozentOverride', 'gesamtManuell', 'akSourceMap', 'direktModeMap', 'honorar690',
] as const satisfies readonly (keyof HonorarDoc)[]

// Kennwerte für 690a (SIA-Phasen 31–41) und 690b (ab Phase 51), als Anteil an BKP 1–4.
export interface Honorar690 { kennwertBis41: number; kennwertAb51: number }

export function defaultHonorarDoc(): HonorarDoc {
  return {
    inputs: {}, planer: DEFAULT_PLANER.map((d) => ({ ...d })),
    prozentOverride: {}, gesamtManuell: {}, akSourceMap: {}, direktModeMap: {},
    gpPct: HONORAR_KONSTANTEN.gpZuschlag, nebenkostenPct: HONORAR_KONSTANTEN.nebenkosten, mwstPct: HONORAR_KONSTANTEN.mwst,
    honorar690: {},
  }
}

// Fehlende Felder eines geladenen Dokuments mit Defaults auffüllen (Vorwärtskompatibilität).
export function normalizeHonorarDoc(raw: Partial<HonorarDoc> | null | undefined): HonorarDoc {
  const def = defaultHonorarDoc()
  if (!raw || typeof raw !== 'object') return def
  return {
    inputs: raw.inputs ?? def.inputs,
    planer: Array.isArray(raw.planer) && raw.planer.length ? raw.planer : def.planer,
    prozentOverride: raw.prozentOverride ?? def.prozentOverride,
    gesamtManuell: raw.gesamtManuell ?? def.gesamtManuell,
    akSourceMap: raw.akSourceMap ?? def.akSourceMap,
    direktModeMap: raw.direktModeMap ?? def.direktModeMap,
    gpPct: raw.gpPct ?? def.gpPct,
    nebenkostenPct: raw.nebenkostenPct ?? def.nebenkostenPct,
    mwstPct: raw.mwstPct ?? def.mwstPct,
    honorar690: raw.honorar690 ?? def.honorar690,
  }
}

export interface BkpRowResult {
  code: string; label: string; gruppe?: boolean
  ak: number; F: number; perDisc: Record<string, number>
}
export interface DiszFaktoren { B: number; p: number; Tm: number; Tp: number; honorar: number }
export interface PhaseResult {
  gruppe: string; gruppeLabel: string; label: string
  amounts: Record<string, number>; total: number; gpZuschlag: number
}
export interface HonorarResult {
  bkpRows: BkpRowResult[]
  faktoren: Record<string, DiszFaktoren>
  phasen: PhaseResult[]
  honorarProDisz: Record<string, number>
  gpProDisz: Record<string, number>           // GP-Zuschlag je Planer (Honorar × GP-%)
  nebenkostenProDisz: Record<string, number>  // Nebenkosten je Planer
  gesamtExklProDisz: Record<string, number>   // Gesamttotal exkl. MWST je Planer
  mwstProDisz: Record<string, number>         // MWST je Planer
  gesamtInklProDisz: Record<string, number>   // Total inkl. MWST je Planer
  honorarSum: number
  gpZuschlag: number
  subtotal: number
  nebenkosten: number
  gesamtExkl: number
  mwstBetrag: number
  gesamtInkl: number
  nebenkostenPct: number
  mwstPct: number
}

export function anlagekostenOf(input: HonorarInput, i: number): number {
  return input.anlagekosten[i] ?? BKP_ZEILEN[i].anlagekosten ?? 0
}
// Eigene Eingabe (discId) hat Vorrang; sonst Default aus der BKP-Vorlage — für neu
// hinzugefügte Planer über factorRef (Quell-Funktion), sonst über die eigene discId.
export function factorOf(input: HonorarInput, i: number, discId: string, ref?: string): number {
  return input.factors[i]?.[discId] ?? BKP_ZEILEN[i].factors?.[ref ?? discId] ?? 0
}
export function pauschalOf(input: HonorarInput, i: number, spezId: string): number {
  return input.pauschal[i]?.[spezId] ?? PHASEN[i].pauschal[spezId] ?? 0
}

export function berechneHonorare(
  input: HonorarInput,
  planer: Disziplin[] = DEFAULT_PLANER,
  opts: { nebenkosten?: number; mwst?: number; gp?: number } = {},
): HonorarResult {
  const mwst = opts.mwst ?? HONORAR_KONSTANTEN.mwst
  const nk = opts.nebenkosten ?? HONORAR_KONSTANTEN.nebenkosten
  // Globaler GP-Zuschlag-Satz; je Planer nur wirksam wenn einbezogen (imGp !== false).
  const gpRate = opts.gp ?? HONORAR_KONSTANTEN.gpZuschlag
  const gpOf = (d: Disziplin) => (d.imGp === false ? 0 : gpRate)
  const faktorenPlaner = planer.filter((d) => d.mode === 'faktoren')

  // ── A: aufwandbestimmende Baukosten (nur Faktoren-Planer) ─────────────────
  const bAufwand: Record<string, number> = {}
  for (const d of faktorenPlaner) bAufwand[d.id] = 0
  const leaf: ({ ak: number; F: number; perDisc: Record<string, number> } | null)[] = []
  BKP_ZEILEN.forEach((z, i) => {
    if (z.gruppe) { leaf.push(null); return }
    const ak = anlagekostenOf(input, i)
    const F = ak / (1 + mwst)
    const perDisc: Record<string, number> = {}
    for (const d of faktorenPlaner) { const chf = F * factorOf(input, i, d.id, d.factorRef); perDisc[d.id] = chf; bAufwand[d.id] += chf }
    leaf.push({ ak, F, perDisc })
  })
  const bkpRows: BkpRowResult[] = BKP_ZEILEN.map((z, i) => {
    if (!z.gruppe) { const r = leaf[i]!; return { code: z.code, label: z.label, ak: r.ak, F: r.F, perDisc: r.perDisc } }
    let ak = 0, F = 0; const perDisc: Record<string, number> = {}
    for (const d of faktorenPlaner) perDisc[d.id] = 0
    for (let j = i + 1; j < BKP_ZEILEN.length && !BKP_ZEILEN[j].gruppe; j++) {
      const r = leaf[j]; if (!r) continue
      ak += r.ak; F += r.F; for (const d of faktorenPlaner) perDisc[d.id] += r.perDisc[d.id]
    }
    return { code: z.code, label: z.label, gruppe: true, ak, F, perDisc }
  })

  // ── B/C: Faktoren & Honorar (nur Faktoren-Planer) ─────────────────────────
  const faktoren: Record<string, DiszFaktoren> = {}
  for (const d of faktorenPlaner) {
    const B = bAufwand[d.id]
    const p = B > 0 ? d.z1 + d.z2 / Math.cbrt(B) : 0
    const Tm = B > 0 ? B * (p / 100) * d.n * d.tl * d.r * d.u : 0
    const Tp = Tm * d.i
    faktoren[d.id] = { B, p, Tm, Tp, honorar: Tp * d.s * d.h }
  }
  const sia102 = (faktoren['architekt']?.honorar ?? 0) + (faktoren['baumanagement']?.honorar ?? 0)

  // ── D: Phasen — Faktoren berechnet, Pauschal/Aufwand als Eingabe je Phase ──
  const phasen: PhaseResult[] = PHASEN.map((ph, i) => {
    const amounts: Record<string, number> = {}
    for (const d of planer) {
      if (d.mode === 'faktoren') {
        const pct = ph.prozent[d.phaseRef ?? d.id] ?? 0
        amounts[d.id] = (d.id === 'architekt' || d.id === 'baumanagement') ? sia102 * pct : (faktoren[d.id]?.honorar ?? 0) * pct
      } else {
        amounts[d.id] = pauschalOf(input, i, d.id)
      }
    }
    const total = planer.reduce((s, d) => s + amounts[d.id], 0)
    // GP-Zuschlag der Phase = Σ (Phasen-Honorar × GP-% des Planers), nur einbezogene Planer.
    const gpZuschlag = planer.reduce((s, d) => s + amounts[d.id] * gpOf(d), 0)
    return { gruppe: ph.gruppe, gruppeLabel: ph.gruppeLabel, label: ph.label, amounts, total, gpZuschlag }
  })

  const honorarProDisz: Record<string, number> = {}
  for (const d of planer) honorarProDisz[d.id] = d.mode === 'faktoren' ? (faktoren[d.id]?.honorar ?? 0) : phasen.reduce((s, ph) => s + ph.amounts[d.id], 0)

  // Per-Planer-Kette: Honorar → GP-Zuschlag → Nebenkosten → exkl. → MWST → inkl.
  const gpProDisz: Record<string, number> = {}
  const nebenkostenProDisz: Record<string, number> = {}
  const gesamtExklProDisz: Record<string, number> = {}
  const mwstProDisz: Record<string, number> = {}
  const gesamtInklProDisz: Record<string, number> = {}
  for (const d of planer) {
    const h = honorarProDisz[d.id]
    const gp = h * gpOf(d)
    const sub = h + gp
    const neben = sub * nk
    const exkl = sub + neben
    const mwstB = exkl * mwst
    gpProDisz[d.id] = gp
    nebenkostenProDisz[d.id] = neben
    gesamtExklProDisz[d.id] = exkl
    mwstProDisz[d.id] = mwstB
    gesamtInklProDisz[d.id] = exkl + mwstB
  }

  const honorarSum = planer.reduce((s, d) => s + honorarProDisz[d.id], 0)
  const gpZuschlag = planer.reduce((s, d) => s + gpProDisz[d.id], 0)
  const subtotal = honorarSum + gpZuschlag
  const nebenkosten = planer.reduce((s, d) => s + nebenkostenProDisz[d.id], 0)
  const gesamtExkl = subtotal + nebenkosten
  const mwstBetrag = gesamtExkl * mwst
  const gesamtInkl = gesamtExkl + mwstBetrag

  return {
    bkpRows, faktoren, phasen,
    honorarProDisz, gpProDisz, nebenkostenProDisz, gesamtExklProDisz, mwstProDisz, gesamtInklProDisz,
    honorarSum, gpZuschlag, subtotal, nebenkosten, gesamtExkl, mwstBetrag, gesamtInkl,
    nebenkostenPct: nk, mwstPct: mwst,
  }
}
