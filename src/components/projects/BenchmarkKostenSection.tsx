import { BarChart3 } from 'lucide-react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { HAUPTGRUPPEN } from '@/lib/bkpKatalog'
import { formatNumber } from '@/lib/utils'

/**
 * Erfassungsbereich für die Methode „Benchmarks BKP 0–9".
 *
 * Hülle: Das Raster der Hauptgruppen steht, die Berechnungsart je Gruppe
 * (Bezugsgrösse und Kennwertquelle) ist noch offen und wird nachgezogen.
 */
export function BenchmarkKostenSection() {
  const { buildings, gsfTotal, totalVmf } = useAnlagekostenShared()
  const gf = buildings.reduce((s, b) => s + (b.geschossflaeche_m2 ?? 0), 0)
  const gv = buildings.reduce((s, b) => s + (b.volumen_m3 ?? 0), 0)

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-slate-400" />
        <h3 className="text-sm font-medium text-slate-700">Benchmarks BKP 0–9</h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
          in Vorbereitung
        </span>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        Grobschätzung über einen Kennwert je Hauptgruppe. Die Berechnungsart je Gruppe
        (Bezugsgrösse und Herkunft der Kennwerte) ist noch festzulegen.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-4 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4">
        <Kennzahl label="Grundstück (GSF)" wert={`${formatNumber(gsfTotal)} m²`} />
        <Kennzahl label="Geschossfläche GF" wert={`${formatNumber(gf)} m²`} />
        <Kennzahl label="Gebäudevolumen GV" wert={`${formatNumber(gv)} m³`} />
        <Kennzahl label="VMF total" wert={`${formatNumber(totalVmf)} m²`} />
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-3 font-medium">BKP</th>
            <th className="py-2 pr-3 font-medium">Hauptgruppe</th>
            <th className="py-2 pr-3 text-right font-medium">Kennwert</th>
            <th className="py-2 text-right font-medium">Betrag</th>
          </tr>
        </thead>
        <tbody>
          {HAUPTGRUPPEN.map((h) => (
            <tr key={h.code} className="border-b border-slate-50">
              <td className="py-2 pr-3 tabular-nums text-slate-500">{h.code}</td>
              <td className="py-2 pr-3 text-slate-800">{h.label}</td>
              <td className="py-2 pr-3 text-right text-slate-300">—</td>
              <td className="py-2 text-right text-slate-300">—</td>
            </tr>
          ))}
        </tbody>
      </table>
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
