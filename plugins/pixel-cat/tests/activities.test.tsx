import { test, expect } from 'claude-code/testing'
import { coatOf } from '../hooks/engine/lane'
import { DEFAULT_PACK } from '../hooks/packs/index'
import { laneSvg, laneCells } from '../hooks/register'

const ORANGE = coatOf(DEFAULT_PACK, 'orange')

const activities = [
  'walk', 'sit', 'groom', 'nap', 'hop', 'yarn', 'mouse', 'butterfly', 'caught', 'bird', 'flyaway', 'fish', 'laser',
  'knock', 'shove', 'meter', 'sitmeter', 'busy',
] as const
const still = new Set(['sit', 'groom', 'nap', 'fish', 'caught', 'flyaway', 'shove', 'sitmeter', 'busy'])
const scenes = ['clear', 'grass', 'night', 'cozy'] as const
const props = ['read', 'edit', 'bash', 'search', null] as const
const hats = ['none', 'party', 'beanie', 'wizard', 'crown'] as const
const markings = ['none', 'blaze', 'socks', 'tip', 'spot'] as const
const cellsLength = Math.ceil((80 * 5 * 12) / 3) * 4

test('every activity, prop, hat, marking and perch draws on both surfaces in every scene', () => {
  const now = 50_000
  for (const scene of scenes) {
    for (const [i, activity] of activities.entries()) {
      const m = { from: 0.4, to: still.has(activity) ? 0.4 : 0.6, t0: now - 500, dur: 3000, activity, hit: true }
      const c = { mood: 'idle' as const, dir: 1 as const, say: 'hi', sayAt: now - 500, prop: props[i % props.length] }
      const extras = {
        ctx: (i * 13) % 100,
        identity: { marking: markings[i % markings.length] ?? 'none', shiny: i % 2 === 0 },
        hat: hats[i % hats.length] ?? 'none',
        hour: (i * 5) % 24,
      }
      expect(laneSvg(c, m, now, ORANGE, scene, extras)).toContain('<svg')
      expect(laneCells(c, m, now, ORANGE, 80, scene, extras).length).toBe(cellsLength)
    }
    const asleep = { mood: 'sleep' as const, dir: -1 as const, say: null }
    const bed = laneSvg(asleep, { from: 0.5, to: 0, t0: now - 200, dur: 5000, activity: 'bed' }, now, ORANGE, scene)
    expect(bed).toContain('fill="freeze"') // the perch sliding in
    laneCells(asleep, { from: 0, to: 0, t0: now, dur: 0, activity: 'perch' }, now, ORANGE, 80, scene, { hat: 'wizard' })
  }
})
