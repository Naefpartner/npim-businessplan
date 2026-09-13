// Kostenmiete / maximale Mieterträge nach dem Zürcher Kostenmietmodell (Entwurf).
//
// Maximale Mieterträge (CHF/Jahr) =
//   + Verzinsung Erstellungskosten      (Erstellungskosten × Referenzzinssatz)
//   + Verzinsung Grundstück             (Grundstück × Referenzzinssatz)
//       — ODER, falls Grundstück im Baurecht, der Baurechtszins mit zwei Zeilen
//         (subventionierte / nicht subventionierte Wohnungen). Je Zeile ein
//         Anteil in % und entweder ein absoluter Baurechtszins (CHF/Jahr) oder
//         ein % der (anteiligen) Erstellungskosten.
//   + Betriebskosten                    (Erstellungskosten × GVW-Faktor × Satz)
//
// Kapitalbasis kommt aus den Anlagekosten der Eigentumsart „Genossenschaft":
//   - Grundstück     = BKP 0,    brutto inkl. MwSt
//   - Erstellungskosten = BKP 1–9, brutto inkl. MwSt
//
// Alle Sätze sind editierbar — Defaults sind Richtwerte und fachlich zu bestätigen.

import type { BkpErgebnis } from '@/lib/bkpBerechnung'
import type { VariantBuildingFull } from '@/hooks/useMengengeruest'
import { eigentumsartForBuilding, isNutzungWohnen, effektiveWohnungCounts } from '@/types'

export type BaurechtModus = 'pct' | 'chf'

export interface BaurechtZeile {
  /** Anteil dieser Kategorie an den Erstellungskosten (0..1). */
  anteil: number
  /**
   * Baurechtszins:
   *  - 'pct' = Referenzzinssatz auf der anteiligen Erstellungskosten (automatisch übernommen)
   *  - 'chf' = absoluter CHF/Jahr-Betrag
   */
  modus: BaurechtModus
  /** CHF/Jahr (bei modus 'chf'). */
  betragChf: number
}

export interface KostenmieteParams {
  /** Hypothekarischer Referenzzinssatz (0..1) — für Verzinsung Erstellungskosten und Grundstück. */
  referenzzinssatz: number
  /** Grundstück im Baurecht? Dann Baurechtszins statt Verzinsung Grundstück. */
  imBaurecht: boolean
  /** Baurechtszins (0..1) — frei wählbar, unabhängig vom Referenzzinssatz. */
  baurechtZins: number
  baurechtSubv: BaurechtZeile
  baurechtNichtSubv: BaurechtZeile
  /** Faktor Gebäudeversicherungswert: GVW = Erstellungskosten × Faktor (0..1), default 0.90. */
  gvwFaktor: number
  /** Betriebskostensatz auf dem GVW (0..1), default 0.0325. */
  betriebskostenSatz: number
}

export const KOSTENMIETE_DEFAULTS: KostenmieteParams = {
  referenzzinssatz:  0.015,
  imBaurecht:        false,
  baurechtZins:      0.015,
  baurechtSubv:      { anteil: 0, modus: 'pct', betragChf: 0 },
  baurechtNichtSubv: { anteil: 0, modus: 'pct', betragChf: 0 },
  gvwFaktor:         0.90,
  betriebskostenSatz: 0.0325,
}

export interface KostenmieteBasis {
  grundstueckBrutto: number
  erstellungBrutto: number
  anlagekostenBrutto: number
  vmf: number
  wohnenFlaeche: number
  wohnungen: number
}

// ─── Sensitivitätsanalyse (UI-Einstellungen, pro Variante gespeichert) ────────
export type SensParamId = 'refzins' | 'erstellung_pm2' | 'erstellung_abs' | 'vmf_wohnen'
export type SensAxisStep = { mode: 'pct' | 'abs'; value: number }

export interface SensSettings {
  axisX: SensParamId
  axisY: SensParamId
  stepX: SensAxisStep
  stepY: SensAxisStep
}

export const SENS_DEFAULTS: SensSettings = {
  axisX: 'refzins',
  axisY: 'erstellung_abs',
  stepX: { mode: 'pct', value: 0.1 },
  stepY: { mode: 'pct', value: 0.1 },
}

/** Eine ertragsbringende Nutzung aus dem Mengengerüst. */
export interface ErtragNutzung {
  nutzung: string
  /** Wohnen wird als Residualwert behandelt (nicht abgezogen), nur angezeigt. */
  istWohnen: boolean
  /** 'flaeche' = VNF-basiert (CHF/m²), 'anzahl' = stückbasiert (CHF/Stk·Mt). */
  basis: 'flaeche' | 'anzahl'
  flaeche: number
  anzahl: number
  /** Erfasster Jahresertrag (CHF/Jahr) aus „Mengen und Erträge". */
  ertragJahr: number
}

export interface KostenmietePosten {
  key: string
  label: string
  betrag: number
  info: string
}

export interface KostenmieteErgebnis {
  posten: KostenmietePosten[]
  maxMieterertrag: number
  /** Übrige ertragsbringende Nutzungen (ausser Wohnen), die abgezogen werden. */
  ertragsNutzungen: ErtragNutzung[]
  summeUebrigeErtraege: number
  maxMietertragWohnen: number
  proM2Jahr: number
  proM2Monat: number
  proWohnungMonat: number
}

/**
 * Mengen der Eigentumsart „Genossenschaft" aus dem Mengengerüst sammeln —
 * Fläche, Wohnungszahl und die ertragsbringenden Nutzungen. `etappeId = null`
 * konsolidiert über alle Etappen, sonst nur die Gebäude dieser Etappe.
 * Gemeinsame Basis für die Kostenmiete-Sektion und die Mengen-/Mietzinsanalyse.
 */
export function sammleKostenmieteMengen(
  buildings: VariantBuildingFull[], etappeId: string | null,
): { vmf: number; wohnenFlaeche: number; wohnungen: number; ertragsNutzungen: ErtragNutzung[] } {
  let vmf = 0, wohnenFlaeche = 0, wohnungen = 0
  const map = new Map<string, { nutzung: string; istWohnen: boolean; flaeche: number; anzahl: number; ertragJahr: number }>()
  for (const b of buildings) {
    if (eigentumsartForBuilding(b.use_type) !== 'genossenschaft') continue
    if (etappeId !== null && b.etappe_id !== etappeId) continue
    for (const m of (b.mietflaechen ?? [])) {
      const fl = m.flaeche_m2 || 0
      vmf += fl
      const istWohnen = isNutzungWohnen(m.nutzung)
      if (istWohnen) {
        wohnenFlaeche += fl
        // Zimmer-Mix, sonst die erfasste Stückzahl als Wohnungen.
        wohnungen += effektiveWohnungCounts(m.nutzung, m.wohnungsmix, m.anzahl).reduce((s, [, c]) => s + c, 0)
      }
      // Alle Nutzungen mit erfasstem Mietertrag — nach Nutzung gruppieren.
      const ertrag = (m.miete_chf_pa || 0)
        || (m.miete_chf_m2_pa ? m.miete_chf_m2_pa * fl : 0)
        || (m.miete_chf_stk_mt ? m.miete_chf_stk_mt * (m.anzahl || 0) * 12 : 0)
      const key = (m.nutzung || '(ohne Nutzung)').trim()
      const e = map.get(key) ?? { nutzung: key, istWohnen, flaeche: 0, anzahl: 0, ertragJahr: 0 }
      e.flaeche += fl
      e.anzahl += m.anzahl || 0
      e.ertragJahr += ertrag
      map.set(key, e)
    }
  }
  const ertragsNutzungen: ErtragNutzung[] = [...map.values()]
    .filter((e) => e.ertragJahr > 0)
    .map((e) => ({
      nutzung: e.nutzung,
      istWohnen: e.istWohnen,
      basis: (e.flaeche > 0 ? 'flaeche' : 'anzahl') as ErtragNutzung['basis'],
      flaeche: e.flaeche,
      anzahl: e.anzahl,
      ertragJahr: e.ertragJahr,
    }))
    .sort((a, b) => Number(a.istWohnen) - Number(b.istWohnen) || b.ertragJahr - a.ertragJahr)
  return { vmf, wohnenFlaeche, wohnungen, ertragsNutzungen }
}

/** Kapitalbasis aus einem Anlagekosten-Ergebnis (Grundstück = Pos. 010, Erstellung = BKP 1–9). */
export function basisFromErgebnis(
  erg: BkpErgebnis, vmf: number, wohnenFlaeche: number, wohnungen: number,
): KostenmieteBasis {
  // Grundstück: nur Position 010 (Grundstückerwerb), nicht die ganze BKP 0.
  const p010 = erg.positionen['010']
  const grundstueckBrutto = (p010?.betragNetto ?? 0) + (p010?.mwstBetrag ?? 0)
  // Erstellungskosten: Hauptgruppen 1–9 (brutto inkl. MwSt).
  let erstellungBrutto = 0
  for (let c = 1; c <= 9; c++) {
    const k = c as keyof typeof erg.hauptgruppenSummenNetto
    erstellungBrutto += (erg.hauptgruppenSummenNetto[k] ?? 0) + (erg.hauptgruppenSummenMwst[k] ?? 0)
  }
  const anlagekostenBrutto = erg.totalBrutto
  return { grundstueckBrutto, erstellungBrutto, anlagekostenBrutto, vmf, wohnenFlaeche, wohnungen }
}

function pct(n: number): string {
  return `${(n * 100).toLocaleString('de-CH', { maximumFractionDigits: 3 })} %`
}
function chf(n: number): string {
  return `CHF ${Math.round(n).toLocaleString('de-CH')}`
}

function baurechtBetrag(z: BaurechtZeile, erstellung: number, baurechtZins: number): { betrag: number; info: string } {
  if (z.modus === 'chf') {
    return { betrag: z.betragChf, info: `${chf(z.betragChf)}/Jahr · Anteil ${pct(z.anteil)}` }
  }
  // 'pct' = Baurechtszins auf der anteiligen Erstellungskosten.
  const anteilig = erstellung * z.anteil
  return {
    betrag: anteilig * baurechtZins,
    info: `${pct(baurechtZins)} (Baurechtszins) von ${pct(z.anteil)} der Erstellungskosten (${chf(anteilig)})`,
  }
}

export function berechneKostenmiete(
  basis: KostenmieteBasis, p: KostenmieteParams, ertragsNutzungen: ErtragNutzung[] = [],
): KostenmieteErgebnis {
  const { erstellungBrutto, grundstueckBrutto } = basis
  const posten: KostenmietePosten[] = []

  posten.push({
    key: 'verz_erstellung', label: 'Verzinsung Erstellungskosten',
    betrag: erstellungBrutto * p.referenzzinssatz,
    info: `${pct(p.referenzzinssatz)} von Erstellungskosten ${chf(erstellungBrutto)}`,
  })

  if (p.imBaurecht) {
    const s = baurechtBetrag(p.baurechtSubv, erstellungBrutto, p.baurechtZins)
    const ns = baurechtBetrag(p.baurechtNichtSubv, erstellungBrutto, p.baurechtZins)
    posten.push({ key: 'baurecht_subv',  label: 'Baurechtszins · subventionierte Wohnungen',       betrag: s.betrag,  info: s.info })
    posten.push({ key: 'baurecht_nsubv', label: 'Baurechtszins · nicht subventionierte Wohnungen', betrag: ns.betrag, info: ns.info })
  } else {
    posten.push({
      key: 'verz_grundstueck', label: 'Verzinsung Grundstück',
      betrag: grundstueckBrutto * p.referenzzinssatz,
      info: `${pct(p.referenzzinssatz)} von Grundstück ${chf(grundstueckBrutto)}`,
    })
  }

  const gvw = erstellungBrutto * p.gvwFaktor
  posten.push({
    key: 'betriebskosten', label: 'Betriebskosten',
    betrag: gvw * p.betriebskostenSatz,
    info: `GVW ${chf(gvw)} (${pct(p.gvwFaktor)} der Erstellungskosten) × ${pct(p.betriebskostenSatz)}`,
  })

  const maxMieterertrag = posten.reduce((s, x) => s + x.betrag, 0)

  // Erträge der übrigen Nutzungen (ohne Wohnen) abziehen → Residualwert für Wohnen.
  const summeUebrigeErtraege = ertragsNutzungen
    .filter((e) => !e.istWohnen)
    .reduce((s, e) => s + e.ertragJahr, 0)
  const maxMietertragWohnen = maxMieterertrag - summeUebrigeErtraege

  const proM2Jahr = basis.wohnenFlaeche > 0 ? maxMietertragWohnen / basis.wohnenFlaeche : 0
  const proM2Monat = proM2Jahr / 12
  const proWohnungMonat = basis.wohnungen > 0 ? maxMietertragWohnen / basis.wohnungen / 12 : 0

  return {
    posten, maxMieterertrag, ertragsNutzungen, summeUebrigeErtraege, maxMietertragWohnen,
    proM2Jahr, proM2Monat, proWohnungMonat,
  }
}

// ─── Sensitivität: Kostenmiete über Erstellungskosten und Fläche ─────────────

/** Stufen der Matrix — zwei Schritte zu zehn Prozent in jede Richtung. */
export const SENS_SCHRITTE = [-0.2, -0.1, 0, 0.1, 0.2]

export interface KostenmieteMatrix {
  /** Erstellungskosten brutto je Spalte. */
  kosten: number[]
  /** Vermietungsfläche Wohnen je Zeile. */
  flaechen: number[]
  /** Kostenmiete Wohnen in CHF/m² VMF und Jahr, [Zeile][Spalte]. */
  zellen: number[][]
}

/**
 * Wie die Kostenmiete Wohnen auf die beiden Grössen reagiert, an denen im
 * Projektverlauf am ehesten etwas kippt: die Erstellungskosten und die
 * Vermietungsfläche. Alle übrigen Parameter bleiben, wie sie erfasst sind —
 * die Matrix zeigt eine Abweichung, keine zweite Rechnung.
 */
export function kostenmieteMatrix(
  basis: KostenmieteBasis, p: KostenmieteParams, ertragsNutzungen: ErtragNutzung[],
  schritte: number[] = SENS_SCHRITTE,
): KostenmieteMatrix {
  // Die abweichenden Kostenstände auf zehntausend Franken gerundet: sie sind
  // Annahmen, und eine frankengenaue Annahme täuscht eine Schärfe vor, die sie
  // nicht hat. Der Basisfall bleibt auf den Franken genau — er ist gerechnet.
  const kosten = schritte.map((x) => (x === 0
    ? basis.erstellungBrutto
    : Math.round(basis.erstellungBrutto * (1 + x) / 10000) * 10000))
  // Ebenso die Flächen — auf zehn Quadratmeter gerundet, der Basisfall genau.
  const flaechen = schritte.map((y) => (y === 0
    ? basis.wohnenFlaeche
    : Math.round(basis.wohnenFlaeche * (1 + y) / 10) * 10))
  const zellen = flaechen.map((wohnenFlaeche) => kosten.map((erstellungBrutto) =>
    berechneKostenmiete(
      { ...basis, erstellungBrutto, wohnenFlaeche }, p, ertragsNutzungen).proM2Jahr))
  return { kosten, flaechen, zellen }
}
