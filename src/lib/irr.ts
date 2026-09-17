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
 * Barwert jeder einzelnen Zahlung auf der Kalenderachse: abgezinst über ihre
 * tatsächliche Anzahl Tage, 365 Tage je Jahr — die Konvention von XINTZINSFUSS
 * (XIRR). Der Satz ist damit ein Jahressatz.
 */
export function barwerteKalender(
  jahresZins: number, reihe: number[], tage: number[],
): number[] {
  return reihe.map((v, t) => v / (1 + jahresZins) ** ((tage[t] - tage[0]) / 365))
}

/** Summe der Barwerte — beim internen Zinsfuss ist sie null. */
export function barwertKalender(jahresZins: number, reihe: number[], tage: number[]): number {
  return barwerteKalender(jahresZins, reihe, tage).reduce((s, v) => s + v, 0)
}

/**
 * Alle Nullstellen einer Barwertfunktion im lesbaren Bereich (−99 % bis
 * +1000 %): feines Gitter um die üblichen Sätze, grobes darüber; wo der
 * Barwert das Vorzeichen wechselt, wird bisektiert.
 */
function nullstellen(bwBei: (satz: number) => number): number[] {
  const gitter: number[] = []
  for (let r = -0.99; r < 1; r += 0.0025) gitter.push(r)
  for (let r = 1; r <= 10; r += 0.05) gitter.push(r)

  const wurzeln: number[] = []
  let voriges = gitter[0]
  let bwVor = bwBei(voriges)
  for (let i = 1; i < gitter.length; i++) {
    const jetzt = gitter[i]
    const bw = bwBei(jetzt)
    if (bw === 0) { wurzeln.push(jetzt); voriges = jetzt; bwVor = bw; continue }
    if (bwVor * bw < 0) {
      let lo = voriges
      let hi = jetzt
      let bwLo = bwVor
      for (let k = 0; k < 100 && hi - lo > 1e-10; k++) {
        const mitte = (lo + hi) / 2
        const bwM = bwBei(mitte)
        if (bwM === 0) { lo = mitte; hi = mitte; break }
        if (bwM * bwLo < 0) hi = mitte
        else { lo = mitte; bwLo = bwM }
      }
      wurzeln.push((lo + hi) / 2)
    }
    voriges = jetzt
    bwVor = bw
  }
  return wurzeln
}

/** Reihen ohne Vorzeichenwechsel haben keine Nullstelle — gar nicht erst suchen. */
function reiheDreht(reihe: number[]): boolean {
  return reihe.length >= 2 && reihe.some((v) => v > 0) && reihe.some((v) => v < 0)
}

/**
 * Alle internen Zinsfüsse einer Reihe im lesbaren Bereich (−99 % bis +1000 %
 * je Periode).
 *
 * Gesucht wird auf einem Gitter: überall dort, wo der Barwert das Vorzeichen
 * wechselt, liegt eine Nullstelle, die anschliessend über Bisektion eingeengt
 * wird. Eine Reihe mit mehreren Vorzeichenwechseln — bei Projekten der
 * Normalfall, sobald Tranchen gezogen und zurückbezahlt werden — hat mehrere
 * solche Nullstellen; ein Verfahren, das nur die Randpunkte prüft, findet
 * dann gar keine.
 */
export function irrWurzeln(reihe: number[]): number[] {
  if (!reiheDreht(reihe)) return []
  return nullstellen((r) => barwert(r, reihe))
}

/**
 * Interner Zinsfuss auf der Kalenderachse — das Gegenstück zu XINTZINSFUSS im
 * Excel. Er kommt ohne Hochrechnung aus: gesucht wird direkt der Jahressatz,
 * der die Summe der Barwerte auf null stellt.
 */
export function xirrWurzeln(reihe: number[], tage: number[]): number[] {
  if (!reiheDreht(reihe)) return []
  return nullstellen((r) => barwertKalender(r, reihe, tage))
}

/**
 * Startwert der Suche, wenn mehrere Nullstellen in Frage kommen: 10 % p. a. —
 * derselbe Vorgabewert, mit dem Excel rechnet. So fällt die ausgewiesene
 * Lösung mit der einer Zielwertsuche zusammen. Auf der Quartalsachse
 * entsprechend umgerechnet.
 */
const IRR_STARTWERT_JAHR = 0.1
const IRR_STARTWERT_QUARTAL = 1.1 ** (1 / 4) - 1

/**
 * Interner Zinsfuss je Periode — von mehreren Nullstellen die, die dem
 * üblichen Startwert am nächsten liegt.
 *
 * `null`, wo es keine gibt: ohne Vorzeichenwechsel hat die Reihe keine
 * Nullstelle, und ausserhalb des Suchbereichs wäre eine Zahl ohnehin nicht
 * mehr zu lesen. Dann trägt der modifizierte Zinsfuss die Aussage.
 */
export function irrProPeriode(reihe: number[]): number | null {
  return naechsteWurzel(irrWurzeln(reihe), IRR_STARTWERT_QUARTAL)
}

/** Von mehreren Nullstellen die dem Startwert nächste. */
function naechsteWurzel(wurzeln: number[], startwert: number): number | null {
  if (wurzeln.length === 0) return null
  return wurzeln.reduce((a, b) => (
    Math.abs(b - startwert) < Math.abs(a - startwert) ? b : a))
}

/**
 * Interner Zinsfuss nach XINTZINSFUSS: Jahressatz, kalendergenau über die
 * tatsächlichen Tage. `tage` sind die Tageszahlen der Zahlungen auf derselben
 * Achse (Reihenfolge wie `reihe`).
 */
export function xirr(reihe: number[], tage: number[]): number | null {
  return naechsteWurzel(xirrWurzeln(reihe, tage), IRR_STARTWERT_JAHR)
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
  /** Mehr als eine Nullstelle — der interne Zinsfuss ist dann nicht eindeutig. */
  irrMehrdeutig: boolean
  /** Alle gefundenen Nullstellen, auf ein Jahr hochgerechnet. */
  wurzelnJahr: number[]
  /**
   * Interner Zinsfuss p. a. nach XINTZINSFUSS — kalendergenau über die
   * tatsächlichen Tage. `null`, wenn keine Zahlungstage mitgegeben wurden.
   */
  xirrJahr: number | null
  /**
   * Modifizierter interner Zinsfuss p. a. — eindeutig, auch wo der interne
   * Zinsfuss keine oder mehrere Lösungen hat. `null` ohne Finanzierungssatz.
   */
  mirrJahr: number | null
  /** Summe der Reihe — beim Projekt der Gewinn, beim Eigenkapital der Rückfluss. */
  summe: number
}

/**
 * Kennzahlen einer Zahlungsreihe in einem Durchgang.
 *
 * `satzProQuartal` ist der Satz, zu dem Fehlbeträge finanziert und Überschüsse
 * angelegt werden — daraus entsteht der modifizierte Zinsfuss. `tage` sind die
 * Zahlungstage auf einer fortlaufenden Tagesachse; mit ihnen kommt der
 * kalendergenaue Zinsfuss nach XINTZINSFUSS dazu. Beides ist optional, ohne
 * bleibt die jeweilige Kennzahl leer.
 */
export function analysiereReihe(
  netto: number[], optionen?: { satzProQuartal?: number; tage?: number[] },
): ReihenKennzahlen {
  const satzProQuartal = optionen?.satzProQuartal
  const tage = optionen?.tage
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

  const wurzeln = irrWurzeln(netto)
  const irrQ = naechsteWurzel(wurzeln, IRR_STARTWERT_QUARTAL)
  const mirrQ = satzProQuartal == null
    ? null
    : mirrProPeriode(netto, satzProQuartal, satzProQuartal)
  return {
    netto,
    kumuliert,
    kapitalbindung: -tal,
    breakEven: breakEvenIdx >= 0 ? breakEvenIdx : null,
    vorzeichenwechsel: wechsel,
    irrProQuartal: irrQ,
    irrJahr: irrQ == null ? null : aufJahr(irrQ),
    irrMehrdeutig: wurzeln.length > 1,
    wurzelnJahr: wurzeln.map((w) => aufJahr(w)),
    xirrJahr: tage && tage.length === netto.length ? xirr(netto, tage) : null,
    mirrJahr: mirrQ == null ? null : aufJahr(mirrQ),
    summe: lauf,
  }
}

// ─── Finanzierung aus den erfassten Einlagen und Tranchen ────────────────────

export interface FinanzierungsReihe {
  /** Ausstehendes Fremdkapital (Stand der aufgenommenen Tranchen). */
  schuld: number[]
  /** Kumulierter Mittelbedarf. */
  benoetigt: number[]
  /**
   * Was das Eigenkapital trägt: Mittelbedarf abzüglich des aufgenommenen
   * Fremdkapitals. Negativ heisst, dass mehr zurückgeflossen ist als
   * eingeschossen wurde — der Gewinn des Eigenkapitals.
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
 * Der Zinsaufwand steckt im Bedarf: die Bauzinsen stehen als Positionen in den
 * Eigentümerkosten (BKP 9) und damit in den Anlagekosten. Hier noch einmal zu
 * verzinsen hiesse, sie doppelt zu zählen.
 */
export function finanzierungsreihe(
  /** Auszahlungen abzüglich Einzahlungen je Quartal (positiv = Bedarf). */
  bedarf: number[],
  /** Eingebrachtes Eigenkapital je Quartal. */
  einlagen: number[],
  /** Aufgenommene Fremdkapitaltranchen je Quartal. */
  tranchen: number[],
): FinanzierungsReihe {
  const schuld: number[] = []
  const benoetigt: number[] = []
  const beanspruchtesEk: number[] = []
  const reserve: number[] = []
  const benoetigtesFk: number[] = []
  const deckungsluecke: number[] = []

  let schuldStand = 0
  let kumBedarf = 0
  let kumEk = 0

  for (let t = 0; t < bedarf.length; t++) {
    schuldStand += tranchen[t] ?? 0
    kumBedarf += bedarf[t] ?? 0
    kumEk += einlagen[t] ?? 0

    /*
     * Beansprucht ist, was nach dem aufgenommenen Fremdkapital vom Bedarf
     * übrig bleibt — ohne Untergrenze: dreht der Bedarf ins Minus, hat das
     * Eigenkapital mehr zurückerhalten als eingeschossen. Genau dieser
     * Überschuss macht den internen Zinsfuss überhaupt erst rechenbar.
     */
    const ek = kumBedarf - schuldStand
    // Eigenkapital zuerst: Fremdkapital wird erst nötig, wenn die Einlagen aufgebraucht sind.
    const fk = Math.max(0, kumBedarf - kumEk)

    schuld.push(schuldStand)
    benoetigt.push(kumBedarf)
    beanspruchtesEk.push(ek)
    reserve.push(kumEk - ek)
    benoetigtesFk.push(fk)
    deckungsluecke.push(Math.max(0, fk - schuldStand))
  }

  const ekFluss = beanspruchtesEk.map((v, i) => (beanspruchtesEk[i - 1] ?? 0) - v)
  return {
    schuld, benoetigt, beanspruchtesEk, reserve, benoetigtesFk, deckungsluecke, ekFluss,
  }
}
