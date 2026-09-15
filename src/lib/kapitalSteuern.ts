// =============================================================================
// Kapital und Steuern — Typen und reine Rechenlogik.
//
// Zwei Gesellschaften teilen sich ein Verkaufsprojekt: der Landprovider bringt
// das Grundstück ein und verkauft es weiter, der Totalunternehmer baut und
// verkauft die Einheiten. Beide haben eigene Kosten, einen eigenen Gewinn und
// eigene Steuern; darüber steht die Kapitalstruktur der Investoren.
//
// Der bearbeitbare Zustand liegt als ein JSONB-Doc je Variante in
// `variant_kapital_steuern.doc` (Migration 069). Beträge, die aus den
// Anlagekosten stammen, stehen nicht im Doc — dort steht nur, welche Position
// gewählt ist; der Betrag kommt live aus der Kostenberechnung.
// =============================================================================

import type { BkpErgebnis } from '@/lib/bkpBerechnung'

/** Ein Investor mit seiner Einlage. */
export interface KsInvestor {
  id: string
  name: string
  /** Eingebrachtes Kapital in CHF. */
  kapital: number
  /**
   * Gewinnanteil in Prozent. Leer heisst: nach dem Anteil am eingebrachten
   * Kapital — der Regelfall, von dem nur abweicht, wer es vereinbart hat.
   */
  gewinnanteilPct: number | null
  /** Verzinsung der Einlage in Prozent pro Jahr. */
  zinssatzPct: number
}

/**
 * Eine Kostenzeile einer Gesellschaft. Entweder eine Position aus der
 * Kostenberechnung — dann steht hier nur ihr Code und der Betrag kommt live
 * aus den Anlagekosten — oder eine frei erfasste Zeile mit eigenem Betrag.
 */
export interface KsKostenZeile {
  id: string
  /** BKP-Code der übernommenen Position; null bei einer freien Zeile. */
  code: string | null
  label: string
  /** Betrag der freien Zeile in CHF. */
  betrag: number
  /**
   * Anteil in Prozent einer Bezugsgrösse (etwa „Bankfinanzierung 65 %" des
   * Landpreises). Gesetzt, rechnet die Zeile ihren Betrag daraus.
   */
  anteilPct: number | null
  /** Verzinsung dieser Zeile in Prozent pro Jahr; 0 heisst unverzinst. */
  zinssatzPct: number
}

/** Eine der beiden Gesellschaften. */
export interface KsGesellschaft {
  name: string
  /**
   * Zusammenstellung der Landkosten und ihrer Finanzierung — nur beim
   * Landprovider; der Totalunternehmer kauft das Land von ihm.
   */
  landkosten: KsKostenZeile[]
  /** Anlagekosten aus der Händlertätigkeit: gewählte Positionen und freie Zeilen. */
  anlagekosten: KsKostenZeile[]
  /** Ertrag dieser Gesellschaft in CHF (Verkaufserlös bzw. Werkpreis). */
  ertrag: number
  /** Steuersatz auf dem Gewinn in Prozent. */
  steuersatzPct: number
  /** Notizen zur Steuerberechnung, solange sie nicht ausmodelliert ist. */
  bemerkung: string
}

export interface KapitalSteuernDoc {
  investoren: KsInvestor[]
  landprovider: KsGesellschaft
  totalunternehmer: KsGesellschaft
}

/** Die Gesellschaften des Hauses — als Vorgabe, überschreibbar. */
export const KS_LANDPROVIDER_DEFAULT = 'Naef & Partner Investitionen AG'
export const KS_TOTALUNTERNEHMER_DEFAULT = 'Naef & Partner Generalplanungen AG'

/** Üblicher Steuersatz auf dem Gewinn — Ausgangswert, überschreibbar. */
export const KS_STEUERSATZ_DEFAULT = 30

function leereGesellschaft(name: string): KsGesellschaft {
  return {
    name,
    landkosten: [],
    anlagekosten: [],
    ertrag: 0,
    steuersatzPct: KS_STEUERSATZ_DEFAULT,
    bemerkung: '',
  }
}

export function defaultKapitalSteuernDoc(): KapitalSteuernDoc {
  return {
    investoren: [],
    landprovider: leereGesellschaft(KS_LANDPROVIDER_DEFAULT),
    totalunternehmer: leereGesellschaft(KS_TOTALUNTERNEHMER_DEFAULT),
  }
}

function normalisiereZeilen(raw: unknown): KsKostenZeile[] {
  if (!Array.isArray(raw)) return []
  return raw.map((z, i) => {
    const r = (z ?? {}) as Partial<KsKostenZeile>
    return {
      id: r.id || `z${i}-${Math.random().toString(36).slice(2, 8)}`,
      code: r.code ?? null,
      label: r.label ?? '',
      betrag: typeof r.betrag === 'number' ? r.betrag : 0,
      anteilPct: typeof r.anteilPct === 'number' ? r.anteilPct : null,
      zinssatzPct: typeof r.zinssatzPct === 'number' ? r.zinssatzPct : 0,
    }
  })
}

function normalisiereGesellschaft(
  raw: Partial<KsGesellschaft> | undefined, name: string,
): KsGesellschaft {
  const def = leereGesellschaft(name)
  if (!raw) return def
  return {
    name: raw.name || def.name,
    landkosten: normalisiereZeilen(raw.landkosten),
    anlagekosten: normalisiereZeilen(raw.anlagekosten),
    ertrag: typeof raw.ertrag === 'number' ? raw.ertrag : 0,
    // Fehlt der Satz im Dokument, gilt der Ausgangswert — nicht null Prozent.
    steuersatzPct: typeof raw.steuersatzPct === 'number' ? raw.steuersatzPct : def.steuersatzPct,
    bemerkung: raw.bemerkung ?? '',
  }
}

export function normalizeKapitalSteuernDoc(
  raw: Partial<KapitalSteuernDoc> | null | undefined,
): KapitalSteuernDoc {
  if (!raw || typeof raw !== 'object') return defaultKapitalSteuernDoc()
  return {
    investoren: Array.isArray(raw.investoren)
      ? raw.investoren.map((inv, i) => ({
        id: inv?.id || `inv${i}-${Math.random().toString(36).slice(2, 8)}`,
        name: inv?.name ?? '',
        kapital: typeof inv?.kapital === 'number' ? inv.kapital : 0,
        gewinnanteilPct: typeof inv?.gewinnanteilPct === 'number' ? inv.gewinnanteilPct : null,
        zinssatzPct: typeof inv?.zinssatzPct === 'number' ? inv.zinssatzPct : 0,
      }))
      : [],
    landprovider: normalisiereGesellschaft(raw.landprovider, KS_LANDPROVIDER_DEFAULT),
    totalunternehmer: normalisiereGesellschaft(raw.totalunternehmer, KS_TOTALUNTERNEHMER_DEFAULT),
  }
}

// ── Rechnen ─────────────────────────────────────────────────────────────────

/**
 * Beträge der Kostenberechnung nach Schlüssel — die Grundlage der übernommenen
 * Zeilen. Benchmark und keeValue rechnen auf Hauptgruppen; dann sind deren
 * Summen die wählbaren Grössen, sonst die einzelnen Positionen.
 */
export function positionsBetraegeAus(
  erg: BkpErgebnis | undefined, aufHauptgruppen: boolean,
): Map<string, number> {
  const map = new Map<string, number>()
  if (!erg) return map
  if (aufHauptgruppen) {
    for (let c = 0; c <= 9; c++) {
      const k = c as keyof typeof erg.hauptgruppenSummenNetto
      const betrag = (erg.hauptgruppenSummenNetto[k] ?? 0) + (erg.hauptgruppenSummenMwst[k] ?? 0)
      if (Math.abs(betrag) >= 0.5) map.set(`hg${c}`, betrag)
    }
    return map
  }
  for (const [code, p] of Object.entries(erg.positionen)) {
    map.set(code, (p.betragNetto ?? 0) + (p.mwstBetrag ?? 0))
  }
  return map
}

/**
 * Beide Gesellschaften in einem Durchgang. Der Werkerlös des
 * Totalunternehmers ist der Gesamterlös abzüglich des Landanteils, den der
 * Landprovider verrechnet — was der eine einnimmt, zahlt der andere.
 */
export function kapitalSteuernErgebnis(
  doc: KapitalSteuernDoc,
  betraege: Map<string, number>,
  landpreis: number,
  verkaufserloesTotal: number,
): {
  lp: KsGesellschaftErgebnis
  tu: KsGesellschaftErgebnis
  werkerloes: number
  gewinnNachSteuernTotal: number
} {
  const lp = berechneGesellschaft(doc.landprovider, betraege, landpreis)
  const werkerloes = verkaufserloesTotal - doc.landprovider.ertrag
  const tu = berechneGesellschaft(doc.totalunternehmer, betraege, landpreis, werkerloes)
  return {
    lp, tu, werkerloes,
    gewinnNachSteuernTotal: lp.gewinnNachSteuern + tu.gewinnNachSteuern,
  }
}

/**
 * Betrag einer Kostenzeile. Positionen bringen ihn aus den Anlagekosten mit,
 * Anteilszeilen rechnen ihn aus ihrer Bezugsgrösse, freie Zeilen führen ihn
 * selbst.
 */
export function zeilenBetrag(
  z: KsKostenZeile,
  /** Betrag der übernommenen Position, falls die Zeile eine führt. */
  ausKostenberechnung: number | undefined,
  /** Bezugsgrösse für Anteilszeilen (beim Landprovider der Landpreis). */
  bezug: number,
): number {
  if (z.code) return ausKostenberechnung ?? 0
  if (z.anteilPct != null) return (z.anteilPct / 100) * bezug
  return z.betrag
}

export interface KsInvestorErgebnis extends KsInvestor {
  /** Anteil am gesamten eingebrachten Kapital (0..1). */
  kapitalAnteil: number
  /** Massgebender Gewinnanteil (0..1) — gesetzt oder aus dem Kapitalanteil. */
  gewinnAnteil: number
  /** Jahreszins auf der Einlage. */
  zinsProJahr: number
  /** Anteil am ausgewiesenen Gewinn nach Steuern. */
  gewinnAnteilChf: number
}

export interface KsKapitalErgebnis {
  investoren: KsInvestorErgebnis[]
  kapitalTotal: number
  zinsProJahrTotal: number
  /** Summe der gesetzten und abgeleiteten Gewinnanteile (0..1) — soll 1 sein. */
  gewinnAnteilTotal: number
}

/**
 * Kapitalstruktur auswerten. Wo kein Gewinnanteil erfasst ist, gilt der Anteil
 * am eingebrachten Kapital — so ergibt die Aufteilung ohne weitere Eingabe
 * hundert Prozent.
 */
export function berechneKapital(
  investoren: KsInvestor[], gewinnNachSteuern: number,
): KsKapitalErgebnis {
  const kapitalTotal = investoren.reduce((s, i) => s + i.kapital, 0)
  const aus = investoren.map((inv) => {
    const kapitalAnteil = kapitalTotal > 0 ? inv.kapital / kapitalTotal : 0
    const gewinnAnteil = inv.gewinnanteilPct != null ? inv.gewinnanteilPct / 100 : kapitalAnteil
    return {
      ...inv,
      kapitalAnteil,
      gewinnAnteil,
      zinsProJahr: inv.kapital * (inv.zinssatzPct / 100),
      gewinnAnteilChf: gewinnNachSteuern * gewinnAnteil,
    }
  })
  return {
    investoren: aus,
    kapitalTotal,
    zinsProJahrTotal: aus.reduce((s, i) => s + i.zinsProJahr, 0),
    gewinnAnteilTotal: aus.reduce((s, i) => s + i.gewinnAnteil, 0),
  }
}

export interface KsGesellschaftErgebnis {
  landkosten: number
  anlagekosten: number
  kostenTotal: number
  /** Zins auf den verzinsten Kostenzeilen, pro Jahr. */
  zinsProJahr: number
  gewinnVorSteuern: number
  steuern: number
  gewinnNachSteuern: number
}

/**
 * Kosten, Gewinn und Steuern einer Gesellschaft. Der Gewinn vor Steuern ist
 * der Ertrag abzüglich aller erfassten Kosten; die Steuern rechnen auf ihm —
 * ein Verlust bleibt unbesteuert.
 */
export function berechneGesellschaft(
  g: KsGesellschaft,
  /** Beträge der übernommenen Positionen, nach BKP-Code. */
  positionsBetraege: Map<string, number>,
  /** Bezugsgrösse für Anteilszeilen. */
  bezug: number,
  /**
   * Abgeleiteter Ertrag statt des erfassten — beim Totalunternehmer ist der
   * Werkerlös der Gesamterlös abzüglich des Landanteils, also keine Eingabe.
   */
  ertragOverride?: number,
): KsGesellschaftErgebnis {
  const summe = (zeilen: KsKostenZeile[]) => zeilen.reduce(
    (s, z) => s + zeilenBetrag(z, z.code ? positionsBetraege.get(z.code) : undefined, bezug), 0)
  const landkosten = summe(g.landkosten)
  const anlagekosten = summe(g.anlagekosten)
  const kostenTotal = landkosten + anlagekosten
  const zinsProJahr = [...g.landkosten, ...g.anlagekosten].reduce(
    (s, z) => s + zeilenBetrag(z, z.code ? positionsBetraege.get(z.code) : undefined, bezug)
      * (z.zinssatzPct / 100), 0)
  const ertrag = ertragOverride ?? g.ertrag
  const gewinnVorSteuern = ertrag - kostenTotal
  const steuern = gewinnVorSteuern > 0 ? gewinnVorSteuern * (g.steuersatzPct / 100) : 0
  return {
    landkosten,
    anlagekosten,
    kostenTotal,
    zinsProJahr,
    gewinnVorSteuern,
    steuern,
    gewinnNachSteuern: gewinnVorSteuern - steuern,
  }
}
