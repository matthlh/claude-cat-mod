import type { Motion } from '../../types'
import type { Track } from '../packs/types'
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

// Where a track has the body `ms` into the leg: [dx, dy] in sprite px.
export function trackAt(track: Track, ms: number): [number, number] {
  let prev: [number, number, number] = [0, 0, 0]
  for (const key of track) {
    const [t, dx, dy] = key
    if (ms < t) {
      const k = t > prev[0] ? (ms - prev[0]) / (t - prev[0]) : 1
      return [prev[1] + (dx - prev[1]) * k, prev[2] + (dy - prev[2]) * k]
    }
    prev = key
  }
  return [prev[1], prev[2]]
}

// A track over a leg `dur` ms long as SMIL keyframes: [fraction of the leg,
// dx, dy], from 0 to 1, the same path trackAt walks.
export function trackKeys(track: Track, dur: number): [number, number, number][] {
  if (dur <= 0) return [[0, 0, 0], [1, 0, 0]]
  const out: [number, number, number][] = [[0, ...trackAt(track, 0)]]
  for (const [t, dx, dy] of track) {
    if (t > 0 && t < dur) out.push([t / dur, dx, dy])
  }
  out.push([1, ...trackAt(track, dur)])
  return out
}
