// Satz des Berichtskapitels „Kapital und Steuern" — nur Layout, keine
// Datenbeschaffung. Getrennt, damit sich das Kapitel mit Probezahlen rendern
// und nachmessen lässt, ohne Datenbank und ohne React.

import { HAUPTGRUPPEN } from '@/lib/bkpKatalog'
import {
  berechneKapital, kapitalSteuernErgebnis, zeilenBetrag,
  type KapitalSteuernDoc, type KsGesellschaft, type KsGesellschaftErgebnis,
  type KsKostenZeile,
} from '@/lib/kapitalSteuern'
import { ekKontoverzinsung } from '@/lib/irr'
import { formatNumber } from '@/lib/utils'
import { BERICHT_FARBE } from '@/lib/bericht'
import { EIGENTUMSART_COLOR, USE_TYPE_COLOR_1, USE_TYPE_COLOR_3 } from '@/lib/kategorieFarben'
import type {
  BereichsKapitelDaten, KapitelBereich, KapitelTabelle, TabellenZeile,
} from '@/components/bericht/BerichtDokument'

const EIG = 'verkaufsobjekt' as const

/**
 * Raster der Erfolgsrechnungen: Bezeichnung, Ansatz, Betrag, Anteil am
 * Verkaufserlös. Die Zahlen stehen rechtsbündig untereinander; die Bezeichnung
 * bekommt, was übrig bleibt — Positionsnamen aus dem BKP sind lang.
 */
const RASTER_ERFOLG = { breiten: [96, 20, 26, 18], spaltenAbstand: 3 }

/**
 * Raster der Kapitaltabelle: Investor, Einlage, Anteile, Verzinsung, Gewinn,
 * Multiple.
 *
 * Jede Spalte ist so breit, dass ihr längster Inhalt auf eine Zeile geht —
 * nachgerechnet am Breitenmodell des Satzes (Spaltenbreite gegen Bedarf, mm):
 *
 *     Investor      44.3 / 43.7   „Eingebrachtes Eigenkapital"
 *     Einlage CHF   17.3 / 17.1   Beschriftung
 *     Anteil        12.1 / 11.9   „100.0 %"
 *     Gewinnanteil  12.1 / 11.9   „100.0 %"
 *     Ø Verzinsung  18.9 / 18.6   Beschriftung
 *     Gewinn n. St. 15.9 / 15.6   siebenstellige Beträge
 *     Multiple      18.3 / 11.6   Beschriftung
 *
 * Den Platz dafür gibt der Spaltenabstand her: 2 statt 3 mm bringt über sechs
 * Stege 6 mm zurück. Enger darf er nicht werden, sonst laufen die
 * rechtsbündigen Zahlenspalten ineinander.
 *
 * Die letzte Breite ist nicht frei gewählt: sie stellt die Spalte „Gewinn nach
 * Steuern" genau auf die Kante der Spalte „CHF" der Erfolgsrechnungen. Die
 * Breiten sind Anteile, die Spaltenabstände dagegen feste Millimeter — die
 * beiden Raster fluchten deshalb nur bei diesem Wert:
 *
 *     Erfolg   (167.5 − 2·2.3 − 3·3) · (96+20+26)/160        + 2·3 = 142.59 mm
 *     Kapital  (167.5 − 2·2.3 − 6·2) · 132.7/(132.7 + 18.3) + 5·2 = 142.59 mm
 *
 * Untereinander dürfen die ersten sechs Breiten beliebig umverteilt werden;
 * ihr Verhältnis zur siebten und der Spaltenabstand müssen bleiben.
 *
 * Wer an einer der beiden Reihen dreht, rechnet den Wert neu.
 */
const RASTER_KAPITAL = {
  breiten: [46.3, 19.3, 14.1, 14.1, 20.9, 17.9, 18.3], spaltenAbstand: 2,
}

/**
 * Multiple des eingesetzten Kapitals: was am Ende zurückkommt, geteilt durch
 * das, was eingelegt wurde. 1.00× heisst, das Kapital kommt zurück und sonst
 * nichts. Neben der Verzinsung die zweite geläufige Lesart des Ergebnisses —
 * sie sagt nichts über die Dauer, dafür trifft sie keine Annahme über sie.
 */
function multiple(einlage: number, gewinn: number): string {
  if (einlage <= 0) return '—'
  return `${((einlage + gewinn) / einlage).toFixed(2)}×`
}

/**
 * Betrag in Franken, gerundet. Negative Beträge tragen das Minuszeichen
 * (U+2212) statt des kürzeren Bindestrichs — in einer Zahlenspalte fällt der
 * Unterschied auf.
 */
function chf(v: number): string {
  const g = Math.round(v)
  return g < 0 ? `−${formatNumber(-g)}` : formatNumber(g)
}

/**
 * Kosten- und Steuerbetrag. Ohne Vorzeichen: dass Kosten abgezogen werden,
 * sagt schon die Zeile, in der sie stehen — ein Minus davor liest sich in
 * einer Kostenaufstellung wie eine Rückerstattung.
 */
function kostenBetrag(v: number): string {
  return Math.abs(v) < 0.5 ? '—' : chf(Math.abs(v))
}

function pct(v: number, stellen = 1): string {
  const z = (Math.abs(v) * 100).toFixed(stellen)
  return `${v < 0 ? '−' : ''}${z} %`
}

/** Was der Satz des Kapitels braucht — die Rechnung ist damit schon gemacht. */
export interface KsKapitelZahlen {
  doc: KapitalSteuernDoc
  /** Beträge der übernommenen Positionen, nach BKP-Code. */
  betraege: Map<string, number>
  /** Landpreis (Position 010) — Bezug der Anteilszeilen. */
  landpreis: number
  /** Verkaufserlös der Einheiten aus den Mengen. */
  verkaufserloes: number
  /**
   * Ob die Variante mehrere Eigentumsarten führt. Nur dann tragen die Bereiche
   * einen Balken in der Farbe der Verkaufsobjekte; sonst bleibt es bei Kupfer.
   */
  mehrereEig: boolean
  /**
   * Eingebrachtes Eigenkapital je Quartal aus der Mittelflussrechnung — die
   * Zeitachse, auf der die Verzinsung rechnet. `null`, solange keine
   * Mittelflussrechnung vorliegt.
   */
  ekEinlagen: number[] | null
  /** Gewinn, der in der Mittelflussrechnung an das Eigenkapital geht. */
  ekGewinn: number
}

/**
 * Satz des Kapitels „Kapital und Steuern": wer das Kapital einbringt, und wie
 * sich Landprovider und Totalunternehmer Kosten, Gewinn und Steuern teilen.
 *
 * Die Erfolgsrechnungen stehen in derselben Reihenfolge wie im Reiter der
 * Variante — wer beides nebeneinander legt, findet jede Zahl wieder.
 */
export function kapitalSteuernKapitel(
  {
    doc: ksDoc, betraege, landpreis, verkaufserloes, mehrereEig, ekEinlagen, ekGewinn,
  }: KsKapitelZahlen,
): BereichsKapitelDaten {
  // Farbsystematik: solange nur eine Eigentumsart vorkommt, trägt das Kapitel
  // Kupfer — ein Balken „Verkaufsobjekte" sagte dort nichts. Bei mehreren
  // führt es die Farbe der Verkaufsobjekte.
  const farben = mehrereEig
    ? {
      farbe: EIGENTUMSART_COLOR[EIG],
      tabellenFarbe: USE_TYPE_COLOR_3[EIG],
      totalFarbe: USE_TYPE_COLOR_1[EIG],
      zelleFarbe: USE_TYPE_COLOR_3[EIG],
    }
    : {
      farbe: BERICHT_FARBE.primaer,
      tabellenFarbe: BERICHT_FARBE.primaer,
      totalFarbe: BERICHT_FARBE.primaerZart,
      zelleFarbe: BERICHT_FARBE.primaerHell,
    }

  const { lp, tu, werkerloes, gewinnNachSteuernTotal } = kapitalSteuernErgebnis(
    ksDoc, betraege, landpreis, verkaufserloes)
  const kapital = berechneKapital(ksDoc.investoren, gewinnNachSteuernTotal)

  /** Anteil am Verkaufserlös — die Bezugsgrösse, in der die Bank rechnet. */
  const anteil = (v: number): string => (
    verkaufserloes > 0 ? pct(v / verkaufserloes) : '')

  /**
   * BKP-Hauptgruppe einer übernommenen Position — aus „hg2" so gut wie aus
   * „830". Freie Zeilen und Zeilen ohne erkennbare Nummer geben null; sie
   * behalten ihre eigene Zeile, auch wo auf Hauptgruppen verdichtet wird.
   */
  function hauptgruppeVon(z: KsKostenZeile): number | null {
    if (!z.code) return null
    const treffer = /^(?:hg)?(\d)/.exec(z.code) ?? /^(\d)/.exec(z.label)
    return treffer ? Number(treffer[1]) : null
  }

  /** Eine Kostenzeile der Gesellschaft, mit ihrem Betrag aus der Rechnung. */
  function kostenZeile(z: KsKostenZeile): TabellenZeile {
    const betrag = zeilenBetrag(
      z, z.code ? betraege.get(z.code) : undefined, landpreis)
    return {
      zellen: [
        z.label || z.code || 'Kostenzeile',
        // Anteilszeilen nennen ihren Satz, damit die Herleitung sichtbar ist.
        z.anteilPct != null ? `${z.anteilPct.toFixed(1)} %` : '',
        kostenBetrag(betrag),
        anteil(Math.abs(betrag)),
      ],
      einzug: true,
    }
  }

  /**
   * Erfolgsrechnung einer Gesellschaft: oben der Erlös, darunter die Kosten,
   * dann Gewinn, Steuern und Gewinn nach Steuern. Dieselbe Reihenfolge wie im
   * Reiter — wer beides nebeneinander legt, findet jede Zahl wieder.
   */
  /**
   * Die Anlagekosten einer Gesellschaft als Zeilen. Auf Wunsch auf die
   * BKP-Hauptgruppen verdichtet: beim Totalunternehmer sind es sonst dutzende
   * Positionen, und für die Erfolgsrechnung zählt die Gliederung, nicht die
   * einzelne Position — die steht im Kapitel Anlagekosten. Freie Zeilen
   * behalten ihre eigene Zeile, sie gehören in keine Hauptgruppe.
   */
  function kostenBlock(zeilen: KsKostenZeile[], verdichtet: boolean): TabellenZeile[] {
    if (!verdichtet) return zeilen.map(kostenZeile)
    const summen = new Map<number, number>()
    const einzeln: KsKostenZeile[] = []
    for (const z of zeilen) {
      const hg = hauptgruppeVon(z)
      if (hg == null) { einzeln.push(z); continue }
      const betrag = zeilenBetrag(z, betraege.get(z.code ?? ''), landpreis)
      summen.set(hg, (summen.get(hg) ?? 0) + betrag)
    }
    const aus: TabellenZeile[] = [...summen.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([hg, betrag]) => ({
        zellen: [
          `${hg} · ${HAUPTGRUPPEN.find((h) => h.code === hg)?.label ?? ''}`,
          '', kostenBetrag(betrag), anteil(Math.abs(betrag)),
        ],
        einzug: true,
      }))
    return [...aus, ...einzeln.map(kostenZeile)]
  }

  function erfolgsTabelle(
    titel: string, g: KsGesellschaft, e: KsGesellschaftErgebnis,
    erloesLabel: string, erloes: number, steuerLabel: string,
    /** Anlagekosten auf BKP-Hauptgruppen verdichten statt Position für Position. */
    aufHauptgruppen = false,
  ): KapitelTabelle {
    const zeilen: TabellenZeile[] = [
      { zellen: [erloesLabel, '', chf(erloes), anteil(erloes)], total: true },
    ]
    if (g.landkosten.length > 0) {
      zeilen.push({ fett: true, zellen: ['Landkosten und deren Finanzierung', '', '', ''] })
      for (const z of g.landkosten) zeilen.push(kostenZeile(z))
    }
    if (g.anlagekosten.length > 0) {
      zeilen.push({ fett: true, zellen: ['Anlagekosten', '', '', ''] })
      for (const z of kostenBlock(g.anlagekosten, aufHauptgruppen)) zeilen.push(z)
    }
    zeilen.push({
      zellen: ['Total Kosten', '', kostenBetrag(e.kostenTotal),
          anteil(Math.abs(e.kostenTotal))],
      total: true,
    })
    zeilen.push({
      zellen: ['Gewinn vor Steuern', '', chf(e.gewinnVorSteuern),
        anteil(e.gewinnVorSteuern)],
      total: true,
    })
    zeilen.push({
      zellen: [steuerLabel, `${g.steuersatzPct.toFixed(2)} %`, kostenBetrag(e.steuern),
        anteil(e.steuern)],
    })
    zeilen.push({
      zellen: ['Gewinn nach Steuern', '', chf(e.gewinnNachSteuern),
        anteil(e.gewinnNachSteuern)],
      total: true,
    })
    return {
      titel,
      kopf: ['Position', 'Ansatz', 'CHF', '% Erlös'],
      breiten: RASTER_ERFOLG.breiten,
      spaltenAbstand: RASTER_ERFOLG.spaltenAbstand,
      linksBis: 0,
      zeilen,
    }
  }

  const bereiche: KapitelBereich[] = []

  // ── Kapitalstruktur ──────────────────────────────────────────────────────
  /*
   * Mittlere Verzinsung eines Kapitalanteils: die Einlagen der
   * Mittelflussrechnung auf den Anteil heruntergerechnet, der Gewinn auf den
   * Gewinnanteil — und dann derselbe Kontosatz gesucht wie fürs Ganze. Wer am
   * Gewinn gleich beteiligt ist wie am Kapital, kommt damit auf genau den Satz
   * des Totals; wer anders beteiligt ist, sieht hier, was das für ihn
   * bedeutet. Unterstellt ist, dass alle im selben Rhythmus einzahlen — die
   * Mittelflussrechnung kennt die Einlagen nur als Summe.
   */
  const ekSatz = (kapitalAnteil: number, gewinnAnteil: number): number | null => (
    ekEinlagen == null ? null
      : ekKontoverzinsung(ekEinlagen.map((v) => v * kapitalAnteil), ekGewinn * gewinnAnteil).satz
  )
  const satzZelle = (v: number | null): string => (v == null ? '—' : pct(v))

  if (kapital.investoren.length > 0) {
    const zeilen: TabellenZeile[] = kapital.investoren.map((inv) => ({
      zellen: [
        inv.name || 'Investor',
        chf(inv.kapital),
        pct(inv.kapitalAnteil),
        pct(inv.gewinnAnteil),
        satzZelle(ekSatz(inv.kapitalAnteil, inv.gewinnAnteil)),
        chf(inv.gewinnAnteilChf),
        multiple(inv.kapital, inv.gewinnAnteilChf),
      ],
    }))
    zeilen.push({
      zellen: [
        'Total', chf(kapital.kapitalTotal), pct(1), pct(kapital.gewinnAnteilTotal),
        /*
         * In der Spalte „Verzinsung" steht nicht der vereinbarte Satz auf der
         * Einlage, sondern was das Eigenkapital im Projekt tatsächlich
         * abwirft: die durchschnittliche Verzinsung aus der
         * Mittelflussrechnung. Das ist die Zahl, die sich mit einer anderen
         * Anlage vergleichen lässt.
         */
        satzZelle(ekSatz(1, 1)),
        chf(gewinnNachSteuernTotal),
        multiple(kapital.kapitalTotal, gewinnNachSteuernTotal),
      ],
      total: true,
    })
    bereiche.push({
      titel: 'Kapitalstruktur und Gewinnverteilung',
      ...farben,
      tabellen: [{
        titel: 'Investorenübersicht',
        kopf: ['Investor', 'Einlage CHF', 'Anteil', 'Gewinnanteil', 'Ø Verzinsung',
          'Gewinn nach Steuern CHF', 'Multiple'],
        breiten: RASTER_KAPITAL.breiten,
        spaltenAbstand: RASTER_KAPITAL.spaltenAbstand,
        linksBis: 0,
        zeilen,
      }],
    })
  }

  // ── Die beiden Gesellschaften und ihr Ergebnis ───────────────────────────
  // Je ein Abschnitt: die beiden Erfolgsrechnungen und ihre Zusammenführung
  // tragen eigene Nummern, damit man sie einzeln ansprechen kann. Auf eine
  // neue Seite zwingt das nichts — sie stehen weiter beieinander, solange der
  // Platz reicht.
  const ergebnisZeilen: TabellenZeile[] = [
    {
      zellen: [`Gewinn nach Steuern ${ksDoc.landprovider.name}`, '',
        chf(lp.gewinnNachSteuern), anteil(lp.gewinnNachSteuern)],
    },
    {
      zellen: [`Gewinn nach Steuern ${ksDoc.totalunternehmer.name}`, '',
        chf(tu.gewinnNachSteuern), anteil(tu.gewinnNachSteuern)],
    },
    {
      zellen: ['Gewinn nach Steuern total', '', chf(gewinnNachSteuernTotal),
        anteil(gewinnNachSteuernTotal)],
      total: true,
    },
    {
      zellen: ['Steuern total', '', kostenBetrag(lp.steuern + tu.steuern),
        anteil(lp.steuern + tu.steuern)],
    },
  ]
  if (kapital.kapitalTotal > 0) {
    ergebnisZeilen.push({
      zellen: ['Eingebrachtes Eigenkapital', '', chf(kapital.kapitalTotal),
        anteil(kapital.kapitalTotal)],
    })
    ergebnisZeilen.push({
      zellen: ['Rendite auf dem eingebrachten Eigenkapital',
        pct(gewinnNachSteuernTotal / kapital.kapitalTotal, 1), '', ''],
      total: true,
    })
  }

  bereiche.push({
    titel: 'Gewinn und Steuern Landprovider',
    ...farben,
    tabellen: [
      erfolgsTabelle(
        // Ohne Zusatz: der Abschnittstitel darüber nennt den Landprovider
        // schon, im Balken bliebe er eine Wiederholung.
        ksDoc.landprovider.name, ksDoc.landprovider, lp,
        'Verkaufserlös Land', ksDoc.landprovider.ertrag, 'Grundstückgewinnsteuer'),
    ],
  })

  bereiche.push({
    titel: 'Gewinn und Steuern Totalunternehmer',
    ...farben,
    tabellen: [
      // Der Totalunternehmer trägt die Baukosten — Position für Position wären
      // es dutzende Zeilen, und die Erfolgsrechnung fiele auf die nächste Seite.
      erfolgsTabelle(
        // Wie beim Landprovider: der Abschnittstitel nennt die Rolle schon.
        ksDoc.totalunternehmer.name, ksDoc.totalunternehmer, tu,
        'Verkaufserlös Werk', werkerloes, 'Gewinnsteuer Totalunternehmer', true),
    ],
  })

  bereiche.push({
    titel: 'Übersicht Gewinn und Steuern',
    ...farben,
    tabellen: [
      {
        titel: 'Ergebnis der beiden Gesellschaften',
        kopf: ['Position', 'Ansatz', 'CHF', '% Erlös'],
        breiten: RASTER_ERFOLG.breiten,
        spaltenAbstand: RASTER_ERFOLG.spaltenAbstand,
        linksBis: 0,
        zeilen: ergebnisZeilen,
      },
    ],
    hinweis: 'Der Werkerlös ist der Verkaufserlös der Einheiten abzüglich des '
      + `Landanteils, den der Landprovider verrechnet (${chf(verkaufserloes)} − `
      + `${chf(ksDoc.landprovider.ertrag)} CHF). Die Kosten des `
      + 'Totalunternehmers stehen nach BKP-Hauptgruppen; die Positionen dazu '
      + 'führt das Kapitel Anlagekosten. Die Rendite bezieht den Gewinn nach '
      + 'Steuern auf das eingebrachte Eigenkapital, ohne Rücksicht auf die Dauer — '
      + 'die zeitliche Betrachtung steht in der Mittelflussrechnung.',
  })

  return {
    mehrereSichten: false,
    // Die Abschnitte tragen Nummern — „7.1 Kapitalstruktur und
    // Gewinnbeteiligung" und so fort. Die Kapitelnummer kommt vom Bericht.
    nummeriert: true,
    sichten: [{ titel: 'Gesamtprojekt', gesamt: true, bereiche }],
  }
}

