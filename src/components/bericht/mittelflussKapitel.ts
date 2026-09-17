// Satz des Berichtskapitels „Mittelflussrechnung" — nur Layout, keine
// Datenbeschaffung. Getrennt, damit sich das Kapitel mit Probezahlen rendern
// und nachmessen lässt, ohne Datenbank und ohne React.

import { monatAdd, type MfPhase, type MfQuartal, type MfVerkauf } from '@/lib/mittelfluss'
import type { FinanzierungsReihe, ReihenKennzahlen } from '@/lib/irr'
import { formatNumber } from '@/lib/utils'
import { BERICHT_FARBE } from '@/lib/bericht'
import type {
  BereichsKapitelDaten, KapitelBereich, KapitelTabelle, TabellenZeile,
} from '@/components/bericht/BerichtDokument'

/**
 * Raster der Zahlungsreihe: links das Quartal, danach zehn Wertspalten. Die
 * Tabelle steht auf A3 hoch — auf A4 wären die Spalten zu schmal für
 * Millionenbeträge, und getrennt gesetzt liessen sich die Reihen nicht Zeile
 * für Zeile gegeneinander lesen.
 */
const RASTER_REIHE = { breiten: [24, ...Array<number>(9).fill(23)], spaltenAbstand: 2 }

/** Raster der Jahresübersicht: Position, je Jahr eine Spalte, rechts der Abschluss. */
function rasterJahre(anzahl: number): { breiten: number[]; spaltenAbstand: number } {
  return { breiten: [70, ...Array<number>(anzahl).fill(21), 23], spaltenAbstand: 3 }
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

const MONAT_LANG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

/** Monat als „Januar 2027". */
function monatText(s: string): string {
  const [jahr, monat] = s.split('-')
  return `${MONAT_LANG[Number(monat) - 1] ?? monat} ${jahr}`
}

const VERKAUF_TEXT: Record<MfVerkauf['modell'], string> = {
  uebergabe: 'vollständig bei Übergabe',
  baufortschritt: 'nach Baufortschritt',
  frei: 'frei erfasst je Quartal',
  objekte: 'je Verkaufseinheit erfasst',
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
  startMonat: string
  endMonat: string
  fremdZinssatz: number
  verkaufModell: MfVerkauf['modell']
  aufHauptgruppen: boolean
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
  kEigen: ReihenKennzahlen
  /** Barwerte der Eigenkapitalreihe; null, wo es keinen Zinsfuss gibt. */
  barwerte: number[] | null
}

/**
 * Satz des Kapitels „Mittelflussrechnung": Terminplan und Annahmen, der
 * Mittelfluss je Jahr, die Zahlungsreihe je Quartal und die Kennzahlen daraus.
 *
 * Für die Bank in dieser Reihenfolge: zuerst die Annahmen, dann die Übersicht,
 * dann der Nachweis Quartal für Quartal — die Barwertspalte am rechten Rand
 * summiert sich auf null und belegt damit den ausgewiesenen Zinsfuss.
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

  // ── Terminplan und Annahmen ───────────────────────────────────────────────
  const tabellen: KapitelTabelle[] = []
  if (z.phasen.length > 0) {
    tabellen.push({
      titel: 'Terminplan',
      kopf: ['Phase', 'Beginn', 'Dauer', 'Ende'],
      breiten: [76, 32, 20, 32],
      linksBis: 1,
      zeilen: z.phasen.map((p) => ({
        zellen: [
          p.label,
          monatText(p.startMonat),
          `${p.dauerMonate} Mte`,
          monatText(monatAdd(p.startMonat, Math.max(1, p.dauerMonate) - 1)),
        ],
      })),
    })
  }
  tabellen.push({
    titel: 'Annahmen der Rechnung',
    kopf: ['Grösse', 'Wert'],
    breiten: [76, 84],
    linksBis: 1,
    zeilen: [
      { zellen: ['Betrachtungsbeginn', monatText(z.startMonat)] },
      {
        zellen: ['Betrachtungsende',
          `${monatText(z.endMonat)} — zwei Quartale nach dem letzten Termineintrag`],
      },
      {
        zellen: ['Finanzierungssatz',
          `${z.fremdZinssatz.toFixed(2)} % pro Jahr — Bezug des modifizierten Zinsfusses`],
      },
      {
        zellen: ['Ebene der Kostenverteilung',
          z.aufHauptgruppen ? 'BKP-Hauptgruppen' : 'einzelne Kostenpositionen'],
      },
      { zellen: ['Verteilung der Verkaufserlöse', VERKAUF_TEXT[z.verkaufModell]] },
      { zellen: ['Anzahl Quartale', `${z.quartale.length}`] },
    ],
  })
  bereiche.push({
    titel: '',
    ...farben,
    tabellen,
    hinweis: 'Die Kosten stammen aus der Anlagekostenberechnung der gewählten Methode, '
      + 'die Verkaufserlöse aus den Mengen und Erträgen, die Gewinnsteuern aus dem '
      + 'Kapitel Kapital und Steuern. Die Planerhonorare folgen den SIA-Phasen des '
      + 'Terminplans; die übrige zeitliche Verteilung ist je Position erfasst.',
  })

  // ── Mittelfluss je Jahr ───────────────────────────────────────────────────
  const jahre = [...new Set(z.quartale.map((q) => q.jahr))]
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
      ...rasterJahre(jahre.length),
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
        jahrZeile('Finanzierungstranchen', z.tranchen, 'summe'),
        jahrZeile('Saldo Fremdkapital, Stand am Jahresende', z.fin.schuld, 'stand'),
        jahrZeile('Beanspruchtes Eigenkapital, Stand am Jahresende',
          z.fin.beanspruchtesEk, 'stand'),
        jahrZeile('Zahlungsfluss Eigenkapital', z.fin.ekFluss, 'summe', true),
      ],
    }],
    hinweis: 'Zahlungen sind je Jahr summiert, Stände am Jahresende abgelesen. Die '
      + 'Spalte rechts führt deshalb bei Zahlungen die Summe über die ganze '
      + 'Betrachtung und bei Ständen den Wert an deren Ende.',
  })

  // ── Zahlungsreihe je Quartal ──────────────────────────────────────────────
  const zeilen: TabellenZeile[] = z.quartale.map((q, i) => ({
    zellen: [
      `${q.jahr} Q${q.q}`,
      chf(z.kosten[i] ?? 0),
      chf(z.erloese[i] ?? 0),
      chf(z.kumSaldo[i] ?? 0),
      chf(z.ek[i] ?? 0),
      chf(z.tranchen[i] ?? 0),
      chf(z.fin.schuld[i] ?? 0),
      chf(z.fin.beanspruchtesEk[i] ?? 0),
      chf(z.fin.ekFluss[i] ?? 0),
      z.barwerte ? chf(z.barwerte[i] ?? 0) : '—',
    ],
  }))
  zeilen.push({
    zellen: [
      'Total',
      chf0(z.kosten.reduce((s, v) => s + v, 0)),
      chf0(z.erloese.reduce((s, v) => s + v, 0)),
      chf0(z.kumSaldo[z.kumSaldo.length - 1] ?? 0),
      chf0(z.ek.reduce((s, v) => s + v, 0)),
      chf0(z.tranchen.reduce((s, v) => s + v, 0)),
      chf0(z.fin.schuld[z.fin.schuld.length - 1] ?? 0),
      chf0(z.fin.beanspruchtesEk[z.fin.beanspruchtesEk.length - 1] ?? 0),
      chf0(z.fin.ekFluss.reduce((s, v) => s + v, 0)),
      z.barwerte ? chf0(z.barwerte.reduce((s, v) => s + v, 0)) : '—',
    ],
    total: true,
  })
  bereiche.push({
    titel: '',
    ...farben,
    tabellen: [{
      titel: 'Zahlungsreihe je Quartal, in CHF',
      kopf: ['Quartal', 'Anlagekosten inkl. MWST', 'Verkaufserlöse', 'Saldo kumuliert',
        'Eingebrachtes Eigenkapital', 'Tranchen Fremdkapital', 'Saldo Fremdkapital',
        'Beanspruchtes Eigenkapital', 'Zahlungsfluss Eigenkapital', 'Barwert'],
      ...RASTER_REIHE,
      linksBis: 0,
      zeilen,
    }],
    hinweis: 'Saldo kumuliert = Verkaufserlöse abzüglich Anlagekosten inklusive '
      + 'Mehrwertsteuer und Gewinnsteuern, aufgelaufen; die Bauzinsen stehen als '
      + 'Positionen in den Eigentümerkosten und sind darin enthalten. '
      + 'Beanspruchtes Eigenkapital = Saldo abzüglich Fremdkapitalsaldo; der '
      + 'Zahlungsfluss Eigenkapital ist dessen Veränderung von Quartal zu Quartal — '
      + 'wächst die Beanspruchung, fliesst Geld ab. '
      + (z.barwerte
        ? 'Die Barwerte sind zum ausgewiesenen Zinsfuss des Eigenkapitals über die '
          + 'tatsächlichen Tage abgezinst; ihre Summe ist null, und genau das ist die '
          + 'Probe der Zinsfussrechnung.'
        : 'Ein interner Zinsfuss lässt sich aus dieser Reihe nicht ermitteln — die '
          + 'Barwertspalte bleibt deshalb leer.'),
  })

  // ── Kennzahlen ────────────────────────────────────────────────────────────
  const zinsfuss = (k: ReihenKennzahlen): string => (
    k.xirrJahr != null ? pct(k.xirrJahr)
      : k.irrJahr != null ? pct(k.irrJahr)
        : k.mirrJahr != null ? `${pct(k.mirrJahr)} (mod.)`
          : '—')
  const beIdx = z.kProjekt.breakEven
  const breakEven = beIdx != null && z.quartale[beIdx]
    ? `${z.quartale[beIdx].jahr} Q${z.quartale[beIdx].q}`
    : '—'
  const spitzeEk = z.fin.beanspruchtesEk.reduce((m, v) => Math.max(m, v), 0)
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
          zellen: ['Interner Zinsfuss Projekt',
            'auf dem Gesamtkapital, Bauzinsen in den Anlagekosten enthalten',
            zinsfuss(z.kProjekt)],
          total: true,
        },
        {
          zellen: ['Interner Zinsfuss Eigenkapital',
            `auf dem beanspruchten Eigenkapital, Spitze ${chf0(spitzeEk)} CHF`,
            zinsfuss(z.kEigen)],
          total: true,
        },
        {
          zellen: ['Modifizierter Zinsfuss Eigenkapital',
            `Fehlbeträge und Überschüsse zu ${z.fremdZinssatz.toFixed(2)} % p. a.`,
            pct(z.kEigen.mirrJahr)],
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
          zellen: ['Eingebrachtes Eigenkapital', 'erfasste Einlagen, CHF',
            chf0(z.ek.reduce((s, v) => s + v, 0))],
        },
      ],
    }],
    hinweis: 'Der interne Zinsfuss ist der Jahressatz, der die Summe der Barwerte auf '
      + 'null stellt — gerechnet über die tatsächlichen Tage, 365 Tage je Jahr, wie '
      + 'XINTZINSFUSS. Wechselt die Zahlungsreihe mehrfach das Vorzeichen, ist er '
      + 'nicht eindeutig; dann trägt der modifizierte Zinsfuss die Aussage, der '
      + 'Fehlbeträge und Überschüsse zum Finanzierungssatz verzinst.',
  })

  return {
    mehrereSichten: false,
    sichten: [{ titel: 'Gesamtprojekt', gesamt: true, bereiche }],
  }
}

