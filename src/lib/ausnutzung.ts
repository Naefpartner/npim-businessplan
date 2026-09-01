// Ausnutzungsberechnung: aus Parzellen, Zonenvorschriften und den
// Projektparametern die höchstzulässige Vermietungsfläche nach vier Wegen —
// Ausnützungsziffer (AZ), Baumassenziffer (BM), Überbauungsziffer (ÜZ) und
// Freiflächenziffer (FFZ). Massgebend ist der kleinste der vier Werte.
//
// Rein rechnend und ohne React, damit der Ausnutzungs-Tab und der Bericht
// dieselben Zahlen zeigen.

import type { Parcel, Project, ZoneRegulation } from '@/types'

/** Die Projektparameter, die in die Ausnutzung eingehen. */
export type AusnutzungProjekt = Pick<
  Project,
  | 'vmf_ausnuetzungsuebertragung_m2'
  | 'vmf_az_anrechenbar_pct'
  | 'vmf_bm_geschosshoehe_m'
  | 'vmf_bm_gelaendekorrektur_pct'
  | 'vmf_bm_vmf_gf_pct'
  | 'vmf_uz_vmf_gf_pct'
  | 'vmf_ff_vmf_gf_pct'
>

export interface AzZeile {
  parcel_number: string
  zone_type: string
  az: number | null
  agsf: number | null
  /** AZ × aGSF dieser Parzelle. */
  contribution: number | null
}

export interface AzGeschossZeile {
  zone_type: string
  abgf: number | null
  vg: number | null
  abgfPerFloor: number | null
  ugFlr: number | null
  ugPct: number | null
  abgfUG: number | null
  dgFlr: number | null
  dgPct: number | null
  abgfDG: number | null
}

export interface BmZeile {
  parcel_number: string
  zone_type: string
  bmz: number | null
  agsf: number | null
  /** BMZ × aGSF dieser Parzelle. */
  baumasse: number | null
}

/** Eine Zone in der ÜZ- oder FFZ-Rechnung; `ziffer` ist ÜZ bzw. FFZ. */
export interface ZonenZeile {
  zone_type: string
  ziffer: number | null
  agsf: number | null
  /** Grundfläche je Vollgeschoss. */
  maxGfVg: number | null
  vg: number | null
  gfVg: number | null
  dg: number | null
  dgPct: number | null
  gfDg: number | null
  totalGf: number | null
}

export interface AusnutzungErgebnis {
  uniqueZones: string[]
  regByZone: Map<string, ZoneRegulation>
  gsf: number | null
  agsf: number | null
  uebertrag: number | null
  totalAgsf: number | null
  hasAZ: boolean
  hasBM: boolean
  hasUZ: boolean
  hasFF: boolean
  azRows: AzZeile[]
  resultAZ: number | null
  azPerFloorRows: AzGeschossZeile[]
  totalAbgfUg: number | null
  totalAbgfDg: number | null
  resultAZwithUG: number | null
  vmfMaxAZ: number | null
  bmRows: BmZeile[]
  totalBaumasse: number | null
  korrigierteBaumasse: number | null
  geschossflaecheBM: number | null
  vmfMaxBM: number | null
  uzZoneRows: ZonenZeile[]
  totalGfUZ: number | null
  vmfMaxUZ: number | null
  ffZoneRows: ZonenZeile[]
  totalGfFF: number | null
  vmfMaxFF: number | null
  /** Kleinster der vier Wege — die massgebende Vermietungsfläche. */
  vmfMaxCalc: number | null
}

/** aGSF je Zone, nur Parzellen mit Zone und erfasster anrechenbarer Fläche. */
function agsfJeZone(parcels: Parcel[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of parcels) {
    if (!p.zone || p.agsf_m2 == null) continue
    m.set(p.zone, (m.get(p.zone) ?? 0) + p.agsf_m2)
  }
  return m
}

/**
 * Zonenweise Rechnung für ÜZ und FFZ. Beide gehen gleich vor, nur die
 * Grundfläche je Vollgeschoss entsteht anders: bei der ÜZ direkt aus der
 * Ziffer, bei der FFZ aus dem Gegenstück (1 − FFZ).
 */
function zonenZeilen(
  zones: string[],
  regByZone: Map<string, ZoneRegulation>,
  agsfZone: Map<string, number>,
  ziffer: (r: ZoneRegulation | undefined) => number | null,
  grundflaeche: (z: number, agsf: number) => number,
): ZonenZeile[] {
  return zones.map((zone) => {
    const reg = regByZone.get(zone)
    const z = ziffer(reg)
    const ag = agsfZone.get(zone) ?? null
    const maxGfVg = z != null && ag != null ? grundflaeche(z, ag) : null
    const vg = reg?.vollgeschosse ?? null
    const gfVg = maxGfVg != null && vg != null ? maxGfVg * vg : null
    const dg = reg?.dg ?? null
    const dgPct = reg?.dg_pct ?? null
    const gfDg = maxGfVg != null && dg != null && dgPct != null
      ? maxGfVg * dg * (dgPct / 100) : null
    const totalGf = gfVg != null || gfDg != null ? (gfVg ?? 0) + (gfDg ?? 0) : null
    return { zone_type: zone, ziffer: z, agsf: ag, maxGfVg, vg, gfVg, dg, dgPct, gfDg, totalGf }
  })
}

export function berechneAusnutzung(
  parcels: Parcel[],
  regs: ZoneRegulation[],
  project: AusnutzungProjekt | null,
): AusnutzungErgebnis {
  const uniqueZones = Array.from(
    new Set(parcels.map((p) => p.zone).filter((z): z is string => !!z)),
  ).sort()
  const regByZone = new Map(regs.map((r) => [r.zone_type, r]))
  const agsfZone = agsfJeZone(parcels)

  const gsf = parcels.reduce((s, p) => s + (p.flaeche_m2 ?? 0), 0) || null
  const agsf = parcels.reduce((s, p) => s + (p.agsf_m2 ?? 0), 0) || null
  const uebertrag = project?.vmf_ausnuetzungsuebertragung_m2 ?? null
  const totalAgsf = agsf != null || uebertrag != null ? (agsf ?? 0) + (uebertrag ?? 0) : null

  // ── AZ: Σ (AZ × aGSF) je Parzelle ───────────────────────────────────────
  const azRows: AzZeile[] = parcels
    .filter((p) => p.zone)
    .map((p) => {
      const reg = regByZone.get(p.zone!)
      return {
        parcel_number: p.parzelle_nummer,
        zone_type: p.zone!,
        az: reg?.az ?? null,
        agsf: p.agsf_m2 ?? null,
        contribution: reg?.az != null && p.agsf_m2 != null ? reg.az * p.agsf_m2 : null,
      }
    })
  const resultAZ = azRows.every((r) => r.contribution == null)
    ? null
    : azRows.reduce((s, r) => s + (r.contribution ?? 0), 0)

  // aBGF je Vollgeschoss, dazu die anrechenbaren Anteile aus UG und DG.
  const jeZone = new Map<string, { abgf: number; has: boolean }>()
  for (const r of azRows) {
    const cur = jeZone.get(r.zone_type) ?? { abgf: 0, has: false }
    jeZone.set(r.zone_type, {
      abgf: cur.abgf + (r.contribution ?? 0),
      has: cur.has || r.contribution != null,
    })
  }
  const azPerFloorRows: AzGeschossZeile[] = [...jeZone.entries()].map(([zone, v]) => {
    const reg = regByZone.get(zone)
    const vg = reg?.vollgeschosse ?? null
    const abgfPerFloor = v.has && vg != null && vg > 0 ? v.abgf / vg : null
    const ugFlr = reg?.anrech_ug ?? null
    const ugPct = reg?.anrech_ug_pct ?? null
    const dgFlr = reg?.dg ?? null
    const dgPct = reg?.dg_pct ?? null
    return {
      zone_type: zone,
      abgf: v.has ? v.abgf : null,
      vg,
      abgfPerFloor,
      ugFlr,
      ugPct,
      abgfUG: abgfPerFloor != null && ugFlr != null && ugPct != null
        ? abgfPerFloor * ugFlr * (ugPct / 100) : null,
      dgFlr,
      dgPct,
      abgfDG: abgfPerFloor != null && dgFlr != null && dgPct != null
        ? abgfPerFloor * dgFlr * (dgPct / 100) : null,
    }
  })
  const totalAbgfUg = azPerFloorRows.some((r) => r.abgfUG != null)
    ? azPerFloorRows.reduce((s, r) => s + (r.abgfUG ?? 0), 0) : null
  const totalAbgfDg = azPerFloorRows.some((r) => r.abgfDG != null)
    ? azPerFloorRows.reduce((s, r) => s + (r.abgfDG ?? 0), 0) : null
  const resultAZwithUG = resultAZ != null || totalAbgfUg != null || totalAbgfDg != null
    ? (resultAZ ?? 0) + (totalAbgfUg ?? 0) + (totalAbgfDg ?? 0)
    : null
  const vmfMaxAZ = resultAZwithUG != null && project?.vmf_az_anrechenbar_pct != null
    ? resultAZwithUG * (project.vmf_az_anrechenbar_pct / 100)
    : null

  // ── BM: Σ (BMZ × aGSF), geländekorrigiert, ÷ Ø Geschosshöhe ─────────────
  const bmRows: BmZeile[] = parcels
    .filter((p) => p.zone)
    .map((p) => {
      const reg = regByZone.get(p.zone!)
      return {
        parcel_number: p.parzelle_nummer,
        zone_type: p.zone!,
        bmz: reg?.bmz ?? null,
        agsf: p.agsf_m2 ?? null,
        baumasse: reg?.bmz != null && p.agsf_m2 != null ? reg.bmz * p.agsf_m2 : null,
      }
    })
  const totalBaumasse = bmRows.every((r) => r.baumasse == null)
    ? null
    : bmRows.reduce((s, r) => s + (r.baumasse ?? 0), 0)
  const korrigierteBaumasse = totalBaumasse != null && project?.vmf_bm_gelaendekorrektur_pct != null
    ? totalBaumasse * (project.vmf_bm_gelaendekorrektur_pct / 100)
    : totalBaumasse
  const geschossflaecheBM = korrigierteBaumasse != null
    && project?.vmf_bm_geschosshoehe_m != null && project.vmf_bm_geschosshoehe_m > 0
    ? korrigierteBaumasse / project.vmf_bm_geschosshoehe_m
    : null
  const vmfMaxBM = geschossflaecheBM != null && project?.vmf_bm_vmf_gf_pct != null
    ? geschossflaecheBM * (project.vmf_bm_vmf_gf_pct / 100)
    : null

  // ── ÜZ und FFZ: Grundfläche × Vollgeschosse (+ DG), dann Anteil VMF/GF ──
  const uzZoneRows = zonenZeilen(
    uniqueZones, regByZone, agsfZone, (r) => r?.uez ?? null, (z, ag) => z * ag)
  const totalGfUZ = uzZoneRows.every((r) => r.totalGf == null)
    ? null : uzZoneRows.reduce((s, r) => s + (r.totalGf ?? 0), 0)
  const vmfMaxUZ = totalGfUZ != null && project?.vmf_uz_vmf_gf_pct != null
    ? totalGfUZ * (project.vmf_uz_vmf_gf_pct / 100)
    : null

  const ffZoneRows = zonenZeilen(
    uniqueZones, regByZone, agsfZone, (r) => r?.ffz ?? null, (z, ag) => (1 - z) * ag)
  const totalGfFF = ffZoneRows.every((r) => r.totalGf == null)
    ? null : ffZoneRows.reduce((s, r) => s + (r.totalGf ?? 0), 0)
  const vmfMaxFF = totalGfFF != null && project?.vmf_ff_vmf_gf_pct != null
    ? totalGfFF * (project.vmf_ff_vmf_gf_pct / 100)
    : null

  const treffer = [vmfMaxAZ, vmfMaxBM, vmfMaxUZ, vmfMaxFF].filter((r): r is number => r != null)

  return {
    uniqueZones, regByZone, gsf, agsf, uebertrag, totalAgsf,
    hasAZ: regs.some((r) => r.az != null),
    hasBM: regs.some((r) => r.bmz != null),
    hasUZ: regs.some((r) => r.uez != null),
    hasFF: regs.some((r) => r.ffz != null),
    azRows, resultAZ, azPerFloorRows, totalAbgfUg, totalAbgfDg, resultAZwithUG, vmfMaxAZ,
    bmRows, totalBaumasse, korrigierteBaumasse, geschossflaecheBM, vmfMaxBM,
    uzZoneRows, totalGfUZ, vmfMaxUZ,
    ffZoneRows, totalGfFF, vmfMaxFF,
    vmfMaxCalc: treffer.length > 0 ? Math.min(...treffer) : null,
  }
}
