// Die Tragbarkeit einer Variante, wie sie der Reiter zeigt und der Bericht
// druckt — aus Mengen, Anlagekosten und Wirtschaftlichkeit einerseits, den
// gespeicherten Annahmen und Schiebern andererseits. Eine Funktion für beide,
// damit Reiter und Bericht nicht auseinanderlaufen können.

import type { BkpErgebnis } from '@/lib/bkpBerechnung'
import type { ErtragDetail } from '@/lib/bkpBlocks'
import type { VariantBuildingFull } from '@/hooks/useMengengeruest'
import {
  berechneRendite, investitionAusErgebnis, sammleRenditeMengen, type RenditeParams,
} from '@/lib/rendite'
import {
  berechneTragbarkeit, berechneVerlauf,
  type AnnahmeGroesse, type BerechneteGroesse, type TragbarkeitBasis, type TragbarkeitDoc,
} from '@/lib/tragbarkeit'
import { isNutzungWohnen } from '@/types'

export interface TragbarkeitEingang {
  doc: TragbarkeitDoc
  rParams: RenditeParams
  /** Ertrag je Nutzung der Renditeobjekte. */
  ertragDetail: ErtragDetail[]
  buildings: VariantBuildingFull[]
  /** Kostenergebnis der Renditeobjekte, konsolidiert. */
  ergebnis: BkpErgebnis | undefined
  gsf: number
}

export type Grundlagen = Record<BerechneteGroesse, number>
export type Annahmen = Record<AnnahmeGroesse, number>

export function rechneTragbarkeit({ doc, rParams, ertragDetail, buildings, ergebnis, gsf }: TragbarkeitEingang) {
  /*
   * Mietertrag und Wohnfläche der Renditeobjekte. Die Wohnnutzungen tragen die
   * Rechnung: ihre Fläche ist die Bezugsgrösse, ihr Anteil am Gesamtertrag
   * rechnet die übrigen Nutzungen hinein.
   */
  let total = 0, wohnen = 0, vmfWohnen = 0
  for (const d of ertragDetail) {
    total += d.ertrag
    if (isNutzungWohnen(d.nutzung)) {
      wohnen += d.ertrag
      vmfWohnen += d.flaecheM2
    }
  }
  const mengen = { total, wohnen, vmfWohnen }

  /*
   * Der Ertragswert kommt aus der Wirtschaftlichkeitsrechnung: derselbe
   * kapitalisierte Liegenschaftserfolg, den der Reiter Wirtschaftlichkeit
   * ausweist. Die Belehnung hängt damit an derselben Bewertung — und der
   * Kapitalisierungssatz der Tragbarkeit ergibt sich daraus, statt eine zweite
   * Annahme zu sein.
   */
  const { ertraege, totalVmf } = sammleRenditeMengen(buildings, null)
  const { investition, erstellung } = investitionAusErgebnis(ergebnis)
  const soll = ertraege.reduce((s, e) => s + e.ertrag, 0)
  /** Ertragswert der Wirtschaftlichkeit, mit dem Mietertrag um `faktor` verschoben. */
  const ertragswertBei = (faktor: number) => berechneRendite(rParams, {
    mietertragSoll: soll * faktor, totalVmf, investition, erstellung, gsf,
  }).ertragswert

  /*
   * Zwei Sätze von Grundlagen: berechnet (aus Mengen, Anlagekosten und
   * Wirtschaftlichkeit) und mit den Schiebern. Ein Schieber am Mietertrag zieht
   * den Ertragswert mit, solange dieser keinen eigenen Schieberwert hat — sonst
   * stünde die Belehnung auf einem Ertrag, den es nicht mehr gibt.
   */
  const berechnet: Grundlagen = {
    mietertrag: mengen.total,
    ertragswert: ertragswertBei(1),
    anlagekosten: ergebnis?.totalBrutto ?? 0,
    vmfWohnen: mengen.vmfWohnen,
  }
  const sch = doc.schieber
  const simMiete = sch.mietertrag ?? berechnet.mietertrag
  const sim: Grundlagen = {
    mietertrag: simMiete,
    ertragswert: sch.ertragswert
      ?? (sch.mietertrag != null && mengen.total > 0 ? ertragswertBei(simMiete / mengen.total) : berechnet.ertragswert),
    anlagekosten: sch.anlagekosten ?? berechnet.anlagekosten,
    vmfWohnen: sch.vmfWohnen ?? berechnet.vmfWohnen,
  }
  const aktiv = doc.schieberAktiv
  const eff = aktiv ? sim : berechnet

  /* Reine Annahmen: links eingegeben, rechts der Schieber — null heisst, er steht
     auf dem eingegebenen Wert. Umschalten vergleicht die beiden. */
  const annahmen = (mitSchieber: boolean): Annahmen => {
    const w = (k: AnnahmeGroesse) => (mitSchieber ? sch[k] ?? doc[k] : doc[k])
    return {
      hypozins: w('hypozins'),
      tragbarkeitszins: w('tragbarkeitszins'),
      max1: w('max1'),
      max2: w('max2'),
      ersteHypothekChf: w('ersteHypothekChf'),
      amortisationsdauer: w('amortisationsdauer'),
      zusaetzlicheEigenmittel: w('zusaetzlicheEigenmittel'),
    }
  }
  /** 1. Hypothek, wie sie die Belehnungsgrenze höchstens hergibt. */
  const ersteAus = (g: Grundlagen, a: Annahmen) =>
    Math.max(0, Math.min(g.anlagekosten - a.zusaetzlicheEigenmittel, g.ertragswert * a.max1))

  /*
   * Die 1. Hypothek ist eine Eingabe; das Maximum aus der Belehnungsgrenze steht
   * nur als Bezug daneben. Ohne Eingabe (0) gilt das Maximum — so rechnet ein
   * neuer Stand nicht mit einer leeren 1. Hypothek.
   */
  const ohne = annahmen(false)
  const maxErsteBerechnet = ersteAus(berechnet, ohne)
  const annBerechnet: Annahmen = {
    ...ohne, ersteHypothekChf: ohne.ersteHypothekChf > 0 ? ohne.ersteHypothekChf : maxErsteBerechnet,
  }
  const mit = annahmen(true)
  const maxErsteSim = ersteAus(sim, mit)
  const annSim: Annahmen = {
    ...mit,
    ersteHypothekChf: sch.ersteHypothekChf
      ?? (doc.ersteHypothekChf > 0 ? doc.ersteHypothekChf : maxErsteSim),
  }
  const ann = aktiv ? annSim : annBerechnet

  const params = {
    ...doc,
    ...ann,
    mietzinsniveauWohnen: doc.eigenesMietzinsniveau
      ? doc.mietzinsniveauWohnen
      : (mengen.vmfWohnen > 0 ? mengen.wohnen / mengen.vmfWohnen : 0),
    anteilWohnen: doc.eigenerAnteilWohnen
      ? doc.anteilWohnen
      : (mengen.total > 0 ? mengen.wohnen / mengen.total : 1),
  }

  const basisAus = (g: Grundlagen): TragbarkeitBasis => ({
    mietertragTotal: g.mietertrag,
    mietertragWohnen: mengen.total > 0 ? mengen.wohnen * (g.mietertrag / mengen.total) : 0,
    vmfWohnen: g.vmfWohnen,
    anlagekosten: g.anlagekosten,
    ertragswert: g.ertragswert,
  })
  const basis = basisAus(eff)

  return {
    mengen, berechnet, sim, aktiv, eff, sch,
    annBerechnet, annSim, ann, params, basisAus, basis, maxErsteBerechnet, maxErsteSim,
    erg: berechneTragbarkeit(params, basis),
    verlauf: berechneVerlauf(params, basis),
  }
}

export type TragbarkeitRechnung = ReturnType<typeof rechneTragbarkeit>
