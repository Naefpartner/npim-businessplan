// =============================================================================
// Bundesamt für Wohnungswesen (BWO) — zulässige Anlagekostenlimite für
// Mietwohnungen (aus Excel-Reiter «2.5 BWO»).
// Einheiten (Anzahl) kommen aus dem Mengengerüst; Limiten sind editierbar.
//   https://www.bwo.admin.ch/de/anlagekostenlimiten
// =============================================================================

import { WOHNUNGSMIX_KEYS } from '@/types'

export interface BwoParams {
  /** Zulässige Kostenlimite je Wohnung (CHF/Einheit) pro Zimmer-Kategorie. */
  wohnLimits: Record<string, number>
  /** Zulässige Kostenlimite je Nebenfläche/Parkplatz (CHF/Einheit). */
  nutzungLimits: Record<string, number>
  /** Zuschlag Energie (Anteil des Wohnteils, max. 0.10). */
  energieZuschlagPct: number
  /** Anrechenbarer Zusatzaufwand wegen schlechtem Baugrund (CHF). */
  baugrundZusatz: number
}

export const BWO_DEFAULTS: BwoParams = {
  wohnLimits: {},      // leer → defaultWohnLimit greift
  nutzungLimits: {},   // leer → defaultNutzungLimit greift
  energieZuschlagPct: 0,
  baugrundZusatz: 0,
}

// Default-Kostenlimite je Wohnungs-Kategorie (CHF/Einheit) gemäss BWO-Excel.
// Ganzzimmer-Werte den .5-Kategorien zugeordnet, Zwischenstufen interpoliert.
export function defaultWohnLimit(cat: string): number {
  const m: Record<string, number> = {
    joker: 90000,
    '1.5': 335000, '2.0': 392500, '2.5': 450000, '3.0': 512500, '3.5': 575000,
    '4.0': 647500, '4.5': 720000, '5.0': 787500, '5.5': 855000,
    '6.0': 915000, '6.5': 975000, '>6.5': 1185000,
  }
  return m[cat] ?? 0
}

// Default-Limite je Nebenfläche/Parkplatz (CHF/Einheit) anhand Stichworten.
export function defaultNutzungLimit(nutzung: string, isPark: boolean): number {
  const n = nutzung.toLowerCase()
  if (isPark) {
    if (/freien|aussen|im freien/.test(n)) return 15000  // PP im Freien
    return 47000                                          // Garage / Innenabstellplatz
  }
  if (/nebenr|bastel|abstell/.test(n)) return 29000
  return 0 // Gemeinschaft u. a. — bitte manuell setzen
}

export interface BwoErgebnis {
  wohnTotal: number
  energie: number
  wohnInklEnergie: number
  zulaessigeLimite: number
  differenz: number
}

export function berechneBwo(
  mix: Record<string, number>,
  params: BwoParams,
  /** Summe der Nebenflächen-Kostenlimiten (Einheiten × CHF/Einheit). */
  nebenTotal: number,
  geplantAnlagekosten: number,
): BwoErgebnis {
  let wohnTotal = 0
  for (const k of WOHNUNGSMIX_KEYS) {
    const anz = mix[k as string] || 0
    wohnTotal += anz * (params.wohnLimits[k as string] ?? defaultWohnLimit(k as string))
  }
  const energie = wohnTotal * params.energieZuschlagPct
  const wohnInklEnergie = wohnTotal + energie
  const zulaessigeLimite = wohnInklEnergie + nebenTotal + params.baugrundZusatz
  return {
    wohnTotal,
    energie,
    wohnInklEnergie,
    zulaessigeLimite,
    differenz: geplantAnlagekosten - zulaessigeLimite,
  }
}
