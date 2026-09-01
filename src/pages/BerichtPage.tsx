import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download, Loader2, Minus, Plus, MoveHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useBericht } from '@/contexts/BerichtContext'
import { VariantDataProvider } from '@/contexts/VariantDataContext'
import { useUebersichtDaten } from '@/components/bericht/uebersichtDaten'
import { useMengenDaten } from '@/components/bericht/mengenDaten'
import { useNutzungDaten } from '@/components/bericht/nutzungDaten'
import { useProjectPhotos } from '@/hooks/useProjectPhotos'
import { useProjectGisScreenshots } from '@/hooks/useProjectGisScreenshots'
import { fetchVariant } from '@/hooks/useVariants'
import { supabase } from '@/lib/supabase'
// Nur der Typ statisch — die Komponenten ziehen @react-pdf nach sich und
// werden deshalb erst hier auf der Seite geladen.
import { berichtSeitenplan, type BerichtDaten } from '@/components/bericht/BerichtDokument'
import {
  PHASE_LABEL, projectAddressLine, type GisKategorie,
  type Project, type ProjectVariant, type Customer, type Parcel, type ExistingBuilding,
  type ZoneRegulation,
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
  // Planausschnitte nach Thema: die Projektübersicht zeigt die amtliche
  // Vermessung, die Nutzungsberechnung den Zonenplan. Fehlt das Thema, tritt
  // der erste Ausschnitt an seine Stelle — besser ein Plan als keiner.
  const { items: gisBilder } = useProjectGisScreenshots(projektId)
  const gisNach = useCallback(
    (k: GisKategorie) => gisBilder.find((b) => b.kategorie === k) ?? gisBilder[0] ?? null,
    [gisBilder],
  )
  const situationsplan = gisNach('amtliche_vermessung')
  const zonenplan = gisNach('zonenplan')

  const [project, setProject] = useState<Project | null>(null)
  const [kunde, setKunde] = useState<Customer | null>(null)
  const [variant, setVariant] = useState<ProjectVariant | null>(null)
  const [parzellen, setParzellen] = useState<Parcel[]>([])
  const [zonen, setZonen] = useState<ZoneRegulation[]>([])
  const [bestand, setBestand] = useState<ExistingBuilding[]>([])
  const [laedt, setLaedt] = useState(true)

  useEffect(() => {
    let abgebrochen = false
    async function laden() {
      if (!projektId || !variantId) return
      const [p, v, pz, eb, zr] = await Promise.all([
        // Kunde vollständig, weil das Titelblatt Adresse und Ort braucht.
        supabase.from('projects').select('*, customer:customers(*)').eq('id', projektId).maybeSingle(),
        fetchVariant(variantId),
        supabase.from('parcels').select('*').eq('project_id', projektId),
        supabase.from('existing_buildings').select('*').eq('project_id', projektId),
        // Zonenvorschriften für die Nutzungsberechnung.
        supabase.from('zone_regulations').select('*').eq('project_id', projektId),
      ])
      if (abgebrochen) return
      const projekt = (p.data as (Project & { customer?: Customer | null }) | null) ?? null
      setProject(projekt)
      setKunde(projekt?.customer ?? null)
      setVariant(v)
      setParzellen((pz.data as Parcel[] | null) ?? [])
      setBestand((eb.data as ExistingBuilding[] | null) ?? [])
      setZonen((zr.data as ZoneRegulation[] | null) ?? [])
      setLaedt(false)
    }
    void laden()
    return () => { abgebrochen = true }
  }, [projektId, variantId])

  const thumbnail = photos.find((p) => p.id === thumbnailPhotoId) ?? photos[0] ?? null
  const adresse = project ? projectAddressLine(project) : null

  const mengen = useMengenDaten(variantId, umfang)
  const nutzung = useNutzungDaten(project, parzellen, zonen, zonenplan?.publicUrl ?? null)

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
      nutzung,
    }
  }, [project, variant, adresse, thumbnail, druckKapitel, anrede, umfang, kunde,
      uebersicht, mengen, nutzung])

  // ── Sprungnavigation ───────────────────────────────────────────────────────
  // Die Vorschau ist ein PDF-Betrachter; angesprungen wird über die Seitenzahl.
  const kapitelSprung = useMemo(() => (daten ? berichtSeitenplan(daten) : []), [daten])
  const [zielSeite, setZielSeite] = useState(1)

  // Vergrösserung nur der Vorschau. Der Browser-Zoom skaliert die ganze
  // Anwendung mit; hier soll das Dokument allein wachsen.
  const [zoom, setZoom] = useState<number | 'breite'>('breite')
  const zoomStufen = [50, 75, 100, 125, 150, 200, 300]
  const zoomSchritt = (richtung: 1 | -1) => setZoom((z) => {
    const jetzt = z === 'breite' ? 100 : z
    const i = zoomStufen.indexOf(jetzt)
    const naechste = zoomStufen[(i < 0 ? zoomStufen.indexOf(100) : i) + richtung]
    return naechste ?? jetzt
  })

  // Ändert sich die Kapitelauswahl, verschieben sich die Seitenzahlen — die
  // gemerkte Zielseite passt dann nicht mehr.
  useEffect(() => { setZielSeite(1) }, [druckKapitel, umfang])

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

      {kapitelSprung.length > 0 && (
        <nav className="-mt-1 flex flex-wrap items-center gap-1">
          {kapitelSprung.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => setZielSeite(k.seite)}
              title={`Seite ${k.seite}`}
              className={cn(
                'rounded-lg px-2.5 py-1 text-xs font-medium transition',
                zielSeite === k.seite
                  ? 'bg-[#8B6956] text-white'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50',
              )}
            >
              {k.label}
              <span className="ml-1.5 opacity-60">{k.seite}</span>
            </button>
          ))}

          <span className="ml-auto inline-flex items-center gap-0.5 rounded-lg bg-white p-0.5 ring-1 ring-slate-200">
            <button
              type="button"
              onClick={() => setZoom('breite')}
              title="Auf Fensterbreite"
              className={cn('rounded-md p-1 transition',
                zoom === 'breite' ? 'bg-[#8B6956] text-white' : 'text-slate-500 hover:bg-slate-100')}
            >
              <MoveHorizontal className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => zoomSchritt(-1)}
              title="Verkleinern"
              className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-10 text-center text-[11px] tabular-nums text-slate-500">
              {zoom === 'breite' ? 'Breite' : `${zoom} %`}
            </span>
            <button
              type="button"
              onClick={() => zoomSchritt(1)}
              title="Vergrössern"
              className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </span>
        </nav>
      )}

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
            <BerichtVorschau daten={daten} seite={zielSeite} zoom={zoom} onZoom={setZoom} />
          </Suspense>
        )}
      </div>
    </div>
  )
}
