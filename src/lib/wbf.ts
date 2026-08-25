// =============================================================================
// Kantonale Wohnbauförderung ZH — Rechenmodell (aus Excel-Reiter «2_4_WBF»).
// Herleitung der maximalen Erstellungs- und Investitionskosten.
// Wohnungsmix + Nicht-Wohn-Nutzungen kommen aus dem Mengengerüst;
// Punkte und Ansätze sind editierbar.
// =============================================================================

import { WOHNUNGSMIX_KEYS } from '@/types'

export interface WbfParams {
  /** Punkte Wohnbauförderung pro Wohnung, je Zimmer-Kategorie. */
  punkte: Record<string, number>
  /** Max. Erstellungskosten pro Punkt (CHF/Pt.). */
  chfProPunktErstellung: number
  /** Zusatz für energetische Massnahmen (Anteil, z. B. 0.03 = 3 %). */
  energiezuschlagPct: number
  /** Max. pauschalierte Investitionskosten pro Punkt total (CHF/Pt.). */
  chfProPunktInvestitionTotal: number
  /** Ansatz je Nutzung (CHF/m² VMF, bei Parkplätzen CHF/Stk) — Overrides. */
  nutzungRates: Record<string, number>
}

// Default-Punkte gemäss Excel (Joker 3.5, 1.5→5, 2.5→6.5, 3.5→8, 4.5→10, 5.5→11.5);
// Zwischenstufen interpoliert / grosse Wohnungen extrapoliert — alle editierbar.
export const WBF_DEFAULTS: WbfParams = {
  punkte: {
    joker: 3.5,
    '1.5': 5, '2.0': 5.75, '2.5': 6.5, '3.0': 7.25, '3.5': 8,
    '4.0': 9, '4.5': 10, '5.0': 10.75, '5.5': 11.5,
    '6.0': 13, '6.5': 14.5, '>6.5': 16,
  },
  chfProPunktErstellung: 48000,
  energiezuschlagPct: 0.03,
  chfProPunktInvestitionTotal: 60400,
  nutzungRates: {},
}

// Default-Ansatz je Nutzung (CHF/m² bzw. CHF/Stk) anhand Stichworten (editierbar).
// Gemeinschaft 6000, Gewerbe 4500, Lager/Nebenräume 4000, Parkplätze 45000.
export function defaultNutzungRate(nutzung: string, isPark: boolean): number {
  if (isPark) return 45000
  const n = nutzung.toLowerCase()
  if (/gemeinschaft|gemschaft|kita|begegnung/.test(n)) return 6000
  if (/gewerbe|laden|verkauf|b[üu]ro|praxis|restaurant|dienstleist/.test(n)) return 4500
  return 4000 // Lager, Keller, Nebenräume, übrige
}

export interface WbfErgebnis {
  whgTotal: number
  punkteTotal: number
  punkteProWhg: number
  erstellungWohnen: number
  energiezuschlag: number
  erstellungWohnenInkl: number
  erstellungTotal: number
  diffErstellung: number
  baulandSatz: number
  baulandWohnen: number
  investitionTotal: number
  diffInvestition: number
}

export function berechneWbf(
  mix: Record<string, number>,
  p: WbfParams,
  /** Summe der Erstellungskosten der Nicht-Wohn-Nutzungen (Menge × Ansatz). */
  nebenTotal: number,
  geplantErstellung: number,
  geplantInvestition: number,
): WbfErgebnis {
  let whgTotal = 0
  let punkteTotal = 0
  for (const k of WOHNUNGSMIX_KEYS) {
    const n = mix[k as string] || 0
    whgTotal += n
    punkteTotal += n * (p.punkte[k as string] || 0)
  }
  const erstellungWohnen = punkteTotal * p.chfProPunktErstellung
  const energiezuschlag = erstellungWohnen * p.energiezuschlagPct
  const erstellungWohnenInkl = erstellungWohnen + energiezuschlag
  const erstellungTotal = erstellungWohnenInkl + nebenTotal
  const baulandSatz = p.chfProPunktInvestitionTotal - p.chfProPunktErstellung
  const baulandWohnen = punkteTotal * baulandSatz
  const investitionTotal = erstellungTotal + baulandWohnen
  return {
    whgTotal,
    punkteTotal,
    punkteProWhg: whgTotal > 0 ? punkteTotal / whgTotal : 0,
    erstellungWohnen,
    energiezuschlag,
    erstellungWohnenInkl,
    erstellungTotal,
    diffErstellung: geplantErstellung - erstellungTotal,
    baulandSatz,
    baulandWohnen,
    investitionTotal,
    diffInvestition: geplantInvestition - investitionTotal,
  }
}
