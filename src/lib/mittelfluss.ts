// =============================================================================
// Mittelflussrechnung (Liquiditätsplanung) — Typen und reine Berechnungslogik.
//
// Der gesamte bearbeitbare Zustand liegt als ein JSONB-Doc pro Variante in
// `variant_mittelfluss.doc` (siehe Migration 057). Die Kostenbeträge kommen
// live aus den Anlagekosten; hier liegt nur die zeitliche Verteilung (% je
// Quartal), der Terminplan und das Zeitfenster.
// =============================================================================

import { CHART_PALETTE } from '@/lib/ci'

// ── Terminplan-Phase (SIA), frei ergänz-/löschbar ───────────────────────────
export interface MfPhase {
  id: string
  label: string
  startMonat: string   // 'YYYY-MM'
  dauerMonate: number
  farbe: string
  // Wenn true: Start = direkt nach dem Ende der vorherigen Phase (verkettet).
  anVorgaenger?: boolean
}

/**
 * Löst verkettete Phasen auf: Phasen mit `anVorgaenger` starten unmittelbar nach
 * dem Ende der vorherigen (bereits aufgelösten) Phase. Chaining wird unterstützt.
 */
export function resolvePhasen(phasen: MfPhase[]): MfPhase[] {
  const out: MfPhase[] = []
  for (let i = 0; i < phasen.length; i++) {
    const p = phasen[i]
    if (p.anVorgaenger && i > 0) {
      const prev = out[i - 1]
      out.push({ ...p, startMonat: monatAdd(prev.startMonat, prev.dauerMonate) })
    } else {
      out.push({ ...p })
    }
  }
  return out
}

// ── Persistiertes Doc ───────────────────────────────────────────────────────
export interface MittelflussDoc {
  startMonat: string   // 'YYYY-MM' — Beginn des Zeitfensters
  endMonat: string     // 'YYYY-MM' — Ende des Zeitfensters (inkl.)
  phasen: MfPhase[]
  // verteilung[scopeKey][positionKey][quartalKey] = Prozent (0..100)
  // Sonderschlüssel 'fremd': Anteil Fremdkapital am kumulierten Saldo je Quartal.
  verteilung: Record<string, Record<string, Record<string, number>>>
  // Jahreszinssatz (%) auf die Fremdfinanzierung; Zins fällt jeweils im Folgejahr an.
  fremdZinssatz: number
}

// Standard-Projektphasen gemäss SIA (Reihenfolge + sinnvolle Default-Dauer in Monaten).
export const MF_STANDARD_PHASEN: { label: string; dauer: number }[] = [
  { label: 'Machbarkeit',              dauer: 3 },
  { label: 'Vorstudie',                dauer: 4 },
  { label: 'Auswahlverfahren',         dauer: 5 },
  { label: 'Überarbeitung Wettbewerb', dauer: 3 },
  { label: 'Gestaltungsplan',          dauer: 9 },
  { label: 'Vorprojekt',               dauer: 4 },
  { label: 'Bauprojekt Teil 1',        dauer: 5 },
  { label: 'Bewilligungsphase',        dauer: 6 },
  { label: 'Bauprojekt Teil 2',        dauer: 3 },
  { label: 'Ausschreibung',            dauer: 3 },
  { label: 'Ausführungsprojekt',       dauer: 4 },
  { label: 'Ausführung',               dauer: 18 },
  { label: 'Inbetriebnahme',           dauer: 2 },
]

// ── Monats-/Quartalslogik ───────────────────────────────────────────────────
export function parseMonat(s: string): { jahr: number; monat: number } {
  const [j, m] = (s || '2027-01').split('-').map(Number)
  return { jahr: j || 2027, monat: Math.min(12, Math.max(1, m || 1)) }
}
export function formatMonat(jahr: number, monat: number): string {
  return `${jahr}-${String(monat).padStart(2, '0')}`
}
/** n Monate zu 'YYYY-MM' addieren (n kann negativ sein). */
export function monatAdd(s: string, n: number): string {
  const { jahr, monat } = parseMonat(s)
  const total = jahr * 12 + (monat - 1) + n
  return formatMonat(Math.floor(total / 12), (total % 12) + 1)
}
/** Anzahl Monate von a bis b (b − a); a,b als 'YYYY-MM'. */
export function monatDiff(a: string, b: string): number {
  const pa = parseMonat(a), pb = parseMonat(b)
  return (pb.jahr * 12 + pb.monat) - (pa.jahr * 12 + pa.monat)
}

const MONAT_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

export interface MfMonat { key: string; jahr: number; monat: number; label: string }
/** Liste aller Monate im Fenster (inkl. Start und Ende). */
export function monateZwischen(startMonat: string, endMonat: string): MfMonat[] {
  const out: MfMonat[] = []
  const n = monatDiff(startMonat, endMonat)
  if (n < 0 || n > 600) return out
  for (let i = 0; i <= n; i++) {
    const key = monatAdd(startMonat, i)
    const { jahr, monat } = parseMonat(key)
    out.push({ key, jahr, monat, label: MONAT_KURZ[monat - 1] })
  }
  return out
}

export interface MfQuartal { key: string; jahr: number; q: 1 | 2 | 3 | 4; label: string; monate: number }
export function quartalVonMonat(monat: number): 1 | 2 | 3 | 4 {
  return (Math.floor((monat - 1) / 3) + 1) as 1 | 2 | 3 | 4
}
/** Alle Kalenderquartale, die das Fenster [start,end] berühren. */
export function quartaleZwischen(startMonat: string, endMonat: string): MfQuartal[] {
  const monate = monateZwischen(startMonat, endMonat)
  const map = new Map<string, MfQuartal>()
  for (const m of monate) {
    const q = quartalVonMonat(m.monat)
    const key = `${m.jahr}-Q${q}`
    const ex = map.get(key)
    if (ex) ex.monate++
    else map.set(key, { key, jahr: m.jahr, q, label: `Q${q} ${m.jahr}`, monate: 1 })
  }
  return [...map.values()]
}

// ── Scope (Ansicht) ─────────────────────────────────────────────────────────
// etappeSel: 'kons' oder Etappen-ID; eigSel: 'gesamt' oder eine Eigentumsart.
export function scopeKey(etappeSel: string, eigSel: string): string {
  return `${etappeSel}|${eigSel}`
}

// ── Honorar-Phasen-Gewichte (für die Zeilen-Aufteilung der Planerhonorare) ──
const BIS41 = new Set(['31', '32', '33', '41'])
const AB51 = new Set(['51', '52', '53'])
export interface HonorarPhaseGewicht { gruppe: string; label: string; group: 'bis41' | 'ab51'; weight: number }
/**
 * Aus den Honorarrechner-Phasen (PhaseResult[]) das Gewicht je SIA-Phasengruppe
 * (31…53) bilden: Σ (Honorar + GP-Zuschlag) je Gruppe. Die Nebenkosten/MWST
 * kürzen sich in den Anteilen heraus — die Beträge werden später auf die
 * 690a/690b-Nettobeträge der jeweiligen Ansicht skaliert.
 */
export function honorarPhasenGewichte(
  phasen: { gruppe: string; gruppeLabel: string; total: number; gpZuschlag: number }[],
): HonorarPhaseGewicht[] {
  const map = new Map<string, HonorarPhaseGewicht>()
  const order: string[] = []
  for (const ph of phasen) {
    const group = BIS41.has(ph.gruppe) ? 'bis41' : AB51.has(ph.gruppe) ? 'ab51' : null
    if (!group) continue
    if (!map.has(ph.gruppe)) { map.set(ph.gruppe, { gruppe: ph.gruppe, label: ph.gruppeLabel, group, weight: 0 }); order.push(ph.gruppe) }
    map.get(ph.gruppe)!.weight += ph.total + ph.gpZuschlag
  }
  return order.map((g) => map.get(g)!)
}

// ── Default-Doc ─────────────────────────────────────────────────────────────
export function defaultMittelflussDoc(startJahr?: number): MittelflussDoc {
  const jahr = startJahr ?? new Date().getFullYear()
  const startMonat = `${jahr}-01`
  // Phasen sequentiell aneinanderhängen (Treppe) — vom Nutzer frei anpassbar.
  let cursor = startMonat
  const phasen: MfPhase[] = MF_STANDARD_PHASEN.map((p, i) => {
    const phase: MfPhase = {
      id: `p${i + 1}`,
      label: p.label,
      startMonat: cursor,
      dauerMonate: p.dauer,
      farbe: CHART_PALETTE[i % CHART_PALETTE.length],
    }
    cursor = monatAdd(cursor, p.dauer)
    return phase
  })
  return {
    startMonat,
    endMonat: cursor === startMonat ? monatAdd(startMonat, 71) : monatAdd(cursor, -1),
    phasen,
    verteilung: {},
    fremdZinssatz: 0,
  }
}

export function normalizeMittelflussDoc(raw: Partial<MittelflussDoc> | null | undefined): MittelflussDoc {
  const def = defaultMittelflussDoc()
  if (!raw || typeof raw !== 'object') return def
  return {
    startMonat: raw.startMonat || def.startMonat,
    endMonat: raw.endMonat || def.endMonat,
    phasen: Array.isArray(raw.phasen) ? raw.phasen : def.phasen,
    verteilung: raw.verteilung && typeof raw.verteilung === 'object' ? raw.verteilung : {},
    fremdZinssatz: typeof raw.fremdZinssatz === 'number' ? raw.fremdZinssatz : 0,
  }
}
