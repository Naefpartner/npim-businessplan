import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Scale } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useUndoableState } from '@/contexts/UndoContext'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { useTragbarkeit } from '@/hooks/useTragbarkeit'
import { useAufklappbar } from '@/hooks/useAufklappbar'
import {
  berechneTragbarkeit, berechneVerlauf, defaultTragbarkeitDoc,
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
  }), [mengen, anlagekosten])

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
    feld: 'ausfallProJahr' | 'kostenquoteProJahr', jahr: number, wert: number | null,
  ) => setDoc((d) => {
    const neu = { ...d[feld] }
    if (wert == null && jahr > 1) delete neu[jahr]
    else neu[jahr] = wert ?? 0
    return { ...d, [feld]: neu }
  }, {
    label: feld === 'ausfallProJahr' ? 'Ertragsausfall' : 'Bewirtschaftungskosten',
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
            <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <SatzFeld
                label="Hypothekarzins (effektiv)"
                wert={doc.hypozins} canWrite={canWrite}
                onChange={(v) => setzen({ hypozins: v }, 'Hypothekarzins', 'hypozins')} />
              <SatzFeld
                label="Tragbarkeitszinssatz (kalkulatorisch)"
                wert={doc.tragbarkeitszins} canWrite={canWrite}
                onChange={(v) => setzen({ tragbarkeitszins: v }, 'Tragbarkeitszins', 'trz')} />
              <SatzFeld
                label="Kapitalisierungssatz (auf dem Bruttomietertrag)"
                wert={doc.kapitalisierungssatz} canWrite={canWrite}
                onChange={(v) => setzen({ kapitalisierungssatz: v }, 'Kapitalisierungssatz', 'kap')} />
              <SatzFeld
                label="Max. 1. Hypothek"
                wert={doc.max1} canWrite={canWrite}
                onChange={(v) => setzen({ max1: v }, 'Max. 1. Hypothek', 'max1')} />
              <SatzFeld
                label="Max. Hypothek total"
                wert={doc.max2} canWrite={canWrite}
                onChange={(v) => setzen({ max2: v }, 'Max. Hypothek total', 'max2')} />
              <SatzFeld
                label="Betriebs- und Unterhaltskosten, Erneuerung"
                wert={doc.bewirtschaftungsquote} canWrite={canWrite}
                onChange={(v) => setzen({ bewirtschaftungsquote: v }, 'Bewirtschaftungsquote', 'bew')} />
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
              <ZahlFeld
                label="Dauer Amortisation"
                einheit="Jahre"
                wert={doc.amortisationsdauer} canWrite={canWrite}
                onChange={(v) => setzen({ amortisationsdauer: v }, 'Amortisationsdauer', 'dauer')} />
              <ZahlFeld
                label="Zusätzliche Eigenmittel"
                einheit="CHF"
                wert={doc.zusaetzlicheEigenmittel} canWrite={canWrite}
                onChange={(v) => setzen({ zusaetzlicheEigenmittel: v }, 'Eigenmittel', 'ek')} />
              <ZahlFeld
                label="1. Hypothek (0 = aus der Belehnungsgrenze)"
                einheit="CHF"
                wert={doc.ersteHypothekChf} canWrite={canWrite}
                onChange={(v) => setzen({ ersteHypothekChf: v }, '1. Hypothek', 'hyp1')} />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Ertragsausfall und Bewirtschaftungskosten stehen als Sätze in der Tabelle
              unten — dort lassen sie sich Jahr für Jahr setzen.
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-xs">
                <thead>
                  <tr className="border-b border-slate-300 text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="py-2 pr-3 text-left font-medium">Jahr</th>
                    <th className="py-2 pr-3 text-right font-medium">Mietertrag SOLL</th>
                    <th className="py-2 pr-3 text-right font-medium">Ertragsausfall</th>
                    <th className="py-2 pr-3 text-right font-medium">Mietertrag IST</th>
                    <th className="py-2 pr-3 text-right font-medium">Kosten</th>
                    <th className="py-2 pr-3 text-right font-medium">Liegenschafts&shy;erfolg</th>
                    <th className="py-2 pr-3 text-right font-medium">Fremdkapital</th>
                    <th className="py-2 pr-3 text-right font-medium">1. Hypothek</th>
                    <th className="py-2 pr-3 text-right font-medium">2. Hypothek</th>
                    <th className="py-2 pr-3 text-right font-medium">Zins 1. Hyp.</th>
                    <th className="py-2 pr-3 text-right font-medium">Zins 2. Hyp.</th>
                    <th className="py-2 pr-3 text-right font-medium">Amortisation</th>
                    <th className="py-2 text-right font-medium">Überschuss</th>
                  </tr>
                </thead>
                <tbody>
                  {verlauf.map((j, i) => (
                    <JahrZeile
                      key={j.label}
                      jahr={j}
                      nachLaufzeit={i >= verlauf.length - 2}
                      canWrite={canWrite}
                      onSatz={(feld, wert) => setzeSatz(feld, j.jahr, wert)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Die 1. Hypothek steht, amortisiert wird allein die 2. — in gleichen Raten über
              {' '}{doc.amortisationsdauer} Jahre. Die beiden letzten Zeilen rechnen dasselbe Jahr
              ohne 2. Hypothek, einmal zum kalkulatorischen Satz und einmal zum tatsächlichen
              Zins: die Probe, ob die Liegenschaft auch dann trägt.
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

/**
 * Eine Jahreszeile des Verlaufs. Unter den Beträgen steht, wo das Excel eine
 * Prozentspalte führt, der Anteil — am Mietertrag SOLL bei den Ertragszeilen,
 * am Ertragswert bei den Hypotheken.
 */
function JahrZeile({ jahr, nachLaufzeit, canWrite, onSatz }: {
  jahr: TragbarkeitJahr
  nachLaufzeit: boolean
  canWrite: boolean
  onSatz: (feld: 'ausfallProJahr' | 'kostenquoteProJahr', wert: number | null) => void
}) {
  return (
    <tr
      className="border-b border-slate-100 tabular-nums"
      style={nachLaufzeit ? { backgroundColor: HILITE } : undefined}
    >
      <td className={`py-1.5 pr-3 text-left ${nachLaufzeit ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
        {jahr.label}
      </td>
      <td className="py-1.5 pr-3 text-right">{chf(jahr.mietertragSoll)}</td>
      <SatzZelle
        wert={jahr.ertragsausfall} anteil={jahr.ausfallQuote}
        eigen={jahr.ausfallEigen} jahr={jahr.jahr}
        canWrite={canWrite && !nachLaufzeit}
        onSatz={(v) => onSatz('ausfallProJahr', v)} />
      <MitAnteil wert={jahr.mietertragIst} anteil={1 - jahr.ausfallQuote} />
      <SatzZelle
        wert={jahr.kosten} anteil={jahr.kostenQuote}
        eigen={jahr.kostenEigen} jahr={jahr.jahr}
        canWrite={canWrite && !nachLaufzeit}
        onSatz={(v) => onSatz('kostenquoteProJahr', v)} />
      <MitAnteil wert={jahr.liegenschaftserfolg} anteil={jahr.erfolgQuote} />
      <MitAnteil wert={jahr.fremdkapital} anteil={jahr.belehnung} />
      <td className="py-1.5 pr-3 text-right">{chf(jahr.ersteHypothek)}</td>
      <td className="py-1.5 pr-3 text-right">{chf(jahr.zweiteHypothek)}</td>
      <td className="py-1.5 pr-3 text-right">{chf(jahr.zinsErste)}</td>
      <td className="py-1.5 pr-3 text-right">{chf(jahr.zinsZweite)}</td>
      <td className="py-1.5 pr-3 text-right">{chf(jahr.amortisation)}</td>
      <td className={`py-1.5 text-right font-medium ${jahr.ueberschuss < 0 ? 'text-amber-700' : 'text-slate-900'}`}>
        {chf(jahr.ueberschuss)}
      </td>
    </tr>
  )
}

/**
 * Betrag mit dem Satz darunter — und der Satz ist hier die Eingabe. Was in
 * einem Jahr gesetzt wird, gilt von dort an weiter; ein geerbter Satz steht
 * blass, ein gesetzter kräftig. Leeren löscht die Eingabe, das Jahr erbt dann
 * wieder (Jahr 1 ausgenommen, es ist der Anfang der Reihe).
 */
function SatzZelle({ wert, anteil, eigen, jahr, canWrite, onSatz }: {
  wert: number
  anteil: number
  eigen: boolean
  jahr: number
  canWrite: boolean
  onSatz: (wert: number | null) => void
}) {
  const [roh, setRoh] = useState<string | null>(null)
  const anzeige = roh ?? (anteil * 100).toFixed(2).replace(/\.?0+$/, '')
  return (
    <td className="py-1.5 pr-3 text-right">
      <div>{chf(wert)}</div>
      {canWrite ? (
        <div className="flex items-center justify-end gap-0.5">
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
                else if (Number.isFinite(v)) onSatz(v / 100)
              }
              setRoh(null)
            }}
            className={`w-12 rounded border-0 bg-transparent px-0.5 py-0 text-right text-[10px] tabular-nums focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#B98C74] ${
              eigen ? 'font-semibold text-slate-700' : 'text-slate-400'}`}
          />
          <span className="text-[10px] text-slate-400">%</span>
        </div>
      ) : (
        <div className="text-[10px] text-slate-400">{pct(anteil, 1)}</div>
      )}
    </td>
  )
}

/** Betrag mit seinem Anteil darunter — die Prozentspalte des Excel-Blatts. */
function MitAnteil({ wert, anteil }: { wert: number; anteil: number }) {
  return (
    <td className="py-1.5 pr-3 text-right">
      <div>{chf(wert)}</div>
      <div className="text-[10px] text-slate-400">{pct(anteil, 1)}</div>
    </td>
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
function SatzFeld({ label, wert, canWrite, onChange, eigen, abgeleitetWert, onZurueck }: {
  label: string
  wert: number
  canWrite: boolean
  onChange: (v: number) => void
  /** Von Hand gesetzt statt aus den Mengen abgeleitet. */
  eigen?: boolean
  abgeleitetWert?: number
  onZurueck?: () => void
}) {
  return (
    <FeldRahmen label={label} eigen={eigen} abgeleitet={abgeleitetWert != null ? `${(abgeleitetWert * 100).toFixed(1)} %` : undefined} onZurueck={onZurueck}>
      <TextZahl
        wert={wert * 100}
        stellen={2}
        disabled={!canWrite}
        onChange={(v) => onChange(v / 100)} />
      <span className="text-xs text-slate-500">%</span>
    </FeldRahmen>
  )
}

function ZahlFeld({ label, wert, einheit, canWrite, onChange, eigen, abgeleitetWert, onZurueck }: {
  label: string
  wert: number
  einheit: string
  canWrite: boolean
  onChange: (v: number) => void
  eigen?: boolean
  abgeleitetWert?: number
  onZurueck?: () => void
}) {
  return (
    <FeldRahmen label={label} eigen={eigen} abgeleitet={abgeleitetWert != null ? formatNumber(abgeleitetWert, 2) : undefined} onZurueck={onZurueck}>
      <TextZahl wert={wert} stellen={2} disabled={!canWrite} onChange={onChange} />
      <span className="text-xs text-slate-500">{einheit}</span>
    </FeldRahmen>
  )
}

function FeldRahmen({ label, children, eigen, abgeleitet, onZurueck }: {
  label: string
  children: ReactNode
  eigen?: boolean
  abgeleitet?: string
  onZurueck?: () => void
}) {
  return (
    <label className="block text-xs text-slate-600">
      <div className="mb-1 flex items-center gap-2 font-medium text-slate-700">
        <span>{label}</span>
        {/* Wo eine Grösse aus den Mengen kommt, steht das dabei — und ein Weg
            zurück, wenn man sie von Hand überschrieben hat. */}
        {abgeleitet != null && (eigen
          ? (
            <button type="button" onClick={onZurueck}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-500 hover:bg-slate-200">
              eigener Wert · aus Mengen: {abgeleitet}
            </button>
          )
          : <span className="text-[10px] font-normal text-slate-400">aus den Mengen</span>)}
      </div>
      <div className="flex items-center gap-1.5">{children}</div>
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
      className="w-24 rounded-md border border-slate-200 px-2 py-1 text-right text-sm tabular-nums text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#B98C74] disabled:opacity-60"
    />
  )
}
