// Parameter der Renditeberechnung (Erfolgsrechnung) — pro Variante gespeichert.
export interface RenditeParams {
  leerstand: number          // Anteil von Mietertrag SOLL (0..1)
  betriebskosten: number     // Anteil von Mietertrag SOLL (0..1)
  instandhaltungProM2: number // CHF/m²·a (kanonisch; % wird abgeleitet)
  baurechtszins: number      // CHF/a
  instandsetzungProM2: number // CHF/m²·a (kanonisch; % wird abgeleitet)
  // Residualwert (Grundstücksfläche kommt aus den Anlagekosten = GSF)
  nettoKapSatz: number       // Nettokapitalisierungssatz (0..1)
}

export const RENDITE_DEFAULTS: RenditeParams = {
  leerstand: 0.02,
  betriebskosten: 0.05,
  instandhaltungProM2: 15,
  baurechtszins: 0,
  instandsetzungProM2: 25,
  nettoKapSatz: 0.04,
}
