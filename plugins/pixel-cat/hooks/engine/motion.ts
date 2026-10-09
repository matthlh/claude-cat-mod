import type { Motion } from '../../types'
import type { Dir } from '../packs/types'
import { clamp01 } from './draw'

// Bedtime's two legs, kept as activity ids so the state contract is
// unchanged: walking back to the bed, then asleep in it. They are the only
// ids the engine names, and they are reserved: no pack may define them
// (packs/index.ts refuses one that does), so bedtime always draws the same.
//
// 'perch' is the cat's word for its bed, and the one cat name left in the
// engine, on purpose: it is a stored Motion.activity (a saved lane asleep
// reloads as one), and tests/golden.test.tsx, which is frozen, draws its
// bedtime cases by passing 'bed' and 'perch' straight in. Renaming either
// would break that contract for nothing: to the engine they are opaque ids,
// and what a pack shows for them is its own Scene.bed and Hero.asleep.
export const TO_BED = 'bed'
export const IN_BED = 'perch'
export const RESERVED_ACTIVITIES: readonly string[] = [TO_BED, IN_BED]

export function posAt(m: Motion, now: number): number {
  if (m.dur <= 0) return m.to
  return m.from + (m.to - m.from) * clamp01((now - m.t0) / m.dur)
}

export function isWalking(m: Motion, now: number): boolean {
  return m.from !== m.to && now < m.t0 + m.dur
}

/** The same leg: a state write that changed nothing about where the hero goes. */
export function sameLeg(a: Motion, b: Motion): boolean {
  return a.t0 === b.t0 && a.dur === b.dur && a.from === b.from && a.to === b.to && a.activity === b.activity
}

/** Which way the hero faces on a leg: the way it walks, or `dir` (HeroState.dir) on the spot. */
export function legDir(m: Motion, dir: Dir): Dir {
  return m.to > m.from ? 1 : m.to < m.from ? -1 : dir
}
