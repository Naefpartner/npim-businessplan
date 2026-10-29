import { useState, type ChangeEvent } from 'react'

/**
 * Entwurf eines Eingabefelds, das ausser Fokus gesetzt (mit Tausenderzeichen
 * o.ä.) und im Fokus roh dasteht.
 *
 * Getippt ist erst, was der Nutzer eintippt. Bis dahin zeigt das Feld den
 * aktuellen Wert — auch dann, wenn er sich im Fokus ändert, weil das Verlassen
 * des vorigen Felds mit Tab eine Neuberechnung ausgelöst hat. Und nur
 * Getipptes wird beim Verlassen gemeldet; sonst schriebe ein Feld, durch das
 * man bloss hindurchtabbt, den Stand von vor der Neuberechnung zurück.
 */
export function useEingabe() {
  const [fokus, setFokus] = useState(false)
  const [getippt, setGetippt] = useState<string | null>(null)
  return {
    /** Feldinhalt: Getipptes, sonst im Fokus `roh`, ausser Fokus `gesetzt`. */
    text: (roh: string, gesetzt: string) => getippt ?? (fokus ? roh : gesetzt),
    onFocus: () => setFokus(true),
    onChange: (e: ChangeEvent<HTMLInputElement>) => setGetippt(e.target.value),
    /** Beim Verlassen aufrufen: das Getippte, oder null, wenn nichts getippt wurde. */
    verlassen: (): string | null => {
      const t = getippt
      setFokus(false)
      setGetippt(null)
      return t
    },
  }
}
