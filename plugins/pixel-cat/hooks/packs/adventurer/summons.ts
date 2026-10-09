import type { Crew, CrewKind, Rows } from '../types'
import { MINIONS } from './minions'
import type { Minion, MinionId } from './minions'

// The adventurer's followers: a summoned minion for each agent at work. The
// kind goes by slot, in the order of MINIONS: one kind for each of the five
// places in sight, so an agent keeps its creature for as long as it keeps its
// slot (engine/crew.ts never moves a follower that is in sight). Agents
// waiting out of sight go round the kinds again, and take the kind of the
// place they step into. Flyers hover behind the hero, a little
// off the ground and bobbing; the rest keep to the ground, the slime in hops.
// In a fight they dash at the foe in their attack frame (activities.ts);
// while the hero sleeps they settle on the ground by the bed, eyes shut.

/** The kinds, in the order the slots take them. */
export const SUMMON_ORDER = Object.keys(MINIONS) as MinionId[]

/** The kind the follower in `slot` is. */
export function summonFor(slot: number): MinionId {
  const n = SUMMON_ORDER.length
  return SUMMON_ORDER[((slot % n) + n) % n] ?? 'imp'
}

/**
 * Sprite px a flyer hovers off the ground: an 8-row minion in the 10-row
 * lane, one off the ground and one more on its bob's up step.
 */
const HOVER = 1

// Shut eyes: the top row of an eye (white e, pupil K) a dark lash line (d),
// any row of it below that the colour beside it.
function shutEyes(rows: Rows): Rows {
  let lid = -1
  const beside = (row: string, x: number) => {
    for (let d = 1; d < row.length; d++) {
      for (const ch of [row[x - d], row[x + d]]) if (ch !== undefined && !'.eKd'.includes(ch)) return ch
    }
    return 'd'
  }
  return rows.map((row, y) => {
    if (!/[eK]/.test(row)) return row
    if (lid < 0 || lid === y) {
      lid = y
      return row.replace(/[eK]/g, 'd')
    }
    return [...row].map((ch, x) => (ch === 'e' || ch === 'K' ? beside(row, x) : ch)).join('')
  })
}

function kindOf(m: Minion): CrewKind {
  const kind: CrewKind = {
    // A flyer's wings, a slime's squash and stretch, a spider's legs: the
    // idle frames are its way of getting about too.
    move: m.idle,
    stride: m.tick,
    idle: { frames: m.idle, tick: m.tick },
    act: { frames: [m.attack] },
    cheer: shutEyes(m.idle[0]),
    rest: { frames: [shutEyes(m.idle[0])], shut: true },
    coats: [m.pal],
  }
  if (m.flying) kind.flying = { height: HOVER, bob: 1 }
  return kind
}

const KINDS = SUMMON_ORDER.map(id => kindOf(MINIONS[id]))
const FIRST = MINIONS[SUMMON_ORDER[0] ?? 'imp']

/**
 * Pixels between the hero and the first minion, and between minions: room
 * for a tool raised behind the head (a pickaxe reaches 6 columns past the
 * hero's back) to swing nearly clear of the first, which hovers at head
 * height.
 */
export const SUMMON_GAP = 4

export const SUMMONS: Crew = {
  // The crew's own art is the first kind's, on the ground: every kind
  // replaces all of it, and the flyers add their hover.
  move: FIRST.idle,
  stride: FIRST.tick,
  idle: { frames: FIRST.idle, tick: FIRST.tick },
  coats: [FIRST.pal],
  gap: SUMMON_GAP,
  lag: 220,
  kinds: KINDS,
}
