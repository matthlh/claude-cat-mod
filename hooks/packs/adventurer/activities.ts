import type { Motion } from '../../../types'
import { cycle, rects } from '../../engine/draw'
import { HERO_COLS, PX } from '../../engine/geometry'
import { appear, fallOver, GROUND, layers, popTo, track } from '../../engine/track'
import type { Key, LayerName, Sprite, TrackDraw } from '../../engine/track'
import type { Activity, CellsCtx, Draw, Palette, Pose, Rows, SvgCtx } from '../types'
import {
  AXE, AXE_DOWN, BOOK, BOW, BOW_ARC, BUNNY_A, BUNNY_B, CHEER, CHAIR, COIN_A, COIN_B, GRIPS, HAMMER, HAMMER_DOWN, HANDS,
  HOLD_A, ITEM_PAL, LANTERN, MOB_PAL, ORE_COPPER, ORE_GOLD, ORE_IRON, PICKAXE, PICKAXE_DOWN, POOF_1, POOF_2, POOF_3,
  SIT, SLIME_A, SLIME_B, STONE, SWING_A, SWING_B, SWORD, SWORD_DOWN, TOOL_PAL, TORCH_A, TORCH_B, WOOD, WOOD_SWORD,
  ZOMBIE_A, ZOMBIE_B, ZOMBIE_HIT, ARROW,
} from './sprites'
import {
  ANVIL, BLOCK_DIRT, BLOCK_GRASS, BLOCK_STONE, BLOCK_WOOD, CRACKS, FURNACE_A, FURNACE_B, LOG, ORE_BLOCK_COPPER,
  ORE_BLOCK_GOLD, ORE_BLOCK_IRON, STUMP, TREE, WORKBENCH, WORLD_PAL, worldSky,
} from './world'

// Everything the adventurer does, in the order the weighted pick walks them.
// Each one is drawn with the track helper (engine/track.ts): blocks, trees,
// mobs and drops are tracks keyed to the leg, the same on both surfaces.
//
// The one exception is a tool swung in the hand. The engine cycles a pose's
// frames on a clock of its own (from when the desktop drawing is made, and on
// `now` in the terminal), while a track counts from the leg's start, so a
// swung pickaxe drawn as a track would drift out of the hand. swing() builds
// the pose and the tool from one spec on the pose's own clock instead.

// ── Helpers ─────────────────────────────────────────────────────────────

const width = (rows: Rows) => rows.reduce((w, r) => Math.max(w, r.length), 0)
const one = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)]

// A number from 0 to k-1 that is the same every time for the same input: a
// leg's start or spot picks its block, tree or wall on both surfaces alike.
function roll(n: number, k: number): number {
  let h = Math.floor(Math.abs(n) * 1000) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) % k
}

const live = (ctx: { leg: Motion; now: number }) => ctx.now < ctx.leg.t0 + ctx.leg.dur

// A layer that draws whichever track `f` picks for this leg and scene, or nothing.
type Pick = (c: { leg: Motion; scene: string; hero: SvgCtx['hero'] }) => Draw | undefined | null
function pick(layer: LayerName, f: Pick): TrackDraw {
  return {
    layer,
    svg: ctx => f(ctx)?.svg(ctx) ?? '',
    cells: ctx => f(ctx)?.cells(ctx),
  }
}

// Only while the leg lasts, on the desktop too: something held in a hand
// that goes back to standing when the leg is over.
function busyOnly(d: TrackDraw): TrackDraw {
  return { ...d, svg: ctx => (live(ctx) ? d.svg(ctx) : '') }
}

type Hand = keyof typeof HANDS
const TOOLS = { AXE, AXE_DOWN, BOOK, BOW_ARC, HAMMER, HAMMER_DOWN, LANTERN, PICKAXE, PICKAXE_DOWN, SWORD, SWORD_DOWN, TORCH_A, TORCH_B, ARROW }
type Tool = keyof typeof TOOLS

// Where a tool sits for a pose: its grip on the hand, as [left column, top
// row] in the hero's left-facing box.
function gripAt(pose: Hand, tool: Tool): [number, number] {
  const [hx, hy] = HANDS[pose]
  const [gx, gy] = GRIPS[tool]
  return [hx - gx, hy - gy]
}

// A tool held still in a one-frame pose, as a track: beneath the hero, so the
// hand covers the grip, and gone when the leg ends.
function held(pose: Hand, tools: Tool[], extra: Partial<Sprite> = {}): TrackDraw {
  const rows = TOOLS[tools[0]]
  const w = width(rows)
  const [lx, y] = gripAt(pose, tools[0])
  // track() places a 'hero' sprite centred and mirrors the place for a hero
  // facing left; this x lands its left-facing column on lx.
  const x = HERO_COLS - lx - w - Math.floor((HERO_COLS - w) / 2)
  return busyOnly(track({ frames: tools.map(t => TOOLS[t]), pal: TOOL_PAL, anchor: 'hero', layer: 'draw', x, y, linger: true, ...extra }))
}

const SWING_POSES: [Hand, Hand] = ['SWING_A', 'SWING_B']

// A two-frame swing with a tool in hand: raised behind the head, then brought
// down ahead. The pose and the tool share one clock, the pose's own.
function swing(up: Tool, down: Tool, tick = 350): { pose: Pose; tool: TrackDraw } {
  const pose: Pose = { frames: [SWING_A, SWING_B], period: (2 * tick) / 1000, tick }
  const tools = [up, down].map((t, i) => ({ rows: TOOLS[t], at: gripAt(SWING_POSES[i], t) }))
  const xOf = (t: (typeof tools)[number], dir: 1 | -1) => (dir === 1 ? HERO_COLS - t.at[0] - width(t.rows) : t.at[0])
  const tool: TrackDraw = {
    layer: 'draw',
    svg: (ctx: SvgCtx) => {
      if (!live(ctx)) return ''
      const shown = tools.map(t => `<g transform="translate(${xOf(t, ctx.dir) * PX} ${t.at[1] * PX})">${rects(ctx.face(t.rows), TOOL_PAL)}</g>`)
      return cycle(shown, pose.period ?? 1)
    },
    cells: (ctx: CellsCtx) => {
      const t = tools[Math.floor(ctx.now / tick) % tools.length]
      ctx.plot(ctx.face(t.rows), ctx.x + xOf(t, ctx.dir), t.at[1], TOOL_PAL)
    },
  }
  return { pose, tool }
}

// A puff of smoke where something vanished.
const poof = (from: number, to: number, place: Partial<Sprite>): TrackDraw =>
  track({ frames: [POOF_1, POOF_2, POOF_3], pal: MOB_PAL, tick: 110, hold: true, show: [from, to], ...place })

// A little twinkle, for a hammer on an anvil.
const SPARK = ['.X.', 'XWX', '.X.']
const SPARK_B = ['X.X', '.W.', 'X.X']
const SPARK_OFF = ['...']
const SPARK_PAL: Palette = { X: 0xffd45c, W: 0xffffff }

// Bounces along keys: a hop every `every` of the leg, `high` rows up.
function hops(t0: number, t1: number, dx0: number, dx1: number, n: number, high: number, fade?: [number, number]): Key[] {
  const out: Key[] = []
  for (let i = 0; i <= 2 * n; i++) {
    const k = i / (2 * n)
    const t = t0 + (t1 - t0) * k
    const op = fade && t >= fade[0] ? Math.max(0, 1 - (t - fade[0]) / (fade[1] - fade[0])) : 1
    out.push([t, dx0 + (dx1 - dx0) * k, i % 2 ? -high : 0, op])
  }
  return out
}

// ── Mining ──────────────────────────────────────────────────────────────

// A 2 x 2 cluster of blocks just ahead; a vein of ore runs through it, or it
// is plain stone (twice as likely). [block, drop] for each kind.
const KINDS: [Rows, Rows][] = [[BLOCK_STONE, STONE], [ORE_BLOCK_COPPER, ORE_COPPER], [ORE_BLOCK_IRON, ORE_IRON], [ORE_BLOCK_GOLD, ORE_GOLD]]
const kindOf = (leg: Motion) => [0, 1, 2, 3, 0][roll(leg.t0, 5)]
const CELLS: [number, number][] = [[0, GROUND - 8], [4, GROUND - 8], [0, GROUND - 4], [4, GROUND - 4]]
const BREAK = 0.8

const mineSwing = swing('PICKAXE', 'PICKAXE_DOWN')
const mineTracks: TrackDraw[] = []
KINDS.forEach(([block, drop], k) => {
  const only = (leg: Motion) => kindOf(leg) === k
  CELLS.forEach(([x, y], i) => {
    // The vein: top left and bottom right; the rest is stone.
    const rows = k > 0 && (i === 1 || i === 2) ? BLOCK_STONE : block
    mineTracks.push(track({ frames: rows, pal: WORLD_PAL, x, y, show: [0, BREAK], only }))
  })
  mineTracks.push(popTo({ frames: drop, pal: ITEM_PAL, x: 2, y: GROUND - 6, from: BREAK, at: 0.85, span: 0.12, only }))
})
// Cracks spread over every block of the cluster as it is struck.
CRACKS.forEach((crack, s) => {
  const show: [number, number] = [0.2 + s * 0.22, s === 2 ? BREAK : 0.42 + s * 0.22]
  for (const [x, y] of CELLS) mineTracks.push(track({ frames: crack, pal: WORLD_PAL, x, y, show }))
})
mineTracks.push(poof(BREAK, 0.94, { x: 2, y: GROUND - 7 }))

// ── Chopping ────────────────────────────────────────────────────────────

const chopSwing = swing('AXE', 'AXE_DOWN')
// The tree stands right in front, its trunk where the axe lands.
const TREE_AT: Partial<Sprite> = { gap: 0 }
const standingTree = track({ frames: TREE, pal: WORLD_PAL, ...TREE_AT, linger: true })
const timberTracks: TrackDraw[] = [
  // The stump is left behind under it, and fades away at the end.
  track({ frames: STUMP, pal: WORLD_PAL, gap: 0, x: 1, keys: [[0.8, 0, 0, 1], [1, 0, 0, 0]] }),
  fallOver({ rows: TREE, fallen: LOG, pal: WORLD_PAL, ...TREE_AT, from: 0.05, to: 0.3, show: [0, 0.5] }),
  poof(0.5, 0.64, { gap: 0, x: 8, y: GROUND - 5 }),
  popTo({ frames: WOOD, pal: ITEM_PAL, gap: 0, x: 6, from: 0.5, at: 0.55, span: 0.13 }),
  popTo({ frames: WOOD, pal: ITEM_PAL, gap: 0, x: 11, from: 0.5, at: 0.66, span: 0.14 }),
]

// ── Building ────────────────────────────────────────────────────────────

// [column, row] in blocks, row 0 on the ground, in the order they go down.
const WALLS: [number, number][][] = [
  [[0, 0], [1, 0], [2, 0]],
  [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [1, 1]],
  [[0, 0], [1, 0], [2, 0], [2, 1]],
  [[0, 0], [1, 0], [2, 0], [1, 1], [2, 1]],
]
// The build spot picks the wall, so the admiring leg after it finds the same one.
const wallOf = (leg: Motion) => WALLS[roll(leg.from + 7, WALLS.length)]
const materialOf = (scene: string): [Rows, Rows] =>
  scene === 'cavern' ? [BLOCK_STONE, BLOCK_STONE] : scene === 'cabin' ? [BLOCK_WOOD, BLOCK_WOOD] : [BLOCK_DIRT, BLOCK_GRASS]

const wallCache = new Map<string, TrackDraw[]>()
function wall(leg: Motion, scene: string, placing: boolean): TrackDraw[] {
  const w = WALLS.indexOf(wallOf(leg))
  const key = `${w}|${scene}|${placing}`
  const hit = wallCache.get(key)
  if (hit) return hit
  const cells = WALLS[w]
  const [body, top] = materialOf(scene)
  const out = cells.map(([c, r], i) => {
    const covered = cells.some(([c2, r2]) => c2 === c && r2 === r + 1)
    const rows = covered ? body : top
    const place = { frames: rows, pal: WORLD_PAL, x: 4 * c, y: GROUND - 4 * (r + 1), linger: placing }
    if (!placing) return track({ ...place, keys: [[0.7, 0, 0, 1], [1, 0, 0, 0]] })
    // Each block drops into place in turn while the hammer swings.
    const t = 0.06 + (i * 0.8) / cells.length
    return track(appear(t, { ...place, keys: [[t, 0, -2], [t + 0.04, 0, 0]] }))
  })
  wallCache.set(key, out)
  return out
}
const wallLayer = (placing: boolean): TrackDraw => ({
  layer: 'draw',
  svg: ctx => wall(ctx.leg, ctx.scene, placing).map(d => d.svg(ctx)).join(''),
  cells: ctx => wall(ctx.leg, ctx.scene, placing).forEach(d => d.cells(ctx)),
})
const buildSwing = swing('HAMMER', 'HAMMER_DOWN', 300)

// ── Crafting ────────────────────────────────────────────────────────────

// Each scene has its own station: a workbench outdoors and in the cabin, a
// furnace in the cavern, an anvil under the night sky.
const STATION: Record<string, Rows[]> = { forest: [WORKBENCH], cabin: [WORKBENCH], cavern: [FURNACE_A, FURNACE_B], night: [ANVIL] }
const stationOf = (scene: string) => STATION[scene] ?? [WORKBENCH]
const STATION_GAP = 2

const stationCache = new Map<string, TrackDraw[]>()
// The station, a spark over it while the hammer rings, and what was made.
function station(scene: string, anchor: 'ahead' | 'target', made?: { rows: Rows; pal: Palette }): TrackDraw[] {
  const key = `${scene}|${anchor}|${made ? made.pal === ITEM_PAL ? 'a' : 'b' : ''}`
  const hit = stationCache.get(key)
  if (hit) return hit
  const frames = stationOf(scene)
  const h = frames[0].length
  const w = width(frames[0])
  const place = { anchor, gap: STATION_GAP }
  const out: TrackDraw[] = [track({ frames, pal: WORLD_PAL, tick: 250, linger: true, ...place })]
  if (made) {
    out.push(track({ frames: [SPARK, SPARK_B, SPARK_OFF], pal: SPARK_PAL, tick: 150, ...place, x: 1, y: GROUND - h - 3, show: [0.08, 0.7] }))
    out.push(popTo({ frames: made.rows, pal: made.pal, ...place, x: Math.floor((w - width(made.rows)) / 2), y: GROUND - h - made.rows.length - 1, from: 0.72, at: 0.86, span: 0.12 }))
  }
  stationCache.set(key, out)
  return out
}
// The part of a scene's station drawing in one layer: the station and spark
// beneath the hero, what was made flying into it over it.
const stationLayer = (layer: LayerName, anchor: 'ahead' | 'target', made?: { rows: Rows; pal: Palette }): TrackDraw => {
  const mine = (scene: string) => station(scene, anchor, made).filter(d => d.layer === layer)
  return {
    layer,
    svg: ctx => mine(ctx.scene).map(d => d.svg(ctx)).join(''),
    cells: ctx => mine(ctx.scene).forEach(d => d.cells(ctx)),
  }
}
const forgeSwing = swing('HAMMER', 'HAMMER_DOWN', 300)
const BLADE_PAL: Palette = { ...ITEM_PAL, t: 0xe6ebf0, T: 0xa7b0bb, k: 0x6b4430 }

function forge(made: { rows: Rows; pal: Palette }, line: string): Activity {
  return {
    move: { stay: 3800 },
    pose: forgeSwing.pose,
    lines: ['*clang clang*', 'almost…'],
    cues: [[3300, line]],
    ...layers(stationLayer('draw', 'ahead', made), forgeSwing.tool, stationLayer('over', 'ahead', made)),
  }
}

// ── Fighting ────────────────────────────────────────────────────────────

type Foe = { walk: Rows[]; hit: Rows; pal: Palette; hitPal: Palette; tick: number; bounce: number }
const ZOMBIE: Foe = { walk: [ZOMBIE_A, ZOMBIE_B], hit: ZOMBIE_HIT, pal: MOB_PAL, hitPal: MOB_PAL, tick: 320, bounce: 0 }
// A slime flashes pale when struck.
const SLIME: Foe = { walk: [SLIME_A, SLIME_B], hit: SLIME_A, pal: MOB_PAL, hitPal: { ...MOB_PAL, j: 0xeefae6, J: 0xffffff, i: 0xb8d0a8 }, tick: 220, bounce: 2 }
// A slime in the forest by day; after dark, and anywhere else, a zombie.
const foeOf = (leg: Motion, scene: string) => (scene === 'forest' && !worldSky(new Date(leg.t0).getHours()).isNight ? SLIME : ZOMBIE)

const SWORD_GAP = 3
const BOW_GAP = 14

// Shambling (or bouncing) in from far ahead to `gap` before the hero.
const approachCache = new Map<string, TrackDraw>()
function approach(foe: Foe, gap: number): TrackDraw {
  const key = `${foe.tick}|${gap}`
  const hit = approachCache.get(key)
  if (hit) return hit
  const keys: Key[] = foe.bounce
    ? hops(0, 0.85, 24, 0, 7, foe.bounce).map(([t, dx, dy], i) => [t, dx, dy, i === 0 ? 0 : 1])
    : [[0, 24, 0, 0], [0.08, 22, 0, 1], [0.85, 0, 0, 1]]
  const out = track({ frames: foe.walk, pal: foe.pal, tick: foe.tick, gap, keys, linger: true })
  approachCache.set(key, out)
  return out
}

// Struck at `hits`, knocked back a little each time, then a puff and a coin.
// [from, to] windows of the leg, all at `gap` ahead.
const bout = new Map<string, TrackDraw[]>()
function struck(foe: Foe, gap: number, hits: [number, number], end: number): TrackDraw[] {
  const key = `${foe.tick}|${gap}`
  const got = bout.get(key)
  if (got) return got
  const [h1, h2] = hits
  const w = width(foe.walk[0])
  const flash = 0.1
  const out: TrackDraw[] = [
    track({ frames: foe.walk, pal: foe.pal, tick: foe.tick, gap, show: [0, h1] }),
    track({ frames: foe.hit, pal: foe.hitPal, gap, show: [h1, h1 + flash], keys: [[h1, 0, 0], [h1 + flash, 2, 0]] }),
    track({ frames: foe.walk, pal: foe.pal, tick: foe.tick, gap, x: 2, show: [h1 + flash, h2] }),
    track({ frames: foe.hit, pal: foe.hitPal, gap, show: [h2, h2 + flash], keys: [[h2, 2, 0], [h2 + flash, 5, -1]] }),
    poof(h2 + flash, end, { gap, x: 5 + Math.floor((w - 5) / 2), y: GROUND - 6 }),
    popTo({ frames: [COIN_A, COIN_B], pal: ITEM_PAL, tick: 140, gap, x: 5 + Math.floor((w - 5) / 2), from: h2 + flash + 0.02, at: end, span: 0.14, peak: gap > 6 ? 6 : 4 }),
  ]
  bout.set(key, out)
  return out
}
const foeLayer = (gap: number, hits: [number, number], end: number): TrackDraw => ({
  layer: 'draw',
  svg: ctx => struck(foeOf(ctx.leg, ctx.scene), gap, hits, end).filter(d => d.layer === 'draw').map(d => d.svg(ctx)).join(''),
  cells: ctx => struck(foeOf(ctx.leg, ctx.scene), gap, hits, end).filter(d => d.layer === 'draw').forEach(d => d.cells(ctx)),
})
const coinLayer = (gap: number, hits: [number, number], end: number): TrackDraw => ({
  layer: 'over',
  svg: ctx => struck(foeOf(ctx.leg, ctx.scene), gap, hits, end).filter(d => d.layer === 'over').map(d => d.svg(ctx)).join(''),
  cells: ctx => struck(foeOf(ctx.leg, ctx.scene), gap, hits, end).filter(d => d.layer === 'over').forEach(d => d.cells(ctx)),
})

const swordSwing = swing('SWORD', 'SWORD_DOWN', 300)
const STRIKE_HITS: [number, number] = [0.28, 0.55]
const SHOOT_HITS: [number, number] = [0.3, 0.6]
// Arrows leave the bow and fly to the foe's front: from the nock on the
// hand (right-facing column) to the foe's near edge.
const arrowX = HERO_COLS - gripAt('BOW', 'ARROW')[0] - width(ARROW)
const arrowFlight = HERO_COLS + BOW_GAP - (arrowX + width(ARROW))
const arrow = (from: number, to: number, extra: number) =>
  held('BOW', ['ARROW'], { show: [from, to], linger: false, keys: [[from, 0, 0], [to, arrowFlight + extra, 0]] })

// ── Bunnies ─────────────────────────────────────────────────────────────

const BUNNY_GAP = 4
const bunnyHop: Key[] = [[0, 0, 0], [0.5, 0, -1], [1, 0, 0]]

// ── While Claude works ──────────────────────────────────────────────────

const workSwing = swing('HAMMER', 'HAMMER_DOWN', 250)
const workStation = (rows: Rows[]) => [
  track({ frames: rows, pal: WORLD_PAL, tick: 250, gap: STATION_GAP }),
  track({ frames: [SPARK, SPARK_B, SPARK_OFF, SPARK_OFF], pal: SPARK_PAL, tick: 125, gap: STATION_GAP, x: 1, y: GROUND - rows[0].length - 3 }),
]
const WORK: Record<string, TrackDraw[]> = {
  read: [held('SIT', ['BOOK'])],
  edit: [...workStation([ANVIL]), workSwing.tool],
  bash: [...workStation([FURNACE_A, FURNACE_B]), workSwing.tool],
  lantern: [held('HOLD_A', ['LANTERN'], { keys: [[0, 0, 0], [0.5, 0, 0.6], [1, 0, 0]], loop: 1600 })],
  torch: [held('HOLD_A', ['TORCH_A', 'TORCH_B'], { tick: 180 })],
}
const workOf = (prop: string | null | undefined, scene: string): TrackDraw[] =>
  prop === 'search' ? WORK[scene === 'cavern' || scene === 'night' ? 'torch' : 'lantern'] : (prop && WORK[prop]) || []

// ── The activities ──────────────────────────────────────────────────────

export const ACTIVITIES: Record<string, Activity> = {
  walk: { weight: { day: 18, night: 10, tired: 15 } },

  // Idle on the spot, blinking. A finished task gets a cheer.
  stand: {
    weight: { day: 8, night: 8, tired: 20 },
    move: { stay: [3000, 7000] },
    pose: hero => (hero.mood === 'done' ? { frames: [CHEER] } : undefined),
  },

  sit: { weight: { day: 7, night: 7, tired: 30 }, move: { stay: [4000, 9000] }, pose: { frames: [SIT] } },

  mine: {
    weight: { day: 8, night: 4 },
    move: { stay: 5200, faceRoom: true },
    repeat: [0, 1],
    pose: mineSwing.pose,
    lines: ['*tink tink*', 'ooh, shiny', 'one more block'],
    ...layers(...mineTracks, mineSwing.tool),
  },

  chop: {
    weight: { day: 7, night: 2 },
    move: { stay: 3600, faceRoom: true },
    pose: chopSwing.pose,
    lines: ['*thunk*', 'nice tree', 'need wood'],
    then: () => ({ activity: 'timber', line: 'timber!' }),
    thenFirst: true,
    ...layers(standingTree, chopSwing.tool),
  },
  timber: {
    move: { stay: 3200 },
    pose: { frames: [CHEER] },
    cues: [[2300, '+2 wood']],
    ...layers(...timberTracks, held('CHEER', ['AXE'])),
  },

  build: {
    weight: { day: 6, night: 2 },
    move: { stay: 4800, faceRoom: true },
    pose: buildSwing.pose,
    lines: ['building…', 'block by block', 'a little wall'],
    then: () => ({ activity: 'admire', line: one(['nice.', 'home sweet home', 'looks sturdy']) }),
    thenFirst: true,
    ...layers(wallLayer(true), buildSwing.tool),
  },
  admire: { move: { stay: 3000 }, pose: { frames: [CHEER] }, draw: wallLayer(false) },

  craft: {
    weight: { day: 5, night: 3 },
    move: { near: [0.1, 0.22] },
    lines: ['time to craft', 'to the bench'],
    then: () => ({ activity: Math.random() < 0.5 ? 'chair' : 'blade' }),
    thenFirst: true,
    target: stationLayer('target', 'target'),
  },
  chair: forge({ rows: CHAIR, pal: ITEM_PAL }, 'made a chair!'),
  blade: forge({ rows: WOOD_SWORD, pal: BLADE_PAL }, 'forged a blade!'),

  // A foe comes in from far ahead; on a hit the bow, otherwise the sword.
  fight: {
    weight: { day: 6, night: 14 },
    move: { stay: 3000, faceRoom: true },
    hit: 0.4,
    pose: { frames: [HOLD_A] },
    lines: ['here it comes!', 'monster!', 'en garde!'],
    then: leg => ({ activity: leg.hit ? 'shoot' : 'strike' }),
    thenFirst: true,
    ...layers(
      pick('draw', ({ leg, scene }) => approach(foeOf(leg, scene), leg.hit ? BOW_GAP : SWORD_GAP)),
      held('HOLD_A', ['SWORD_DOWN'], { only: leg => !leg.hit }),
      held('HOLD_A', ['BOW_ARC'], { only: leg => !!leg.hit }),
    ),
  },
  strike: {
    move: { stay: 2400 },
    pose: swordSwing.pose,
    cues: [[600, 'hyah!'], [2000, '+1 coin']],
    ...layers(foeLayer(SWORD_GAP, STRIKE_HITS, 0.82), swordSwing.tool, coinLayer(SWORD_GAP, STRIKE_HITS, 0.82)),
  },
  shoot: {
    move: { stay: 2600 },
    pose: { frames: [BOW] },
    cues: [[300, 'steady…'], [2200, 'bullseye!']],
    ...layers(
      foeLayer(BOW_GAP, SHOOT_HITS, 0.84),
      held('BOW', ['BOW_ARC']),
      arrow(0.12, 0.3, 0),
      arrow(0.44, 0.6, 2),
      coinLayer(BOW_GAP, SHOOT_HITS, 0.84),
    ),
  },

  // A bunny hops along ahead, and the hero tags along.
  critter: {
    weight: { day: 3 },
    move: { near: [0.12, 0.25] },
    pace: 0.7,
    lines: ['a bunny!', 'hi, little one', 'wait up!'],
    then: () => ({ activity: 'hopoff', line: 'bye, bunny!' }),
    draw: track({ frames: [BUNNY_A, BUNNY_B], pal: MOB_PAL, tick: 200, gap: BUNNY_GAP, keys: bunnyHop, loop: 400 }),
  },
  hopoff: {
    move: { stay: 2000 },
    draw: track({ frames: [BUNNY_A, BUNNY_B], pal: MOB_PAL, tick: 200, gap: BUNNY_GAP, keys: hops(0.05, 1, 0, 26, 6, 2, [0.7, 1]) }),
  },

  // While Claude runs a tool: reading a book, hammering at the anvil (edits),
  // stoking the furnace (shell commands), or searching by lantern or torch.
  busy: {
    pose: hero =>
      hero.prop === 'read' ? { frames: [SIT] }
      : hero.prop === 'edit' || hero.prop === 'bash' ? workSwing.pose
      : hero.prop === 'search' ? { frames: [HOLD_A] }
      : undefined,
    draw: {
      svg: ctx => workOf(ctx.hero.prop, ctx.scene).map(d => d.svg(ctx)).join(''),
      cells: ctx => workOf(ctx.hero.prop, ctx.scene).forEach(d => d.cells(ctx)),
    },
  },
}
