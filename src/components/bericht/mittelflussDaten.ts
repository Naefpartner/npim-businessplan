import { useMemo } from 'react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { useMittelfluss } from '@/hooks/useMittelfluss'
import { useKapitalSteuern } from '@/hooks/useKapitalSteuern'
import { useHonorar } from '@/hooks/useHonorar'
import { berechneHonorare, type HonorarInput } from '@/lib/honorar'
import {
  gewinnsteuern, mittelflussCalc, mittelflussZeilen, objektErloesReihen,
  type MfDispRow,
} from '@/lib/mittelflussRechnung'
import {
  honorarPhasenGewichte, projektEnde, quartaleZwischen, resolvePhasen,
  verkaufsVerteilung, defaultMittelflussDoc,
} from '@/lib/mittelfluss'
import { analysiereReihe, finanzierungsreihe } from '@/lib/irr'
import { buildUnits } from '@/lib/mengenAnalyse'
import { ertragProNutzung } from '@/lib/bkpBlocks'
import { eigentumsartForBuilding } from '@/types'
import { mittelflussKapitel } from '@/components/bericht/mittelflussKapitel'
import type { BereichsKapitelDaten } from '@/components/bericht/BerichtDokument'

const EMPTY_HON: HonorarInput = { anlagekosten: {}, factors: {}, pauschal: {} }

/**
 * Stellt das Kapitel „Mittelflussrechnung" zusammen.
 *
 * Gerechnet wird mit denselben Funktionen wie im Reiter der Variante — Zeilen,
 * Quartalsverteilung, Finanzierung und interner Zinsfuss. Gedruckt wird die
 * Gesamtsicht über alle Eigentumsarten, weil die Finanzierung des Projekts
 * über ihnen liegt; das ist auch die Ansicht, in der der Reiter aufgeht.
 */
export function useMittelflussDaten(
  projectId: string | undefined,
  variantId: string | undefined,
): BereichsKapitelDaten | undefined {
  const ak = useAnlagekostenShared()
  const { loaded: mfDoc } = useMittelfluss(variantId ?? '')
  const { loaded: ksDoc } = useKapitalSteuern(variantId ?? '')
  const { loaded: honorarDoc } = useHonorar(projectId)

  /** Gewichte der Honorarphasen — wie im Reiter, für die Aufteilung 690a/690b. */
  const honGewichte = useMemo(() => {
    if (!honorarDoc || !variantId) return []
    const input = honorarDoc.inputs[variantId] ?? EMPTY_HON
    const res = berechneHonorare(input, honorarDoc.planer, {
      nebenkosten: honorarDoc.nebenkostenPct, mwst: honorarDoc.mwstPct, gp: honorarDoc.gpPct,
    })
    return honorarPhasenGewichte(res.phasen)
  }, [honorarDoc, variantId])

  return useMemo(() => {
    if (!mfDoc || ak.presentEig.length === 0) return undefined
    const doc = { ...defaultMittelflussDoc(), ...mfDoc }

    // ── Zeitachse ───────────────────────────────────────────────────────────
    const endMonat = projektEnde(doc.phasen) ?? doc.endMonat
    const quartale = quartaleZwischen(doc.startMonat, endMonat)
    if (quartale.length === 0) return undefined
    const qKeys = quartale.map((q) => q.key)

    // ── Kostenzeilen und ihre Verteilung (Gesamtsicht) ──────────────────────
    const eigs = ak.presentEig
    const aufHauptgruppen = ak.benchmarkAktiv || ak.keeValueAktiv
      || doc.verteilEbene === 'hauptgruppe'
    const rows: MfDispRow[] = mittelflussZeilen({
      eigs,
      positionsByEig: ak.positionsByEig,
      typForByEig: ak.typForByEig,
      ergFor: (eig) => ak.konsolidiertEffektiv.get(eig),
      honGewichte,
      aufHauptgruppen,
    }).map((r) => ({
      ...r, scope: 'kons|gesamt', posKey: r.key, indent: 0, isHeader: false,
      editable: r.kind !== 'finanzierung',
    }))
    const calc = mittelflussCalc(rows, doc.verteilung, qKeys)

    // ── Verkaufserlöse ──────────────────────────────────────────────────────
    const erloesScope = 'erloes|gesamt'
    const erloesTotal = eigs.includes('verkaufsobjekt')
      ? Object.values(ertragProNutzung(ak.buildings.filter(
        (b) => eigentumsartForBuilding(b.use_type) === 'verkaufsobjekt')))
        .reduce((s, v) => s + v, 0)
      : 0
    const objekte = erloesTotal <= 0 ? [] : buildUnits(ak.buildings, ak.etappen)
      .filter((u) => u.eig === 'verkaufsobjekt' && u.mietePa * u.anzahl > 0)
      .map((u) => ({
        id: u.id,
        label: [u.haus, u.geschoss !== '–' ? u.geschoss : null,
          u.wohnungsnummer || u.bezeichnung || u.zimmerLabel || u.nutzung]
          .filter(Boolean).join(' · '),
        betrag: u.mietePa * u.anzahl,
        vkf: u.vmf * u.anzahl,
      }))
    const objektReihen = objektErloesReihen(
      objekte, qKeys, doc.verteilung[erloesScope], ksDoc?.landprovider.ertrag ?? 0)
    const erloese = doc.verkauf.modell === 'objekte'
      ? qKeys.map((_, i) => objektReihen.reduce((s, o) => s + (o.betraege[i] ?? 0), 0))
      : verkaufsVerteilung(
        { ...doc, endMonat }, quartale, doc.verteilung[erloesScope]?.['erloes'] ?? {},
      ).map((p) => (p / 100) * erloesTotal)

    // ── Gewinnsteuern als Zahlungen ─────────────────────────────────────────
    const steuern = gewinnsteuern(
      ksDoc, ak.konsolidiertEffektiv.get('verkaufsobjekt'),
      ak.benchmarkAktiv || ak.keeValueAktiv, erloesTotal)
    const steuerReihe = (key: string, betrag: number) => qKeys.map(
      (qk) => ((doc.verteilung['steuer|gesamt']?.[key]?.[qk] ?? 0) / 100) * betrag)
    const ggst = steuerReihe('ggst', steuern.grundstueckgewinn)
    const gewinnsteuerTu = steuerReihe('gewinnsteuer_tu', steuern.gewinnTu)

    // ── Finanzierung und Zinsfuss ───────────────────────────────────────────
    // Die Bauzinsen stecken in den Eigentümerkosten und damit in totNetto.
    const kosten = qKeys.map((_, i) => (calc.totNetto[i] ?? 0) + (calc.totMwst[i] ?? 0)
      + (ggst[i] ?? 0) + (gewinnsteuerTu[i] ?? 0))
    const projektReihe = erloese.map((e, i) => e - (kosten[i] ?? 0))
    const ek = qKeys.map((qk) => doc.verteilung['fremd|gesamt']?.['eigenkapital']?.[qk] ?? 0)
    const tranchen = qKeys.map((qk) => doc.verteilung['fremd|gesamt']?.['tranche']?.[qk] ?? 0)
    const fin = finanzierungsreihe(projektReihe.map((v) => -v), ek, tranchen)
    /*
     * Zahlungstag ist das Quartalsende, auf einer fortlaufenden Tagesachse —
     * derselbe kalendergenaue Zinsfuss wie im Reiter (Konvention XINTZINSFUSS).
     */
    const tage = quartale.map((q) => Date.UTC(q.jahr, q.q * 3, 0) / 86_400_000)
    const satzProQuartal = doc.fremdZinssatz / 100 / 4
    const kEigen = analysiereReihe(fin.ekFluss, { satzProQuartal, tage })
    const kumSaldo: number[] = []
    { let run = 0; for (const v of projektReihe) { run += v; kumSaldo.push(run) } }

    return mittelflussKapitel({
      quartale,
      phasen: resolvePhasen(doc.phasen),
      fremdZinssatz: doc.fremdZinssatz,
      verkaufModell: doc.verkauf.modell,
      aufHauptgruppen,
      nettoAK: calc.totNetto,
      mwst: calc.totMwst,
      ggst,
      gewinnsteuerTu,
      kosten,
      erloese,
      kumSaldo,
      ek,
      tranchen,
      fin,
      kProjekt: analysiereReihe(projektReihe, { satzProQuartal, tage }),
      kEigen,
    })
  }, [mfDoc, ksDoc, honGewichte, ak.presentEig, ak.positionsByEig, ak.typForByEig,
    ak.konsolidiertEffektiv, ak.benchmarkAktiv, ak.keeValueAktiv, ak.buildings, ak.etappen])
}
