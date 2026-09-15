import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Auf- und zugeklappter Zustand einer Sektion, deren Vorgabe sich noch ändern
 * kann: Mengen und Kosten werden nachgeladen, und erst dann steht fest, ob
 * eine Sektion offen beginnen soll — etwa weil nur eine Nutzungsart vorkommt
 * und das Zuklappen bloss einen Klick kostete.
 *
 * Sobald jemand selbst klickt, gilt seine Wahl; eine später eintreffende
 * Vorgabe reisst die Sektion dann nicht mehr auf.
 */
export function useAufklappbar(vorgabe: boolean): [boolean, () => void] {
  const [offen, setOffen] = useState(vorgabe)
  const selbstGewaehlt = useRef(false)

  useEffect(() => {
    if (!selbstGewaehlt.current) setOffen(vorgabe)
  }, [vorgabe])

  const umschalten = useCallback(() => {
    selbstGewaehlt.current = true
    setOffen((o) => !o)
  }, [])

  return [offen, umschalten]
}
