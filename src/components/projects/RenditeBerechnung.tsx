import { useMemo, useState, type ReactNode } from 'react'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { eigentumsartForBuilding } from '@/types'
import { isGarageNutzung } from '@/lib/bkp2'
import { USE_TYPE_COLOR_1 } from '@/lib/kategorieFarben'
import { useRendite } from '@/hooks/useRendite'
import { useUndoableSetter } from '@/contexts/UndoContext'
import { cn, formatNumber } from '@/lib/utils'

const EIG: 'renditeobjekt' = 'renditeobjekt'
const HILITE = USE_TYPE_COLOR_1.renditeobjekt // heller Blauton für Zwischensummen

function isParkNutzung(n: string): boolean {
  return isGarageNutzung(n) || /\bpp\b|parkpl|parkplatz|tiefgarage|einstellh|autoeinstell|abstellplatz/i.test(n)
}

export function RenditeBerechnung({ variantId, mode = 'rendite' }: { variantId: string; mode?: 'rendite' | 'residual' }) {
  const ak = useAnlagekostenShared()
  const { params: p, setParams: setParamsRaw } = useRendite(variantId)
  const setParams = useUndoableSetter(p, setParamsRaw, mode === 'residual' ? 'Residualwert' : 'Renditeberechnung', `rendite:${variantId}`)

  // Mietertrag SOLL je Nutzung aus den Mengen (Renditeobjekte) + Total-VMF.
  const { ertraege, totalVmf } = useMemo(() => {
    const map = new Map<string, { nutzung: string; isPark: boolean; vmf: number; stk: number; ertrag: number }>()
    let totalVmf = 0
    for (const b of ak.buildings) {
      if (eigentumsartForBuilding(b.use_type) !== EIG) continue
      for (const mf of b.mietflaechen) {
        const fl = mf.flaeche_m2 || 0
        const anz = mf.anzahl || 0
        totalVmf += fl
        const ertrag = (mf.miete_chf_pa || 0)
          || (mf.miete_chf_m2_pa ? mf.miete_chf_m2_pa * fl : 0)
          || (mf.miete_chf_stk_mt ? mf.miete_chf_stk_mt * anz * 12 : 0)
        if (ertrag <= 0) continue
        const name = (mf.nutzung || '').trim() || '(ohne Nutzung)'
        const isPark = isParkNutzung(name) || (fl <= 0 && anz > 0)
        const e = map.get(name) ?? { nutzung: name, isPark, vmf: 0, stk: 0, ertrag: 0 }
        e.vmf += fl
        e.stk += anz
        e.ertrag += ertrag
        map.set(name, e)
      }
    }
    return {
      ertraege: [...map.values()].sort((a, b) => Number(a.isPark) - Number(b.isPark) || b.ertrag - a.ertrag),
      totalVmf,
    }
  }, [ak.buildings])

  const mietertragSoll = ertraege.reduce((s, e) => s + e.ertrag, 0)
  const leerstand = mietertragSoll * p.leerstand
  const mietertragIst = mietertragSoll - leerstand
  const betriebskosten = mietertragSoll * p.betriebskosten
  const instandhaltung = p.instandhaltungProM2 * totalVmf
  const baurechtszins = p.baurechtszins
  const mietertragNetto = mietertragIst - betriebskosten - instandhaltung - baurechtszins
  const instandsetzung = p.instandsetzungProM2 * totalVmf
  const liegenschaftserfolg = mietertragNetto - instandsetzung

  // Anlagekosten Renditeobjekt (konsolidiert) brutto — aus der Erfassungsmethode,
  // die in den Anlagekosten gewählt ist (Detailkatalog oder keeValue).
  const { investition, erstellung } = useMemo(() => {
    const erg = ak.konsolidiertEffektiv.get(EIG)
    if (!erg) return { investition: 0, erstellung: 0 }
    let inv = 0
    for (let c = 0; c <= 9; c++) {
      const key = c as keyof typeof erg.hauptgruppenSummenNetto
      inv += (erg.hauptgruppenSummenNetto[key] ?? 0) + (erg.hauptgruppenSummenMwst[key] ?? 0)
    }
    // „Anlagekosten exkl. Grundstück": nur Position 010 (Grundstück) herausrechnen
    // (die übrigen Positionen der HG 0 bleiben drin).
    const p010 = erg.positionen['010']
    const land = (p010?.betragNetto ?? 0) + (p010?.mwstBetrag ?? 0)
    return { investition: inv, erstellung: inv - land }
  }, [ak.konsolidiertEffektiv])

  const bruttorendite = investition > 0 ? mietertragSoll / investition : 0
  const nettorendite = investition > 0 ? liegenschaftserfolg / investition : 0

  // Residualwert: Ertragswert = Liegenschaftserfolg / Nettokapitalisierungssatz,
  // abzüglich Anlagekosten exkl. Grundstück (nur Pos. 010 raus) = residualer Landwert.
  const ertragswert = p.nettoKapSatz > 0 ? liegenschaftserfolg / p.nettoKapSatz : 0
  const landwert = ertragswert - erstellung
  const landwertProM2 = ak.gsfTotal > 0 ? landwert / ak.gsfTotal : 0

  return (
    <div className="space-y-6">
      {/* ── Mietertrag SOLL (aus Mengen) ──────────────────────────────── */}
      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-900">Mietertrag SOLL</h4>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <colgroup>
              <col />
              <col style={{ width: '9rem' }} />
              <col style={{ width: '11rem' }} />
              <col style={{ width: '10rem' }} />
            </colgroup>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100 text-slate-600">
                <th className="px-3 py-2 text-left font-medium">Nutzung</th>
                <th className="px-3 py-2 text-right font-medium">Menge</th>
                <th className="px-3 py-2 text-right font-medium">Ansatz</th>
                <th className="px-3 py-2 text-right font-medium">Ertrag CHF/a</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ertraege.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-3 text-center text-slate-400">Keine Erträge in den Mengen erfasst.</td></tr>
              )}
              {ertraege.map((e) => (
                <tr key={e.nutzung}>
                  <td className="px-3 py-1.5 text-slate-700">{e.nutzung}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-900">
                    {e.isPark ? `${formatNumber(e.stk)} Stk` : `${formatNumber(e.vmf)} m²`}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                    {e.isPark
                      ? `${formatNumber(e.stk > 0 ? e.ertrag / e.stk / 12 : 0)} CHF/Stk·Mt`
                      : `${formatNumber(e.vmf > 0 ? e.ertrag / e.vmf : 0)} CHF/m²·a`}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-900">{formatNumber(e.ertrag)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 font-semibold text-slate-900" style={{ backgroundColor: HILITE }}>
                <td className="px-3 py-2" colSpan={3}>Mietertrag SOLL</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(mietertragSoll)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── Liegenschaftserfolg (nach SIA d2013) ──────────────────────── */}
      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-900">Erfolgsrechnung</h4>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <colgroup>
              <col />
              <col style={{ width: '20rem' }} />
              <col style={{ width: '10rem' }} />
            </colgroup>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100 text-slate-600">
                <th className="px-3 py-2" />
                <th className="px-3 py-2" />
                <th className="px-3 py-2 text-right font-medium">CHF/a</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <Row label="Mietertrag SOLL" chf={mietertragSoll} />
              <Row label="Leerstand" satz={<PctCell label="von SOLL" value={p.leerstand} onChange={(v) => setParams({ ...p, leerstand: v })} />} chf={-leerstand} />
              <Row label="Mietertrag IST" chf={mietertragIst} highlight />
              <Row label="Betriebskosten" satz={<PctCell label="von SOLL" value={p.betriebskosten} onChange={(v) => setParams({ ...p, betriebskosten: v })} />} chf={-betriebskosten} />
              <Row label="Instandhaltung" satz={<DualInput perM2={p.instandhaltungProM2} totalVmf={totalVmf} soll={mietertragSoll} onChange={(v) => setParams({ ...p, instandhaltungProM2: v })} />} chf={-instandhaltung} />
              <Row label="Baurechtszins" satz={<span className="inline-flex items-center justify-end gap-1"><span className="text-xs text-slate-400">CHF/a</span><NumInput value={p.baurechtszins} w="w-20" onChange={(v) => setParams({ ...p, baurechtszins: v })} /></span>} chf={-baurechtszins} />
              <Row label="Mietertrag Netto" chf={mietertragNetto} highlight />
              <Row label="Instandsetzungskosten" satz={<DualInput perM2={p.instandsetzungProM2} totalVmf={totalVmf} soll={mietertragSoll} onChange={(v) => setParams({ ...p, instandsetzungProM2: v })} />} chf={-instandsetzung} />
              <Row label="Liegenschaftserfolg" chf={liegenschaftserfolg} highlight strong />
            </tbody>
          </table>
        </div>
      </div>

      {mode === 'rendite' ? (
        <>
          {/* ── Kennzahlen ────────────────────────────────────────────── */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Kennzahl label="Bruttorendite" value={bruttorendite} hint={`Mietertrag SOLL / Anlagekosten (CHF ${formatNumber(investition)})`} />
            <Kennzahl label="Nettorendite" value={nettorendite} hint="Liegenschaftserfolg / Anlagekosten" />
          </div>

          <p className="text-[11px] text-slate-400">
            Mietertrag SOLL automatisch aus den Mengen (Renditeobjekte) je Nutzung — Flächen mit CHF/m²·a, Parkplätze
            mit CHF/Stk·Mt. Leerstand/Betriebskosten in % des SOLL; Instandhaltung/Instandsetzung wahlweise in CHF/m²·a oder
            % des SOLL (auf {formatNumber(totalVmf)} m² VMF), beide Felder werden gegenseitig nachgeführt; Baurechtszins absolut.
            Default-Werte als Vorschlag (SIA d2013), editierbar. Anlagekosten brutto, BKP 0–9 inkl. Land.
          </p>
        </>
      ) : (
        <>
          {/* ── Residualer Landwert ───────────────────────────────────── */}
          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-900">Residualer Landwert</h4>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <colgroup>
                  <col />
                  <col style={{ width: '20rem' }} />
                  <col style={{ width: '10rem' }} />
                </colgroup>
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-100 text-slate-600">
                    <th className="px-3 py-2" />
                    <th className="px-3 py-2" />
                    <th className="px-3 py-2 text-right font-medium">CHF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <Row label="Liegenschaftserfolg" chf={liegenschaftserfolg} />
                  <Row label="Nettokapitalisierungssatz" satz={<PctCell label="netto" value={p.nettoKapSatz} onChange={(v) => setParams({ ...p, nettoKapSatz: v })} />} />
                  <Row label="Ertragswert" chf={ertragswert} highlight />
                  <Row label="Anlagekosten exkl. Grundstück" chf={-erstellung} />
                  <Row label="Residualer Landwert" chf={landwert} highlight strong />
                  <Row label="Grundstücksfläche (aus Anlagekosten)" satz={<span className="text-xs text-slate-500 tabular-nums">{formatNumber(ak.gsfTotal)} m²</span>} />
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <KennzahlChf label="Residualer Landwert" value={landwert} unit="CHF" />
            <KennzahlChf label="Residualer Landwert je m²" value={landwertProM2} unit="CHF/m²" />
          </div>

          <p className="text-[11px] text-slate-400">
            Ertragswert = Liegenschaftserfolg ÷ Nettokapitalisierungssatz; abzüglich Anlagekosten exkl. Grundstück
            (nur Pos. 010 raus, CHF {formatNumber(erstellung)}) = residualer Landwert. CHF/m² bezogen auf die Grundstücksfläche aus den
            Anlagekosten ({formatNumber(ak.gsfTotal)} m²). Erträge/Erfolgsrechnung wie bei der Renditeberechnung.
          </p>
        </>
      )}
    </div>
  )
}

// %-Zelle: Hinweis links, %-Feld rechtsbündig (bündig mit den DualInput-%-Feldern).
function PctCell({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <span className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
      <span className="text-xs text-slate-400">{label}</span>
      <PctInput value={value} onChange={onChange} />
    </span>
  )
}

function Row({ label, satz, chf, highlight, strong }: {
  label: string; satz?: ReactNode; chf?: number; highlight?: boolean; strong?: boolean
}) {
  return (
    <tr className={cn(highlight && 'font-semibold', strong && 'border-t-2 border-slate-300')} style={highlight ? { backgroundColor: HILITE } : undefined}>
      <td className="px-3 py-2 text-slate-700">{label}</td>
      <td className="px-3 py-2 text-right">{satz}</td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-900">{chf != null ? formatNumber(chf) : ''}</td>
    </tr>
  )
}

function KennzahlChf({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
        {formatNumber(value)} <span className="text-sm font-normal text-slate-400">{unit}</span>
      </div>
    </div>
  )
}

function Kennzahl({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{(value * 100).toFixed(2)} %</div>
      <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>
    </div>
  )
}

// %-Eingabe (Anzeige in %, Speicherung als Anteil 0..1).
function PctInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [raw, setRaw] = useState<string | null>(null)
  return (
    <span className="relative inline-block w-20">
      <input
        type="text"
        inputMode="decimal"
        value={raw ?? (value * 100).toFixed(1)}
        onFocus={() => setRaw((value * 100).toFixed(1))}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={() => { const n = parseFloat((raw ?? '').replace(',', '.')); onChange(Number.isFinite(n) ? n / 100 : value); setRaw(null) }}
        className="w-full rounded border border-slate-300 bg-white py-0.5 pl-2 pr-5 text-right text-sm tabular-nums outline-none focus:border-[#8B6956]"
      />
      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
    </span>
  )
}

// Zahlen-Eingabe (1000er-Trennzeichen, optional Dezimalstellen).
function NumInput({ value, onChange, decimals = 0, w = 'w-24' }: {
  value: number; onChange: (v: number) => void; decimals?: number; w?: string
}) {
  const [raw, setRaw] = useState<string | null>(null)
  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw ?? formatNumber(value, decimals)}
      onFocus={() => setRaw(String(value))}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={() => { const n = parseFloat((raw ?? '').replace(/['’\s]/g, '').replace(',', '.')); onChange(Number.isFinite(n) ? n : value); setRaw(null) }}
      className={cn('rounded border border-slate-300 bg-white px-2 py-0.5 text-right text-sm tabular-nums outline-none focus:border-[#8B6956]', w)}
    />
  )
}

// Eingabe wahlweise als CHF/m²·a oder als % des Mietertrag SOLL — das jeweils
// andere Feld wird automatisch nachgeführt (kanonische Grösse bleibt CHF/m²·a).
function DualInput({ perM2, totalVmf, soll, onChange }: {
  perM2: number; totalVmf: number; soll: number; onChange: (perM2: number) => void
}) {
  const pct = soll > 0 ? (perM2 * totalVmf) / soll : 0
  return (
    <span className="flex w-full items-center justify-between gap-2">
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <span className="text-xs text-slate-400">CHF/m²·a</span>
        <NumInput value={perM2} decimals={1} w="w-16" onChange={onChange} />
        <span className="text-xs text-slate-400">oder</span>
      </span>
      <PctCell label="von SOLL" value={pct} onChange={(v) => onChange(totalVmf > 0 ? (v * soll) / totalVmf : perM2)} />
    </span>
  )
}
