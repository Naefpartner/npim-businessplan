import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useBericht } from '@/contexts/BerichtContext'
import { VariantDataProvider } from '@/contexts/VariantDataContext'
import { useUebersichtDaten } from '@/components/bericht/uebersichtDaten'
import { useMengenDaten } from '@/components/bericht/mengenDaten'
import { useProjectPhotos } from '@/hooks/useProjectPhotos'
import { useProjectGisScreenshots } from '@/hooks/useProjectGisScreenshots'
import { fetchVariant } from '@/hooks/useVariants'
import { supabase } from '@/lib/supabase'
// Nur der Typ statisch — die Komponenten ziehen @react-pdf nach sich und
// werden deshalb erst hier auf der Seite geladen.
import type { BerichtDaten } from '@/components/bericht/BerichtDokument'
import {
  PHASE_LABEL, projectAddressLine,
  type Project, type ProjectVariant, type Customer, type Parcel, type ExistingBuilding,
} from '@/types'

/**
 * Der Auftraggeber-Block der Vorlage: Name, darunter Strasse mit Nummer,
 * darunter Postleitzahl und Ort. Leere Felder fallen weg, damit keine
 * angefangenen Zeilen stehen bleiben.
 */
function kundenZeilen(kunde: Customer | null): string[] {
  if (!kunde) return ['—']
  const strasse = [kunde.strasse, kunde.hausnummer].filter(Boolean).join(' ').trim()
  const ort = [kunde.plz, kunde.ort].filter(Boolean).join(' ').trim()
  return [kunde.name, strasse, ort].filter(Boolean)
}

const BerichtVorschau = lazy(() => import('@/components/bericht/BerichtVorschau'))

/**
 * Berichtsseite: das Hauptfenster zeigt die Vorschau des Dokuments, die
 * Kapitelauswahl und die Vorlagen sitzen in der Sidebar (BerichtSidebarPanel).
 */
/**
 * Rahmen der Berichtsseite. Der Inhalt liegt im VariantDataProvider, weil die
 * Fachkapitel Mengen und Anlagekosten der Variante brauchen — und zwar
 * dieselben, die auch die Reiter der Variante zeigen.
 */
export function BerichtPage() {
  const { projektId, id: variantId } = useParams<{ projektId: string; id: string }>()
  if (!variantId) return null
  return (
    <VariantDataProvider projectId={projektId} variantId={variantId}>
      <BerichtInhalt projektId={projektId} variantId={variantId} />
    </VariantDataProvider>
  )
}

function BerichtInhalt({ projektId, variantId }: { projektId?: string; variantId: string }) {
  const { druckKapitel, anrede, umfang } = useBericht()
  const { photos, thumbnailPhotoId } = useProjectPhotos(projektId)
  // Erster GIS-Ausschnitt dient als Situationsplan der Projektübersicht.
  const { items: gisBilder } = useProjectGisScreenshots(projektId)
  const situationsplan = gisBilder[0] ?? null

  const [project, setProject] = useState<Project | null>(null)
  const [kunde, setKunde] = useState<Customer | null>(null)
  const [variant, setVariant] = useState<ProjectVariant | null>(null)
  const [parzellen, setParzellen] = useState<Parcel[]>([])
  const [bestand, setBestand] = useState<ExistingBuilding[]>([])
  const [laedt, setLaedt] = useState(true)

  useEffect(() => {
    let abgebrochen = false
    async function laden() {
      if (!projektId || !variantId) return
      const [p, v, pz, eb] = await Promise.all([
        // Kunde vollständig, weil das Titelblatt Adresse und Ort braucht.
        supabase.from('projects').select('*, customer:customers(*)').eq('id', projektId).maybeSingle(),
        fetchVariant(variantId),
        supabase.from('parcels').select('*').eq('project_id', projektId),
        supabase.from('existing_buildings').select('*').eq('project_id', projektId),
      ])
      if (abgebrochen) return
      const projekt = (p.data as (Project & { customer?: Customer | null }) | null) ?? null
      setProject(projekt)
      setKunde(projekt?.customer ?? null)
      setVariant(v)
      setParzellen((pz.data as Parcel[] | null) ?? [])
      setBestand((eb.data as ExistingBuilding[] | null) ?? [])
      setLaedt(false)
    }
    void laden()
    return () => { abgebrochen = true }
  }, [projektId, variantId])

  const thumbnail = photos.find((p) => p.id === thumbnailPhotoId) ?? photos[0] ?? null
  const adresse = project ? projectAddressLine(project) : null

  const mengen = useMengenDaten(umfang)

  const uebersicht = useUebersichtDaten(
    project, variant, parzellen, bestand, situationsplan?.publicUrl ?? null, kunde, anrede)

  const daten = useMemo<BerichtDaten | null>(() => {
    if (!project || !variant) return null
    return {
      projektName: project.name,
      // Titel der Vorlage: Ortschaft, dann der Projektname — ohne Postleitzahl.
      titelZeile: [project.ort, project.name].filter(Boolean).join(', '),
      adresse,
      dokumentBezeichnung: 'Businessplan',
      untertitel: `${variant.name} · ${PHASE_LABEL[variant.phase]}`,
      auftragAnrede: anrede,
      auftraggeberin: kundenZeilen(kunde),
      datum: new Date(),
      titelbildUrl: thumbnail?.publicUrl ?? null,
      kapitel: druckKapitel,
      etappenUmfang: umfang,
      uebersicht,
      mengen,
    }
  }, [project, variant, adresse, thumbnail, druckKapitel, anrede, umfang, kunde,
      uebersicht, mengen])

  // ── Herunterladen ──────────────────────────────────────────────────────────
  const [erzeugt, setErzeugt] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)

  const herunterladen = useCallback(async () => {
    if (!daten) return
    setFehler(null)
    setErzeugt(true)
    try {
      const [{ pdf }, { BerichtDokument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/bericht/BerichtDokument'),
      ])
      const blob = await pdf(<BerichtDokument daten={daten} />).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${daten.projektName} — ${daten.dokumentBezeichnung}.pdf`
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Der Bericht konnte nicht erzeugt werden.')
    } finally {
      setErzeugt(false)
    }
  }, [daten])

  return (
    // Volle Höhe des Hauptbereichs, damit die Vorschau den Platz nutzt.
    <div className="flex h-[calc(100vh-8.5rem)] flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            to={`/projekte/${projektId}/varianten/${variantId}`}
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" /> Zurück zur Variante
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">Bericht</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {project?.name}
            {adresse && <> · {adresse}</>}
            {variant && <> · {variant.name} · {PHASE_LABEL[variant.phase]}</>}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Button
            type="button"
            className="gap-2"
            onClick={() => void herunterladen()}
            disabled={!daten || erzeugt}
          >
            {erzeugt ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            PDF herunterladen
          </Button>
          {fehler && <span className="max-w-xs text-right text-xs text-red-700">{fehler}</span>}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-sm">
        {laedt || !daten ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Wird geladen…
          </div>
        ) : (
          <Suspense fallback={
            <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Vorschau wird aufgebaut…
            </div>
          }>
            <BerichtVorschau daten={daten} />
          </Suspense>
        )}
      </div>
    </div>
  )
}
