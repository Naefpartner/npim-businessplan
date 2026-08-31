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
 * bekommt das iframe einen `key` aus URL und Seite — es baut sich neu auf, ohne
 * dass das PDF neu gerendert werden müsste.
 */
export default function BerichtVorschau({
  daten, seite,
}: { daten: BerichtDaten; seite: number }) {
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
  return (
    <iframe
      key={`${url}#${seite}`}
      title="Berichtsvorschau"
      src={`${url}#page=${seite}&view=FitH`}
      style={{ width: '100%', height: '100%', border: 'none' }}
    />
  )
}
