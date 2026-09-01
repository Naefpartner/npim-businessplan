import { useMemo } from 'react'
import { berechneAusnutzung } from '@/lib/ausnutzung'
import { formatNumber } from '@/lib/utils'
import type { Parcel, Project, ZoneRegulation } from '@/types'
import type { NutzungDaten, TabellenZeile } from '@/components/bericht/BerichtDokument'

/** Fläche in m², sonst Gedankenstrich. */
function m2(v: number | null | undefined): string {
  return v != null ? formatNumber(Math.round(v)) : '—'
}

/** Ziffer mit drei Stellen — nur die Ausnützungsziffer wird so fein festgelegt. */
function ziffer(v: number | null | undefined): string {
  return v != null ? v.toFixed(3) : '—'
}

/** Überbauungs- und Freiflächenziffer kommen mit zwei Stellen aus. */
function ziffer2(v: number | null | undefined): string {
  return v != null ? v.toFixed(2) : '—'
}

/** Die Baumassenziffer kommt mit einer Stelle aus. */
function ziffer1(v: number | null | undefined): string {
  return v != null ? v.toFixed(1) : '—'
}

function pct(v: number | null | undefined): string {
  return v != null ? `${formatNumber(v)} %` : '—'
}

/**
 * Geschosszahl für DG und UG. Der Anrechnungsfaktor steht nicht hier, sondern
 * im AZ-Weg, wo er auch angewendet wird — dort ist er nachvollziehbar.
 */
function geschossZahl(zahl: number | null | undefined): string {
  return zahl != null ? formatNumber(zahl) : '—'
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
  /** Zonenplan aus dem GIS; erscheint neben den Zonenvorschriften. */
  zonenplanUrl: string | null,
): NutzungDaten | undefined {
  return useMemo(() => {
    if (!project) return undefined
    const a = berechneAusnutzung(parzellen, zonen, project)
    const bemerkungen = project.ausnutzung_bemerkungen?.trim() || null

    // ── Grundlagen ─────────────────────────────────────────────────────────
    const grundlagen: TabellenZeile[] = parzellen.length === 0 ? [] : [
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
          ziffer(r?.az), ziffer1(r?.bmz), ziffer2(r?.uez), ziffer2(r?.ffz),
          r?.vollgeschosse != null ? String(r.vollgeschosse) : '—',
          geschossZahl(r?.dg),
          geschossZahl(r?.anrech_ug),
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
        { zellen: ['Total VMF (VKF)', m2(a.vmfMaxAZ)] },
      )
      wege.push({
        // Der Wert wechselt die Einheit — Fläche, Geschosszahl, Anteil.
        titel: 'Ausnutzungsberechnung',
        kopf: ['Schritt', 'Wert'],
        zeilen: azZeilen,
        ergebnis: a.vmfMaxAZ,
      })
    }

    if (a.hasBM) {
      // Je Zone eine Zeile, wie bei der Ausnutzungsberechnung: die BMZ gilt
      // ohnehin für die ganze Zone, und die Parzellenliste steht bereits unter
      // den Grundstücken.
      const bmZone = new Map<string, { agsf: number; bmz: number | null; baumasse: number }>()
      for (const r of a.bmRows) {
        if (r.agsf == null) continue
        const e = bmZone.get(r.zone_type) ?? { agsf: 0, bmz: r.bmz, baumasse: 0 }
        e.agsf += r.agsf
        e.baumasse += r.baumasse ?? 0
        bmZone.set(r.zone_type, e)
      }
      wege.push({
        titel: 'Baumassenberechnung',
        // Der Wert wechselt die Einheit — Volumen, Höhe, Fläche.
        kopf: ['Schritt', 'Wert'],
        zeilen: [
          ...[...bmZone].map(([zone, r]) => ({
            zellen: [`${zone} · aGSF ${m2(r.agsf)} m² × BMZ ${ziffer1(r.bmz)}`,
              r.bmz != null ? m2(r.baumasse) : '—'],
          })),
          { zellen: ['Baumasse m³', m2(a.totalBaumasse)] },
          ...(project.vmf_bm_gelaendekorrektur_pct != null
            ? [{ zellen: [`Geländekorrektur ${pct(project.vmf_bm_gelaendekorrektur_pct)}`,
                m2(a.korrigierteBaumasse)] }] : []),
          // Die Geschosshöhe steht als eigener Schritt: sie ist der Teiler,
          // aus dem die Geschossfläche entsteht.
          { zellen: ['Ø Geschosshöhe m',
            project.vmf_bm_geschosshoehe_m != null
              ? project.vmf_bm_geschosshoehe_m.toFixed(2) : '—'] },
          { zellen: ['Geschossfläche', m2(a.geschossflaecheBM)] },
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
            zellen: [`${r.zone_type} · ÜZ ${ziffer2(r.ziffer)} × ${m2(r.agsf)} m² × ${r.vg ?? '—'} VG`,
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
              `${r.zone_type} · (1 − ${ziffer2(r.ziffer)}) × ${m2(r.agsf)} m² × ${r.vg ?? '—'} VG`,
              m2(r.totalGf),
            ],
          })),
          { zellen: ['Geschossfläche total', m2(a.totalGfFF)] },
          { zellen: [`davon vermietbar ${pct(project.vmf_ff_vmf_gf_pct)}`, m2(a.vmfMaxFF)] },
        ],
        ergebnis: a.vmfMaxFF,
      })
    }

    // Ohne Berechnung bleibt das Kapitel bestehen, solange es etwas zu zeigen
    // gibt: Zonenplan, Bemerkungen oder wenigstens die Grundlagen. Erst wenn
    // alles fehlt, entfällt es.
    if (wege.length === 0 && !zonenplanUrl && !bemerkungen && grundlagen.length === 0) {
      return undefined
    }

    // Die letzte Zeile jedes Weges ist sein Ergebnis und wird ausgezeichnet.
    // Bei nur einem Weg trägt sie zugleich das Ergebnis der Seite — der Block
    // „Massgebende Vermietungsfläche" entfällt dann.
    for (const w of wege) {
      const letzte = w.zeilen[w.zeilen.length - 1]
      if (letzte) letzte.total = true
    }

    return {
      zonenplanUrl,
      bemerkungen,
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
  }, [project, parzellen, zonen, zonenplanUrl])
}
