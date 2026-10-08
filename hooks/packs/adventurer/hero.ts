import { HAT_PAD, HERO_COLS } from '../../engine/geometry'
import type { HatDef, Hero, Palette, Rows } from '../types'
import { SLEEP, STAND, WALK_A, WALK_B } from './sprites'

// The adventurer as the engine sees it: walk frames, the idle pose, asleep,
// blinks, and dress() for markings and hats.

// Lying flat, in the bottom half of the 10-row box, so the bed lifts it onto
// its surface like any other sleeper.
const ASLEEP: Rows = [...Array(10 - SLEEP.length).fill('.'.repeat(HERO_COLS)), ...SLEEP]

// Closed eyes: the eye-shine row becomes skin, the eye row a lash line.
function closeEyes(rows: Rows): Rows {
  return rows.map(r => (r.includes('H') ? r.replace(/[HK]/g, 'o') : r.replace(/K/g, 'd')))
}

// Markings: a trinket rolled once per install. Their colours ride in hatPal,
// so none of these letters may be an outfit letter.
export const MARKINGS = ['none', 'scarf', 'belt', 'cape']
const MARK_LOOK: Record<string, string> = { scarf: 'a red scarf', belt: 'a leather belt', cape: 'a blue cape' }

function mark(rows: Rows, m: string): Rows {
  const out = [...rows]
  const body = out.map((r, y) => (/[tT]/.test(r) ? y : -1)).filter(y => y >= 0)
  if (!body.length) return out
  if (m === 'scarf') {
    const y = body[0]
    out[y] = out[y].replace(/t/g, 'c').replace(/T/g, 'C')
  } else if (m === 'belt') {
    const y = body[body.length - 1]
    out[y] = out[y].replace(/[tT]/g, 'e')
  } else if (m === 'cape' && rows !== ASLEEP) {
    // A strip down the back (the right, facing left), from the shoulders to the knees.
    for (let y = body[0]; y < Math.min(out.length - 1, body[0] + 3); y++) {
      const back = Math.max(out[y].lastIndexOf('t'), out[y].lastIndexOf('T'), out[y].lastIndexOf('P'))
      if (back >= 0 && back + 1 < HERO_COLS && out[y][back + 1] === '.') out[y] = out[y].slice(0, back + 1) + 'v' + out[y].slice(back + 2)
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

export const HATS: HatDef[] = [
  { id: 'feather', label: 'Feather', need: s => s.turns >= 10, hint: '10 finished tasks' },
  { id: 'horns', label: 'Horned helm', need: s => s.tools >= 100, hint: '100 tool calls' },
  { id: 'crown', label: 'Crown', need: s => s.turns >= 150, hint: '150 finished tasks' },
  { id: 'wizard', label: 'Wizard hat', need: s => s.tools >= 500, hint: '500 tool calls' },
]

// A sprite with its marking and hat, padded HAT_PAD rows on top. Asleep, the
// hat stays off: it would stand up off a head lying on its side.
function dress(rows: Rows, m: string, hat: string): Rows {
  const out = [...Array(HAT_PAD).fill('.'.repeat(HERO_COLS)), ...mark(rows, m)]
  const h = HAT_ROWS[hat]
  if (!h || rows === ASLEEP) return out
  const [lines, x0] = h
  const top = rows.findIndex(r => r.includes('x'))
  if (top < 0) return out
  const bottom = HAT_PAD + top
  lines.forEach((line, i) => {
    const y = bottom - (lines.length - 1) + i
    if (y < 0) return
    let row = out[y]
    for (let x = 0; x < line.length; x++) if (line[x] !== '.' && x0 + x < HERO_COLS) row = row.slice(0, x0 + x) + line[x] + row.slice(x0 + x + 1)
    out[y] = row
  })
  return out
}

export function lookOf(marking: string): string {
  return MARK_LOOK[marking] ?? "plain traveller's clothes"
}

export const HERO: Hero = {
  walk: [WALK_A, WALK_B],
  stride: 160,
  rush: 100,
  sit: { frames: [STAND] },
  asleep: ASLEEP,
  closeEyes,
  dress,
  hatPal: HAT_PAL,
}
