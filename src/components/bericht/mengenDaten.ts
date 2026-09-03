import { useMemo } from 'react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { useKostenmiete } from '@/hooks/useKostenmiete'
import { useWbfZh } from '@/hooks/useWbfZh'
import {
  berechneKostenmiete, basisFromErgebnis, sammleKostenmieteMengen,
} from '@/lib/kostenmiete'
import {
  buildUnits, wohnungsmieten, wohnungsmixKey, zimmerFromEinheit,
} from '@/lib/mengenAnalyse'
import { formatNumber } from '@/lib/utils'
import {
  EIGENTUMSART_COLOR, USE_TYPE_COLOR_5, USE_TYPE_COLOR_3, USE_TYPE_COLOR_1,
  EIGENTUMSART_FAMILY,
} from '@/lib/kategorieFarben'
import { CI } from '@/lib/ci'
import {
  EIGENTUMSART_LABEL, eigentumsartForBuilding, effektiveWohnungCounts,
  WOHNUNGSMIX_KEYS, WOHNUNGSMIX_LABEL, WOHNUNG_FALLBACK_KEY,
  type Eigentumsart, type VariantEtappe, type Wohnungsmix,
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

/** Beschriftung einer Wohnungskategorie. */
function zimmerLabel(key: string): string {
  if (key === WOHNUNG_FALLBACK_KEY) return 'Wohnungen'
  if (key === 'joker') return 'Joker'
  return `${WOHNUNGSMIX_LABEL[key as keyof typeof WOHNUNGSMIX_LABEL] ?? key} Zi.`
}

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
export function useMengenDaten(
  variantId: string, umfang: EtappenUmfang,
): MengenDaten | undefined {
  const ak = useAnlagekostenShared()
  const { params: kostenmieteParams } = useKostenmiete(variantId)
  const { params: wbf } = useWbfZh(variantId)

  /**
   * Monatsmiete je Wohnungstyp aus der Kostenmiete — dieselbe Verteilung über
   * die WBF-Punkte wie in der Kostenmiete-Sektion. Sie greift nur dort, wo im
   * Mengengerüst kein Mietzins erfasst ist; ein erfasster Wert übersteuert sie.
   */
  const kostenmieteJeTyp = useMemo(() => {
    const erg = ak.konsolidiertEffektiv.get('genossenschaft')
    if (!erg) return new Map<string, number>()
    const m = sammleKostenmieteMengen(ak.buildings, null)
    if (m.wohnenFlaeche <= 0) return new Map<string, number>()
    const km = berechneKostenmiete(
      basisFromErgebnis(erg, m.vmf, m.wohnenFlaeche, m.wohnungen),
      kostenmieteParams, m.ertragsNutzungen)
    const wohnungen = buildUnits(ak.buildings, ak.etappen)
      .filter((u) => u.eig === 'genossenschaft' && u.istWohnen)
    const verteilt = wohnungsmieten(wohnungen, wbf.punkte, km.maxMietertragWohnen)
    return new Map(verteilt.rows.map((r) => [r.key, r.mieteMt]))
  }, [ak.buildings, ak.etappen, ak.konsolidiertEffektiv, kostenmieteParams, wbf.punkte])

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

      // Kommt in dieser Sicht nur eine Nutzungsart vor, sagt ihr Name nichts,
      // was nicht schon feststeht — der Balken trägt dann die Sicht selbst.
      const vorhanden = EIG_ORDER.filter(
        (eig) => gebaeude.some((b) => eigentumsartForBuilding(b.use_type) === eig))
      const einzeln = vorhanden.length === 1

      const eigentumsarten = EIG_ORDER
        .map((eig) => {
          const haeuser = gebaeude.filter((b) => eigentumsartForBuilding(b.use_type) === eig)
          if (haeuser.length === 0) return null
          const verkauf = eig === 'verkaufsobjekt'
          const label = einzeln ? titel : EIGENTUMSART_LABEL[eig]
          return {
            key: eig,
            label,
            farbe: mehrere ? EIGENTUMSART_COLOR[eig] : undefined,
            farbeUnter: mehrere ? USE_TYPE_COLOR_3[eig] : undefined,
            farbeGrund: mehrere ? USE_TYPE_COLOR_1[eig] : undefined,
            // Das Total der ganzen Sicht steht eine Stufe kräftiger als die
            // Zwischensummen der Häuser — es schliesst nicht eine Tabelle ab,
            // sondern das Kapitel.
            farbeTotal: mehrere ? USE_TYPE_COLOR_3[eig] : undefined,
            // Die Haustitel stehen genau eine Stufe unter dem Balken der
            // Eigentumsart — nah genug, um zusammenzugehören.
            farbeHaus: mehrere ? USE_TYPE_COLOR_5[eig] : undefined,
            // Der Kopf hängt an der Eigentumsart.
            kopf: mengenKopf(verkauf, 'Geschoss'),
            haeuser: haeuser.map((b) => hausBlock(
              b, verkauf, eig === 'genossenschaft' ? kostenmieteJeTyp : null)),
            // Bezeichnung in der zweiten Spalte: „Total Genossenschaft" bricht
            // in der schmalen Geschossspalte sonst um.
            total: summenZeile(
              'Total', label, haeuser, verkauf,
              eig === 'genossenschaft' ? kostenmieteJeTyp : null),
          }
        })
        .filter((x) => x != null)

      // Bei mehreren Häusern eine Übersicht voran: je Haus eine Zeile mit
      // seinen Summen. Die Einzelheiten folgen darunter Geschoss für Geschoss —
      // ohne die Übersicht liesse sich das ganze Projekt nur durch Blättern
      // erfassen. Für eine Etappe erübrigt sie sich; dort steht ohnehin nur
      // ein Ausschnitt.
      const haeuserUebersicht = etappeId != null || gebaeude.length < 2 ? [] : EIG_ORDER
        .map((eig) => {
          const haeuser = gebaeude.filter((b) => eigentumsartForBuilding(b.use_type) === eig)
          if (haeuser.length === 0) return null
          const verkauf = eig === 'verkaufsobjekt'
          const jeTyp = eig === 'genossenschaft' ? kostenmieteJeTyp : null
          return {
            // Der Balken der Eigentumsart steht darüber; hier genügt, was in
            // der Tabelle steht.
            key: eig,
            label: 'Übersicht Häuser',
            farbeTotal: mehrere ? USE_TYPE_COLOR_3[eig] : undefined,
            farbe: mehrere ? EIGENTUMSART_COLOR[eig] : undefined,
            farbeGrund: mehrere ? USE_TYPE_COLOR_1[eig] : undefined,
            kopf: mengenKopf(verkauf, 'Haus'),
            zeilen: [
              ...haeuser.map((b) => hausZeile(b, verkauf, jeTyp)),
              // Der Bezug steht hier in der ersten Spalte: die zweite ist in
              // dieser Tabelle die schmalere und liefe in die Mengen hinein.
              summenZeile(
                einzeln ? 'Total' : `Total ${EIGENTUMSART_LABEL[eig]}`, '',
                haeuser, verkauf, jeTyp),
            ],
          }
        })
        .filter((x) => x != null)

      return {
        titel,
        // Ohne zweite Nutzungsart steht die Sicht schon im Balken; der
        // Kapiteltitel wiederholte sie sonst.
        titelImBalken: einzeln,
        benchmarks: benchmarkTabelle(gebaeude, mehrere),
        haeuserUebersicht,
        eigentumsarten,
        wohnungsmix: wohnungsmixBloecke(gebaeude, mehrere),
        ertraege: ertragsBloecke(gebaeude, mehrere, kostenmieteJeTyp),
      }
    }

    const sichten: MengenSicht[] = [
      ...(gesamt ? [sicht('Gesamtprojekt', null)] : []),
      ...(proEtappe ? etappenMitGebaeuden.map((e) => sicht(e.name, e.id)) : []),
    ]
    return { sichten }
  }, [ak, umfang, kostenmieteJeTyp])
}

/**
 * Ertrag einer Wohnfläche aus der Kostenmiete, wenn im Mengengerüst keiner
 * erfasst ist: Monatsmiete des Wohnungstyps mal Anzahl mal zwölf. Ohne
 * Zimmermix zählt die Stückzahl unter dem Sammelschlüssel.
 */
function kostenmieteErtrag(
  m: { nutzung: string; wohnungsmix: Wohnungsmix | null; anzahl: number | null },
  jeTyp: Map<string, number>,
): number {
  let summe = 0
  for (const [key, anzahl] of effektiveWohnungCounts(m.nutzung, m.wohnungsmix, m.anzahl)) {
    summe += (jeTyp.get(wohnungsmixKey(key)) ?? 0) * anzahl * 12
  }
  return summe
}

/** Erfasster Ertrag, sonst der aus der Kostenmiete abgeleitete. */
function ertragMitKostenmiete(
  m: VariantBuildingFull['mietflaechen'][number],
  verkauf: boolean,
  jeTyp: Map<string, number> | null,
): number {
  const erfasst = ertragVon(m, verkauf)
  if (erfasst > 0 || !jeTyp) return erfasst
  return kostenmieteErtrag(m, jeTyp)
}

/** Geschosszeilen eines Hauses, samt Mieteinheiten und Zwischensumme. */
function hausBlock(
  b: VariantBuildingFull, verkauf: boolean, jeTyp: Map<string, number> | null,
) {
  const zeilen: TabellenZeile[] = []
  for (const m of b.mietflaechen) {
    const ertrag = ertragMitKostenmiete(m, verkauf, jeTyp)
    zeilen.push({
      zellen: [
        m.geschoss_bezeichnung ?? '—',
        [m.nutzung, m.unterirdisch ? '(UT)' : ''].filter(Boolean).join(' '),
        m.anzahl != null && m.anzahl > 0 ? formatNumber(m.anzahl) : '—',
        z(m.gf_m2),
        z(m.volumen_m3),
        z(m.flaeche_m2),
        ...ansaetze(m.flaeche_m2, m.anzahl, ertrag, verkauf),
        z(ertrag),
      ],
    })
    // Ohne erfasste Mieteinheiten die Wohnungen aus dem Zimmermix auflisten —
    // so steht auch dort je Wohnungstyp der Mietzins, der ihn trägt.
    const einheiten = m.mieteinheiten ?? []
    if (einheiten.length === 0 && jeTyp) {
      const mix = effektiveWohnungCounts(m.nutzung, m.wohnungsmix, m.anzahl)
      const stkTotal = mix.reduce((a, [, c]) => a + c, 0)
      for (const [key, anzahl] of mix) {
        // Ohne eigenen Mietzins der Wohnung gilt der Ansatz der Kostenmiete;
        // ein erfasster Mietzins der Fläche wird anteilig verteilt.
        const jeMonat = ertragVon(m, verkauf) > 0
          ? (stkTotal > 0 ? ertragVon(m, verkauf) / stkTotal / 12 : 0)
          : (jeTyp.get(wohnungsmixKey(key)) ?? 0)
        zeilen.push({
          einzug: true,
          zellen: [
            '',
            zimmerLabel(key),
            formatNumber(anzahl),
            '—',
            '—',
            ...(() => {
              const flaeche = stkTotal > 0 ? (m.flaeche_m2 || 0) * (anzahl / stkTotal) : 0
              const ertragWhg = jeMonat * anzahl * 12
              return [
                z(flaeche),
                flaeche > 0 && ertragWhg > 0 ? z(ertragWhg / flaeche) : '—',
                jeMonat > 0 ? z(jeMonat) : '—',
                z(ertragWhg),
              ]
            })(),
          ],
        })
      }
    }
    // Erfasste Mieteinheiten stehen eingerückt unter ihrer Fläche — sie sind
    // deren Aufschlüsselung und dürfen nicht wie eigene Geschosse wirken.
    for (const e of einheiten) {
      const name = [e.wohnungsnummer, e.wohnungstyp ?? e.bezeichnung]
        .filter(Boolean).join(' · ')
      // Auch die Einheit greift auf die Kostenmiete zurück, wenn sie selbst
      // keinen Mietzins trägt — über ihre Zimmerzahl.
      // Die Kategorie kommt aus derselben Ableitung wie in der Mengenanalyse:
      // erfasste Zimmerzahl, sonst der Mix der Einheit, sonst der Sammelwert.
      const eigen = ertragVon(e, verkauf)
      const eErtrag = eigen > 0 || !jeTyp
        ? eigen
        : (jeTyp.get(wohnungsmixKey(zimmerFromEinheit(e).key)) ?? 0) * e.anzahl * 12
      zeilen.push({
        einzug: true,
        zellen: [
          '',
          name || (e.zimmer != null ? `${e.zimmer} Zi.` : 'Einheit'),
          e.anzahl > 0 ? formatNumber(e.anzahl) : '—',
          z(e.gf_m2),
          z(e.volumen_m3),
          z(e.flaeche_m2),
          ...ansaetze(e.flaeche_m2, e.anzahl, eErtrag, verkauf),
          z(eErtrag),
        ],
      })
    }
  }
  return {
    name: b.name,
    zeilen,
    total: summenZeile('Total', b.name, [b], verkauf, jeTyp),
    verkauf,
  }
}

/**
 * Die beiden Ansätze einer Zeile, zurückgerechnet aus Ertrag und Menge, damit
 * sie zur ausgewiesenen Summe passen: je Quadratmeter und je Einheit — beim
 * Verkauf ein Preis je Stück, sonst eine Monatsmiete.
 */
function ansaetze(
  flaeche: number, anzahl: number | null, ertrag: number, verkauf: boolean,
): [string, string] {
  if (ertrag <= 0) return ['—', '—']
  const stk = anzahl ?? 0
  return [
    flaeche > 0 ? z(ertrag / flaeche) : '—',
    stk > 0 ? z(verkauf ? ertrag / stk : ertrag / (stk * 12)) : '—',
  ]
}

/** Summe über Gebäude — Anzahl, GF, GV, VMF und Ertrag der Mietflächen. */
function summeVon(
  gebaeude: VariantBuildingFull[], verkauf: boolean, jeTyp: Map<string, number> | null,
) {
  let anzahl = 0, gf = 0, gv = 0, vmf = 0, ertrag = 0
  for (const b of gebaeude) {
    for (const m of b.mietflaechen) {
      anzahl += m.anzahl ?? 0
      gf += m.gf_m2 || 0
      gv += m.volumen_m3 || 0
      vmf += m.flaeche_m2 || 0
      ertrag += ertragMitKostenmiete(m, verkauf, jeTyp)
    }
  }
  return { anzahl, gf, gv, vmf, ertrag }
}

function summenZeile(
  label: string, bezug: string, gebaeude: VariantBuildingFull[], verkauf: boolean,
  jeTyp: Map<string, number> | null,
): TabellenZeile {
  const t = summeVon(gebaeude, verkauf, jeTyp)
  return {
    total: true,
    // Die Ansätze bleiben leer: über verschiedene Nutzungen gemittelt sagten
    // sie nichts.
    zellen: [label, bezug, z(t.anzahl), z(t.gf), z(t.gv), z(t.vmf), '', '', z(t.ertrag)],
  }
}

/**
 * Ein Haus als eine Zeile — die Übersicht stellt sie den Geschossen voran.
 * Anders als in der Summenzeile stehen die Ansätze hier: sie beziehen sich auf
 * ein Haus und lassen sich zwischen den Häusern vergleichen.
 */
function hausZeile(
  b: VariantBuildingFull, verkauf: boolean, jeTyp: Map<string, number> | null,
): TabellenZeile {
  const t = summeVon([b], verkauf, jeTyp)
  return {
    zellen: [
      b.name, b.nutzung_haupt ?? '—',
      z(t.anzahl), z(t.gf), z(t.gv), z(t.vmf),
      ...ansaetze(t.vmf, t.anzahl, t.ertrag, verkauf),
      z(t.ertrag),
    ],
  }
}

/**
 * Kopfzeile der Mengentabelle. Verkaufsobjekte führen Verkaufsflächen und
 * Preise statt Mietflächen und Jahresmieten; zwei Ansatzspalten, je
 * Quadratmeter und je Einheit — beim Verkauf ein Preis je Stück, sonst eine
 * Monatsmiete.
 */
function mengenKopf(verkauf: boolean, erste: string): string[] {
  return [
    erste, 'Nutzung', 'Stk', 'GF m²', 'GV m³',
    verkauf ? 'VKF m²' : 'VMF m²',
    'CHF/m²', verkauf ? 'CHF/Stk' : 'CHF/Mt,Stk',
    verkauf ? 'CHF' : 'CHF/Jahr',
  ]
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
    let gfOi = 0, gfUi = 0, vmf = 0, gv = 0, gvUi = 0
    for (const b of haeuser) {
      for (const m of b.mietflaechen) {
        if (m.unterirdisch) { gfUi += m.gf_m2 || 0; gvUi += m.volumen_m3 || 0 }
        else gfOi += m.gf_m2 || 0
        vmf += m.flaeche_m2 || 0
        gv += m.volumen_m3 || 0
      }
    }
    const gf = gfOi + gfUi
    return {
      gfOi, gfUi, gvOi: gv - gvUi, gvUi,
      anteilOi: gfOi > 0 ? vmf / gfOi : null,
      anteilTotal: gf > 0 ? vmf / gf : null,
      gvProGf: gf > 0 ? gv / gf : null,
      gvAnteilUi: gv > 0 ? gvUi / gv : null,
    }
  })

  // Einheiten stehen in der Zelle, nicht im Kopf: die Zeilen tragen
  // verschiedene — Flächen, Anteile und ein Verhältnis.
  const m2 = (v: number) => (v > 0 ? `${z(v)} m²` : '—')
  const m3 = (v: number) => (v > 0 ? `${z(v)} m³` : '—')
  const pct = (v: number | null) => (v != null ? `${(v * 100).toFixed(1)} %` : '—')
  const quot = (v: number | null) => (v != null ? `${v.toFixed(2)} m³/m²` : '—')

  return {
    kopf: ['Kennwert', ...spalten.map((sp) => sp.label)],
    zeilen: [
      { zellen: ['Geschossfläche oberirdisch', ...werte.map((w) => m2(w.gfOi))] },
      { zellen: ['Geschossfläche unterirdisch', ...werte.map((w) => m2(w.gfUi))] },
      { zellen: ['Gebäudevolumen oberirdisch', ...werte.map((w) => m3(w.gvOi))] },
      { zellen: ['Gebäudevolumen unterirdisch', ...werte.map((w) => m3(w.gvUi))] },
      { zellen: ['Anteil Gebäudevolumen unterirdisch', ...werte.map((w) => pct(w.gvAnteilUi))] },
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
        key: eig,
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
function ertragsBloecke(
  gebaeude: VariantBuildingFull[], mehrere: boolean, jeTyp: Map<string, number>,
) {
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
          menge[key].ertrag += ertragMitKostenmiete(
            m, verkauf, eig === 'genossenschaft' ? jeTyp : null)
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
        key: eig,
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
