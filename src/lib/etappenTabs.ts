// Reiter für die Etappensicht — einheitlich über Anlagekosten, Wirtschaftlichkeit
// und Benchmarks.

export interface EtappenTab {
  key: string
  label: string
}

/**
 * Reiter „Konsolidiert" plus je Etappe einer.
 *
 * Bei weniger als zwei Etappen gibt es nichts zu wählen — konsolidiert und die
 * einzige Etappe wären dieselbe Sicht. Dann bleibt die Liste leer und der
 * Aufrufer zeigt die konsolidierte Sicht ohne Reiterleiste.
 */
export function etappenTabs(etappen: { id: string; name: string }[]): EtappenTab[] {
  if (etappen.length < 2) return []
  return [
    { key: 'konsolidiert', label: 'Konsolidiert' },
    ...etappen.map((e) => ({ key: e.id, label: e.name })),
  ]
}
