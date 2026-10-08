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
    const arc = a.arc
    const bad = arc?.some((k, i) => k.length !== 3 || !k.every(Number.isFinite) || k[0] < 0 || (i > 0 && k[0] < arc[i - 1][0]))
    if (bad) out.push(`activities.${id}.arc is not [ms, dx, dy] keys in time order`)
    if (a.hit !== undefined && !(a.hit >= 0 && a.hit <= 1)) out.push(`activities.${id}.hit is ${a.hit}, not a chance from 0 to 1`)
  }
  if (!Object.hasOwn(pack.scenes, pack.defaults.scene)) out.push(`defaults.scene '${pack.defaults.scene}' is not one of its scenes`)
  if (!Object.hasOwn(pack.coats, pack.defaults.coat)) out.push(`defaults.coat '${pack.defaults.coat}' is not one of its coats`)
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

// Every pack, by id. A new pack is one folder and one entry here.
export const PACKS: Record<string, Pack> = admit([cat, adventurer])

export const DEFAULT_PACK = cat

export function packFor(id: string | undefined): Pack {
  return id !== undefined && Object.hasOwn(PACKS, id) ? PACKS[id] : DEFAULT_PACK
}
