import { useMemo } from 'react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { ermittleKeeValueMengen, istErdgeschoss } from '@/lib/keevalue'
import { formatNumber } from '@/lib/utils'
import { HAUPTGRUPPEN } from '@/lib/bkpKatalog'
import { berechneKostenmiete, basisFromErgebnis, sammleKostenmieteMengen } from '@/lib/kostenmiete'
import { useKostenmiete } from '@/hooks/useKostenmiete'
import {
  PHASE_LABEL, EIGENTUMSART_LABEL, isNutzungWohnen, effektiveWohnungCounts,
  WOHNUNGSMIX_KEYS, WOHNUNGSMIX_LABEL, WOHNUNG_FALLBACK_KEY,
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

    // Mietfläche oder Verkaufsfläche — nur wenn beides vorkommt, beides.
    const hatVerkauf = ak.presentEig.includes('verkaufsobjekt')
    const hatMiete = ak.presentEig.some((e) => e !== 'verkaufsobjekt')
    const flaechenLabel = hatVerkauf && hatMiete
      ? 'Miet-/Verkaufsfläche' : hatVerkauf ? 'Verkaufsfläche' : 'Mietfläche'

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

    // Einheit und Zahl getrennt: die Einheiten stehen so untereinander und die
    // Zahlen rechtsbündig am Spaltenrand.
    const flaechen: Feld[] = ohneLeere([
      { label: 'Geschossfläche GF',      einheit: 'm²',
        wert: mengen.gfM2 > 0 ? w(mengen.gfM2) : '—' },
      { label: 'Gebäudevolumen GV',      einheit: 'm³',
        wert: mengen.gvM3 > 0 ? w(mengen.gvM3) : '—' },
      { label: 'davon unter Terrain',    einheit: '%',
        wert: mengen.anteilUnterTerrain != null
          ? (mengen.anteilUnterTerrain * 100).toFixed(1) : '—' },
      { label: flaechenLabel,            einheit: 'm²',
        wert: ak.totalVmf > 0 ? w(ak.totalVmf) : '—' },
      { label: 'Umgebungsfläche',        einheit: 'm²',
        wert: hatEg && mengen.bufM2 != null ? w(mengen.bufM2) : '—' },
      { label: 'Wohnungen',              einheit: 'Stk',
        wert: wohnungen > 0 ? String(wohnungen) : '—' },
      { label: 'Parkplätze unterirdisch', einheit: 'Stk',
        wert: mengen.parkplaetzeUnterirdisch > 0
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
        b.gvz_nummer ?? '—',
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

    // Mit Hauptgruppe 0: das Grundstück gehört zu den Anlagekosten, und erst
    // damit deckt sich das Total mit den Anlagekosten der Wirtschaftlichkeit.
    const kosten: BetragZeile[] = HAUPTGRUPPEN
      .filter((h) => h.code >= 0 && h.code <= 9)
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

    // ── Kostenmiete der Genossenschaft ──────────────────────────────────────
    // Vor den Erträgen, weil Wohnen dort keinen erfassten Mietzins hat: der
    // Ertrag ist das Ergebnis dieser Rechnung und wird unten eingesetzt.
    const mengenG = sammleKostenmieteMengen(ak.buildings, null)
    const ergG = ak.konsolidiertEffektiv.get('genossenschaft')
    const basisG = ergG
      ? basisFromErgebnis(ergG, mengenG.vmf, mengenG.wohnenFlaeche, mengenG.wohnungen)
      : null
    const km = basisG && mengenG.wohnenFlaeche > 0
      ? berechneKostenmiete(basisG, kostenmieteParams, mengenG.ertragsNutzungen)
      : null

    // ── Erträge je Nutzung ──────────────────────────────────────────────────
    // Je Eigentumsart ein eigener Block: Rendite und Genossenschaft weisen
    // Jahresmieten aus, Stockwerkeigentum Verkaufserlöse. Nutzungen ohne
    // Fläche (Parkplätze, Garagen) rechnen nach Stück, deshalb steht die
    // Einheit in der Zelle und nicht im Spaltenkopf.
    const ertragBloecke: { titel: string; kopf: string[]; zeilen: TabellenZeile[] }[] = []
    // Nebenbei für den Nutzungsmix mitgeführt: dieselben Zahlen, aber über
    // alle Eigentumsarten zusammengezogen und ohne Ertragsfilter — eine
    // Nutzung kann Fläche beitragen, ohne Ertrag zu tragen.
    const mixFlaeche: Record<string, number> = {}
    const mixErtrag: Record<string, number> = {}
    const mixReihenfolge: string[] = []
    for (const eig of ak.presentEig) {
      // Bei der Genossenschaft trägt Wohnen die Restkosten: der Mietzins ist
      // nicht erfasst, sondern fällt aus der Kostenmiete an. Über den
      // Quadratmeteransatz verteilt er sich richtig, auch wenn mehrere
      // Wohnnutzungen erfasst sind.
      const detail = (ak.ertragDetailByEig.get(eig) ?? [])
        .map((d) => (eig === 'genossenschaft' && km && isNutzungWohnen(d.nutzung)
          ? { ...d, ertrag: km.proM2Jahr * d.flaecheM2 }
          : d))
      for (const d of detail) {
        if (!(d.nutzung in mixFlaeche)) mixReihenfolge.push(d.nutzung)
        mixFlaeche[d.nutzung] = (mixFlaeche[d.nutzung] ?? 0) + d.flaecheM2
        mixErtrag[d.nutzung] = (mixErtrag[d.nutzung] ?? 0) + d.ertrag
      }

      const mitErtrag = detail.filter((d) => d.ertrag > 0)
      if (mitErtrag.length === 0) continue
      const verkauf = eig === 'verkaufsobjekt'

      const zeilen: TabellenZeile[] = [...mitErtrag]
        .sort((a, b) => b.ertrag - a.ertrag)
        .map((d) => {
          const nachFlaeche = d.flaecheM2 > 0
          // Ob VMF oder VKF gilt für die ganze Tabelle und steht deshalb im
          // Spaltenkopf — in der Zelle kostete es die Breite, die der
          // Nutzungsname braucht.
          const menge = nachFlaeche
            ? `${formatNumber(Math.round(d.flaecheM2))} m²`
            : `${formatNumber(d.anzahl)} Stk`
          // Monatsmiete je Stück; beim Verkauf ist der Stückwert ein Preis.
          const teiler = nachFlaeche ? d.flaecheM2 : d.anzahl * (verkauf ? 1 : 12)
          const ansatz = teiler > 0
            ? `${formatNumber(Math.round(d.ertrag / teiler))} ${
                nachFlaeche ? 'CHF/m²' : verkauf ? 'CHF/Stk' : 'CHF/Mt'}`
            : '—'
          return { zellen: [d.nutzung, menge, ansatz, formatNumber(Math.round(d.ertrag))] }
        })

      const summe = mitErtrag.reduce((a, d) => a + d.ertrag, 0)
      if (zeilen.length > 1) {
        zeilen.push({ zellen: ['Total', '', '', formatNumber(Math.round(summe))], total: true })
      }

      const bezeichnung = verkauf ? 'Verkaufserlös' : 'Mieterträge'
      ertragBloecke.push({
        // Die Eigentumsart nur dazu, wenn mehr als eine vorkommt — sonst
        // steht sie sinnlos über der einzigen Aufstellung.
        titel: ak.presentEig.length > 1
          ? `${bezeichnung} (${EIGENTUMSART_LABEL[eig]})` : bezeichnung,
        kopf: [
          'Nutzung', verkauf ? 'Menge VKF' : 'Menge VMF', 'Ansatz',
          verkauf ? 'CHF' : 'CHF/Jahr',
        ],
        zeilen,
      })
    }

    // ── Wohnungs- und Nutzungsmix ───────────────────────────────────────────
    // Zimmerzahlen über alle Gebäude; ohne erfassten Mix zählt die reine
    // Stückzahl als Wohnungen ohne Zimmerangabe.
    const zimmer: Record<string, number> = {}
    for (const b of ak.buildings) {
      for (const m of b.mietflaechen) {
        for (const [k, c] of effektiveWohnungCounts(m.nutzung, m.wohnungsmix, m.anzahl)) {
          zimmer[k] = (zimmer[k] ?? 0) + c
        }
      }
    }
    const wohnungsmix = [...WOHNUNGSMIX_KEYS, WOHNUNG_FALLBACK_KEY]
      .filter((k) => (zimmer[k] ?? 0) > 0)
      .map((k) => ({
        label: k === WOHNUNG_FALLBACK_KEY
          ? 'ohne Angabe'
          : k === 'joker' ? 'Joker' : `${WOHNUNGSMIX_LABEL[k as keyof typeof WOHNUNGSMIX_LABEL]} Zi.`,
        anzahl: zimmer[k],
      }))

    const nutzungen = mixReihenfolge
      .map((n) => ({ label: n, flaeche: mixFlaeche[n], ertrag: mixErtrag[n] }))
      .filter((n) => n.flaeche > 0 || n.ertrag > 0)
      .sort((a, b) => b.ertrag - a.ertrag || b.flaeche - a.flaeche)

    const mix = nutzungen.length > 0 ? {
      titel: wohnungsmix.length > 0 ? 'Wohnungs- und Nutzungsmix' : 'Nutzungsmix',
      flaechenTitel: hatVerkauf && hatMiete
        ? 'Miet- und Verkaufsflächen' : hatVerkauf ? 'Verkaufsflächen' : 'Mietflächen',
      ertraegeTitel: hatVerkauf && hatMiete
        ? 'Mieterträge und Verkaufserlöse' : hatVerkauf ? 'Verkaufserlöse' : 'Mieterträge',
      nutzungen,
      wohnungsmix,
    } : null

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

      // Einheit und Zahl getrennt — die Einheiten stehen damit untereinander
      // und die Beträge rechtsbündig, wie bei den Mengen.
      if (eig === 'renditeobjekt') {
        wirtschaftBloecke.push({
          titel: 'Rendite (Renditeobjekt)',
          felder: ohneLeere([
            { label: 'Anlagekosten brutto', einheit: 'CHF',
              wert: invest > 0 ? w(Math.round(invest)) : '—' },
            { label: 'Mietertrag SOLL', einheit: 'CHF/a',
              wert: eigErtrag > 0 ? w(Math.round(eigErtrag)) : '—' },
            { label: 'Bruttorendite', einheit: '%',
              wert: invest > 0 && eigErtrag > 0
                ? ((eigErtrag / invest) * 100).toFixed(2) : '—' },
          ]),
        })
      } else if (eig === 'verkaufsobjekt') {
        const gewinn = eigErtrag - invest
        wirtschaftBloecke.push({
          titel: 'Verkaufsgewinn (Stockwerkeigentum)',
          felder: ohneLeere([
            { label: 'Verkaufserlös', einheit: 'CHF',
              wert: eigErtrag > 0 ? w(Math.round(eigErtrag)) : '—' },
            { label: 'Anlagekosten brutto', einheit: 'CHF',
              wert: invest > 0 ? w(Math.round(invest)) : '—' },
            { label: 'Verkaufsgewinn', einheit: 'CHF',
              wert: eigErtrag > 0 ? w(Math.round(gewinn)) : '—' },
            { label: 'Marge auf dem Erlös', einheit: '%',
              wert: eigErtrag > 0 ? ((gewinn / eigErtrag) * 100).toFixed(1) : '—' },
          ]),
        })
      } else if (eig === 'genossenschaft') {
        const kp = kostenmieteParams
        const gvWert = basisG ? basisG.erstellungBrutto * kp.gvwFaktor : 0
        // Im Baurecht ersetzt der Baurechtszins die Verzinsung des Landes; er
        // steht in zwei Posten, subventioniert und nicht subventioniert.
        const baurechtszins = (km?.posten ?? [])
          .filter((x) => x.key.startsWith('baurecht'))
          .reduce((a, x) => a + x.betrag, 0)
        wirtschaftBloecke.push({
          titel: 'Kostenmiete (Genossenschaft)',
          felder: ohneLeere([
            { label: 'Kosten BKP 1–9', einheit: 'CHF',
              wert: basisG && basisG.erstellungBrutto > 0
                ? w(Math.round(basisG.erstellungBrutto)) : '—' },
            { label: '% GV-Wert', einheit: '%', wert: (kp.gvwFaktor * 100).toFixed(1) },
            { label: 'GV-Wert', einheit: 'CHF',
              wert: gvWert > 0 ? w(Math.round(gvWert)) : '—' },
            { label: 'Ref. Zinssatz', einheit: '%',
              wert: (kp.referenzzinssatz * 100).toFixed(2) },
            { label: 'Betriebskosten', einheit: '%',
              wert: (kp.betriebskostenSatz * 100).toFixed(2) },
            kp.imBaurecht
              ? { label: 'Baurechtszins', einheit: 'CHF/a',
                  wert: baurechtszins > 0 ? w(Math.round(baurechtszins)) : '—' }
              : { label: 'Landwert', einheit: 'CHF',
                  wert: basisG && basisG.grundstueckBrutto > 0
                    ? w(Math.round(basisG.grundstueckBrutto)) : '—' },
            { label: 'Max. Miete Wohnen', einheit: 'CHF/a',
              wert: km ? w(Math.round(km.maxMietertragWohnen)) : '—' },
          ]),
        })
      }
    }

    return {
      situationsplanUrl,
      auftrag,
      grundstuecke: { kopf: ['Parzelle', 'Zone', 'GSF m²'], zeilen: gsZeilen },
      bestand: {
        kopf: ['Gebäude', 'Assek.', 'Baujahr', 'Nutzung', 'GV m³'],
        zeilen: bestandZeilen,
      },
      mengen: flaechen,
      kosten,
      ertraege: ertragBloecke,
      mix,
      wirtschaft: wirtschaftBloecke,
    }
  }, [project, variant, parzellen, bestand, situationsplanUrl, kunde, anrede, ak, kostenmieteParams])
}
