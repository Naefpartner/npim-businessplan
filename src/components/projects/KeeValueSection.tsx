import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Globe, ExternalLink, Upload, Check, Copy, AlertCircle, Loader2,
  FileSpreadsheet, Trash2, ArrowRight, ChevronDown, ChevronRight,
  ClipboardList, Coins,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import { useAnlagekostenShared } from '@/contexts/VariantDataContext'
import { useKeeValueImport } from '@/hooks/useKeeValueImport'
import { useKeeValueErgaenzung } from '@/hooks/useKeeValueErgaenzung'
import { useKostenBloecke, type KostenBlock } from '@/hooks/useKostenBloecke'
import { supabase } from '@/lib/supabase'
import {
  parseKeeValueXlsx, KeeValueParseError, ermittleKeeValueMengen, anlagekostenZeilen,
  type ErgaenzungDoc, type AnlagekostenZeile, type GeschossZaehlung,
  type AnlagekostenBezug, type KeeValueImport, type KeeValueModus,
} from '@/lib/keevalue'
import { AnsatzEingabe } from '@/components/projects/AnsatzEingabe'
import { EIGENTUMSART_COLOR, TOTAL_COLOR } from '@/lib/kategorieFarben'
import { CI, PRIMARY_DARK, PRIMARY_LIGHT } from '@/lib/ci'
import { cn, formatCurrency, formatNumber } from '@/lib/utils'
import type { Project, VariantKeeValueImport } from '@/types'
import type { VariantBuildingFull } from '@/hooks/useMengengeruest'

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
 * Feld „Anzahl Geschosse über/unter Terrain": Ø der Geschosse je Gebäude, das
 * in dieser Lage welche ausweist. keeValue nimmt eine ganze Zahl, deshalb wird
 * gerundet — der ungerundete Wert und die zugrundeliegenden Zahlen stehen im
 * Hinweis, damit die Rundung nachvollziehbar bleibt.
 */
function geschossFeld(z: GeschossZaehlung, lage: 'über' | 'unter'): KeeFeld {
  const label = `Anzahl Geschosse ${lage} Terrain`
  const adjektiv = lage === 'über' ? 'oberirdische' : 'unterirdische'

  if (z.schnitt == null) {
    return {
      label,
      wert: null,
      hinweis: `Keine ${adjektiv}n Geschosse bezeichnet — Geschoss in „Mengen und Erträge" erfassen.`,
    }
  }

  const gerundet = Math.round(z.schnitt)
  const teile = [
    `${z.total} ${adjektiv} Geschosse in ${z.gebaeude} ${z.gebaeude === 1 ? 'Gebäude' : 'Gebäuden'}`,
  ]
  if (gerundet !== z.schnitt) teile.push(`Ø ${z.schnitt.toFixed(1)}, gerundet`)
  if (z.ohneGeschoss > 0) {
    teile.push(`${z.ohneGeschoss} ${adjektiv} ${z.ohneGeschoss === 1 ? 'Zeile' : 'Zeilen'} ohne Geschossangabe nicht gezählt`)
  }

  return { label, wert: String(gerundet), copyWert: String(gerundet), hinweis: `${teile.join(' · ')}.` }
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

/**
 * Die Werte des keeValue-Eingabeformulars, abgeleitet aus einer Auswahl von
 * Gebäuden und deren Grundstücksanteil. `blockTitel` erscheint in der
 * Objektbezeichnung, damit sich die Ergebnisse mehrerer Blöcke in keeValue
 * auseinanderhalten lassen.
 */
function keeValueFelder(
  gebaeude: VariantBuildingFull[],
  gsfTotal: number,
  project: Project | null,
  variantName: string | null,
  blockTitel: string | null,
): KeeFeld[] {
  const mengen = ermittleKeeValueMengen(gebaeude, gsfTotal)
  const { gfM2: gf, gvM3: gv } = mengen
  const nutzungen = [...new Set(gebaeude.map((b) => b.nutzung_haupt).filter(Boolean))] as string[]
  const adresse = [project?.strasse, project?.hausnummer].filter(Boolean).join(' ').trim()
  const plzOrt = [project?.plz, project?.ort].filter(Boolean).join(' ').trim()
  const objekt = [project?.name, variantName, blockTitel].filter(Boolean).join(' — ')

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
      label: 'Anteil Gebäudevolumen unter Terrain',
      wert: mengen.anteilUnterTerrain != null
        ? `${(mengen.anteilUnterTerrain * 100).toFixed(2)} %`
        : null,
      copyWert: mengen.anteilUnterTerrain != null
        ? (mengen.anteilUnterTerrain * 100).toFixed(2)
        : undefined,
      hinweis: mengen.anteilUnterTerrain != null
        ? `${formatNumber(mengen.gvUnterirdischM3)} m³ von ${formatNumber(gv)} m³ als unterirdisch erfasst.`
        : 'Volumen in „Mengen und Erträge" erfassen.',
    },
    {
      label: 'Anzahl Gebäude',
      wert: gebaeude.length > 0 ? String(gebaeude.length) : null,
      copyWert: String(gebaeude.length),
    },
    {
      label: 'Anzahl unterirdische Parkplätze',
      wert: String(mengen.parkplaetzeUnterirdisch),
      copyWert: String(mengen.parkplaetzeUnterirdisch),
      hinweis: mengen.parkplaetzeUnterirdisch > 0
        ? 'Aus den als unterirdisch erfassten Parking-/Garagenflächen.'
        : 'Keine unterirdisch erfasste Parking-Fläche im Mengengerüst.',
    },
    {
      label: 'Bearbeitete Umgebungsfläche BUF',
      wert: mengen.bufM2 != null ? `${formatNumber(mengen.bufM2)} m²` : null,
      copyWert: mengen.bufM2 != null ? String(Math.round(mengen.bufM2)) : undefined,
      hinweis: mengen.bufM2 != null
        ? `Parzellen ${formatNumber(gsfTotal)} m² abzüglich Erdgeschossflächen ${formatNumber(mengen.egFlaecheM2)} m².`
        : gsfTotal > 0
          ? 'Keine Zeile als Erdgeschoss bezeichnet — Geschoss in „Mengen und Erträge" auf EG setzen.'
          : 'Keine Parzellenfläche erfasst.',
    },
    geschossFeld(mengen.geschosseUeberTerrain, 'über'),
    geschossFeld(mengen.geschosseUnterTerrain, 'unter'),
    // Diese Angabe führt der Businessplan nicht — laut Absprache manuell.
    { label: 'Transportanlagen Vertikalaufzüge', wert: null, hinweis: 'Im Businessplan nicht erfasst — in keeValue direkt eingeben.' },
  ]
}

export function KeeValueSection({ projectId, variantId }: { projectId: string; variantId: string }) {
  const { canWrite } = useAuth()
  const { variant, hasOhneEtappe } = useAnlagekostenShared()
  const importe = useKeeValueImport(variantId)
  const ergaenzung = useKeeValueErgaenzung(variantId)
  const bloecke = useKostenBloecke(ergaenzung.doc.modus)

  const [project, setProject] = useState<Project | null>(null)
  useEffect(() => {
    let cancelled = false
    void supabase.from('projects').select('*').eq('id', projectId).maybeSingle()
      .then(({ data }) => { if (!cancelled) setProject((data as Project | null) ?? null) })
    return () => { cancelled = true }
  }, [projectId])

  const laedt = importe.loading || ergaenzung.loading

  // Gesamtsumme über die Blöcke, die ein Ergebnis eingelesen haben.
  const gesamt = useMemo(() => {
    let netto = 0, brutto = 0, gfM2 = 0, mitImport = 0
    for (const b of bloecke) {
      const imp = importe.imp(b.key)
      if (!imp) continue
      const erg = anlagekostenZeilen(imp, ergaenzung.kennwerte(b.key), b.bezug)
      netto += erg.totalNetto
      brutto += erg.totalBrutto
      gfM2 += erg.bezugsGfM2 ?? b.bezug.gfM2
      mitImport++
    }
    return { netto, brutto, gfM2, mitImport }
  }, [bloecke, importe, ergaenzung])

  return (
    <div className="space-y-4">
      {/* Erfassungstiefe — gesamthaft oder je Etappe × Nutzungsart. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
        <p className="text-xs text-slate-500">
          {ergaenzung.doc.modus === 'total'
            ? 'Ein keeValue-Ergebnis für die ganze Variante.'
            : 'Je Etappe und Nutzungsart ein eigenes keeValue-Ergebnis, separat gerechnet und eingelesen.'}
        </p>
        <ModusWahl modus={ergaenzung.doc.modus} onChange={ergaenzung.setModus} disabled={!canWrite} />
      </div>

      {ergaenzung.doc.modus === 'aufgeteilt' && hasOhneEtappe && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Es gibt Gebäude ohne Etappen-Zuordnung — die fliessen in dieser Ansicht nicht ein.
            Bitte in „Mengen und Erträge" einer Etappe zuordnen.
          </span>
        </div>
      )}

      {ergaenzung.doc.modus === 'aufgeteilt' && bloecke.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
          Keine Etappen mit Gebäuden erfasst — dafür braucht es Etappen in „Mengen und Erträge".
        </div>
      )}

      {/* ══ Datenerfassung ═══════════════════════════════════════════════ */}
      <UnterKapitel titel="Datenerfassung" icon={ClipboardList} defaultExpanded>
        <div className="space-y-8">
          {bloecke.map((block) => (
            <DatenerfassungBlock
              key={block.key || 'gesamt'}
              block={block}
              mehrere={bloecke.length > 1}
              project={project}
              variantName={variant?.name ?? null}
              row={importe.row(block.key)}
              canWrite={canWrite}
              onSave={(parsed, name) => importe.save(block.key, parsed, name)}
              onRemove={() => importe.remove(block.key)}
            />
          ))}
        </div>
      </UnterKapitel>

      {/* ══ Kostenberechnung ═════════════════════════════════════════════ */}
      <UnterKapitel titel="Kostenberechnung" icon={Coins} defaultExpanded>
        {laedt ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Wird geladen…
          </div>
        ) : (
          <div className="space-y-8">
            {bloecke.map((block) => {
              const imp = importe.imp(block.key)
              return (
                <div key={block.key || 'gesamt'} className="space-y-3">
                  {bloecke.length > 1 && <BlockKopf block={block} />}
                  {imp ? (
                    <ImportErgebnis
                      imp={imp}
                      erg={ergaenzung.kennwerte(block.key)}
                      bezug={block.bezug}
                      canWrite={canWrite}
                      onSetFeld={(feld, wert) => ergaenzung.setFeld(block.key, feld, wert)}
                    />
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                      Noch kein Ergebnis-Excel eingelesen — die Kostenberechnung erscheint hier,
                      sobald der Import unter „Datenerfassung" erfolgt ist.
                    </div>
                  )}
                </div>
              )
            })}

            {/* Gesamttotal über alle Blöcke — nur bei Aufteilung sinnvoll. */}
            {bloecke.length > 1 && gesamt.mitImport > 0 && (
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-3 text-sm font-medium text-slate-700">Anlagekosten aller Blöcke</h3>
                <div className="flex flex-wrap items-end gap-y-2 rounded-lg text-white" style={{ backgroundColor: TOTAL_COLOR }}>
                  <h4 className="min-w-0 flex-1 px-3 py-3 text-sm font-semibold uppercase tracking-wider">
                    Gesamttotal
                  </h4>
                  <Summe label="exkl. MWST" wert={gesamt.netto} fett />
                  <Summe label="MwSt" wert={gesamt.brutto - gesamt.netto} />
                  <Summe label="inkl. MWST" wert={gesamt.brutto} fett />
                  <Summe label="CHF/m² GF" wert={gesamt.gfM2 > 0 ? gesamt.brutto / gesamt.gfM2 : 0} />
                </div>
                {gesamt.mitImport < bloecke.length && (
                  <p className="mt-2 text-xs text-amber-700">
                    {bloecke.length - gesamt.mitImport} von {bloecke.length} Blöcken haben noch kein
                    Ergebnis-Excel — das Total umfasst bis dahin nur die eingelesenen.
                  </p>
                )}
              </section>
            )}
          </div>
        )}
      </UnterKapitel>
    </div>
  )
}

// ── Erfassungstiefe ──────────────────────────────────────────────────────────

function ModusWahl({
  modus, onChange, disabled,
}: {
  modus: KeeValueModus
  onChange: (m: KeeValueModus) => void
  disabled: boolean
}) {
  const optionen: { key: KeeValueModus; label: string; titel: string }[] = [
    { key: 'total', label: 'Gesamt', titel: 'Ein keeValue-Ergebnis für die ganze Variante' },
    { key: 'aufgeteilt', label: 'Nach Etappe & Nutzungsart', titel: 'Ein keeValue-Ergebnis je Etappe und Nutzungsart' },
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

/** Farbige Kopfleiste eines Blocks — Farbe der Nutzungsart, sonst neutral. */
function BlockKopf({ block }: { block: KostenBlock }) {
  const farbe = block.eig ? EIGENTUMSART_COLOR[block.eig] : TOTAL_COLOR
  return (
    <div
      className={cn('rounded-lg px-3 py-2.5 text-sm font-semibold', block.eig ? 'text-slate-900' : 'text-white')}
      style={{ backgroundColor: farbe }}
    >
      {block.titel}
    </div>
  )
}

function Summe({ label, wert, fett = false }: { label: string; wert: number; fett?: boolean }) {
  return (
    <div className="w-36 shrink-0 px-3 py-3 text-right tabular-nums">
      <div className="text-[9px] uppercase leading-4 tracking-wider text-white/70">{label}</div>
      <div className={cn('text-base leading-6', fett && 'font-bold')}>{formatNumber(Math.round(wert))}</div>
    </div>
  )
}

// ── Datenerfassung eines Blocks ──────────────────────────────────────────────

/**
 * Mengendaten, Tool-Öffner und Excel-Import für einen Block. Der Importzustand
 * (Ladebalken, Fehler, Erfolgsmeldung) lebt hier lokal, damit sich mehrere
 * Blöcke nicht gegenseitig überschreiben.
 */
function DatenerfassungBlock({
  block, mehrere, project, variantName, row, canWrite, onSave, onRemove,
}: {
  block: KostenBlock
  /** Bei mehreren Blöcken bekommt jeder eine Kopfleiste. */
  mehrere: boolean
  project: Project | null
  variantName: string | null
  row: VariantKeeValueImport | null
  canWrite: boolean
  onSave: (parsed: KeeValueImport, fileName: string) => Promise<void>
  onRemove: () => void
}) {
  const felder = useMemo<KeeFeld[]>(
    () => keeValueFelder(
      block.gebaeude, block.bezug.gsfTotal, project, variantName, mehrere ? block.titel : null),
    [block, project, variantName, mehrere],
  )

  const oeffneKeeValue = useCallback(() => {
    const availW = window.screen.availWidth
    const availH = window.screen.availHeight
    const breite = Math.floor(availW / 2)
    const features = `popup=yes,width=${breite},height=${availH},left=${availW - breite},top=0,noopener,noreferrer`
    window.open(KEEVALUE_URL, 'keevalue', features)
  }, [])

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
      await onSave(parsed, file.name)
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
  }, [onSave])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void verarbeite(file)
  }, [verarbeite])

  return (
    <div className="space-y-3">
      {mehrere && <BlockKopf block={block} />}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Links: Werte aus dem Businessplan ──────────────────────────── */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-1 flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-medium text-slate-700">Daten für keeValue</h3>
          </div>
          <p className="mb-4 text-xs text-slate-500">
            {mehrere
              ? 'Werte dieses Blocks, in der Reihenfolge des keeValue-Eingabeformulars.'
              : 'Werte aus dem Mengengerüst dieser Variante, in der Reihenfolge des keeValue-Eingabeformulars.'}
          </p>

          <dl className="divide-y divide-slate-100">
            {felder.map((f) => (
              <FeldZeile key={f.label} feld={f} />
            ))}
          </dl>
        </section>

        {/* ── Rechts: Tool öffnen und Ergebnis einlesen ───────────────────── */}
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
                    onClick={onRemove}
                    className="ml-auto inline-flex items-center gap-1 text-slate-400 transition hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Import entfernen
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

// ── Kapitel innerhalb der keeValue-Methode ───────────────────────────────────

/**
 * Aufklappbares Unterkapitel mit Kupfer-Kopfleiste — eine Stufe heller als der
 * Kupfer-7-Header der Anlagekosten, damit die Hierarchie ablesbar bleibt.
 */
function UnterKapitel({
  titel, icon: Icon, defaultExpanded = false, children,
}: {
  titel: string
  icon: typeof Coins
  defaultExpanded?: boolean
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{ backgroundColor: CI.kupfer[5] }}
        className="flex w-full items-center gap-2 px-5 py-3 text-sm font-semibold text-slate-900 transition hover:brightness-95"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-slate-700" /> : <ChevronRight className="h-4 w-4 text-slate-700" />}
        <Icon className="h-4 w-4 text-slate-700" />
        <span>{titel}</span>
      </button>
      {expanded && <div className="p-5">{children}</div>}
    </section>
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

// ── Eine Zeile der Kostenberechnung ──────────────────────────────────────────

function KostenZeile({
  zeile: z, canWrite, onSetFeld, klapp,
}: {
  zeile: AnlagekostenZeile
  canWrite: boolean
  onSetFeld: (feld: keyof ErgaenzungDoc, wert: number | null) => void
  /** Nur auf der Zeile, die Unterpositionen führt (BKP 2). */
  klapp?: { offen: boolean; anzahl: number; onToggle: () => void }
}) {
  const unter = z.ebene === 1
  const eingebbar = z.quelle === 'ergaenzung' && z.feld != null

  return (
    <tr className={cn('border-b border-slate-50', unter && 'italic text-slate-500')}>
      {/* Unterpositionen stehen bündig zu den Hauptgruppen — sie heben sich
          allein durch die hellere Schrift ab, nicht durch Einzug. */}
      <td className="py-1.5 pr-3 tabular-nums text-slate-500">{z.code}</td>
      <td className={cn('py-1.5 pr-3', !unter && 'font-medium text-slate-800')}>
        {klapp ? (
          // Der Chevron sitzt absolut im Zwischenraum zur BKP-Spalte, damit die
          // Bezeichnung in einer Flucht mit den übrigen Zeilen bleibt.
          <button
            type="button"
            onClick={klapp.onToggle}
            aria-expanded={klapp.offen}
            className="relative inline-flex items-center gap-1.5 transition hover:text-slate-950"
          >
            <span className="absolute -left-4 top-1/2 -translate-y-1/2 text-slate-400">
              {klapp.offen
                ? <ChevronDown className="h-3.5 w-3.5" />
                : <ChevronRight className="h-3.5 w-3.5" />}
            </span>
            {z.label}
            {!klapp.offen && (
              <span className="text-xs font-normal text-slate-400">
                ({klapp.anzahl} Positionen)
              </span>
            )}
          </button>
        ) : z.label}
      </td>

      {/* Ansatz: Eingabefeld plus die Bezugsgrösse im Klartext. */}
      <td className="py-1.5 pr-4 whitespace-nowrap">
        {eingebbar ? (
          <span className="inline-flex items-baseline gap-1.5">
            <AnsatzEingabe
              wert={z.ansatzWert ?? null}
              einheit={z.ansatzEinheit ?? '%'}
              disabled={!canWrite}
              onCommit={(v) => onSetFeld(z.feld!, v)}
            />
            <span className="text-xs text-slate-400">{z.ansatzBasis}</span>
          </span>
        ) : z.fremdKennwert ? (
          <span className="text-xs text-slate-400">{z.fremdKennwert}</span>
        ) : null}
      </td>

      <td className="py-1.5 pr-3 text-right tabular-nums">{formatCurrency(z.netto)}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{formatCurrency(z.brutto)}</td>
      <td className="py-1.5 text-right tabular-nums text-slate-500">
        {z.chfProM2Gf != null ? formatNumber(Math.round(z.chfProM2Gf)) : '—'}
      </td>
    </tr>
  )
}

// ── Darstellung des importierten Ergebnisses ─────────────────────────────────

function ImportErgebnis({
  imp, erg, bezug, canWrite, onSetFeld,
}: {
  imp: ReturnType<typeof parseKeeValueXlsx>
  erg: ErgaenzungDoc
  bezug: AnlagekostenBezug
  canWrite: boolean
  onSetFeld: (feld: keyof ErgaenzungDoc, wert: number | null) => void
}) {
  // Vollständige Anlagekosten: die keeValue-Hauptgruppen (Honorare als 6,
  // Unterpositionen eingerückt unter BKP 2) plus die hier erfassten
  // Hauptgruppen 0, 7, 8 und die Eigentümerkosten in 9.
  const { zeilen, totalNetto, totalBrutto, bezugsGfM2 } = anlagekostenZeilen(imp, erg, bezug)

  // Unterpositionen von BKP 2 — offen, damit sich am Bisherigen nichts ändert.
  const [unterOffen, setUnterOffen] = useState(true)
  const anzahlUnter = zeilen.filter((z) => z.ebene === 1).length

  // keeValue rundet seine Zeilen einzeln; die Summe der importierten
  // Hauptgruppen kann deshalb um wenige Franken vom ausgewiesenen Total
  // abweichen. Wir weisen die Differenz aus, statt sie stillschweigend zu glätten.
  const summeKeeValue = zeilen
    .filter((z) => z.ebene === 0 && z.quelle === 'keevalue')
    .reduce((s, z) => s + z.netto, 0)
  const differenz = summeKeeValue - imp.totalNetto

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-medium text-slate-700">Anlagekosten</h3>
        <p className="mb-3 mt-0.5 text-xs text-slate-500">
          BKP 1–6 aus keeValue — die Position 29 „Honorare" ist aus BKP 2 herausgelöst und bildet
          die Hauptgruppe 6. BKP 0, 7, 8, die Reserve und die Eigentümerkosten in 9 werden über den
          Ansatz erfasst; die Prozentsätze rechnen auf den Netto-Beträgen.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3 font-medium">BKP</th>
                <th className="py-2 pr-3 font-medium">Bezeichnung</th>
                <th className="py-2 pr-4 font-medium">Ansatz</th>
                <th className="py-2 pr-3 text-right font-medium">exkl. MwSt.</th>
                <th className="py-2 pr-3 text-right font-medium">inkl. MwSt.</th>
                <th className="py-2 text-right font-medium">
                  CHF/m² GF
                  {bezugsGfM2 != null && (
                    <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">
                      ({formatNumber(bezugsGfM2)} m²)
                    </span>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {zeilen
                .filter((z) => z.ebene === 0 || unterOffen)
                .map((z) => (
                  <KostenZeile
                    key={`${z.quelle}-${z.code}-${z.label}`}
                    zeile={z}
                    canWrite={canWrite}
                    onSetFeld={onSetFeld}
                    klapp={z.code === '2' && z.ebene === 0 && anzahlUnter > 0
                      ? { offen: unterOffen, anzahl: anzahlUnter, onToggle: () => setUnterOffen((o) => !o) }
                      : undefined}
                  />
                ))}
              <tr className="border-t-2 border-slate-300 font-semibold">
                <td className="py-2 pr-3" colSpan={3}>Anlagekosten</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(totalNetto)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(totalBrutto)}</td>
                <td className="py-2 text-right tabular-nums">
                  {bezugsGfM2 ? formatNumber(Math.round(totalBrutto / bezugsGfM2)) : '—'}
                </td>
              </tr>
              <tr className="text-xs text-slate-400">
                <td className="pt-1 pr-3" colSpan={3}>davon Erstellungskosten keeValue</td>
                <td className="pt-1 pr-3 text-right tabular-nums">{formatCurrency(imp.totalNetto)}</td>
                <td className="pt-1 pr-3 text-right tabular-nums">{formatCurrency(imp.totalBrutto)}</td>
                <td className="pt-1 text-right tabular-nums">
                  {bezugsGfM2 ? formatNumber(Math.round(imp.totalBrutto / bezugsGfM2)) : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-slate-400">
          BKP 3 Betriebseinrichtungen deckt weder keeValue noch diese Ergänzung ab — falls nötig,
          über den Detailkatalog erfassen. Ohne MwSt gerechnet werden Grundstück und
          Eigentümerkosten, analog den Katalogpositionen 010 und 910/920.
        </p>

        {Math.abs(differenz) >= 1 && (
          <p className="mt-2 text-xs text-slate-400">
            Rundungsdifferenz aus keeValue: Summe der Zeilen {formatCurrency(summeKeeValue)} gegenüber
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
    </div>
  )
}
