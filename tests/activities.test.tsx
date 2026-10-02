import { test, expect } from 'claude-code/testing'
import { laneSvg, laneCells, PALETTES } from '../hooks/register'

const activities = ['walk', 'sit', 'nap', 'hop', 'yarn', 'mouse', 'butterfly', 'caught', 'bird', 'flyaway', 'fish', 'laser'] as const
const scenes = ['clear', 'grass', 'night', 'cozy'] as const

test('every activity and the perch draw on both surfaces in every scene', () => {
  const now = 50_000
  for (const scene of scenes) {
    for (const activity of activities) {
      const m = { from: 0.4, to: activity === 'fish' || activity === 'caught' || activity === 'flyaway' ? 0.4 : 0.6, t0: now - 500, dur: 3000, activity, hit: true }
      const c = { mood: 'idle' as const, dir: 1 as const, say: 'hi', sayAt: now - 500 }
      expect(laneSvg(c, m, now, PALETTES.orange, scene)).toContain('<svg')
      expect(laneCells(c, m, now, PALETTES.orange, 80, scene).length).toBe(Math.ceil((80 * 5 * 12) / 3) * 4)
    }
    const asleep = { mood: 'sleep' as const, dir: -1 as const, say: null }
    const bed = laneSvg(asleep, { from: 0.5, to: 0, t0: now - 200, dur: 5000, activity: 'bed' }, now, PALETTES.orange, scene)
    expect(bed).toContain('fill="freeze"') // the perch sliding in
    laneCells(asleep, { from: 0, to: 0, t0: now, dur: 0, activity: 'perch' }, now, PALETTES.orange, 80, scene)
  }
})
