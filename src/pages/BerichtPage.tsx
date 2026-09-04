import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft, Download, Loader2, Minus, Plus, MoveHorizontal, SeparatorHorizontal,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useBericht } from '@/contexts/BerichtContext'
import { VariantDataProvider } from '@/contexts/VariantDataContext'
import { useUebersichtDaten } from '@/components/bericht/uebersichtDaten'
import { useMengenDaten } from '@/components/bericht/mengenDaten'
import { useNutzungDaten } from '@/components/bericht/nutzungDaten'
import { useAnlagekostenDaten } from '@/components/bericht/anlagekostenDaten'
import { useProjectPhotos } from '@/hooks/useProjectPhotos'
import { useProjectGisScreenshots } from '@/hooks/useProjectGisScreenshots'
import { fetchVariant } from '@/hooks/useVariants'
import { supabase } from '@/lib/supabase'
// Nur der Typ statisch — die Komponenten ziehen @react-pdf nach sich und
// werden deshalb erst hier auf der Seite geladen.
import {
  berichtSeitenplan, berichtUmbruchPunkte, type BerichtDaten,
} from '@/components/bericht/BerichtDokument'
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
  const { druckKapitel, anrede, umfang, etappenAuswahl } = useBericht()
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

  const mengen = useMengenDaten(variantId, umfang, etappenAuswahl)
  const nutzung = useNutzungDaten(project, parzellen, zonen, zonenplan?.publicUrl ?? null)
  const anlagekosten = useAnlagekostenDaten(variantId)

  const uebersicht = useUebersichtDaten(
    project, variant, parzellen, bestand, situationsplan?.publicUrl ?? null)

  // ── Von Hand gesetzte Seitenumbrüche ───────────────────────────────────────
  // Die Umbruchrechnung füllt die Seiten so weit wie möglich; wo das fachlich
  // Zusammengehörendes trennt, entscheidet die Wahl hier. Sie hängt an der
  // Variante, weil sie an deren Mengen hängt.
  const [umbrueche, setUmbrueche] = useState<string[]>([])
  useEffect(() => { setUmbrueche(variant?.bericht_umbrueche ?? []) }, [variant])
  const [umbruchListe, setUmbruchListe] = useState(false)

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
      anlagekosten,
      umbrueche,
    }
  }, [project, variant, adresse, thumbnail, druckKapitel, anrede, umfang, kunde,
      uebersicht, mengen, nutzung, anlagekosten, umbrueche])

  // ── Sprungnavigation ───────────────────────────────────────────────────────
  // Die Vorschau ist ein PDF-Betrachter; angesprungen wird über die Seitenzahl.
  const kapitelSprung = useMemo(() => (daten ? berichtSeitenplan(daten) : []), [daten])
  // Gemerkt wird das Kapitel, nicht die Seite: ändert sich der Umfang,
  // verschieben sich die Seitenzahlen, und die Vorschau soll trotzdem stehen
  // bleiben, wo man gerade liest.
  const [zielKapitel, setZielKapitel] = useState<string | null>(null)
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

  // Verschieben sich die Seitenzahlen, wandert die Zielseite mit dem Kapitel
  // mit. Fällt das Kapitel weg, bleibt es beim Anfang.
  useEffect(() => {
    if (!zielKapitel) return
    const e = kapitelSprung.find((k) => k.key === zielKapitel)
    setZielSeite(e ? e.seite : 1)
    if (!e) setZielKapitel(null)
  }, [kapitelSprung, zielKapitel])

  // ── Herunterladen ──────────────────────────────────────────────────────────
  const [erzeugt, setErzeugt] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)

  /**
   * Umbruch vor einem Baustein setzen oder aufheben. Erst im Bild, dann in der
   * Datenbank — die Vorschau soll dem Klick sofort folgen.
   */
  const umbruchWechseln = useCallback(async (key: string) => {
    const neu = umbrueche.includes(key)
      ? umbrueche.filter((k) => k !== key)
      : [...umbrueche, key]
    setUmbrueche(neu)
    setFehler(null)
    const { error } = await supabase
      .from('project_variants').update({ bericht_umbrueche: neu }).eq('id', variantId)
    if (error) setFehler(`Der Umbruch konnte nicht gesichert werden: ${error.message}`)
  }, [umbrueche, variantId])

  // Nach Kapitel und Sicht gruppiert, in Druckreihenfolge.
  const umbruchGruppen = useMemo(() => {
    if (!daten) return []
    const gruppen: { kapitel: string; punkte: ReturnType<typeof berichtUmbruchPunkte> }[] = []
    for (const p of berichtUmbruchPunkte(daten)) {
      const letzte = gruppen[gruppen.length - 1]
      if (letzte && letzte.kapitel === p.kapitel) letzte.punkte.push(p)
      else gruppen.push({ kapitel: p.kapitel, punkte: [p] })
    }
    return gruppen
  }, [daten])

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
              onClick={() => { setZielKapitel(k.key); setZielSeite(k.seite) }}
              title={`Seite ${k.seite}`}
              className={cn(
                'rounded-lg px-2.5 py-1 text-xs font-medium transition',
                // Hervorgehoben ist das gewählte Kapitel, nicht die Seitenzahl:
                // beim Umschalten des Umfangs ändert sie sich, das Kapitel nicht.
                (zielKapitel ? zielKapitel === k.key : zielSeite === k.seite)
                  ? 'bg-[#8B6956] text-white'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50',
              )}
            >
              {k.label}
              <span className="ml-1.5 opacity-60">{k.seite}</span>
            </button>
          ))}

          {umbruchGruppen.length > 0 && (
            <button
              type="button"
              onClick={() => setUmbruchListe((z) => !z)}
              title="Seitenumbrüche von Hand setzen"
              className={cn(
                'ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition',
                umbruchListe || umbrueche.length > 0
                  ? 'bg-[#8B6956] text-white'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50',
              )}
            >
              <SeparatorHorizontal className="h-3.5 w-3.5" />
              Umbrüche
              {umbrueche.length > 0 && (
                <span className="opacity-70">{umbrueche.length}</span>
              )}
            </button>
          )}

          <span className={cn(
            'inline-flex items-center gap-0.5 rounded-lg bg-white p-0.5 ring-1 ring-slate-200',
            umbruchGruppen.length === 0 && 'ml-auto',
          )}>
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

      {umbruchListe && umbruchGruppen.length > 0 && (
        <div className="-mt-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="mb-2 text-xs text-slate-500">
            Neue Seite vor diesem Baustein — angeklickt gesetzt, nochmals angeklickt
            aufgehoben. Die Zahl ist die Seite, auf der er gegenwärtig beginnt.
          </p>
          <div className="max-h-44 space-y-2 overflow-y-auto">
            {umbruchGruppen.map((g, i) => (
              <div key={`${g.kapitel}-${i}`} className="flex flex-wrap items-center gap-1">
                <span className="mr-1 w-32 shrink-0 text-xs font-medium text-slate-500">
                  {g.kapitel}
                </span>
                {g.punkte.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => void umbruchWechseln(p.key)}
                    title={p.gesetzt
                      ? 'Umbruch aufheben'
                      : p.obenAufSeite
                        ? 'Steht bereits oben auf der Seite; gesetzt bleibt er auch dann dort.'
                        : 'Neue Seite vor diesem Baustein'}
                    className={cn(
                      'rounded-lg px-2 py-1 text-xs transition',
                      p.gesetzt
                        ? 'bg-[#8B6956] text-white'
                        : cn('bg-slate-50 ring-1 ring-slate-200 hover:bg-slate-100',
                          // Was ohnehin oben steht, muss nicht zum Klick einladen.
                          p.obenAufSeite ? 'text-slate-400' : 'text-slate-700'),
                    )}
                  >
                    {p.label}
                    <span className="ml-1.5 opacity-60">{p.seite}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
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
