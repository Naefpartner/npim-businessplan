import { useMemo } from 'react'
import { BarChart3, Loader2, AlertCircle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { useBenchmarkKosten } from '@/hooks/useBenchmarkKosten'
import { AnsatzEingabe } from '@/components/projects/AnsatzEingabe'
import {
  benchmarkZeilen, BKP2_METHODE_LABEL,
  type Bkp2Methode, type BenchmarkZeile, type BenchmarkZahlfeld,
  type BenchmarkModus, type BenchmarkKennwerte,
} from '@/lib/benchmark'
import { useKostenBloecke, type KostenBlock } from '@/hooks/useKostenBloecke'
import { EIGENTUMSART_COLOR, TOTAL_COLOR } from '@/lib/kategorieFarben'
import { cn, formatCurrency, formatNumber } from '@/lib/utils'

/**
 * Erfassungsbereich für die Methode „Benchmarks BKP 0–9".
 *
 * Zwei Erfassungstiefen: ein Kennwertsatz für die ganze Variante, oder je ein
 * Satz pro Etappe × Nutzungsart. Beide Stände liegen nebeneinander im
 * Dokument, ein Wechsel verwirft also nichts.
 */
export function BenchmarkKostenSection({ variantId }: { variantId: string }) {
  const { canWrite } = useAuth()
  const ak = useAnlagekostenShared()
  const { hasOhneEtappe } = ak
  const { doc, kennwerte, setFeld, setBkp2Methode, setModus, loading } = useBenchmarkKosten(variantId)

  const bloecke = useKostenBloecke(doc.modus)

  // Ergebnisse je Block plus Gesamtsumme über alle Blöcke.
  const ergebnisse = useMemo(
    () => bloecke.map((b) => ({ block: b, erg: benchmarkZeilen(kennwerte(b.key), b.bezug) })),
    [bloecke, kennwerte],
  )
  const totalNetto = ergebnisse.reduce((s, e) => s + e.erg.totalNetto, 0)
  const totalBrutto = ergebnisse.reduce((s, e) => s + e.erg.totalBrutto, 0)
  // Kennwertspalte des Gesamttotals über die Geschossfläche aller Blöcke.
  const gfGesamt = bloecke.reduce((s, b) => s + b.bezug.gfM2, 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Wird geladen…
      </div>
    )
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-medium text-slate-700">Benchmarks BKP 0–9</h3>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Grobschätzung über einen Kennwert je Hauptgruppe. Die Bezugsgrössen stammen aus
            Parzellen und Mengengerüst; die Prozentsätze rechnen auf den Netto-Beträgen.
          </p>
        </div>
        <ModusWahl modus={doc.modus} onChange={setModus} disabled={!canWrite} />
      </div>

      {doc.modus === 'aufgeteilt' && hasOhneEtappe && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Es gibt Gebäude ohne Etappen-Zuordnung — die fliessen in dieser Ansicht nicht ein.
            Bitte in „Mengen und Erträge" einer Etappe zuordnen.
          </span>
        </div>
      )}

      {doc.modus === 'aufgeteilt' && bloecke.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
          Keine Etappen mit Gebäuden erfasst — dafür braucht es Etappen in „Mengen und Erträge".
        </div>
      )}

      <div className="mt-4 space-y-8">
        {ergebnisse.map(({ block, erg }) => (
          <BlockTabelle
            key={block.key ?? 'gesamt'}
            block={block}
            zeilen={erg.zeilen}
            netto={erg.totalNetto}
            brutto={erg.totalBrutto}
            kennwerte={kennwerte(block.key)}
            canWrite={canWrite}
            onSetFeld={(feld, wert) => setFeld(block.key, feld, wert)}
            onSetBkp2Methode={(m) => setBkp2Methode(block.key, m)}
          />
        ))}
      </div>

      {/* Gesamttotal — bei Aufteilung die Summe über alle Blöcke. */}
      {ergebnisse.length > 0 && (
        <div className="mt-6">
          <Totalbalken
            titel={ergebnisse.length > 1 ? 'Gesamttotal · alle Blöcke' : 'Gesamttotal'}
            farbe={ergebnisse.length === 1 && bloecke[0].eig
              ? EIGENTUMSART_COLOR[bloecke[0].eig]
              : TOTAL_COLOR}
            hell={!(ergebnisse.length === 1 && bloecke[0].eig)}
            netto={totalNetto}
            brutto={totalBrutto}
            gross
            kennwert={gfGesamt > 0 ? totalBrutto / gfGesamt : null}
          />
        </div>
      )}

      <p className="mt-3 text-xs text-slate-400">
        Ohne MwSt gerechnet werden Grundstück und Eigentümerkosten, analog den Katalogpositionen
        010 und 910/920. BKP 0 bleibt in allen Prozentbasen aussen vor.
      </p>
    </section>
  )
}

// ── Erfassungstiefe ──────────────────────────────────────────────────────────

function ModusWahl({
  modus, onChange, disabled,
}: {
  modus: BenchmarkModus
  onChange: (m: BenchmarkModus) => void
  disabled: boolean
}) {
  const optionen: { key: BenchmarkModus; label: string; titel: string }[] = [
    { key: 'total', label: 'Gesamt', titel: 'Ein Kennwertsatz für die ganze Variante' },
    { key: 'aufgeteilt', label: 'Nach Etappe & Nutzungsart', titel: 'Ein Kennwertsatz je Etappe und Nutzungsart' },
  ]
  return (
    <div className="inline-flex shrink-0 rounded-lg border border-slate-200 p-0.5">
      {optionen.map((o) => (
        <button
          key={o.key}
          type="button"
          title={o.titel}
          disabled={disabled}
          onClick={() => onChange(o.key)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition',
            modus === o.key ? 'bg-[#8B6956] text-white' : 'text-slate-600 hover:bg-slate-100',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ── Ein Block: Kopf, Bezugsgrössen, Tabelle ──────────────────────────────────

function BlockTabelle({
  block, zeilen, netto, brutto, kennwerte, canWrite, onSetFeld, onSetBkp2Methode,
}: {
  block: KostenBlock
  zeilen: BenchmarkZeile[]
  netto: number
  brutto: number
  kennwerte: BenchmarkKennwerte
  canWrite: boolean
  onSetFeld: (feld: BenchmarkZahlfeld, wert: number | null) => void
  onSetBkp2Methode: (m: Bkp2Methode) => void
}) {
  const { bezug } = block
  return (
    <div className="space-y-3">
      <Totalbalken
        titel={block.titel}
        farbe={block.eig ? EIGENTUMSART_COLOR[block.eig] : TOTAL_COLOR}
        hell={!block.eig}
        netto={netto}
        brutto={brutto}
        gross={false}
      />

      <div className="grid grid-cols-2 gap-4 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-5">
        <Kennzahl label="Grundstück (GSF)" wert={`${formatNumber(bezug.gsfTotal)} m²`} />
        <Kennzahl label="Geschossfläche GF" wert={`${formatNumber(bezug.gfM2)} m²`} />
        <Kennzahl label="Gebäudevolumen GV" wert={`${formatNumber(bezug.gvM3)} m³`} />
        <Kennzahl label="VMF / VKF" wert={`${formatNumber(bezug.vmfM2)} m²`} />
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
                methode={kennwerte.bkp2Methode}
                canWrite={canWrite}
                onSetFeld={onSetFeld}
                onSetMethode={onSetBkp2Methode}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Farbiger Balken mit den Totalen — für den Blockkopf und das Gesamttotal.
 * Aufbau wie die Eigentumsart-Balken des Detailkatalogs: links der Titel,
 * rechts exkl. MwSt / MwSt / inkl. MwSt.
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
