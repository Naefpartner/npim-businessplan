import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import {
  FIXE_KAPITEL, sortiereKapitel, type AuftragAnrede, type EtappenUmfang,
} from '@/lib/bericht'
import type { BerichtVorlage } from '@/types'

/** Vorauswahl für einen neuen Bericht. */
const STANDARD_AUSWAHL = [
  'projektuebersicht', 'stammdaten', 'mengengeruest', 'wohnungsmix', 'anlagekosten',
  'wirtschaftlichkeit',
]

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
 */
export function BerichtProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const kontext = useMemo(() => berichtsKontext(pathname), [pathname])

  const [auswahl, setAuswahl] = useState<string[]>(STANDARD_AUSWAHL)
  const [aktiveVorlage, setAktiveVorlage] = useState<BerichtVorlage | null>(null)
  const [anrede, setAnrede] = useState<AuftragAnrede>('Auftraggeberin')
  const [umfang, setUmfang] = useState<EtappenUmfang>('beide')

  // Beim Wechsel der Variante auf die Vorauswahl zurück — die Kapitel einer
  // anderen Variante sagen über diese nichts aus.
  useEffect(() => {
    if (!kontext) return
    setAuswahl(STANDARD_AUSWAHL)
    setAktiveVorlage(null)
  }, [kontext?.variantId])  // eslint-disable-line react-hooks/exhaustive-deps

  const umschalten = useCallback((key: string) => {
    setAuswahl((a) => (a.includes(key) ? a.filter((k) => k !== key) : sortiereKapitel([...a, key])))
    setAktiveVorlage(null) // Auswahl weicht ab jetzt von der Vorlage ab
  }, [])

  const vorlageLaden = useCallback((v: BerichtVorlage) => {
    setAktiveVorlage(v)
    setAuswahl(sortiereKapitel(v.kapitel))
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
  }), [kontext, auswahl, druckKapitel, umschalten, aktiveVorlage, vorlageLaden, vorlageGesetzt,
       anrede, umfang])

  return <Ctx.Provider value={wert}>{children}</Ctx.Provider>
}

export function useBericht(): BerichtWert {
  const c = useContext(Ctx)
  if (!c) throw new Error('useBericht muss innerhalb von <BerichtProvider> verwendet werden')
  return c
}
