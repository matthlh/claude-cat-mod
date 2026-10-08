import { closeEyes } from '../../engine/draw'
import type { Crew, Palette, Rows } from '../types'

// Kittens, one for each agent at work, trotting after the cat. 7x5, facing
// left like the cat: o fur, d tail, K eye, w chest. Their coats go round by
// slot, so a litter is never all one colour.
const HEAD = ['.o..o..', 'oooooo.']
const SIT_A = [...HEAD, 'oKooKo.', '.owwo.d', '.oooodd']
// The tail flicks up.
const SIT_B = [...HEAD, 'oKooKo.', '.owwo.d', '.ooood.']
const WALK_A = [...HEAD, 'oKooKod', '.owwood', '.o..o.o']
const WALK_B = [...HEAD, 'oKooKod', '.owwood', '..o.o..']
// A crouch, paw out, for pouncing along with the cat.
const POUNCE: Rows = ['.......', ...HEAD, 'oKooKod', 'oowwood']

const EYES: Palette = { K: 0x1f1e1d }
const KITTEN_COATS: [Palette, ...Palette[]] = [
  { ...EYES, o: 0xe39a6a, d: 0xa8603a, w: 0xfbefe4 }, // ginger
  { ...EYES, o: 0xa3a9b0, d: 0x60666d, w: 0xeef0f2 }, // grey
  { ...EYES, o: 0xf0d9b0, d: 0xc39d64, w: 0xfff8ec }, // cream
  { ...EYES, o: 0x2a2a30, d: 0x0c0c0e, w: 0x55555e, K: 0xf2c94c }, // black, gold eyes
  { ...EYES, o: 0x8a6a52, d: 0x4e3a2c, w: 0xf2e6d8 }, // brown tabby
]

export const KITTENS: Crew = {
  move: [WALK_A, WALK_B],
  stride: 140,
  idle: { frames: [SIT_A, SIT_A, SIT_B], tick: 600 },
  act: { frames: [POUNCE] },
  cheer: closeEyes(SIT_A),
  coats: KITTEN_COATS,
  gap: 2,
  lag: 260,
}
