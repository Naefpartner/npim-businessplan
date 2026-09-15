import { useMemo } from 'react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { useKostenmiete } from '@/hooks/useKostenmiete'
import { useRendite } from '@/hooks/useRendite'
import { useWbfZh } from '@/hooks/useWbfZh'
import {
  basisFromErgebnis, berechneKostenmiete, kostenmieteMatrix, sammleKostenmieteMengen,
  SENS_SCHRITTE,
} from '@/lib/kostenmiete'
import {
  berechneRendite, investitionAusErgebnis, sammleRenditeMengen,
} from '@/lib/rendite'
import { buildUnits, wohnungsmieten } from '@/lib/mengenAnalyse'
import { ertragProNutzung } from '@/lib/bkpBlocks'
import {
  EIGENTUMSART_COLOR, USE_TYPE_COLOR_3, USE_TYPE_COLOR_1,
} from '@/lib/kategorieFarben'
import { eigentumsartForBuilding } from '@/types'
import { formatNumber } from '@/lib/utils'
import {
  BERICHT_FARBE, RASTER_HERLEITUNG_ANTEIL, RASTER_MATRIX, rasterAufMatrix,
  type EtappenUmfang,
} from '@/lib/bericht'
import type {
  BereichsKapitelDaten, KapitelBereich, KapitelTabelle, TabellenZeile,
} from '@/components/bericht/BerichtDokument'

/** Betrag in Franken, gerundet. */
function chf(v: number): string {
  return formatNumber(Math.round(v))
}

/** Abzug — das Minus steht vor der Zahl, wie in der Sektion. */
function abzug(v: number): string {
  return v === 0 ? '—' : `− ${chf(v)}`
}

function pct(v: number, stellen = 1): string {
  return `${pctZahl(v, stellen)} %`
}

/** Prozentsatz ohne Zeichen — für Zellen, deren Einheit daneben steht. */
function pctZahl(v: number, stellen = 1): string {
  return (v * 100).toFixed(stellen)
}

/**
 * Zahl und Einheit in einer Zelle, verbunden durch ein geschütztes
 * Leerzeichen — die Spalten sind so schmal wie die der Sensitivitätstafel, und
 * eine eigene Einheitenspalte fände darin keinen Platz. Lange Einheiten dürfen
 * umbrechen, sonst liefen sie über die Spalte hinaus.
 */
function mitEinheit(wert: string, einheit: string): string {
  if (!wert || !einheit) return wert
  return `${wert}${einheit.length > 7 ? ' ' : '\u00A0'}${einheit}`
}

/**
 * Eine Zeile im Raster der Herleitung: Menge × Ansatz ergibt den Betrag.
 * Zwischenschritte tragen ihr Ergebnis in der vorletzten Spalte und werden von
 * der nächsten Zeile weitergerechnet.
 */
function herleitung(
  label: string, menge: string, mengeEinheit: string,
  ansatz: string, ansatzEinheit: string, betrag: string, zwischen?: string,
): TabellenZeile {
  return {
    zellen: [
      label, mitEinheit(menge, mengeEinheit), mitEinheit(ansatz, ansatzEinheit),
      ...(zwischen == null ? [] : [zwischen]), betrag,
    ],
  }
}

/** Abweichung einer Sensitivitätsstufe — der Basisfall heisst „Basis". */
function abweichung(schritt: number): string {
  if (schritt === 0) return 'Basis'
  return `${schritt > 0 ? '+' : '−'}${Math.abs(schritt * 100).toFixed(0)} %`
}

/**
 * Stellt das Kapitel „Wirtschaftlichkeit" zusammen: je Eigentumsart der
 * Bereich, den auch der Reiter der Variante zeigt — Kostenmiete für die
 * Genossenschaft, Rendite oder Residualwert für die Renditeobjekte, den
 * Verkaufsgewinn für das Stockwerkeigentum.
 *
 * Gerechnet wird mit denselben Funktionen wie in den Sektionen; die Parameter
 * kommen aus der Variante. Was dort eingestellt ist — die Betrachtung der
 * Renditeobjekte etwa —, steht auch so im Bericht.
 */
export function useWirtschaftlichkeitDaten(
  variantId: string | undefined,
  umfang: EtappenUmfang,
  /** Ausgewählte Etappen; leer heisst alle. */
  etappenAuswahl: string[] = [],
): BereichsKapitelDaten | undefined {
  const ak = useAnlagekostenShared()
  const { params: kmParams } = useKostenmiete(variantId ?? '')
  const { params: rParams } = useRendite(variantId ?? '')
  const { params: wbf } = useWbfZh(variantId ?? '')

  return useMemo(() => {
    if (ak.presentEig.length === 0) return undefined

    /**
     * Kopf und Farben eines Bereichs. Kommt nur eine Eigentumsart vor, nennt
     * ein Balken „Kostenmiete (Genossenschaft)" nichts, was nicht schon
     * feststeht: er fällt weg, die Tabellen rücken an seine Stelle und tragen
     * die Kupferfarbe. Bei mehreren führt jeder Bereich seinen Balken in der
     * Farbe seiner Eigentumsart, die Tabellen eine Stufe heller.
     */
    const mehrereEig = ak.presentEig.length > 1
    function bereich(
      titel: string, eig: 'genossenschaft' | 'renditeobjekt' | 'verkaufsobjekt',
    ) {
      return mehrereEig
        ? {
          titel,
          farbe: EIGENTUMSART_COLOR[eig],
          tabellenFarbe: USE_TYPE_COLOR_3[eig],
          totalFarbe: USE_TYPE_COLOR_1[eig],
          zelleFarbe: USE_TYPE_COLOR_3[eig],
        }
        : {
          titel: '',
          farbe: BERICHT_FARBE.primaer,
          tabellenFarbe: BERICHT_FARBE.primaer,
          totalFarbe: BERICHT_FARBE.primaerZart,
          zelleFarbe: BERICHT_FARBE.primaerHell,
        }
    }

    /** Kostenergebnis einer Eigentumsart in der Sicht. */
    function ergebnis(eig: 'genossenschaft' | 'renditeobjekt' | 'verkaufsobjekt',
      etappeId: string | null) {
      return etappeId == null
        ? ak.konsolidiertEffektiv.get(eig)
        : ak.blockErgebnisseEffektiv.get(`${etappeId}::${eig}`)
    }

    // ── Kostenmiete (Genossenschaft) ─────────────────────────────────────────
    function kostenmiete(etappeId: string | null): KapitelBereich | null {
      const erg = ergebnis('genossenschaft', etappeId)
      if (!erg) return null
      const { vmf, wohnenFlaeche, wohnungen, ertragsNutzungen } =
        sammleKostenmieteMengen(ak.buildings, etappeId)
      const basis = basisFromErgebnis(erg, vmf, wohnenFlaeche, wohnungen)
      const r = berechneKostenmiete(basis, kmParams, ertragsNutzungen)

      /** Zeile dieser Tabelle — mit Spalte für Zwischenwerte. */
      const zeile = (
        label: string, menge: string, mengeEinheit: string,
        ansatz: string, ansatzEinheit: string, betrag: string, zwischen = '',
      ) => herleitung(label, menge, mengeEinheit, ansatz, ansatzEinheit, betrag, zwischen)

      const betragVon = (key: string) => r.posten.find((p) => p.key === key)?.betrag ?? 0

      const zeilen: TabellenZeile[] = [
        zeile('Verzinsung Erstellungskosten', chf(basis.erstellungBrutto), '',
          pctZahl(kmParams.referenzzinssatz, 2), '%', chf(betragVon('verz_erstellung'))),
      ]

      if (!kmParams.imBaurecht) {
        zeilen.push(zeile('Verzinsung Grundstück', chf(basis.grundstueckBrutto), '',
          pctZahl(kmParams.referenzzinssatz, 2), '%', chf(betragVon('verz_grundstueck'))))
      } else {
        // Je Kategorie zuerst der anteilige Kostenblock, darauf der Zins —
        // die beiden Schritte stehen einzeln da, statt in einer Zelle.
        const baurecht = (
          kategorie: string, z: typeof kmParams.baurechtSubv, key: string,
        ) => {
          if (z.modus === 'chf') {
            zeilen.push(zeile(`Baurechtszins ${kategorie} (Pauschale)`,
              pct(z.anteil), 'Anteil', '', '', chf(betragVon(key))))
            return
          }
          const anteilig = basis.erstellungBrutto * z.anteil
          zeilen.push(zeile(`Anteil ${kategorie}`,
            chf(basis.erstellungBrutto), '', pctZahl(z.anteil), '%', '', chf(anteilig)))
          zeilen.push(zeile(`Baurechtszins ${kategorie}`, chf(anteilig), '',
            pctZahl(kmParams.baurechtZins, 2), '%', chf(betragVon(key))))
        }
        baurecht('subventionierte Wohnungen', kmParams.baurechtSubv, 'baurecht_subv')
        baurecht('nicht subventionierte Wohnungen',
          kmParams.baurechtNichtSubv, 'baurecht_nsubv')
      }

      // Der Gebäudeversicherungswert ist der Zwischenschritt der
      // Betriebskosten; als Zelle in der Betriebskostenzeile stünde eine
      // Rechnung in der Rechnung.
      const gvw = basis.erstellungBrutto * kmParams.gvwFaktor
      zeilen.push(zeile('Gebäudeversicherungswert GVW', chf(basis.erstellungBrutto), '',
        pctZahl(kmParams.gvwFaktor), '%', '', chf(gvw)))
      zeilen.push(zeile('Betriebskosten', chf(gvw), '',
        pctZahl(kmParams.betriebskostenSatz, 2), '%', chf(betragVon('betriebskosten'))))

      zeilen.push({
        total: true,
        zellen: ['Maximale Mieterträge', '', '', '', chf(r.maxMieterertrag)],
      })

      for (const e of r.ertragsNutzungen) {
        const flaeche = e.basis === 'flaeche'
        zeilen.push(zeile(
          // Wohnen ist der Residualwert der Rechnung und wird nicht abgezogen —
          // ohne den Zusatz sähe die Zeile wie ein vergessener Abzug aus.
          e.istWohnen ? `${e.nutzung} (Residual)` : e.nutzung,
          formatNumber(flaeche ? e.flaeche : e.anzahl), flaeche ? 'm² VMF' : 'Stk',
          // Flächen als Jahresmiete je Quadratmeter, Stückzahlen als
          // Monatsmiete je Einheit — so, wie sie in den Mengen erfasst sind.
          flaeche
            ? formatNumber(e.flaeche > 0 ? e.ertragJahr / e.flaeche : 0)
            : formatNumber(e.anzahl > 0 ? e.ertragJahr / e.anzahl / 12 : 0),
          flaeche ? 'CHF/m²' : 'CHF/Mt.',
          e.istWohnen ? chf(e.ertragJahr) : abzug(e.ertragJahr),
        ))
      }

      zeilen.push({
        total: true,
        zellen: ['Maximaler Mietertrag Wohnen',
          mitEinheit(formatNumber(basis.wohnenFlaeche), 'm² VMF'),
          mitEinheit(formatNumber(r.proM2Jahr), 'CHF/m²'), '', chf(r.maxMietertragWohnen)],
      })

      const tabellen: KapitelTabelle[] = [{
        titel: 'Kostenmietberechnung',
        // „Menge / CHF": wo die Menge ein Betrag ist, steht die Einheit im
        // Kopf — in der Zelle sprengte sie die Spaltenbreite der Tafel.
        kopf: ['Kostenposition', 'Menge / CHF', 'Ansatz', 'Zwischenwert', 'CHF/Jahr'],
        // Vier Zahlenspalten auf der Flucht der Tafel darunter.
        ...rasterAufMatrix(4),
        linksBis: 0,
        zeilen,
      }]

      // Sensitivität: wie die Kostenmiete auf die beiden Grössen reagiert, an
      // denen im Projektverlauf am ehesten etwas kippt — die Erstellungskosten
      // (Spalten) und die Vermietungsfläche Wohnen (Zeilen).
      const matrix = kostenmieteMatrix(basis, kmParams, ertragsNutzungen)
      if (basis.erstellungBrutto > 0 && basis.wohnenFlaeche > 0) {
        tabellen.push({
          titel: 'Sensitivitätsanalyse',
          // Die Ecke benennt die Spaltenachse, die Zeile darunter die
          // Zeilenachse — ohne das stünden Beträge da, von denen nicht
          // feststeht, was sie sind.
          kopf: ['Erstellungskosten', ...matrix.kosten.map((k) => chf(k))],
          // Die Abweichung gehört zu den Beträgen darüber und steht deshalb
          // noch im Kopf, nicht als erste Datenzeile.
          kopfZusatz: ['', ...SENS_SCHRITTE.map((x) => abweichung(x))],
          ...RASTER_MATRIX,
          linksBis: 0,
          // Der Basisfall — die mittlere Spalte, dazu unten die mittlere
          // Zeile — hebt sich hell ab, damit sich die Abweichungen von ihm aus
          // lesen lassen.
          hellSpalte: 3,
          zeilen: [
            // Die Beschriftung der Zeilenachse steht unter der Linie, auf einer
            // eigenen Zeile — im Kopf stünde sie über den Kostenbeträgen, zu
            // denen sie nicht gehört. Im Grad der Zahlen darunter, wie die
            // Beschriftung der Spaltenachse.
            { zellen: ['VMF Wohnen', '', '', '', '', ''] },
            ...matrix.flaechen.map((f, y) => ({
              hell: SENS_SCHRITTE[y] === 0,
              // Im Kreuz von Basiszeile und Basisspalte steht der gerechnete
              // Wert — er hebt sich eine Stufe kräftiger ab.
              dunkelSpalte: SENS_SCHRITTE[y] === 0 ? 3 : undefined,
            // Die mittlere Zeile und Spalte sind der erfasste Stand; die
            // Abweichung steht dabei, sonst liesse sich die Tafel nicht lesen.
            zellen: [
              // Fläche mit Einheit, dann mit Abstand die Abweichung — sie
              // gehört zur Zeile, nicht zur Zahl.
              `${formatNumber(f)} m²     ${abweichung(SENS_SCHRITTE[y])}`,
              ...matrix.zellen[y].map((v) => formatNumber(v)),
            ],
          })),
          ],
        })
      }

      // Wohnungsmieten: derselbe Einheitenbestand wie in der Sektion, damit
      // dieselben Mieten dastehen.
      const einheiten = buildUnits(ak.buildings, ak.etappen).filter(
        (u) => u.eig === 'genossenschaft' && u.istWohnen
          && (etappeId == null || u.etappeId === etappeId))
      const wm = wohnungsmieten(einheiten, wbf.punkte, r.maxMietertragWohnen)
      if (wm.rows.length > 0) {
        tabellen.push({
          titel: 'Resultierende Wohnungsmieten',
          kopf: ['Wohnungstyp', 'Punkte/Whg', 'Anzahl', 'Miete CHF/Mt.'],
          ...rasterAufMatrix(3),
          linksBis: 0,
          zeilen: [
            ...wm.rows.map((z) => ({
              zellen: [z.label, formatNumber(z.punkte, 1), formatNumber(z.anzahl), chf(z.mieteMt)],
            })),
            {
              total: true,
              zellen: ['Total je Monat', formatNumber(wm.punkteTotal, 1),
                formatNumber(wm.anzahlTotal), chf(wm.monatlichTotal)],
            },
          ],
        })
      }

      return {
        ...bereich('Kostenmiete (Genossenschaft)', 'genossenschaft'),
        // Ohne Satz darunter: die Tabellen benennen ihre Grössen selbst, und
        // die Herleitung steht Zeile für Zeile da.
        tabellen,
      }
    }

    // ── Rendite / Residualwert (Renditeobjekt) ───────────────────────────────
    /**
     * Grundstücksfläche der Sicht: konsolidiert die ganze Parzelle, auf
     * Etappenebene der Anteil, der in den Landkosten dieses Blocks steckt.
     */
    function gsfFuer(etappeId: string | null): number {
      if (etappeId == null) return ak.gsfTotal
      const p010 = ergebnis('renditeobjekt', etappeId)?.positionen['010']
      const landBrutto = (p010?.betragNetto ?? 0) + (p010?.mwstBetrag ?? 0)
      const gesamt = ak.konsolidiertEffektiv.get('renditeobjekt')?.positionen['010']
      const gesamtLand = (gesamt?.betragNetto ?? 0) + (gesamt?.mwstBetrag ?? 0)
      return gesamtLand > 0 ? ak.gsfTotal * (landBrutto / gesamtLand) : 0
    }

    function rendite(etappeId: string | null): KapitelBereich | null {
      const erg = ergebnis('renditeobjekt', etappeId)
      if (!erg) return null
      const { ertraege, totalVmf } = sammleRenditeMengen(ak.buildings, etappeId)
      const mietertragSoll = ertraege.reduce((s, e) => s + e.ertrag, 0)
      const { investition, erstellung } = investitionAusErgebnis(erg)
      const gsf = gsfFuer(etappeId)
      /*
       * Welche Betrachtung gedruckt wird, entscheidet der Kostenstand selbst:
       * ist das Grundstück in den Anlagekosten erfasst, lässt sich eine Rendite
       * darauf rechnen; fehlt es, ist gerade der Landwert die offene Grösse —
       * dann steht der Residualwert da.
       */
      const land = investition - erstellung
      const residual = land <= 0
      const r = berechneRendite(rParams, {
        mietertragSoll, totalVmf, investition, erstellung, gsf,
      })

      // Dieselbe Herleitung wie bei der Kostenmiete: Menge, Ansatz, Betrag in
      // eigenen Spalten, Zwischenschritte als eigene Zeilen.
      const raster = { ...rasterAufMatrix(3), linksBis: 0 }
      /** Dasselbe mit der Anteilsspalte hinter dem Betrag. */
      const rasterAnteil = { ...rasterAufMatrix(4), linksBis: 0 }

      /**
       * Anteil am Mietertrag SOLL. Er ist der Bezug der ganzen Rechnung — an
       * ihm lässt sich ablesen, wie schwer eine Position wiegt.
       */
      const anteil = (wert: number, negativ = false): string => {
        if (mietertragSoll <= 0 || wert === 0) return '—'
        const p = `${Math.abs(wert / mietertragSoll * 100).toFixed(1)} %`
        return negativ ? `− ${p}` : p
      }
      /** Hängt den Anteil als letzte Zelle an eine Zeile. */
      const mitAnteil = (z: TabellenZeile, wert: number, negativ = false): TabellenZeile =>
        ({ ...z, zellen: [...z.zellen, anteil(wert, negativ)] })

      const tabellen: KapitelTabelle[] = []
      if (ertraege.length > 0) {
        tabellen.push({
          titel: 'Mietertrag SOLL',
          kopf: ['Nutzung', 'Menge', 'Ansatz', 'CHF/Jahr', '% von SOLL'],
          ...rasterAnteil,
          zeilen: [
            ...ertraege.map((e) => mitAnteil(herleitung(
              e.nutzung,
              formatNumber(e.isPark ? e.stk : e.vmf), e.isPark ? 'Stk' : 'm² VMF',
              // Flächen als Jahresmiete je Quadratmeter, Stückzahlen als
              // Monatsmiete je Einheit — so, wie sie erfasst sind.
              formatNumber(e.isPark
                ? (e.stk > 0 ? e.ertrag / e.stk / 12 : 0)
                : (e.vmf > 0 ? e.ertrag / e.vmf : 0)),
              e.isPark ? 'CHF/Mt.' : 'CHF/m²',
              chf(e.ertrag),
            ), e.ertrag)),
            {
              total: true,
              zellen: ['Mietertrag SOLL', '', '', chf(mietertragSoll), anteil(mietertragSoll)],
            },
          ],
        })
      }

      const soll = chf(mietertragSoll)
      const vmfMenge = formatNumber(totalVmf)
      const summe = (label: string, wert: number): TabellenZeile => ({
        total: true,
        zellen: [label, '', '', chf(wert), anteil(wert)],
      })
      tabellen.push({
        titel: 'Erfolgsrechnung',
        kopf: ['Position', 'Menge / CHF', 'Ansatz', 'CHF/Jahr', '% von SOLL'],
        ...rasterAnteil,
        zeilen: [
          mitAnteil(herleitung('Mietertrag SOLL', '', '', '', '', soll), mietertragSoll),
          mitAnteil(herleitung('Leerstand', soll, '',
            pctZahl(rParams.leerstand), '%', abzug(r.leerstand)), r.leerstand, true),
          summe('Mietertrag IST', r.mietertragIst),
          mitAnteil(herleitung('Betriebskosten', soll, '',
            pctZahl(rParams.betriebskosten), '%', abzug(r.betriebskosten)),
          r.betriebskosten, true),
          mitAnteil(herleitung('Instandhaltung', vmfMenge, 'm² VMF',
            formatNumber(rParams.instandhaltungProM2, 1), 'CHF/m²', abzug(r.instandhaltung)),
          r.instandhaltung, true),
          mitAnteil(herleitung('Baurechtszins', '', '', '', '', abzug(r.baurechtszins)),
            r.baurechtszins, true),
          summe('Mietertrag Netto', r.mietertragNetto),
          mitAnteil(herleitung('Instandsetzungskosten', vmfMenge, 'm² VMF',
            formatNumber(rParams.instandsetzungProM2, 1), 'CHF/m²', abzug(r.instandsetzung)),
          r.instandsetzung, true),
          summe('Liegenschaftserfolg', r.liegenschaftserfolg),
        ],
      })

      if (residual) {
        tabellen.push({
          titel: 'Residualer Landwert',
          kopf: ['Position', 'Menge / CHF', 'Ansatz', 'CHF'],
          ...raster,
          zeilen: [
            herleitung('Liegenschaftserfolg', '', '', '', '', chf(r.liegenschaftserfolg)),
            // Der Ertragswert ist der kapitalisierte Erfolg — die Zeile nennt
            // den Satz, durch den geteilt wird.
            herleitung('Ertragswert', chf(r.liegenschaftserfolg), '',
              `÷ ${pctZahl(rParams.nettoKapSatz, 2)}`, '%', chf(r.ertragswert)),
            // Welche Position herausgerechnet ist, steht im Satz unter dem
            // Block — in der Ansatzspalte bräche der Hinweis um.
            herleitung('Anlagekosten exkl. Grundstück', '', '', '', '', abzug(erstellung)),
            {
              total: true,
              zellen: ['Residualer Landwert', mitEinheit(formatNumber(gsf), 'm² GSF'),
                mitEinheit(chf(r.landwertProM2), 'CHF/m²'), chf(r.landwert)],
            },
          ],
        })
      } else {
        tabellen.push({
          titel: 'Kennzahlen',
          kopf: ['Kennzahl', 'Ertrag CHF/Jahr', 'Anlagekosten CHF', 'Rendite'],
          ...raster,
          zeilen: [
            { zellen: ['Bruttorendite', soll, chf(investition), pct(r.bruttorendite, 2)] },
            {
              zellen: ['Nettorendite', chf(r.liegenschaftserfolg), chf(investition),
                pct(r.nettorendite, 2)],
            },
          ],
        })
      }

      return {
        ...bereich(residual
          ? 'Residualwert (Renditeobjekt)'
          : 'Renditeberechnung (Renditeobjekt)', 'renditeobjekt'),
        // Ohne Satz darunter, wie bei der Kostenmiete: die Herleitung steht
        // Zeile für Zeile da.
        tabellen,
      }
    }

    // ── Verkaufsgewinn (Stockwerkeigentum) ───────────────────────────────────
    function gewinn(etappeId: string | null): KapitelBereich | null {
      const erg = ergebnis('verkaufsobjekt', etappeId)
      if (!erg) return null
      const { investition, erstellung } = investitionAusErgebnis(erg)
      const gebaeude = ak.buildings.filter(
        (b) => eigentumsartForBuilding(b.use_type) === 'verkaufsobjekt'
          && (etappeId == null || b.etappe_id === etappeId))

      // Erlöse je Nutzung mit ihrer Menge — die Summen kommen aus derselben
      // Funktion wie in der Sektion, die Mengen aus denselben Zeilen.
      const summen = ertragProNutzung(gebaeude)
      const mengen = new Map<string, { flaeche: number; anzahl: number }>()
      for (const b of gebaeude) {
        for (const m of (b.mietflaechen ?? [])) {
          const name = (m.nutzung || '').trim() || '(ohne Nutzung)'
          const e = mengen.get(name) ?? { flaeche: 0, anzahl: 0 }
          e.flaeche += m.flaeche_m2 || 0
          e.anzahl += m.anzahl || 0
          mengen.set(name, e)
        }
      }
      const erloese = Object.entries(summen)
        .filter(([, betrag]) => betrag > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([nutzung, betrag]) => ({
          nutzung,
          betrag,
          flaeche: mengen.get(nutzung)?.flaeche ?? 0,
          anzahl: mengen.get(nutzung)?.anzahl ?? 0,
        }))
      const erloesTotal = erloese.reduce((sum, e) => sum + e.betrag, 0)
      const resultat = erloesTotal - investition

      /** Anteil am Verkaufserlös — der Bezug dieser Rechnung. */
      const anteil = (wert: number, negativ = false): string => {
        if (erloesTotal <= 0 || wert === 0) return '—'
        const p = `${Math.abs(wert / erloesTotal * 100).toFixed(1)} %`
        return negativ ? `− ${p}` : p
      }
      // Hier steht keine Sensitivitätstafel, an deren Breite sich die Tabellen
      // halten müssten — dafür tragen Mengen und Ansätze verschieden breite
      // Einheiten („m² VKF" neben „Stk"). Sie bekommen deshalb eigene
      // Spalten, damit die Zahlen untereinander fluchten.
      const raster = { ...RASTER_HERLEITUNG_ANTEIL, linksBis: 0 }

      const tabellen: KapitelTabelle[] = []
      if (erloese.length > 0) {
        tabellen.push({
          titel: 'Verkaufserlöse nach Nutzung',
          kopf: ['Nutzung', 'Menge', '', 'Ansatz', '', 'CHF', '% von Erlös'],
          ...raster,
          zeilen: [
            ...erloese.map((e) => {
              // Flächen mit ihrem Quadratmeterpreis, Stückzahlen mit dem Preis
              // je Einheit — bei Verkaufsobjekten sind die Mietzinsfelder
              // Preise, keine Jahresmieten.
              const flaeche = e.flaeche > 0
              const menge = flaeche ? e.flaeche : e.anzahl
              const ansatz = menge > 0 ? e.betrag / menge : 0
              return {
                zellen: [
                  e.nutzung,
                  menge > 0 ? formatNumber(menge) : '', flaeche ? 'm² VKF' : 'Stk',
                  menge > 0 ? chf(ansatz) : '', flaeche ? 'CHF/m²' : 'CHF/Stk',
                  chf(e.betrag),
                  anteil(e.betrag),
                ],
              }
            }),
            {
              total: true,
              zellen: ['Verkaufserlös total', '', '', '', '',
                chf(erloesTotal), anteil(erloesTotal)],
            },
          ],
        })
      }

      /** Zeile dieser Tabelle — Bezeichnung, Betrag und Anteil, dazwischen nichts. */
      const gewinnZeile = (label: string, betrag: string, prozent: string): string[] =>
        [label, '', '', '', '', betrag, prozent]
      tabellen.push({
        titel: 'Verkaufsgewinn',
        // Menge und Ansatz bleiben hier leer — die Spalten stehen trotzdem, so
        // fluchten Betrag und Anteil mit der Tabelle darüber.
        kopf: ['Position', '', '', '', '', 'CHF', '% von Erlös'],
        ...raster,
        zeilen: [
          { zellen: gewinnZeile('Verkaufserlös total', chf(erloesTotal), anteil(erloesTotal)) },
          {
            zellen: gewinnZeile('Anlagekosten BKP 0–9 inkl. MWST',
              abzug(investition), anteil(investition, true)),
          },
          {
            einzug: true,
            zellen: gewinnZeile('davon Erstellung BKP 1–9', chf(erstellung), anteil(erstellung)),
          },
          {
            total: true,
            zellen: gewinnZeile('Verkaufsgewinn', chf(resultat), anteil(resultat)),
          },
          {
            einzug: true,
            zellen: gewinnZeile('Marge auf den Anlagekosten', '',
              investition > 0 ? pct(resultat / investition) : '—'),
          },
        ],
      })

      return {
        ...bereich('Verkaufsgewinn (Stockwerkeigentum)', 'verkaufsobjekt'),
        // Ohne Satz darunter, wie die übrigen Bereiche.
        tabellen,
      }
    }

    /** Die Bereiche einer Sicht in der Reihenfolge des Variantenreiters. */
    function sichtDaten(titel: string, gesamt: boolean, etappeId: string | null) {
      const bereiche = [
        ak.presentEig.includes('genossenschaft') ? kostenmiete(etappeId) : null,
        ak.presentEig.includes('renditeobjekt') ? rendite(etappeId) : null,
        ak.presentEig.includes('verkaufsobjekt') ? gewinn(etappeId) : null,
      ].filter((b) => b != null)
      return bereiche.length > 0 ? { titel, gesamt, bereiche } : null
    }

    // ── Sichten: Gesamtprojekt und/oder Etappen, wie in den Anlagekosten ─────
    const mitBloecken = ak.etappen.filter(
      (e) => ak.blockList.some((b) => b.etappeId === e.id))
    const gewaehlt = mitBloecken.filter(
      (e) => etappenAuswahl.length === 0 || etappenAuswahl.includes(e.id))
    const proEtappe = mitBloecken.length > 1 && umfang !== 'gesamt' && gewaehlt.length > 0
    const zeigeGesamt = !proEtappe || umfang === 'beide'

    const sichten = [
      ...(zeigeGesamt ? [sichtDaten('Gesamtprojekt', true, null)] : []),
      ...(proEtappe ? gewaehlt.map((e) => sichtDaten(e.name, false, e.id)) : []),
    ].filter((x) => x != null)
    if (sichten.length === 0) return undefined

    return { mehrereSichten: sichten.length > 1, sichten }
  }, [ak, kmParams, rParams, wbf, umfang, etappenAuswahl])
}
