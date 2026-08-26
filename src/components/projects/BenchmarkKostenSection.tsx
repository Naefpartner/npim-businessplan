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
  const { buildings, gsfTotal, totalVmf, mwstSatz } = useAnlagekostenShared()
  const { doc, setFeld, setMethode, loading } = useBenchmarkKosten(variantId)

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
            <tr className="border-t-2 border-slate-300 font-semibold">
              <td className="py-2 pr-3" colSpan={3}>Anlagekosten</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(totalNetto)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(totalBrutto)}</td>
              <td className="py-2 text-right tabular-nums">
                {bezug.gfM2 > 0 ? formatNumber(Math.round(totalBrutto / bezug.gfM2)) : '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Ohne MwSt gerechnet werden Grundstück und Eigentümerkosten, analog den Katalogpositionen
        010 und 910/920. BKP 0 bleibt in allen Prozentbasen aussen vor.
      </p>
    </section>
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
