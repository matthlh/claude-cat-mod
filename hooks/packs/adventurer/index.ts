import { clamp01 } from '../../engine/draw'
import type { Pack, Palette, Rows } from '../types'
import { ACTIVITIES } from './activities'
import { HATS, HERO, lookOf, MARKINGS } from './hero'
import { OUTFITS } from './sprites'
import { ADVENTURER_WORLD } from './world'

// A potion bottle shows how much context is left: full when fresh, drained
// near the limit. Ten cells of potion, filled from the bottom.
const POTION_PAL: Palette = { c: 0xa0683a, g: 0xcfe3ec, e: 0x41525a, R: 0xe5484d, W: 0xffc2c4 }
const BOTTLE: Rows = ['..cc..', '..gg..', '.g..g.', 'g....g', 'g....g', '.gggg.']
// The inside, bottom row first: [row, column] of each cell.
const INSIDE: [number, number][] = [[4, 1], [4, 2], [4, 3], [4, 4], [3, 1], [3, 2], [3, 3], [3, 4], [2, 2], [2, 3]]
function potionRows(ctx: number): Rows {
  const n = Math.round(INSIDE.length * clamp01(1 - ctx / 100))
  const rows = BOTTLE.map(r => [...r])
  INSIDE.forEach(([y, x], i) => {
    rows[y][x] = i < n ? 'R' : 'e'
  })
  // A glint on the glass while there is potion behind it.
  if (n >= 6) rows[3][1] = 'W'
  return rows.map(r => r.join(''))
}

export const adventurer: Pack = {
  id: 'adventurer',
  label: 'Adventurer',
  noun: 'adventurer',
  hero: HERO,
  coats: OUTFITS,
  scenes: ADVENTURER_WORLD,
  markings: MARKINGS,
  hats: HATS,
  defaults: { coat: 'starter', scene: 'forest' },
  activities: ACTIVITIES,
  roles: { stroll: 'walk', rest: 'stand', work: 'busy' },
  gauge: ctx => ({ rows: potionRows(ctx), pal: POTION_PAL }),
  text: {
    hello: 'ready for adventure!',
    bedtime: 'time to rest…',
    outOfJuice: 'out of stamina… camping',
    hungry: 'my potion is almost gone…',
    fed: 'glug glug! potion refilled',
    pet: ['heh, thanks!', 'onward!', '♥', 'feeling brave'],
    petAsleep: ['five more minutes…', '*snore*'],
    shown: 'Adventurer is back ⚔️',
    hidden: 'Adventurer hidden (run /cat again to bring it back).',
    look: id => lookOf(id.marking),
    done: secs => `quest done! ${secs}s`,
    oops: 'ouch! an error',
  },
  toasts: {
    hat: label => `⚔️ Your adventurer found a hat: ${label}! Wear it from ⚙ → Hat`,
    finished: secs => `⚔️ Claude finished (${secs}s)`,
    failed: '⚔️ Claude stopped on an error',
    usage: (label, pct) => `⚔️ ${label} usage at ${pct}%`,
  },
}
