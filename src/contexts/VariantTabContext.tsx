import { createContext, useContext } from 'react'

// Erlaubt tief verschachtelten Sektionen, den aktiven Hauptreiter der
// Variantenseite zu wechseln (z. B. aus der WBF-Berechnung zurück zu „Mengen").
export interface VariantTabApi {
  setTab: (key: string) => void
}

export const VariantTabContext = createContext<VariantTabApi | null>(null)

export function useVariantTab(): VariantTabApi | null {
  return useContext(VariantTabContext)
}
