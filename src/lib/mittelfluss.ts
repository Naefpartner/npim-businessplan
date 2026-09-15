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

/**
 * Ende des Zeitfensters: zwei Quartale nach dem letzten Eintrag im Terminplan,
 * aufgerundet auf das Quartalsende. Die Luft danach braucht es für Verkauf,
 * Abrechnung und Rückflüsse — ohne sie bräche die Zahlungsreihe genau dort ab,
 * wo das Geld zurückkommt.
 *
 * `null`, solange kein Termineintrag steht; dann bleibt es beim gespeicherten
 * Ende.
 */
export function projektEnde(phasen: MfPhase[]): string | null {
  const aufgeloest = resolvePhasen(phasen)
  if (aufgeloest.length === 0) return null
  let letzter = ''
  for (const p of aufgeloest) {
    const ende = monatAdd(p.startMonat, Math.max(1, p.dauerMonate) - 1)
    if (!letzter || monatDiff(letzter, ende) > 0) letzter = ende
  }
  const { jahr, monat } = parseMonat(monatAdd(letzter, 6))
  return formatMonat(jahr, quartalVonMonat(monat) * 3)
}

// ── Verkaufserlöse: zeitliche Verteilung ────────────────────────────────────
/**
 * Wie die Verkaufserlöse über die Quartale fallen. Zwei Modelle decken den
 * Regelfall ab; wer es genauer weiss, verteilt selbst — entweder den
 * Gesamterlös (`frei`) oder jedes Verkaufsobjekt für sich (`objekte`), was
 * einem Verkaufsplan gleichkommt.
 */
export type VerkaufModell = 'uebergabe' | 'baufortschritt' | 'frei' | 'objekte'

export interface MfVerkauf {
  modell: VerkaufModell
  /** Erstes Quartal mit Verkäufen ('YYYY-MM' des Quartalsbeginns); leer = Beginn der Bauphase. */
  startMonat: string
  /** Über wie viele Quartale verkauft wird (Absatzdauer). */
  dauerQuartale: number
  /** Anzahlung bei Vertragsabschluss, in % des Kaufpreises (Modell Baufortschritt). */
  anzahlungPct: number
}

export const MF_VERKAUF_DEFAULT: MfVerkauf = {
  modell: 'uebergabe',
  startMonat: '',
  dauerQuartale: 4,
  anzahlungPct: 20,
}

// ── Persistiertes Doc ───────────────────────────────────────────────────────
/**
 * Auf welcher Ebene die Kosten über die Quartale verteilt werden: Position für
 * Position oder gebündelt je BKP-Hauptgruppe. Die Hauptgruppen genügen für
 * einen Terminplan meist und halten die Tabelle kurz; die Positionen braucht,
 * wer einzelne Zahlungen datiert. Beide Verteilungen bleiben gespeichert —
 * umschalten wirft nichts weg.
 */
export type VerteilEbene = 'position' | 'hauptgruppe'

export interface MittelflussDoc {
  startMonat: string   // 'YYYY-MM' — Beginn des Zeitfensters
  endMonat: string     // 'YYYY-MM' — Ende des Zeitfensters (inkl.)
  phasen: MfPhase[]
  // verteilung[scopeKey][positionKey][quartalKey] = Prozent (0..100)
  // Sonderschlüssel 'fremd': Anteil Fremdkapital am kumulierten Saldo je Quartal.
  verteilung: Record<string, Record<string, Record<string, number>>>
  // Jahreszinssatz (%) auf die Fremdfinanzierung; Zins fällt jeweils im Folgejahr an.
  fremdZinssatz: number
  /** Zeitliche Verteilung der Verkaufserlöse (nur Verkaufsobjekte). */
  verkauf: MfVerkauf
  /** Ebene der Kostenverteilung — Positionen oder Hauptgruppen. */
  verteilEbene: VerteilEbene
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
    verkauf: { ...MF_VERKAUF_DEFAULT },
    verteilEbene: 'position',
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
    verkauf: { ...MF_VERKAUF_DEFAULT, ...(raw.verkauf ?? {}) },
    verteilEbene: raw.verteilEbene === 'hauptgruppe' ? 'hauptgruppe' : 'position',
  }
}

// ── Verkaufserlöse über die Quartale ────────────────────────────────────────

/**
 * Die Bauphase des Terminplans — an ihr hängen beide Verkaufsmodelle: die
 * Übergabe liegt an ihrem Ende, die Raten nach Baufortschritt laufen über sie.
 * Erkannt an der Bezeichnung, sonst die längste Phase.
 */
export function bauPhase(phasen: MfPhase[]): MfPhase | null {
  const aufgeloest = resolvePhasen(phasen)
  if (aufgeloest.length === 0) return null
  return aufgeloest.find((p) => /ausf[üu]hrung|bau(?!projekt)/i.test(p.label))
    ?? aufgeloest.reduce((a, b) => (b.dauerMonate > a.dauerMonate ? b : a))
}

/** Index des Quartals, in dem ein Monat liegt; −1 ausserhalb des Fensters. */
function quartalIndex(quartale: MfQuartal[], monat: string): number {
  const { jahr, monat: m } = parseMonat(monat)
  return quartale.findIndex((q) => q.jahr === jahr && q.q === quartalVonMonat(m))
}

/**
 * Anteil der Verkaufserlöse je Quartal (Summe 100), aus dem gewählten Modell:
 *
 * - `uebergabe`: alles im Quartal, in dem die Bauphase endet — der Regelfall
 *   beim Verkauf ab Plan mit Zahlung bei Übergabe.
 * - `baufortschritt`: die Anzahlungen fallen über die Absatzdauer an, der Rest
 *   läuft gleichmässig über die Bauphase.
 * - `frei`: die von Hand gesetzten Prozente.
 */
export function verkaufsVerteilung(
  doc: MittelflussDoc, quartale: MfQuartal[], frei: Record<string, number>,
): number[] {
  const leer = quartale.map(() => 0)
  if (quartale.length === 0) return leer
  // Beide Handverteilungen rechnet der Aufrufer selbst: bei `objekte` steht je
  // Objekt eine eigene Reihe, hier gäbe es nichts zu verteilen.
  if (doc.verkauf.modell === 'objekte') return leer
  if (doc.verkauf.modell === 'frei') return quartale.map((q) => frei[q.key] ?? 0)

  const bau = bauPhase(doc.phasen)
  const bauStart = bau?.startMonat ?? doc.startMonat
  const bauEnde = bau ? monatAdd(bau.startMonat, bau.dauerMonate - 1) : doc.endMonat

  if (doc.verkauf.modell === 'uebergabe') {
    const out = [...leer]
    const i = quartalIndex(quartale, bauEnde)
    out[i >= 0 ? i : quartale.length - 1] = 100
    return out
  }

  // Baufortschritt: Anzahlungen über die Absatzdauer, Raten über die Bauphase.
  const out = [...leer]
  const anzahlung = Math.min(100, Math.max(0, doc.verkauf.anzahlungPct))
  const startMonat = doc.verkauf.startMonat || bauStart
  const von = Math.max(0, quartalIndex(quartale, startMonat))
  const dauer = Math.max(1, doc.verkauf.dauerQuartale)
  for (let k = 0; k < dauer; k++) {
    const i = Math.min(quartale.length - 1, von + k)
    out[i] += anzahlung / dauer
  }

  const bauVon = Math.max(0, quartalIndex(quartale, bauStart))
  const bauBis = Math.max(bauVon, quartalIndex(quartale, bauEnde) >= 0
    ? quartalIndex(quartale, bauEnde)
    : quartale.length - 1)
  const zahl = bauBis - bauVon + 1
  for (let i = bauVon; i <= bauBis; i++) out[i] += (100 - anzahlung) / zahl
  return out
}
