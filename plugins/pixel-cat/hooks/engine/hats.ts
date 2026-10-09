import type { Stats } from '../../types'
import type { HatDef, Pack } from '../packs/types'

// What unlocks a hat is the engine's, the same in every pack: four tiers.
// A pack brings one hat for each tier (Pack.hats, in this order), and its
// art, so a tier unlocked in one pack is unlocked in all of them.
export const HAT_TIERS: readonly { need(s: Stats): boolean; hint: string }[] = [
  { need: s => s.turns >= 10, hint: '10 finished tasks' },
  { need: s => s.tools >= 100, hint: '100 tool calls' },
  { need: s => s.turns >= 150, hint: '150 finished tasks' },
  { need: s => s.tools >= 500, hint: '500 tool calls' },
]

/** A pack's hats with what unlocks each one, in tier order. */
export function hatsOf(pack: Pack): HatDef[] {
  const out: HatDef[] = []
  pack.hats.forEach((h, i) => {
    const tier = HAT_TIERS[i]
    if (tier) out.push({ ...h, need: tier.need, hint: tier.hint })
  })
  return out
}

/** The ids of a pack's hats that these counts have unlocked. */
export function unlockedHats(pack: Pack, s: Stats): string[] {
  return hatsOf(pack)
    .filter(h => h.need(s))
    .map(h => h.id)
}

/** The label a hat id goes by in a pack ('none' and unknown ids by their id). */
export function hatLabel(pack: Pack, id: string): string {
  return pack.hats.find(h => h.id === id)?.label ?? (id === 'none' ? 'None' : id)
}
