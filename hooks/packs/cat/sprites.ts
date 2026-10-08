import { closeEyes } from '../../engine/draw'
import { HAT_PAD } from '../../engine/geometry'
import type { Hero, Palette, Rows } from '../types'

// Chibi pixel sprites, 12x10, facing left.
// o fur, d shade, H eye shine, K eye, r blush, n nose, w chest.
const HEAD = [
  '.o.....o....',
  '.oo...oo....',
  'ooooooooo...',
  'oHKoooHKo...',
  'oKKoooKKo...',
  'rooonooor...',
]
const WALK_A = [...HEAD, '.ooooooo...d', '..owwwooo.d.', '..oooooooo..', '..oo...oo...']
const WALK_B = [...HEAD, '.ooooooo...d', '..owwwooo.d.', '..oooooooo..', '...oo.oo....']
export const SIT = [...HEAD, '.ooooooo....', '.owwwooo.d..', '.oowwooood..', '..oo..oo....']
const SIT_WAG = [...HEAD, '.ooooooo..d.', '.owwwooo.d..', '.oowwooood..', '..oo..oo....']
// One front paw reaching out (for fishing and pinning a mouse).
export const SIT_PAW = [...HEAD, '.ooooooo....', 'oowwwooo.d..', '.oowwooood..', '......oo....']
// Grooming: eyes shut, a paw up at the mouth, the tongue flicking out.
export const GROOM_A = closeEyes(SIT).map((r, y) => (y === 5 ? 'wwoonooor...' : y === 6 ? 'wooooooo....' : r))
export const GROOM_B = GROOM_A.map((r, y) => (y === 5 ? 'wnoonooor...' : r))
const LOAF = [
  '............',
  '............',
  '............',
  '............',
  '.o.....o....',
  '.oo...oo....',
  'oooooooooo..',
  'oddoooddoooo',
  'rooonooroood',
  '.oooooooooo.',
]

// Markings and hats, drawn into every sprite so each pose wears them.
const HAT_ROWS: Record<string, Rows> = {
  party: ['.Z.', '.P.', 'PQP', 'QPQ'],
  beanie: ['..Z..', '.UUU.', 'UVUVU'],
  wizard: ['..X..', '.XYX.', '.XXX.', 'XXXXX'],
  crown: ['Y.Y.Y', 'YYYYY'],
}
const HAT_PAL: Palette = { P: 0xff6fae, Q: 0xffc2dc, Z: 0xffd54a, U: 0x4a7fd6, V: 0x8fb3ee, X: 0x7a4fd6, Y: 0xf5c542 }

export const MARKINGS = ['none', 'blaze', 'socks', 'tip', 'spot']

function setAt(row: string, x: number, ch: string): string {
  return x < 0 || x >= row.length ? row : row.slice(0, x) + ch + row.slice(x + 1)
}

function mark(rows: Rows, m: string): Rows {
  const out = [...rows]
  if (m === 'blaze') {
    const y = out.findIndex(r => r.includes('ooooooooo'))
    const row = out[y]
    if (row !== undefined) out[y] = setAt(row, 4, 'w')
  } else if (m === 'socks') {
    const y = out.length - 1
    const row = out[y]
    if (row !== undefined) out[y] = row.replace('oo', 'ww')
  } else if (m === 'tip') {
    const y = out.findIndex(r => r.lastIndexOf('d') >= 9)
    const row = out[y]
    if (row !== undefined) out[y] = setAt(row, row.lastIndexOf('d'), 'w')
  } else if (m === 'spot') {
    // Below the sprite's first row (the rows above it are the hat's room).
    const y = out.findIndex((r, i) => i > HAT_PAD && !r.includes('K') && r.includes('w'))
    const row = out[y]
    if (row !== undefined && row[6] === 'o') out[y] = setAt(row, 6, 'd')
  }
  return out
}

// A sprite with its marking and hat; the engine has padded it HAT_PAD rows
// on top, where the hat goes. Facing left, before any flip. Asleep, the
// loaf keeps its hat on.
function dress(rows: Rows, m: string, hat: string): Rows {
  const out = mark(rows, m)
  const h = HAT_ROWS[hat]
  if (!h) return out
  const bottom = rows.findIndex(r => r.includes('o')) + 1
  const x0 = 4 - Math.floor((h[0]?.length ?? 0) / 2)
  h.forEach((line, i) => {
    const y = bottom - (h.length - 1) + i
    const row = out[y]
    if (row === undefined) return
    let next = row
    for (let x = 0; x < line.length; x++) if (line.charAt(x) !== '.') next = setAt(next, x0 + x, line.charAt(x))
    out[y] = next
  })
  return out
}

export const HERO: Hero = {
  walk: [WALK_A, WALK_B],
  stride: 160,
  rush: 100,
  idle: { frames: [SIT, SIT_WAG], period: 1.2, tick: 600 },
  asleep: LOAF.map(r => r.replace(/[HK]/g, 'd')),
  dress,
  hatPal: HAT_PAL,
}

const BASE: Palette = { H: 0xffffff, K: 0x1f1e1d, r: 0xf4a4a0, n: 0xe8737a, w: 0xfbefe4 }
export const COATS = {
  orange: { ...BASE, o: 0xd97757, d: 0x9e4f36 }, // Claude orange
  tuxedo: { ...BASE, o: 0x2e2e33, d: 0x141416, K: 0xb8d86a, w: 0xf7f7f7 },
  black: { ...BASE, o: 0x1f1f24, d: 0x050506, K: 0xf2c94c, w: 0x3a3a42, r: 0x8a4a55 },
  grey: { ...BASE, o: 0x9aa0a6, d: 0x5f6368, w: 0xeceff1 },
  cream: { ...BASE, o: 0xf1d6a8, d: 0xc49a5e },
  sakura: { ...BASE, o: 0xf6b8c8, d: 0xd4869c, n: 0xd9566b },
} satisfies Record<string, Palette>
