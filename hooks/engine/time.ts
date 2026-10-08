// The time of day, one definition for every pack: the scene skies, the
// night weights and anything an activity draws differently after dark.

import type { Phase } from '../../types'

export type { Phase }

// A whole local hour, 0..23; anything that is not a number reads as noon.
export function hourOf(hour: number): number {
  return Number.isFinite(hour) ? ((Math.floor(hour) % 24) + 24) % 24 : 12
}

// Night from 21:00 to 4:59, dawn at 5 and 6, dusk from 18 to 20, else day.
export function phaseAt(hour: number): Phase {
  const h = hourOf(hour)
  if (h >= 21 || h < 5) return 'night'
  if (h < 7) return 'dawn'
  if (h >= 18) return 'dusk'
  return 'day'
}
