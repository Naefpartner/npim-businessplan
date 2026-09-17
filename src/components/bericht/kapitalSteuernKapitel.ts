// Satz des Berichtskapitels „Kapital und Steuern" — nur Layout, keine
// Datenbeschaffung. Getrennt, damit sich das Kapitel mit Probezahlen rendern
// und nachmessen lässt, ohne Datenbank und ohne React.

import {
  berechneKapital, kapitalSteuernErgebnis, zeilenBetrag,
  type KapitalSteuernDoc, type KsGesellschaft, type KsGesellschaftErgebnis,
  type KsKostenZeile,
} from '@/lib/kapitalSteuern'
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

/** Raster der Kapitaltabelle: Investor, Einlage, Anteile, Zins, Gewinn. */
const RASTER_KAPITAL = { breiten: [62, 26, 16, 20, 16, 26], spaltenAbstand: 3 }

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
}

/**
 * Satz des Kapitels „Kapital und Steuern": wer das Kapital einbringt, und wie
 * sich Landprovider und Totalunternehmer Kosten, Gewinn und Steuern teilen.
 *
 * Die Erfolgsrechnungen stehen in derselben Reihenfolge wie im Reiter der
 * Variante — wer beides nebeneinander legt, findet jede Zahl wieder.
 */
export function kapitalSteuernKapitel(
  { doc: ksDoc, betraege, landpreis, verkaufserloes, mehrereEig }: KsKapitelZahlen,
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
  function erfolgsTabelle(
    titel: string, g: KsGesellschaft, e: KsGesellschaftErgebnis,
    erloesLabel: string, erloes: number, steuerLabel: string,
  ): KapitelTabelle {
    const zeilen: TabellenZeile[] = [
      { zellen: [erloesLabel, '', chf(erloes), anteil(erloes)], total: true },
    ]
    if (g.landkosten.length > 0) {
      zeilen.push({ zellen: ['Landkosten und deren Finanzierung', '', '', ''] })
      for (const z of g.landkosten) zeilen.push(kostenZeile(z))
    }
    if (g.anlagekosten.length > 0) {
      zeilen.push({ zellen: ['Anlagekosten', '', '', ''] })
      for (const z of g.anlagekosten) zeilen.push(kostenZeile(z))
    }
    zeilen.push({
      zellen: ['Kosten total', '', kostenBetrag(e.kostenTotal),
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
  if (kapital.investoren.length > 0) {
    const zeilen: TabellenZeile[] = kapital.investoren.map((inv) => ({
      zellen: [
        inv.name || 'Investor',
        chf(inv.kapital),
        pct(inv.kapitalAnteil),
        pct(inv.gewinnAnteil),
        inv.zinssatzPct > 0 ? `${inv.zinssatzPct.toFixed(2)} %` : '—',
        chf(inv.gewinnAnteilChf),
      ],
    }))
    zeilen.push({
      zellen: [
        'Total', chf(kapital.kapitalTotal), pct(1), pct(kapital.gewinnAnteilTotal),
        kapital.zinsProJahrTotal > 0 ? chf(kapital.zinsProJahrTotal) : '—',
        chf(gewinnNachSteuernTotal),
      ],
      total: true,
    })
    bereiche.push({
      titel: mehrereEig ? 'Kapitalstruktur' : '',
      ...farben,
      tabellen: [{
        titel: 'Kapitalstruktur und Gewinnverteilung',
        kopf: ['Investor', 'Einlage CHF', 'Anteil', 'Gewinnanteil', 'Verzinsung',
          'Gewinn nach Steuern'],
        breiten: RASTER_KAPITAL.breiten,
        spaltenAbstand: RASTER_KAPITAL.spaltenAbstand,
        linksBis: 0,
        zeilen,
      }],
      hinweis: 'Ohne eigenen Gewinnanteil gilt der Anteil am eingebrachten Kapital. '
        + 'Die Verzinsung ist der Satz auf der Einlage; in der Spalte Total steht '
        + 'der Zins aller Einlagen pro Jahr.',
    })
  }

  // ── Die beiden Gesellschaften ────────────────────────────────────────────
  bereiche.push({
    titel: mehrereEig ? 'Gesellschaften' : '',
    ...farben,
    tabellen: [
      erfolgsTabelle(
        `${ksDoc.landprovider.name} · Landprovider`, ksDoc.landprovider, lp,
        'Verkaufserlös Land', ksDoc.landprovider.ertrag, 'Grundstückgewinnsteuer'),
      erfolgsTabelle(
        `${ksDoc.totalunternehmer.name} · Totalunternehmer`, ksDoc.totalunternehmer, tu,
        'Verkaufserlös Werk', werkerloes, 'Gewinnsteuer Totalunternehmer'),
    ],
    hinweis: 'Der Landprovider bringt das Grundstück ein und verkauft es an den '
      + 'Totalunternehmer; dessen Werkerlös ist der Verkaufserlös der Einheiten '
      + `abzüglich dieses Landanteils (${chf(verkaufserloes)} − `
      + `${chf(ksDoc.landprovider.ertrag)} CHF). Übernommene Kostenpositionen `
      + 'stammen aus der Anlagekostenberechnung der gewählten Methode, '
      + 'Anteilszeilen rechnen auf dem Landpreis.',
  })

  // ── Ergebnis ─────────────────────────────────────────────────────────────
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
      zellen: ['Gewinn nach Steuern je Franken Eigenkapital',
        pct(gewinnNachSteuernTotal / kapital.kapitalTotal, 1), '', ''],
      total: true,
    })
  }
  bereiche.push({
    titel: mehrereEig ? 'Ergebnis' : '',
    ...farben,
    tabellen: [{
      titel: 'Ergebnis der beiden Gesellschaften',
      kopf: ['Position', 'Ansatz', 'CHF', '% Erlös'],
      breiten: RASTER_ERFOLG.breiten,
      spaltenAbstand: RASTER_ERFOLG.spaltenAbstand,
      linksBis: 0,
      zeilen: ergebnisZeilen,
    }],
    hinweis: 'Die Rendite bezieht den Gewinn nach Steuern auf das eingebrachte '
      + 'Eigenkapital, ohne Rücksicht auf die Dauer; die zeitliche Betrachtung '
      + 'steht im Kapitel Mittelflussrechnung.',
  })

  return {
    mehrereSichten: false,
    sichten: [{ titel: 'Gesamtprojekt', gesamt: true, bereiche }],
  }
}

