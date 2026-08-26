import { useMemo } from 'react'
import { BarChart3, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { useBenchmarkKosten } from '@/hooks/useBenchmarkKosten'
import { AnsatzEingabe } from '@/components/projects/AnsatzEingabe'
import {
  benchmarkZeilen, BKP2_METHODE_LABEL,
  type Bkp2Methode, type BenchmarkZeile, type BenchmarkZahlfeld,
} from '@/lib/benchmark'
import { ermittleKeeValueMengen } from '@/lib/keevalue'
import { ertragProNutzung } from '@/lib/bkpBlocks'
import { EIGENTUMSART_COLOR, TOTAL_COLOR } from '@/lib/kategorieFarben'
import { EIGENTUMSART_LABEL, type Eigentumsart } from '@/types'
import { cn, formatCurrency, formatNumber } from '@/lib/utils'

/**
 * Erfassungsbereich für die Methode „Benchmarks BKP 0–9".
 *
 * Grobschätzung über einen Kennwert je Hauptgruppe, in derselben
 * Tabellenstruktur wie die keeValue-Kostenberechnung — BKP · Hauptgruppe ·
 * Ansatz · exkl. · inkl. · CHF/m² GF.
 */
export function BenchmarkKostenSection({ variantId }: { variantId: string }) {
  const { canWrite } = useAuth()
  const { buildings, gsfTotal, totalVmf, mwstSatz, presentEig } = useAnlagekostenShared()
  const { doc, setFeld, setMethode, loading } = useBenchmarkKosten(variantId)

  // Die Methode rechnet ein Variantentotal ohne Aufteilung nach Nutzungsart.
  // Bei genau einer Nutzungsart trägt der Kopf deren Farbe, bei mehreren die
  // neutrale Totalfarbe — sonst suggerierte die Farbe eine Zuordnung, die die
  // Berechnung gar nicht macht.
  const eigen: Eigentumsart[] = presentEig
  const kopfFarbe = eigen.length === 1 ? EIGENTUMSART_COLOR[eigen[0]] : TOTAL_COLOR
  const kopfHell = eigen.length !== 1
  const kopfTitel = eigen.length > 0
    ? eigen.map((e) => EIGENTUMSART_LABEL[e]).join(' · ')
    : 'Keine Nutzungsart erfasst'

  const bezug = useMemo(() => {
    const m = ermittleKeeValueMengen(buildings, gsfTotal)
    return {
      gsfTotal,
      gfM2: m.gfM2,
      gvM3: m.gvM3,
      gvUiM3: m.gvUnterirdischM3,
      vmfM2: totalVmf,
      bufM2: m.bufM2,
      ertragBasis: Object.values(ertragProNutzung(buildings)).reduce((s, v) => s + v, 0),
      mwstSatz,
    }
  }, [buildings, gsfTotal, totalVmf, mwstSatz])

  const { zeilen, totalNetto, totalBrutto } = useMemo(
    () => benchmarkZeilen(doc, bezug), [doc, bezug],
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Wird geladen…
      </div>
    )
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-slate-400" />
        <h3 className="text-sm font-medium text-slate-700">Benchmarks BKP 0–9</h3>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        Grobschätzung über einen Kennwert je Hauptgruppe. Die Bezugsgrössen stammen aus Parzellen
        und Mengengerüst; die Prozentsätze rechnen auf den Netto-Beträgen.
      </p>

      {/* Kopf mit der Nutzungsart — gleiche Bildsprache wie die
          Eigentumsart-Blöcke des Detailkatalogs. */}
      <Totalbalken
        titel={kopfTitel}
        farbe={kopfFarbe}
        hell={kopfHell}
        netto={totalNetto}
        brutto={totalBrutto}
        gross={false}
      />

      <div className="mb-4 grid grid-cols-2 gap-4 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-5">
        <Kennzahl label="Grundstück (GSF)" wert={`${formatNumber(bezug.gsfTotal)} m²`} />
        <Kennzahl label="Geschossfläche GF" wert={`${formatNumber(bezug.gfM2)} m²`} />
        <Kennzahl label="Gebäudevolumen GV" wert={`${formatNumber(bezug.gvM3)} m³`} />
        <Kennzahl label="VMF / VKF total" wert={`${formatNumber(bezug.vmfM2)} m²`} />
        <Kennzahl
          label="Umgebungsfläche UF"
          wert={bezug.bufM2 != null ? `${formatNumber(bezug.bufM2)} m²` : '—'}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-3 font-medium">BKP</th>
              <th className="py-2 pr-3 font-medium">Hauptgruppe</th>
              <th className="py-2 pr-4 font-medium">Ansatz</th>
              <th className="py-2 pr-3 text-right font-medium">exkl. MwSt.</th>
              <th className="py-2 pr-3 text-right font-medium">inkl. MwSt.</th>
              <th className="py-2 text-right font-medium">
                CHF/m² GF
                {bezug.gfM2 > 0 && (
                  <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">
                    ({formatNumber(bezug.gfM2)} m²)
                  </span>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z) => (
              <Zeile
                key={`${z.code}-${z.ebene}-${z.label}`}
                zeile={z}
                methode={doc.bkp2Methode}
                canWrite={canWrite}
                onSetFeld={setFeld}
                onSetMethode={setMethode}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Gesamttotal — Pendant zum Gesamttotal des Detailkatalogs. */}
      <div className="mt-4">
        <Totalbalken
          titel="Gesamttotal"
          farbe={kopfFarbe}
          hell={kopfHell}
          netto={totalNetto}
          brutto={totalBrutto}
          gross
          kennwert={bezug.gfM2 > 0 ? totalBrutto / bezug.gfM2 : null}
        />
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Ohne MwSt gerechnet werden Grundstück und Eigentümerkosten, analog den Katalogpositionen
        010 und 910/920. BKP 0 bleibt in allen Prozentbasen aussen vor.
      </p>
    </section>
  )
}

/**
 * Farbiger Balken mit den Totalen — für den Kopf (Nutzungsart) und das
 * Gesamttotal am Fuss. Aufbau wie die Eigentumsart-Balken des Detailkatalogs:
 * links der Titel, rechts exkl. MwSt / MwSt / inkl. MwSt.
 */
function Totalbalken({
  titel, farbe, hell, netto, brutto, gross, kennwert,
}: {
  titel: string
  farbe: string
  /** true = dunkler Grund, heller Text (neutrale Totalfarbe). */
  hell: boolean
  netto: number
  brutto: number
  gross: boolean
  kennwert?: number | null
}) {
  const mikro = hell ? 'text-white/70' : 'text-slate-600'
  const wert = hell ? 'text-white' : 'text-slate-900'
  return (
    <div
      className={cn('flex flex-wrap items-end gap-y-2 rounded-lg', hell ? 'text-white' : 'text-slate-900')}
      style={{ backgroundColor: farbe }}
    >
      <h4 className={cn(
        'min-w-0 flex-1 px-3 text-sm font-semibold',
        gross ? 'py-3 uppercase tracking-wider' : 'py-2.5',
      )}>
        {titel}
      </h4>
      <Betrag label="exkl. MWST" wert={netto} fett gross={gross} mikro={mikro} text={wert} />
      <Betrag label="MwSt" wert={brutto - netto} gross={gross} mikro={mikro} text={hell ? 'text-white/90' : 'text-slate-700'} />
      <Betrag label="inkl. MWST" wert={brutto} fett gross={gross} mikro={mikro} text={wert} />
      {kennwert != null && (
        <Betrag label="CHF/m² GF" wert={kennwert} gross={gross} mikro={mikro} text={hell ? 'text-white/90' : 'text-slate-700'} />
      )}
    </div>
  )
}

function Betrag({
  label, wert, fett = false, gross, mikro, text,
}: {
  label: string
  wert: number
  fett?: boolean
  gross: boolean
  mikro: string
  text: string
}) {
  return (
    <div className={cn('w-36 shrink-0 px-3 text-right tabular-nums', gross ? 'py-3' : 'py-2.5')}>
      <div className={cn('text-[9px] uppercase leading-4 tracking-wider', mikro)}>{label}</div>
      <div className={cn(
        'leading-5',
        gross ? 'text-base leading-6' : 'text-sm',
        fett && 'font-bold',
        text,
      )}>
        {formatNumber(Math.round(wert))}
      </div>
    </div>
  )
}

function Zeile({
  zeile: z, methode, canWrite, onSetFeld, onSetMethode,
}: {
  zeile: BenchmarkZeile
  methode: Bkp2Methode
  canWrite: boolean
  onSetFeld: (feld: BenchmarkZahlfeld, wert: number | null) => void
  onSetMethode: (m: Bkp2Methode) => void
}) {
  const unter = z.ebene === 1

  return (
    <tr className={cn('border-b border-slate-50', unter && 'italic text-slate-500')}>
      <td className="py-1.5 pr-3 tabular-nums text-slate-500">{unter ? '' : z.code}</td>
      <td className={cn('py-1.5 pr-3', !unter && 'font-medium text-slate-800')}>{z.label}</td>

      <td className="py-1.5 pr-4 whitespace-nowrap">
        <span className="inline-flex items-baseline gap-1.5">
          {/* BKP 2: Bezugsgrösse wählbar — GF, GV (ober-/unterirdisch) oder VMF. */}
          {z.methodeWahl && (
            <select
              value={methode}
              disabled={!canWrite}
              onChange={(e) => onSetMethode(e.target.value as Bkp2Methode)}
              className={cn(
                'rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-700',
                'focus:border-slate-400 focus:outline-none',
                !canWrite && 'cursor-not-allowed bg-slate-50 text-slate-400',
              )}
            >
              {(Object.keys(BKP2_METHODE_LABEL) as Bkp2Methode[]).map((m) => (
                <option key={m} value={m}>{BKP2_METHODE_LABEL[m]}</option>
              ))}
            </select>
          )}
          {z.feld && (
            <AnsatzEingabe
              wert={z.ansatzWert ?? null}
              einheit={z.ansatzEinheit ?? 'CHF/m²'}
              disabled={!canWrite}
              onCommit={(v) => onSetFeld(z.feld!, v)}
            />
          )}
          {z.ansatzBasis && <span className="text-xs text-slate-400">{z.ansatzBasis}</span>}
        </span>
      </td>

      <td className="py-1.5 pr-3 text-right tabular-nums">{formatCurrency(z.netto)}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{formatCurrency(z.brutto)}</td>
      <td className="py-1.5 text-right tabular-nums text-slate-500">
        {z.chfProM2Gf != null ? formatNumber(Math.round(z.chfProM2Gf)) : '—'}
      </td>
    </tr>
  )
}

function Kennzahl({ label, wert }: { label: string; wert: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-medium tabular-nums text-slate-900">{wert}</div>
    </div>
  )
}
