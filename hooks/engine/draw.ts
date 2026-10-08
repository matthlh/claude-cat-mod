import type { Palette, Rows } from '../packs/types'
import { PX } from './geometry'

export const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

export function faceRight(rows: Rows): Rows {
  return rows.map(r => [...r].reverse().join(''))
}

// One rect per horizontal run of a colour; with `except`, only the pixels
// that differ from it (an overlay).
export function rects(rows: Rows, pal: Palette, except?: Rows, px = PX): string {
  if (except) rows = rows.map((r, y) => [...r].map((ch, x) => (except[y][x] === ch ? '.' : ch)).join(''))
  const out: string[] = []
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]
      let run = 1
      while (row[x + run] === ch) run++
      if (pal[ch] !== undefined) {
        out.push(`<rect x="${x * px}" y="${y * px}" width="${run * px}" height="${px}" fill="${hex(pal[ch])}"/>`)
      }
      x += run
    }
  })
  return out.join('')
}

// Flips between two frames: the first shown for the first half of each period.
export function frames(a: string, b: string, period: number, until?: number): string {
  const repeat = until !== undefined ? `repeatDur="${Math.max(1, Math.round(until))}ms"` : 'repeatCount="indefinite"'
  const anim = (v: string) => `<animate attributeName="opacity" values="${v}" dur="${period}s" calcMode="discrete" ${repeat}/>`
  return `<g>${a}${anim('1;0')}</g><g opacity="0">${b}${anim('0;1')}</g>`
}
