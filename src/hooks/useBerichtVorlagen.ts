import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { sortiereKapitel } from '@/lib/bericht'
import type { BerichtVorlage } from '@/types'

/**
 * Lädt/speichert die vordefinierten Berichte (Migration 063).
 *
 * Bewusst projektübergreifend und für alle Benutzer sichtbar — eine Vorlage
 * wie „Machbarkeitsstudie kurz" ist Teamwissen, nicht Privatsache.
 */
export function useBerichtVorlagen() {
  const [vorlagen, setVorlagen] = useState<BerichtVorlage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('bericht_vorlagen')
      .select('*')
      .order('name')
    if (error) { setError(error.message); console.error('[Bericht] Laden fehlgeschlagen:', error.message) }
    setVorlagen((data as BerichtVorlage[] | null) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  /** Legt eine Vorlage an oder überschreibt die gleichnamige. */
  const speichern = useCallback(async (
    name: string, kapitel: string[], beschreibung?: string | null,
  ): Promise<BerichtVorlage | null> => {
    const sauber = name.trim()
    if (!sauber) return null
    const { data: auth } = await supabase.auth.getUser()
    // Gleichnamige Vorlage aktualisieren statt eine zweite anzulegen — der
    // eindeutige Index auf lower(name) würde das ohnehin verhindern.
    const bestehend = vorlagen.find((v) => v.name.toLowerCase() === sauber.toLowerCase())
    const nutzlast = {
      name: sauber,
      beschreibung: beschreibung ?? null,
      kapitel: sortiereKapitel(kapitel),
    }
    const abfrage = bestehend
      ? supabase.from('bericht_vorlagen').update(nutzlast).eq('id', bestehend.id)
      : supabase.from('bericht_vorlagen').insert({ ...nutzlast, created_by: auth.user?.id ?? null })
    const { data, error } = await abfrage.select().maybeSingle()
    if (error) {
      setError(error.message)
      console.error('[Bericht] Speichern fehlgeschlagen:', error.message)
      throw new Error(error.message)
    }
    setError(null)
    await load()
    return (data as BerichtVorlage | null) ?? null
  }, [vorlagen, load])

  const loeschen = useCallback(async (id: string) => {
    const { error } = await supabase.from('bericht_vorlagen').delete().eq('id', id)
    if (error) { setError(error.message); console.error('[Bericht] Löschen fehlgeschlagen:', error.message); return }
    await load()
  }, [load])

  return { vorlagen, loading, error, speichern, loeschen, reload: load }
}
