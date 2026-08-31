import { useMemo } from 'react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { formatNumber } from '@/lib/utils'
import {
  EIGENTUMSART_COLOR, USE_TYPE_COLOR_5, USE_TYPE_COLOR_3, USE_TYPE_COLOR_1,
  EIGENTUMSART_FAMILY,
} from '@/lib/kategorieFarben'
import { CI } from '@/lib/ci'
import {
  EIGENTUMSART_LABEL, eigentumsartForBuilding, effektiveWohnungCounts,
  WOHNUNGSMIX_KEYS, WOHNUNGSMIX_LABEL, WOHNUNG_FALLBACK_KEY,
  type Eigentumsart, type VariantEtappe,
} from '@/types'
import type { EtappenUmfang } from '@/lib/bericht'
import type { VariantBuildingFull } from '@/hooks/useMengengeruest'
import type { MengenDaten, MengenSicht, TabellenZeile } from '@/components/bericht/BerichtDokument'

/**
 * Eigentumsarten, die auf dem Blatt „Wohnungsmix und Erträge" erscheinen.
 * Renditeobjekte bleiben dort aussen vor — ihre Mengen und Erträge stehen
 * vollständig in der Mengentabelle, im Grafikblatt sind sie weiterhin dabei.
 */
const MIXBLATT_EIG: Eigentumsart[] = ['genossenschaft', 'verkaufsobjekt']

/** Reihenfolge der Blöcke, gleich wie in der Projektübersicht. */
const EIG_ORDER: Eigentumsart[] = ['genossenschaft', 'renditeobjekt', 'verkaufsobjekt']

/** Abstufungen für die Ringsegmente; Stufe 1 ist als Sektor zu blass. */
const RING_STUFEN = [9, 7, 5, 3] as const

/** Zahl oder Gedankenstrich — leere Mengen sollen sichtbar leer sein. */
function z(v: number | null | undefined): string {
  return v != null && v !== 0 ? formatNumber(Math.round(v)) : '—'
}

/** Jahresertrag einer Mietfläche; Verkaufsobjekte führen Preise statt Mieten. */
function ertragVon(
  m: {
    flaeche_m2: number
    anzahl: number | null
    miete_chf_pa: number | null
    miete_chf_m2_pa: number | null
    miete_chf_stk_mt: number | null
  },
  verkauf: boolean,
): number {
  const f = verkauf ? 1 : 12
  return (m.miete_chf_pa || 0)
    || (m.miete_chf_m2_pa ? m.miete_chf_m2_pa * (m.flaeche_m2 || 0) : 0)
    || (m.miete_chf_stk_mt ? m.miete_chf_stk_mt * (m.anzahl ?? 1) * f : 0)
}

/**
 * Stellt die Blätter des Kapitels „Mengen und Erträge" zusammen: die Mengen auf
 * Haus- und Geschossebene, den Wohnungsmix und die Ertragsübersicht.
 *
 * Je nach gewähltem Umfang entsteht eine Sicht auf das Gesamtprojekt, je eine
 * pro Etappe oder beides. Ohne zweite Etappe bleibt es beim Gesamtprojekt —
 * eine Etappensicht wäre dann dieselbe Tabelle ein zweites Mal.
 */
export function useMengenDaten(umfang: EtappenUmfang): MengenDaten | undefined {
  const ak = useAnlagekostenShared()

  return useMemo(() => {
    if (ak.buildings.length === 0) return undefined

    const mehrere = ak.presentEig.length > 1
    const etappenMitGebaeuden = ak.etappen.filter(
      (e: VariantEtappe) => ak.buildings.some((b) => b.etappe_id === e.id))
    const proEtappe = etappenMitGebaeuden.length > 1 && umfang !== 'gesamt'
    const gesamt = !proEtappe || umfang === 'beide'


    /** Eine Sicht — Gesamtprojekt oder eine Etappe. */
    function sicht(titel: string, etappeId: string | null): MengenSicht {
      const gebaeude = ak.buildings.filter((b) => etappeId == null || b.etappe_id === etappeId)

      const eigentumsarten = EIG_ORDER
        .map((eig) => {
          const haeuser = gebaeude.filter((b) => eigentumsartForBuilding(b.use_type) === eig)
          if (haeuser.length === 0) return null
          const verkauf = eig === 'verkaufsobjekt'
          return {
            label: EIGENTUMSART_LABEL[eig],
            farbe: mehrere ? EIGENTUMSART_COLOR[eig] : undefined,
            farbeUnter: mehrere ? USE_TYPE_COLOR_3[eig] : undefined,
            farbeGrund: mehrere ? USE_TYPE_COLOR_1[eig] : undefined,
            // Die Haustitel stehen genau eine Stufe unter dem Balken der
            // Eigentumsart — nah genug, um zusammenzugehören.
            farbeHaus: mehrere ? USE_TYPE_COLOR_5[eig] : undefined,
            // Der Kopf hängt an der Eigentumsart: Verkaufsobjekte führen
            // Verkaufsflächen und Preise statt Mietflächen und Jahresmieten.
            kopf: [
              'Geschoss', 'Nutzung', 'Stk', 'GF m²', 'GV m³',
              verkauf ? 'VKF m²' : 'VMF m²', 'Ansatz', verkauf ? 'CHF' : 'CHF/Jahr',
            ],
            haeuser: haeuser.map((b) => hausBlock(b, verkauf)),
            // Bezeichnung in der zweiten Spalte: „Total Genossenschaft" bricht
            // in der schmalen Geschossspalte sonst um.
            total: summenZeile('Total', EIGENTUMSART_LABEL[eig], haeuser, verkauf),
          }
        })
        .filter((x) => x != null)


      return {
        titel,
        benchmarks: benchmarkTabelle(gebaeude, mehrere),
        eigentumsarten,
        wohnungsmix: wohnungsmixBloecke(gebaeude, mehrere),
        ertraege: ertragsBloecke(gebaeude, mehrere),
      }
    }

    const sichten: MengenSicht[] = [
      ...(gesamt ? [sicht('Gesamtprojekt', null)] : []),
      ...(proEtappe ? etappenMitGebaeuden.map((e) => sicht(e.name, e.id)) : []),
    ]
    return { sichten }
  }, [ak, umfang])
}

/** Geschosszeilen eines Hauses, samt Mieteinheiten und Zwischensumme. */
function hausBlock(b: VariantBuildingFull, verkauf: boolean) {
  const zeilen: TabellenZeile[] = []
  for (const m of b.mietflaechen) {
    const ertrag = ertragVon(m, verkauf)
    zeilen.push({
      zellen: [
        m.geschoss_bezeichnung ?? '—',
        [m.nutzung, m.unterirdisch ? '(UT)' : ''].filter(Boolean).join(' '),
        m.anzahl != null && m.anzahl > 0 ? formatNumber(m.anzahl) : '—',
        z(m.gf_m2),
        z(m.volumen_m3),
        z(m.flaeche_m2),
        ansatzVon(m.flaeche_m2, m.anzahl, ertrag, verkauf),
        z(ertrag),
      ],
    })
    // Erfasste Mieteinheiten stehen eingerückt unter ihrer Fläche — sie sind
    // deren Aufschlüsselung und dürfen nicht wie eigene Geschosse wirken.
    for (const e of m.mieteinheiten ?? []) {
      const name = [e.wohnungsnummer, e.wohnungstyp ?? e.bezeichnung]
        .filter(Boolean).join(' · ')
      const eErtrag = ertragVon(e, verkauf)
      zeilen.push({
        einzug: true,
        zellen: [
          '',
          name || (e.zimmer != null ? `${e.zimmer} Zi.` : 'Einheit'),
          e.anzahl > 0 ? formatNumber(e.anzahl) : '—',
          z(e.gf_m2),
          z(e.volumen_m3),
          z(e.flaeche_m2),
          ansatzVon(e.flaeche_m2, e.anzahl, eErtrag, verkauf),
          z(eErtrag),
        ],
      })
    }
  }
  return {
    name: b.name,
    zeilen,
    total: summenZeile('Total', b.name, [b], verkauf),
    verkauf,
  }
}

/**
 * Ansatz einer Zeile — je nach Bezugsgrösse CHF/m², CHF pro Monat und Stück
 * oder, beim Verkauf, CHF je Stück. Zurückgerechnet aus Ertrag und Menge,
 * damit er zur ausgewiesenen Summe passt.
 */
function ansatzVon(
  flaeche: number, anzahl: number | null, ertrag: number, verkauf: boolean,
): string {
  if (ertrag <= 0) return '—'
  if (flaeche > 0) return `${z(ertrag / flaeche)} CHF/m²`
  const stk = anzahl ?? 0
  if (stk <= 0) return '—'
  return verkauf
    ? `${z(ertrag / stk)} CHF/Stk`
    : `${z(ertrag / (stk * 12))} CHF/Mt`
}

/** Summe über Gebäude — Anzahl, GF, GV, VMF und Ertrag der Mietflächen. */
function summenZeile(
  label: string, bezug: string, gebaeude: VariantBuildingFull[], verkauf: boolean,
): TabellenZeile {
  let anzahl = 0, gf = 0, gv = 0, vmf = 0, ertrag = 0
  for (const b of gebaeude) {
    for (const m of b.mietflaechen) {
      anzahl += m.anzahl ?? 0
      gf += m.gf_m2 || 0
      gv += m.volumen_m3 || 0
      vmf += m.flaeche_m2 || 0
      ertrag += ertragVon(m, verkauf)
    }
  }
  return { total: true, zellen: [label, bezug, z(anzahl), z(gf), z(gv), z(vmf), '', z(ertrag)] }
}

/**
 * Kennwerte der Mengen — Flächen und ihre Verhältnisse. Je Eigentumsart eine
 * Spalte, dazu das Total; bei nur einer Eigentumsart bleibt es beim Total.
 *
 * Als „oberirdisch" gilt, was nicht als unterirdisch erfasst ist; die
 * Vermiet- beziehungsweise Verkaufsfläche wird nicht danach getrennt, weil
 * sie sich auf das ganze Gebäude bezieht.
 */
function benchmarkTabelle(gebaeude: VariantBuildingFull[], mehrere: boolean) {
  const spalten = [
    ...(mehrere
      ? EIG_ORDER
          .filter((eig) => gebaeude.some((b) => eigentumsartForBuilding(b.use_type) === eig))
          .map((eig) => ({
            label: EIGENTUMSART_LABEL[eig],
            haeuser: gebaeude.filter((b) => eigentumsartForBuilding(b.use_type) === eig),
          }))
      : []),
    { label: 'Total', haeuser: gebaeude },
  ]

  const werte = spalten.map(({ haeuser }) => {
    let gfOi = 0, gfUi = 0, vmf = 0, gv = 0
    for (const b of haeuser) {
      for (const m of b.mietflaechen) {
        if (m.unterirdisch) gfUi += m.gf_m2 || 0
        else gfOi += m.gf_m2 || 0
        vmf += m.flaeche_m2 || 0
        gv += m.volumen_m3 || 0
      }
    }
    const gf = gfOi + gfUi
    return {
      gfOi, gfUi,
      anteilOi: gfOi > 0 ? vmf / gfOi : null,
      anteilTotal: gf > 0 ? vmf / gf : null,
      gvProGf: gf > 0 ? gv / gf : null,
    }
  })

  // Einheiten stehen in der Zelle, nicht im Kopf: die Zeilen tragen
  // verschiedene — Flächen, Anteile und ein Verhältnis.
  const m2 = (v: number) => (v > 0 ? `${z(v)} m²` : '—')
  const pct = (v: number | null) => (v != null ? `${(v * 100).toFixed(1)} %` : '—')
  const quot = (v: number | null) => (v != null ? `${v.toFixed(2)} m³/m²` : '—')

  return {
    kopf: ['Kennwert', ...spalten.map((sp) => sp.label)],
    zeilen: [
      { zellen: ['Geschossfläche oberirdisch', ...werte.map((w) => m2(w.gfOi))] },
      { zellen: ['Geschossfläche unterirdisch', ...werte.map((w) => m2(w.gfUi))] },
      { zellen: ['VMF (VKF) / GF oberirdisch', ...werte.map((w) => pct(w.anteilOi))] },
      { zellen: ['VMF (VKF) / GF total', ...werte.map((w) => pct(w.anteilTotal))] },
      { zellen: ['Gebäudevolumen / GF', ...werte.map((w) => quot(w.gvProGf))] },
    ] as TabellenZeile[],
  }
}

/** Wohnungsmix je Eigentumsart — Zimmerzahl, Anzahl, mittlere Fläche. */
function wohnungsmixBloecke(gebaeude: VariantBuildingFull[], mehrere: boolean) {
  return EIG_ORDER
    .map((eig) => {
      const haeuser = gebaeude.filter((b) => eigentumsartForBuilding(b.use_type) === eig)
      const anzahl: Record<string, number> = {}
      const flaeche: Record<string, number> = {}
      for (const b of haeuser) {
        for (const m of b.mietflaechen) {
          const counts = effektiveWohnungCounts(m.nutzung, m.wohnungsmix, m.anzahl)
          const total = counts.reduce((s, [, c]) => s + c, 0)
          for (const [k, c] of counts) {
            anzahl[k] = (anzahl[k] ?? 0) + c
            // Ohne Einzelflächen die mittlere Fläche der Mietfläche verteilen.
            flaeche[k] = (flaeche[k] ?? 0) + (total > 0 ? (m.flaeche_m2 || 0) * (c / total) : 0)
          }
        }
      }
      const zeilen: TabellenZeile[] = [...WOHNUNGSMIX_KEYS, WOHNUNG_FALLBACK_KEY]
        .filter((k) => (anzahl[k] ?? 0) > 0)
        .map((k) => ({
          zellen: [
            k === WOHNUNG_FALLBACK_KEY ? 'ohne Angabe'
              : k === 'joker' ? 'Joker'
              : `${WOHNUNGSMIX_LABEL[k as keyof typeof WOHNUNGSMIX_LABEL]} Zi.`,
            formatNumber(anzahl[k]),
            z(anzahl[k] > 0 ? flaeche[k] / anzahl[k] : 0),
            z(flaeche[k]),
          ],
        }))
      if (zeilen.length === 0) return null
      const summe = zeilen.reduce((a, r) => a + Number(r.zellen[1].replace(/\D/g, '')), 0)
      const flaecheTotal = Object.values(flaeche).reduce((a, v) => a + v, 0)
      zeilen.push({
        total: true,
        zellen: ['Total', formatNumber(summe), z(summe > 0 ? flaecheTotal / summe : 0), z(flaecheTotal)],
      })
      return {
        label: EIGENTUMSART_LABEL[eig],
        farbe: mehrere ? EIGENTUMSART_COLOR[eig] : undefined,
        farbeUnter: mehrere ? USE_TYPE_COLOR_3[eig] : undefined,
        segmentFarben: RING_STUFEN.map((n) => CI[EIGENTUMSART_FAMILY[eig]][n]),
        aufMixblatt: MIXBLATT_EIG.includes(eig),
        zeilen,
      }
    })
    .filter((x) => x != null)
}

/** Ertragsübersicht je Eigentumsart, aufgeschlüsselt nach Nutzung. */
function ertragsBloecke(gebaeude: VariantBuildingFull[], mehrere: boolean) {
  return EIG_ORDER
    .map((eig) => {
      const haeuser = gebaeude.filter((b) => eigentumsartForBuilding(b.use_type) === eig)
      const verkauf = eig === 'verkaufsobjekt'
      const menge: Record<string, { flaeche: number; anzahl: number; ertrag: number }> = {}
      const reihenfolge: string[] = []
      for (const b of haeuser) {
        for (const m of b.mietflaechen) {
          const key = (m.nutzung || '').trim() || '(ohne Nutzung)'
          if (!(key in menge)) { reihenfolge.push(key); menge[key] = { flaeche: 0, anzahl: 0, ertrag: 0 } }
          menge[key].flaeche += m.flaeche_m2 || 0
          menge[key].anzahl += m.anzahl ?? 0
          menge[key].ertrag += ertragVon(m, verkauf)
        }
      }
      const zeilen: TabellenZeile[] = reihenfolge
        .filter((k) => menge[k].ertrag > 0)
        .sort((a, b) => menge[b].ertrag - menge[a].ertrag)
        .map((k) => {
          const e = menge[k]
          const nachFlaeche = e.flaeche > 0
          const teiler = nachFlaeche ? e.flaeche : e.anzahl * (verkauf ? 1 : 12)
          return {
            zellen: [
              k,
              nachFlaeche ? `${z(e.flaeche)} m²` : `${formatNumber(e.anzahl)} Stk`,
              teiler > 0
                ? `${z(e.ertrag / teiler)} ${nachFlaeche ? 'CHF/m²' : verkauf ? 'CHF/Stk' : 'CHF/Mt'}`
                : '—',
              z(e.ertrag),
            ],
          }
        })
      if (zeilen.length === 0) return null
      const summe = reihenfolge.reduce((a, k) => a + menge[k].ertrag, 0)
      zeilen.push({ total: true, zellen: ['Total', '', '', z(summe)] })
      return {
        label: EIGENTUMSART_LABEL[eig],
        farbe: mehrere ? EIGENTUMSART_COLOR[eig] : undefined,
        farbeUnter: mehrere ? USE_TYPE_COLOR_3[eig] : undefined,
        kopf: ['Nutzung', verkauf ? 'Menge VKF' : 'Menge VMF', 'Ansatz', verkauf ? 'CHF' : 'CHF/Jahr'],
        aufMixblatt: MIXBLATT_EIG.includes(eig),
        zeilen,
      }
    })
    .filter((x) => x != null)
}
