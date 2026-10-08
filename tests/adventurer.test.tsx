import { test, expect } from 'claude-code/testing'
import { nextLeg, planLeg } from '../hooks/engine/brain'
import { laneCells } from '../hooks/engine/cells'
import { LANE_ROWS } from '../hooks/engine/geometry'
import { laneSvg } from '../hooks/engine/svg'
import { PACKS } from '../hooks/packs/index'
import { MOB_PAL, TOOL_PAL } from '../hooks/packs/adventurer/sprites'
import { laneSvg as registerSvg, laneCells as registerCells } from '../hooks/register'
import type { Pack } from '../hooks/packs/types'
import type { HeroState, Motion, ToolProp } from '../types'

// Every pack's activities, through every moment of a leg, in every scene and
// both directions: packs.test.tsx draws each once; this walks the whole leg,
// where the tracks come and go, and holds every frame under the desktop cap.

const SVG_CAP = 131_072
const COLS = 80
const cellsLength = (cols: number) => Math.ceil((cols * LANE_ROWS * 12) / 3) * 4
const MOMENTS = [0, 0.05, 0.25, 0.5, 0.75, 0.95, 1.2]
const PROPS: (ToolProp | null)[] = ['read', 'edit', 'bash', 'search', null]

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function decodeCells(s: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < s.length; i += 4) {
    const n = (B64.indexOf(s[i]) << 18) | (B64.indexOf(s[i + 1]) << 12) | ((B64.indexOf(s[i + 2]) & 63) << 6) | (B64.indexOf(s[i + 3]) & 63)
    bytes.push((n >> 16) & 255)
    if (s[i + 2] !== '=') bytes.push((n >> 8) & 255)
    if (s[i + 3] !== '=') bytes.push(n & 255)
  }
  const out: number[] = []
  for (let i = 0; i + 3 < bytes.length; i += 4) out.push((bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0)
  return out
}

// Every colour on the terminal raster, as [column, colour] for each half cell drawn.
function inks(s: string, cols = COLS): [number, number][] {
  const cells = decodeCells(s)
  const out: [number, number][] = []
  for (let i = 0; i < cells.length / 3; i++) {
    const [ch, fg, bg] = cells.slice(i * 3, i * 3 + 3)
    if (ch === 0x2580 || ch === 0x2584) out.push([i % cols, fg])
    if (ch === 0x2580) out.push([i % cols, bg])
  }
  return out
}

test('every activity of every pack draws through its whole leg, in every scene, under the svg cap', () => {
  const t0 = 50_000
  const dur = 4000
  for (const pack of Object.values(PACKS)) {
    const coat = pack.coats[pack.defaults.coat]
    const hats = ['none', ...pack.hats.map(h => h.id)]
    for (const scene of Object.keys(pack.scenes)) {
      for (const [i, activity] of Object.keys(pack.activities).entries()) {
        const a = pack.activities[activity]
        const still = !!a.move && 'stay' in a.move
        for (const hit of [true, false]) {
          const m: Motion = { from: 0.3, to: still ? 0.3 : 0.6, t0, dur, activity, hit }
          for (const [j, k] of MOMENTS.entries()) {
            const now = t0 + k * dur
            for (const dir of [1, -1] as const) {
              const c: HeroState = { mood: activity === pack.roles.work ? 'working' : 'idle', dir, say: j % 2 ? 'hi' : null, sayAt: t0, prop: PROPS[(i + j) % PROPS.length] }
              const x = { ctx: (j * 17) % 100, identity: { marking: pack.markings[j % pack.markings.length] ?? 'none', shiny: j === 0 }, hat: hats[(i + j) % hats.length], hour: (i * 5 + j * 7) % 24 }
              const svg = laneSvg(pack, c, m, now, coat, scene, x)
              expect(svg).toContain('<svg')
              if (svg.length >= SVG_CAP) throw new Error(`${pack.id} ${activity} in ${scene} at ${k}: ${svg.length} chars`)
              expect(laneCells(pack, c, m, now, coat, COLS, scene, x).length).toBe(cellsLength(COLS))
            }
          }
        }
      }
    }
  }
})

test('the adventurer draws through the hooks entry points, in every outfit and at every hour', () => {
  const pack = PACKS.adventurer
  const now = 50_000
  const m: Motion = { from: 0.4, to: 0.4, t0: now - 1000, dur: 5200, activity: 'mine' }
  const c: HeroState = { mood: 'idle', dir: 1, say: null }
  for (const outfit of Object.keys(pack.coats)) {
    for (const scene of Object.keys(pack.scenes)) {
      for (let hour = 0; hour < 24; hour += 3) {
        const svg = registerSvg(c, m, now, pack.coats[outfit], scene, { pack: 'adventurer', hour, ctx: hour * 4 })
        expect(svg.length).toBeLessThan(SVG_CAP)
        expect(registerCells(c, m, now, pack.coats[outfit], COLS, scene, { pack: 'adventurer' }).length).toBe(cellsLength(COLS))
      }
    }
  }
})

test("a swung tool stays in the hero's hand: the pose and the tool share one clock", () => {
  const pack = PACKS.adventurer
  const coat = pack.coats[pack.defaults.coat]
  const pose = pack.activities.mine.pose
  if (!pose || typeof pose !== 'object') throw new Error('mine has a pose of its own')
  const tick = pose.tick ?? 500
  const tool = new Set(Object.values(TOOL_PAL))
  // A leg that starts off the tick, so a clock counted from the leg would be out.
  const m: Motion = { from: 0.4, to: 0.4, t0: 10_123, dur: 5200, activity: 'mine' }
  const c: HeroState = { mood: 'idle', dir: 1, say: null }
  const heroX = Math.round(0.4 * (COLS - 13))
  for (let now = 10_200; now < 14_000; now += 97) {
    const up = Math.floor(now / tick) % 2 === 0
    const cols = inks(laneCells(pack, c, m, now, coat, COLS, 'forest')).filter(([, ink]) => tool.has(ink)).map(([x]) => x)
    // Raised, the pickaxe is behind the hero (it faces right); struck, ahead of it.
    expect(cols.some(x => (up ? x < heroX : x >= heroX + 12))).toBe(true)
  }
  // The desktop cycles the tool over the pose's own period.
  const svg = laneSvg(pack, c, m, 12_000, coat, 'forest')
  expect(svg.split(`dur="${pose.period}s"`).length - 1).toBeGreaterThanOrEqual(4)
})

test('a fight brings a slime to the forest by day, and a zombie after dark', () => {
  const pack = PACKS.adventurer
  const coat = pack.coats[pack.defaults.coat]
  const c: HeroState = { mood: 'idle', dir: 1, say: null }
  const slime = MOB_PAL.j
  const zombie = MOB_PAL.z
  const at = (hour: number, scene: string) => {
    const t0 = new Date(2026, 9, 8, hour, 0, 0).getTime()
    const m: Motion = { from: 0.3, to: 0.3, t0, dur: 3000, activity: 'fight', hit: false }
    return inks(laneCells(pack, c, m, t0 + 2900, coat, COLS, scene)).map(([, ink]) => ink)
  }
  expect(at(12, 'forest')).toContain(slime)
  expect(at(12, 'forest')).not.toContain(zombie)
  expect(at(23, 'forest')).toContain(zombie)
  expect(at(12, 'cavern')).toContain(zombie)
})

test('the mined block breaks: before the break its blocks stand ahead, after it they are gone', () => {
  const pack = PACKS.adventurer
  const coat = pack.coats[pack.defaults.coat]
  const c: HeroState = { mood: 'idle', dir: 1, say: null }
  const m: Motion = { from: 0.3, to: 0.3, t0: 0, dur: 5000, activity: 'mine' }
  const heroX = Math.round(0.3 * (COLS - 13))
  const ahead = (now: number) => inks(laneCells(pack, c, m, now, coat, COLS, 'cavern')).filter(([x]) => x >= heroX + 13 && x < heroX + 21).length
  expect(ahead(2000)).toBeGreaterThan(40)
  expect(ahead(4950)).toBe(0)
})

test('an activity that stays put repeats as its pack asks', () => {
  const pack: Pack = PACKS.adventurer
  const { leg } = planLeg(pack, 0, 'idle', 0.3, 'mine', 'normal', 1)
  expect(leg.chain).toBe(1)
  const next = nextLeg(pack, leg, { isHungry: false, isLow: false, isLate: false, isSaying: false })
  expect(next.activity).toBe('mine')
  expect(next.chain).toBe(0)
})

test("every pack says done and oops in its own words", () => {
  for (const pack of Object.values(PACKS)) {
    expect(pack.text.done(42)).toContain('42')
    expect(pack.text.oops.length).toBeGreaterThan(0)
  }
  expect(PACKS.cat.text.done(42)).toBe('done! 42s')
  expect(PACKS.cat.text.oops).toBe('hit an error :(')
})
