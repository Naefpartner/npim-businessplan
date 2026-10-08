import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Scale } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useUndoableState } from '@/contexts/UndoContext'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { useRendite } from '@/hooks/useRendite'
import {
  berechneRendite, investitionAusErgebnis, sammleRenditeMengen,
} from '@/lib/rendite'
import { useTragbarkeit } from '@/hooks/useTragbarkeit'
import { useAufklappbar } from '@/hooks/useAufklappbar'
import {
  berechneTragbarkeit, berechneVerlauf, defaultTragbarkeitDoc, kapSatzAus,
  type TragbarkeitBasis, type TragbarkeitDoc, type TragbarkeitJahr,
} from '@/lib/tragbarkeit'
import { isNutzungWohnen } from '@/types'
import { EIGENTUMSART_COLOR, USE_TYPE_COLOR_1, USE_TYPE_COLOR_3 } from '@/lib/kategorieFarben'
import { formatNumber } from '@/lib/utils'

const EIG = 'renditeobjekt' as const
const FLAECHE = USE_TYPE_COLOR_3.renditeobjekt
const HILITE = USE_TYPE_COLOR_1.renditeobjekt

/** Zahl mit fester Nachkommastelle; leer bleibt leer. */
function chf(v: number, stellen = 0): string {
  return formatNumber(Number.isFinite(v) ? v : 0, stellen)
}

function pct(v: number, stellen = 1): string {
  return `${(v * 100).toFixed(stellen)} %`
}

/**
 * Tragbarkeit der Renditeobjekte — das Modell des Excel-Blatts „Finanzierung
 * Vertikal": aus Mietzinsniveau und Kapitalisierungssatz wird der Ertragswert,
 * daraus die Belehnung, und was die Belehnung nicht deckt, ist Eigenkapital.
 *
 * Zwei Spalten stehen nebeneinander: mit dem tatsächlichen Hypothekarzins und
 * mit dem kalkulatorischen Satz der Bank. Gerechnet wird je Quadratmeter
 * Wohnfläche; die Kontrolle daneben führt dieselben Grössen in Franken.
 */
export function TragbarkeitSection({ variantId, defaultExpanded = false }: {
  variantId: string
  defaultExpanded?: boolean
}) {
  const { canWrite } = useAuth()
  const ak = useAnlagekostenShared()
  const { params: rParams } = useRendite(variantId)
  const [expanded, umschalten] = useAufklappbar(defaultExpanded)

  // ── Persistenz (JSONB je Variante) + globales Undo/Redo ───────────────────
  const { loaded, loading, save } = useTragbarkeit(variantId)
  const [doc, setDoc, setDocSilent] = useUndoableState<TragbarkeitDoc>(
    defaultTragbarkeitDoc, 'Tragbarkeit')
  const hydriert = useRef(false)
  const zuletztGespeichert = useRef<TragbarkeitDoc | null>(null)
  const docRef = useRef(doc)
  const saveRef = useRef(save)
  useLayoutEffect(() => { docRef.current = doc; saveRef.current = save })
  useEffect(() => {
    if (loading || hydriert.current) return
    const init = loaded ?? defaultTragbarkeitDoc()
    zuletztGespeichert.current = init
    docRef.current = init
    hydriert.current = true
    setDocSilent(init)
  }, [loading, loaded, setDocSilent])
  useEffect(() => {
    if (!hydriert.current || doc === zuletztGespeichert.current) return
    const t = setTimeout(() => {
      zuletztGespeichert.current = docRef.current
      void saveRef.current(docRef.current)
    }, 600)
    return () => clearTimeout(t)
  }, [doc, save])
  useEffect(() => () => {
    if (hydriert.current && docRef.current !== zuletztGespeichert.current) {
      zuletztGespeichert.current = docRef.current
      void saveRef.current(docRef.current)
    }
  }, [])

  // ── Grundlagen aus der Variante ───────────────────────────────────────────
  const hatRendite = ak.presentEig.includes(EIG)

  /**
   * Mietertrag und Wohnfläche der Renditeobjekte. Die Wohnnutzungen tragen die
   * Rechnung: ihre Fläche ist die Bezugsgrösse, ihr Anteil am Gesamtertrag
   * rechnet die übrigen Nutzungen hinein.
   */
  const mengen = useMemo(() => {
    const detail = ak.ertragDetailByEig.get(EIG) ?? []
    let total = 0, wohnen = 0, vmfWohnen = 0
    for (const d of detail) {
      total += d.ertrag
      if (isNutzungWohnen(d.nutzung)) {
        wohnen += d.ertrag
        vmfWohnen += d.flaecheM2
      }
    }
    return { total, wohnen, vmfWohnen }
  }, [ak.ertragDetailByEig])

  const anlagekosten = ak.konsolidiertEffektiv.get(EIG)?.totalBrutto ?? 0

  /*
   * Der Ertragswert kommt aus der Wirtschaftlichkeitsrechnung: derselbe
   * kapitalisierte Liegenschaftserfolg, den der Reiter Wirtschaftlichkeit
   * ausweist. Die Belehnung hängt damit an derselben Bewertung — und der
   * Kapitalisierungssatz der Tragbarkeit ergibt sich daraus, statt eine zweite
   * Annahme zu sein.
   */
  const ertragswert = useMemo(() => {
    const erg = ak.konsolidiertEffektiv.get(EIG)
    const { ertraege, totalVmf } = sammleRenditeMengen(ak.buildings, null)
    const { investition, erstellung } = investitionAusErgebnis(erg)
    return berechneRendite(rParams, {
      mietertragSoll: ertraege.reduce((s, e) => s + e.ertrag, 0),
      totalVmf,
      investition,
      erstellung,
      gsf: ak.gsfTotal,
    }).ertragswert
  }, [ak.konsolidiertEffektiv, ak.buildings, ak.gsfTotal, rParams])

  /** Aus den Mengen abgeleitet — solange die Annahme nicht von Hand gesetzt ist. */
  const abgeleitet = useMemo(() => ({
    mietzinsniveauWohnen: mengen.vmfWohnen > 0 ? mengen.wohnen / mengen.vmfWohnen : 0,
    anteilWohnen: mengen.total > 0 ? mengen.wohnen / mengen.total : 1,
  }), [mengen])

  const params = useMemo(() => ({
    ...doc,
    mietzinsniveauWohnen: doc.eigenesMietzinsniveau
      ? doc.mietzinsniveauWohnen
      : abgeleitet.mietzinsniveauWohnen,
    anteilWohnen: doc.eigenerAnteilWohnen ? doc.anteilWohnen : abgeleitet.anteilWohnen,
  }), [doc, abgeleitet])

  const basis: TragbarkeitBasis = useMemo(() => ({
    mietertragTotal: mengen.total,
    mietertragWohnen: mengen.wohnen,
    vmfWohnen: mengen.vmfWohnen,
    anlagekosten,
    ertragswert,
  }), [mengen, anlagekosten, ertragswert])

  const erg = useMemo(() => berechneTragbarkeit(params, basis), [params, basis])
  const verlauf = useMemo(() => berechneVerlauf(params, basis), [params, basis])

  const setzen = (patch: Partial<TragbarkeitDoc>, label: string, key: string) =>
    setDoc((d) => ({ ...d, ...patch }), { label, coalesceKey: `trag:${key}` })

  /**
   * Einen Jahressatz setzen oder — mit `null` — wieder löschen, sodass das Jahr
   * den Satz des Vorjahres erbt. Jahr 1 bleibt immer gesetzt; ohne ihn hätte
   * die Reihe keinen Anfang.
   */
  const setzeSatz = (
    feld: 'ausfallProJahr' | 'kostenquoteProJahr' | 'unterhaltProJahr', jahr: number, wert: number | null,
  ) => setDoc((d) => {
    const neu = { ...d[feld] }
    if (wert == null && jahr > 1) delete neu[jahr]
    else neu[jahr] = wert ?? 0
    return { ...d, [feld]: neu }
  }, {
    label: feld === 'ausfallProJahr' ? 'Leerstand'
      : feld === 'unterhaltProJahr' ? 'Unterhaltskosten' : 'Betriebskosten',
    coalesceKey: `trag:${feld}:${jahr}`,
  })

  if (!hatRendite) return null

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={umschalten}
        style={{ backgroundColor: EIGENTUMSART_COLOR.renditeobjekt }}
        className="flex w-full items-center gap-2 px-5 py-3 text-sm font-semibold text-slate-900 transition hover:brightness-95"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-slate-700" /> : <ChevronRight className="h-4 w-4 text-slate-700" />}
        <Scale className="h-4 w-4 text-slate-700" />
        <span>Tragbarkeit</span>
      </button>

      {expanded && (loading ? (
        <div className="p-6 text-sm text-slate-500">Wird geladen…</div>
      ) : (
        <div className="space-y-5 p-5">
          {/* ── Annahmen ─────────────────────────────────────────────────── */}
          <UnterKapitel titel="Annahmen">
            {/*
              Drei Gruppen statt einer Liste aus zwölf Feldern: was zusammen
              gehört, steht beisammen, und in jeder Gruppe fluchten Werte und
              Einheiten in einer Spalte. Vorher standen die Eingaben unter
              verschieden langen Beschriftungen und damit auf verschiedener
              Höhe — das war der Grund für den unruhigen Eindruck.
            */}
            <div className="grid items-start gap-4 lg:grid-cols-3">
              <Gruppe titel="Ertrag und Bewertung">
                <ZahlFeld
                  label="Mietzinsniveau Wohnen"
                  einheit="CHF/m²·a"
                  wert={params.mietzinsniveauWohnen}
                  eigen={doc.eigenesMietzinsniveau}
                  abgeleitetWert={abgeleitet.mietzinsniveauWohnen}
                  canWrite={canWrite}
                  onChange={(v) => setzen(
                    { mietzinsniveauWohnen: v, eigenesMietzinsniveau: true }, 'Mietzinsniveau', 'miete')}
                  onZurueck={() => setzen({ eigenesMietzinsniveau: false }, 'Mietzinsniveau aus den Mengen', 'miete')} />
                <SatzFeld
                  label="Anteil Mietertrag Wohnen"
                  wert={params.anteilWohnen}
                  eigen={doc.eigenerAnteilWohnen}
                  abgeleitetWert={abgeleitet.anteilWohnen}
                  canWrite={canWrite}
                  onChange={(v) => setzen(
                    { anteilWohnen: v, eigenerAnteilWohnen: true }, 'Anteil Wohnen', 'anteil')}
                  onZurueck={() => setzen({ eigenerAnteilWohnen: false }, 'Anteil Wohnen aus den Mengen', 'anteil')} />
                <SatzFeld
                  label="Betrieb, Unterhalt, Erneuerung"
                  hinweis="Dauerwert für die Belehnung"
                  wert={doc.bewirtschaftungsquote} canWrite={canWrite}
                  onChange={(v) => setzen({ bewirtschaftungsquote: v }, 'Bewirtschaftungsquote', 'bew')} />
                <AnzeigeFeld
                  label="Ertragswert"
                  hinweis="aus der Wirtschaftlichkeit"
                  wert={chf(ertragswert)} einheit="CHF" />
                <AnzeigeFeld
                  label="Kapitalisierungssatz"
                  hinweis="Mietertrag ÷ Ertragswert"
                  wert={(kapSatzAus(basis) * 100).toFixed(2)} einheit="%" />
              </Gruppe>

              <Gruppe titel="Zinsen und Belehnung">
                <SatzFeld
                  label="Hypothekarzins"
                  hinweis="effektiv"
                  wert={doc.hypozins} canWrite={canWrite}
                  onChange={(v) => setzen({ hypozins: v }, 'Hypothekarzins', 'hypozins')} />
                <SatzFeld
                  label="Tragbarkeitszinssatz"
                  hinweis="kalkulatorisch"
                  wert={doc.tragbarkeitszins} canWrite={canWrite}
                  onChange={(v) => setzen({ tragbarkeitszins: v }, 'Tragbarkeitszins', 'trz')} />
                <SatzFeld
                  label="Max. 1. Hypothek"
                  hinweis="des Ertragswerts"
                  wert={doc.max1} canWrite={canWrite}
                  onChange={(v) => setzen({ max1: v }, 'Max. 1. Hypothek', 'max1')} />
                <SatzFeld
                  label="Max. Hypothek total"
                  hinweis="des Ertragswerts"
                  wert={doc.max2} canWrite={canWrite}
                  onChange={(v) => setzen({ max2: v }, 'Max. Hypothek total', 'max2')} />
              </Gruppe>

              <Gruppe titel="Finanzierung und Laufzeit">
                <ZahlFeld
                  label="Dauer Amortisation"
                  einheit="Jahre"
                  wert={doc.amortisationsdauer} canWrite={canWrite}
                  onChange={(v) => setzen({ amortisationsdauer: v }, 'Amortisationsdauer', 'dauer')} />
                <ZahlFeld
                  label="1. Hypothek"
                  hinweis="0 = aus der Belehnungsgrenze"
                  einheit="CHF"
                  wert={doc.ersteHypothekChf} canWrite={canWrite}
                  onChange={(v) => setzen({ ersteHypothekChf: v }, '1. Hypothek', 'hyp1')} />
                <ZahlFeld
                  label="Zusätzliche Eigenmittel"
                  einheit="CHF"
                  wert={doc.zusaetzlicheEigenmittel} canWrite={canWrite}
                  onChange={(v) => setzen({ zusaetzlicheEigenmittel: v }, 'Eigenmittel', 'ek')} />
              </Gruppe>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Leerstand, Betriebs- und Unterhaltskosten stehen als Ansätze in der Tabelle
              unten — dort lassen sie sich Jahr für Jahr setzen. Leerstand und Betrieb als
              Anteil des SOLL-Ertrags, der Unterhalt in CHF je m² Wohnfläche.
            </p>
          </UnterKapitel>

          {/* ── Rechnung je m² Wohnfläche ─────────────────────────────────── */}
          <UnterKapitel titel="Tragbare Belehnung je m² Wohnfläche">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col />
                <col style={{ width: '9rem' }} />
                <col style={{ width: '9rem' }} />
                <col style={{ width: '6rem' }} />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3 text-left font-medium">Grösse</th>
                  <th className="py-2 pr-3 text-right font-medium">Effektiv</th>
                  <th className="py-2 pr-3 text-right font-medium">Tragbarkeit</th>
                  <th className="py-2 text-left font-medium">Einheit</th>
                </tr>
              </thead>
              <tbody>
                <Zeile label="Zinssatz" e={pct(erg.effektiv.zinssatz, 2)} t={pct(erg.tragbarkeit.zinssatz, 2)} einheit="" />
                <Zeile label="Mietertrag je m² Wohnfläche" e={chf(erg.effektiv.ertragProM2, 2)} t={chf(erg.tragbarkeit.ertragProM2, 2)} einheit="CHF/m²·a" />
                <Zeile label="Nettoertrag vor Finanzierung" e={chf(erg.effektiv.nettoertrag, 2)} t={chf(erg.tragbarkeit.nettoertrag, 2)} einheit="CHF/m²·a" />
                <Zeile label="Ertragswert" e={chf(erg.effektiv.ertragswertProM2)} t={chf(erg.tragbarkeit.ertragswertProM2)} einheit="CHF/m²" />
                <Zeile label="1. Hypothek" e={chf(erg.effektiv.ersteHypothek)} t={chf(erg.tragbarkeit.ersteHypothek)} einheit="CHF/m²" />
                <Zeile label="Zins 1. Hypothek" e={chf(erg.effektiv.finanzierungskosten, 2)} t={chf(erg.tragbarkeit.finanzierungskosten, 2)} einheit="CHF/m²·a" />
                <Zeile label="Maximale Amortisation" e={chf(erg.effektiv.maximaleAmortisation, 2)} t={chf(erg.tragbarkeit.maximaleAmortisation, 2)} einheit="CHF/m²·a"
                  warnT={erg.tragbarkeit.maximaleAmortisation < 0} warnE={erg.effektiv.maximaleAmortisation < 0} />
                <Zeile label="Belehnungsgrenze" e={chf(erg.effektiv.belehnungsgrenze)} t={chf(erg.tragbarkeit.belehnungsgrenze)} einheit="CHF/m²" />
                <Zeile label="Tragbare Hypothek total" e={chf(erg.effektiv.maxHypothek)} t={chf(erg.tragbarkeit.maxHypothek)} einheit="CHF/m²" stark />
                <Zeile label="Anlagekosten inkl. MWST" e={chf(erg.effektiv.baukostenProM2)} t={chf(erg.tragbarkeit.baukostenProM2)} einheit="CHF/m²" />
                <Zeile label="Nötiges Eigenkapital" e={chf(erg.effektiv.eigenkapitalProM2)} t={chf(erg.tragbarkeit.eigenkapitalProM2)} einheit="CHF/m²" stark />
                <Zeile
                  label={`Nötiges Eigenkapital auf ${chf(basis.vmfWohnen)} m² Wohnfläche`}
                  e={chf(erg.effektiv.eigenkapital)} t={chf(erg.tragbarkeit.eigenkapital)}
                  einheit="CHF" stark />
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-slate-500">
              Die 1. Hypothek trägt nur Zins; was der Nettoertrag darüber hinaus hergibt,
              amortisiert die 2. in {doc.amortisationsdauer} Jahren. Mehr als die
              Belehnungsgrenze gibt es auch dann nicht, wenn der Ertrag es hergäbe — in der
              Spalte Tragbarkeit hängt die Hypothek {erg.tragbarkeit.grenze === 'amortisation'
                ? 'an der Amortisationskraft'
                : 'an der Belehnungsgrenze'}.
            </p>
          </UnterKapitel>

          {/* ── Verlauf Jahr für Jahr ─────────────────────────────────────── */}
          <UnterKapitel titel="Erfolgsrechnung und Fremdkapital über die Laufzeit">
            {/*
              Jahre stehen auf der Waagrechten, die Positionen untereinander —
              wie in der Mittelflussrechnung. So liest man eine Position über
              die ganze Laufzeit in einer Zeile, statt sie Jahr für Jahr aus
              einer Spalte zusammenzusuchen. Die Beschriftung bleibt beim
              Scrollen stehen und braucht dafür einen deckenden Hintergrund.
            */}
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              {/*
                `border-separate` ist kein Geschmack, sondern Bedingung: mit dem
                voreingestellten `border-collapse: collapse` bleibt eine
                klebende Spalte in Chrome stehen, wo sie will. Die Linien sitzen
                deshalb auf den Zellen statt auf den Zeilen.
              */}
              <table className="border-separate border-spacing-0 text-xs tabular-nums"
                style={{ minWidth: SPALTE_POS + verlauf.length * SPALTE_JAHR }}>
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                    <th style={{ ...klebt, backgroundColor: '#ffffff', width: SPALTE_POS, minWidth: SPALTE_POS }}
                      className="border-b border-slate-300 px-3 py-1.5 text-left font-medium">Position</th>
                    {verlauf.map((j, i) => (
                      <th key={j.label}
                        className="border-b border-slate-300 px-1.5 py-1.5 text-right font-medium"
                        style={{
                          width: SPALTE_JAHR,
                          minWidth: SPALTE_JAHR,
                          ...(i >= verlauf.length - 2 ? { backgroundColor: HILITE } : {}),
                        }}>
                        <div>{j.kurz}</div>
                        {j.zusatz && <div className="text-[9px] normal-case tracking-normal text-slate-400">{j.zusatz}</div>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <PosZeile label="SOLL-Ertrag" verlauf={verlauf} wert={(j) => j.mietertragSoll} />
                  <PosZeile label="Leerstand" verlauf={verlauf}
                    wert={(j) => j.ertragsausfall} anteil={(j) => j.ausfallQuote}
                    satz={{
                      feld: 'ausfallProJahr', prozent: true,
                      roh: (j) => j.ausfallQuote, eigen: (j) => j.ausfallEigen,
                    }}
                    canWrite={canWrite} onSatz={setzeSatz} />
                  <PosZeile label="IST-Ertrag" verlauf={verlauf}
                    wert={(j) => j.mietertragIst} anteil={(j) => 1 - j.ausfallQuote} />
                  <PosZeile label="Betriebskosten" verlauf={verlauf}
                    wert={(j) => j.betriebskosten}
                    satz={{
                      feld: 'kostenquoteProJahr', prozent: true,
                      roh: (j) => j.betriebsQuote, eigen: (j) => j.betriebEigen,
                    }}
                    canWrite={canWrite} onSatz={setzeSatz} />
                  {/* Unterhalt hängt an der Fläche, nicht am Mietertrag — der
                      Ansatz steht deshalb in CHF je m² Wohnfläche. */}
                  <PosZeile label="Unterhaltskosten" einheit="CHF/m²" verlauf={verlauf}
                    wert={(j) => j.unterhalt}
                    satz={{
                      feld: 'unterhaltProJahr', prozent: false,
                      roh: (j) => j.unterhaltProM2, eigen: (j) => j.unterhaltEigen,
                    }}
                    canWrite={canWrite} onSatz={setzeSatz} />
                  <PosZeile label="Liegenschaftserfolg" verlauf={verlauf}
                    wert={(j) => j.liegenschaftserfolg} anteil={(j) => j.erfolgQuote} stark />
                  <PosZeile label="Fremdkapital" verlauf={verlauf}
                    wert={(j) => j.fremdkapital} anteil={(j) => j.belehnung} />
                  <PosZeile label="1. Hypothek" verlauf={verlauf} wert={(j) => j.ersteHypothek} />
                  <PosZeile label="2. Hypothek" verlauf={verlauf} wert={(j) => j.zweiteHypothek} />
                  <PosZeile label="Zins 1. Hypothek" verlauf={verlauf} wert={(j) => j.zinsErste} />
                  <PosZeile label="Zins 2. Hypothek" verlauf={verlauf} wert={(j) => j.zinsZweite} />
                  <PosZeile label="Amortisation" verlauf={verlauf} wert={(j) => j.amortisation} />
                  <PosZeile label="Überschuss" verlauf={verlauf}
                    wert={(j) => j.ueberschuss} stark warnNegativ />
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Die 1. Hypothek steht, amortisiert wird allein die 2. — in gleichen Raten über
              {' '}{doc.amortisationsdauer} Jahre. Die beiden letzten Spalten rechnen dasselbe Jahr
              ohne 2. Hypothek, einmal zum kalkulatorischen Satz und einmal zum tatsächlichen
              Zins: die Probe, ob die Liegenschaft auch dann trägt. Leerstand und Kosten lassen
              sich je Jahr setzen; ein gesetzter Satz gilt von dort an weiter.
            </p>
          </UnterKapitel>

          {/* ── Kontrolle in Franken ──────────────────────────────────────── */}
          <UnterKapitel titel="Kontrolle in Franken">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col />
                <col style={{ width: '12rem' }} />
              </colgroup>
              <tbody>
                <KontrollZeile label="Total Mietertrag" wert={chf(erg.kontrolle.mietertrag)} einheit="CHF/a" />
                <KontrollZeile label="Ertragswert" wert={chf(erg.kontrolle.ertragswert)} einheit="CHF" />
                <KontrollZeile label="Kosten gemäss Businessplan" wert={chf(erg.kontrolle.kosten)} einheit="CHF" />
                <KontrollZeile label="Zusätzliche Eigenmittel" wert={chf(erg.kontrolle.eigenmittel)} einheit="CHF" />
                <KontrollZeile label="Nötiges Fremdkapital" wert={chf(erg.kontrolle.noetigesFremdkapital)} einheit="CHF" stark />
                <KontrollZeile label="Maximal mögliche Belehnung" wert={chf(erg.kontrolle.maximaleBelehnung)} einheit="CHF" stark />
                <KontrollZeile
                  label={erg.kontrolle.tragbar ? 'Spielraum' : 'Fehlbetrag'}
                  wert={chf(Math.abs(erg.kontrolle.spielraum))}
                  einheit="CHF"
                  warn={!erg.kontrolle.tragbar}
                  stark />
              </tbody>
            </table>
            <p className={`mt-2 text-xs ${erg.kontrolle.tragbar ? 'text-slate-500' : 'text-amber-700'}`}>
              {erg.kontrolle.tragbar
                ? `Das nötige Fremdkapital liegt ${chf(erg.kontrolle.spielraum)} CHF unter der Belehnungsgrenze von ${pct(doc.max2, 0)} des Ertragswerts.`
                : `Das nötige Fremdkapital übersteigt die Belehnungsgrenze um ${chf(-erg.kontrolle.spielraum)} CHF — es braucht mehr Eigenmittel oder tiefere Kosten.`}
            </p>
          </UnterKapitel>
        </div>
      ))}
    </section>
  )
}

// ─── Bausteine ────────────────────────────────────────────────────────────────

function UnterKapitel({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="px-1 py-1 text-xs font-semibold uppercase tracking-wider text-slate-600"
        style={{ backgroundColor: FLAECHE }}>
        <span className="px-2">{titel}</span>
      </h3>
      <div className="px-1">{children}</div>
    </div>
  )
}

/** Die feststehende Beschriftungsspalte der quergestellten Tabelle. */
const klebt: React.CSSProperties = {
  position: 'sticky', left: 0, zIndex: 2, borderRight: '1px solid rgb(226 232 240)',
}

/*
 * Spaltenmass der Verlaufstabelle. Die Jahresspalten sind so schmal gehalten,
 * wie ein Betrag mit Tausenderzeichen und der Satz darunter es zulassen —
 * damit möglichst die ganze Laufzeit auf einen Blick dasteht.
 */
const SPALTE_POS = 168
const SPALTE_JAHR = 72

/**
 * Eine Position über alle Jahre. Unter dem Betrag steht, wo das Excel eine
 * Prozentspalte führt, der Anteil — am SOLL-Ertrag bei den Ertragszeilen, am
 * Ertragswert beim Fremdkapital. Bei Leerstand und Kosten ist dieser Anteil
 * zugleich die Eingabe.
 */
function PosZeile({
  label, einheit, verlauf, wert, anteil, satz, canWrite, onSatz, stark, warnNegativ,
}: {
  label: string
  /** Einheit des Ansatzes unter dem Betrag, wo sie nicht Prozent ist. */
  einheit?: string
  verlauf: TragbarkeitJahr[]
  wert: (j: TragbarkeitJahr) => number
  anteil?: (j: TragbarkeitJahr) => number
  /** Macht den Ansatz unter dem Betrag zur Eingabe. */
  satz?: {
    feld: 'ausfallProJahr' | 'kostenquoteProJahr' | 'unterhaltProJahr'
    /** Der gespeicherte Ansatz — Anteil bei Prozent, Franken sonst. */
    roh: (j: TragbarkeitJahr) => number
    eigen: (j: TragbarkeitJahr) => boolean
    prozent: boolean
  }
  canWrite?: boolean
  onSatz?: (feld: 'ausfallProJahr' | 'kostenquoteProJahr' | 'unterhaltProJahr', jahr: number, wert: number | null) => void
  stark?: boolean
  /** Ein Minus ist hier ein Befund und wird farbig gesetzt. */
  warnNegativ?: boolean
}) {
  return (
    <tr>
      <td style={{ ...klebt, backgroundColor: '#ffffff', width: SPALTE_POS, minWidth: SPALTE_POS }}
        className={`border-b border-slate-100 px-3 py-1 text-left ${stark ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
        {label}
        {einheit && <span className="ml-1 text-[10px] text-slate-400">{einheit}</span>}
      </td>
      {verlauf.map((j, i) => {
        const nachLaufzeit = i >= verlauf.length - 2
        const v = wert(j)
        return (
          <td key={j.label} className="border-b border-slate-100 px-1.5 py-1 text-right"
            style={nachLaufzeit ? { backgroundColor: HILITE } : undefined}>
            <div className={`text-[11px] ${stark ? 'font-semibold ' : ''}${
              warnNegativ && v < 0 ? 'text-amber-700' : 'text-slate-900'}`}>
              {chf(v)}
            </div>
            {satz && onSatz ? (
              <JahresSatzFeld
                roh={satz.roh(j)}
                prozent={satz.prozent}
                eigen={satz.eigen(j)}
                jahr={j.jahr}
                canWrite={!!canWrite && !nachLaufzeit}
                onSatz={(neu) => onSatz(satz.feld, j.jahr, neu)} />
            ) : anteil ? (
              <div className="text-[9px] text-slate-400">{pct(anteil(j), 1)}</div>
            ) : null}
          </td>
        )
      })}
    </tr>
  )
}

/**
 * Der Satz unter dem Betrag — und er ist die Eingabe. Was in einem Jahr
 * gesetzt wird, gilt von dort an weiter; ein geerbter Satz steht blass, ein
 * gesetzter kräftig. Leeren löscht die Eingabe, das Jahr erbt dann wieder
 * (Jahr 1 ausgenommen, es ist der Anfang der Reihe).
 */
function JahresSatzFeld({ roh: gespeichert, prozent, eigen, jahr, canWrite, onSatz }: {
  /** Der gespeicherte Ansatz: Anteil (0.02) bei Prozent, sonst Franken. */
  roh: number
  /** Prozent wird mal hundert gezeigt und wieder geteilt gespeichert. */
  prozent: boolean
  eigen: boolean
  jahr: number
  canWrite: boolean
  onSatz: (wert: number | null) => void
}) {
  const [roh, setRoh] = useState<string | null>(null)
  const faktor = prozent ? 100 : 1
  const anzeige = roh ?? (gespeichert * faktor).toFixed(2).replace(/\.?0+$/, '')
  if (!canWrite) {
    return (
      <div className="text-[9px] text-slate-400">
        {prozent ? pct(gespeichert, 1) : chf(gespeichert, 0)}
      </div>
    )
  }
  return (
    // Dieselbe graue Fläche wie bei den Annahmen — sie markiert die Eingabe.
    <div className="ml-auto flex w-fit items-center gap-0.5 rounded bg-slate-100 px-1 focus-within:bg-white focus-within:ring-1 focus-within:ring-[#B98C74]">
      <input
        type="text"
        inputMode="decimal"
        value={anzeige}
        title={eigen ? 'In diesem Jahr gesetzt' : 'Vom Vorjahr übernommen'}
        onChange={(e) => setRoh(e.target.value)}
        onBlur={() => {
          if (roh != null) {
            const leer = roh.trim() === ''
            const v = Number(roh.replace(',', '.'))
            if (leer && jahr > 1) onSatz(null)
            else if (Number.isFinite(v)) onSatz(v / faktor)
          }
          setRoh(null)
        }}
        className={`w-8 rounded border-0 bg-transparent px-0 py-0 text-right text-[9px] tabular-nums focus:outline-none ${
          eigen ? 'font-semibold text-slate-700' : 'text-slate-400'}`}
      />
      {prozent && <span className="text-[9px] text-slate-400">%</span>}
    </div>
  )
}

function Zeile({ label, e, t, einheit, stark, warnE, warnT }: {
  label: string
  e: string
  t: string
  einheit: string
  stark?: boolean
  warnE?: boolean
  warnT?: boolean
}) {
  return (
    <tr className="border-b border-slate-100" style={stark ? { backgroundColor: HILITE } : undefined}>
      <td className={`py-1.5 pr-3 ${stark ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{label}</td>
      <td className={`py-1.5 pr-3 text-right tabular-nums ${warnE ? 'text-amber-700' : ''} ${stark ? 'font-semibold' : ''}`}>{e}</td>
      <td className={`py-1.5 pr-3 text-right tabular-nums ${warnT ? 'text-amber-700' : ''} ${stark ? 'font-semibold' : ''}`}>{t}</td>
      <td className="py-1.5 text-left text-xs text-slate-400">{einheit}</td>
    </tr>
  )
}

function KontrollZeile({ label, wert, einheit, stark, warn }: {
  label: string
  wert: string
  einheit: string
  stark?: boolean
  warn?: boolean
}) {
  return (
    <tr className="border-b border-slate-100" style={stark ? { backgroundColor: HILITE } : undefined}>
      <td className={`py-1.5 pr-3 ${stark ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{label}</td>
      <td className={`py-1.5 text-right tabular-nums ${warn ? 'text-amber-700' : ''} ${stark ? 'font-semibold' : ''}`}>
        {wert} <span className="text-xs font-normal text-slate-400">{einheit}</span>
      </td>
    </tr>
  )
}

/**
 * Eingabe eines Satzes in Prozent. Gespeichert wird der Anteil (0.023), gezeigt
 * die Prozentzahl — mit einem Textfeld, damit „2.3" nicht beim Punkt kippt.
 */
function SatzFeld({ label, hinweis, wert, canWrite, onChange, eigen, abgeleitetWert, onZurueck }: {
  label: string
  hinweis?: string
  wert: number
  canWrite: boolean
  onChange: (v: number) => void
  /** Von Hand gesetzt statt aus den Mengen abgeleitet. */
  eigen?: boolean
  abgeleitetWert?: number
  onZurueck?: () => void
}) {
  return (
    <FeldRahmen label={label} hinweis={hinweis} einheit="%" eigen={eigen}
      abgeleitet={abgeleitetWert != null ? `${(abgeleitetWert * 100).toFixed(1)} %` : undefined}
      onZurueck={onZurueck}>
      <TextZahl
        wert={wert * 100}
        stellen={2}
        disabled={!canWrite}
        onChange={(v) => onChange(v / 100)} />
    </FeldRahmen>
  )
}

function ZahlFeld({ label, hinweis, wert, einheit, canWrite, onChange, eigen, abgeleitetWert, onZurueck }: {
  label: string
  hinweis?: string
  wert: number
  einheit: string
  canWrite: boolean
  onChange: (v: number) => void
  eigen?: boolean
  abgeleitetWert?: number
  onZurueck?: () => void
}) {
  return (
    <FeldRahmen label={label} hinweis={hinweis} einheit={einheit} eigen={eigen}
      abgeleitet={abgeleitetWert != null ? formatNumber(abgeleitetWert, 2) : undefined}
      onZurueck={onZurueck}>
      <TextZahl wert={wert} stellen={2} disabled={!canWrite} onChange={onChange} />
    </FeldRahmen>
  )
}

/**
 * Eine Grösse, die aus einer anderen Rechnung kommt — nur zum Lesen. Sie steht
 * in derselben Zeilenform wie die Eingaben, aber ohne graue Fläche: das ist
 * der Unterschied, den man auf einen Blick sehen soll.
 */
function AnzeigeFeld({ label, hinweis, wert, einheit }: {
  label: string
  hinweis: string
  wert: string
  einheit: string
}) {
  return (
    <FeldRahmen label={label} hinweis={hinweis} einheit={einheit}>
      <div className="w-24 px-2 py-1 text-right text-sm tabular-nums text-slate-500">{wert}</div>
    </FeldRahmen>
  )
}

/**
 * Eine Gruppe der Annahmen: ein Kasten mit schmaler Überschrift. Drei davon
 * nebeneinander ersetzen die lange Liste — jede trägt, was in der Rechnung
 * zusammengehört.
 */
function Gruppe({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 pb-1 pt-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {titel}
      </div>
      {children}
    </div>
  )
}

/**
 * Eine Zeile der Annahmen: Beschriftung links, Wert rechts, Einheit in einer
 * eigenen schmalen Spalte. Weil die Spalten fest sind, fluchten alle Werte
 * untereinander — unabhängig davon, wie lang die Beschriftung ist.
 */
function FeldRahmen({ label, hinweis, einheit, children, eigen, abgeleitet, onZurueck }: {
  label: string
  /** Zweite Zeile unter der Beschriftung: Herkunft, Einschränkung, Lesehilfe. */
  hinweis?: string
  einheit: string
  children: ReactNode
  eigen?: boolean
  abgeleitet?: string
  onZurueck?: () => void
}) {
  return (
    <label className="flex items-center justify-between gap-2 border-b border-slate-100 py-1 text-xs text-slate-600 last:border-0">
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-slate-700">{label}</span>
        {/* Wo eine Grösse aus den Mengen kommt, steht das darunter — und ein
            Weg zurück, wenn man sie von Hand überschrieben hat. */}
        {hinweis && <span className="block text-[10px] text-slate-400">{hinweis}</span>}
        {abgeleitet != null && (eigen
          ? (
            <button type="button" onClick={onZurueck}
              className="mt-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-500 hover:bg-slate-200">
              eigener Wert · aus Mengen: {abgeleitet}
            </button>
          )
          : <span className="block text-[10px] text-slate-400">aus den Mengen</span>)}
      </span>
      <span className="shrink-0">{children}</span>
      <span className="w-14 shrink-0 text-[10px] text-slate-400">{einheit}</span>
    </label>
  )
}

/**
 * Zahlenfeld auf Textbasis: während des Tippens bleibt die Rohfassung stehen,
 * gerechnet wird beim Verlassen. Ein `type="number"` sprang beim Dezimalpunkt
 * auf null zurück.
 */
function TextZahl({ wert, stellen, disabled, onChange }: {
  wert: number
  stellen: number
  disabled: boolean
  onChange: (v: number) => void
}) {
  const [roh, setRoh] = useState<string | null>(null)
  const anzeige = roh ?? (Number.isFinite(wert)
    ? String(Number(wert.toFixed(stellen)))
    : '0')
  return (
    <input
      type="text"
      inputMode="decimal"
      value={anzeige}
      disabled={disabled}
      onChange={(e) => setRoh(e.target.value)}
      onBlur={() => {
        if (roh != null) {
          const v = Number(roh.replace(',', '.'))
          onChange(Number.isFinite(v) ? v : 0)
        }
        setRoh(null)
      }}
      /*
       * Leicht grau hinterlegt: wo man schreiben kann, soll man es sehen, ohne
       * hineinzuklicken. Angezeigte Grössen stehen daneben ohne Fläche. Beim
       * Tippen wird das Feld weiss — dann ist der Cursor die Auskunft.
       */
      className="w-24 rounded-md border border-slate-200 bg-slate-100 px-2 py-1 text-right text-sm tabular-nums text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#B98C74] disabled:bg-slate-50 disabled:opacity-60"
    />
  )
}
