import { useMemo } from 'react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { ermittleKeeValueMengen, istErdgeschoss } from '@/lib/keevalue'
import { formatNumber } from '@/lib/utils'
import { HAUPTGRUPPEN } from '@/lib/bkpKatalog'
import { berechneKostenmiete, basisFromErgebnis, sammleKostenmieteMengen } from '@/lib/kostenmiete'
import { useKostenmiete } from '@/hooks/useKostenmiete'
import { useRendite } from '@/hooks/useRendite'
import { berechneRendite } from '@/lib/rendite'
import {
  EIGENTUMSART_LABEL, isNutzungWohnen, effektiveWohnungCounts,
  eigentumsartForBuilding, type Eigentumsart,
  WOHNUNGSMIX_KEYS, WOHNUNGSMIX_LABEL, WOHNUNG_FALLBACK_KEY,
  type Project, type ProjectVariant, type Parcel, type ExistingBuilding,
} from '@/types'
import { EIGENTUMSART_COLOR, USE_TYPE_COLOR_3, EIGENTUMSART_FAMILY } from '@/lib/kategorieFarben'
import { CI } from '@/lib/ci'
import type {
  Feld, UebersichtDaten, TabellenZeile, BetragZeile, EigentumsartBlock, Nutzungsmix,
} from '@/components/bericht/BerichtDokument'

/**
 * Reihenfolge der Blöcke im Bericht: Genossenschaft, Renditeobjekt,
 * Verkaufsobjekt. Bewusst eine eigene Konstante — die Reihenfolge der
 * Berechnung (EIGENTUMSART_ORDER) folgt einer anderen Logik.
 */
const BERICHT_EIG_ORDER: Eigentumsart[] = ['genossenschaft', 'renditeobjekt', 'verkaufsobjekt']

/**
 * Abstufungen für die Ringsegmente innerhalb einer Nutzungsart. Stufe 1 fehlt
 * bewusst — sie ist fast weiss und als Sektor nicht mehr zu erkennen.
 */
const RING_STUFEN = [9, 7, 5, 3] as const

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
): UebersichtDaten | undefined {
  const ak = useAnlagekostenShared()
  // Parameter der Kostenmiete — nur für den Genossenschaftsblock nötig.
  const { params: kostenmieteParams } = useKostenmiete(variant?.id ?? '')
  // Parameter der Renditerechnung — für Rendite wie Residualwert dieselben.
  const { params: renditeParams } = useRendite(variant?.id ?? '')

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
    const ertragProEig = new Map<string, { titel: string; kopf: string[]; zeilen: TabellenZeile[] }>()
    // Nebenbei für den Nutzungsmix mitgeführt: dieselben Zahlen, aber je
    // Eigentumsart und ohne Ertragsfilter — eine Nutzung kann Fläche
    // beitragen, ohne Ertrag zu tragen.
    const mixProEig = new Map<string, { label: string; flaeche: number; ertrag: number }[]>()
    for (const eig of ak.presentEig) {
      // Bei der Genossenschaft trägt Wohnen die Restkosten: der Mietzins ist
      // nicht erfasst, sondern fällt aus der Kostenmiete an. Über den
      // Quadratmeteransatz verteilt er sich richtig, auch wenn mehrere
      // Wohnnutzungen erfasst sind.
      const detail = (ak.ertragDetailByEig.get(eig) ?? [])
        .map((d) => (eig === 'genossenschaft' && km && isNutzungWohnen(d.nutzung)
          ? { ...d, ertrag: km.proM2Jahr * d.flaecheM2 }
          : d))
      mixProEig.set(eig, detail
        .map((d) => ({ label: d.nutzung, flaeche: d.flaecheM2, ertrag: d.ertrag }))
        .filter((n) => n.flaeche > 0 || n.ertrag > 0)
        .sort((a, b) => b.ertrag - a.ertrag || b.flaeche - a.flaeche))

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
      // Die Eigentumsart steht als Obertitel über dem Block, sobald mehrere
      // vorkommen — hier wäre sie doppelt.
      ertragProEig.set(eig, {
        titel: bezeichnung,
        kopf: [
          'Nutzung', verkauf ? 'Menge VKF' : 'Menge VMF', 'Ansatz',
          verkauf ? 'CHF' : 'CHF/Jahr',
        ],
        zeilen,
      })
    }

    // ── Wohnungs- und Nutzungsmix ───────────────────────────────────────────
    // Zimmerzahlen je Eigentumsart; ohne erfassten Mix zählt die reine
    // Stückzahl als Wohnungen ohne Zimmerangabe.
    function wohnungsmixFuer(eig: Eigentumsart | null) {
      const zimmer: Record<string, number> = {}
      for (const b of ak.buildings) {
        if (eig && eigentumsartForBuilding(b.use_type) !== eig) continue
        for (const m of b.mietflaechen) {
          for (const [k, c] of effektiveWohnungCounts(m.nutzung, m.wohnungsmix, m.anzahl)) {
            zimmer[k] = (zimmer[k] ?? 0) + c
          }
        }
      }
      return [...WOHNUNGSMIX_KEYS, WOHNUNG_FALLBACK_KEY]
        .filter((k) => (zimmer[k] ?? 0) > 0)
        .map((k) => ({
          label: k === WOHNUNG_FALLBACK_KEY
            ? 'ohne Angabe'
            : k === 'joker' ? 'Joker' : `${WOHNUNGSMIX_LABEL[k as keyof typeof WOHNUNGSMIX_LABEL]} Zi.`,
          anzahl: zimmer[k],
        }))
    }

    /** Beschriftung der beiden Ringe — Miete, Verkauf oder beides. */
    function mixTitel(miete: boolean, verkauf: boolean) {
      return {
        flaechen: verkauf && miete
          ? 'Miet- und Verkaufsflächen' : verkauf ? 'Verkaufsflächen' : 'Mietflächen',
        ertraege: verkauf && miete
          ? 'Mieterträge und Verkaufserlöse' : verkauf ? 'Verkaufserlöse' : 'Mieterträge',
      }
    }

    // ── Wirtschaftlichkeit je Nutzungsart ───────────────────────────────────
    // Renditeobjekt → Rendite, Verkaufsobjekt → Gewinn, Genossenschaft →
    // Kostenmiete. Es erscheint nur, was in der Variante auch vorkommt.
    const wirtschaftProEig = new Map<string, { titel: string; felder: Feld[] }>()
    for (const eig of ak.presentEig) {
      const erg = ak.konsolidiertEffektiv.get(eig)
      if (!erg) continue
      const invest = erg.totalBrutto
      const eigErtrag = Object.values(ak.ertragProNutzungByEig.get(eig) ?? {})
        .reduce((a, v) => a + v, 0)

      // Einheit und Zahl getrennt — die Einheiten stehen damit untereinander
      // und die Beträge rechtsbündig, wie bei den Mengen.
      if (eig === 'renditeobjekt') {
        // Vermietbare Fläche der Renditeobjekte — Bezug für Instandhaltung und
        // Instandsetzung in der Erfolgsrechnung.
        const vmfRendite = ak.buildings
          .filter((b) => eigentumsartForBuilding(b.use_type) === 'renditeobjekt')
          .reduce((a, b) => a + b.mietflaechen.reduce((x, m) => x + (m.flaeche_m2 || 0), 0), 0)
        // Erstellungskosten = Anlagekosten ohne Position 010 (Grundstückerwerb).
        const p010 = erg.positionen['010']
        const land = (p010?.betragNetto ?? 0) + (p010?.mwstBetrag ?? 0)
        const r = berechneRendite(renditeParams, {
          mietertragSoll: eigErtrag, totalVmf: vmfRendite,
          investition: invest, erstellung: invest - land, gsf: ak.gsfTotal,
        })

        // Welche der beiden Sichten gilt, ist an der Variante gespeichert.
        wirtschaftProEig.set(eig, variant.rendite_modus === 'residual' ? {
          titel: 'Residualwert Grundstück',
          felder: ohneLeere([
            { label: 'Liegenschaftserfolg', einheit: 'CHF/a',
              wert: r.liegenschaftserfolg !== 0 ? w(Math.round(r.liegenschaftserfolg)) : '—' },
            { label: 'Nettokapitalisierung', einheit: '%',
              wert: (renditeParams.nettoKapSatz * 100).toFixed(2) },
            { label: 'Ertragswert', einheit: 'CHF',
              wert: r.ertragswert !== 0 ? w(Math.round(r.ertragswert)) : '—' },
            { label: 'Kosten ohne Land', einheit: 'CHF',
              wert: invest - land > 0 ? w(Math.round(invest - land)) : '—' },
            { label: 'Landwert', einheit: 'CHF',
              wert: r.landwert !== 0 ? w(Math.round(r.landwert)) : '—' },
            // Die Bezugsfläche steht vor dem Wert je m², damit die Rechnung
            // nachvollziehbar bleibt.
            { label: 'Grundstücksfläche', einheit: 'm²',
              wert: ak.gsfTotal > 0 ? w(Math.round(ak.gsfTotal)) : '—' },
            { label: 'Landwert je m²', einheit: 'CHF/m²',
              wert: r.landwertProM2 !== 0 ? w(Math.round(r.landwertProM2)) : '—' },
          ]),
        } : {
          titel: 'Rendite',
          felder: ohneLeere([
            { label: 'Anlagekosten brutto', einheit: 'CHF',
              wert: invest > 0 ? w(Math.round(invest)) : '—' },
            { label: 'Mietertrag SOLL', einheit: 'CHF/a',
              wert: eigErtrag > 0 ? w(Math.round(eigErtrag)) : '—' },
            { label: 'Bruttorendite', einheit: '%',
              wert: invest > 0 && eigErtrag > 0 ? (r.bruttorendite * 100).toFixed(2) : '—' },
            { label: 'Nettorendite', einheit: '%',
              wert: invest > 0 && eigErtrag > 0 ? (r.nettorendite * 100).toFixed(2) : '—' },
          ]),
        })
      } else if (eig === 'verkaufsobjekt') {
        const gewinn = eigErtrag - invest
        wirtschaftProEig.set(eig, {
          titel: 'Verkaufsgewinn',
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
        wirtschaftProEig.set(eig, {
          titel: 'Kostenmiete',
          felder: ohneLeere([
            { label: 'Kosten BKP 1–9', einheit: 'CHF',
              wert: basisG && basisG.erstellungBrutto > 0
                ? w(Math.round(basisG.erstellungBrutto)) : '—' },
            { label: '% GV-Wert', einheit: '%', wert: (kp.gvwFaktor * 100).toFixed(1) },
            { label: 'GV-Wert', einheit: 'CHF',
              wert: gvWert > 0 ? w(Math.round(gvWert)) : '—' },
            kp.imBaurecht
              ? { label: 'Baurechtszins', einheit: 'CHF/a',
                  wert: baurechtszins > 0 ? w(Math.round(baurechtszins)) : '—' }
              : { label: 'Landwert', einheit: 'CHF',
                  wert: basisG && basisG.grundstueckBrutto > 0
                    ? w(Math.round(basisG.grundstueckBrutto)) : '—' },
            { label: 'Ref. Zinssatz', einheit: '%',
              wert: (kp.referenzzinssatz * 100).toFixed(2) },
            { label: 'Betriebskosten', einheit: '%',
              wert: (kp.betriebskostenSatz * 100).toFixed(2) },
            { label: 'Max. Miete Wohnen', einheit: 'CHF/a',
              wert: km ? w(Math.round(km.maxMietertragWohnen)) : '—' },
          ]),
        })
      }
    }

    // Je Eigentumsart eine Zeile, in fester Reihenfolge. Kommt mehr als eine
    // vor, färbt ihre Farbe aus den Berechnungssektionen den Titelbalken —
    // bei nur einer bleibt es beim Kupfer der übrigen Blöcke.
    const mehrere = ak.presentEig.length > 1

    // Der Mix: bei einer Eigentumsart ein Block über alles, bei mehreren je
    // einer pro Nutzungsart — sonst vermischten sich Mietflächen und
    // Verkaufsflächen in einem Ring.
    const alleNutzungen = new Map<string, { label: string; flaeche: number; ertrag: number }>()
    for (const liste of mixProEig.values()) {
      for (const n of liste) {
        const v = alleNutzungen.get(n.label) ?? { label: n.label, flaeche: 0, ertrag: 0 }
        alleNutzungen.set(n.label, {
          label: n.label, flaeche: v.flaeche + n.flaeche, ertrag: v.ertrag + n.ertrag,
        })
      }
    }
    const gesamtMixWohnungen = wohnungsmixFuer(null)
    const mix: Nutzungsmix[] = mehrere
      ? BERICHT_EIG_ORDER
          .filter((eig) => (mixProEig.get(eig) ?? []).length > 0)
          .map((eig) => {
            const t = mixTitel(eig !== 'verkaufsobjekt', eig === 'verkaufsobjekt')
            return {
              key: eig,
              titel: EIGENTUMSART_LABEL[eig],
              farbe: EIGENTUMSART_COLOR[eig],
              farbeUnter: USE_TYPE_COLOR_3[eig],
              /** Ringsegmente in Abstufungen derselben Farbfamilie. */
              segmentFarben: RING_STUFEN.map((n) => CI[EIGENTUMSART_FAMILY[eig]][n]),
              flaechenTitel: t.flaechen,
              ertraegeTitel: t.ertraege,
              nutzungen: mixProEig.get(eig) ?? [],
              wohnungsmix: wohnungsmixFuer(eig),
            }
          })
      : (() => {
          const nutzungen = [...alleNutzungen.values()]
            .sort((a, b) => b.ertrag - a.ertrag || b.flaeche - a.flaeche)
          if (nutzungen.length === 0) return []
          const t = mixTitel(hatMiete, hatVerkauf)
          return [{
            key: 'gesamt',
            titel: gesamtMixWohnungen.length > 0 ? 'Wohnungs- und Nutzungsmix' : 'Nutzungsmix',
            flaechenTitel: t.flaechen,
            ertraegeTitel: t.ertraege,
            nutzungen,
            wohnungsmix: gesamtMixWohnungen,
          }]
        })()
    const bloecke: EigentumsartBlock[] = BERICHT_EIG_ORDER
      .filter((eig) => wirtschaftProEig.has(eig) || ertragProEig.has(eig))
      .map((eig) => ({
        key: eig,
        titel: mehrere ? EIGENTUMSART_LABEL[eig] : undefined,
        farbe: mehrere ? EIGENTUMSART_COLOR[eig] : undefined,
        // Untertitel eine Stufe heller, wie die Subtabellen im Designsystem.
        farbeUnter: mehrere ? USE_TYPE_COLOR_3[eig] : undefined,
        wirtschaft: wirtschaftProEig.get(eig) ?? null,
        ertraege: ertragProEig.get(eig) ?? null,
      }))

    return {
      situationsplanUrl,
      grundstuecke: { kopf: ['Parzelle', 'Zone', 'GSF m²'], zeilen: gsZeilen },
      bestand: {
        kopf: ['Gebäude', 'Assek.', 'Baujahr', 'Nutzung', 'GV m³'],
        zeilen: bestandZeilen,
      },
      mengen: flaechen,
      kosten,
      bloecke,
      mix,
    }
  }, [project, variant, parzellen, bestand, situationsplanUrl, ak,
      kostenmieteParams, renditeParams])
}
