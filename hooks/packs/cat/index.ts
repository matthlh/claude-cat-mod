import { clamp01 } from '../../engine/draw'
import type { Pack, Palette } from '../types'
import { ACTIVITIES } from './activities'
import { SCENES } from './scenes'
import { COATS, HERO, MARKINGS } from './sprites'

// The food bowl shows how much context is left: full when fresh, empty near the limit.
const BOWL_PAL: Palette = { F: 0xd39a5b, f: 0xa86a35, B: 0xd9534f, b: 0xa83a37 }
function bowlRows(ctx: number): string[] {
  const n = Math.round(12 * clamp01(1 - ctx / 100))
  const low = Math.min(6, n)
  const high = Math.max(0, n - 6)
  const fill = (k: number, ch: string) => '.' + ch.repeat(k).padEnd(6, '.') + '.'
  return [fill(high, 'F'), fill(low, 'f'), 'BBBBBBBB', '.bbbbbb.']
}

export const cat: Pack = {
  id: 'cat',
  label: 'Cat',
  noun: 'cat',
  coatLabel: 'Coat',
  hero: HERO,
  coats: COATS,
  scenes: SCENES,
  markings: MARKINGS,
  // One hat for each of the engine's unlock tiers (engine/hats.ts).
  hats: [
    { id: 'party', label: 'Party hat' },
    { id: 'beanie', label: 'Beanie' },
    { id: 'crown', label: 'Crown' },
    { id: 'wizard', label: 'Wizard hat' },
  ],
  defaults: { coat: 'orange', scene: 'clear' },
  activities: ACTIVITIES,
  roles: { stroll: 'walk', rest: 'sit', work: 'busy' },
  gauge: ctx => ({ rows: bowlRows(ctx), pal: BOWL_PAL }),
  text: {
    hello: 'hi!',
    bedtime: 'bedtime…',
    outOfJuice: 'out of juice… nap time',
    hungry: 'my bowl is almost empty…',
    fed: 'nom nom! bowl refilled',
    pet: ['purrr ♥', 'mrrp!', '♥ ♥ ♥', 'more pets pls'],
    petAsleep: ['mrrp?', '*yawn*'],
    shown: 'Cat is back 🐱',
    hidden: 'Cat hidden (run /cat again to bring it back).',
    look: id => (id.marking === 'none' ? 'plain coat' : `${id.marking} marking`),
    done: secs => `done! ${secs}s`,
    oops: 'hit an error :(',
  },
  toasts: {
    hat: label => `🎩 Your cat unlocked a hat: ${label}! Wear it from ⚙ → Hat`,
    finished: secs => `🐱 Claude finished (${secs}s)`,
    failed: '🐱 Claude stopped on an error',
    usage: (label, pct) => `🐱 ${label} usage at ${pct}%`,
  },
}
