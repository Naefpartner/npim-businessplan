import type { ProjectUseType, Eigentumsart } from '@/types'
import { CI, type CiFamily } from '@/lib/ci'

// Farbfamilie je Eigentumskategorie (Designsystem-Farbvariante der Tabellen):
//   Rendite = Blau, Genossenschaft = Grün, Verkaufsobjekt = Rot, gemischt = Violett.
const FAMILY = {
  renditeobjekt:  CI.blau,
  genossenschaft: CI.gruen,
  verkaufsobjekt: CI.rot,
  gemischt:       CI.violett,
} as const

function lvl(n: 9 | 7 | 5 | 3 | 1): Record<ProjectUseType, string> {
  return {
    renditeobjekt:  FAMILY.renditeobjekt[n],
    genossenschaft: FAMILY.genossenschaft[n],
    verkaufsobjekt: FAMILY.verkaufsobjekt[n],
    gemischt:       FAMILY.gemischt[n],
  }
}

// Tabellen-Logik (Designsystem): Kopf/Tabellentitel = Stufe 7 mit DUNKLER Schrift,
// darunter immer heller (Stufe 5 / 3), Hintergrund Stufe 1.
export const USE_TYPE_COLOR   = lvl(7) // Kopf / Tabellentitel
export const USE_TYPE_COLOR_7 = lvl(7)
export const USE_TYPE_COLOR_5 = lvl(5)
export const USE_TYPE_COLOR_3 = lvl(3)
export const USE_TYPE_COLOR_1 = lvl(1) // Hintergrund

// Dunkle Schrift auf den (hellen) Kopf-Farben.
export const HEADER_TEXT = '#1e293b' // slate-900

// Neutral für Total-/Gesamt-Zeilen (Sonderfarbe).
export const TOTAL_COLOR = CI.neutral[7] // #8C8C8C

// Eigentumskategorie der Anlagekosten → gleiche Farben wie die use_type-Kategorien.
export const EIGENTUMSART_COLOR: Record<Eigentumsart, string> = {
  renditeobjekt:  USE_TYPE_COLOR.renditeobjekt,
  genossenschaft: USE_TYPE_COLOR.genossenschaft,
  verkaufsobjekt: USE_TYPE_COLOR.verkaufsobjekt,
}

// CI-Farbfamilie je Eigentumsart — für Farbrampen (z. B. Mietspiegel-Kacheln),
// damit Einfärbungen zur Farbe der Nutzungsart passen.
export const EIGENTUMSART_FAMILY: Record<Eigentumsart, CiFamily> = {
  renditeobjekt:  'blau',
  genossenschaft: 'gruen',
  verkaufsobjekt: 'rot',
}
