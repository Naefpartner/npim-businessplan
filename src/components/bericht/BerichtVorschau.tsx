import { useEffect, useState } from 'react'
import { pdf } from '@react-pdf/renderer'
import { Loader2 } from 'lucide-react'
import { BerichtDokument, type BerichtDaten } from '@/components/bericht/BerichtDokument'

/**
 * Live-Vorschau des Berichts. Eigene Datei, damit sie samt @react-pdf per
 * lazy() nachgeladen wird und den Hauptbundle nicht belastet.
 *
 * Statt PDFViewer wird das Dokument selbst zu einem Blob gerendert und in einem
 * eigenen iframe angezeigt: nur so lässt sich über den Anker `#page=n` gezielt
 * zu einem Kapitel springen. Der Betrachter liest den Anker beim Laden, deshalb
 * bekommt das iframe einen `key` aus URL, Seite und Vergrösserung — es baut
 * sich neu auf, ohne dass das PDF neu gerendert werden müsste.
 *
 * Vergrössert wird über die Grösse des iframes, nicht über den Anker `#zoom=`:
 * den ignoriert der eingebettete Betrachter. Mit `view=FitH` füllt die Seite
 * immer die Breite des iframes — ein breiteres iframe zeigt sie also grösser,
 * und zwar neu gerendert statt hochskaliert. Der Rahmen darum scrollt. Sidebar
 * und Kopfzeile bleiben dabei, wo sie sind, anders als beim Zoom des Browsers.
 */
export default function BerichtVorschau({
  daten, seite, zoom,
}: {
  daten: BerichtDaten
  seite: number
  /** Vergrösserung in Prozent; 'breite' passt die Seite in die Fensterbreite. */
  zoom: number | 'breite'
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)

  useEffect(() => {
    let abgebrochen = false
    let alt: string | null = null
    async function bauen() {
      try {
        const blob = await pdf(<BerichtDokument daten={daten} />).toBlob()
        if (abgebrochen) return
        alt = URL.createObjectURL(blob)
        setUrl(alt)
        setFehler(null)
      } catch (e) {
        if (!abgebrochen) setFehler(e instanceof Error ? e.message : 'Vorschau fehlgeschlagen.')
      }
    }
    void bauen()
    return () => {
      abgebrochen = true
      if (alt) URL.revokeObjectURL(alt)
    }
  }, [daten])

  if (fehler) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-700">
        {fehler}
      </div>
    )
  }
  if (!url) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Vorschau wird aufgebaut…
      </div>
    )
  }
  const breite = zoom === 'breite' ? '100%' : `${zoom}%`
  return (
    // Waagrecht scrollen, sobald die Seite breiter ist als das Fenster; senkrecht
    // scrollt der Betrachter selbst.
    <div className="h-full w-full overflow-x-auto overflow-y-hidden">
      <iframe
        // Die Vergrösserung gehört in den Schlüssel: `view=FitH` wirkt nur beim
        // Laden. Ohne Neuaufbau behielte der Betrachter seine alte Vergrösserung
        // und die Seite rückte im breiteren Rahmen bloss zur Seite.
        key={`${url}#${seite}#${zoom}`}
        title="Berichtsvorschau"
        src={`${url}#page=${seite}&view=FitH`}
        style={{ width: breite, height: '100%', border: 'none', display: 'block' }}
      />
    </div>
  )
}
