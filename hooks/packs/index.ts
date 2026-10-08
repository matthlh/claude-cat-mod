import { cat } from './cat/index'
import type { Pack } from './types'

// Every pack, by id. A new pack is one folder and one line here.
export const PACKS: Record<string, Pack> = {
  [cat.id]: cat,
}

export const DEFAULT_PACK = cat

export function packFor(id: string | undefined): Pack {
  return id !== undefined && Object.hasOwn(PACKS, id) ? PACKS[id] : DEFAULT_PACK
}
