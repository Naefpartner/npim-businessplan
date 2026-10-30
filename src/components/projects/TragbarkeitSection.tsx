import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Scale } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useUndoableState } from '@/contexts/UndoContext'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { useRendite } from '@/hooks/useRendite'
import { useTragbarkeit } from '@/hooks/useTragbarkeit'
import { rechneTragbarkeit } from '@/lib/tragbarkeitRechnung'
import { useAufklappbar } from '@/hooks/useAufklappbar'
import { useEingabe } from '@/hooks/useEingabe'
import {
  defaultTragbarkeitDoc, kapSatzAus,
  type TragbarkeitDoc, type TragbarkeitJahr, type TragbarkeitSchieber, type AnnahmeGroesse,
} from '@/lib/tragbarkeit'
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
 * Angezeigt werden der Verlauf über die Laufzeit und die Kontrolle in Franken;
 * die Rechnung je m² Wohnfläche ist ausgeblendet.
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

  const { berechnet, sim, aktiv, sch, annBerechnet, annSim, params, basisAus, maxErsteBerechnet, maxErsteSim, erg, verlauf } =
    rechneTragbarkeit({
      doc, rParams,
      ertragDetail: ak.ertragDetailByEig.get(EIG) ?? [],
      buildings: ak.buildings,
      ergebnis: ak.konsolidiertEffektiv.get(EIG),
      gsf: ak.gsfTotal,
    })

  const setzen = (patch: Partial<TragbarkeitDoc>, label: string, key: string) =>
    setDoc((d) => ({ ...d, ...patch }), { label, coalesceKey: `trag:${key}` })

  /** Schieber einer berechneten Grösse setzen (`null` = zurück zum berechneten
   *  Wert). Wer schiebt, will die Wirkung sehen — deshalb gleich auf Schieber. */
  const setzeSchieber = (k: keyof TragbarkeitSchieber, v: number | null, label: string) =>
    setDoc((d) => ({ ...d, schieberAktiv: v != null || d.schieberAktiv, schieber: { ...d.schieber, [k]: v } }),
      { label, coalesceKey: `trag:sch:${k}` })

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

  const ANNAHME_LABEL: Record<AnnahmeGroesse, string> = {
    hypozins: 'Hypothekarzins', tragbarkeitszins: 'Tragbarkeitszins', max1: 'Max. 1. Hypothek',
    max2: 'Max. Hypothek total', ersteHypothekChf: '1. Hypothek', amortisationsdauer: 'Amortisationsdauer', zusaetzlicheEigenmittel: 'Eigenmittel',
  }
  /** Reine Annahme: links das Eingabefeld, rechts ihr Schieber. */
  const annahmeZeile = (k: AnnahmeGroesse, label: string, hinweis: string | undefined, o: {
    min?: number; max: number; step: number; prozent?: boolean; einheit?: string; ganz?: boolean
  }) => {
    const glatt = (v: number) => (o.ganz ? Math.max(1, Math.round(v)) : Math.max(0, v))
    return (
      <AnnahmeZeile label={label} hinweis={hinweis} einheit={o.einheit ?? ''} aktiv={aktiv} canWrite={canWrite}
        eingabe={{ wert: annBerechnet[k], prozent: o.prozent,
          onChange: (v) => setzen({ [k]: glatt(v) }, ANNAHME_LABEL[k], k) }}
        regler={{ min: o.min ?? 0, max: Math.max(o.max, annSim[k], annBerechnet[k]), step: o.step, prozent: o.prozent,
          wert: annSim[k], eigen: sch[k] != null,
          onChange: (v) => setzeSchieber(k, glatt(v), ANNAHME_LABEL[k]),
          onZurueck: () => setzeSchieber(k, null, `${ANNAHME_LABEL[k]} wie eingegeben`) }} />
    )
  }

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
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <span className="text-xs text-slate-500">Rechnen mit</span>
              <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 text-xs font-medium">
                {([[false, 'Berechneten Werten'], [true, 'Schiebern']] as const).map(([wert, text]) => (
                  <button key={text} type="button" disabled={!canWrite}
                    onClick={() => setzen({ schieberAktiv: wert }, wert ? 'Schieber' : 'Berechnete Werte', 'modus')}
                    className={`px-3 py-1.5 transition ${aktiv === wert
                      ? 'bg-[#8B6956] text-white'
                      : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                    {text}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-slate-400">
                {aktiv
                  ? 'Unten wirkt, was die Schieber zeigen.'
                  : 'Unten wirken die berechneten und eingegebenen Werte der linken Spalte.'}
              </span>
            </div>
            <table className="w-full text-xs">
              <colgroup>
                <col style={{ width: '13rem' }} />
                <col style={{ width: '11.5rem' }} />
                <col />
                <col style={{ width: '7.5rem' }} />
                <col style={{ width: '4.5rem' }} />
                <col style={{ width: '2rem' }} />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400">
                  <th className="py-1.5 pr-3 text-left font-medium">Annahme</th>
                  <th className={`py-1.5 pr-3 text-right font-medium ${aktiv ? '' : 'text-slate-700'}`}>Berechnet / eingegeben</th>
                  <th className={`px-3 py-1.5 text-left font-medium ${aktiv ? 'text-slate-700' : ''}`}>Schieber</th>
                  <th />
                  <th />
                  <th />
                </tr>
              </thead>
              <tbody>
                <GruppenZeile titel="Aus den Berechnungen" />
                <AnnahmeZeile label="Mietertrag SOLL" hinweis="Mengen der Renditeobjekte" einheit="CHF/a"
                  berechnet={chf(berechnet.mietertrag)} aktiv={aktiv} canWrite={canWrite}
                  regler={{ ...spanne(berechnet.mietertrag, sim.mietertrag), wert: sim.mietertrag, eigen: sch.mietertrag != null,
                    onChange: (v) => setzeSchieber('mietertrag', v, 'Mietertrag'),
                    onZurueck: () => setzeSchieber('mietertrag', null, 'Mietertrag berechnet') }} />
                <AnnahmeZeile label="Ertragswert" hinweis={sch.ertragswert == null && sch.mietertrag != null
                    ? 'folgt dem Mietertrag' : 'aus der Wirtschaftlichkeit'} einheit="CHF"
                  berechnet={chf(berechnet.ertragswert)} aktiv={aktiv} canWrite={canWrite}
                  regler={{ ...spanne(berechnet.ertragswert, sim.ertragswert), wert: sim.ertragswert, eigen: sch.ertragswert != null,
                    onChange: (v) => setzeSchieber('ertragswert', v, 'Ertragswert'),
                    onZurueck: () => setzeSchieber('ertragswert', null, 'Ertragswert berechnet') }} />
                <AnnahmeZeile label="Kapitalisierungssatz" hinweis="Mietertrag ÷ Ertragswert" einheit=""
                  berechnet={pct(kapSatzAus(basisAus(berechnet)), 2)} aktiv={aktiv} canWrite={canWrite}
                  anzeige={pct(kapSatzAus(basisAus(sim)), 2)} />
                <AnnahmeZeile label="Anlagekosten inkl. MWST" hinweis="aus den Anlagekosten" einheit="CHF"
                  berechnet={chf(berechnet.anlagekosten)} aktiv={aktiv} canWrite={canWrite}
                  regler={{ ...spanne(berechnet.anlagekosten, sim.anlagekosten), wert: sim.anlagekosten, eigen: sch.anlagekosten != null,
                    onChange: (v) => setzeSchieber('anlagekosten', v, 'Anlagekosten'),
                    onZurueck: () => setzeSchieber('anlagekosten', null, 'Anlagekosten berechnet') }} />
                <AnnahmeZeile label="Wohnfläche" hinweis="Bezug der Unterhaltskosten" einheit="m²"
                  berechnet={chf(berechnet.vmfWohnen)} aktiv={aktiv} canWrite={canWrite}
                  regler={{ ...spanne(berechnet.vmfWohnen, sim.vmfWohnen), wert: sim.vmfWohnen, eigen: sch.vmfWohnen != null,
                    onChange: (v) => setzeSchieber('vmfWohnen', v, 'Wohnfläche'),
                    onZurueck: () => setzeSchieber('vmfWohnen', null, 'Wohnfläche berechnet') }} />

                <GruppenZeile titel="Zinsen und Belehnung" />
                {annahmeZeile('hypozins', 'Hypothekarzins', 'effektiv', { max: 0.08, step: 0.05, prozent: true })}
                {annahmeZeile('tragbarkeitszins', 'Tragbarkeitszinssatz', 'kalkulatorisch', { max: 0.1, step: 0.05, prozent: true })}
                {annahmeZeile('max1', 'Max. 1. Hypothek', 'des Ertragswerts', { max: 1, step: 1, prozent: true })}
                {annahmeZeile('max2', 'Max. Hypothek total', 'des Ertragswerts', { max: 1, step: 1, prozent: true })}
                {annahmeZeile('ersteHypothekChf', '1. Hypothek',
                  `Maximum aus Belehnung: ${chf(maxErsteBerechnet)} CHF${aktiv && Math.round(maxErsteSim) !== Math.round(maxErsteBerechnet)
                    ? ` · mit Schiebern ${chf(maxErsteSim)}` : ''}`,
                  { ...spanne(0, Math.max(annSim.ersteHypothekChf, annBerechnet.ersteHypothekChf), Math.max(1, berechnet.anlagekosten)), einheit: 'CHF' })}

                <GruppenZeile titel="Finanzierung und Laufzeit" />
                {annahmeZeile('amortisationsdauer', 'Dauer Amortisation', undefined, { min: 1, max: 40, step: 1, einheit: 'Jahre', ganz: true })}
                {annahmeZeile('zusaetzlicheEigenmittel', 'Zusätzliche Eigenmittel', undefined, {
                  ...spanne(0, Math.max(doc.zusaetzlicheEigenmittel, annSim.zusaetzlicheEigenmittel), Math.max(berechnet.anlagekosten * 0.5, 1)),
                  einheit: 'CHF' })}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-slate-500">
              Links steht, was aus Mengen, Anlagekosten und Wirtschaftlichkeit kommt — es lässt
              sich hier nicht ändern —, und was als Zinsen, Belehnung und Laufzeit eingegeben ist.
              Die Schieber daneben spielen Werte durch, ohne die linke Spalte zu verändern. Ein
              Doppelklick auf Schieber oder Zahl öffnet das Feld zum Eintippen (Enter übernimmt,
              Escape verwirft); ↺ setzt den Schieber auf den linken Wert zurück.
              Leerstand, Betriebs- und Unterhaltskosten stehen als Ansätze in der Tabelle unten.
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
              {' '}{params.amortisationsdauer} Jahre. Die beiden letzten Spalten rechnen dasselbe Jahr
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
                ? `Das nötige Fremdkapital liegt ${chf(erg.kontrolle.spielraum)} CHF unter der Belehnungsgrenze von ${pct(params.max2, 0)} des Ertragswerts.`
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

/** Bereich eines Schiebers um den berechneten Wert: halb bis anderthalbfach,
 *  erweitert, wo der eingestellte Wert darüber hinausgeht. Mit `obergrenze`
 *  von null bis dorthin. */
function spanne(basis: number, wert: number, obergrenze?: number) {
  let min = obergrenze != null ? 0 : basis * 0.5
  let max = obergrenze ?? basis * 1.5
  min = Math.min(min, wert)
  max = Math.max(max, wert, min + 1)
  const roh = (max - min) / 200
  const step = roh > 0 ? 10 ** Math.floor(Math.log10(roh)) : 1
  return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step }
}

function GruppenZeile({ titel }: { titel: string }) {
  return (
    <tr>
      <td colSpan={6} className="pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{titel}</td>
    </tr>
  )
}

/**
 * Eine Annahme: links der berechnete Wert zum Lesen, rechts der Schieber mit
 * seinem Zahlenfeld. Bei reinen Annahmen steht links statt des berechneten
 * Werts das Eingabefeld. `step` gilt in der gezeigten Einheit
 * (Prozent bei `prozent`), `min`/`max`/`wert` in der gespeicherten.
 */
function AnnahmeZeile({ label, hinweis, einheit, berechnet, eingabe, anzeige, regler, aktiv, canWrite }: {
  label: string
  hinweis?: string
  einheit: string
  berechnet?: string
  /** Eingegebener Wert links (reine Annahme) statt eines berechneten. */
  eingabe?: { wert: number; prozent?: boolean; onChange: (v: number) => void }
  /** Nur anzeigen statt schieben (abgeleitete Grösse). */
  anzeige?: string
  regler?: {
    wert: number; min: number; max: number; step: number
    /** Gespeichert als Anteil, gezeigt in Prozent. */
    prozent?: boolean
    /** Schieber weicht vom berechneten Wert ab. */
    eigen?: boolean
    onChange: (v: number) => void
    onZurueck?: () => void
  }
  aktiv?: boolean
  canWrite: boolean
}) {
  const faktor = regler?.prozent ? 100 : 1
  const schieberWirkt = !!aktiv
  const stellen = regler && regler.step < 1 ? 2 : 0
  // Der Schieberwert ist nur Anzeige — eintippen erst nach Doppelklick, damit
  // man ihn nicht aus Versehen für die Eingabe links hält und überschreibt.
  const [tippen, setTippen] = useState(false)
  const tippenAn = () => { if (canWrite && regler) setTippen(true) }
  return (
    <tr className="border-b border-slate-100">
      <td className="py-1.5 pr-3">
        <span className="block font-medium text-slate-700">{label}</span>
        {hinweis && <span className="block text-[10px] text-slate-400">{hinweis}</span>}
      </td>
      <td className={`py-1.5 pr-3 text-right tabular-nums ${schieberWirkt ? 'text-slate-400' : 'font-medium text-slate-800'}`}>
        {eingabe ? (
          <span className={schieberWirkt ? 'opacity-50' : ''}>
            <TextZahl wert={eingabe.wert * (eingabe.prozent ? 100 : 1)} stellen={eingabe.prozent ? 2 : 0} prozent={eingabe.prozent} disabled={!canWrite}
              onChange={(v) => eingabe.onChange(v / (eingabe.prozent ? 100 : 1))} />
          </span>
        ) : berechnet}
        {/* Einheit auch links, damit die Spalte für sich lesbar ist. */}
        <span className="ml-1 inline-block w-9 text-left text-[10px] font-normal text-slate-400">{einheit}</span>
      </td>
      <td className={`px-3 py-1.5 ${schieberWirkt ? '' : 'opacity-50'}`}>
        {regler && (
          <input type="range" disabled={!canWrite} onDoubleClick={tippenAn}
            title="Doppelklick: Wert eintippen"
            min={regler.min * faktor} max={regler.max * faktor} step={regler.step}
            value={regler.wert * faktor}
            onChange={(e) => regler.onChange(Number(e.target.value) / faktor)}
            className="w-full cursor-pointer accent-[#8B6956] disabled:cursor-default" />
        )}
      </td>
      <td className={`py-1.5 text-right ${schieberWirkt ? '' : 'opacity-50'}`}>
        {regler && tippen ? (
          <TextZahl wert={regler.wert * faktor} stellen={stellen} prozent={regler.prozent} disabled={!canWrite}
            autoFocus onFertig={() => setTippen(false)}
            onChange={(v) => regler.onChange(v / faktor)} />
        ) : regler ? (
          <span onDoubleClick={tippenAn} title={canWrite ? 'Doppelklick: Wert eintippen' : undefined}
            className={`inline-block w-28 cursor-default select-none px-2 py-1 text-right text-sm tabular-nums ${
              schieberWirkt ? 'font-medium text-slate-800' : 'text-slate-500'}`}>
            {formatNumber(Number.isFinite(regler.wert) ? regler.wert * faktor : 0, stellen) + (regler.prozent ? ' %' : '')}
          </span>
        ) : (
          <span className={`pr-2 tabular-nums ${schieberWirkt ? 'font-medium text-slate-800' : 'text-slate-500'}`}>{anzeige}</span>
        )}
      </td>
      <td className="py-1.5 pl-2 text-[10px] text-slate-400">{einheit}</td>
      <td className="py-1.5 text-center">
        {regler?.eigen && regler.onZurueck && canWrite && (
          <button type="button" onClick={regler.onZurueck} title="Auf den berechneten Wert zurück"
            className="rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">↺</button>
        )}
      </td>
    </tr>
  )
}

/**
 * Zahlenfeld auf Textbasis: während des Tippens bleibt die Rohfassung stehen,
 * gerechnet wird beim Verlassen. Ein `type="number"` sprang beim Dezimalpunkt
 * auf null zurück.
 */
function TextZahl({ wert, stellen, disabled, prozent, autoFocus, onFertig, onChange }: {
  wert: number
  stellen: number
  disabled: boolean
  /** Hängt ausser Fokus « %» an. */
  prozent?: boolean
  autoFocus?: boolean
  /** Nach dem Verlassen (Enter, Tab, Klick daneben, Escape). */
  onFertig?: () => void
  onChange: (v: number) => void
}) {
  // Ausser Fokus mit Tausenderzeichen (und %), im Fokus roh zum Tippen.
  const e = useEingabe()
  const verwerfen = useRef(false)
  const ok = Number.isFinite(wert) ? wert : 0
  return (
    <input
      type="text"
      inputMode="decimal"
      value={e.text(String(Number(ok.toFixed(stellen))), formatNumber(ok, stellen) + (prozent ? ' %' : ''))}
      disabled={disabled}
      autoFocus={autoFocus}
      onFocus={(ev) => { e.onFocus(); if (autoFocus) ev.target.select() }}
      onChange={e.onChange}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter') ev.currentTarget.blur()
        if (ev.key === 'Escape') { verwerfen.current = true; ev.currentTarget.blur() }
      }}
      onBlur={() => {
        const t = e.verlassen()
        const weg = verwerfen.current
        verwerfen.current = false
        onFertig?.()
        if (t != null && !weg) {
          const v = Number(t.replace(/[’'\s%]/g, '').replace(',', '.'))
          onChange(Number.isFinite(v) ? v : 0)
        }
      }}
      /*
       * Leicht grau hinterlegt: wo man schreiben kann, soll man es sehen, ohne
       * hineinzuklicken. Angezeigte Grössen stehen daneben ohne Fläche. Beim
       * Tippen wird das Feld weiss — dann ist der Cursor die Auskunft.
       */
      className="w-28 rounded-md border border-slate-200 bg-slate-100 px-2 py-1 text-right text-sm tabular-nums text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#B98C74] disabled:bg-slate-50 disabled:opacity-60"
    />
  )
}
