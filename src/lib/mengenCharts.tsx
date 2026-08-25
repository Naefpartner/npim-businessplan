// =============================================================================
// SVG-Chart-Primitiven für die Mengen-/Mietzinsanalyse — nachempfunden dem
// Naef-Dashboard (Kupfer-Rampe, Blau-Akzent), als React-Komponenten.
// =============================================================================

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { CI, type CiFamily } from '@/lib/ci'
import { formatNumber } from '@/lib/utils'

const nf = (n: number | null | undefined, d = 0) => (n == null || !Number.isFinite(n) ? '–' : formatNumber(n, d))
const MUTED = '#6E6E6E'
const LINE = '#E2E2E2'
const BLACK = '#1A1A1A'

// ── Farbrampen (hell → dunkel) ───────────────────────────────────────────────
// Standard ist die Kupfer-Rampe; `rampOf` liefert dieselbe Interpolation für
// jede CI-Familie (Blau/Grün/Rot … für die Nutzungsarten).
const stopsOf = (family: CiFamily) => { const f = CI[family]; return [f[1], f[3], f[5], f[7], f[9]] }
function mix(stops: readonly string[], t: number): string {
  t = Math.max(0, Math.min(1, t || 0))
  const i = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)))
  const lt = t * (stops.length - 1) - i
  const h = (s: string) => [1, 3, 5].map((p) => parseInt(s.substr(p, 2), 16))
  const a = h(stops[i]), b = h(stops[i + 1])
  return '#' + a.map((v, j) => Math.round(v + (b[j] - v) * lt).toString(16).padStart(2, '0')).join('')
}
export const ramp = (t: number) => mix(stopsOf('kupfer'), t)
export const rampOf = (family: CiFamily, t: number) => mix(stopsOf(family), t)
export const onDark = (t: number) => t > 0.58
export function readableText(hex: string): string {
  const s = hex.replace('#', '')
  if (s.length < 6) return '#fff'
  const r = parseInt(s.slice(0, 2), 16), g = parseInt(s.slice(2, 4), 16), bl = parseInt(s.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * bl) / 255 > 0.6 ? BLACK : '#fff'
}

// ── Sofort-Tooltip ───────────────────────────────────────────────────────────
// Das native `title`-Attribut erscheint erst nach rund einer Sekunde und lässt
// sich nicht beschleunigen. Dieser Hook liefert stattdessen einen eigenen
// Tooltip, der ohne Verzögerung am Mauszeiger hängt.
// Verwendung: `const { bind, layer } = useTip()`, dann `<div {...bind(text)}>`
// und `{layer}` einmal im Markup rendern.
export function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const bind = (text: string | null | undefined) => (text ? {
    onMouseEnter: (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, text }),
    onMouseMove: (e: React.MouseEvent) => setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t)),
    onMouseLeave: () => setTip(null),
  } : {})

  const layer = tip
    ? createPortal(
        <div
          className="pointer-events-none fixed z-[95] max-w-[280px] rounded bg-slate-900 px-2 py-1 text-[12px] leading-snug text-white shadow-lg"
          style={{ left: Math.min(tip.x + 14, window.innerWidth - 292), top: tip.y + 18 }}>
          {tip.text}
        </div>,
        document.body,
      )
    : null

  return { bind, layer }
}

const Svg = ({ w, h, children }: { w: number; h: number; children: React.ReactNode }) => (
  <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block', width: '100%', height: 'auto', overflow: 'visible' }}>{children}</svg>
)

// ── Horizontale Balken ───────────────────────────────────────────────────────
export interface HBarItem { label: string; value: number; text?: string; sub?: string; color?: string; value2?: number }
export function HBars({ items, labW = 118, valW = 78, rowH = 24, w = 600, color = CI.kupfer[7], max }: {
  items: HBarItem[]; labW?: number; valW?: number; rowH?: number; w?: number; color?: string; max?: number
}) {
  const mx = max ?? Math.max(...items.map((i) => i.value || 0), 1)
  const x0 = labW, x1 = w - valW, pad = 6
  return (
    <Svg w={w} h={items.length * rowH + pad * 2}>
      {items.map((it, i) => {
        const y = i * rowH + pad, bw = Math.max(1, (it.value / mx) * (x1 - x0))
        return (
          <g key={i}>
            <text x={labW - 8} y={y + rowH * 0.62} textAnchor="end" fill={BLACK} style={{ fontSize: 11.5 }}>{it.label}</text>
            <rect x={x0} y={y + 3} width={bw} height={rowH - 10} fill={it.color || color}><title>{`${it.label}: ${it.text || nf(it.value)}`}</title></rect>
            {it.value2 != null && <rect x={x0} y={y + rowH - 6} width={Math.max(1, (it.value2 / mx) * (x1 - x0))} height={3} fill={CI.blau[5]} />}
            <text x={w} y={y + rowH * 0.62} textAnchor="end" fill={BLACK} style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>{it.text || nf(it.value)}</text>
            {it.sub && <text x={x0 + bw + 6} y={y + rowH * 0.62} fill={MUTED} style={{ fontSize: 10 }}>{it.sub}</text>}
          </g>
        )
      })}
    </Svg>
  )
}

// ── Säulen ───────────────────────────────────────────────────────────────────
export interface ColItem { label: string; value: number; text?: string; sub?: string; color?: string }
export function Cols({ items, w = 600, h = 200, dec = 0, color = CI.kupfer[7], x0 = 34 }: {
  items: ColItem[]; w?: number; h?: number; dec?: number; color?: string; x0?: number
}) {
  const padB = 34, padT = 16
  const max = Math.max(...items.map((i) => i.value || 0), 1)
  const bw = (w - x0) / Math.max(1, items.length)
  return (
    <Svg w={w} h={h}>
      <line x1={x0} y1={h - padB} x2={w} y2={h - padB} stroke={LINE} />
      {[0, 0.5, 1].map((t, k) => {
        const y = padT + (1 - t) * (h - padB - padT)
        return <g key={k}>
          <line x1={x0} y1={y} x2={w} y2={y} stroke={LINE} strokeDasharray="2 3" />
          <text x={x0 - 6} y={y + 3} textAnchor="end" fill={MUTED} style={{ fontSize: 10 }}>{nf(max * t, dec)}</text>
        </g>
      })}
      {items.map((it, i) => {
        const bh = (it.value / max) * (h - padB - padT), x = x0 + i * bw + bw * 0.16, ww = bw * 0.68
        return <g key={i}>
          <rect x={x} y={h - padB - bh} width={ww} height={Math.max(0, bh)} fill={it.color || color}><title>{`${it.label}: ${it.text || nf(it.value)}`}</title></rect>
          <text x={x + ww / 2} y={h - padB - bh - 5} textAnchor="middle" fill={BLACK} style={{ fontSize: 11 }}>{it.text || nf(it.value)}</text>
          <text x={x + ww / 2} y={h - padB + 14} textAnchor="middle" fill={MUTED} style={{ fontSize: 10 }}>{it.label}</text>
          {it.sub && <text x={x + ww / 2} y={h - padB + 26} textAnchor="middle" fill={MUTED} style={{ fontSize: 9.5 }}>{it.sub}</text>}
        </g>
      })}
    </Svg>
  )
}

// ── Gestapelte horizontale Balken ────────────────────────────────────────────
// HTML statt SVG (wie RangeRows): gleiche Schriftgrösse wie die Tabellen und
// Tooltips ohne Verzögerung. Jede Zeile besteht aus farbigen Segmenten; die
// Zeilenlänge ist über alle Zeilen vergleichbar skaliert.
export interface StackedSeg { label: string; value: number; color: string }
export interface StackedRow { label: string; segs: StackedSeg[]; text?: string }
export function StackedBars({ items, labW = 110, valW = 96, rowH = 26, dec = 0, einheit = '' }: {
  items: StackedRow[]; labW?: number; valW?: number; rowH?: number; dec?: number; einheit?: string
}) {
  const { bind, layer } = useTip()
  const total = (r: StackedRow) => r.segs.reduce((s, x) => s + (x.value || 0), 0)
  const max = Math.max(...items.map(total), 1)
  const cols = { gridTemplateColumns: `${labW}px minmax(0,1fr) ${valW}px` }

  return (
    <div className="text-sm">
      {layer}
      {items.map((r, i) => {
        const t = total(r)
        return (
          <div key={i} className="grid items-center gap-x-2" style={{ ...cols, height: rowH }}>
            <div className="truncate text-left text-slate-900">{r.label}</div>
            <div className="flex h-[15px] overflow-hidden rounded-sm" style={{ width: `${(t / max) * 100}%` }}>
              {r.segs.filter((x) => x.value > 0).map((x, k) => (
                <div key={k} style={{ flex: x.value, background: x.color }}
                  {...bind(`${r.label} · ${x.label}: ${nf(x.value, dec)}${einheit}`)} />
              ))}
            </div>
            <div className="text-right tabular-nums text-slate-900">{r.text ?? nf(t, dec)}</div>
          </div>
        )
      })}
    </div>
  )
}

// ── Min–Ø–Median–Max-Spannen ─────────────────────────────────────────────────
// Bewusst als HTML (nicht SVG): so bleibt die Schrift exakt gleich gross wie in
// den Tabellen, unabhängig von der Kartenbreite. Ein skaliertes viewBox würde
// die Beschriftung mitvergrössern und das Bild uneinheitlich machen.
export interface RangeItem { label: string; min?: number; avg?: number; med?: number; max?: number }
export function RangeRows({ items, rowH = 30, labW = 96, dec = 0, min, max, familie = 'kupfer' }: {
  items: RangeItem[]; rowH?: number; labW?: number; dec?: number; min?: number; max?: number; familie?: CiFamily
}) {
  const F = CI[familie]
  // Skala auf die tatsächliche Spanne zoomen (nicht bei 0 beginnen) — sonst
  // quetschen sich die Balken bei hohen Werten mit kleiner Streuung zusammen.
  // Etwas Luft nach beiden Seiten, damit Min/Max nicht am Rand kleben.
  const vals = items.flatMap((i) => [i.min, i.max]).filter((v): v is number => v != null)
  const dLo = vals.length ? Math.min(...vals) : 0
  const dHi = vals.length ? Math.max(...vals) : 1
  const luft = (dHi - dLo) * 0.08 || Math.abs(dHi) * 0.05 || 1
  const lo = min ?? dLo - luft, hi = max ?? dHi + luft
  const p = (v: number) => `${(((v - lo) / ((hi - lo) || 1)) * 100).toFixed(3)}%`
  const cols = { gridTemplateColumns: `${labW}px minmax(0,1fr) 56px` }
  const { bind, layer } = useTip()
  // Mouseover je Zeile: immer Min, Max, Median und Durchschnitt.
  const tip = (it: RangeItem) => [
    it.label,
    `Min ${nf(it.min, dec)}`,
    `Max ${nf(it.max, dec)}`,
    `Median ${nf(it.med, dec)}`,
    `Ø ${nf(it.avg, dec)}`,
  ].join(' · ')

  return (
    <div className="text-sm">
      {layer}
      {items.map((it, i) => (
        <div key={i} {...bind(tip(it))} className="grid items-center gap-x-2" style={{ ...cols, height: rowH }}>
          {/* linksbündig — fluchtet mit dem Kartentitel */}
          <div className="truncate text-left text-slate-900">{it.label}</div>
          <div className="relative h-full">
            {/* Gitterlinien Min / Mitte / Max */}
            {['0%', '50%', '100%'].map((x) => (
              <span key={x} className="absolute top-1 bottom-1 border-l border-dashed" style={{ left: x, borderColor: LINE }} />
            ))}
            {it.min != null && it.max != null && (
              <>
                <span className="absolute top-1/2 h-[7px] -translate-y-1/2 rounded-full"
                  style={{ left: p(it.min), right: `calc(100% - ${p(it.max)})`, background: F[3] }} />
                {[it.min, it.max].map((v, k) => (
                  <span key={k} className="absolute top-1/2 h-3 w-px -translate-y-1/2" style={{ left: p(v), background: F[7] }} />
                ))}
                {it.med != null && (
                  <span className="absolute top-1/2 h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-white"
                    style={{ left: p(it.med), background: BLACK }} />
                )}
                {it.avg != null && (
                  <span className="absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{ left: p(it.avg), background: F[9] }} />
                )}
              </>
            )}
          </div>
          <div className="text-right tabular-nums text-slate-900">{it.avg != null ? nf(it.avg, dec) : '–'}</div>
        </div>
      ))}
      {/* Achse */}
      <div className="grid gap-x-2 pt-1" style={cols}>
        <span />
        <div className="relative h-4">
          {([[lo, '0%', 'translateX(0)'], [(lo + hi) / 2, '50%', 'translateX(-50%)'], [hi, '100%', 'translateX(-100%)']] as const).map(([v, x, tr], k) => (
            <span key={k} className="absolute top-0 tabular-nums" style={{ left: x, transform: tr, color: MUTED }}>{nf(v, dec)}</span>
          ))}
        </div>
        <span />
      </div>
    </div>
  )
}

// ── Streudiagramm mit Regression ─────────────────────────────────────────────
export interface ScatterPt { x: number; y: number; color?: string; id?: string; label?: string; r?: number }
export function Scatter({ pts, w = 600, h = 330, xLab = '', yLab = '', xdec = 0, ydec = 0, trend, onPick }: {
  pts: ScatterPt[]; w?: number; h?: number; xLab?: string; yLab?: string; xdec?: number; ydec?: number
  trend?: { slope: number; intercept: number; r2: number; unit?: string; xunit?: string } | null
  onPick?: (id: string) => void
}) {
  const l = 48, b = 38, t = 14, r = 10
  if (!pts.length) return <div style={{ fontSize: 11.5, color: MUTED }}>Keine Daten.</div>
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
  const x0 = Math.min(...xs) * 0.92, x1 = Math.max(...xs) * 1.04 || 1
  const y0 = Math.min(...ys) * 0.92, y1 = Math.max(...ys) * 1.04 || 1
  const sx = (v: number) => l + ((v - x0) / ((x1 - x0) || 1)) * (w - l - r)
  const sy = (v: number) => h - b - ((v - y0) / ((y1 - y0) || 1)) * (h - b - t)
  return (
    <Svg w={w} h={h}>
      {[0, 1, 2, 3, 4].map((i) => { const v = y0 + (y1 - y0) * i / 4; return (
        <g key={`y${i}`}>
          <line x1={l} y1={sy(v)} x2={w - r} y2={sy(v)} stroke={LINE} strokeDasharray="2 3" />
          <text x={l - 6} y={sy(v) + 3} textAnchor="end" fill={MUTED} style={{ fontSize: 10 }}>{nf(v, ydec)}</text>
        </g>) })}
      {[0, 1, 2, 3, 4].map((i) => { const v = x0 + (x1 - x0) * i / 4; return (
        <text key={`x${i}`} x={sx(v)} y={h - b + 15} textAnchor="middle" fill={MUTED} style={{ fontSize: 10 }}>{nf(v, xdec)}</text>) })}
      {trend && <>
        <line x1={sx(x0)} y1={sy(trend.intercept + trend.slope * x0)} x2={sx(x1)} y2={sy(trend.intercept + trend.slope * x1)} stroke={CI.kupfer[9]} strokeWidth={1.5} strokeDasharray="5 4" />
        <text x={w - r} y={t + 10} textAnchor="end" fill={MUTED} style={{ fontSize: 10 }}>{`Trend: ${nf(trend.slope, 0)} ${trend.unit || ''} je ${trend.xunit || 'Einheit'} · R² ${nf(trend.r2, 2)}`}</text>
      </>}
      {pts.map((p, i) => (
        <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={p.r || 4.5} fill={p.color || CI.kupfer[7]} fillOpacity={0.85} stroke="#fff" strokeWidth={0.8}
          style={{ cursor: onPick && p.id ? 'pointer' : 'default' }} onClick={() => onPick && p.id && onPick(p.id)}>
          <title>{p.label || ''}</title>
        </circle>
      ))}
      <text x={(w + l) / 2} y={h - 4} textAnchor="middle" fill={MUTED} style={{ fontSize: 10 }}>{xLab}</text>
      <text x={-h / 2} y={12} textAnchor="middle" transform="rotate(-90)" fill={MUTED} style={{ fontSize: 10 }}>{yLab}</text>
    </Svg>
  )
}
