import { useMemo } from 'react'
import { BarChart3, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { useBenchmarkKosten } from '@/hooks/useBenchmarkKosten'
import { AnsatzEingabe } from '@/components/projects/AnsatzEingabe'
import { benchmarkZeilen } from '@/lib/benchmark'
import { ermittleKeeValueMengen } from '@/lib/keevalue'
import { formatCurrency, formatNumber } from '@/lib/utils'

/**
 * Erfassungsbereich für die Methode „Benchmarks BKP 0–9".
 *
 * Grobschätzung über einen Kennwert je Hauptgruppe, in derselben
 * Tabellenstruktur wie die keeValue-Kostenberechnung. Die Hauptgruppen werden
 * schrittweise ausgebaut; noch offene bleiben als Zeile sichtbar.
 */
export function BenchmarkKostenSection({ variantId }: { variantId: string }) {
  const { canWrite } = useAuth()
  const { buildings, gsfTotal, totalVmf, mwstSatz } = useAnlagekostenShared()
  const { doc, setFeld, loading } = useBenchmarkKosten(variantId)

  const gfM2 = useMemo(
    () => ermittleKeeValueMengen(buildings, gsfTotal).gfM2,
    [buildings, gsfTotal],
  )
  const gvM3 = useMemo(
    () => ermittleKeeValueMengen(buildings, gsfTotal).gvM3,
    [buildings, gsfTotal],
  )

  const { zeilen, totalNetto, totalBrutto, offeneGruppen } = useMemo(
    () => benchmarkZeilen(doc, { gsfTotal, gfM2, mwstSatz }),
    [doc, gsfTotal, gfM2, mwstSatz],
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
        Grobschätzung über einen Kennwert je Hauptgruppe. Die Bezugsgrössen stammen aus
        Parzellen und Mengengerüst.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-4 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4">
        <Kennzahl label="Grundstück (GSF)" wert={`${formatNumber(gsfTotal)} m²`} />
        <Kennzahl label="Geschossfläche GF" wert={`${formatNumber(gfM2)} m²`} />
        <Kennzahl label="Gebäudevolumen GV" wert={`${formatNumber(gvM3)} m³`} />
        <Kennzahl label="VMF total" wert={`${formatNumber(totalVmf)} m²`} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-3 font-medium">BKP</th>
              <th className="py-2 pr-3 font-medium">Hauptgruppe</th>
              <th className="py-2 pr-4 font-medium">Ansatz</th>
              <th className="py-2 pr-3 text-right font-medium">exkl. MwSt.</th>
              <th className="py-2 pr-3 text-right font-medium">inkl. MwSt.</th>
              <th className="py-2 text-right font-medium">
                CHF/m² GF
                {gfM2 > 0 && (
                  <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">
                    ({formatNumber(gfM2)} m²)
                  </span>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z) => {
              const offen = z.netto == null
              return (
                <tr key={z.code} className="border-b border-slate-50">
                  <td className="py-1.5 pr-3 tabular-nums text-slate-500">{z.code}</td>
                  <td className="py-1.5 pr-3 font-medium text-slate-800">{z.label}</td>
                  <td className="py-1.5 pr-4 whitespace-nowrap">
                    {z.feld ? (
                      <span className="inline-flex items-baseline gap-1.5">
                        <AnsatzEingabe
                          wert={z.ansatzWert ?? null}
                          einheit={z.ansatzEinheit ?? 'CHF/m²'}
                          disabled={!canWrite}
                          onCommit={(v) => void setFeld(z.feld!, v)}
                        />
                        <span className="text-xs text-slate-400">{z.ansatzBasis}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-slate-300">Berechnungsart offen</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {offen ? <span className="text-slate-300">—</span> : formatCurrency(z.netto!)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {offen ? <span className="text-slate-300">—</span> : formatCurrency(z.brutto!)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-slate-500">
                    {z.chfProM2Gf != null ? formatNumber(Math.round(z.chfProM2Gf)) : '—'}
                  </td>
                </tr>
              )
            })}
            <tr className="border-t-2 border-slate-300 font-semibold">
              <td className="py-2 pr-3" colSpan={3}>Anlagekosten</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(totalNetto)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(totalBrutto)}</td>
              <td className="py-2 text-right tabular-nums">
                {gfM2 > 0 ? formatNumber(Math.round(totalBrutto / gfM2)) : '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {offeneGruppen > 0 && (
        <p className="mt-3 text-xs text-slate-400">
          {offeneGruppen} von 10 Hauptgruppen haben noch keine Berechnungsart — das Total
          umfasst bis dahin nur die definierten Gruppen.
        </p>
      )}
    </section>
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
