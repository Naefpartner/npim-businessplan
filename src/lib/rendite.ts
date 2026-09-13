import type { BkpErgebnis } from '@/lib/bkpBerechnung'
import type { VariantBuildingFull } from '@/hooks/useMengengeruest'
import { isParkNutzung } from '@/lib/bkp2'
import { eigentumsartForBuilding } from '@/types'

// Parameter der Renditeberechnung (Erfolgsrechnung) — pro Variante gespeichert.
export interface RenditeParams {
  leerstand: number          // Anteil von Mietertrag SOLL (0..1)
  betriebskosten: number     // Anteil von Mietertrag SOLL (0..1)
  instandhaltungProM2: number // CHF/m²·a (kanonisch; % wird abgeleitet)
  baurechtszins: number      // CHF/a
  instandsetzungProM2: number // CHF/m²·a (kanonisch; % wird abgeleitet)
  // Residualwert (Grundstücksfläche kommt aus den Anlagekosten = GSF)
  nettoKapSatz: number       // Nettokapitalisierungssatz (0..1)
}

export const RENDITE_DEFAULTS: RenditeParams = {
  leerstand: 0.02,
  betriebskosten: 0.05,
  instandhaltungProM2: 15,
  baurechtszins: 0,
  instandsetzungProM2: 25,
  nettoKapSatz: 0.04,
}

/** Bezugsgrössen der Renditerechnung — aus Mengen und Anlagekosten. */
export interface RenditeBasis {
  /** Jahresmietertrag SOLL aus den Mengen. */
  mietertragSoll: number
  /** Vermietbare Fläche in m² — Bezug für Instandhaltung und Instandsetzung. */
  totalVmf: number
  /** Anlagekosten brutto inklusive Grundstück. */
  investition: number
  /** Anlagekosten brutto ohne Position 010 (Grundstückerwerb). */
  erstellung: number
  /** Grundstücksfläche als Bezug für den Landwert je m². */
  gsf: number
}

export interface RenditeErgebnis {
  leerstand: number
  mietertragIst: number
  betriebskosten: number
  instandhaltung: number
  baurechtszins: number
  mietertragNetto: number
  instandsetzung: number
  liegenschaftserfolg: number
  bruttorendite: number
  nettorendite: number
  /** Kapitalisierter Liegenschaftserfolg. */
  ertragswert: number
  /** Ertragswert abzüglich Erstellungskosten = residualer Landwert. */
  landwert: number
  landwertProM2: number
}

/**
 * Erfolgsrechnung und Residualwert in einem Durchgang — beide Sichten teilen
 * sich den Liegenschaftserfolg, und der Bericht braucht dieselben Zahlen wie
 * die Sektion. Deshalb hier als reine Funktion statt im Komponentenrumpf.
 */
export function berechneRendite(p: RenditeParams, b: RenditeBasis): RenditeErgebnis {
  const leerstand = b.mietertragSoll * p.leerstand
  const mietertragIst = b.mietertragSoll - leerstand
  const betriebskosten = b.mietertragSoll * p.betriebskosten
  const instandhaltung = p.instandhaltungProM2 * b.totalVmf
  const baurechtszins = p.baurechtszins
  const mietertragNetto = mietertragIst - betriebskosten - instandhaltung - baurechtszins
  const instandsetzung = p.instandsetzungProM2 * b.totalVmf
  const liegenschaftserfolg = mietertragNetto - instandsetzung

  const ertragswert = p.nettoKapSatz > 0 ? liegenschaftserfolg / p.nettoKapSatz : 0
  const landwert = ertragswert - b.erstellung

  return {
    leerstand, mietertragIst, betriebskosten, instandhaltung, baurechtszins,
    mietertragNetto, instandsetzung, liegenschaftserfolg,
    bruttorendite: b.investition > 0 ? b.mietertragSoll / b.investition : 0,
    nettorendite:  b.investition > 0 ? liegenschaftserfolg / b.investition : 0,
    ertragswert, landwert,
    landwertProM2: b.gsf > 0 ? landwert / b.gsf : 0,
  }
}

// ─── Bezugsgrössen aus Mengen und Anlagekosten ───────────────────────────────

/** Eine Nutzung der Renditeobjekte mit ihrem Jahresmietertrag. */
export interface RenditeErtrag {
  nutzung: string
  isPark: boolean
  vmf: number
  stk: number
  ertrag: number
}

/**
 * Mietertrag SOLL je Nutzung und vermietbare Fläche der Renditeobjekte.
 * `etappeId = null` konsolidiert über alle Etappen, sonst nur deren Gebäude.
 * Gemeinsame Basis der Renditesektion und des Berichtskapitels — sonst laufen
 * die beiden Darstellungen auseinander.
 */
export function sammleRenditeMengen(
  buildings: VariantBuildingFull[], etappeId: string | null,
): { ertraege: RenditeErtrag[]; totalVmf: number } {
  const map = new Map<string, RenditeErtrag>()
  let totalVmf = 0
  for (const b of buildings) {
    if (eigentumsartForBuilding(b.use_type) !== 'renditeobjekt') continue
    if (etappeId != null && b.etappe_id !== etappeId) continue
    for (const mf of (b.mietflaechen ?? [])) {
      const fl = mf.flaeche_m2 || 0
      const anz = mf.anzahl || 0
      totalVmf += fl
      const ertrag = (mf.miete_chf_pa || 0)
        || (mf.miete_chf_m2_pa ? mf.miete_chf_m2_pa * fl : 0)
        || (mf.miete_chf_stk_mt ? mf.miete_chf_stk_mt * anz * 12 : 0)
      if (ertrag <= 0) continue
      const name = (mf.nutzung || '').trim() || '(ohne Nutzung)'
      const isPark = isParkNutzung(name) || (fl <= 0 && anz > 0)
      const e = map.get(name) ?? { nutzung: name, isPark, vmf: 0, stk: 0, ertrag: 0 }
      e.vmf += fl
      e.stk += anz
      e.ertrag += ertrag
      map.set(name, e)
    }
  }
  return {
    ertraege: [...map.values()]
      .sort((a, b) => Number(a.isPark) - Number(b.isPark) || b.ertrag - a.ertrag),
    totalVmf,
  }
}

/**
 * Anlagekosten brutto eines Kostenergebnisses — einmal mit und einmal ohne
 * Grundstück. „Ohne Grundstück" heisst nur ohne Position 010; die übrigen
 * Positionen der Hauptgruppe 0 gehören zur Erstellung.
 */
export function investitionAusErgebnis(
  erg: BkpErgebnis | undefined,
): { investition: number; erstellung: number } {
  if (!erg) return { investition: 0, erstellung: 0 }
  let investition = 0
  for (let c = 0; c <= 9; c++) {
    const k = c as keyof typeof erg.hauptgruppenSummenNetto
    investition += (erg.hauptgruppenSummenNetto[k] ?? 0) + (erg.hauptgruppenSummenMwst[k] ?? 0)
  }
  const p010 = erg.positionen['010']
  const land = (p010?.betragNetto ?? 0) + (p010?.mwstBetrag ?? 0)
  return { investition, erstellung: investition - land }
}
