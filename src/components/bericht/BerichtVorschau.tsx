import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { pdf } from '@react-pdf/renderer'
import { Loader2 } from 'lucide-react'
// Bewusst der Legacy-Build: der reguläre setzt `Map.prototype.getOrInsertComputed`
// voraus, das noch nicht überall vorhanden ist — Safari bricht damit ab. Der
// Legacy-Build bringt die Ergänzung mit und ist sonst derselbe Code.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { BerichtDokument, type BerichtDaten } from '@/components/bericht/BerichtDokument'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** Grenzen der Vergrösserung in Prozent. */
const ZOOM_MIN = 25
const ZOOM_MAX = 400
/** Breite einer A4-Seite in Punkten — Bezug für den Wechsel von „Breite" zu Prozent. */
const A4_PUNKTE = 595

/**
 * Live-Vorschau des Berichts. Eigene Datei, damit sie samt @react-pdf und
 * pdf.js per lazy() nachgeladen wird und den Hauptbundle nicht belastet.
 *
 * Die Seiten werden selbst auf Leinwände gezeichnet, statt den eingebetteten
 * PDF-Betrachter des Browsers zu verwenden. Der nimmt keine Anweisung zur
 * Vergrösserung entgegen — weder über `#zoom=` noch über `view=FitH` beim
 * Neuladen — und gibt weder Mausrad noch Gesten an die Seite weiter. Selbst
 * gezeichnet liegt beides bei uns: die Knöpfe wirken, und über dem Dokument
 * zoomen Ctrl-Rad und Zwei-Finger-Geste, ohne die Anwendung mitzuskalieren.
 */
export default function BerichtVorschau({
  daten, seite, zoom, onZoom,
}: {
  daten: BerichtDaten
  seite: number
  /** Vergrösserung in Prozent; 'breite' passt die Seite in die Fensterbreite. */
  zoom: number | 'breite'
  onZoom: (z: number) => void
}) {
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [breite, setBreite] = useState(0)
  const rahmen = useRef<HTMLDivElement>(null)
  const leinwaende = useRef<(HTMLCanvasElement | null)[]>([])

  // ── Dokument bauen ─────────────────────────────────────────────────────────
  useEffect(() => {
    let abgebrochen = false
    // Aufgeräumt wird über den Ladeauftrag, nicht über das Dokument: er hält
    // den Worker.
    let auftrag: pdfjs.PDFDocumentLoadingTask | null = null
    async function bauen() {
      try {
        const blob = await pdf(<BerichtDokument daten={daten} />).toBlob()
        const puffer = await blob.arrayBuffer()
        if (abgebrochen) return
        auftrag = pdfjs.getDocument({ data: puffer })
        const offen = await auftrag.promise
        if (abgebrochen) return
        setDoc(offen)
        setFehler(null)
      } catch (e) {
        if (!abgebrochen) setFehler(e instanceof Error ? e.message : 'Vorschau fehlgeschlagen.')
      }
    }
    void bauen()
    return () => {
      abgebrochen = true
      if (auftrag) void auftrag.destroy()
    }
  }, [daten])

  // ── Breite des Rahmens verfolgen (für „auf Fensterbreite") ─────────────────
  useLayoutEffect(() => {
    const el = rahmen.current
    if (!el) return
    const beobachter = new ResizeObserver(() => setBreite(el.clientWidth))
    beobachter.observe(el)
    setBreite(el.clientWidth)
    return () => beobachter.disconnect()
  }, [doc])

  // ── Seiten zeichnen ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!doc || breite === 0) return
    let abgebrochen = false
    const aufgaben: pdfjs.RenderTask[] = []

    async function zeichnen() {
      if (!doc) return
      try {
        for (let n = 1; n <= doc.numPages; n++) {
          const seiteDoc = await doc.getPage(n)
          if (abgebrochen) return
          const roh = seiteDoc.getViewport({ scale: 1 })
          // „Breite" füllt den Rahmen abzüglich des Rands, sonst gilt der
          // Prozentwert bezogen auf die natürliche Grösse.
          const faktor = zoom === 'breite' ? (breite - 28) / roh.width : zoom / 100
          const sicht = seiteDoc.getViewport({ scale: faktor })
          const leinwand = leinwaende.current[n - 1]
          if (!leinwand) continue
          // Auf Bildschirmen mit hoher Pixeldichte doppelt zeichnen, sonst
          // wirkt die Schrift unscharf; die CSS-Grösse bleibt die logische.
          const dichte = Math.min(window.devicePixelRatio || 1, 2)
          leinwand.width = Math.floor(sicht.width * dichte)
          leinwand.height = Math.floor(sicht.height * dichte)
          leinwand.style.width = `${Math.floor(sicht.width)}px`
          leinwand.style.height = `${Math.floor(sicht.height)}px`
          // Nur `canvas` übergeben: pdf.js lässt `canvasContext` daneben nicht
          // zu — der Aufruf bräche ab, und zwar lautlos.
          const aufgabe = seiteDoc.render({
            canvas: leinwand,
            viewport: sicht,
            transform: dichte === 1 ? undefined : [dichte, 0, 0, dichte, 0, 0],
          })
          aufgaben.push(aufgabe)
          try { await aufgabe.promise } catch { /* abgebrochen */ }
          if (abgebrochen) return
        }
      } catch (e) {
        // Sonst bliebe die Fläche leer und man sähe nicht, warum.
        if (!abgebrochen) setFehler(e instanceof Error ? e.message : 'Seite nicht darstellbar.')
      }
    }

    void zeichnen()
    return () => {
      abgebrochen = true
      for (const a of aufgaben) a.cancel()
    }
  }, [doc, zoom, breite])

  // ── Sprung auf ein Kapitel ─────────────────────────────────────────────────
  useEffect(() => {
    const ziel = leinwaende.current[seite - 1]
    if (ziel && rahmen.current) {
      rahmen.current.scrollTo({ top: ziel.offsetTop - 12, behavior: 'smooth' })
    }
  }, [seite, doc, zoom])

  // ── Zoomen mit Ctrl-Rad und Zwei-Finger-Geste ──────────────────────────────
  // Das Trackpad meldet die Geste als Rad-Ereignis mit ctrlKey; ohne
  // preventDefault zoomte der Browser die ganze Anwendung.
  const beiRad = useCallback((e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const jetzt = zoom === 'breite'
      ? Math.round(((breite - 28) / A4_PUNKTE) * 100)
      : zoom
    const naechste = Math.round(jetzt * (e.deltaY < 0 ? 1.1 : 1 / 1.1))
    onZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, naechste)))
  }, [zoom, breite, onZoom])

  useEffect(() => {
    const el = rahmen.current
    if (!el) return
    el.addEventListener('wheel', beiRad, { passive: false })
    return () => el.removeEventListener('wheel', beiRad)
  }, [beiRad])

  if (fehler) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-700">
        {fehler}
      </div>
    )
  }

  return (
    <div ref={rahmen} className="h-full w-full overflow-auto bg-slate-200 p-3.5">
      {!doc && (
        <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Vorschau wird aufgebaut…
        </div>
      )}
      <div className="flex flex-col items-center gap-3">
        {Array.from({ length: doc?.numPages ?? 0 }, (_, i) => (
          <canvas
            key={i}
            ref={(el) => { leinwaende.current[i] = el }}
            className="bg-white shadow-md"
          />
        ))}
      </div>
    </div>
  )
}
