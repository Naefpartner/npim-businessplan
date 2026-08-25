// Berechnung der Anlagekosten — löst die Abhängigkeiten der BKP-Positionen
// in der richtigen Reihenfolge auf:
//   1. Pauschal & Kennwert-basierte Positionen
//   2. Pos. 2 (Gebäude) als Aggregat aus den variant_buildings
//   3. Pos. 1.160 (Prozent von Pos. 2)
//   4. Pos. 5, 6 (Prozent von Pos. 1-4)
//   5. Pos. 8 (Prozent von Pos. 1-7)
//   6. Pos. 9 (Prozent von Pos. 0-8, plus Finanzierung)

import {
  BKP_POSITIONEN, einheitenFuerTyp,
  type BkpPosition, type BkpHauptgruppe, type Status, type BerechnungsTyp,
} from '@/lib/bkpKatalog'
import type { BaseRef } from '@/types'

export interface BkpEintrag {
  position_code: string
  status: Status
  kennwert: number | null
  kennwert2: number | null
  bezugsmenge_override: number | null
  betrag_override: number | null
  mengen_einheit_override: string | null
  mwst_anwenden: boolean | null
  mwst_satz_override: number | null
  notiz: string | null
}

export interface BkpMengen {
  /** Total Grundstücksfläche (m²) aus Parzellen */
  gsf_total_m2: number
  /** Total VMF (m²) aus allen Gebäuden/Mietflächen der Variante */
  vmf_total_m2: number
  /** Umgebungsfläche = GSF minus Gebäude-Footprint (vereinfacht = GSF, wenn nichts erfasst) */
  uf_total_m2: number
  /** BKP-2 Volumen (m³) je row_key (aus dem Mengengerüst) — Menge der bkp2:*-Positionen */
  bkp2_m3: Record<string, number>
  /** Welche Hauptgruppen sind als „Rückstellung" markiert (für exklRueckstellung-Logik) */
  rueckstellungs_codes: ReadonlySet<string>
  /** Globaler MwSt-Satz der Variante (z.B. 0.081 = 8.1%) */
  mwst_satz_global: number
  /** Jahreswert (CHF, netto) je Nutzung — Mietertrag (710/720) bzw. Verkaufserlös STWEG (730/740) */
  ertrag_pro_nutzung: Record<string, number>
}

export interface PositionResult {
  position: BkpPosition
  status: Status
  /** Eingegebener Kennwert (Einheitspreis bei Stückkosten, % bei Prozent etc.) */
  kennwert: number | null
  /** Zweiter Kennwert (z.B. Finanzierungs-Anteil 0..1). */
  kennwert2?: number | null
  /** Manueller Betrags-Override (CHF). null = Berechnung läuft normal. */
  betragOverride: number | null
  /** Bezugsmenge (bei Pauschal: null; bei Prozent: Bezugssumme; bei m³: m³) */
  menge: number | null
  /** Anzeige-Einheit der Menge (z.B. 'm²', 'CHF') */
  mengeEinheit: string
  /** Anzeige-Einheit des Einheitspreises (z.B. 'CHF/m²', '%') */
  preisEinheit: string
  /** Netto-Betrag (CHF) — null wenn nicht berechenbar */
  betragNetto: number | null
  /** Wird MwSt angewendet? (effektiv: aus Override oder Katalog-Default) */
  mwstAnwenden: boolean
  /** Effektiver MwSt-Satz (Override oder global) */
  mwstSatz: number
  /** MwSt-Betrag CHF (= betragNetto × mwstSatz, falls anwenden) */
  mwstBetrag: number
  /** Brutto-Betrag inkl. MwSt */
  betragBrutto: number
  /** Beschreibung der Berechnung — Text für die UI */
  berechnungs_info: string
  /** Nur im Konsolidiert-Aggregat: Kennwert über die Etappen uneinheitlich. */
  kennwertGemischt?: boolean
}

export interface BkpErgebnis {
  positionen: Record<string, PositionResult>
  hauptgruppenSummenNetto: Record<BkpHauptgruppe, number>
  hauptgruppenSummenMwst:  Record<BkpHauptgruppe, number>
  totalNetto: number
  totalMwst:  number
  totalBrutto: number
}

const zeroHg = (): Record<BkpHauptgruppe, number> =>
  ({ 0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0, 8:0, 9:0 })
const HG_ALL: BkpHauptgruppe[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

export function berechneAnlagekosten(
  eintraege: Map<string, BkpEintrag>,
  mengen: BkpMengen,
  positionsList?: BkpPosition[],
  typFor?: (code: string) => BerechnungsTyp,
): BkpErgebnis {
  // Positionsliste (Katalog + ggf. eigene Zeilen), stabil nach Hauptgruppe geordnet.
  const posList = positionsList ?? BKP_POSITIONEN
  const ordered = [...posList].sort((a, b) => a.hauptgruppe - b.hauptgruppe)

  // Fixpunkt-Mehrfachdurchlauf: löst beliebige Referenzen auf — auch
  // Vorwärts-Referenzen (z.B. Pos. 160 in HG 1 → HG 2, oder vom User gewählte
  // „% von"-Basen, die später berechnet werden). Jeder Pass rechnet die
  // %/‰-/Rückstellungs-Bezüge auf den (vollständigen) Summen des Vorpasses.
  let refSummen = zeroHg()
  let refRueck  = zeroHg()
  let refPosNetto: Record<string, number> = {}

  let positionen: Record<string, PositionResult> = {}
  let summenNetto = zeroHg()
  let summenMwst  = zeroHg()

  for (let pass = 0; pass < 8; pass++) {
    positionen = {}
    summenNetto = zeroHg()
    summenMwst  = zeroHg()
    const rueck: Record<BkpHauptgruppe, number> = zeroHg()
    const posNetto: Record<string, number> = {}

    for (const pos of ordered) {
      const code = pos.code
      const typ = typFor ? typFor(code) : pos.typ
      const eintrag = eintraege.get(code) ?? null
      const status   = eintrag?.status   ?? pos.defaultStatus
      const kennwert = eintrag?.kennwert ?? pos.defaultKennwert ?? null
      const kennwert2 = eintrag?.kennwert2 ?? null
      const bezug    = eintrag?.bezugsmenge_override ?? null

      const mwstAnwenden = eintrag?.mwst_anwenden ?? pos.mwst
      const mwstSatz     = eintrag?.mwst_satz_override ?? mengen.mwst_satz_global
      const einheiten    = einheitenFuerTyp(typ)
      const mengeEinheit = (typ.kind === 'manuell_menge_einheit' && eintrag?.mengen_einheit_override)
        ? eintrag.mengen_einheit_override
        : einheiten.mengeEinheit
      const preisEinheit = einheiten.preisEinheit

      let betragNetto: number | null = null
      let menge: number | null = null
      let info = ''

      if (status !== 'beruecksichtigt') {
        betragNetto = 0
        menge = null
        info = status === 'nicht_relevant' ? 'nicht relevant' : 'nicht berücksichtigt'
      } else if (eintrag?.betrag_override != null) {
        betragNetto = eintrag.betrag_override
        info = 'manuell überschrieben'
      } else {
        // Bezüge (%/‰, Hauptgruppen, andere Positionen, Rückstellung) auf den
        // vollständigen Summen des Vorpasses — so lösen sich Vorwärts-Referenzen.
        const res = berechnePosition(typ, kennwert, kennwert2, bezug, refSummen, refRueck, mengen,
          (c) => refPosNetto[c] ?? 0)
        betragNetto = res.betrag
        menge = res.menge
        info = res.info
      }

      const mwstBetrag  = (mwstAnwenden && betragNetto != null) ? betragNetto * mwstSatz : 0
      const betragBrutto = (betragNetto ?? 0) + mwstBetrag

      positionen[code] = {
        position: pos, status, kennwert, kennwert2,
        betragOverride: eintrag?.betrag_override ?? null,
        menge, mengeEinheit, preisEinheit, betragNetto,
        mwstAnwenden, mwstSatz, mwstBetrag, betragBrutto,
        berechnungs_info: info,
      }
      posNetto[code] = betragNetto ?? 0

      if (status === 'beruecksichtigt' && betragNetto != null) {
        summenNetto[pos.hauptgruppe] += betragNetto
        if (mwstAnwenden) summenMwst[pos.hauptgruppe] += mwstBetrag
        if (mengen.rueckstellungs_codes.has(code)) rueck[pos.hauptgruppe] += betragNetto
      }
    }

    const converged = HG_ALL.every((k) => summenNetto[k] === refSummen[k])
    refSummen = summenNetto
    refRueck  = rueck
    refPosNetto = posNetto
    if (converged) break
  }

  const totalNetto  = HG_ALL.reduce((s: number, k) => s + summenNetto[k], 0)
  const totalMwst   = HG_ALL.reduce((s: number, k) => s + summenMwst[k], 0)

  return {
    positionen,
    hauptgruppenSummenNetto: summenNetto,
    hauptgruppenSummenMwst:  summenMwst,
    totalNetto, totalMwst, totalBrutto: totalNetto + totalMwst,
  }
}

function berechnePosition(
  typ: BerechnungsTyp,
  kennwert: number | null,
  kennwert2: number | null,
  bezugsmenge: number | null,
  summenNetto: Record<BkpHauptgruppe, number>,
  rueckstellungNettoProGruppe: Record<BkpHauptgruppe, number>,
  mengen: BkpMengen,
  getPosNetto: (code: string) => number,
): { betrag: number | null; menge: number | null; info: string } {
  switch (typ.kind) {
    case 'pauschal':
      if (kennwert == null) return { betrag: null, menge: null, info: 'pauschal — Kennwert fehlt' }
      return { betrag: kennwert, menge: null, info: 'pauschal' }

    case 'chf_pro_m2_gsf':
      if (kennwert == null) return { betrag: null, menge: mengen.gsf_total_m2, info: 'Kennwert fehlt' }
      return { betrag: kennwert * mengen.gsf_total_m2, menge: mengen.gsf_total_m2, info: 'CHF/m² × GSF' }

    case 'chf_pro_m2_vmf':
      if (kennwert == null) return { betrag: null, menge: mengen.vmf_total_m2, info: 'Kennwert fehlt' }
      return { betrag: kennwert * mengen.vmf_total_m2, menge: mengen.vmf_total_m2, info: 'CHF/m² × VMF' }

    case 'chf_pro_m2_uf':
      if (kennwert == null) return { betrag: null, menge: mengen.uf_total_m2, info: 'Kennwert fehlt' }
      return { betrag: kennwert * mengen.uf_total_m2, menge: mengen.uf_total_m2, info: 'CHF/m² × UF' }

    case 'chf_pro_m3_abbruch':
      if (kennwert == null || bezugsmenge == null) {
        return { betrag: null, menge: bezugsmenge, info: 'CHF/m³ × m³ — Werte fehlen' }
      }
      return { betrag: kennwert * bezugsmenge, menge: bezugsmenge, info: 'CHF/m³ × m³ Abbruch' }

    case 'prozent_von_hauptgruppen': {
      let basis = typ.gruppen.reduce((s: number, g) => s + summenNetto[g], 0)
      // Bei exklRueckstellung die Rückstellungen (Pos. 560/570) aus der Basis
      // herausrechnen — aber nur, soweit sie in den Bezugsgruppen liegen.
      if (typ.exklRueckstellung) {
        basis -= typ.gruppen.reduce((s: number, g) => s + rueckstellungNettoProGruppe[g], 0)
      }
      if (kennwert == null) return { betrag: null, menge: basis, info: 'Prozentsatz fehlt' }
      const groupsLabel = typ.gruppen.length === 1
        ? `Pos. ${typ.gruppen[0]}`
        : `Pos. ${Math.min(...typ.gruppen)}–${Math.max(...typ.gruppen)}`
      const info = typ.exklRueckstellung ? `% × ${groupsLabel} (excl. Rückst.)` : `% × ${groupsLabel}`
      return { betrag: basis * kennwert, menge: basis, info }
    }

    case 'finanzierung': {
      if (kennwert == null) return { betrag: null, menge: bezugsmenge, info: 'Zinssatz fehlt' }
      const monate = bezugsmenge ?? 0
      if (monate <= 0) return { betrag: null, menge: 0, info: 'Laufzeit (Mt) fehlt' }
      // Basis: gewählte Positionen/Hauptgruppen (refs) — sonst Katalog-Hauptgruppen.
      const basis = (typ.refs && typ.refs.length > 0)
        ? refsBasis(typ.refs, summenNetto, getPosNetto)
        : typ.gruppen.reduce((s: number, g) => s + summenNetto[g], 0)
      // Anteil der Finanzierung (z.B. 0.38). Default 0.5, falls nicht erfasst.
      const anteil = kennwert2 ?? 0.5
      const betrag = basis * kennwert * (monate / 12) * anteil
      return { betrag, menge: monate, info: 'Basis × Zins × Mt/12 × Anteil' }
    }

    case 'von_ertrag_vereinfacht':
      if (kennwert == null) return { betrag: null, menge: null, info: 'Pauschal' }
      return { betrag: kennwert, menge: null, info: 'Pauschal (Ertrags-Anteil)' }

    case 'auf_mehrwert': {
      if (kennwert == null || bezugsmenge == null) {
        return { betrag: null, menge: bezugsmenge, info: '% × Mehrwert — Werte fehlen' }
      }
      return { betrag: kennwert * bezugsmenge, menge: bezugsmenge, info: '% × CHF-Mehrwert' }
    }

    case 'manuell_menge_einheit': {
      if (kennwert == null || bezugsmenge == null) {
        return { betrag: null, menge: bezugsmenge, info: 'Menge × EH-Preis — Werte fehlen' }
      }
      return { betrag: kennwert * bezugsmenge, menge: bezugsmenge, info: 'Menge × EH-Preis' }
    }

    case 'chf_pro_m3_bkp2': {
      const m3 = mengen.bkp2_m3[typ.rowKey] ?? 0
      if (kennwert == null) return { betrag: null, menge: m3, info: 'CHF/m³ — Kennwert fehlt' }
      return { betrag: kennwert * m3, menge: m3, info: 'CHF/m³ × m³' }
    }

    case 'prozent_von_refs': {
      const base = refsBasis(typ.refs, summenNetto, getPosNetto)
      if (kennwert == null) return { betrag: null, menge: base, info: '% von Auswahl — % fehlt' }
      return { betrag: kennwert * base, menge: base, info: '% von Auswahl' }
    }

    case 'promille_von_refs': {
      const base = refsBasis(typ.refs, summenNetto, getPosNetto)
      if (kennwert == null) return { betrag: null, menge: base, info: '‰ von Auswahl — ‰ fehlt' }
      return { betrag: (kennwert / 1000) * base, menge: base, info: '‰ von Auswahl' }
    }

    case 'prozent_von_ertrag': {
      // Menge = Σ (Ertrag/Verkaufserlös der gewählten Nutzung × deren %) → als Basis
      // in der Menge-Spalte. Betrag = Menge × Kennwert (% als Faktor).
      let basis = 0
      for (const r of typ.refs) {
        if (r.kind !== 'nutzung') continue
        basis += (mengen.ertrag_pro_nutzung[r.ref] ?? 0) * ((r.prozent ?? 100) / 100)
      }
      if (kennwert == null) return { betrag: null, menge: basis, info: '% der Erträge/Verkaufserlöse — % fehlt' }
      return { betrag: basis * kennwert, menge: basis, info: '% × Erträge/Verkaufserlöse nach Nutzung' }
    }
  }
}

/** Basis-Summe für prozent/promille_von_refs: Positionen + ganze Hauptgruppen. */
function refsBasis(
  refs: BaseRef[],
  summenNetto: Record<BkpHauptgruppe, number>,
  getPosNetto: (code: string) => number,
): number {
  let base = 0
  for (const r of refs) {
    if (r.kind === 'position') base += getPosNetto(r.ref)
    else base += summenNetto[Number(r.ref) as BkpHauptgruppe] ?? 0
  }
  return base
}
