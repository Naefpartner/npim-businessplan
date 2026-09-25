// Satz des Berichtskapitels „Mittelflussrechnung" — nur Layout, keine
// Datenbeschaffung. Getrennt, damit sich das Kapitel mit Probezahlen rendern
// und nachmessen lässt, ohne Datenbank und ohne React.

import { monatAdd, type MfPhase, type MfQuartal } from '@/lib/mittelfluss'
import type { EkKonto, FinanzierungsReihe, ReihenKennzahlen } from '@/lib/irr'
import { formatNumber } from '@/lib/utils'
import { BERICHT_FARBE } from '@/lib/bericht'
import type {
  BereichsKapitelDaten, KapitelBereich, TabellenZeile,
} from '@/components/bericht/BerichtDokument'

/** Raster der Jahresübersicht: Position, je Jahr eine Spalte, rechts der Abschluss. */
function rasterJahre(anzahl: number): { breiten: number[]; spaltenAbstand: number } {
  /*
   * Engerer Steg als die üblichen 3 mm: derselbe Raster trägt den Balkenplan,
   * und dort ist der Steg eine Lücke im Balken an jeder Jahresgrenze.
   */
  return { breiten: [70, ...Array<number>(anzahl).fill(21), 23], spaltenAbstand: 2 }
}

/**
 * Betrag in Franken, gerundet. Negative Beträge tragen das Minuszeichen
 * (U+2212), nicht den kürzeren Bindestrich der Tastatur — in einer Zahlenspalte
 * fällt der Unterschied auf.
 */
function chf(v: number): string {
  const g = Math.round(v)
  // Null bleibt leer, damit die Tafel ruhig bleibt.
  if (g === 0) return ''
  return g < 0 ? `−${formatNumber(-g)}` : formatNumber(g)
}

/** Betrag, der auch als Null steht — Summen- und Kontrollzeilen. */
function chf0(v: number): string {
  const g = Math.round(v)
  return g < 0 ? `−${formatNumber(-g)}` : formatNumber(g)
}

function pct(v: number | null, stellen = 1): string {
  if (v == null) return '—'
  const z = (Math.abs(v) * 100).toFixed(stellen)
  return `${v < 0 ? '−' : ''}${z} %`
}

/**
 * Die fertig gerechneten Reihen des Kapitels. Sie trennen die Beschaffung der
 * Daten vom Satz der Tabellen — so lässt sich das Kapitel auch mit Probezahlen
 * rendern und nachmessen.
 */
export interface MfKapitelZahlen {
  quartale: MfQuartal[]
  /** Terminplan, Verkettungen aufgelöst. */
  phasen: MfPhase[]
  /** Anlagekosten netto je Quartal, Bauzinsen eingeschlossen. */
  nettoAK: number[]
  mwst: number[]
  ggst: number[]
  gewinnsteuerTu: number[]
  /** Anlagekosten inklusive Mehrwertsteuer und Gewinnsteuern. */
  kosten: number[]
  erloese: number[]
  /** Saldo, aufgelaufen. */
  kumSaldo: number[]
  ek: number[]
  tranchen: number[]
  fin: FinanzierungsReihe
  kProjekt: ReihenKennzahlen
  /** Das Eigenkapital als verzinstes Konto — Satz, Einlagen und Endwert. */
  konto: EkKonto
  /**
   * Summe der Investorengelder aus „Kapital und Steuern" — das erfasste
   * Eigenkapital des Projekts. Die Zeitachse steht in `ek`; wo die beiden
   * auseinandergehen, ist nicht alles auf Quartale verteilt.
   */
  ekInvestoren: number
}

/**
 * Satz des Kapitels „Mittelflussrechnung": Terminplan und Annahmen, der
 * Mittelfluss je Jahr, die Zahlungsreihe je Quartal und die Kennzahlen daraus.
 *
 * Für die Bank in dieser Reihenfolge: zuerst die Annahmen, dann die Übersicht,
 * dann der Nachweis Quartal für Quartal — und zuletzt die Kennzahlen, die sich
 * aus diesen Reihen ergeben.
 */
export function mittelflussKapitel(z: MfKapitelZahlen): BereichsKapitelDaten {
  // Farbsystematik des Berichts: das Kapitel betrifft das ganze Projekt und
  // keine einzelne Nutzungsart — es trägt deshalb Kupfer.
  const farben = {
    farbe: BERICHT_FARBE.primaer,
    tabellenFarbe: BERICHT_FARBE.primaer,
    totalFarbe: BERICHT_FARBE.primaerZart,
    zelleFarbe: BERICHT_FARBE.primaerHell,
  }
  const bereiche: KapitelBereich[] = []

  // ── Jahresspalten: sie tragen den Balkenplan und die Zahlen darunter ─────
  const jahre = [...new Set(z.quartale.map((q) => q.jahr))]
  /*
   * Jedes Jahr zeigt alle vier Quartale, auch wo das Betrachtungsfenster nur
   * einen Teil davon führt: ein angeschnittenes Jahr mit zwei breiten Feldern
   * las sich wie ein anderer Zeitmassstab. Die Balken rechnen deshalb auf der
   * Kalenderachse — vier Quartale je Jahresspalte.
   */
  const jahresSpalten = jahre.map((j) => ({
    label: String(j),
    quartale: ['Q1', 'Q2', 'Q3', 'Q4'],
  }))
  const raster = rasterJahre(jahre.length)

  // ── Terminplan als Balkenplan über den Jahresspalten ─────────────────────
  if (z.phasen.length > 0) {
    /**
     * Quartalsfeld eines Monats auf der Kalenderachse des Balkenplans: vier
     * Felder je Jahresspalte, gezählt ab dem ersten gezeigten Jahr. Was
     * ausserhalb liegt, wird auf den Rand gelegt.
     */
    const letztesFeld = jahre.length * 4 - 1
    const quartalIndex = (monat: string): number => {
      const [jahr, mon] = monat.split('-').map(Number)
      const feld = (jahr - jahre[0]) * 4 + Math.floor((mon - 1) / 3)
      return Math.min(letztesFeld, Math.max(0, feld))
    }
    bereiche.push({
      titel: '',
      ...farben,
      balken: {
        titel: 'Terminplan',
        breiten: raster.breiten,
        spaltenAbstand: raster.spaltenAbstand,
        jahre: jahresSpalten,
        zeilen: z.phasen.map((p) => {
          const von = quartalIndex(p.startMonat)
          const bis = quartalIndex(monatAdd(p.startMonat, Math.max(1, p.dauerMonate) - 1))
          return {
            // Nur der Name der Phase: Beginn und Dauer stehen im Balken.
            label: p.label,
            farbe: p.farbe,
            von,
            bis: Math.max(von, bis),
          }
        }),
      },
      tabellen: [],
    })
  }

  // ── Mittelfluss je Jahr ───────────────────────────────────────────────────
  const indexJeJahr = jahre.map(
    (j) => z.quartale.map((q, i) => (q.jahr === j ? i : -1)).filter((i) => i >= 0))
  /**
   * Zahlungen werden je Jahr summiert, Stände am Jahresende abgelesen — eine
   * Summe von Ständen wäre sinnlos. Rechts steht deshalb bei Zahlungen die
   * Gesamtsumme und bei Ständen der Wert am Ende der Betrachtung.
   */
  const jahrZeile = (
    label: string, reihe: number[], art: 'summe' | 'stand', total?: boolean,
  ): TabellenZeile => ({
    zellen: [
      label,
      ...indexJeJahr.map((idx) => chf(art === 'stand'
        ? (reihe[idx[idx.length - 1]] ?? 0)
        : idx.reduce((s, i) => s + (reihe[i] ?? 0), 0))),
      chf0(art === 'stand'
        ? (reihe[reihe.length - 1] ?? 0)
        : reihe.reduce((s, v) => s + v, 0)),
    ],
    total,
  })
  bereiche.push({
    titel: '',
    ...farben,
    tabellen: [{
      titel: 'Mittelfluss je Jahr, in CHF',
      kopf: ['Position', ...jahre.map(String), 'Total / Stand'],
      ...raster,
      linksBis: 0,
      zeilen: [
        jahrZeile('Anlagekosten exkl. MWST', z.nettoAK, 'summe'),
        jahrZeile('Mehrwertsteuer', z.mwst, 'summe'),
        jahrZeile('Grundstückgewinnsteuer', z.ggst, 'summe'),
        jahrZeile('Gewinnsteuer Totalunternehmer', z.gewinnsteuerTu, 'summe'),
        jahrZeile('Anlagekosten inkl. MWST und Gewinnsteuern', z.kosten, 'summe', true),
        jahrZeile('Verkaufserlöse', z.erloese, 'summe', true),
        jahrZeile('Saldo, Stand am Jahresende', z.kumSaldo, 'stand'),
        jahrZeile('Eingebrachtes Eigenkapital', z.ek, 'summe'),
        jahrZeile('Saldo Eigenkapital, Stand am Jahresende', z.fin.eingelegt, 'stand'),
        jahrZeile('Finanzierungstranchen', z.tranchen, 'summe'),
        jahrZeile('Saldo Fremdkapital, Stand am Jahresende', z.fin.schuld, 'stand'),
        /*
         * Was bereitsteht und noch nicht gebraucht ist: Saldo des Jahres plus
         * Saldo Eigenkapital plus Saldo Fremdkapital — die drei Zeilen darüber.
         * Negativ ist die Deckungslücke, dann tragen Eigenkapital und Tranchen
         * den Mittelbedarf nicht.
         */
        jahrZeile('Finanzierungsreserven, Stand am Jahresende', z.fin.reserveFk, 'stand'),
      ],
    }],
  })

  // ── Kennzahlen ────────────────────────────────────────────────────────────
  const beIdx = z.kProjekt.breakEven
  const breakEven = beIdx != null && z.quartale[beIdx]
    ? `${z.quartale[beIdx].jahr} Q${z.quartale[beIdx].q}`
    : '—'
  bereiche.push({
    titel: '',
    ...farben,
    tabellen: [{
      titel: 'Kennzahlen der Zahlungsreihe',
      kopf: ['Kennzahl', 'Grundlage', 'Wert'],
      breiten: [58, 78, 24],
      linksBis: 1,
      zeilen: [
        {
          /*
           * Die Verzinsung des Eigenkapitals als Konto: die Einlagen
           * quartalsweise verzinst, bis der Stand am Schluss auf dem Gewinn
           * steht. Eine eindeutige Zahl, die sich mit einer Anlage vergleichen
           * lässt — anders als der interne Zinsfuss, der hier früher stand.
           */
          zellen: ['Durchschnittliche Verzinsung Eigenkapital',
            `Einlagen quartalsweise verzinst bis zum Endstand von ${chf0(z.konto.endwert)} CHF,`
            + ` höchster Einsatz ${chf0(z.konto.spitzeEinsatz)} CHF`,
            pct(z.konto.satz)],
          total: true,
        },
        {
          zellen: ['Kapitalbindung', 'grösster Mittelbedarf des Projekts, CHF',
            chf0(z.kProjekt.kapitalbindung)],
        },
        {
          zellen: ['Break-even', 'Quartal, in dem der Saldo ins Plus dreht', breakEven],
        },
        {
          zellen: ['Projektgewinn',
            'Verkaufserlöse abzüglich Anlagekosten und Gewinnsteuern, CHF',
            chf0(z.kProjekt.summe)],
          total: true,
        },
        {
          // Ausgewiesen ist, was die Kapitalstruktur führt — die Summe der
          // Investorengelder.
          zellen: ['Eingebrachtes Eigenkapital',
            'Summe der Investorengelder aus „Kapital und Steuern", CHF',
            chf0(z.ekInvestoren)],
        },
      ],
    }],
  })

  return {
    mehrereSichten: false,
    sichten: [{ titel: 'Gesamtprojekt', gesamt: true, bereiche }],
  }
}

