import { test, expect } from 'claude-code/testing'
import { laneCells, PALETTES } from '../hooks/register'
import type { Activity, Cat, Mood, Motion, Scene, ToolProp } from '../types'
import { FRAMES } from './frames.fixture'

// The golden test draws each leg at its start, 30%, 70% and after, so a
// terminal animation timed between those moments (a mug sliding off a table
// at 40-60%, a butterfly's flaps, a pounce) is not pinned there. This draws
// every activity's whole leg on the terminal every 41 ms, in every scene,
// both ways, on two coats, and pins each run to one hash of all its frames.
// The table was checked against the drawings before the pack refactor
// (ce8436f): the same hashes come out of that commit.
//
// A change here is a change to a terminal animation. If one is intended, set
// PRINT to true, copy the printed table over tests/frames.fixture.ts, and set
// it back to false.
const PRINT = false

const SCENES: Scene[] = ['clear', 'grass', 'night', 'cozy']
const DIRS = [1, -1] as const
const COATS = ['orange', 'black'] as const
const COLS = 60
const STEP = 41
const SPAN: [number, number] = [0.3, 0.72]
const SPOT = 0.5

type Leg = { name: string; activity?: Activity; moves: boolean; dur: number; mood?: Mood; hit?: boolean; prop?: ToolProp }
const LEGS: Leg[] = [
  { name: 'walk', activity: 'walk', moves: true, dur: 2600 },
  { name: 'none:walk', moves: true, dur: 3000 },
  { name: 'none:pause', moves: false, dur: 3000 },
  { name: 'sit', activity: 'sit', moves: false, dur: 6000, mood: 'sit' },
  { name: 'groom', activity: 'groom', moves: false, dur: 6500 },
  { name: 'nap', activity: 'nap', moves: false, dur: 15_000 },
  { name: 'hop', activity: 'hop', moves: true, dur: 3000 },
  { name: 'yarn', activity: 'yarn', moves: true, dur: 2600 },
  { name: 'mouse', activity: 'mouse', moves: true, dur: 1600 },
  { name: 'butterfly', activity: 'butterfly', moves: true, dur: 4000 },
  { name: 'caught', activity: 'caught', moves: false, dur: 3000 },
  { name: 'bird', activity: 'bird', moves: true, dur: 5000 },
  { name: 'flyaway', activity: 'flyaway', moves: false, dur: 3000 },
  { name: 'fish:hit', activity: 'fish', moves: false, dur: 9000, hit: true },
  { name: 'fish:miss', activity: 'fish', moves: false, dur: 9000, hit: false },
  { name: 'laser', activity: 'laser', moves: true, dur: 1200 },
  { name: 'bed', activity: 'bed', moves: true, dur: 4200 },
  { name: 'perch', activity: 'perch', moves: false, dur: 0, mood: 'sleep' },
  { name: 'busy:bash', activity: 'busy', moves: false, dur: 6000, mood: 'working', prop: 'bash' },
  { name: 'busy:read', activity: 'busy', moves: false, dur: 6000, mood: 'working', prop: 'read' },
  { name: 'knock', activity: 'knock', moves: true, dur: 3000 },
  { name: 'shove', activity: 'shove', moves: false, dur: 3600 },
  { name: 'meter', activity: 'meter', moves: true, dur: 4000 },
  { name: 'sitmeter', activity: 'sitmeter', moves: false, dur: 9000 },
]

// FNV-1a over UTF-16 code units: only compared with itself.
function fnv(s: string, h = 0x811c9dc5): number {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h >>> 0
}

type Run = { label: string; hash: () => string }

function runs(): Run[] {
  const out: Run[] = []
  for (const leg of LEGS) {
    for (const scene of SCENES) {
      for (const dir of DIRS) {
        const label = `${leg.name} ${scene} ${dir === 1 ? 'R' : 'L'}`
        const hash = () => {
          let h = 0x811c9dc5
          for (const coat of COATS) {
            const t0 = 40_000
            const [from, to] = leg.activity === 'perch' ? [0, 0] : leg.moves ? (dir === 1 ? SPAN : [SPAN[1], SPAN[0]]) : [SPOT, SPOT]
            // The whole leg, and a little after it ends.
            for (let el = 0; el <= Math.max(leg.dur, 4000) + 400; el += STEP) {
              const m: Motion = { from, to, t0, dur: leg.dur }
              if (leg.activity !== undefined) m.activity = leg.activity
              if (leg.hit !== undefined) m.hit = leg.hit
              const c: Cat = { mood: leg.mood ?? 'idle', dir, say: null }
              if (leg.prop) c.prop = leg.prop
              const x = { ctx: 50, identity: { marking: 'none', shiny: false }, hat: 'none', hour: 12 }
              h = fnv(laneCells(c, m, t0 + el, PALETTES[coat], COLS, scene, x), h)
            }
          }
          return (h >>> 0).toString(16).padStart(8, '0')
        }
        out.push({ label, hash })
      }
    }
  }
  return out
}

test("every activity's terminal frames over its whole leg, every 41 ms, are as pinned", { timeoutMs: 120_000 }, () => {
  const got = runs().map(r => `${r.label} ${r.hash()}`)
  if (PRINT) {
    console.log(['// frames.fixture.ts begin', ...got, '// frames.fixture.ts end'].join('\n'))
    throw new Error(`PRINT is on: printed ${got.length} runs; copy them into tests/frames.fixture.ts and turn it off`)
  }
  const want = FRAMES.trim().split('\n')
  expect(got.length).toBe(want.length)
  const changed = got.flatMap((g, i) => (g === want[i] ? [] : [`${g} (was ${want[i]?.split(' ').pop()})`]))
  expect({ changed: changed.length, first: changed.slice(0, 12) }).toEqual({ changed: 0, first: [] })
})
