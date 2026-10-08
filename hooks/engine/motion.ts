import type { Motion } from '../../types'
import { clamp01 } from './draw'

// Bedtime's two legs, kept as activities so the state contract is unchanged:
// walking back to the bed, then asleep in it.
export const TO_BED = 'bed'
export const IN_BED = 'perch'

export function posAt(m: Motion, now: number): number {
  if (m.dur <= 0) return m.to
  return m.from + (m.to - m.from) * clamp01((now - m.t0) / m.dur)
}

export function isWalking(m: Motion, now: number): boolean {
  return m.from !== m.to && now < m.t0 + m.dur
}
