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

// ─── Finanzierung aus den erfassten Einlagen und Tranchen ────────────────────

export interface FinanzierungsReihe {
  /** Zinsaufwand je Quartal auf dem ausstehenden Fremdkapital. */
  zins: number[]
  /** Ausstehendes Fremdkapital (Stand der aufgenommenen Tranchen). */
  schuld: number[]
  /** Kumulierter Mittelbedarf einschliesslich aufgelaufener Zinsen. */
  benoetigt: number[]
  /**
   * Was das Eigenkapital trägt: Saldo abzüglich Fremdkapitalsaldo, zuzüglich
   * des bezahlten Zinses.
   * Negativ heisst, dass mehr zurückgeflossen ist als eingeschossen wurde —
   * der Gewinn des Eigenkapitals.
   */
  beanspruchtesEk: number[]
  /** Eingelegtes, aber noch nicht beanspruchtes Eigenkapital. */
  reserve: number[]
  /** Was nach dem eingelegten Eigenkapital noch zu finanzieren wäre. */
  benoetigtesFk: number[]
  /** Bedarf, den weder Einlagen noch Tranchen decken. */
  deckungsluecke: number[]
  /**
   * Zahlungsreihe des Eigenkapitals: das Delta des beanspruchten Eigenkapitals
   * von Quartal zu Quartal mit umgekehrtem Vorzeichen — wächst die
   * Beanspruchung, fliesst Geld ab. Dieselbe Reihe trägt die Tabelle und der
   * interne Zinsfuss.
   */
  ekFluss: number[]
}

/**
 * Finanzierung einer Quartalsreihe aus dem, was erfasst ist: Eigenkapital
 * zuerst, Fremdkapital für den Rest.
 *
 * Eine einzige Rechnung für die Tabelle und für den internen Zinsfuss — vorher
 * standen die Zeilen der Mittelflussrechnung und ein eigenes Wasserfallmodell
 * nebeneinander und konnten sich widersprechen.
 *
 * Der Mittelbedarf wächst um die Ausgaben und die Zinsen und schrumpft mit den
 * Einnahmen. Getragen wird er zuerst vom eingelegten Eigenkapital; was darüber
 * hinausgeht, ist Fremdkapitalbedarf. Zinsen laufen auf den tatsächlich
 * aufgenommenen Tranchen — nicht auf dem Bedarf, denn Geld kostet erst, wenn
 * es geholt ist.
 */
export function finanzierungsreihe(
  /** Auszahlungen abzüglich Einzahlungen je Quartal (positiv = Bedarf). */
  bedarf: number[],
  /** Eingebrachtes Eigenkapital je Quartal. */
  einlagen: number[],
  /** Aufgenommene Fremdkapitaltranchen je Quartal. */
  tranchen: number[],
  /** Jahreszinssatz in Prozent. */
  zinssatzPct: number,
): FinanzierungsReihe {
  const zins: number[] = []
  const schuld: number[] = []
  const benoetigt: number[] = []
  const beanspruchtesEk: number[] = []
  const reserve: number[] = []
  const benoetigtesFk: number[] = []
  const deckungsluecke: number[] = []

  let schuldStand = 0
  let kumBedarf = 0
  let kumZins = 0
  let kumEk = 0

  for (let t = 0; t < bedarf.length; t++) {
    schuldStand += tranchen[t] ?? 0
    const z = schuldStand * (zinssatzPct / 100) / 4
    kumZins += z
    kumBedarf += bedarf[t] ?? 0
    kumEk += einlagen[t] ?? 0

    /*
     * Das Eigenkapital eines Quartals: Saldo abzüglich des aufgenommenen
     * Fremdkapitals, zuzüglich der aufgelaufenen Zinsen — dieselbe Rechnung,
     * die in der Tabelle Zeile für Zeile übereinander steht. Der Zins ist
     * bezahlt und nicht im Saldo enthalten; er belastet also das Eigenkapital
     * und mindert es nicht. Ohne Untergrenze: dreht der Saldo ins Plus, steht
     * hier der Rückfluss an das Eigenkapital, und erst dieser
     * Vorzeichenwechsel macht den internen Zinsfuss rechenbar.
     */
    const ek = kumBedarf - schuldStand + kumZins
    // Eigenkapital zuerst: Fremdkapital wird erst nötig, wenn die Einlagen aufgebraucht sind.
    const fk = Math.max(0, kumBedarf - kumEk)

    zins.push(z)
    schuld.push(schuldStand)
    benoetigt.push(kumBedarf + kumZins)
    beanspruchtesEk.push(ek)
    reserve.push(kumEk - ek)
    benoetigtesFk.push(fk)
    deckungsluecke.push(Math.max(0, fk - schuldStand))
  }

  const ekFluss = beanspruchtesEk.map((v, i) => (beanspruchtesEk[i - 1] ?? 0) - v)
  return {
    zins, schuld, benoetigt, beanspruchtesEk, reserve, benoetigtesFk, deckungsluecke, ekFluss,
  }
}
