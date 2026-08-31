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

/** Bezugsgrössen der Renditerechnung — aus Mengen und Anlagekosten. */
export interface RenditeBasis {
  /** Jahresmietertrag SOLL aus den Mengen. */
  mietertragSoll: number
  /** Vermietbare Fläche in m² — Bezug für Instandhaltung und Instandsetzung. */
  totalVmf: number
  /** Anlagekosten brutto inklusive Grundstück. */
  investition: number
  /** Anlagekosten brutto ohne Position 010 (Grundstückerwerb). */
  erstellung: number
  /** Grundstücksfläche als Bezug für den Landwert je m². */
  gsf: number
}

export interface RenditeErgebnis {
  leerstand: number
  mietertragIst: number
  betriebskosten: number
  instandhaltung: number
  baurechtszins: number
  mietertragNetto: number
  instandsetzung: number
  liegenschaftserfolg: number
  bruttorendite: number
  nettorendite: number
  /** Kapitalisierter Liegenschaftserfolg. */
  ertragswert: number
  /** Ertragswert abzüglich Erstellungskosten = residualer Landwert. */
  landwert: number
  landwertProM2: number
}

/**
 * Erfolgsrechnung und Residualwert in einem Durchgang — beide Sichten teilen
 * sich den Liegenschaftserfolg, und der Bericht braucht dieselben Zahlen wie
 * die Sektion. Deshalb hier als reine Funktion statt im Komponentenrumpf.
 */
export function berechneRendite(p: RenditeParams, b: RenditeBasis): RenditeErgebnis {
  const leerstand = b.mietertragSoll * p.leerstand
  const mietertragIst = b.mietertragSoll - leerstand
  const betriebskosten = b.mietertragSoll * p.betriebskosten
  const instandhaltung = p.instandhaltungProM2 * b.totalVmf
  const baurechtszins = p.baurechtszins
  const mietertragNetto = mietertragIst - betriebskosten - instandhaltung - baurechtszins
  const instandsetzung = p.instandsetzungProM2 * b.totalVmf
  const liegenschaftserfolg = mietertragNetto - instandsetzung

  const ertragswert = p.nettoKapSatz > 0 ? liegenschaftserfolg / p.nettoKapSatz : 0
  const landwert = ertragswert - b.erstellung

  return {
    leerstand, mietertragIst, betriebskosten, instandhaltung, baurechtszins,
    mietertragNetto, instandsetzung, liegenschaftserfolg,
    bruttorendite: b.investition > 0 ? b.mietertragSoll / b.investition : 0,
    nettorendite:  b.investition > 0 ? liegenschaftserfolg / b.investition : 0,
    ertragswert, landwert,
    landwertProM2: b.gsf > 0 ? landwert / b.gsf : 0,
  }
}
