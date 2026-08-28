import { useMemo } from 'react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { ermittleKeeValueMengen, istErdgeschoss } from '@/lib/keevalue'
import { formatNumber } from '@/lib/utils'
import {
  PHASE_LABEL, VARIANT_STATUS_LABEL, EIGENTUMSART_LABEL, KOSTEN_METHODE_LABEL,
  projectAddressLine,
  type Project, type ProjectVariant, type Parcel, type Customer,
} from '@/types'
import type { Feld, UebersichtDaten } from '@/components/bericht/BerichtDokument'

/** Wert oder Gedankenstrich — leere Zeilen sollen im Bericht sichtbar leer sein. */
function w(v: string | number | null | undefined, einheit = ''): string {
  if (v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v))) return '—'
  const t = typeof v === 'number' ? formatNumber(v) : v
  return einheit ? `${t} ${einheit}` : t
}

/** Nur Zeilen mit Inhalt behalten, damit die Tabellen nicht leer laufen. */
function ohneLeere(felder: Feld[]): Feld[] {
  return felder.filter((f) => f.wert !== '—')
}

/**
 * Stellt die Projektübersicht zusammen. Bewusst als Daten und nicht als
 * Layout — Zeilen lassen sich damit umstellen, ohne das PDF anzufassen.
 *
 * Muss innerhalb des VariantDataProvider aufgerufen werden: Mengen und
 * Anlagekosten kommen aus der gewählten Erfassungsmethode, damit die
 * Übersicht dieselben Zahlen zeigt wie die Fachkapitel.
 */
export function useUebersichtDaten(
  project: Project | null,
  kunde: Customer | null,
  variant: ProjectVariant | null,
  parzellen: Parcel[],
): UebersichtDaten | undefined {
  const ak = useAnlagekostenShared()

  return useMemo(() => {
    if (!project || !variant) return undefined

    const mengen = ermittleKeeValueMengen(ak.buildings, ak.gsfTotal)
    const nutzungen = ak.presentEig.map((e) => EIGENTUMSART_LABEL[e]).join(' · ')

    // Wohnungen: Mieteinheiten der Wohnnutzungen, sonst die Anzahl der Flächen.
    const wohnungen = ak.buildings.reduce((s, b) => s + b.mietflaechen.reduce((a, m) => {
      if (!/wohn/i.test(m.nutzung ?? '')) return a
      const units = m.mieteinheiten ?? []
      return a + (units.length > 0 ? units.reduce((x, u) => x + (u.anzahl ?? 1), 0) : (m.anzahl ?? 0))
    }, 0), 0)

    // Geschosse: verschiedene Erdgeschoss-Bezeichnungen sind der Fussabdruck.
    const gemeinden = [...new Set(parzellen.map((p) => p.gemeinde).filter(Boolean))] as string[]
    const kantone = [...new Set(parzellen.map((p) => p.kanton).filter(Boolean))] as string[]
    const zonen = [...new Set(parzellen.map((p) => p.zone).filter(Boolean))] as string[]
    const nummern = parzellen.map((p) => p.parzelle_nummer).filter(Boolean)
    const hatEg = ak.buildings.some((b) => b.mietflaechen.some((m) => istErdgeschoss(m.geschoss_bezeichnung)))

    // Anlagekosten und Ertrag aus der aktiven Erfassungsmethode.
    let kostenNetto = 0
    let kostenBrutto = 0
    for (const eig of ak.presentEig) {
      const erg = ak.konsolidiertEffektiv.get(eig)
      if (!erg) continue
      kostenNetto += erg.totalNetto
      kostenBrutto += erg.totalBrutto
    }
    const ertrag = ak.presentEig.reduce(
      (s, eig) => s + Object.values(ak.ertragProNutzungByEig.get(eig) ?? {}).reduce((a, v) => a + v, 0), 0)

    const objekt: Feld[] = ohneLeere([
      { label: 'Projekt',            wert: w(project.name) },
      { label: 'Adresse',            wert: w(projectAddressLine(project)) },
      { label: 'Gemeinde',           wert: w([gemeinden.join(', '), kantone.join(', ')].filter(Boolean).join(' · ')) },
      { label: 'Parzellen',          wert: nummern.length ? nummern.join(', ') : '—' },
      { label: 'Grundstücksfläche',  wert: ak.gsfTotal > 0 ? w(ak.gsfTotal, 'm²') : '—' },
      { label: 'Zone',               wert: zonen.length ? zonen.join(', ') : '—' },
    ])

    const auftrag: Feld[] = ohneLeere([
      { label: 'Kundschaft',      wert: w(kunde?.name) },
      { label: 'Projektnummer',   wert: w(project.project_number) },
      { label: 'Variante',        wert: w(variant.name) },
      { label: 'Projektphase',    wert: PHASE_LABEL[variant.phase] },
      { label: 'Status',          wert: VARIANT_STATUS_LABEL[variant.status] },
      { label: 'Nutzungsarten',   wert: w(nutzungen) },
      { label: 'Etappen',         wert: ak.etappen.length > 1 ? String(ak.etappen.length) : '—' },
    ])

    const flaechen: Feld[] = ohneLeere([
      { label: 'Gebäude',                wert: ak.buildings.length > 0 ? String(ak.buildings.length) : '—' },
      { label: 'Geschossfläche GF',      wert: mengen.gfM2 > 0 ? w(mengen.gfM2, 'm²') : '—' },
      { label: 'Gebäudevolumen GV',      wert: mengen.gvM3 > 0 ? w(mengen.gvM3, 'm³') : '—' },
      { label: 'davon unter Terrain',    wert: mengen.anteilUnterTerrain != null
          ? `${(mengen.anteilUnterTerrain * 100).toFixed(1)} %` : '—' },
      { label: 'Miet-/Verkaufsfläche',   wert: ak.totalVmf > 0 ? w(ak.totalVmf, 'm²') : '—' },
      { label: 'Umgebungsfläche',        wert: hatEg && mengen.bufM2 != null ? w(mengen.bufM2, 'm²') : '—' },
      { label: 'Wohnungen',              wert: wohnungen > 0 ? String(wohnungen) : '—' },
      { label: 'Parkplätze unterirdisch', wert: mengen.parkplaetzeUnterirdisch > 0
          ? String(mengen.parkplaetzeUnterirdisch) : '—' },
    ])

    const proM2 = mengen.gfM2 > 0 ? kostenBrutto / mengen.gfM2 : null
    const bruttorendite = kostenBrutto > 0 && ertrag > 0 ? ertrag / kostenBrutto : null

    const wirtschaft: Feld[] = ohneLeere([
      { label: 'Kostenermittlung',        wert: KOSTEN_METHODE_LABEL[ak.kostenMethode] },
      { label: 'Anlagekosten exkl. MwSt', wert: kostenNetto > 0 ? w(Math.round(kostenNetto), 'CHF') : '—' },
      { label: 'Anlagekosten inkl. MwSt', wert: kostenBrutto > 0 ? w(Math.round(kostenBrutto), 'CHF') : '—' },
      { label: 'Kennwert',                wert: proM2 ? `${formatNumber(Math.round(proM2))} CHF/m² GF` : '—' },
      { label: 'Ertrag / Verkaufserlös',  wert: ertrag > 0 ? w(Math.round(ertrag), 'CHF') : '—' },
      { label: 'Bruttorendite',           wert: bruttorendite ? `${(bruttorendite * 100).toFixed(2)} %` : '—' },
    ])

    return { objekt, auftrag, mengen: flaechen, wirtschaft }
  }, [project, kunde, variant, parzellen, ak])
}
