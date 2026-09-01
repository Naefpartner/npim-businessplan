import { useMemo } from 'react'
import { berechneAusnutzung } from '@/lib/ausnutzung'
import { formatNumber } from '@/lib/utils'
import type { Parcel, Project, ZoneRegulation } from '@/types'
import type { NutzungDaten, TabellenZeile } from '@/components/bericht/BerichtDokument'

/** Fläche in m², sonst Gedankenstrich. */
function m2(v: number | null | undefined): string {
  return v != null ? formatNumber(Math.round(v)) : '—'
}

/** Ziffer mit drei Stellen — AZ, BMZ, ÜZ und FFZ sind feine Werte. */
function ziffer(v: number | null | undefined): string {
  return v != null ? v.toFixed(3) : '—'
}

function pct(v: number | null | undefined): string {
  return v != null ? `${formatNumber(v)} %` : '—'
}

/** Geschosszahl und Anrechnung als eine Angabe, eng gesetzt: die Spalte ist
 *  schmal, und mit Leerzeichen bräche sie um. */
function geschossAnteil(zahl: number | null | undefined, anteil: number | null | undefined): string {
  return zahl != null ? `${formatNumber(zahl)}/${anteil != null ? formatNumber(anteil) : '—'}%` : '—'
}

/**
 * Stellt das Kapitel „Nutzungsberechnung" zusammen: die vier Wege zur
 * höchstzulässigen Vermietungsfläche nebeneinander, jeder mit seinen
 * Zwischenschritten, dazu die Zonenvorschriften und der massgebende Wert.
 *
 * Gerechnet wird nicht hier, sondern in lib/ausnutzung — dieselbe Funktion,
 * die der Reiter „Ausnutzung" verwendet.
 */
export function useNutzungDaten(
  project: Project | null,
  parzellen: Parcel[],
  zonen: ZoneRegulation[],
): NutzungDaten | undefined {
  return useMemo(() => {
    if (!project || parzellen.length === 0) return undefined
    const a = berechneAusnutzung(parzellen, zonen, project)
    if (a.uniqueZones.length === 0) return undefined

    // ── Grundlagen ─────────────────────────────────────────────────────────
    const grundlagen: TabellenZeile[] = [
      ...parzellen.map((p) => ({
        zellen: [p.parzelle_nummer, p.zone ?? '—', m2(p.flaeche_m2), m2(p.agsf_m2)],
      })),
      ...(a.uebertrag != null
        ? [{ zellen: ['Ausnützungsübertragung', '', '', m2(a.uebertrag)] }]
        : []),
      { total: true, zellen: ['Total', '', m2(a.gsf), m2(a.totalAgsf)] },
    ]

    const zonenZeilen: TabellenZeile[] = a.uniqueZones.map((z) => {
      const r = a.regByZone.get(z)
      return {
        zellen: [
          z,
          ziffer(r?.az), ziffer(r?.bmz), ziffer(r?.uez), ziffer(r?.ffz),
          r?.vollgeschosse != null ? String(r.vollgeschosse) : '—',
          geschossAnteil(r?.dg, r?.dg_pct),
          geschossAnteil(r?.anrech_ug, r?.anrech_ug_pct),
        ],
      }
    })

    // ── Die vier Wege ──────────────────────────────────────────────────────
    const wege: NutzungDaten['wege'] = []

    if (a.hasAZ) {
      // aGSF je Zone — Bezugsgrösse der zonenweisen aBGF.
      const agsfZone = new Map<string, number>()
      for (const r of a.azRows) {
        if (r.agsf == null) continue
        agsfZone.set(r.zone_type, (agsfZone.get(r.zone_type) ?? 0) + r.agsf)
      }
      const azZeilen: TabellenZeile[] = []
      for (const g of a.azPerFloorRows) {
        const az = a.regByZone.get(g.zone_type)?.az
        azZeilen.push(
          { zellen: [`${g.zone_type} · aGSF ${m2(agsfZone.get(g.zone_type))} m² × AZ ${ziffer(az)}`,
            m2(g.abgf)] },
          { zellen: ['Anzahl Vollgeschosse', g.vg != null ? formatNumber(g.vg) : '—'] },
          { zellen: ['aBGF pro Vollgeschoss', m2(g.abgfPerFloor)] },
        )
        if (g.abgfUG != null) {
          azZeilen.push({
            zellen: [`aBGF UG · ${formatNumber(g.ugFlr ?? 0)} × ${pct(g.ugPct)}`, m2(g.abgfUG)],
          })
        }
        if (g.abgfDG != null) {
          azZeilen.push({
            zellen: [`aBGF DG · ${formatNumber(g.dgFlr ?? 0)} × ${pct(g.dgPct)}`, m2(g.abgfDG)],
          })
        }
      }
      azZeilen.push(
        { zellen: ['Total aBGF', m2(a.resultAZwithUG)] },
        { zellen: ['VMF (VKF) / aBGF', pct(project.vmf_az_anrechenbar_pct)] },
        { total: true, zellen: ['Total VMF (VKF)', m2(a.vmfMaxAZ)] },
      )
      wege.push({
        // Der Wert wechselt die Einheit — Fläche, Geschosszahl, Anteil.
        titel: 'Ausnützungsziffer AZ',
        kopf: ['Schritt', 'Wert'],
        zeilen: azZeilen,
        ergebnis: a.vmfMaxAZ,
      })
    }

    if (a.hasBM) {
      wege.push({
        titel: 'Baumassenziffer BM',
        kopf: ['Schritt', 'm² / m³'],
        zeilen: [
          ...a.bmRows.map((r) => ({
            zellen: [`Parzelle ${r.parcel_number} · BMZ ${ziffer(r.bmz)} × ${m2(r.agsf)} m²`,
              m2(r.baumasse)],
          })),
          { zellen: ['Baumasse m³', m2(a.totalBaumasse)] },
          ...(project.vmf_bm_gelaendekorrektur_pct != null
            ? [{ zellen: [`Geländekorrektur ${pct(project.vmf_bm_gelaendekorrektur_pct)}`,
                m2(a.korrigierteBaumasse)] }] : []),
          { zellen: [`Geschossfläche bei ${formatNumber(project.vmf_bm_geschosshoehe_m ?? 0)} m Höhe`,
            m2(a.geschossflaecheBM)] },
          { zellen: [`davon vermietbar ${pct(project.vmf_bm_vmf_gf_pct)}`, m2(a.vmfMaxBM)] },
        ],
        ergebnis: a.vmfMaxBM,
      })
    }

    if (a.hasUZ) {
      wege.push({
        titel: 'Überbauungsziffer ÜZ',
        kopf: ['Schritt', 'm²'],
        zeilen: [
          ...a.uzZoneRows.map((r) => ({
            zellen: [`${r.zone_type} · ÜZ ${ziffer(r.ziffer)} × ${m2(r.agsf)} m² × ${r.vg ?? '—'} VG`,
              m2(r.totalGf)],
          })),
          { zellen: ['Geschossfläche total', m2(a.totalGfUZ)] },
          { zellen: [`davon vermietbar ${pct(project.vmf_uz_vmf_gf_pct)}`, m2(a.vmfMaxUZ)] },
        ],
        ergebnis: a.vmfMaxUZ,
      })
    }

    if (a.hasFF) {
      wege.push({
        titel: 'Freiflächenziffer FFZ',
        kopf: ['Schritt', 'm²'],
        zeilen: [
          ...a.ffZoneRows.map((r) => ({
            zellen: [
              `${r.zone_type} · (1 − ${ziffer(r.ziffer)}) × ${m2(r.agsf)} m² × ${r.vg ?? '—'} VG`,
              m2(r.totalGf),
            ],
          })),
          { zellen: ['Geschossfläche total', m2(a.totalGfFF)] },
          { zellen: [`davon vermietbar ${pct(project.vmf_ff_vmf_gf_pct)}`, m2(a.vmfMaxFF)] },
        ],
        ergebnis: a.vmfMaxFF,
      })
    }

    if (wege.length === 0) return undefined

    return {
      grundlagen: {
        kopf: ['Parzelle', 'Zone', 'GSF m²', 'aGSF m²'],
        zeilen: grundlagen,
      },
      zonen: {
        kopf: ['Zone', 'AZ', 'BMZ', 'ÜZ', 'FFZ', 'VG', 'DG', 'UG'],
        zeilen: zonenZeilen,
      },
      wege,
      // Massgebend ist der kleinste der vier Wege — er begrenzt das Projekt.
      massgebend: a.vmfMaxCalc,
      massgebendWeg: wege.find((w) => w.ergebnis === a.vmfMaxCalc)?.titel ?? null,
    }
  }, [project, parzellen, zonen])
}
