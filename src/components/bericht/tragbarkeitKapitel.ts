// Satz des Berichtskapitels „Tragbarkeit" — nur Layout, keine
// Datenbeschaffung. Die Zahlen kommen aus rechneTragbarkeit(), derselben
// Rechnung wie im Reiter der Variante.

import { formatNumber } from '@/lib/utils'
import { BERICHT_FARBE } from '@/lib/bericht'
import { kapSatzAus, type TragbarkeitJahr } from '@/lib/tragbarkeit'
import type { TragbarkeitRechnung } from '@/lib/tragbarkeitRechnung'
import { EIGENTUMSART_COLOR, USE_TYPE_COLOR_1, USE_TYPE_COLOR_3 } from '@/lib/kategorieFarben'
import type {
  BereichsKapitelDaten, KapitelTabelle, TabellenZeile,
} from '@/components/bericht/BerichtDokument'

const EIG = 'renditeobjekt' as const

/** Betrag in Franken, gerundet; Minus als U+2212 wie in den übrigen Kapiteln. */
function chf(v: number): string {
  // „+ 0“ macht aus −0 eine Null — sonst stünde „-0“ in der Spalte.
  const g = Math.round(Number.isFinite(v) ? v : 0) + 0
  return g < 0 ? `−${formatNumber(-g)}` : formatNumber(g)
}

/** Satz als Zahl in Prozent, ohne Zeichen — das % steht in der Einheitenspalte,
 *  damit die Zahlen rechtsbündig unter den Frankenbeträgen fluchten. */
function satz(v: number, stellen = 1): string {
  const z = (Math.abs(v) * 100).toFixed(stellen)
  return `${v < 0 ? '−' : ''}${z}`
}

/*
 * Raster der Übersicht: drei Blöcke nebeneinander — Grundlagen, Annahmen,
 * Kontrolle —, je Bezeichnung, Wert und Einheit. Die Bezeichnungen der
 * Blöcke zwei und drei laufen als „Einheitenspalten", damit sie linksbündig
 * stehen; die breiteren Einheitenspalten davor halten den Abstand zwischen
 * den Blöcken.
 */
const UEBERSICHT_BREITEN = [34, 17, 12, 30, 12, 10, 34, 17, 6]

/**
 * Jahre, die der Verlauf im Bericht zeigt. Auf A4 quer haben gut zehn
 * Spalten mit Millionenbeträgen Platz; bei langer Laufzeit stehen die ersten
 * fünf Jahre einzeln (dort ändern sich Leerstand und Kosten), danach jedes
 * fünfte bzw. ab 20 Jahren jedes zehnte und das letzte. Die beiden Schlussspalten nach der Laufzeit stehen immer da.
 */
export function berichtsJahre(jahre: number): number[] {
  if (jahre <= 10) return Array.from({ length: jahre }, (_, i) => i + 1)
  const aus = [1, 2, 3, 4, 5]
  const schritt = jahre > 20 ? 10 : 5
  for (let j = schritt; j < jahre; j += schritt) if (j > 5) aus.push(j)
  aus.push(jahre)
  return aus
}

export function tragbarkeitKapitel(r: TragbarkeitRechnung, mehrereEig: boolean): BereichsKapitelDaten {
  // Farbsystematik wie bei Kapital und Steuern: Kupfer, solange nur eine
  // Eigentumsart vorkommt, sonst die Farbe der Renditeobjekte.
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

  const g = r.eff
  const a = r.ann
  const k = r.erg.kontrolle
  // Hypotheken zu Beginn, wie der Verlauf sie ansetzt.
  const erste = r.verlauf[0]?.ersteHypothek ?? 0
  const zweite = r.verlauf[0]?.zweiteHypothek ?? 0

  // ── Übersicht: Grundlagen | Annahmen | Kontrolle ─────────────────────────
  const block = (l: string, w: string, e: string) => [l, w, e]
  const zeilen: TabellenZeile[] = [
    [block('Mietertrag SOLL', chf(g.mietertrag), 'CHF/a'),
      block('Hypothekarzins effektiv', satz(a.hypozins, 2), '%'),
      block('Nötiges Fremdkapital', chf(k.noetigesFremdkapital), 'CHF')],
    [block('Ertragswert', chf(g.ertragswert), 'CHF'),
      block('Tragbarkeitszinssatz', satz(a.tragbarkeitszins, 2), '%'),
      block('davon 1. Hypothek', chf(erste), 'CHF')],
    [block('Kapitalisierungssatz', satz(kapSatzAus(r.basis), 2), '%'),
      block('Max. 1. Hypothek', satz(a.max1, 0), '%'),
      block('davon 2. Hypothek', chf(zweite), 'CHF')],
    [block('Anlagekosten inkl. MWST', chf(g.anlagekosten), 'CHF'),
      block('Max. Hypothek total', satz(a.max2, 0), '%'),
      block('Maximal mögliche Belehnung', chf(k.maximaleBelehnung), 'CHF')],
    [block('', '', ''),
      block('Dauer Amortisation', formatNumber(a.amortisationsdauer), 'Jahre'),
      block('Belehnung', satz(g.ertragswert > 0 ? k.noetigesFremdkapital / g.ertragswert : 0, 1), '%')],
    [block('', '', ''),
      block('Zusätzliche Eigenmittel', chf(a.zusaetzlicheEigenmittel), 'CHF'),
      block(k.tragbar ? 'Spielraum' : 'Fehlbetrag', chf(Math.abs(k.spielraum)), 'CHF')],
  ].map((z) => ({ zellen: z.flat() }))
  // Die Schlusszeile trägt das Ergebnis — sie wird hervorgehoben.
  zeilen[zeilen.length - 1].total = true

  const uebersicht: KapitelTabelle = {
    titel: r.aktiv
      ? 'Grundlagen, Annahmen und Kontrolle — gerechnet mit den Schieberwerten'
      : 'Grundlagen, Annahmen und Kontrolle',
    kopf: ['Grundlagen', '', '', 'Annahmen', '', '', 'Kontrolle in Franken', '', ''],
    breiten: UEBERSICHT_BREITEN,
    linksBis: 0,
    einheitenSpalten: [2, 3, 5, 6, 8],
    zeilen,
  }

  // ── Verlauf über die Laufzeit ───────────────────────────────────────────
  const n = r.verlauf.length
  const laufzeit = r.verlauf.slice(0, n - 2)
  const zeigen = new Set(berichtsJahre(laufzeit.length))
  const spalten: TragbarkeitJahr[] = [
    ...laufzeit.filter((j) => zeigen.has(j.jahr)),
    ...r.verlauf.slice(n - 2),
  ]
  const reihe = (label: string, wert: (j: TragbarkeitJahr) => number, total = false): TabellenZeile => ({
    zellen: [label, ...spalten.map((j) => chf(wert(j)))],
    total,
  })
  const verlauf: KapitelTabelle = {
    titel: 'Erfolgsrechnung während Amortisationszeit',
    /*
     * Einzeiliger Kopf: ein gestapelter rechnet das Umbruchmodell so hoch, dass
     * die letzte Zeile auf eine zweite Seite fiele. Die Sätze der beiden
     * Schlussspalten stehen in der Übersicht.
     */
    kopf: ['CHF', ...spalten.map((j, i) => (i < spalten.length - 2 ? j.kurz : i === spalten.length - 2 ? `kalk J${j.jahr}` : `eff J${j.jahr}`))],
    breiten: [26, ...spalten.map(() => 12)],
    spaltenAbstand: 2,
    linksBis: 0,
    zeilen: [
      reihe('Mietertrag SOLL', (j) => j.mietertragSoll),
      reihe('Leerstand', (j) => -j.ertragsausfall),
      reihe('Betriebskosten', (j) => -j.betriebskosten),
      reihe('Unterhaltskosten', (j) => -j.unterhalt),
      reihe('Liegenschaftserfolg', (j) => j.liegenschaftserfolg, true),
      reihe('Zinsen', (j) => -(j.zinsErste + j.zinsZweite)),
      reihe('Amortisation', (j) => -j.amortisation),
      reihe('Überschuss', (j) => j.ueberschuss, true),
      // Stand der Hypotheken zu Beginn des Jahres und ihre Summe.
      reihe('1. Hypothek', (j) => j.ersteHypothek),
      reihe('2. Hypothek', (j) => j.zweiteHypothek),
      reihe('Fremdkapital', (j) => j.fremdkapital),
    ],
  }


  return {
    mehrereSichten: false,
    sichten: [{
      titel: 'Gesamtprojekt',
      gesamt: true,
      bereiche: [{ titel: '', ...farben, tabellen: [uebersicht, verlauf] }],
    }],
  }
}
