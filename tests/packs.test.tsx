import { test, expect } from 'claude-code/testing'
import { nextLeg, planLeg } from '../hooks/engine/brain'
import { laneCells } from '../hooks/engine/cells'
import { LANE_ROWS } from '../hooks/engine/geometry'
import { lookOf } from '../hooks/engine/lane'
import { RESERVED_ACTIVITIES, trackAt, trackKeys } from '../hooks/engine/motion'
import { laneSvg } from '../hooks/engine/svg'
import { DEFAULT_PACK, PACKS, packProblems } from '../hooks/packs/index'
import type { Activity, Pack } from '../hooks/packs/types'
import type { Motion } from '../types'

// Checks every registered pack, not just the default one, so a new pack is
// covered the moment it is added to hooks/packs/index.ts.

const SVG_CAP = 131_072
const COLS = 80
const cellsLength = (cols: number) => Math.ceil((cols * LANE_ROWS * 12) / 3) * 4

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
// The terminal raster back into [char, fg, bg] cells.
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

test('every pack passes its own checks and reserves bedtime', () => {
  expect(Object.keys(PACKS).length).toBeGreaterThan(0)
  for (const pack of Object.values(PACKS)) {
    expect(packProblems(pack)).toEqual([])
    for (const id of RESERVED_ACTIVITIES) expect(Object.hasOwn(pack.activities, id)).toBe(false)
  }
  // And the checks do catch what they are for.
  const bad: Pack = { ...DEFAULT_PACK, activities: { ...DEFAULT_PACK.activities, bed: {} }, roles: { ...DEFAULT_PACK.roles, stroll: 'nope' } }
  expect(packProblems(bad).length).toBe(2)
})

test("every pack's follow-ups and roles lead to activities it has", () => {
  for (const pack of Object.values(PACKS)) {
    const has = (id: string) => Object.hasOwn(pack.activities, id)
    for (const id of Object.values(pack.roles)) expect(has(id)).toBe(true)
    for (const [id, a] of Object.entries(pack.activities)) {
      if (!a.then) continue
      // `then` may roll dice: ask it often, after a hit, a miss and neither.
      for (let i = 0; i < 60; i++) {
        const leg: Motion = { from: 0.4, to: 0.6, t0: 0, dur: 1000, activity: id, hit: [true, false, undefined][i % 3], chain: i % 4 }
        const f = a.then(leg)
        if (f && !has(f.activity)) throw new Error(`pack '${pack.id}': '${id}' leads to '${f.activity}', which it does not have`)
      }
    }
  }
})

test('every activity of every pack draws on both surfaces, within the svg cap', () => {
  const now = 50_000
  for (const pack of Object.values(PACKS)) {
    const coat = pack.coats[pack.defaults.coat]
    const hats = ['none', ...pack.hats.map(h => h.id)]
    const markings = ['none', ...pack.markings, 'not-a-marking']
    for (const scene of Object.keys(pack.scenes)) {
      for (const [i, activity] of Object.keys(pack.activities).entries()) {
        const a = pack.activities[activity]
        const still = !!a.move && 'stay' in a.move
        const m: Motion = { from: 0.4, to: still ? 0.4 : 0.6, t0: now - 500, dur: 3000, activity, hit: i % 2 === 0 }
        for (const dir of [1, -1] as const) {
          const c = { mood: 'idle' as const, dir, say: 'hi', sayAt: now - 500, prop: (['read', 'edit', 'bash', 'search', null] as const)[i % 5] }
          const x = { ctx: (i * 13) % 100, identity: { marking: markings[i % markings.length], shiny: i % 2 === 0 }, hat: hats[i % hats.length], hour: (i * 5) % 24 }
          const svg = laneSvg(pack, c, m, now, coat, scene, x)
          expect(svg).toContain('<svg')
          expect(svg.length).toBeLessThan(SVG_CAP)
          expect(laneCells(pack, c, m, now, coat, COLS, scene, x).length).toBe(cellsLength(COLS))
        }
      }
      const asleep = { mood: 'sleep' as const, dir: -1 as const, say: null }
      expect(laneSvg(pack, asleep, { from: 0.5, to: 0, t0: now - 200, dur: 5000, activity: 'bed' }, now, coat, scene)).toContain('fill="freeze"')
      expect(laneSvg(pack, asleep, { from: 0, to: 0, t0: now, dur: 0, activity: 'perch' }, now, coat, scene).length).toBeLessThan(SVG_CAP)
      expect(laneCells(pack, asleep, { from: 0, to: 0, t0: now, dur: 0, activity: 'perch' }, now, coat, COLS, scene).length).toBe(cellsLength(COLS))
    }
  }
})

test('a pack with no weights for a column strolls instead of crashing', () => {
  const activities: Record<string, Activity> = {}
  for (const [id, a] of Object.entries(DEFAULT_PACK.activities)) activities[id] = { ...a, weight: a.weight && { day: a.weight.day } }
  const pack: Pack = { ...DEFAULT_PACK, activities }
  const prev: Motion = { from: 0.5, to: 0.5, t0: 0, dur: 0 }
  for (const s of [{ isLow: true, isLate: false }, { isLow: false, isLate: true }]) {
    const n = nextLeg(pack, prev, { isHungry: false, isSaying: false, ...s })
    expect(n.activity).toBe(pack.roles.stroll)
  }
})

test("a marking from another pack becomes one of this pack's own, the same every time", () => {
  for (const pack of Object.values(PACKS)) {
    for (const m of ['none', ...pack.markings]) expect(lookOf(pack, { marking: m, shiny: false }).marking).toBe(m)
    const foreign = lookOf(pack, { marking: 'not-a-marking', shiny: true })
    expect(foreign.shiny).toBe(true)
    expect(pack.markings.length ? pack.markings.includes(foreign.marking) : foreign.marking === 'none').toBe(true)
    expect(lookOf(pack, { marking: 'not-a-marking', shiny: true }).marking).toBe(foreign.marking)
  }
})

test('an identity saved without a marking still draws, in every pack', () => {
  const now = 50_000
  const m: Motion = { from: 0.4, to: 0.4, t0: now - 500, dur: 3000 }
  const c = { mood: 'idle' as const, dir: 1 as const, say: null }
  for (const pack of Object.values(PACKS)) {
    // What a pack with no markings once rolled: pick([]) is undefined.
    const broken = { marking: undefined as unknown as string, shiny: true }
    const look = lookOf(pack, broken)
    expect(typeof look.marking).toBe('string')
    expect(look.shiny).toBe(true)
    const coat = pack.coats[pack.defaults.coat]
    expect(laneSvg(pack, c, m, now, coat, pack.defaults.scene, { identity: broken })).toContain('<svg')
    expect(laneCells(pack, c, m, now, coat, COLS, pack.defaults.scene, { identity: broken }).length).toBe(cellsLength(COLS))
  }
})

test('poses take any number of frames, and layers stack the same on both surfaces', () => {
  const pack = DEFAULT_PACK
  const coat = pack.coats[pack.defaults.coat]
  const { hero } = pack
  const INK = 0x123456
  const block = Array.from({ length: 10 }, () => 'q'.repeat(12))
  const ink = { q: INK }
  const mark = '#123456'
  const layer = { svg: () => `<g id="probe"><rect fill="${mark}"/></g>`, cells: (x: { x: number; plot(r: string[], x: number, y: number, p: Record<string, number>): void }) => x.plot(block, x.x, 0, ink) }
  const withAct = (a: Activity): Pack => ({ ...pack, activities: { ...pack.activities, probe: a } })
  const m: Motion = { from: 0, to: 0, t0: 0, dur: 100_000, activity: 'probe' }
  const c = { mood: 'idle' as const, dir: -1 as const, say: null }

  // Three frames: three opacity steps on the desktop, a three-tick cycle on the terminal.
  const three = withAct({ move: { stay: 100_000 }, pose: { frames: [hero.sit.frames[0], hero.walk[0], hero.walk[1]], period: 0.6, tick: 100, shut: true } })
  const svg = laneSvg(three, c, m, 1000, coat, pack.defaults.scene)
  for (const v of ['1;0;0', '0;1;0', '0;0;1']) expect(svg).toContain(`values="${v}"`)
  const at = (t: number) => laneCells(three, c, m, t, coat, COLS, pack.defaults.scene)
  expect(at(1000)).not.toBe(at(1100))
  expect(at(1100)).not.toBe(at(1200))
  expect(at(1000)).toBe(at(1300))

  // `draw` is beneath the hero, `over` on top, on both surfaces.
  const heroCells = (cells: number[]) => {
    const out: number[] = []
    for (let y = 0; y < LANE_ROWS; y++) for (let x = 0; x < 12; x++) out.push(cells[(y * COLS + x) * 3 + 1], cells[(y * COLS + x) * 3 + 2])
    return out
  }
  const under = withAct({ move: { stay: 100_000 }, draw: layer })
  const over = withAct({ move: { stay: 100_000 }, over: layer })
  expect(heroCells(decodeCells(laneCells(over, c, m, 1000, coat, COLS, pack.defaults.scene))).every(v => v === INK)).toBe(true)
  expect(heroCells(decodeCells(laneCells(under, c, m, 1000, coat, COLS, pack.defaults.scene))).some(v => v !== INK)).toBe(true)
  const body = (s: string) => s.indexOf(`<g transform="translate(0 -12)">`)
  const svgUnder = laneSvg(under, c, m, 1000, coat, pack.defaults.scene)
  const svgOver = laneSvg(over, c, m, 1000, coat, pack.defaults.scene)
  expect(svgUnder.indexOf('id="probe"')).toBeLessThan(body(svgUnder))
  expect(svgOver.indexOf('id="probe"')).toBeGreaterThan(body(svgOver))

  // A stage is drawn in the lane's own frame, where pct(1) is the far end.
  const staged = withAct({
    move: { stay: 100_000 },
    stage: { svg: s => `<rect id="stage" x="${s.pct(1)}" width="3" height="3"/>`, cells: s => s.plot(['q'], s.col(1), 9, ink) },
  })
  const stageSvg = laneSvg(staged, c, m, 1000, coat, pack.defaults.scene)
  expect(stageSvg).toMatch(/<svg x="0" y="12" width="100%"[^>]*><g shape-rendering="crispEdges"><rect id="stage" x="85\.000%"/)
  const cells = decodeCells(laneCells(staged, c, m, 1000, coat, COLS, pack.defaults.scene))
  const span = COLS - 12 - 1
  expect(cells[(4 * COLS + span) * 3 + 1]).toBe(INK)
})

test('a hit chance is rolled on moving legs as well as legs on the spot', () => {
  const pack = (a: Activity): Pack => ({ ...DEFAULT_PACK, activities: { ...DEFAULT_PACK.activities, probe: a } })
  for (const move of [undefined, { near: [0.1, 0.2] }, { zip: [0.1, 0.3] }, { spot: 0.8 }, { stay: 1000 }] as Activity['move'][]) {
    for (let i = 0; i < 20; i++) {
      expect(planLeg(pack({ move, hit: 1 }), 0, 'idle', 0.3, 'probe', 'normal').leg.hit).toBe(true)
      expect(planLeg(pack({ move, hit: 0 }), 0, 'idle', 0.3, 'probe', 'normal').leg.hit).toBe(false)
    }
    // No chance, no roll: a moving leg carries no hit at all.
    const plain = planLeg(pack({ move }), 0, 'idle', 0.3, 'probe', 'normal').leg
    if (!move || !('stay' in move)) expect(Object.hasOwn(plain, 'hit')).toBe(false)
    expect(plain.hit).toBeUndefined()
  }
  const bad = { ...DEFAULT_PACK, activities: { ...DEFAULT_PACK.activities, probe: { hit: 2 }, probe2: { arc: [[100, 0, 0], [50, 1, 1]] as [number, number, number][] } } }
  expect(packProblems(bad).length).toBe(2)
})

test("a target is crisp pixel art on the desktop, like every other layer", () => {
  const pack = DEFAULT_PACK
  const coat = pack.coats[pack.defaults.coat]
  const c = { mood: 'idle' as const, dir: 1 as const, say: null }
  const m: Motion = { from: 0.2, to: 0.6, t0: 0, dur: 10_000, activity: 'probe' }
  const withTarget = (svg: string): Pack => ({ ...pack, activities: { ...pack.activities, probe: { target: { svg: () => svg, cells: () => {} } } } })
  const plain = laneSvg(withTarget('<rect id="t"/>'), c, m, 1000, coat, pack.defaults.scene)
  expect(plain).toMatch(/overflow="visible"><g shape-rendering="crispEdges"><rect id="t"\/><\/g><\/svg>/)
  // One that sets its own edges says so, and is left as it is, on either layer.
  const own = '<g shape-rendering="crispEdges"><rect id="t"/></g>'
  const ownTarget = { ...pack, activities: { ...pack.activities, probe: { target: { svg: () => own, cells: () => {}, ownEdges: true } } } }
  expect(laneSvg(ownTarget, c, m, 1000, coat, pack.defaults.scene)).toContain(`overflow="visible">${own}</svg>`)
  const ownStage = { ...pack, activities: { ...pack.activities, probe: { stage: { svg: () => own, cells: () => {}, ownEdges: true } } } }
  expect(laneSvg(ownStage, c, m, 1000, coat, pack.defaults.scene)).toContain(`width="100%" height="30" overflow="visible">${own}</svg>`)
  // Without the flag the engine names nothing about the markup: it wraps it.
  expect(laneSvg(withTarget(own), c, m, 1000, coat, pack.defaults.scene)).toContain(`overflow="visible"><g shape-rendering="crispEdges">${own}</g></svg>`)
})

test("an activity's track moves the hero's body on both surfaces, and lets go when the leg ends", () => {
  // A leap forward and back down, then a knockback held to the end.
  const arc: [number, number, number][] = [[200, 4, -3], [400, 6, 0], [400, -2, 0], [600, -2, 0]]
  expect(trackAt(arc, 0)).toEqual([0, 0])
  expect(trackAt(arc, 100)).toEqual([2, -1.5])
  expect(trackAt(arc, 400)).toEqual([-2, 0])
  expect(trackAt(arc, 5000)).toEqual([-2, 0])
  expect(trackKeys(arc, 1000)).toEqual([[0, 0, 0], [0.2, 4, -3], [0.4, 6, 0], [0.4, -2, 0], [0.6, -2, 0], [1, -2, 0]])

  const pack = DEFAULT_PACK
  const coat = pack.coats[pack.defaults.coat]
  const probe: Pack = { ...pack, activities: { ...pack.activities, probe: { move: { stay: 1000 }, arc } } }
  const plain: Pack = { ...pack, activities: { ...pack.activities, probe: { move: { stay: 1000 } } } }
  const m: Motion = { from: 0.5, to: 0.5, t0: 0, dur: 1000, activity: 'probe' }
  for (const dir of [1, -1] as const) {
    const c = { mood: 'idle' as const, dir, say: null }
    const svg = laneSvg(probe, c, m, 100, coat, pack.defaults.scene)
    expect(svg).toContain(`values="0 0;${dir * 12} -9;${dir * 18} 0;${dir * -6} 0;${dir * -6} 0;${dir * -6} 0" keyTimes="0;0.2;0.4;0.4;0.6;1" dur="1000ms" begin="-100ms"/>`)
    expect(laneSvg(probe, c, m, 2000, coat, pack.defaults.scene)).not.toContain('keyTimes="0;0.2')

    // The terminal: the body where the track has it, then back on its spot.
    const ink = (pk: Pack, now: number) => {
      const cells = decodeCells(laneCells(pk, c, m, now, coat, COLS, pack.defaults.scene))
      const cols: number[] = []
      for (let x = 0; x < COLS; x++) {
        for (let y = 0; y < LANE_ROWS; y++) if (cells[(y * COLS + x) * 3] !== 0x20) { cols.push(x); break }
      }
      return cols[0]
    }
    expect(ink(probe, 500) - ink(plain, 500)).toBe(dir * -2)
    expect(ink(probe, 300) - ink(plain, 300)).toBe(dir * 5)
    expect(ink(probe, 2000)).toBe(ink(plain, 2000))
  }
})
