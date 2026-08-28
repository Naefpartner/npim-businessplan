import { useMemo } from 'react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { ermittleKeeValueMengen, istErdgeschoss } from '@/lib/keevalue'
import { formatNumber } from '@/lib/utils'
import { HAUPTGRUPPEN } from '@/lib/bkpKatalog'
import { berechneKostenmiete, basisFromErgebnis, sammleKostenmieteMengen } from '@/lib/kostenmiete'
import { useKostenmiete } from '@/hooks/useKostenmiete'
import {
  PHASE_LABEL, EIGENTUMSART_LABEL,
  type Project, type ProjectVariant, type Parcel, type ExistingBuilding, type Customer,
} from '@/types'
import type { AuftragAnrede } from '@/lib/bericht'
import type {
  Feld, UebersichtDaten, TabellenZeile, BetragZeile,
} from '@/components/bericht/BerichtDokument'

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
  variant: ProjectVariant | null,
  parzellen: Parcel[],
  bestand: ExistingBuilding[],
  situationsplanUrl: string | null,
  kunde: Customer | null,
  /** Beschriftung der ersten Zeile — dieselbe Wahl wie auf dem Titelblatt. */
  anrede: AuftragAnrede,
): UebersichtDaten | undefined {
  const ak = useAnlagekostenShared()
  // Parameter der Kostenmiete — nur für den Genossenschaftsblock nötig.
  const { params: kostenmieteParams } = useKostenmiete(variant?.id ?? '')

  return useMemo(() => {
    if (!project || !variant) return undefined

    const mengen = ermittleKeeValueMengen(ak.buildings, ak.gsfTotal)

    // Wohnungen: Mieteinheiten der Wohnnutzungen, sonst die Anzahl der Flächen.
    const wohnungen = ak.buildings.reduce((s, b) => s + b.mietflaechen.reduce((a, m) => {
      if (!/wohn/i.test(m.nutzung ?? '')) return a
      const units = m.mieteinheiten ?? []
      return a + (units.length > 0 ? units.reduce((x, u) => x + (u.anzahl ?? 1), 0) : (m.anzahl ?? 0))
    }, 0), 0)

    // Ohne bezeichnetes Erdgeschoss lässt sich die Umgebungsfläche nicht ableiten.
    const hatEg = ak.buildings.some((b) => b.mietflaechen.some((m) => istErdgeschoss(m.geschoss_bezeichnung)))

    // Anlagekosten und Ertrag aus der aktiven Erfassungsmethode.
    const ertrag = ak.presentEig.reduce(
      (s, eig) => s + Object.values(ak.ertragProNutzungByEig.get(eig) ?? {}).reduce((a, v) => a + v, 0), 0)

    const strasse = [project.strasse, project.hausnummer].filter(Boolean).join(' ').trim()
    const ortschaft = [project.plz, project.ort].filter(Boolean).join(' ').trim()

    const auftrag: Feld[] = ohneLeere([
      { label: anrede,          wert: w(kunde?.name) },
      { label: 'Projektnummer', wert: w(project.project_number) },
      { label: 'Strasse',       wert: w(strasse) },
      { label: 'Ortschaft',     wert: w(ortschaft) },
      { label: 'Variante',      wert: w(variant.name) },
      { label: 'Projektphase',  wert: PHASE_LABEL[variant.phase] },
      { label: 'Etappen',       wert: ak.etappen.length > 1 ? String(ak.etappen.length) : '—' },
    ])

    const flaechen: Feld[] = ohneLeere([
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

    // ── Grundstücke ─────────────────────────────────────────────────────────
    const gsZeilen: TabellenZeile[] = parzellen.map((p) => ({
      zellen: [
        p.parzelle_nummer,
        p.zone ?? '—',
        p.flaeche_m2 != null ? formatNumber(p.flaeche_m2) : '—',
      ],
    }))
    if (parzellen.length > 1) {
      gsZeilen.push({ zellen: ['Total', '', formatNumber(ak.gsfTotal)], total: true })
    }

    // ── Bestandsgebäude ─────────────────────────────────────────────────────
    const bestandZeilen: TabellenZeile[] = bestand.map((b) => ({
      zellen: [
        b.bezeichnung,
        b.baujahr != null ? String(b.baujahr) : '—',
        b.nutzung ?? '—',
        b.volumen_m3 != null ? formatNumber(b.volumen_m3) : '—',
      ],
    }))

    // ── Anlagekosten je Hauptgruppe ─────────────────────────────────────────
    const hgNetto: Record<number, number> = {}
    const hgBrutto: Record<number, number> = {}
    for (let c = 0; c <= 9; c++) { hgNetto[c] = 0; hgBrutto[c] = 0 }
    for (const eig of ak.presentEig) {
      const erg = ak.konsolidiertEffektiv.get(eig)
      if (!erg) continue
      for (let c = 0; c <= 9; c++) {
        const k = c as keyof typeof erg.hauptgruppenSummenNetto
        const n = erg.hauptgruppenSummenNetto[k] ?? 0
        const mw = erg.hauptgruppenSummenMwst[k] ?? 0
        hgNetto[c] += n
        hgBrutto[c] += n + mw
      }
    }
    // Die Reserve steckt in Hauptgruppe 9 und wird dort herausgelöst, damit
    // sie als eigene Zeile erscheint, ohne doppelt zu zählen.
    let reserveNetto = 0
    let reserveBrutto = 0
    for (const eig of ak.presentEig) {
      const p = ak.konsolidiertEffektiv.get(eig)?.positionen['970']
      reserveNetto += p?.betragNetto ?? 0
      reserveBrutto += (p?.betragNetto ?? 0) + (p?.mwstBetrag ?? 0)
    }

    const kosten: BetragZeile[] = HAUPTGRUPPEN
      .filter((h) => h.code >= 1 && h.code <= 9)
      .map((h) => ({
        code: String(h.code),
        label: h.label,
        netto: h.code === 9 ? hgNetto[9] - reserveNetto : hgNetto[h.code],
        brutto: h.code === 9 ? hgBrutto[9] - reserveBrutto : hgBrutto[h.code],
      }))
      .filter((z) => z.netto !== 0 || z.brutto !== 0)
    if (reserveNetto !== 0 || reserveBrutto !== 0) {
      kosten.push({ code: '', label: 'Reserve', netto: reserveNetto, brutto: reserveBrutto })
    }
    if (kosten.length > 0) {
      const summeNetto = kosten.reduce((a, z) => a + z.netto, 0)
      const summeBrutto = kosten.reduce((a, z) => a + z.brutto, 0)
      kosten.push({ code: '', label: 'Total', netto: summeNetto, brutto: summeBrutto, total: true })
    }

    // ── Erträge je Nutzung ──────────────────────────────────────────────────
    const ertragZeilen: TabellenZeile[] = []
    for (const eig of ak.presentEig) {
      const proNutzung = ak.ertragProNutzungByEig.get(eig) ?? {}
      for (const [nutzung, betrag] of Object.entries(proNutzung)) {
        if (betrag <= 0) continue
        ertragZeilen.push({ zellen: [nutzung, EIGENTUMSART_LABEL[eig], formatNumber(Math.round(betrag))] })
      }
    }
    ertragZeilen.sort((a, b) => Number(b.zellen[2].replace(/\D/g, '')) - Number(a.zellen[2].replace(/\D/g, '')))
    if (ertragZeilen.length > 0) {
      ertragZeilen.push({ zellen: ['Total', '', formatNumber(Math.round(ertrag))], total: true })
    }

    // ── Wirtschaftlichkeit je Nutzungsart ───────────────────────────────────
    // Renditeobjekt → Rendite, Verkaufsobjekt → Gewinn, Genossenschaft →
    // Kostenmiete. Es erscheint nur, was in der Variante auch vorkommt.
    const wirtschaftBloecke: { titel: string; felder: Feld[] }[] = []
    for (const eig of ak.presentEig) {
      const erg = ak.konsolidiertEffektiv.get(eig)
      if (!erg) continue
      const invest = erg.totalBrutto
      const eigErtrag = Object.values(ak.ertragProNutzungByEig.get(eig) ?? {})
        .reduce((a, v) => a + v, 0)

      if (eig === 'renditeobjekt') {
        wirtschaftBloecke.push({
          titel: 'Rendite (Renditeobjekt)',
          felder: ohneLeere([
            { label: 'Anlagekosten inkl. MwSt', wert: invest > 0 ? w(Math.round(invest), 'CHF') : '—' },
            { label: 'Mietertrag SOLL p.a.',    wert: eigErtrag > 0 ? w(Math.round(eigErtrag), 'CHF') : '—' },
            { label: 'Bruttorendite',           wert: invest > 0 && eigErtrag > 0
                ? `${((eigErtrag / invest) * 100).toFixed(2)} %` : '—' },
          ]),
        })
      } else if (eig === 'verkaufsobjekt') {
        const gewinn = eigErtrag - invest
        wirtschaftBloecke.push({
          titel: 'Verkaufsgewinn (Stockwerkeigentum)',
          felder: ohneLeere([
            { label: 'Verkaufserlös',           wert: eigErtrag > 0 ? w(Math.round(eigErtrag), 'CHF') : '—' },
            { label: 'Anlagekosten inkl. MwSt', wert: invest > 0 ? w(Math.round(invest), 'CHF') : '—' },
            { label: 'Verkaufsgewinn',          wert: eigErtrag > 0 ? w(Math.round(gewinn), 'CHF') : '—' },
            { label: 'Marge auf dem Erlös',     wert: eigErtrag > 0
                ? `${((gewinn / eigErtrag) * 100).toFixed(1)} %` : '—' },
          ]),
        })
      } else if (eig === 'genossenschaft') {
        const mengenG = sammleKostenmieteMengen(ak.buildings, null)
        const km = mengenG.wohnenFlaeche > 0
          ? berechneKostenmiete(
              basisFromErgebnis(erg, mengenG.vmf, mengenG.wohnenFlaeche, mengenG.wohnungen),
              kostenmieteParams, mengenG.ertragsNutzungen)
          : null
        wirtschaftBloecke.push({
          titel: 'Kostenmiete (Genossenschaft)',
          felder: ohneLeere([
            { label: 'Anlagekosten inkl. MwSt', wert: invest > 0 ? w(Math.round(invest), 'CHF') : '—' },
            { label: 'Kostenmiete Wohnen',      wert: km ? `${formatNumber(Math.round(km.proM2Jahr))} CHF/m²·a` : '—' },
            { label: 'Maximaler Mietertrag',    wert: km ? w(Math.round(km.maxMietertragWohnen), 'CHF') : '—' },
          ]),
        })
      }
    }

    return {
      situationsplanUrl,
      auftrag,
      // Kurze Einheitenköpfe: „Volumen m³" bräuchte in der geteilten Spalte
      // zwei Zeilen und verschöbe die Kopfzeile gegenüber der Nachbartabelle.
      grundstuecke: { kopf: ['Parzelle', 'Zone', 'm²'], zeilen: gsZeilen },
      bestand: { kopf: ['Gebäude', 'Baujahr', 'Nutzung', 'm³'], zeilen: bestandZeilen },
      mengen: flaechen,
      kosten,
      ertraege: { kopf: ['Nutzung', 'Nutzungsart', 'CHF'], zeilen: ertragZeilen },
      wirtschaft: wirtschaftBloecke,
    }
  }, [project, variant, parzellen, bestand, situationsplanUrl, kunde, anrede, ak, kostenmieteParams])
}
