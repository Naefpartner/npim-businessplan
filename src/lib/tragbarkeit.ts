// =============================================================================
// Tragbarkeit der Renditeobjekte — Modell des Excel-Blatts „Finanzierung
// Vertikal".
//
// Gerechnet wird je Quadratmeter vermietbarer Wohnfläche, weil die Wohnung die
// Bezugsgrösse der Bank ist: aus dem Mietzinsniveau Wohnen und dem Anteil des
// Wohnertrags am Gesamtertrag ergibt sich der Ertrag je m² Wohnfläche, daraus
// über den Kapitalisierungssatz der Ertragswert, daraus die Belehnung.
//
// Zwei Spalten stehen nebeneinander: „Effektiv" rechnet mit dem tatsächlichen
// Hypothekarzins, „Tragbarkeit" mit dem kalkulatorischen Satz der Bank. Die
// Differenz der beiden ist die Frage, ob das Projekt auch bei höheren Zinsen
// getragen wird.
// =============================================================================

/**
 * Sätze, die ab einem Jahr gelten: Schlüssel ist das Jahr, Wert der Anteil.
 * Zwischenjahre stehen nicht darin — es gilt der letzte gesetzte Satz.
 */
export type JahresSaetze = Record<string, number>

/**
 * Der Satz, der in einem Jahr gilt: der zuletzt gesetzte davor oder in ihm.
 * Ohne jede Angabe der Vorgabewert.
 */
export function satzFuerJahr(
  saetze: JahresSaetze, jahr: number, vorgabe: number,
): number {
  let treffer = vorgabe
  let bestes = 0
  for (const [k, v] of Object.entries(saetze)) {
    const j = Number(k)
    if (!Number.isFinite(j) || j > jahr || j < bestes) continue
    bestes = j
    treffer = v
  }
  return treffer
}

/** Eingaben der Tragbarkeitsrechnung; alle Sätze als Anteil (0.023 = 2.3 %). */
export interface TragbarkeitParams {
  /** Tatsächlicher Hypothekarzins — die Spalte „Effektiv". */
  hypozins: number
  /** Kalkulatorischer Zinssatz der Bank — die Spalte „Tragbarkeit". */
  tragbarkeitszins: number
  /**
   * Kapitalisierungssatz auf dem Bruttomietertrag: Ertragswert = Mietertrag
   * geteilt durch diesen Satz. Nicht zu verwechseln mit dem
   * Nettokapitalisierungssatz der Residualwertrechnung, der auf dem Nettoertrag
   * rechnet.
   */
  kapitalisierungssatz: number
  /** Höchste Belehnung der 1. Hypothek, Anteil des Ertragswerts. */
  max1: number
  /** Höchste Belehnung total (1. und 2. Hypothek), Anteil des Ertragswerts. */
  max2: number
  /** Mietzinsniveau Wohnen in CHF je m² Wohnfläche und Jahr. */
  mietzinsniveauWohnen: number
  /** Anteil des Wohnertrags am gesamten Mietertrag. */
  anteilWohnen: number
  /** Betriebs- und Unterhaltskosten samt Erneuerung, Anteil des Mietertrags. */
  bewirtschaftungsquote: number
  /** Jahre, in denen die 2. Hypothek amortisiert sein muss — zugleich die
   *  Länge des Verlaufs. */
  amortisationsdauer: number
  /**
   * Ertragsausfall als Anteil des Mietertrags SOLL, je Jahr erfassbar. Nur die
   * Jahre stehen darin, in denen sich der Satz ändert; er gilt von dort an
   * weiter — wer in Jahr 4 ein Prozent setzt, hat es bis zum Ende.
   */
  ausfallProJahr: JahresSaetze
  /** Bewirtschaftungskosten als Anteil des SOLL, nach derselben Regel. */
  kostenquoteProJahr: JahresSaetze
  /** 1. Hypothek in CHF; 0 heisst: aus der Belehnungsgrenze abgeleitet. */
  ersteHypothekChf: number
  /** Eigenmittel der Kontrollrechnung in CHF. */
  zusaetzlicheEigenmittel: number
}

export const TRAGBARKEIT_DEFAULTS: TragbarkeitParams = {
  hypozins: 0.02,
  tragbarkeitszins: 0.05,
  kapitalisierungssatz: 0.035,
  max1: 0.55,
  max2: 0.65,
  mietzinsniveauWohnen: 0,
  anteilWohnen: 1,
  bewirtschaftungsquote: 0.2,
  amortisationsdauer: 15,
  // Die Staffel des Businessplans: Erstvermietung, Einschwingen, Dauerwert —
  // und Kosten, die steigen, wenn die Garantien auslaufen.
  ausfallProJahr: { 1: 0.05, 2: 0.02, 4: 0.01 },
  kostenquoteProJahr: { 1: 0.15, 6: 0.2 },
  ersteHypothekChf: 0,
  zusaetzlicheEigenmittel: 0,
}

/** Was die Rechnung aus Mengen und Anlagekosten der Variante übernimmt. */
export interface TragbarkeitBasis {
  /** Jahresmietertrag SOLL aller Nutzungen der Renditeobjekte. */
  mietertragTotal: number
  /** Davon aus Wohnnutzungen. */
  mietertragWohnen: number
  /** Vermietbare Wohnfläche in m². */
  vmfWohnen: number
  /** Anlagekosten inklusive Mehrwertsteuer. */
  anlagekosten: number
}

/** Eine Spalte der Rechnung — je m² Wohnfläche, ausser wo anders vermerkt. */
export interface TragbarkeitSpalte {
  /** Zinssatz, mit dem diese Spalte rechnet. */
  zinssatz: number
  /** Mietertrag je m² Wohnfläche (alle Nutzungen). */
  ertragProM2: number
  /** Nettoertrag vor Finanzierung. */
  nettoertrag: number
  /** Ertragswert je m² Wohnfläche. */
  ertragswertProM2: number
  /** 1. Hypothek je m². */
  ersteHypothek: number
  /** Zins der 1. Hypothek je m² und Jahr. */
  finanzierungskosten: number
  /** Was nach dem Zins für die Amortisation bleibt, je m² und Jahr. */
  maximaleAmortisation: number
  /** Belehnungsgrenze der 2. Hypothek je m². */
  belehnungsgrenze: number
  /** Tragbare Hypothek total je m². */
  maxHypothek: number
  /** Woran die 2. Hypothek hängt: an der Belehnungsgrenze oder an der Amortisation. */
  grenze: 'belehnung' | 'amortisation'
  /** Anlagekosten je m² Wohnfläche. */
  baukostenProM2: number
  /** Eigenkapital je m², das über die tragbare Hypothek hinaus nötig ist. */
  eigenkapitalProM2: number
  /** Dasselbe in Franken, auf die ganze Wohnfläche. */
  eigenkapital: number
  /** Tragbare Hypothek in Franken. */
  maxHypothekTotal: number
}

/** Die Kontrollrechnung in Franken neben der Rechnung je Quadratmeter. */
export interface TragbarkeitKontrolle {
  mietertrag: number
  ertragswert: number
  kosten: number
  eigenmittel: number
  noetigesFremdkapital: number
  maximaleBelehnung: number
  /** Überschuss der Belehnungsgrenze über das nötige Fremdkapital. */
  spielraum: number
  tragbar: boolean
}

export interface TragbarkeitErgebnis {
  effektiv: TragbarkeitSpalte
  tragbarkeit: TragbarkeitSpalte
  kontrolle: TragbarkeitKontrolle
}

/**
 * Eine Spalte rechnen.
 *
 * Der Ertragswert folgt dem Mietertrag, nicht den Kosten — eine Bank belehnt,
 * was die Liegenschaft trägt. Die 1. Hypothek ist reiner Zins; was der
 * Nettoertrag darüber hinaus hergibt, amortisiert die 2. innerhalb der
 * vereinbarten Dauer. Mehr als die Belehnungsgrenze gibt es auch dann nicht,
 * wenn der Ertrag es hergäbe.
 */
function spalte(
  zinssatz: number, p: TragbarkeitParams, b: TragbarkeitBasis,
): TragbarkeitSpalte {
  const ertragProM2 = p.anteilWohnen > 0 ? p.mietzinsniveauWohnen / p.anteilWohnen : 0
  const nettoertrag = ertragProM2 * (1 - p.bewirtschaftungsquote)
  const ertragswertProM2 = p.kapitalisierungssatz > 0
    ? ertragProM2 / p.kapitalisierungssatz
    : 0
  const ersteHypothek = ertragswertProM2 * p.max1
  const finanzierungskosten = ersteHypothek * zinssatz
  const maximaleAmortisation = nettoertrag - finanzierungskosten
  const belehnungsgrenze = ertragswertProM2 * p.max2
  const ausAmortisation = ersteHypothek + p.amortisationsdauer * maximaleAmortisation
  const maxHypothek = Math.min(ausAmortisation, belehnungsgrenze)
  const baukostenProM2 = b.vmfWohnen > 0 ? b.anlagekosten / b.vmfWohnen : 0
  const eigenkapitalProM2 = baukostenProM2 - maxHypothek
  return {
    zinssatz,
    ertragProM2,
    nettoertrag,
    ertragswertProM2,
    ersteHypothek,
    finanzierungskosten,
    maximaleAmortisation,
    belehnungsgrenze,
    maxHypothek,
    grenze: ausAmortisation < belehnungsgrenze ? 'amortisation' : 'belehnung',
    baukostenProM2,
    eigenkapitalProM2,
    eigenkapital: eigenkapitalProM2 * b.vmfWohnen,
    maxHypothekTotal: maxHypothek * b.vmfWohnen,
  }
}

/** Beide Spalten und die Kontrollrechnung in einem Durchgang. */
export function berechneTragbarkeit(
  p: TragbarkeitParams, b: TragbarkeitBasis,
): TragbarkeitErgebnis {
  const ertragswert = p.kapitalisierungssatz > 0
    ? b.mietertragTotal / p.kapitalisierungssatz
    : 0
  const noetigesFremdkapital = b.anlagekosten - p.zusaetzlicheEigenmittel
  const maximaleBelehnung = ertragswert * p.max2
  return {
    effektiv: spalte(p.hypozins, p, b),
    tragbarkeit: spalte(p.tragbarkeitszins, p, b),
    kontrolle: {
      mietertrag: b.mietertragTotal,
      ertragswert,
      kosten: b.anlagekosten,
      eigenmittel: p.zusaetzlicheEigenmittel,
      noetigesFremdkapital,
      maximaleBelehnung,
      spielraum: maximaleBelehnung - noetigesFremdkapital,
      tragbar: maximaleBelehnung >= noetigesFremdkapital,
    },
  }
}

// ── Verlauf über die Laufzeit ───────────────────────────────────────────────

/** Eine Zeile des Verlaufs — ein Jahr, in Franken. */
export interface TragbarkeitJahr {
  /** Beschriftung der Zeile („Jahr 1", „Jahr 16 mit 5.00 %"). */
  label: string
  mietertragSoll: number
  ertragsausfall: number
  /** Anteil des Ausfalls am SOLL. */
  ausfallQuote: number
  mietertragIst: number
  kosten: number
  /** Anteil der Kosten am SOLL. */
  kostenQuote: number
  /** Das Jahr der Zeile; die beiden Schlusszeilen teilen sich eines. */
  jahr: number
  /** Ob der Satz in diesem Jahr selbst gesetzt ist — sonst geerbt. */
  ausfallEigen: boolean
  kostenEigen: boolean
  liegenschaftserfolg: number
  /** Anteil des Erfolgs am SOLL. */
  erfolgQuote: number
  fremdkapital: number
  /** Belehnung: Fremdkapital im Verhältnis zum Ertragswert. */
  belehnung: number
  ersteHypothek: number
  zweiteHypothek: number
  zinsErste: number
  zinsZweite: number
  amortisation: number
  /** Was nach Zins und Amortisation bleibt. */
  ueberschuss: number
}

/**
 * Der Verlauf über die Laufzeit, wie ihn das Excel-Blatt Jahr für Jahr führt.
 *
 * Der Mietertrag bleibt konstant; der Ertragsausfall sinkt von der
 * Erstvermietung auf den Dauerwert, die Bewirtschaftungskosten steigen nach
 * fünf Jahren, wenn Garantien auslaufen. Die 1. Hypothek steht; amortisiert
 * wird allein die 2., in gleichen Raten über die Laufzeit. Was nach Zins und
 * Amortisation bleibt, ist der Überschuss.
 *
 * Nach der Laufzeit stehen zwei Zeilen: dieselbe Rechnung ohne 2. Hypothek,
 * einmal zum kalkulatorischen Satz und einmal zum tatsächlichen Zins — die
 * Probe, ob die Liegenschaft auch dann trägt.
 */
export function berechneVerlauf(
  p: TragbarkeitParams, b: TragbarkeitBasis,
): TragbarkeitJahr[] {
  const jahre = Math.max(1, Math.round(p.amortisationsdauer))
  const ertragswert = p.kapitalisierungssatz > 0
    ? b.mietertragTotal / p.kapitalisierungssatz
    : 0
  const fremdkapitalStart = b.anlagekosten - p.zusaetzlicheEigenmittel
  // Ohne eigene Vorgabe so viel 1. Hypothek, wie die Belehnungsgrenze hergibt —
  // mehr als das nötige Fremdkapital aber nie.
  const erste = p.ersteHypothekChf > 0
    ? p.ersteHypothekChf
    : Math.min(fremdkapitalStart, ertragswert * p.max1)
  const zweiteStart = Math.max(0, fremdkapitalStart - erste)
  const amortisation = zweiteStart / jahre

  const zeile = (
    label: string, jahr: number, zweite: number, zinssatz: number, tilgt: boolean,
  ): TragbarkeitJahr => {
    const ausfallQuote = satzFuerJahr(p.ausfallProJahr, jahr, 0)
    const kostenQuote = satzFuerJahr(p.kostenquoteProJahr, jahr, 0)
    const soll = b.mietertragTotal
    const ausfall = soll * ausfallQuote
    const ist = soll - ausfall
    const kosten = soll * kostenQuote
    const erfolg = ist - kosten
    const zinsErste = erste * zinssatz
    const zinsZweite = zweite * zinssatz
    const tilgung = tilgt ? amortisation : 0
    return {
      label,
      jahr,
      ausfallEigen: p.ausfallProJahr[jahr] != null,
      kostenEigen: p.kostenquoteProJahr[jahr] != null,
      mietertragSoll: soll,
      ertragsausfall: ausfall,
      ausfallQuote,
      mietertragIst: ist,
      kosten,
      kostenQuote,
      liegenschaftserfolg: erfolg,
      erfolgQuote: soll > 0 ? erfolg / soll : 0,
      fremdkapital: erste + zweite,
      belehnung: ertragswert > 0 ? (erste + zweite) / ertragswert : 0,
      ersteHypothek: erste,
      zweiteHypothek: zweite,
      zinsErste,
      zinsZweite,
      amortisation: tilgung,
      ueberschuss: erfolg - zinsErste - zinsZweite - tilgung,
    }
  }

  const aus: TragbarkeitJahr[] = []
  let zweite = zweiteStart
  for (let j = 1; j <= jahre; j++) {
    aus.push(zeile(`Jahr ${j}`, j, zweite, p.hypozins, true))
    zweite = Math.max(0, zweite - amortisation)
  }
  // Nach der Tilgung: nur noch die 1. Hypothek, zu beiden Sätzen gerechnet.
  const satz = (v: number) => `${(v * 100).toFixed(2)} %`
  aus.push(zeile(`Jahr ${jahre + 1} zum Tragbarkeitssatz ${satz(p.tragbarkeitszins)}`,
    jahre + 1, 0, p.tragbarkeitszins, false))
  aus.push(zeile(`Jahr ${jahre + 1} zum Hypothekarzins ${satz(p.hypozins)}`,
    jahre + 1, 0, p.hypozins, false))
  return aus
}

// ── Persistenz ──────────────────────────────────────────────────────────────

export interface TragbarkeitDoc extends TragbarkeitParams {
  /**
   * Ob Mietzinsniveau und Anteil Wohnen von Hand gesetzt sind. Wer eine
   * Annahme setzt, will sie behalten, auch wenn sich die Mengen ändern —
   * deshalb je Grösse ein Merker.
   */
  eigenesMietzinsniveau: boolean
  eigenerAnteilWohnen: boolean
}

export function defaultTragbarkeitDoc(): TragbarkeitDoc {
  return {
    ...TRAGBARKEIT_DEFAULTS,
    eigenesMietzinsniveau: false,
    eigenerAnteilWohnen: false,
  }
}

/** Gespeichertes Dokument einlesen; fehlende Felder bekommen den Vorgabewert. */
export function normalizeTragbarkeitDoc(
  raw: Partial<TragbarkeitDoc> | null | undefined,
): TragbarkeitDoc {
  const d = defaultTragbarkeitDoc()
  if (!raw || typeof raw !== 'object') return d
  const zahl = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  /** Jahressätze einlesen: nur ganze Jahre ab 1 mit endlichem Satz. */
  const saetze = (v: unknown, fallback: JahresSaetze): JahresSaetze => {
    if (!v || typeof v !== 'object') return fallback
    const aus: JahresSaetze = {}
    for (const [k, w] of Object.entries(v as Record<string, unknown>)) {
      const j = Number(k)
      if (Number.isInteger(j) && j >= 1 && typeof w === 'number' && Number.isFinite(w)) {
        aus[j] = w
      }
    }
    return Object.keys(aus).length > 0 ? aus : fallback
  }
  return {
    hypozins:                zahl(raw.hypozins, d.hypozins),
    tragbarkeitszins:        zahl(raw.tragbarkeitszins, d.tragbarkeitszins),
    kapitalisierungssatz:    zahl(raw.kapitalisierungssatz, d.kapitalisierungssatz),
    max1:                    zahl(raw.max1, d.max1),
    max2:                    zahl(raw.max2, d.max2),
    mietzinsniveauWohnen:    zahl(raw.mietzinsniveauWohnen, d.mietzinsniveauWohnen),
    anteilWohnen:            zahl(raw.anteilWohnen, d.anteilWohnen),
    bewirtschaftungsquote:   zahl(raw.bewirtschaftungsquote, d.bewirtschaftungsquote),
    amortisationsdauer:      zahl(raw.amortisationsdauer, d.amortisationsdauer),
    ausfallProJahr:          saetze(raw.ausfallProJahr, d.ausfallProJahr),
    kostenquoteProJahr:      saetze(raw.kostenquoteProJahr, d.kostenquoteProJahr),
    ersteHypothekChf:        zahl(raw.ersteHypothekChf, d.ersteHypothekChf),
    zusaetzlicheEigenmittel: zahl(raw.zusaetzlicheEigenmittel, d.zusaetzlicheEigenmittel),
    eigenesMietzinsniveau:   raw.eigenesMietzinsniveau === true,
    eigenerAnteilWohnen:     raw.eigenerAnteilWohnen === true,
  }
}
