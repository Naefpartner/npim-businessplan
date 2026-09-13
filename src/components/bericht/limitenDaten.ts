import { useMemo } from 'react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { useWbfZh } from '@/hooks/useWbfZh'
import { useBwo } from '@/hooks/useBwo'
import { berechneWbf, defaultNutzungRate } from '@/lib/wbf'
import { berechneBwo, defaultWohnLimit, defaultNutzungLimit } from '@/lib/bwo'
import { sammleNebenNutzungen, sammleWohnungsmix, wbfMenge } from '@/lib/wohnbaufoerderung'
import { WOHNUNGSMIX_KEYS, WOHNUNGSMIX_LABEL } from '@/types'
import { formatNumber } from '@/lib/utils'
import { BERICHT_FARBE, RASTER_HERLEITUNG, type EtappenUmfang } from '@/lib/bericht'
import type {
  BereichsKapitelDaten, KapitelBereich, TabellenZeile,
} from '@/components/bericht/BerichtDokument'

const EIG = 'genossenschaft' as const

/** Betrag in Franken, gerundet. */
function chf(v: number): string {
  return formatNumber(Math.round(v))
}

/** Beschriftung einer Wohnungskategorie, wie in den Sektionen. */
function mixLabel(k: string): string {
  return `${WOHNUNGSMIX_LABEL[k as keyof typeof WOHNUNGSMIX_LABEL]}${k !== 'joker' ? ' Zimmer' : ''}`
}

/**
 * Stellt das Kapitel „Anlagekostenlimiten" zusammen — die beiden Modelle des
 * geförderten Wohnungsbaus, wie sie der Reiter der Variante zeigt:
 *
 * - Kantonale Wohnbauförderung ZH (WBF): Punkte aus dem Wohnungsmix, daraus
 *   die maximalen Erstellungs- und Investitionskosten.
 * - Bundesamt für Wohnungswesen (BWO): zulässige Anlagekostenlimite je
 *   Einheit.
 *
 * Beide stellen der Limite die geplanten Kosten der Variante gegenüber. Ohne
 * Genossenschaft gibt es nichts zu zeigen — dann bleibt das Kapitel leer.
 */
export function useLimitenDaten(
  variantId: string | undefined,
  umfang: EtappenUmfang,
  /** Ausgewählte Etappen; leer heisst alle. */
  etappenAuswahl: string[] = [],
): BereichsKapitelDaten | undefined {
  const ak = useAnlagekostenShared()
  const { params: wbf } = useWbfZh(variantId ?? '')
  const { params: bwo } = useBwo(variantId ?? '')

  return useMemo(() => {
    if (!ak.presentEig.includes(EIG)) return undefined

    // Kupfer statt Grün: das Kapitel zeigt nur die Genossenschaft, und ohne
    // eine zweite Nutzungsart unterscheidet die Farbe nichts — dann gilt die
    // Grundfarbe des Berichts.
    const farbe = BERICHT_FARBE.primaer
    const tabellenFarbe = BERICHT_FARBE.primaerHell
    const totalFarbe = BERICHT_FARBE.primaerZart
    const zelleFarbe = BERICHT_FARBE.primaerHell

    /** Geplante Kosten der Sicht — aus der gewählten Erfassungsmethode. */
    function geplant(etappeId: string | null) {
      const erg = etappeId == null
        ? ak.konsolidiertEffektiv.get(EIG)
        : ak.blockErgebnisseEffektiv.get(`${etappeId}::${EIG}`)
      if (!erg) return null
      const p010 = erg.positionen['010']
      const land = (p010?.betragNetto ?? 0) + (p010?.mwstBetrag ?? 0)
      return { investition: erg.totalBrutto, erstellung: erg.totalBrutto - land }
    }

    // ── Kantonale Wohnbauförderung ZH ────────────────────────────────────────
    function wbfBereich(etappeId: string | null, kosten: { investition: number; erstellung: number }): KapitelBereich | null {
      const mix = sammleWohnungsmix(ak.buildings, etappeId)
      const neben = sammleNebenNutzungen(ak.buildings, etappeId)
        .map((n) => ({ ...n, menge: wbfMenge(n) }))
        .filter((n) => n.menge > 0)
        .map((n) => {
          const ansatz = wbf.nutzungRates[n.nutzung] ?? defaultNutzungRate(n.nutzung, n.isPark)
          return { ...n, ansatz, kosten: n.menge * ansatz }
        })
      const nebenTotal = neben.reduce((sum, n) => sum + n.kosten, 0)
      const r = berechneWbf(mix, wbf, nebenTotal, kosten.erstellung, kosten.investition)
      if (r.punkteTotal === 0 && nebenTotal === 0) return null

      // Dasselbe Spaltenraster wie die Kostentabellen darunter: Anzahl steht
      // über der Menge, Punkte/Whg über dem Ansatz.
      const punkte: TabellenZeile[] = WOHNUNGSMIX_KEYS
        .filter((k) => (mix[k as string] || 0) > 0)
        .map((k) => {
          const anzahl = mix[k as string] || 0
          const proWhg = wbf.punkte[k as string] ?? 0
          return {
            zellen: [mixLabel(k as string), formatNumber(anzahl), 'Whg',
              formatNumber(proWhg, 1), 'Pt.', formatNumber(anzahl * proWhg, 1)],
          }
        })
      punkte.push({
        total: true,
        zellen: ['Total', formatNumber(r.whgTotal), 'Whg',
          `Ø ${formatNumber(r.punkteProWhg, 1)}`, 'Pt.', formatNumber(r.punkteTotal, 1)],
      })

      // Die Herleitung steht in Spalten statt in einem Satz: Menge, Ansatz und
      // Einheit je für sich. Zahlen rechtsbündig, ihre Einheit linksbündig
      // daneben — so fluchten die Zahlen untereinander.
      const pt = formatNumber(r.punkteTotal, 1)
      const erstellung: TabellenZeile[] = [
        {
          zellen: ['Max. Erstellungskosten Wohnen inkl. MWST', pt, 'Pt.',
            chf(wbf.chfProPunktErstellung), 'CHF/Pt.', chf(r.erstellungWohnen)],
        },
        {
          // In der Mengenspalte steht die Bezugsgrösse selbst — die
          // Erstellungskosten Wohnen aus der Zeile darüber.
          zellen: ['Zusatz für energetische Massnahmen', chf(r.erstellungWohnen), 'CHF',
            (wbf.energiezuschlagPct * 100).toFixed(1), '%', chf(r.energiezuschlag)],
        },
        {
          zellen: ['Max. Erstellungskosten Wohnen inkl. Zuschlag', '', '', '', '',
            chf(r.erstellungWohnenInkl)],
        },
        ...neben.map((n) => ({
          zellen: [`Kosten ${n.nutzung}`,
            formatNumber(n.menge), n.isPark ? 'Stk' : 'm² VMF',
            chf(n.ansatz), `CHF/${n.isPark ? 'Stk' : 'm²'}`, chf(n.kosten)],
        })),
        {
          total: true,
          zellen: ['Maximale Erstellungskosten Total inkl. MWST', '', '', '', '',
            chf(r.erstellungTotal)],
        },
        {
          einzug: true,
          zellen: ['Geplante Erstellungskosten (exkl. Land)', '', '', '', '',
            chf(kosten.erstellung)],
        },
        {
          einzug: true,
          zellen: ['Differenz Businessplan − Maximum WBF', '', '', '', '', chf(r.diffErstellung)],
        },
      ]

      const investition: TabellenZeile[] = [
        {
          zellen: ['Maximale Erstellungskosten Total inkl. MWST', '', '', '', '',
            chf(r.erstellungTotal)],
        },
        {
          einzug: true,
          zellen: ['Max. Anlagekosten pro Punkt total', '', '',
            chf(wbf.chfProPunktInvestitionTotal), 'CHF/Pt.', ''],
        },
        {
          einzug: true,
          zellen: ['abzüglich Erstellungskosten pro Punkt', '', '',
            `− ${chf(wbf.chfProPunktErstellung)}`, 'CHF/Pt.', ''],
        },
        {
          zellen: ['Maximale Kosten für Bauland Wohnen', pt, 'Pt.',
            chf(r.baulandSatz), 'CHF/Pt.', chf(r.baulandWohnen)],
        },
        {
          total: true,
          zellen: ['Maximale pauschalierte Investitionskosten', '', '', '', '',
            chf(r.investitionTotal)],
        },
        {
          einzug: true,
          zellen: ['Geplante Investitionskosten (inkl. Land)', '', '', '', '',
            chf(kosten.investition)],
        },
        {
          einzug: true,
          zellen: ['Differenz Businessplan − Maximum WBF', '', '', '', '', chf(r.diffInvestition)],
        },
      ]

      return {
        titel: 'Kantonale Wohnbauförderung ZH',
        farbe,
        tabellenFarbe,
        totalFarbe,
        zelleFarbe,
        tabellen: [
          {
            titel: 'Bestimmung Punkte WBF',
            kopf: ['Zimmer', 'Anzahl', '', 'Punkte/Whg', '', 'Punkte total'],
            ...RASTER_HERLEITUNG,
            linksBis: 0,
            zeilen: punkte,
          },
          {
            titel: 'Maximale Erstellungskosten',
            // Je Grösse zwei Spalten: die Zahl rechtsbündig, ihre Einheit
            // linksbündig daneben.
            kopf: ['Position', 'Menge', '', 'Ansatz', '', 'CHF'],
            ...RASTER_HERLEITUNG,
            linksBis: 0,
            zeilen: erstellung,
          },
          {
            titel: 'Maximale Investitionskosten',
            kopf: ['Position', 'Menge', '', 'Ansatz', '', 'CHF'],
            ...RASTER_HERLEITUNG,
            linksBis: 0,
            zeilen: investition,
          },
        ],
        hinweis: 'Punkte und Ansätze nach dem kantonalen Modell der Wohnbauförderung ZH; '
          + 'Wohnungsmix und übrige Nutzungen stammen aus den Mengen der Genossenschaft. '
          + 'Eine negative Differenz heisst: die geplanten Kosten liegen unter der Limite.',
      }
    }

    // ── Bundesamt für Wohnungswesen ──────────────────────────────────────────
    function bwoBereich(etappeId: string | null, kosten: { investition: number }): KapitelBereich | null {
      const mix = sammleWohnungsmix(ak.buildings, etappeId)
      const neben = sammleNebenNutzungen(ak.buildings, etappeId)
        .filter((n) => n.anzahl > 0)
        .map((n) => {
          const limit = bwo.nutzungLimits[n.nutzung] ?? defaultNutzungLimit(n.nutzung, n.isPark)
          return { ...n, limit, kosten: n.anzahl * limit }
        })
      const nebenTotal = neben.reduce((sum, n) => sum + n.kosten, 0)
      const r = berechneBwo(mix, bwo, nebenTotal, kosten.investition)
      if (r.wohnTotal === 0 && nebenTotal === 0) return null

      const zeilen: TabellenZeile[] = WOHNUNGSMIX_KEYS
        .filter((k) => (mix[k as string] || 0) > 0)
        .map((k) => {
          const anzahl = mix[k as string] || 0
          const limit = bwo.wohnLimits[k as string] ?? defaultWohnLimit(k as string)
          return {
            zellen: [mixLabel(k as string), chf(limit), formatNumber(anzahl), chf(anzahl * limit)],
          }
        })
      zeilen.push({ total: true, zellen: ['Total Wohnteil', '', '', chf(r.wohnTotal)] })
      zeilen.push({
        zellen: ['Zuschlag Energie (max. 10 %)',
          `${(bwo.energieZuschlagPct * 100).toFixed(1)} %`, '', chf(r.energie)],
      })
      zeilen.push({
        total: true,
        zellen: ['Total Wohnteil inkl. Zuschlag Energie', '', '', chf(r.wohnInklEnergie)],
      })
      for (const n of neben) {
        zeilen.push({
          zellen: [n.nutzung, chf(n.limit), formatNumber(n.anzahl), chf(n.kosten)],
        })
      }
      if (bwo.baugrundZusatz !== 0) {
        zeilen.push({
          zellen: ['Zusatzaufwand schlechter Baugrund', '', '', chf(bwo.baugrundZusatz)],
        })
      }
      zeilen.push({
        total: true,
        zellen: ['Zulässige Anlagekostenlimite', '', '', chf(r.zulaessigeLimite)],
      })
      zeilen.push({
        einzug: true,
        zellen: ['Anlagekosten gemäss Businessplan (inkl. Land)', '', '', chf(kosten.investition)],
      })
      zeilen.push({
        einzug: true,
        zellen: ['Differenz Anlagekosten − Limite', '', '', chf(r.differenz)],
      })

      return {
        titel: 'Bundesamt für Wohnungswesen BWO',
        farbe,
        tabellenFarbe,
        totalFarbe,
        zelleFarbe,
        // Die zweite Rechnung beginnt auf einer eigenen Seite: sie prüft
        // dieselben Kosten an einer anderen Limite und liest sich nicht als
        // Fortsetzung der ersten.
        neueSeite: true,
        tabellen: [{
          titel: 'Zulässige Anlagekostenlimite für Mietwohnungen',
          kopf: ['Kostenstufe', 'CHF/Einheit', 'Einheiten', 'Zulässige Kosten'],
          breiten: [42, 20, 16, 22],
          linksBis: 0,
          zeilen,
        }],
        hinweis: 'Limiten nach den Anlagekostenlimiten des BWO; die Einheiten stammen aus den '
          + 'Mengen der Genossenschaft — Wohnungen aus dem Wohnungsmix, Nebenflächen und '
          + 'Parkplätze aus der Anzahl je Nutzung. Eine negative Differenz heisst: die '
          + 'geplanten Kosten liegen unter der Limite.',
      }
    }

    function sichtDaten(titel: string, gesamt: boolean, etappeId: string | null) {
      const kosten = geplant(etappeId)
      if (!kosten) return null
      const bereiche = [wbfBereich(etappeId, kosten), bwoBereich(etappeId, kosten)]
        .filter((b) => b != null)
      return bereiche.length > 0 ? { titel, gesamt, bereiche } : null
    }

    // ── Sichten: Gesamtprojekt und/oder Etappen, wie in den Anlagekosten ─────
    // Nur Etappen mit Genossenschaftsblock — in den übrigen gibt es keine
    // Limiten zu prüfen.
    const mitBlock = ak.etappen.filter(
      (e) => ak.blockList.some((b) => b.etappeId === e.id && b.eig === EIG))
    const gewaehlt = mitBlock.filter(
      (e) => etappenAuswahl.length === 0 || etappenAuswahl.includes(e.id))
    const proEtappe = mitBlock.length > 1 && umfang !== 'gesamt' && gewaehlt.length > 0
    const zeigeGesamt = !proEtappe || umfang === 'beide'

    const sichten = [
      ...(zeigeGesamt ? [sichtDaten('Gesamtprojekt', true, null)] : []),
      ...(proEtappe ? gewaehlt.map((e) => sichtDaten(e.name, false, e.id)) : []),
    ].filter((x) => x != null)
    if (sichten.length === 0) return undefined

    return { mehrereSichten: sichten.length > 1, sichten }
  }, [ak, wbf, bwo, umfang, etappenAuswahl])
}
