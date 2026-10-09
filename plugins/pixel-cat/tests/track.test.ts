import { test, expect } from 'claude-code/testing'
import { coatOf } from '../hooks/engine/lane'
import { laneCells } from '../hooks/engine/cells'
import { faceRight } from '../hooks/engine/draw'
import { HERO_W, LANE_ROWS, MAX_X, PX } from '../hooks/engine/geometry'
import { laneSvg } from '../hooks/engine/svg'
import { appear, fallOver, GROUND, layers, perLeg, popTo, sample, track } from '../hooks/engine/track'
import type { Key, Sprite, TrackDraw } from '../hooks/engine/track'
import { DEFAULT_PACK } from '../hooks/packs/index'
import type { Activity, CellsCtx, Dir, Draw, Pack, Rows, SvgCtx } from '../hooks/packs/types'
import type { Motion } from '../types'

// A 2 x 2 sprite facing left, each pixel its own colour so a mirror shows.
const ROCK: Rows = ['ab', 'cd']
const ROCK2: Rows = ['ba', 'dc']
const PAL = { a: 0x000001, b: 0x000002, c: 0x000003, d: 0x000004 }
const T0 = 10_000
const DUR = 2000
const LEG: Motion = { from: 0.5, to: 0.5, t0: T0, dur: DUR, activity: 'probe' }
const HX = 20 // the hero's left column in the fake terminal frame
const SPAN = 60

// The contexts the engine hands a layer, built the way svg.ts and cells.ts build them.
function svgCtx(dir: Dir, now: number, m: Motion = LEG): SvgCtx {
  return {
    leg: m,
    hero: { mood: 'idle', dir, say: null },
    now,
    dir,
    scene: 'clear',
    hour: 12,
    phase: 'day',
    face: rows => (dir === 1 ? faceRight(rows) : rows),
    PX,
    walking: false,
    remaining: 0,
    ahead: (w, gap = 3) => (dir === 1 ? HERO_W + gap : -w - gap),
    at: ms => `${Math.round(m.t0 + ms - now)}ms`,
    pct: p => `${(Math.max(0, Math.min(1, p)) * MAX_X).toFixed(3)}%`,
  }
}

// What a layer plots, as sorted [x, y, colour] cells.
function cellsOf(d: Draw, dir: Dir, now: number, m: Motion = LEG): [number, number, number][] {
  const got = new Map<string, number>()
  const ctx: CellsCtx = {
    leg: m,
    hero: { mood: 'idle', dir, say: null },
    now,
    dir,
    scene: 'clear',
    hour: 12,
    phase: 'day',
    face: rows => (dir === 1 ? faceRight(rows) : rows),
    x: HX,
    ahead: (w, gap = 1) => (dir === 1 ? HX + 12 + gap : HX - w - gap),
    col: p => Math.round(p * SPAN),
    plot: (rows, x0, y0, pal) =>
      rows.forEach((row, y) => [...row].forEach((ch, x) => pal[ch] !== undefined && got.set(`${x0 + x},${y0 + y}`, pal[ch]))),
  }
  d.cells(ctx)
  return [...got].map(([k, c]) => [...k.split(',').map(Number), c] as [number, number, number]).sort((p, q) => p[0] - q[0] || p[1] - q[1])
}

// The rock's four cells with its top left at (x, y), facing the way `dir` says.
const rockAt = (x: number, y: number, dir: Dir): [number, number, number][] =>
  dir === 1
    ? [[x, y, 2], [x, y + 1, 4], [x + 1, y, 1], [x + 1, y + 1, 3]]
    : [[x, y, 1], [x, y + 1, 3], [x + 1, y, 2], [x + 1, y + 1, 4]]

const at = (t: number) => T0 + t * DUR

test('a track is SMIL keyed to the leg on the desktop, so a redraw mid-leg carries on', () => {
  const keys: Key[] = [[0, 0, 0], [0.5, 3, -2], [1, 6, 0]]
  const s = track({ frames: [ROCK, ROCK2], pal: PAL, tick: 200, keys })
  expect(s.layer).toBe('draw')
  const svg = s.svg(svgCtx(1, T0 + 500))
  // Hidden underneath, shown for the leg, gone with it.
  expect(svg).toStartWith('<g opacity="0"><animate attributeName="opacity" from="1" to="1" dur="2000ms" begin="-500ms" fill="remove"/>')
  // The keys as one translate, in CSS px.
  expect(svg).toContain('<animateTransform attributeName="transform" type="translate" values="0 0;9 -6;18 0" keyTimes="0;0.5;1" dur="2000ms" begin="-500ms" fill="freeze"/>')
  // The frames as opacity flips, from the leg's start.
  expect(svg).toContain('values="1;0" calcMode="discrete" dur="400ms" begin="-500ms" repeatCount="indefinite"')
  expect(svg).toContain('values="0;1" calcMode="discrete" dur="400ms" begin="-500ms" repeatCount="indefinite"')
  // One px ahead of the hero's twelve columns, resting on the ground.
  expect(svg).toContain(`<g transform="translate(${13 * PX} ${(GROUND - 2) * PX})">`)
  // Redrawn later in the leg, the same animations, begun further back.
  expect(s.svg(svgCtx(1, T0 + 1200))).toBe(svg.replaceAll('begin="-500ms"', 'begin="-1200ms"'))

  // A loop repeats the keys on its own clock; appear() starts it, and the frames, late.
  const hopKeys: Key[] = [[0, 0, 0], [0.5, 0, -2], [1, 0, 0]]
  const hop = track(appear(0.25, { frames: [ROCK, ROCK2], pal: PAL, tick: 100, hold: true, loop: 600, keys: hopKeys }))
  const hopSvg = hop.svg(svgCtx(1, T0 + 200))
  expect(hopSvg).toContain('values="0;1" keyTimes="0;0.25" calcMode="discrete" dur="2000ms" begin="-200ms" fill="remove"')
  expect(hopSvg).toContain('values="0 0;0 -6;0 0" keyTimes="0;0.5;1" dur="600ms" begin="300ms" repeatCount="indefinite"')
  // Held frames are timed over the leg, as anything that holds is: the last from 0.3 on.
  expect(hopSvg).toContain('values="0;1" keyTimes="0;0.3" calcMode="discrete" dur="2000ms" begin="-200ms" fill="freeze"')
  expect(hopSvg).toContain('values="1;0" keyTimes="0;0.3" calcMode="discrete" dur="2000ms" begin="-200ms" fill="freeze"')

  // A fade is an opacity animation over the same keyTimes; linger keeps the end.
  const fade = track({ frames: ROCK, pal: PAL, keys: [[0, 0, 0, 1], [1, 0, 0, 0]], linger: true, show: [0, 0.8] })
  const fadeSvg = fade.svg(svgCtx(1, T0))
  expect(fadeSvg).toContain('<animate attributeName="opacity" values="1;0" keyTimes="0;1" dur="2000ms" begin="0ms" fill="freeze"/>')
  expect(fadeSvg).toContain('values="1;0" keyTimes="0;0.8" calcMode="discrete" dur="2000ms" begin="0ms" fill="freeze"')
})

test('the terminal samples the keys at now and lands on the expected cells', () => {
  const keys: Key[] = [[0, 0, 0], [0.5, 2, -4], [1, 4, 0]]
  expect(sample(keys, 0)).toEqual([0, 0, 1])
  expect(sample(keys, 0.25)).toEqual([1, -2, 1])
  expect(sample(keys, 0.5)).toEqual([2, -4, 1])
  expect(sample(keys, 1)).toEqual([4, 0, 1])
  // Held before the first key and after the last; two keys at one t jump.
  expect(sample([[0.5, 3, 0], [0.5, 6, 2]], 0.2)).toEqual([3, 0, 1])
  expect(sample([[0.5, 3, 0], [0.5, 6, 2]], 0.5)).toEqual([6, 2, 1])

  const s = track({ frames: ROCK, pal: PAL, keys })
  const ahead = HX + 12 + 1
  const ground = GROUND - 2
  expect(cellsOf(s, 1, at(0))).toEqual(rockAt(ahead, ground, 1))
  expect(cellsOf(s, 1, at(0.25))).toEqual(rockAt(ahead + 1, ground - 2, 1))
  expect(cellsOf(s, 1, at(0.5))).toEqual(rockAt(ahead + 2, ground - 4, 1))
  expect(cellsOf(s, 1, at(1))).toEqual(rockAt(ahead + 4, ground, 1))

  // Frames by time from the leg's start, `tick` ms each.
  const two = track({ frames: [ROCK, ROCK2], pal: PAL, tick: 200 })
  expect(cellsOf(two, -1, at(0) + 100)).toEqual(rockAt(HX - 3, ground, -1))
  expect(cellsOf(two, -1, at(0) + 300)).toEqual(rockAt(HX - 3, ground, 1))
  expect(cellsOf(two, -1, at(0) + 500)).toEqual(rockAt(HX - 3, ground, -1))
})

test('a hero facing left is the exact mirror on both surfaces', () => {
  const keys: Key[] = [[0, 0, 0], [0.3, 3, -2], [0.6, -1, 1], [1, 5, -3]]
  const mirror = (cells: [number, number, number][]) =>
    cells.map(([x, y, c]) => [2 * HX + 12 - 1 - x, y, c] as [number, number, number]).sort((p, q) => p[0] - q[0] || p[1] - q[1])
  for (const anchor of ['ahead', 'hero', 'target', { spot: 0.4 }] as const) {
    const s = track({ frames: [['abc', 'dd.'], ['a.c', '.bd']], pal: PAL, anchor, keys, tick: 150, x: 1 })
    for (const t of [0, 0.15, 0.3, 0.45, 0.6, 0.8, 1]) {
      const right = cellsOf(s, 1, at(t))
      expect(right.length).toBeGreaterThan(0)
      // A spot mirrors about the hero's box there, as the others do about theirs.
      const shift = typeof anchor === 'object' ? 2 * (Math.round(0.4 * SPAN) - HX) : 0
      expect(cellsOf(s, -1, at(t))).toEqual(mirror(right).map(([x, y, c]) => [x + shift, y, c] as [number, number, number]))
    }
    // The desktop draws the same frame, turned about the hero's box.
    const still = track({ frames: ROCK, pal: PAL, anchor, keys, linger: true })
    const right = still.svg(svgCtx(1, T0 + 700))
    const left = still.svg(svgCtx(-1, T0 + 700))
    const turned = (inner: string) => `<g transform="matrix(-1 0 0 1 ${HERO_W} 0)">${inner}</g>`
    if (typeof anchor === 'object') {
      const open = '<svg x="34.000%" overflow="visible">'
      expect(right.startsWith(open) && left.startsWith(open)).toBe(true)
      expect(left).toBe(`${open}${turned(right.slice(open.length, -'</svg>'.length))}</svg>`)
    } else {
      expect(left).toBe(turned(right))
    }
  }
  // Rows that keep their own way round still change sides.
  const sign = track({ frames: ROCK, pal: PAL, mirror: false })
  expect(cellsOf(sign, 1, at(0))).toEqual(rockAt(HX + 13, GROUND - 2, -1))
  expect(cellsOf(sign, -1, at(0))).toEqual(rockAt(HX - 3, GROUND - 2, -1))
})

test('opacity 0 plots nothing, and show windows hide it on both surfaces', () => {
  const gone = track({ frames: ROCK, pal: PAL, keys: [[0, 0, 0, 0]] })
  expect(gone.svg(svgCtx(1, T0 + 100))).toBe('')
  for (const t of [0, 0.5, 1]) expect(cellsOf(gone, 1, at(t))).toEqual([])

  // Fading out: on the terminal while at least half there.
  const fade = track({ frames: ROCK, pal: PAL, keys: [[0, 0, 0, 1], [1, 0, 0, 0]] })
  expect(cellsOf(fade, 1, at(0.25)).length).toBe(4)
  expect(cellsOf(fade, 1, at(0.75))).toEqual([])

  const plain: Sprite = { frames: ROCK, pal: PAL }
  const late = track(appear(0.4, plain))
  const early = track({ ...plain, show: [0, 0.6] })
  expect(cellsOf(late, 1, at(0.3))).toEqual([])
  expect(cellsOf(late, 1, at(0.5)).length).toBe(4)
  expect(cellsOf(early, 1, at(0.5)).length).toBe(4)
  expect(cellsOf(early, 1, at(0.7))).toEqual([])
  expect(early.svg(svgCtx(1, T0))).toContain('values="1;0" keyTimes="0;0.6" calcMode="discrete"')

  // `only` leaves out a whole leg: a drop on a miss, say.
  const onHit = track({ ...plain, only: leg => !!leg.hit })
  expect(onHit.svg(svgCtx(1, T0))).toBe('')
  expect(cellsOf(onHit, 1, at(0.5))).toEqual([])
  expect(cellsOf(onHit, 1, at(0.5), { ...LEG, hit: true }).length).toBe(4)
})

test('popTo arcs a drop into the hero; fallOver tips on the desktop and swaps on the terminal', () => {
  const drop = popTo({ frames: ROCK, pal: PAL, at: 0.5, span: 0.2 })
  expect(drop.layer).toBe('over')
  expect(cellsOf(drop, 1, at(0.45))).toEqual([])
  expect(cellsOf(drop, 1, at(0.5))).toEqual(rockAt(HX + 13, GROUND - 2, 1))
  expect(cellsOf(drop, 1, at(0.6))).toEqual(rockAt(HX + 9, 2, 1)) // the top of the arc
  expect(cellsOf(drop, 1, at(0.6999))).toEqual(rockAt(HX + 5, 4, 1)) // centred on the hero
  expect(cellsOf(drop, 1, at(0.71))).toEqual([]) // caught
  expect(cellsOf(drop, -1, at(0.6999))).toEqual(rockAt(HX + 5, 4, -1))
  expect(popTo({ frames: ROCK, pal: PAL, at: 0.5, anchor: 'target' }).layer).toBe('target')

  const TREE: Rows = ['.aa.', 'aaaa', 'aaaa', '.bb.', '.bb.', '.bb.']
  const LOG: Rows = ['cccccd', 'cccccd']
  const tree = fallOver({ rows: TREE, fallen: LOG, pal: PAL, from: 0.5, to: 0.75 })
  expect(tree.layer).toBe('draw')
  const svg = tree.svg(svgCtx(1, T0 + 100))
  // About the middle of its foot, gathering speed, rising so its top lands on the ground.
  const fall = 'keyTimes="0;0.5;0.563;0.625;0.688;0.75;1" dur="2000ms" begin="-100ms" fill="freeze"'
  expect(svg).toContain(`type="rotate" values="0 6 18;0 6 18;5.625 6 18;22.5 6 18;50.625 6 18;90 6 18;90 6 18" ${fall}`)
  expect(svg).toContain(`type="translate" values="0 0;0 0;0 -0.375;0 -1.5;0 -3.375;0 -6;0 -6" ${fall}`)
  const standing = cellsOf(tree, 1, at(0.4))
  expect(standing.length).toBe(16)
  expect(Math.min(...standing.map(([x]) => x))).toBe(HX + 13)
  expect(cellsOf(tree, 1, at(0.6))).toEqual(standing)
  const fallen = cellsOf(tree, 1, at(0.8))
  expect(fallen.map(([x, y]) => [x, y])).toEqual([0, 1, 2, 3, 4, 5].flatMap(i => [[HX + 15 + i, 8], [HX + 15 + i, 9]]))
  expect(fallen.filter(([, , c]) => c === 4).map(([x]) => x)).toEqual([HX + 15, HX + 15]) // the cut end at the stump
  expect(cellsOf(tree, -1, at(0.8)).map(([x]) => x).sort((p, q) => p - q)[0]).toBe(2 * HX + 12 - 1 - (HX + 20))
})

test('layers() puts each track where its anchor says, in the frames the engine hands out', () => {
  const pack = DEFAULT_PACK
  const coat = coatOf(pack)
  const scene = pack.defaults.scene
  const COLS = 80
  const withAct = (a: Activity): Pack => ({ ...pack, activities: { ...pack.activities, probe: a } })
  const by = (layer: string, cells: Draw['cells']) => ({ [layer]: { svg: () => '', cells } }) as Activity
  const cases: [TrackDraw, string, Draw['cells']][] = [
    [track({ frames: ROCK, pal: PAL }), 'draw', ({ ahead, face, plot }) => plot(face(ROCK), ahead(2), 8, PAL)],
    [track({ frames: ROCK, pal: PAL, anchor: 'target' }), 'target', ({ ahead, face, plot }) => plot(face(ROCK), ahead(2), 8, PAL)],
    [track({ frames: ROCK, pal: PAL, anchor: 'hero', y: 3 }), 'over', ({ x, face, plot }) => plot(face(ROCK), x + 5, 3, PAL)],
    [track({ frames: ROCK, pal: PAL, anchor: { spot: 0.9 } }), 'stage', ({ col, face, plot }) => plot(face(ROCK), col(0.9) + 5, 8, PAL)],
  ]
  const legs: Motion[] = [
    { from: 0.5, to: 0.5, t0: 0, dur: 4000, activity: 'probe' },
    { from: 0.2, to: 0.6, t0: 0, dur: 4000, activity: 'probe' },
    { from: 0.7, to: 0.3, t0: 0, dur: 4000, activity: 'probe' },
  ]
  for (const [t, layer, cells] of cases) {
    expect(t.layer).toBe(layer)
    const mine = withAct({ ...layers(t) })
    const theirs = withAct({ ...by(layer, cells) })
    for (const m of legs) {
      for (const dir of [1, -1] as const) {
        const c = { mood: 'idle' as const, dir, say: null }
        for (const now of [500, 1500, 3000]) {
          expect(laneCells(mine, c, m, now, coat, COLS, scene)).toBe(laneCells(theirs, c, m, now, coat, COLS, scene))
        }
      }
    }
  }

  // Several in one layer stack in order, and the desktop gets each one's drawing.
  const rock = track({ frames: ROCK, pal: PAL })
  const crack = track(appear(0.5, { frames: ['.a'], pal: PAL, y: GROUND - 2 }))
  const drop = popTo({ frames: ['b'], pal: PAL, at: 0.8 })
  const act = layers(rock, crack, drop)
  expect(Object.keys(act).sort()).toEqual(['draw', 'over'])
  const m: Motion = { from: 0.5, to: 0.5, t0: 0, dur: 4000, activity: 'probe' }
  const c = { mood: 'idle' as const, dir: 1 as const, say: null }
  const svg = laneSvg(withAct({ move: { stay: 4000 }, ...act }), c, m, 1000, coat, scene)
  const ctx = svgCtx(1, 1000, m)
  expect(svg).toContain(rock.svg(ctx) + crack.svg(ctx))
  expect(svg).toContain(drop.svg(ctx))
  expect(svg.indexOf(drop.svg(ctx))).toBeGreaterThan(svg.indexOf(rock.svg(ctx)))
  const rows = (a: Activity, now: number) => laneCells(withAct({ move: { stay: 4000 }, ...a }), c, m, now, coat, COLS, scene)
  const bare = layers(rock, drop)
  expect(rows(act, 1000)).toBe(rows(bare, 1000))
  expect(rows(act, 2500)).not.toBe(rows(bare, 2500)) // the crack is in
  expect(rows(act, 1000).length).toBe(Math.ceil((COLS * LANE_ROWS * 12) / 3) * 4)
})

test('whatever holds where it ends is timed over the whole leg, so a redraw after it keeps it', () => {
  // A renderer drops an animation whose run ended before the drawing was
  // made, freeze and all: a fall over in 500 ms, redrawn a second later,
  // would stand up again. So every fill="freeze" spans the leg from its start.
  const draws: TrackDraw[] = [
    track({ frames: [ROCK, ROCK2, ROCK], pal: PAL, tick: 100, hold: true, keys: [[0.2, 0, 0, 1], [0.4, 3, -2, 0.2]], show: [0.1, 0.9] }),
    track(appear(0.5, { frames: [ROCK, ROCK2], pal: PAL, hold: true, linger: true })),
    track({ frames: [ROCK, ROCK2], pal: PAL, loop: 300, keys: [[0, 0, 0], [1, 2, 0]] }),
    popTo({ frames: ROCK, pal: PAL, at: 0.3, span: 0.1 }),
    fallOver({ rows: ROCK, fallen: ROCK2, pal: PAL, from: 0.2, to: 0.3, linger: true }),
  ]
  for (const d of draws) {
    for (const now of [T0, T0 + 1500]) {
      const svg = d.svg(svgCtx(1, now))
      const anims = svg.match(/<animate[^>]*>/g) ?? []
      expect(anims.length).toBeGreaterThan(0)
      for (const a of anims) {
        if (a.includes('repeatCount="indefinite"')) continue
        expect(a).toContain(`dur="${DUR}ms" begin="${T0 - now}ms"`)
      }
    }
  }
})

test('perLeg draws the drawings picked for each leg, only those in its layer', () => {
  const rock = track({ frames: ROCK, pal: PAL })
  const drop = popTo({ frames: ['b'], pal: PAL, at: 0.2 })
  const other = track({ frames: ROCK2, pal: PAL })
  // A hit leg gets the rock and its drop; a miss, the other rock.
  const draw = perLeg('draw', ({ leg }) => (leg.hit ? [rock, drop] : other))
  const over = perLeg('over', ({ leg }) => (leg.hit ? [rock, drop] : null))
  const hit: Motion = { ...LEG, hit: true }
  const miss: Motion = { ...LEG, hit: false }
  for (const dir of [1, -1] as const) {
    const now = T0 + 0.25 * DUR
    expect(cellsOf(draw, dir, now, hit)).toEqual(cellsOf(rock, dir, now, hit))
    expect(cellsOf(draw, dir, now, miss)).toEqual(cellsOf(other, dir, now, miss))
    expect(cellsOf(over, dir, now, hit)).toEqual(cellsOf(drop, dir, now, hit))
    expect(cellsOf(over, dir, now, miss)).toEqual([])
    expect(draw.svg(svgCtx(dir, now, hit))).toBe(rock.svg(svgCtx(dir, now, hit)))
    expect(over.svg(svgCtx(dir, now, miss))).toBe('')
  }
  expect([draw.layer, over.layer]).toEqual(['draw', 'over'])
})
