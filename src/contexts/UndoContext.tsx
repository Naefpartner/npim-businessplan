import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from 'react'

/**
 * Globale Undo/Redo-Zentrale.
 *
 * Alle Eingabebereiche tragen ihre Änderungen als Einträge mit `undo`/`redo`-Closures
 * in EINE gemeinsame Zeitachse ein. ⌘/Ctrl+Z macht die zuletzt getätigte Änderung
 * (bereichsübergreifend) rückgängig. Für DB-gestützte Bereiche schreiben die Closures
 * direkt in die Datenbank zurück (persistieren), lokale Bereiche setzen ihren State.
 */

export interface UndoEntry {
  label: string
  undo: () => void
  redo: () => void
  /** Aufeinanderfolgende Einträge mit gleichem Key (kurze Zeit) werden zu einem zusammengefasst. */
  coalesceKey?: string
}

interface UndoContextValue {
  record: (e: UndoEntry) => void
  undo: () => void
  redo: () => void
  clear: () => void
  canUndo: boolean
  canRedo: boolean
  undoLabel?: string
  redoLabel?: string
}

const noop = () => {}
const UndoContext = createContext<UndoContextValue>({
  record: noop, undo: noop, redo: noop, clear: noop, canUndo: false, canRedo: false,
})

export function useUndo() {
  return useContext(UndoContext)
}

const LIMIT = 50
const COALESCE_MS = 700

export function UndoProvider({ children }: { children: React.ReactNode }) {
  const past = useRef<UndoEntry[]>([])
  const future = useRef<UndoEntry[]>([])
  const lastTs = useRef(0)
  const [, force] = useReducer((x: number) => x + 1, 0)

  const record = useCallback((e: UndoEntry) => {
    const now = Date.now()
    const top = past.current[past.current.length - 1]
    if (e.coalesceKey && top && top.coalesceKey === e.coalesceKey && now - lastTs.current < COALESCE_MS) {
      // Zusammenfassen: ursprüngliches undo behalten, redo auf den neuesten Stand ziehen.
      top.redo = e.redo
      top.label = e.label
      lastTs.current = now
      future.current = []
      force()
      return
    }
    past.current.push(e)
    if (past.current.length > LIMIT) past.current.shift()
    future.current = []
    lastTs.current = now
    force()
  }, [])

  const undo = useCallback(() => {
    const e = past.current.pop()
    if (!e) return
    try { e.undo() } finally {
      future.current.unshift(e)
      lastTs.current = 0
      force()
    }
  }, [])

  const redo = useCallback(() => {
    const e = future.current.shift()
    if (!e) return
    try { e.redo() } finally {
      past.current.push(e)
      lastTs.current = 0
      force()
    }
  }, [])

  const clear = useCallback(() => {
    past.current = []
    future.current = []
    lastTs.current = 0
    force()
  }, [])

  // Globale Tastenkürzel: ⌘/Ctrl+Z (undo), ⌘/Ctrl+Shift+Z bzw. Ctrl+Y (redo).
  // In Textfeldern greift das native Undo — dort wird nicht abgefangen.
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const mod = ev.metaKey || ev.ctrlKey
      if (!mod) return
      const key = ev.key.toLowerCase()
      const isUndo = key === 'z' && !ev.shiftKey
      const isRedo = (key === 'z' && ev.shiftKey) || key === 'y'
      if (!isUndo && !isRedo) return
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName
      const editable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable
      if (editable) return // native Undo im Feld nicht stören
      ev.preventDefault()
      if (isRedo) redo(); else undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const value: UndoContextValue = {
    record, undo, redo, clear,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    undoLabel: past.current[past.current.length - 1]?.label,
    redoLabel: future.current[0]?.label,
  }

  return <UndoContext.Provider value={value}>{children}</UndoContext.Provider>
}

/**
 * useState-Ersatz, der jede Änderung in die globale Undo-Zeitachse einträgt.
 * `set(updater, opts?)` — opts.label für die Anzeige, opts.coalesceKey zum Zusammenfassen.
 */
export function useUndoableState<T>(initial: T | (() => T), defaultLabel: string) {
  const { record } = useUndo()
  const [state, setStateRaw] = useState<T>(initial)
  const ref = useRef(state)
  ref.current = state

  const set = useCallback(
    (updater: T | ((prev: T) => T), opts?: { label?: string; coalesceKey?: string }) => {
      const prev = ref.current
      const next = typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater
      if (Object.is(next, prev)) return
      ref.current = next
      setStateRaw(next)
      record({
        label: opts?.label ?? defaultLabel,
        coalesceKey: opts?.coalesceKey,
        undo: () => { ref.current = prev; setStateRaw(prev) },
        redo: () => { ref.current = next; setStateRaw(next) },
      })
    },
    [record, defaultLabel],
  )

  // Setzt den Zustand OHNE Undo-Eintrag (z. B. beim Laden aus der DB).
  const setSilent = useCallback((next: T) => { ref.current = next; setStateRaw(next) }, [])

  return [state, set, setSilent] as const
}

/**
 * Wrappt einen persistierenden Setter (z. B. setParams aus useRendite) so, dass jede
 * Änderung rückgängig gemacht werden kann. undo/redo rufen den rohen Setter (persistiert)
 * ohne erneute Aufzeichnung auf.
 */
export function useUndoableSetter<T>(current: T, rawSet: (next: T) => void, label: string, coalesceKey?: string) {
  const { record } = useUndo()
  const ref = useRef(current)
  ref.current = current
  return useCallback(
    (next: T) => {
      const prev = ref.current
      if (Object.is(next, prev)) return
      ref.current = next
      rawSet(next)
      record({
        label,
        coalesceKey,
        undo: () => { ref.current = prev; rawSet(prev) },
        redo: () => { ref.current = next; rawSet(next) },
      })
    },
    [rawSet, record, label, coalesceKey],
  )
}
