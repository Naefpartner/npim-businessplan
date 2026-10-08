import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { sortiereKapitel, type BerichtEinstellungen } from '@/lib/bericht'
import type { BerichtVorlage } from '@/types'

/**
 * Lädt und speichert gespeicherte Berichte (Migrationen 063 und 073).
 *
 * Zwei Geltungsbereiche: ein Bericht gehört entweder zu einem Projekt — dann
 * erscheint er nur dort — oder zu keinem; dann steht er in jedem Projekt zur
 * Wahl. Eine Zusammenstellung wie „Machbarkeitsstudie kurz" ist Teamwissen,
 * ein „Bankdossier Altendorf" gehört zum Projekt.
 *
 * Gespeichert werden Kapitel und Einstellungen, nicht die Seitenumbrüche: die
 * zeigen auf Bausteine einer bestimmten Variante und bleiben an ihr.
 */
export function useBerichtVorlagen(projektId?: string) {
  const [alle, setAlle] = useState<BerichtVorlage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('bericht_vorlagen')
      .select('*')
      .order('name')
    if (error) { setError(error.message); console.error('[Bericht] Laden fehlgeschlagen:', error.message) }
    setAlle((data as BerichtVorlage[] | null) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  /** Was in diesem Projekt zur Wahl steht: seine eigenen und die allgemeinen. */
  const vorlagen = useMemo(
    () => alle.filter((v) => v.project_id == null || v.project_id === projektId),
    [alle, projektId],
  )
  const projektVorlagen = useMemo(
    () => vorlagen.filter((v) => v.project_id != null), [vorlagen])
  const allgemeineVorlagen = useMemo(
    () => vorlagen.filter((v) => v.project_id == null), [vorlagen])

  /**
   * Legt einen Bericht an oder überschreibt den gleichnamigen im selben
   * Geltungsbereich. Zwei Projekte dürfen beide ein „Bankdossier" führen.
   */
  const speichern = useCallback(async (
    name: string,
    einstellungen: BerichtEinstellungen,
    beschreibung?: string | null,
    /** Projekt, zu dem der Bericht gehört; `null` = projektübergreifend. */
    gehoertZuProjekt: string | null = null,
  ): Promise<BerichtVorlage | null> => {
    const sauber = name.trim()
    if (!sauber) return null
    const { data: auth } = await supabase.auth.getUser()
    const bestehend = alle.find((v) => v.name.toLowerCase() === sauber.toLowerCase()
      && (v.project_id ?? null) === gehoertZuProjekt)
    const nutzlast = {
      name: sauber,
      beschreibung: beschreibung ?? null,
      kapitel: sortiereKapitel(einstellungen.kapitel),
      project_id: gehoertZuProjekt,
      einstellungen: {
        anrede: einstellungen.anrede,
        umfang: einstellungen.umfang,
        etappen: einstellungen.etappen,
      },
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
  }, [alle, load])

  const loeschen = useCallback(async (id: string) => {
    const { error } = await supabase.from('bericht_vorlagen').delete().eq('id', id)
    if (error) { setError(error.message); console.error('[Bericht] Löschen fehlgeschlagen:', error.message); return }
    await load()
  }, [load])

  return {
    vorlagen, projektVorlagen, allgemeineVorlagen,
    loading, error, speichern, loeschen, reload: load,
  }
}
