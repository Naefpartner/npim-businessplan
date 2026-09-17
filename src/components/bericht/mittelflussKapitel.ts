// Satz des Berichtskapitels „Mittelflussrechnung" — nur Layout, keine
// Datenbeschaffung. Getrennt, damit sich das Kapitel mit Probezahlen rendern
// und nachmessen lässt, ohne Datenbank und ohne React.

import { monatAdd, type MfPhase, type MfQuartal, type MfVerkauf } from '@/lib/mittelfluss'
import type { FinanzierungsReihe, ReihenKennzahlen } from '@/lib/irr'
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
        jahrZeile('Finanzierungstranchen', z.tranchen, 'summe'),
        jahrZeile('Saldo Fremdkapital, Stand am Jahresende', z.fin.schuld, 'stand'),
        jahrZeile('Beanspruchtes Eigenkapital, Stand am Jahresende',
          z.fin.beanspruchtesEk, 'stand'),
        jahrZeile('Zahlungsfluss Eigenkapital', z.fin.ekFluss, 'summe', true),
      ],
    }],
    hinweis: 'Zahlungen sind je Jahr summiert, Stände am Jahresende abgelesen; die '
      + 'Spalte rechts führt deshalb bei Zahlungen die Summe über die ganze '
      + 'Betrachtung und bei Ständen den Wert an deren Ende. Gerechnet wird auf '
      + 'Quartalen. Der Saldo ist der aufgelaufene Überschuss der Verkaufserlöse '
      + 'über die Anlagekosten; das beanspruchte Eigenkapital ist der Saldo '
      + 'abzüglich des aufgenommenen Fremdkapitals, der Zahlungsfluss Eigenkapital '
      + 'dessen Veränderung — wächst die Beanspruchung, fliesst Geld ab. Die Kosten '
      + 'stammen aus der Anlagekostenberechnung der gewählten Methode'
      + (z.aufHauptgruppen ? ' und sind auf BKP-Hauptgruppen verteilt' : '')
      + `, die Verkaufserlöse aus den Mengen und Erträgen (${VERKAUF_TEXT[z.verkaufModell]}), `
      + 'die Gewinnsteuern aus dem Kapitel Kapital und Steuern; die Planerhonorare '
      + 'folgen den SIA-Phasen des Terminplans.',
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

