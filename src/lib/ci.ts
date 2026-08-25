// =============================================================================
// Corporate-Identity-Farben (Naef & Partner)
// Quelle: Designsystem_Word_Auszug_Farben.pdf (Basis, Dienstleistungen,
//         Tabellen/Diagramme, Farbvarianten Tabellen, Farben Diagramme).
// Familien jeweils von dunkel (9) nach hell (1).
// =============================================================================

export const CI = {
  black: '#000000', // Texte, Linien
  bg:    '#F1F1F1', // Hintergrund (Neutral 1)

  kupfer:  { 9: '#8B6956', 7: '#B98C74', 5: '#E7AF90', 3: '#F2D3C2', 1: '#FAEFE9' }, // Primär = Kupfer 7
  blau:    { 9: '#5F7F8B', 7: '#7FA9BA', 5: '#9FD3E8', 3: '#CAE7F2', 1: '#ECF6FA' },
  violett: { 9: '#6E768B', 7: '#939DB9', 5: '#B8C4E7', 3: '#D8DFF2', 1: '#F1F3FA' },
  gelb:    { 9: '#947C4D', 7: '#C5A666', 5: '#F6CF80', 3: '#FAE5B9', 1: '#FDF5E6' },
  mint:    { 9: '#62806E', 7: '#82AB92', 5: '#A3D6B7', 3: '#CCE8D7', 1: '#EDF7F1' },
  gruen:   { 9: '#808052', 7: '#AAAA6E', 5: '#D5D589', 3: '#E8E8BE', 1: '#F7F7E7' },
  rot:     { 9: '#994D4D', 7: '#CC6666', 5: '#FF8080', 3: '#FFB9B9', 1: '#FFE6E6' }, // Sonderfarbe
  neutral: { 9: '#696969', 7: '#8C8C8C', 5: '#AFAFAF', 3: '#D3D3D3', 1: '#F1F1F1' }, // Sonderfarbe
} as const

export type CiFamily = keyof Omit<typeof CI, 'black' | 'bg'>

// Dienstleistungs-Farben (Stufe 4) — laut Designsystem.
export const DIENSTLEISTUNG = {
  beraten:    '#F8DBA0', // Gelb 4
  entwickeln: '#DFDFA7', // Grün 4
  vertreten:  '#BAE0C9', // Mint 4
  bauen:      '#B7DEEE', // Blau 4
  entscheiden:'#CAD3ED', // Violett 4
} as const

// Primärfarbe (Kupfer 7) sowie dunklere Varianten für UI-Flächen/Text (Kontrast).
export const PRIMARY        = CI.kupfer[7]  // #B98C74 – Buttons/Akzente
export const PRIMARY_DARK   = CI.kupfer[9]  // #8B6956 – Header, Text, Fokus
export const PRIMARY_DARKER = '#74574A'     // Hover auf dunklen Flächen
export const PRIMARY_LIGHT  = CI.kupfer[1]  // #FAEFE9 – helle Brand-Flächen

// ─── Diagramme ───────────────────────────────────────────────────────────────
// Reihenfolge laut Designsystem (automatisch hinzuziehen): 1. Kupfer 7 Primär,
// 2. Blau 5, 3. Violett 5, 4. Gelb 5, 5. Mint 5, 6. Grün 5. Hintergrund Neutral 1.
export const CHART_ORDER: CiFamily[] = ['kupfer', 'blau', 'violett', 'gelb', 'mint', 'gruen']
export const CHART_BACKGROUND = CI.neutral[1] // #F1F1F1

// Qualitative Diagramm-Palette: die 6 Leitfarben (Reihenfolge oben), danach
// dunklere/hellere Schattierungen sowie die Sonderfarben Rot/Neutral.
export const CHART_PALETTE: string[] = [
  CI.kupfer[7], CI.blau[5], CI.violett[5], CI.gelb[5], CI.mint[5], CI.gruen[5],
  CI.kupfer[9], CI.blau[9], CI.violett[9], CI.gelb[9], CI.mint[9], CI.gruen[9],
  CI.kupfer[5], CI.blau[7], CI.violett[7], CI.gelb[7], CI.mint[7], CI.gruen[7],
  CI.rot[5], CI.neutral[7],
]

// ─── Tabellen-Farbvarianten ─────────────────────────────────────────────────
// Laut Designsystem je Farbfamilie:
//   header (Tabellentitel)   = Stufe 5  (Kupfer: Stufe 7 «Primär»), dunkle Schrift
//   subtitle (Titel Subtab.) = Stufe 3
//   background (Hintergrund)  = Stufe 1
// Verfügbar als Varianten: Kupfer, Blau, Violett, Gelb, Mint, Grün (+ Rot/Neutral).
export interface TableVariant { header: string; subtitle: string; background: string }
export function tableVariant(family: CiFamily): TableVariant {
  const f = CI[family]
  return {
    header:     family === 'kupfer' ? CI.kupfer[7] : f[5],
    subtitle:   f[3],
    background: f[1],
  }
}
