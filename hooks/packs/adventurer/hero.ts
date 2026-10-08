import { HERO_COLS } from '../../engine/geometry'
import type { HatArt, Hero, Palette, Rows } from '../types'
import { SLEEP, STAND, WALK_A, WALK_B } from './sprites'

// The adventurer as the engine sees it: walk frames, the idle pose, asleep,
// and dress() for markings and hats. Blinks are the engine's own closeEyes.

// Lying flat, in the bottom half of the 10-row box, so the bed lifts it onto
// its surface like any other sleeper.
const ASLEEP: Rows = [...Array.from({ length: 10 - SLEEP.length }, () => '.'.repeat(HERO_COLS)), ...SLEEP]

// Markings: a trinket rolled once per install. Their colours ride in hatPal,
// so none of these letters may be an outfit letter.
export const MARKINGS = ['none', 'scarf', 'belt', 'cape']
const MARK_LOOK: Record<string, string> = { scarf: 'a red scarf', belt: 'a leather belt', cape: 'a blue cape' }

// The body's rows: those with shirt (t, T) under the head, from the row just
// below the head's outline (the last row with an x) down. A raised arm beside
// the head is not the body, so a scarf goes round the neck and a cape down
// the back in every pose, however the arms move. Lying down, the head and
// body share rows: then every row with shirt in it.
function bodyRows(rows: Rows): number[] {
  let below = 0
  rows.forEach((r, y) => {
    if (r.includes('x')) below = y + 1
  })
  const shirt = (r: string) => /[tT]/.test(r)
  const under = rows.map((r, y) => (y >= below && shirt(r) ? y : -1)).filter(y => y >= 0)
  return under.length ? under : rows.map((r, y) => (shirt(r) ? y : -1)).filter(y => y >= 0)
}

function mark(rows: Rows, m: string, asleep: boolean): Rows {
  const out = [...rows]
  const body = bodyRows(out)
  const first = body[0]
  const last = body[body.length - 1]
  if (first === undefined || last === undefined) return out
  if (m === 'scarf') {
    out[first] = (out[first] ?? '').replace(/t/g, 'c').replace(/T/g, 'C')
  } else if (m === 'belt') {
    out[last] = (out[last] ?? '').replace(/[tT]/g, 'e')
  } else if (m === 'cape' && !asleep) {
    // A strip down the back (the right, facing left), from the shoulders to
    // the knees: just behind the body's shade, where the back is open.
    for (let y = first; y < Math.min(out.length - 1, first + 3); y++) {
      const row = out[y] ?? ''
      const back = Math.max(row.lastIndexOf('T'), row.lastIndexOf('P'))
      if (back >= 0 && back + 1 < HERO_COLS && row[back + 1] === '.') out[y] = row.slice(0, back + 1) + 'v' + row.slice(back + 2)
    }
  }
  return out
}

// Hats, facing left: [rows, x of their left column]. Their bottom row lies on
// the top of the head's outline.
const HAT_ROWS: Record<string, [Rows, number]> = {
  feather: [['...F', '..FQ', '.FQ.'], 6],
  horns: [['U........U', '.U......U.', '.UNNNNNNU.'], 1],
  crown: [['Y.YY.Y', 'YRYYRY'], 3],
  wizard: [['.....M..', '....MM..', '...MZM..', '..MMMMM.', 'WWWWWWWW'], 2],
}
const HAT_PAL: Palette = {
  // markings
  c: 0xd94a4a, C: 0xa83434, e: 0x5a3a22, v: 0x3a5fb8,
  // hats
  F: 0xe5484d, Q: 0xffd0d2, U: 0xf0e6cc, N: 0x7d8796, Y: 0xf5c542, R: 0xe5484d, M: 0x2f5fb8, W: 0x22468c, Z: 0xf5c542,
}

// One hat for each of the engine's unlock tiers, in order (engine/hats.ts).
export const HATS: HatArt[] = [
  { id: 'feather', label: 'Feather' },
  { id: 'horns', label: 'Horned helm' },
  { id: 'crown', label: 'Crown' },
  { id: 'wizard', label: 'Wizard hat' },
]

// A sprite with its marking and hat; the engine has padded it HAT_PAD rows on
// top, where the hat goes. Asleep, the hat stays off: it would stand up off a
// head lying on its side.
function dress(rows: Rows, m: string, hat: string, asleep: boolean): Rows {
  const out = mark(rows, m, asleep)
  const h = HAT_ROWS[hat]
  if (!h || asleep) return out
  const [lines, x0] = h
  const top = rows.findIndex(r => r.includes('x'))
  if (top < 0) return out
  lines.forEach((line, i) => {
    const y = top - (lines.length - 1) + i
    let row = out[y]
    if (row === undefined) return
    for (let x = 0; x < line.length; x++) if (line[x] !== '.' && x0 + x < HERO_COLS) row = row.slice(0, x0 + x) + line[x] + row.slice(x0 + x + 1)
    out[y] = row
  })
  return out
}

// What /cat says the adventurer wears.
export function describeLook(marking: string): string {
  return MARK_LOOK[marking] ?? "plain traveller's clothes"
}

export const HERO: Hero = {
  walk: [WALK_A, WALK_B],
  stride: 160,
  rush: 100,
  idle: { frames: [STAND] },
  asleep: ASLEEP,
  dress,
  hatPal: HAT_PAL,
}
