import { crewArts, crewSprites } from '../engine/crew'
import { HERO_COLS, LANE_PIX } from '../engine/geometry'
import { HAT_TIERS } from '../engine/hats'
import { RESERVED_ACTIVITIES } from '../engine/motion'
import { adventurer } from './adventurer/index'
import { cat } from './cat/index'
import type { Pack } from './types'

// What is wrong with a pack that the types cannot catch, or nothing.
export function packProblems(pack: Pack): string[] {
  const out: string[] = []
  for (const id of RESERVED_ACTIVITIES) {
    if (Object.hasOwn(pack.activities, id)) out.push(`defines '${id}', which is reserved for bedtime`)
  }
  for (const [role, id] of Object.entries(pack.roles)) {
    if (!Object.hasOwn(pack.activities, id)) out.push(`roles.${role} is '${id}', which is not one of its activities`)
  }
  for (const [id, a] of Object.entries(pack.activities)) {
    if (a.hit !== undefined && !(a.hit >= 0 && a.hit <= 1)) out.push(`activities.${id}.hit is ${a.hit}, not a chance from 0 to 1`)
    const d = a.crew?.during
    if (d && !(d[0] >= 0 && d[0] < d[1] && d[1] <= 1)) out.push(`activities.${id}.crew.during is [${d.join(', ')}], not a part of the leg from 0 to 1`)
  }
  for (const art of pack.crew ? crewArts(pack.crew) : []) {
    const room = LANE_PIX - (art.flying?.height ?? 0)
    if (crewSprites(art).some(r => r.length > room || r.some(row => row.length > HERO_COLS))) out.push(`crew sprites must be at most ${HERO_COLS} wide and ${room} tall`)
  }
  if (!Object.hasOwn(pack.scenes, pack.defaults.scene)) out.push(`defaults.scene '${pack.defaults.scene}' is not one of its scenes`)
  if (!Object.hasOwn(pack.coats, pack.defaults.coat)) out.push(`defaults.coat '${pack.defaults.coat}' is not one of its coats`)
  if (pack.hats.length > HAT_TIERS.length) out.push(`has ${pack.hats.length} hats, more than the ${HAT_TIERS.length} unlock tiers`)
  const ids = pack.hats.map(h => h.id)
  if (ids.includes('none') || new Set(ids).size !== ids.length) out.push(`hat ids must be unique and not 'none'`)
  return out
}

// A pack with a problem is refused loudly here, rather than drawing the wrong
// thing at bedtime or wandering off on a typo.
function admit(packs: Pack[]): Record<string, Pack> {
  const out: Record<string, Pack> = {}
  for (const pack of packs) {
    const problems = packProblems(pack)
    if (problems.length) throw new Error(`pack '${pack.id}': ${problems.join('; ')}`)
    out[pack.id] = pack
  }
  return out
}

// Every pack, by id. A new pack is one folder, plus an import and an entry in
// admit([...]) here.
export const PACKS: Record<string, Pack> = admit([cat, adventurer])

export const DEFAULT_PACK = cat

export function packFor(id: string | undefined): Pack {
  return (id !== undefined && Object.hasOwn(PACKS, id) && PACKS[id]) || DEFAULT_PACK
}
