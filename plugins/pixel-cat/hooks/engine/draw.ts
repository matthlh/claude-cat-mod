import type { Palette, Pose, Rows } from '../packs/types'
import { PX } from './geometry'

export const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')

// A number for SVG markup: at most two decimals, no trailing zeros.
export const num = (n: number) => String(Math.round(n * 100) / 100)

// A number for SMIL values and keyTimes: `digits` decimals at most, no trailing zeros.
export const fmt = (n: number, digits = 3) => String(Number(n.toFixed(digits)))

/** A sprite's width: its longest row. */
export const widthOf = (rows: Rows) => rows.reduce((w, r) => Math.max(w, r.length), 0)

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

export function faceRight(rows: Rows): Rows {
  return rows.map(r => [...r].reverse().join(''))
}

// Shut eyes, for a blink or a happy squint: the eye-shine row (H) becomes the
// skin or fur around it (o), the eye row (K) a dark lash line (d). Every pack
// gets this unless its Hero brings its own closeEyes.
export function closeEyes(rows: Rows): Rows {
  return rows.map(r => (r.includes('H') ? r.replace(/[HK]/g, 'o') : r.replace(/K/g, 'd')))
}

// The desktop's seconds for one cycle of a pose: its own period, or each
// frame for the terminal's tick, so the two surfaces keep the same time.
export function posePeriod(p: Pose): number {
  return p.period ?? (p.frames.length * (p.tick ?? 500)) / 1000
}

// One rect per horizontal run of a colour; with `except`, only the pixels
// that differ from it (an overlay).
export function rects(rows: Rows, pal: Palette, except?: Rows, px = PX): string {
  if (except) rows = rows.map((r, y) => [...r].map((ch, x) => (except[y]?.[x] === ch ? '.' : ch)).join(''))
  const out: string[] = []
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row.charAt(x)
      let run = 1
      while (row.charAt(x + run) === ch) run++
      const color = pal[ch]
      if (color !== undefined) {
        out.push(`<rect x="${x * px}" y="${y * px}" width="${run * px}" height="${px}" fill="${hex(color)}"/>`)
      }
      x += run
    }
  })
  return out.join('')
}

// The same pixels as rects(), as one path per colour with a subpath per run:
// far fewer characters, for big drawings such as backdrops. `s` px a pixel,
// offset by dx, dy.
export function paths(rows: Rows, pal: Palette, s = PX, dx = 0, dy = 0): string {
  const d: Record<string, string> = {}
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row.charAt(x)
      let run = 1
      while (row.charAt(x + run) === ch) run++
      if (pal[ch] !== undefined) d[ch] = (d[ch] ?? '') + `M${num(dx + x * s)} ${num(dy + y * s)}h${num(run * s)}v${num(s)}h${num(-run * s)}z`
      x += run
    }
  })
  return Object.entries(d)
    .map(([ch, path]) => `<path fill="${hex(pal[ch] ?? 0)}" d="${path}"/>`)
    .join('')
}

// Steps through any number of frames, each shown for an equal share of the
// period, the first one first; from `begin` seconds, if given.
export function cycleFrames(list: string[], period: number, until?: number, begin?: number): string {
  const repeat = until !== undefined ? `repeatDur="${Math.max(1, Math.round(until))}ms"` : 'repeatCount="indefinite"'
  const start = begin !== undefined ? ` begin="${begin}s"` : ''
  const anim = (i: number) => {
    const v = list.map((_, j) => (j === i ? 1 : 0)).join(';')
    return `<animate attributeName="opacity" values="${v}" dur="${period}s"${start} calcMode="discrete" ${repeat}/>`
  }
  return list.map((f, i) => `<g${i ? ' opacity="0"' : ''}>${f}${anim(i)}</g>`).join('')
}

// Flips between two frames: the first shown for the first half of each period.
export function frames(a: string, b: string, period: number, until?: number, begin?: number): string {
  return cycleFrames([a, b], period, until, begin)
}
