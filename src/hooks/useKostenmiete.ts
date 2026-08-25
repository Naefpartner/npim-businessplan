import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  KOSTENMIETE_DEFAULTS, SENS_DEFAULTS,
  type KostenmieteParams, type BaurechtModus, type SensSettings, type SensParamId,
} from '@/lib/kostenmiete'

// DB-Zeile aus variant_kostenmiete (snake_case).
interface KostenmieteRow {
  referenzzinssatz: number | null
  im_baurecht: boolean | null
  baurecht_zins: number | null
  gvw_faktor: number | null
  betriebskosten_satz: number | null
  baurecht_subv_anteil: number | null
  baurecht_subv_modus: string | null
  baurecht_subv_betrag_chf: number | null
  baurecht_nsubv_anteil: number | null
  baurecht_nsubv_modus: string | null
  baurecht_nsubv_betrag_chf: number | null
  sens_axis_x: string | null
  sens_axis_y: string | null
  sens_step_x_mode: string | null
  sens_step_x_value: number | null
  sens_step_y_mode: string | null
  sens_step_y_value: number | null
}

function rowToParams(r: KostenmieteRow): KostenmieteParams {
  const modus = (m: string | null): BaurechtModus => (m === 'chf' ? 'chf' : 'pct')
  return {
    referenzzinssatz:   r.referenzzinssatz   ?? KOSTENMIETE_DEFAULTS.referenzzinssatz,
    imBaurecht:         r.im_baurecht         ?? KOSTENMIETE_DEFAULTS.imBaurecht,
    baurechtZins:       r.baurecht_zins       ?? KOSTENMIETE_DEFAULTS.baurechtZins,
    gvwFaktor:          r.gvw_faktor          ?? KOSTENMIETE_DEFAULTS.gvwFaktor,
    betriebskostenSatz: r.betriebskosten_satz ?? KOSTENMIETE_DEFAULTS.betriebskostenSatz,
    baurechtSubv: {
      anteil:    r.baurecht_subv_anteil     ?? 0,
      modus:     modus(r.baurecht_subv_modus),
      betragChf: r.baurecht_subv_betrag_chf ?? 0,
    },
    baurechtNichtSubv: {
      anteil:    r.baurecht_nsubv_anteil     ?? 0,
      modus:     modus(r.baurecht_nsubv_modus),
      betragChf: r.baurecht_nsubv_betrag_chf ?? 0,
    },
  }
}

function rowToSens(r: KostenmieteRow): SensSettings {
  const axis = (a: string | null, def: SensParamId): SensParamId =>
    (a === 'refzins' || a === 'erstellung_pm2' || a === 'erstellung_abs' || a === 'vmf_wohnen') ? a : def
  const mode = (m: string | null): 'pct' | 'abs' => (m === 'abs' ? 'abs' : 'pct')
  return {
    axisX: axis(r.sens_axis_x, SENS_DEFAULTS.axisX),
    axisY: axis(r.sens_axis_y, SENS_DEFAULTS.axisY),
    stepX: { mode: mode(r.sens_step_x_mode), value: r.sens_step_x_value ?? SENS_DEFAULTS.stepX.value },
    stepY: { mode: mode(r.sens_step_y_mode), value: r.sens_step_y_value ?? SENS_DEFAULTS.stepY.value },
  }
}

function toRow(variantId: string, p: KostenmieteParams, s: SensSettings) {
  return {
    variant_id:                variantId,
    referenzzinssatz:          p.referenzzinssatz,
    im_baurecht:               p.imBaurecht,
    baurecht_zins:             p.baurechtZins,
    gvw_faktor:                p.gvwFaktor,
    betriebskosten_satz:       p.betriebskostenSatz,
    baurecht_subv_anteil:      p.baurechtSubv.anteil,
    baurecht_subv_modus:       p.baurechtSubv.modus,
    baurecht_subv_betrag_chf:  p.baurechtSubv.betragChf,
    baurecht_nsubv_anteil:     p.baurechtNichtSubv.anteil,
    baurecht_nsubv_modus:      p.baurechtNichtSubv.modus,
    baurecht_nsubv_betrag_chf: p.baurechtNichtSubv.betragChf,
    sens_axis_x:               s.axisX,
    sens_axis_y:               s.axisY,
    sens_step_x_mode:          s.stepX.mode,
    sens_step_x_value:         s.stepX.value,
    sens_step_y_mode:          s.stepY.mode,
    sens_step_y_value:         s.stepY.value,
  }
}

/** Lädt/speichert Kostenmiete-Parameter UND Sensitivitäts-Einstellungen einer Variante. */
export function useKostenmiete(variantId: string) {
  const [params, setParamsState] = useState<KostenmieteParams>(KOSTENMIETE_DEFAULTS)
  const [sens, setSensState] = useState<SensSettings>(SENS_DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!variantId) { setLoading(false); return }
      setLoading(true)
      const { data, error } = await supabase
        .from('variant_kostenmiete')
        .select('*')
        .eq('variant_id', variantId)
        .maybeSingle()
      if (cancelled) return
      if (error) setError(error.message)
      const row = data as KostenmieteRow | null
      setParamsState(row ? rowToParams(row) : KOSTENMIETE_DEFAULTS)
      setSensState(row ? rowToSens(row) : SENS_DEFAULTS)
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [variantId])

  const persist = useCallback(async (p: KostenmieteParams, s: SensSettings) => {
    if (!variantId) return
    const { error } = await supabase
      .from('variant_kostenmiete')
      .upsert(toRow(variantId, p, s), { onConflict: 'variant_id' })
    if (error) setError(error.message)
  }, [variantId])

  const setParams = useCallback((next: KostenmieteParams) => {
    setParamsState(next)
    void persist(next, sens)
  }, [persist, sens])

  const setSens = useCallback((next: SensSettings) => {
    setSensState(next)
    void persist(params, next)
  }, [persist, params])

  return { params, setParams, sens, setSens, loading, error }
}
