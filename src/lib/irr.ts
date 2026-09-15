// =============================================================================
// Interner Zinsfuss (IRR) einer Zahlungsreihe.
//
// Die Reihe steht aus Sicht des Investors: Ausgaben negativ, Einnahmen positiv.
// Gerechnet wird auf der Quartalsachse der Mittelflussrechnung; der Kennwert
// wird anschliessend auf ein Jahr hochgerechnet.
// =============================================================================

/** Barwert einer Reihe bei gegebenem Periodenzins. */
export function barwert(zins: number, reihe: number[]): number {
  let bw = 0
  for (let t = 0; t < reihe.length; t++) bw += reihe[t] / (1 + zins) ** t
  return bw
}

/**
 * Interner Zinsfuss je Periode — über Bisektion statt Newton: die Reihen sind
 * hier oft flach, und ein Verfahren, das immer konvergiert, ist mehr wert als
 * eines, das schneller ist.
 *
 * `null`, wo es keinen gibt: ohne Vorzeichenwechsel hat die Reihe keine
 * Nullstelle, und ausserhalb des Suchbereichs (−99 % bis +1000 % je Quartal)
 * wäre eine Zahl ohnehin nicht mehr zu lesen.
 */
export function irrProPeriode(reihe: number[]): number | null {
  if (reihe.length < 2) return null
  const hatPlus = reihe.some((v) => v > 0)
  const hatMinus = reihe.some((v) => v < 0)
  if (!hatPlus || !hatMinus) return null

  let lo = -0.9999
  let hi = 10
  let bwLo = barwert(lo, reihe)
  let bwHi = barwert(hi, reihe)
  if (bwLo === 0) return lo
  if (bwHi === 0) return hi
  if (bwLo * bwHi > 0) return null

  for (let i = 0; i < 200; i++) {
    const mitte = (lo + hi) / 2
    const bw = barwert(mitte, reihe)
    if (bw === 0 || hi - lo < 1e-9) return mitte
    if (bw * bwLo < 0) { hi = mitte; bwHi = bw } else { lo = mitte; bwLo = bw }
  }
  return (lo + hi) / 2
}

/** Periodenzins auf Jahreszins hochrechnen (Quartale: vier Perioden). */
export function aufJahr(zinsProPeriode: number, periodenProJahr = 4): number {
  return (1 + zinsProPeriode) ** periodenProJahr - 1
}

/**
 * Modifizierter interner Zinsfuss: Ausgaben werden zum Finanzierungssatz auf
 * den Anfang abgezinst, Einnahmen zum Anlagesatz auf das Ende aufgezinst. Er
 * ist eindeutig — anders als der IRR, der bei mehrfachem Vorzeichenwechsel
 * mehrere Lösungen hat.
 */
export function mirrProPeriode(
  reihe: number[], finanzierungsZins: number, anlageZins: number,
): number | null {
  const n = reihe.length - 1
  if (n < 1) return null
  let barwertAus = 0
  let endwertEin = 0
  for (let t = 0; t <= n; t++) {
    const v = reihe[t]
    if (v < 0) barwertAus += v / (1 + finanzierungsZins) ** t
    else endwertEin += v * (1 + anlageZins) ** (n - t)
  }
  if (barwertAus === 0 || endwertEin <= 0) return null
  return (endwertEin / -barwertAus) ** (1 / n) - 1
}

export interface ReihenKennzahlen {
  /** Zahlungsreihe je Quartal, wie hineingegeben. */
  netto: number[]
  /** Laufende Summe der Reihe. */
  kumuliert: number[]
  /**
   * Grösster gebundener Betrag — das tiefste Tal der kumulierten Reihe, als
   * positive Zahl. Sie sagt, wie viel Kapital das Projekt überhaupt braucht.
   */
  kapitalbindung: number
  /** Erstes Quartal, in dem die kumulierte Reihe ins Plus dreht. */
  breakEven: number | null
  /** Wie oft die Reihe das Vorzeichen wechselt — mehr als einmal macht den IRR mehrdeutig. */
  vorzeichenwechsel: number
  irrProQuartal: number | null
  /** Auf ein Jahr hochgerechnet. */
  irrJahr: number | null
  /** Summe der Reihe — beim Projekt der Gewinn, beim Eigenkapital der Rückfluss. */
  summe: number
}

/** Kennzahlen einer Zahlungsreihe in einem Durchgang. */
export function analysiereReihe(netto: number[]): ReihenKennzahlen {
  const kumuliert: number[] = []
  let lauf = 0
  for (const v of netto) { lauf += v; kumuliert.push(lauf) }

  const tal = Math.min(0, ...kumuliert)
  const breakEvenIdx = kumuliert.findIndex((v) => v > 0)

  let wechsel = 0
  let letztes = 0
  for (const v of netto) {
    if (Math.abs(v) < 0.5) continue
    const vorzeichen = v > 0 ? 1 : -1
    if (letztes !== 0 && vorzeichen !== letztes) wechsel++
    letztes = vorzeichen
  }

  const irrQ = irrProPeriode(netto)
  return {
    netto,
    kumuliert,
    kapitalbindung: -tal,
    breakEven: breakEvenIdx >= 0 ? breakEvenIdx : null,
    vorzeichenwechsel: wechsel,
    irrProQuartal: irrQ,
    irrJahr: irrQ == null ? null : aufJahr(irrQ),
    summe: lauf,
  }
}

/** Ergebnis der Eigenkapitalsicht. */
export interface EigenkapitalReihe {
  /** Zahlungsreihe des Eigenkapitals: Einlagen negativ, Ausschüttungen positiv. */
  reihe: number[]
  /** Ausschüttung je Quartal. */
  ausschuettung: number[]
  /** Ausstehendes Fremdkapital am Ende jedes Quartals. */
  schuld: number[]
  /**
   * Das Projektkonto war zeitweise im Minus: Einlagen und Tranchen decken den
   * Bedarf nicht. Die Reihe rechnet trotzdem, aber die Finanzierung ist dann
   * nicht vollständig geplant.
   */
  unterdeckung: boolean
  /** Am Ende nicht getilgtes Fremdkapital. */
  restschuld: number
}

/**
 * Sicht des Eigenkapitals. Das Projektkonto nimmt auf, was hereinkommt —
 * Verkaufserlöse, Einlagen, Fremdkapitaltranchen — und zahlt Kosten und Zins.
 * Was übrig bleibt, tilgt zuerst das Fremdkapital; erst danach fliesst etwas
 * an das Eigenkapital zurück. Das ist die übliche Reihenfolge und macht die
 * Reihe ohne weitere Eingaben rechenbar.
 */
export function eigenkapitalReihe(
  /** Projekt-Cashflow je Quartal (Erlöse − Kosten). */
  nettoCf: number[],
  /** Eingebrachtes Eigenkapital je Quartal. */
  einlagen: number[],
  /** Aufgenommene Fremdkapitaltranchen je Quartal. */
  tranchen: number[],
  /** Zinsaufwand je Quartal. */
  zins: number[],
): EigenkapitalReihe {
  let kasse = 0
  let schuld = 0
  let unterdeckung = false
  const reihe: number[] = []
  const ausschuettung: number[] = []
  const schuldStand: number[] = []

  for (let t = 0; t < nettoCf.length; t++) {
    const einlage = einlagen[t] ?? 0
    schuld += tranchen[t] ?? 0
    kasse += (nettoCf[t] ?? 0) + einlage + (tranchen[t] ?? 0) - (zins[t] ?? 0)
    if (kasse < -0.5) unterdeckung = true

    const tilgung = kasse > 0 ? Math.min(schuld, kasse) : 0
    schuld -= tilgung
    kasse -= tilgung

    // Ausgeschüttet wird erst, wenn nichts mehr zu tilgen ist.
    const aus = schuld <= 0.5 && kasse > 0 ? kasse : 0
    kasse -= aus

    ausschuettung.push(aus)
    schuldStand.push(schuld)
    reihe.push(aus - einlage)
  }

  return { reihe, ausschuettung, schuld: schuldStand, unterdeckung, restschuld: schuld }
}
