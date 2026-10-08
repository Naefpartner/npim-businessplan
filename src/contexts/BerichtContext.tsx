import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import {
  BERICHT_STANDARD, FIXE_KAPITEL, normalizeBerichtEinstellungen, sortiereKapitel,
  type AuftragAnrede, type BerichtEinstellungen, type EtappenUmfang,
} from '@/lib/bericht'
import type { BerichtVorlage } from '@/types'

interface BerichtWert {
  /** Variante, für die gerade ein Bericht zusammengestellt wird; null ausserhalb. */
  kontext: { projektId: string; variantId: string } | null
  /** Gewählte Fachkapitel (ohne Titelblatt und Inhaltsverzeichnis). */
  auswahl: string[]
  /** Kapitel in Druckreihenfolge, inklusive der fixen. */
  druckKapitel: string[]
  umschalten: (key: string) => void
  /** Geladene Vorlage — null, sobald die Auswahl davon abweicht. */
  aktiveVorlage: BerichtVorlage | null
  vorlageLaden: (v: BerichtVorlage) => void
  vorlageGesetzt: (v: BerichtVorlage) => void
  /** Beschriftung des Auftraggeber-Blocks auf dem Titelblatt. */
  anrede: AuftragAnrede
  setAnrede: (a: AuftragAnrede) => void
  /** Ob Kapitel mit Etappenbezug gesamt, je Etappe oder beides zeigen. */
  umfang: EtappenUmfang
  setUmfang: (u: EtappenUmfang) => void
  /**
   * Ausgewählte Etappen; leer bedeutet alle. Greift nur, wo Etappen gezeigt
   * werden — bei „gesamt" bleibt die Wahl liegen, statt verloren zu gehen.
   */
  etappenAuswahl: string[]
  etappeUmschalten: (id: string) => void
  setEtappenAuswahl: (ids: string[]) => void
  /** Der aktuelle Stand als speicherbares Dokument. */
  einstellungen: BerichtEinstellungen
}

const Ctx = createContext<BerichtWert | null>(null)

/** Erkennt die Berichtsseite und die zugehörige Variante am Pfad. */
function berichtsKontext(pfad: string): { projektId: string; variantId: string } | null {
  const m = pfad.match(/^\/projekte\/([^/]+)\/varianten\/([^/]+)\/bericht$/)
  return m ? { projektId: m[1], variantId: m[2] } : null
}

/**
 * Hält die Kapitelauswahl des Berichts. Liegt im Layout, weil sie von der
 * Sidebar bedient und im Hauptfenster als Vorschau gerendert wird — beide
 * brauchen denselben Zustand.
 *
 * Der Stand wird gemerkt: beim Wechsel auf eine Variante kommt er aus deren
 * `bericht_einstellungen`, jede Änderung geht gesammelt zurück. Wer einen
 * Bericht einmal eingestellt hat, findet ihn beim nächsten Mal so vor.
 */
export function BerichtProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const kontext = useMemo(() => berichtsKontext(pathname), [pathname])
  const variantId = kontext?.variantId ?? null

  const [auswahl, setAuswahl] = useState<string[]>(BERICHT_STANDARD.kapitel)
  const [aktiveVorlage, setAktiveVorlage] = useState<BerichtVorlage | null>(null)
  const [anrede, setAnrede] = useState<AuftragAnrede>(BERICHT_STANDARD.anrede)
  const [umfang, setUmfang] = useState<EtappenUmfang>(BERICHT_STANDARD.umfang)
  const [etappenAuswahl, setEtappenAuswahl] = useState<string[]>(BERICHT_STANDARD.etappen)

  /*
   * Solange geladen wird, darf nichts zurückgeschrieben werden: sonst
   * überschriebe der Vorgabestand, mit dem die Seite aufgeht, den gemerkten,
   * bevor er überhaupt angekommen ist.
   */
  const geladenFuer = useRef<string | null>(null)

  useEffect(() => {
    if (!variantId) { geladenFuer.current = null; return }
    let abgebrochen = false
    geladenFuer.current = null
    void (async () => {
      const { data } = await supabase.from('project_variants')
        .select('bericht_einstellungen').eq('id', variantId).maybeSingle()
      if (abgebrochen) return
      const e = normalizeBerichtEinstellungen(data?.bericht_einstellungen)
      setAuswahl(e.kapitel)
      setAnrede(e.anrede)
      setUmfang(e.umfang)
      setEtappenAuswahl(e.etappen)
      setAktiveVorlage(null)
      geladenFuer.current = variantId
    })()
    return () => { abgebrochen = true }
  }, [variantId])

  const einstellungen = useMemo<BerichtEinstellungen>(
    () => ({ kapitel: auswahl, anrede, umfang, etappen: etappenAuswahl }),
    [auswahl, anrede, umfang, etappenAuswahl],
  )

  /*
   * Zurückschreiben, aber nicht bei jedem Klick: eine halbe Sekunde Ruhe
   * genügt, und beim Durchklicken der Kapitelliste bleibt es bei einem
   * Schreibvorgang.
   */
  useEffect(() => {
    if (!variantId || geladenFuer.current !== variantId) return
    const t = setTimeout(() => {
      void supabase.from('project_variants')
        .update({ bericht_einstellungen: einstellungen }).eq('id', variantId)
        .then(({ error }) => {
          if (error) console.error('[Bericht] Einstellungen nicht gespeichert:', error.message)
        })
    }, 500)
    return () => clearTimeout(t)
  }, [variantId, einstellungen])

  const etappeUmschalten = useCallback((id: string) => {
    setEtappenAuswahl((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))
  }, [])

  const umschalten = useCallback((key: string) => {
    setAuswahl((a) => (a.includes(key) ? a.filter((k) => k !== key) : sortiereKapitel([...a, key])))
    setAktiveVorlage(null) // Auswahl weicht ab jetzt von der Vorlage ab
  }, [])

  /** Einen gespeicherten Bericht übernehmen — Kapitel und Einstellungen. */
  const vorlageLaden = useCallback((v: BerichtVorlage) => {
    const e = normalizeBerichtEinstellungen(v.einstellungen, v.kapitel)
    setAktiveVorlage(v)
    setAuswahl(e.kapitel)
    setAnrede(e.anrede)
    setUmfang(e.umfang)
    // Die Etappen einer anderen Variante gibt es hier nicht; was nicht passt,
    // filtert die Sidebar beim Anzeigen heraus.
    setEtappenAuswahl(e.etappen)
  }, [])

  /** Nach dem Sichern: Vorlage als aktiv markieren, ohne die Auswahl zu ändern. */
  const vorlageGesetzt = useCallback((v: BerichtVorlage) => setAktiveVorlage(v), [])

  const druckKapitel = useMemo(
    () => sortiereKapitel([...FIXE_KAPITEL, ...auswahl]),
    [auswahl],
  )

  const wert = useMemo<BerichtWert>(() => ({
    kontext, auswahl, druckKapitel, umschalten, aktiveVorlage, vorlageLaden, vorlageGesetzt,
    anrede, setAnrede, umfang, setUmfang,
    etappenAuswahl, etappeUmschalten, setEtappenAuswahl, einstellungen,
  }), [kontext, auswahl, druckKapitel, umschalten, aktiveVorlage, vorlageLaden, vorlageGesetzt,
       anrede, umfang, etappenAuswahl, etappeUmschalten, einstellungen])

  return <Ctx.Provider value={wert}>{children}</Ctx.Provider>
}

export function useBericht(): BerichtWert {
  const c = useContext(Ctx)
  if (!c) throw new Error('useBericht muss innerhalb von <BerichtProvider> verwendet werden')
  return c
}
