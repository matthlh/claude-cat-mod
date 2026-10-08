import type { Palette, Rows } from '../types'

// ── Companions ───────────────────────────────────────────────────────────
// y yarn, Y yarn shine, g mouse, t mouse tail, B wings, k body. Facing left.
export const YARN = ['.yyy.', 'yYyyy', 'yyYyy', 'yyyYy', '.yyy.']
export const MOUSE_A = ['.gg....', 'gKgggg.', '.gggggt', '..g.g..']
export const MOUSE_B = ['.gg....', 'gKgggg.', '.gggggt', '.g...g.']
export const FLY_OPEN = ['BB.BB', 'BBkBB', '.BkB.']
export const FLY_SHUT = ['.BkB.', '.BkB.', '..k..']
// b bird, p beak, q legs; f fish, F fin.
export const BIRD = ['.bb..', 'pbbbb', '.bbb.', '..q..']
export const BIRD_PECK = ['.....', '.bb..', 'pbbbb', '.bbq.']
export const BIRD_UP = ['.b.b.', 'pbbbb', '..bb.', '.....']
export const BIRD_DOWN = ['.....', 'pbbbb', 'bb.bb', '.....']
export const FISH = ['fffF', '.ffF']
export const TOYS: Palette = {
  b: 0x9c7a5b,
  p: 0xf2b544,
  q: 0x5d4037,
  f: 0xf2994a,
  F: 0xf7c59f,
  y: 0xe0566b,
  Y: 0xf5a3ae,
  g: 0xa7adb4,
  K: 0x1f1e1d,
  t: 0xf4a4a0,
  B: 0x8f8cf2,
  k: 0x2b2840,
}

// Props: a book, a laptop, a terminal, a magnifying glass; a table and a mug.
// These face right.
export const TOOL_ROWS: Record<string, Rows> = {
  read: ['.wwcww.', 'wwwcwww', 'wwwcwww', 'ccccccc'],
  edit: ['kkkkk..', 'ksssk..', 'ksssk..', 'kkkkk..', 'ggggggg'],
  bash: ['kkkkkk', 'kGkkkk', 'kkGkkk', 'kGkGGk', 'kkkkkk', '..gg..'],
  search: ['.ggg..', 'gWWWg.', 'gWWWg.', '.ggg..', '....h.', '.....h'],
}
export const TABLE = ['TTTTTTT', 't.....t', 't.....t', 't.....t']
export const MUG = ['MMM.', 'MMMm', 'MMM.']
export const PROP_COLORS: Palette = {
  k: 0x2b2b33, s: 0x6fb3ff, g: 0xb0b6bf, G: 0x3fb950, w: 0xf5f0e6, c: 0xb5523b, W: 0xcfe8f3, h: 0x8a5a3c,
  T: 0x9a6b47, t: 0x7a5234, M: 0xe8e4da, m: 0xc9c3b5,
}

// Fishing spots, by scene: G glass, W water, w ripple, s sand, P plant, k stand.
export type Spot = { rows: Rows; swim?: [number, number, number] } // fish x range and row
const BOWL: Spot = { rows: ['.G....G.', 'G......G', 'GWWWWWWG', 'GWWWWWWG', 'GWWWWWWG', '.GWWWWG.', '..GGGG..'], swim: [1, 3, 3] }
const TANK: Spot = {
  rows: ['GGGGGGGGGG', 'G........G', 'GWWWWWWWWG', 'GWWWWWWWWG', 'GWWWWWWPWG', 'GWWWWWPWWG', 'GssssssPsG', 'kkkkkkkkkk'],
  swim: [1, 5, 3],
}
const RIVER: Spot = { rows: ['..WwWWWWWwWW..', '.WWWWWwWWWWWW.', 'WWWWWWWWWWWWWW'] }
export const SPOTS: Record<string, Spot> = { clear: BOWL, cozy: TANK, grass: RIVER, night: RIVER }
export const SPOT_PAL: Palette = { G: 0xcfe8f3, W: 0x3f8fd6, w: 0x9fd0f5, s: 0xe3c78a, P: 0x4caf50, k: 0x5a4a3f }
