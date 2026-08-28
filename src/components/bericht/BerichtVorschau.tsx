import { PDFViewer } from '@react-pdf/renderer'
import { BerichtDokument, type BerichtDaten } from '@/components/bericht/BerichtDokument'

/**
 * Live-Vorschau des Berichts. Eigene Datei, damit sie samt @react-pdf per
 * lazy() nachgeladen wird und den Hauptbundle nicht belastet.
 *
 * `key` auf dem Viewer erzwingt einen Neuaufbau, wenn sich die Kapitelauswahl
 * ändert — ohne das behält der eingebettete Betrachter das alte Dokument.
 */
export default function BerichtVorschau({ daten }: { daten: BerichtDaten }) {
  return (
    <PDFViewer
      key={daten.kapitel.join('|')}
      showToolbar
      style={{ width: '100%', height: '100%', border: 'none' }}
    >
      <BerichtDokument daten={daten} />
    </PDFViewer>
  )
}
