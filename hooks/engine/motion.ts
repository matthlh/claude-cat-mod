import type { Motion } from '../../types'
import { clamp01 } from './draw'

// Bedtime's two legs, kept as activity ids so the state contract is
// unchanged: walking back to the bed, then asleep in it. They are the only
// ids the engine names, and they are reserved: no pack may define them
// (packs/index.ts refuses one that does), so bedtime always draws the same.
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
