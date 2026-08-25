import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Globe, ExternalLink, Upload, Check, Copy, AlertCircle, Loader2,
  FileSpreadsheet, Trash2, ArrowRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { useKeeValueImport } from '@/hooks/useKeeValueImport'
import { supabase } from '@/lib/supabase'
import {
  parseKeeValueXlsx, KeeValueParseError,
  hauptgruppenZeilen, bkp2Unterpositionen, zuNaefHauptgruppen,
} from '@/lib/keevalue'
import { HAUPTGRUPPEN } from '@/lib/bkpKatalog'
import { PRIMARY_DARK, PRIMARY_LIGHT } from '@/lib/ci'
import { cn, formatCurrency, formatNumber } from '@/lib/utils'
import type { Project } from '@/types'

const KEEVALUE_URL = 'https://www.keevalue.ch/'

/** Ein Feld des keeValue-Eingabeformulars, gespeist aus unserem Mengengerüst. */
interface KeeFeld {
  /** Beschriftung exakt wie im keeValue-Formular — erleichtert das Übertragen. */
  label: string
  /** Aufbereiteter Wert zum Ablesen; null = bei uns nicht erfasst. */
  wert: string | null
  /** Wert für die Zwischenablage (ohne Einheit/Trennzeichen). */
  copyWert?: string
  /** Hinweis, wenn der Wert fehlt oder hergeleitet ist. */
  hinweis?: string
}

/**
 * Erfassungsbereich für die Methode „keeValue".
 *
 * keeValue setzt `Content-Security-Policy: frame-ancestors 'self'` und lässt
 * sich deshalb nicht per iframe einbetten. Statt eines eingebetteten Fensters
 * öffnen wir das Tool in einem zweiten, auf die rechte Bildschirmhälfte
 * positionierten Browserfenster — links bleibt dieses Panel mit den Werten
 * aus dem Businessplan stehen.
 */
export function KeeValueSection({ projectId, variantId }: { projectId: string; variantId: string }) {
  const { canWrite } = useAuth()
  const { buildings, gsfTotal, variant } = useAnlagekostenShared()
  const { row, imp, loading, save, remove } = useKeeValueImport(variantId)

  const [project, setProject] = useState<Project | null>(null)
  useEffect(() => {
    let cancelled = false
    void supabase.from('projects').select('*').eq('id', projectId).maybeSingle()
      .then(({ data }) => { if (!cancelled) setProject((data as Project | null) ?? null) })
    return () => { cancelled = true }
  }, [projectId])

  // ── Werte aus dem Mengengerüst ─────────────────────────────────────────────
  const felder = useMemo<KeeFeld[]>(() => {
    const gf = buildings.reduce((s, b) => s + (b.geschossflaeche_m2 ?? 0), 0)
    const gv = buildings.reduce((s, b) => s + (b.volumen_m3 ?? 0), 0)
    const nutzungen = [...new Set(buildings.map((b) => b.nutzung_haupt).filter(Boolean))] as string[]
    const adresse = [project?.strasse, project?.hausnummer].filter(Boolean).join(' ').trim()
    const plzOrt = [project?.plz, project?.ort].filter(Boolean).join(' ').trim()
    const objekt = [project?.name, variant?.name].filter(Boolean).join(' — ')

    return [
      { label: 'Objektbezeichnung', wert: objekt || null, copyWert: objekt },
      {
        label: 'Hauptnutzung',
        wert: nutzungen.length ? nutzungen.join(', ') : null,
        copyWert: nutzungen.join(', '),
        hinweis: 'In keeValue aus dessen Nutzungskatalog wählen — Text dient nur als Anhalt.',
      },
      { label: 'Strasse und Nr.', wert: adresse || null, copyWert: adresse },
      { label: 'Postleitzahl und Ort', wert: plzOrt || null, copyWert: plzOrt },
      {
        label: 'Geschossfläche GF SIA 416',
        wert: gf > 0 ? `${formatNumber(gf)} m²` : null,
        copyWert: gf > 0 ? String(Math.round(gf)) : undefined,
        hinweis: gf > 0 ? undefined : 'Geschossflächen in „Mengen und Erträge" erfassen.',
      },
      {
        label: 'Gebäudevolumen GV SIA 416',
        wert: gv > 0 ? `${formatNumber(gv)} m³` : null,
        copyWert: gv > 0 ? String(Math.round(gv)) : undefined,
        hinweis: gv > 0 ? undefined : 'Volumen in „Mengen und Erträge" erfassen.',
      },
      {
        label: 'Anzahl Gebäude',
        wert: buildings.length > 0 ? String(buildings.length) : null,
        copyWert: String(buildings.length),
      },
      {
        label: 'Grundstücksfläche (Kontext)',
        wert: gsfTotal > 0 ? `${formatNumber(gsfTotal)} m²` : null,
        copyWert: gsfTotal > 0 ? String(Math.round(gsfTotal)) : undefined,
        hinweis: 'Kein keeValue-Feld — als Anhalt für die bearbeitete Umgebungsfläche BUF.',
      },
      // Diese Angaben führt der Businessplan (noch) nicht. Bewusst sichtbar
      // gelassen, damit klar ist, was in keeValue von Hand zu setzen ist.
      { label: 'Anteil Gebäudevolumen unter Terrain', wert: null, hinweis: 'Im Businessplan nicht erfasst — in keeValue direkt eingeben.' },
      { label: 'Bearbeitete Umgebungsfläche BUF', wert: null, hinweis: 'Im Businessplan nicht erfasst — in keeValue direkt eingeben.' },
      { label: 'Anzahl Geschosse über Terrain', wert: null, hinweis: 'Im Businessplan nicht erfasst — in keeValue direkt eingeben.' },
      { label: 'Anzahl Geschosse unter Terrain', wert: null, hinweis: 'Im Businessplan nicht erfasst — in keeValue direkt eingeben.' },
      { label: 'Anzahl unterirdische Parkplätze', wert: null, hinweis: 'Im Businessplan nicht erfasst — in keeValue direkt eingeben.' },
      { label: 'Transportanlagen Vertikalaufzüge', wert: null, hinweis: 'Im Businessplan nicht erfasst — in keeValue direkt eingeben.' },
    ]
  }, [buildings, gsfTotal, project, variant])

  // ── keeValue in zweitem Fenster öffnen ─────────────────────────────────────
  const oeffneKeeValue = useCallback(() => {
    const availW = window.screen.availWidth
    const availH = window.screen.availHeight
    const breite = Math.floor(availW / 2)
    const features = `popup=yes,width=${breite},height=${availH},left=${availW - breite},top=0,noopener,noreferrer`
    window.open(KEEVALUE_URL, 'keevalue', features)
  }, [])

  // ── Excel-Import ───────────────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [importFehler, setImportFehler] = useState<string | null>(null)
  const [importiert, setImportiert] = useState(false)
  const [busy, setBusy] = useState(false)

  const verarbeite = useCallback(async (file: File) => {
    setImportFehler(null)
    setImportiert(false)
    setBusy(true)
    try {
      const buf = await file.arrayBuffer()
      const parsed = parseKeeValueXlsx(buf)
      await save(parsed, file.name)
      setImportiert(true)
      window.setTimeout(() => setImportiert(false), 4000)
    } catch (e) {
      setImportFehler(
        e instanceof KeeValueParseError ? e.message
          : e instanceof Error ? `Import fehlgeschlagen: ${e.message}`
          : 'Import fehlgeschlagen.',
      )
    } finally {
      setBusy(false)
    }
  }, [save])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void verarbeite(file)
  }, [verarbeite])

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* ── Links: Werte aus dem Businessplan ────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-1 flex items-center gap-2">
          <ArrowRight className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-medium text-slate-700">Daten für keeValue</h3>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          Werte aus dem Mengengerüst dieser Variante, in der Reihenfolge des keeValue-Eingabeformulars.
        </p>

        <dl className="divide-y divide-slate-100">
          {felder.map((f) => (
            <FeldZeile key={f.label} feld={f} />
          ))}
        </dl>
      </section>

      {/* ── Rechts: Tool öffnen und Ergebnis einlesen ────────────────────── */}
      <div className="space-y-5">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-1 flex items-center gap-2">
            <Globe className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-medium text-slate-700">keeValue bearbeiten</h3>
          </div>
          <p className="mb-4 text-xs text-slate-500">
            Öffnet keevalue.ch in einem zweiten Fenster auf der rechten Bildschirmhälfte.
            Ein Einbetten in diese Seite lässt keeValue nicht zu.
          </p>
          <Button type="button" onClick={oeffneKeeValue} className="gap-2">
            <ExternalLink className="h-4 w-4" />
            keeValue öffnen
          </Button>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-1 flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-medium text-slate-700">Ergebnis-Excel einlesen</h3>
          </div>
          <p className="mb-4 text-xs text-slate-500">
            Den unveränderten Excel-Export aus keeValue ablegen. Gelesen wird das Blatt
            „Ergebnisse Erstellungskosten" (BKP 1–5).
          </p>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={canWrite ? onDrop : undefined}
            onClick={() => canWrite && fileRef.current?.click()}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition',
              dragOver ? 'border-slate-400 bg-slate-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
              !canWrite && 'cursor-not-allowed opacity-60',
            )}
            style={dragOver ? { borderColor: PRIMARY_DARK, backgroundColor: PRIMARY_LIGHT } : undefined}
          >
            {busy ? (
              <><Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                <span className="mt-2 text-sm text-slate-500">Wird eingelesen…</span></>
            ) : importiert ? (
              <><Check className="h-5 w-5" style={{ color: PRIMARY_DARK }} />
                <span className="mt-2 text-sm font-medium" style={{ color: PRIMARY_DARK }}>Import übernommen</span></>
            ) : (
              <><Upload className="h-5 w-5 text-slate-400" />
                <span className="mt-2 text-sm text-slate-600">Excel hier ablegen oder klicken</span>
                <span className="mt-0.5 text-xs text-slate-400">.xlsx aus keeValue</span></>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void verarbeite(file)
              e.target.value = ''
            }}
          />

          {importFehler && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{importFehler}</span>
            </div>
          )}

          {row && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span className="font-medium text-slate-600">{row.file_name}</span>
              {row.version && <span>Version {row.version}</span>}
              {row.preisstand && <span>Preisstand {row.preisstand}</span>}
              {canWrite && (
                <button
                  type="button"
                  onClick={() => void remove()}
                  className="ml-auto inline-flex items-center gap-1 text-slate-400 transition hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Import entfernen
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      {/* ── Ergebnis über die volle Breite ───────────────────────────────── */}
      {loading ? (
        <div className="lg:col-span-2 flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Wird geladen…
        </div>
      ) : imp ? (
        <div className="lg:col-span-2">
          <ImportErgebnis imp={imp} />
        </div>
      ) : null}
    </div>
  )
}

// ── Einzelne Wertzeile mit Kopier-Button ─────────────────────────────────────

function FeldZeile({ feld }: { feld: KeeFeld }) {
  const [kopiert, setKopiert] = useState(false)
  const kopierbar = feld.wert != null && !!feld.copyWert

  const kopiere = useCallback(() => {
    if (!feld.copyWert) return
    void navigator.clipboard.writeText(feld.copyWert).then(() => {
      setKopiert(true)
      window.setTimeout(() => setKopiert(false), 1500)
    })
  }, [feld.copyWert])

  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <div className="min-w-0">
        <dt className="text-sm text-slate-600">{feld.label}</dt>
        {feld.hinweis && <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{feld.hinweis}</p>}
      </div>
      <dd className="flex shrink-0 items-center gap-1.5">
        {feld.wert != null ? (
          <span className="text-sm font-medium tabular-nums text-slate-900">{feld.wert}</span>
        ) : (
          <span className="text-sm text-slate-300">—</span>
        )}
        {kopierbar && (
          <button
            type="button"
            onClick={kopiere}
            title="In die Zwischenablage kopieren"
            className="rounded p-1 text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
          >
            {kopiert
              ? <Check className="h-3.5 w-3.5" style={{ color: PRIMARY_DARK }} />
              : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}
      </dd>
    </div>
  )
}

// ── Darstellung des importierten Ergebnisses ─────────────────────────────────

function ImportErgebnis({ imp }: { imp: ReturnType<typeof parseKeeValueXlsx> }) {
  const hg = hauptgruppenZeilen(imp)
  const unter = bkp2Unterpositionen(imp)
  const naef = zuNaefHauptgruppen(imp)
  const hgLabel = new Map(HAUPTGRUPPEN.map((h) => [h.code as number, h.label]))

  // keeValue rundet seine Zeilen einzeln; die Summe kann deshalb um wenige
  // Franken vom ausgewiesenen Total abweichen. Wir weisen die Differenz aus,
  // statt sie stillschweigend zu glätten.
  const summeZeilen = hg.reduce((s, z) => s + z.netto, 0)
  const differenz = summeZeilen - imp.totalNetto

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-medium text-slate-700">Erstellungskosten aus keeValue</h3>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3 font-medium">BKP</th>
                <th className="py-2 pr-3 font-medium">Bezeichnung</th>
                <th className="py-2 pr-3 text-right font-medium">exkl. MwSt.</th>
                <th className="py-2 pr-3 text-right font-medium">inkl. MwSt.</th>
                <th className="py-2 text-right font-medium">Kennwert</th>
              </tr>
            </thead>
            <tbody>
              {hg.map((z) => (
                <tr key={z.code} className="border-b border-slate-50">
                  <td className="py-1.5 pr-3 tabular-nums text-slate-500">{z.code}</td>
                  <td className="py-1.5 pr-3 text-slate-800">{z.label}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatCurrency(z.netto)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatCurrency(z.brutto)}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-500">
                    {z.kennwert != null ? `${formatNumber(z.kennwert)} ${z.kennwertEinheit ?? ''}`.trim() : '—'}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 font-semibold">
                <td className="py-2 pr-3" colSpan={2}>Erstellungskosten</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(imp.totalNetto)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(imp.totalBrutto)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        {Math.abs(differenz) >= 1 && (
          <p className="mt-2 text-xs text-slate-400">
            Rundungsdifferenz aus keeValue: Summe der Zeilen {formatCurrency(summeZeilen)} gegenüber
            ausgewiesenem Total {formatCurrency(imp.totalNetto)} ({differenz > 0 ? '+' : ''}{formatCurrency(differenz)}).
          </p>
        )}

        {(imp.planungszeitMonate != null || imp.bauzeitMonate != null) && (
          <div className="mt-4 flex flex-wrap gap-6 border-t border-slate-100 pt-3 text-sm">
            {imp.planungszeitMonate != null && (
              <div>
                <span className="text-xs text-slate-500">Planungszeit</span>
                <div className="font-medium tabular-nums">{imp.planungszeitMonate} Monate</div>
              </div>
            )}
            {imp.bauzeitMonate != null && (
              <div>
                <span className="text-xs text-slate-500">Bauzeit</span>
                <div className="font-medium tabular-nums">{imp.bauzeitMonate} Monate</div>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-medium text-slate-700">Zuordnung zu unseren Hauptgruppen</h3>
        <p className="mb-3 mt-0.5 text-xs text-slate-500">
          keeValue führt die Honorare als Position 29 innerhalb BKP 2. Sie werden hier nach
          Hauptgruppe 6 umgehängt und von BKP 2 abgezogen, damit sie nicht doppelt zählen.
          Die Reserve (keeValue-Position 6) wird nach Hauptgruppe 9 gebucht.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.keys(naef).map(Number).sort((a, b) => a - b).map((code) => (
            <div key={code} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <div className="text-xs text-slate-500">BKP {code} · {hgLabel.get(code) ?? ''}</div>
              <div className="text-sm font-medium tabular-nums">{formatCurrency(naef[code].netto)}</div>
              <div className="text-xs tabular-nums text-slate-400">{formatCurrency(naef[code].brutto)} inkl.</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Nicht von keeValue abgedeckt: BKP 0 Grundstück, 3 Betriebseinrichtungen, 7 Vermarktung,
          8 Entwicklung. Diese bleiben über den Detailkatalog bzw. die Benchmarks zu erfassen.
        </p>
      </section>

      {unter.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            Unterpositionen BKP 2 ({unter.length})
          </summary>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {unter.map((z) => (
                <tr key={z.code} className="border-b border-slate-50">
                  <td className="py-1.5 pr-3 tabular-nums text-slate-500">{z.code}</td>
                  <td className="py-1.5 pr-3 text-slate-800">{z.label}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatCurrency(z.netto)}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-500">{formatCurrency(z.brutto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  )
}
