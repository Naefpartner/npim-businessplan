import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft, FileText, Printer, Save, Trash2, Loader2, AlertCircle, Check,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import { useBerichtVorlagen } from '@/hooks/useBerichtVorlagen'
import { useProjectPhotos } from '@/hooks/useProjectPhotos'
import { fetchVariant } from '@/hooks/useVariants'
import { supabase } from '@/lib/supabase'
import {
  BERICHT_KAPITEL, FIXE_KAPITEL, sortiereKapitel,
} from '@/lib/bericht'
// Nur der Typ statisch — die Komponente zieht @react-pdf nach sich und wird
// deshalb erst beim Drucken geladen (siehe drucken()).
import type { BerichtDaten } from '@/components/bericht/BerichtDokument'
import { PRIMARY_DARK, PRIMARY_LIGHT } from '@/lib/ci'
import { cn } from '@/lib/utils'
import {
  PHASE_LABEL, projectAddressLine,
  type Project, type ProjectVariant, type BerichtVorlage,
} from '@/types'

/** Vorauswahl für einen neuen Bericht — alles ausser den Spezialkapiteln. */
const STANDARD_AUSWAHL = [
  'projektuebersicht', 'stammdaten', 'mengengeruest', 'anlagekosten', 'wirtschaftlichkeit',
]

/**
 * Zusammenstellung und Ausgabe des Businessplan-Berichts einer Variante.
 *
 * Die Kapitelauswahl lässt sich als projektübergreifende Vorlage sichern
 * (Migration 063), damit wiederkehrende Berichtstypen nicht jedes Mal neu
 * zusammengeklickt werden müssen.
 */
export function BerichtPage() {
  const { projektId, id: variantId } = useParams<{ projektId: string; id: string }>()
  const { canWrite } = useAuth()
  const { vorlagen, loading: vorlagenLaden, speichern, loeschen } = useBerichtVorlagen()
  const { photos, thumbnailPhotoId } = useProjectPhotos(projektId)

  const [project, setProject] = useState<Project | null>(null)
  const [variant, setVariant] = useState<ProjectVariant | null>(null)
  const [laden, setLaden] = useState(true)

  useEffect(() => {
    let abgebrochen = false
    async function laden() {
      if (!projektId || !variantId) return
      const [p, v] = await Promise.all([
        supabase.from('projects').select('*, customer:customers(id, name)').eq('id', projektId).maybeSingle(),
        fetchVariant(variantId),
      ])
      if (abgebrochen) return
      setProject((p.data as Project | null) ?? null)
      setVariant(v)
      setLaden(false)
    }
    void laden()
    return () => { abgebrochen = true }
  }, [projektId, variantId])

  // ── Kapitelauswahl ─────────────────────────────────────────────────────────
  const [auswahl, setAuswahl] = useState<string[]>(STANDARD_AUSWAHL)
  const [aktiveVorlage, setAktiveVorlage] = useState<BerichtVorlage | null>(null)

  const umschalten = useCallback((key: string) => {
    setAuswahl((a) => (a.includes(key) ? a.filter((k) => k !== key) : sortiereKapitel([...a, key])))
    setAktiveVorlage(null) // ab jetzt weicht die Auswahl von der Vorlage ab
  }, [])

  const vorlageLaden = useCallback((v: BerichtVorlage | null) => {
    setAktiveVorlage(v)
    if (v) setAuswahl(sortiereKapitel(v.kapitel))
  }, [])

  // ── Vorlage sichern ────────────────────────────────────────────────────────
  const [name, setName] = useState('')
  const [speicherFehler, setSpeicherFehler] = useState<string | null>(null)
  const [gesichert, setGesichert] = useState(false)
  const [speichertGerade, setSpeichertGerade] = useState(false)

  const sichern = useCallback(async () => {
    setSpeicherFehler(null)
    setSpeichertGerade(true)
    try {
      const v = await speichern(name, auswahl)
      if (v) {
        setAktiveVorlage(v)
        setName('')
        setGesichert(true)
        window.setTimeout(() => setGesichert(false), 3000)
      }
    } catch (e) {
      setSpeicherFehler(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.')
    } finally {
      setSpeichertGerade(false)
    }
  }, [speichern, name, auswahl])

  // Kapitel in Druckreihenfolge, inklusive Titelblatt und Inhaltsverzeichnis.
  const druckKapitel = useMemo(
    () => sortiereKapitel([...FIXE_KAPITEL, ...auswahl]),
    [auswahl],
  )

  const thumbnail = photos.find((p) => p.id === thumbnailPhotoId) ?? photos[0] ?? null
  const adresse = project ? projectAddressLine(project) : null

  // ── Ausgabe ────────────────────────────────────────────────────────────────
  const [druckt, setDruckt] = useState(false)
  const [druckFehler, setDruckFehler] = useState<string | null>(null)

  const drucken = useCallback(async () => {
    if (!project || !variant) return
    setDruckFehler(null)
    setDruckt(true)
    try {
      // @react-pdf und das Dokument erst hier laden — zusammen rund 1.5 MB,
      // die den Rest der Anwendung nicht belasten sollen.
      const [{ pdf }, { BerichtDokument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/bericht/BerichtDokument'),
      ])
      const daten: BerichtDaten = {
        projektName: project.name,
        adresse,
        dokumentBezeichnung: 'Businessplan',
        untertitel: `${variant.name} · ${PHASE_LABEL[variant.phase]}`,
        auftraggeberin: [project.customer?.name ?? '—'].filter(Boolean),
        datum: new Date(),
        titelbildUrl: thumbnail?.publicUrl ?? null,
        kapitel: druckKapitel,
      }
      const blob = await pdf(<BerichtDokument daten={daten} />).toBlob()
      // In neuem Tab öffnen statt herunterladen — so lässt sich der Bericht
      // ansehen und von dort drucken oder sichern.
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      // Der Tab hält die Blob-URL; nach kurzer Frist freigeben.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      setDruckFehler(e instanceof Error ? e.message : 'Der Bericht konnte nicht erzeugt werden.')
    } finally {
      setDruckt(false)
    }
  }, [project, variant, adresse, thumbnail, druckKapitel])

  if (laden) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Wird geladen…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link
        to={`/projekte/${projektId}/varianten/${variantId}`}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Zurück zur Variante
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <FileText className="h-5 w-5 text-slate-400" />
            Bericht
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {project?.name}
            {adresse && <> · {adresse}</>}
            {variant && <> · {variant.name} · {PHASE_LABEL[variant.phase]}</>}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Button type="button" className="gap-2" onClick={() => void drucken()} disabled={druckt}>
            {druckt ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            Bericht drucken
          </Button>
          {druckFehler && (
            <span className="max-w-xs text-right text-xs text-red-700">{druckFehler}</span>
          )}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        {/* ── Kapitelauswahl ──────────────────────────────────────────── */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-medium text-slate-700">Kapitel für den Druck</h2>
          <p className="mb-4 mt-0.5 text-xs text-slate-500">
            Titelblatt und Inhaltsverzeichnis sind immer dabei. Die Reihenfolge im Bericht folgt
            dieser Liste, unabhängig von der Reihenfolge des Anwählens.
          </p>

          <ul className="divide-y divide-slate-100">
            {BERICHT_KAPITEL.map((k) => {
              const gewaehlt = k.fix || auswahl.includes(k.key)
              return (
                <li key={k.key}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-start gap-3 py-2.5',
                      k.fix && 'cursor-default',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={gewaehlt}
                      disabled={k.fix}
                      onChange={() => umschalten(k.key)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-[#8B6956] disabled:opacity-50"
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-800">{k.label}</span>
                        {k.fix && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                            immer
                          </span>
                        )}
                        {k.format && k.format !== 'a4' && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                            {k.format === 'a3' ? 'A3 hoch' : 'A4 quer'}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">{k.beschrieb}</span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>

          <p className="mt-4 text-xs text-slate-400">
            {druckKapitel.length} Kapitel im Bericht
            {thumbnail
              ? ' · Titelbild aus der Projektgalerie'
              : ' · kein Projektbild hinterlegt, die Titelfläche bleibt einfarbig'}
          </p>
        </section>

        {/* ── Vorlagen ────────────────────────────────────────────────── */}
        <section className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-medium text-slate-700">Vordefinierte Berichte</h2>
            <p className="mb-3 mt-0.5 text-xs text-slate-500">
              Gelten in allen Projekten und für alle Benutzer.
            </p>

            {vorlagenLaden ? (
              <div className="flex items-center gap-2 py-3 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Wird geladen…
              </div>
            ) : vorlagen.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
                Noch keine Vorlage gesichert.
              </p>
            ) : (
              <ul className="space-y-1">
                {vorlagen.map((v) => {
                  const aktiv = aktiveVorlage?.id === v.id
                  return (
                    <li key={v.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => vorlageLaden(v)}
                        style={aktiv ? { backgroundColor: PRIMARY_LIGHT, color: PRIMARY_DARK } : undefined}
                        className={cn(
                          'flex-1 rounded-lg px-3 py-2 text-left text-sm transition',
                          aktiv ? 'font-medium' : 'text-slate-700 hover:bg-slate-50',
                        )}
                      >
                        {v.name}
                        <span className="ml-2 text-xs text-slate-400">
                          {v.kapitel.length} Kapitel
                        </span>
                      </button>
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => void loeschen(v.id)}
                          title="Vorlage löschen"
                          className="rounded p-1.5 text-slate-300 transition hover:bg-slate-100 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {canWrite && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-medium text-slate-700">Auswahl sichern</h2>
              <p className="mb-3 mt-0.5 text-xs text-slate-500">
                Ein bestehender Name überschreibt die Vorlage.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) void sichern() }}
                  placeholder="z.B. Machbarkeitsstudie kurz"
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-slate-400 focus:outline-none"
                />
                <Button
                  type="button"
                  onClick={() => void sichern()}
                  disabled={!name.trim() || speichertGerade}
                  className="gap-1.5 shrink-0"
                >
                  {speichertGerade
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : gesichert ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                  Sichern
                </Button>
              </div>
              {speicherFehler && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{speicherFehler}</span>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
