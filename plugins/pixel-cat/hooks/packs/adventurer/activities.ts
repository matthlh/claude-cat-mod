import type { Motion, Phase } from '../../../types'
import { cycleFrames, faceRight, posePeriod, rects } from '../../engine/draw'
import { HERO_COLS, PX } from '../../engine/geometry'
import { appear, fallOver, GROUND, layers, perLeg, popTo, track } from '../../engine/track'
import type { Key, Pop, Sprite, TrackDraw } from '../../engine/track'
import type { Activity, CellsCtx, CrewJoin, Palette, Pose, Rows, SvgCtx } from '../types'
import {
  AXE, AXE_DOWN, AXE_HIGH, BOOK, BOW, BOW_ARC, BUNNY_A, BUNNY_B, CHEER, CHAIR, COIN_A, COIN_B, DAMAGE_PAL, damageRows, FX_PAL, GRIPS,
  HAMMER, HAMMER_DOWN, HANDS, HOLD_A, ITEM_PAL, LANTERN, MOB_PAL, ORE_COPPER, ORE_GOLD, ORE_IRON, PICKAXE, PICKAXE_DOWN, POOF_1,
  POOF_2, POOF_3, SIT, SLIME_A, SLIME_B, SPARKLE_1, SPARKLE_2, SPARKLE_3, STONE, SWING_A, SWING_B, SWORD, SWORD_DOWN, TOOL_PAL,
  TORCH_A, TORCH_B, WOOD, WOOD_SWORD, ZOMBIE_A, ZOMBIE_B, ZOMBIE_HIT, ARROW,
} from './sprites'
import { SUMMON_GAP } from './summons'
import {
  ANVIL, BLOCK_DIRT, BLOCK_GRASS, BLOCK_STONE, BLOCK_WOOD, CRACKS, FURNACE_A, FURNACE_B, LOG, ORE_BLOCK_COPPER,
  ORE_BLOCK_GOLD, ORE_BLOCK_IRON, STUMP, TREE, WORKBENCH, WORLD_PAL,
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
//
// Whatever depends on the leg (which block, which wall, which foe) is built
// up front for every case, and perLeg() picks among those drawings per leg.

// ── Helpers ─────────────────────────────────────────────────────────────

const width = (rows: Rows) => rows.reduce((w, r) => Math.max(w, r.length), 0)
const one = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)]

// A number from 0 to k-1 that is the same every time for the same input: a
// leg's start or spot picks its block or wall on both surfaces alike.
function hashPick(n: number, k: number): number {
  let h = Math.floor(Math.abs(n) * 1000) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) % k
}

const live = (ctx: { leg: Motion; now: number }) => ctx.now < ctx.leg.t0 + ctx.leg.dur

// Only while the leg lasts, on the desktop too: something held in a hand
// that goes back to standing when the leg is over.
function busyOnly(d: TrackDraw): TrackDraw {
  return { ...d, svg: ctx => (live(ctx) ? d.svg(ctx) : '') }
}

type Hand = keyof typeof HANDS
const TOOLS = { AXE, AXE_DOWN, AXE_HIGH, BOOK, BOW_ARC, HAMMER, HAMMER_DOWN, LANTERN, PICKAXE, PICKAXE_DOWN, SWORD, SWORD_DOWN, TORCH_A, TORCH_B, ARROW }
type Tool = keyof typeof TOOLS

// Where a tool sits for a pose: its grip on the hand, as [left column, top
// row] in the hero's left-facing box.
function gripAt(pose: Hand, tool: Tool): [number, number] {
  const [hx, hy] = HANDS[pose]
  const [gx, gy] = GRIPS[tool]
  return [hx - gx, hy - gy]
}

// The terminal has no headroom: a raised tool's head, above row 0, would be
// cut off and leave a bare stick. There the tool slides down its own handle
// until its top is on row 0, so the hand holds it nearer the head and the
// head shows. The way down each handle runs, a step in [x, y], facing left.
const SLIDE: Partial<Record<Tool, [number, number]>> = { PICKAXE: [-1, 1], AXE: [-1, 1], SWORD: [-1, 1], HAMMER: [0, 1] }
function fitted(pose: Hand, tool: Tool): [number, number] {
  const [lx, y] = gripAt(pose, tool)
  const step = SLIDE[tool]
  return y >= 0 || !step ? [lx, y] : [lx - step[0] * y, 0]
}

// A tool held still in a one-frame pose, as a track: beneath the hero, so the
// hand covers the grip, and gone when the leg ends. The terminal draws it
// fitted (see SLIDE), or, with `terminal` false, leaves it out.
function held(pose: Hand, tools: [Tool, ...Tool[]], extra: Partial<Sprite> = {}, terminal = true): TrackDraw {
  const rows = TOOLS[tools[0]]
  const w = width(rows)
  // track() places a 'hero' sprite centred and mirrors the place for a hero
  // facing left; this x lands its left-facing column on lx.
  const at = ([lx, y]: [number, number]) => ({ x: HERO_COLS - lx - w - Math.floor((HERO_COLS - w) / 2), y })
  const sprite: Sprite = { frames: tools.map(t => TOOLS[t]), pal: TOOL_PAL, anchor: 'hero', layer: 'draw', linger: true, ...extra }
  const desk = busyOnly(track({ ...sprite, ...at(gripAt(pose, tools[0])) }))
  const term = track({ ...sprite, ...at(fitted(pose, tools[0])) })
  return {
    ...desk,
    cells: ctx => {
      if (terminal) term.cells(ctx)
    },
  }
}

// A two-frame swing with a tool in hand: raised behind the head, then brought
// down ahead. The pose and the tool share one clock, the pose's own: `tick`
// ms a frame, on both surfaces.
function swing(up: Tool, down: Tool, tick = 350): { pose: Pose; tool: TrackDraw } {
  const pose: Pose = { frames: [SWING_A, SWING_B], tick }
  const period = posePeriod(pose)
  const tools = ([[up, 'SWING_A'], [down, 'SWING_B']] as const).map(([t, hand]) => ({ rows: TOOLS[t], at: gripAt(hand, t), fit: fitted(hand, t) }))
  const xOf = (rows: Rows, lx: number, dir: 1 | -1) => (dir === 1 ? HERO_COLS - lx - width(rows) : lx)
  const tool: TrackDraw = {
    layer: 'draw',
    svg: (ctx: SvgCtx) => {
      if (!live(ctx)) return ''
      const shown = tools.map(t => `<g transform="translate(${xOf(t.rows, t.at[0], ctx.dir) * PX} ${t.at[1] * PX})">${rects(ctx.face(t.rows), TOOL_PAL)}</g>`)
      return cycleFrames(shown, period)
    },
    cells: (ctx: CellsCtx) => {
      const t = tools[Math.floor(ctx.now / tick) % tools.length]
      if (!t) return
      ctx.plot(ctx.face(t.rows), ctx.x + xOf(t.rows, t.fit[0], ctx.dir), t.fit[1], TOOL_PAL)
    },
  }
  return { pose, tool }
}

// A puff of smoke where something vanished, POOF_W wide.
const POOF_W = width(POOF_2)
const poof = (from: number, to: number, place: Partial<Sprite>): TrackDraw =>
  track({ frames: [POOF_1, POOF_2, POOF_3], pal: MOB_PAL, tick: 110, hold: true, show: [from, to], ...place })

// A little twinkle, for a hammer on an anvil.
const SPARK = ['.X.', 'XWX', '.X.']
const SPARK_B = ['X.X', '.W.', 'X.X']
const SPARK_OFF = ['...']
const SPARK_PAL: Palette = { X: 0xffd45c, W: 0xffffff }

// A drop that glints as it flies into the hero: popTo, with a sparkle
// twinkling at its top corner all the way in, on top of it.
const SPARKLE = [SPARKLE_1, SPARKLE_2, SPARKLE_3, SPARKLE_2]
const SPARKLE_W = width(SPARKLE_1)
function glinting(p: Pop): TrackDraw[] {
  const first = (typeof p.frames[0] === 'string' ? (p.frames as Rows) : (p.frames as Rows[])[0]) ?? []
  const w = width(first)
  const h = first.length
  const [ox, oy] = [w - 2, -2]
  const top = p.y ?? GROUND - h
  const into: [number, number] = [
    Math.floor((HERO_COLS - w) / 2) + (p.into?.[0] ?? 0) + ox - Math.floor((HERO_COLS - SPARKLE_W) / 2),
    (p.into?.[1] ?? Math.floor((GROUND - h) / 2)) + oy,
  ]
  // A 'hero' anchor centres each sprite on its own width; 'ahead' and 'target' do not.
  const centred = p.anchor === 'hero' ? Math.floor((HERO_COLS - w) / 2) - Math.floor((HERO_COLS - SPARKLE_W) / 2) : 0
  return [popTo(p), popTo({ ...p, frames: SPARKLE, pal: FX_PAL, tick: 110, x: (p.x ?? 0) + ox + centred, y: top + oy, into })]
}

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
const kindOf = (leg: Motion) => [0, 1, 2, 3, 0][hashPick(leg.t0, 5)]
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
  // A low arc, so it stays under the terminal's top row.
  mineTracks.push(...glinting({ frames: drop, pal: ITEM_PAL, x: 2, y: GROUND - 6, from: BREAK, at: 0.85, span: 0.12, peak: 3, only }))
})
// Cracks spread over every block of the cluster as it is struck.
CRACKS.forEach((crack, s) => {
  const show: [number, number] = [0.2 + s * 0.22, s === 2 ? BREAK : 0.42 + s * 0.22]
  for (const [x, y] of CELLS) mineTracks.push(track({ frames: crack, pal: WORLD_PAL, x, y, show }))
})
// The puff, centred on the 8 x 8 cluster.
mineTracks.push(poof(BREAK, 0.94, { x: Math.floor((8 - POOF_W) / 2), y: GROUND - 7 }))

// ── Chopping ────────────────────────────────────────────────────────────

const chopSwing = swing('AXE', 'AXE_DOWN')
// The tree stands right in front, its trunk where the axe lands.
const TREE_AT: Partial<Sprite> = { gap: 0 }
const standingTree = track({ frames: TREE, pal: WORLD_PAL, ...TREE_AT, linger: true })
const timberTracks: TrackDraw[] = [
  // The stump is left behind under it, and fades away at the end.
  track({ frames: STUMP, pal: WORLD_PAL, gap: 0, x: 1, keys: [[0.8, 0, 0, 1], [1, 0, 0, 0]] }),
  fallOver({ rows: TREE, fallen: LOG, pal: WORLD_PAL, ...TREE_AT, from: 0.05, to: 0.3, show: [0, 0.5] }),
  poof(0.5, 0.64, { gap: 0, x: 8, y: GROUND - POOF_1.length }),
  ...glinting({ frames: WOOD, pal: ITEM_PAL, gap: 0, x: 6, from: 0.5, at: 0.55, span: 0.13 }),
  ...glinting({ frames: WOOD, pal: ITEM_PAL, gap: 0, x: 11, from: 0.5, at: 0.66, span: 0.14 }),
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
const wallOf = (leg: Motion) => hashPick(leg.from + 7, WALLS.length)
// What a scene builds with: [body, top] blocks.
const MATERIALS = { dirt: [BLOCK_DIRT, BLOCK_GRASS], stone: [BLOCK_STONE, BLOCK_STONE], wood: [BLOCK_WOOD, BLOCK_WOOD] } satisfies Record<string, [Rows, Rows]>
const materialOf = (scene: string): keyof typeof MATERIALS => (scene === 'cavern' ? 'stone' : scene === 'cabin' ? 'wood' : 'dirt')

// A wall's blocks: dropping into place in turn while the hammer swings, or
// standing, to be admired, and fading at the end.
function wall(cells: [number, number][], [body, top]: [Rows, Rows], placing: boolean): TrackDraw[] {
  return cells.map(([c, r], i) => {
    const covered = cells.some(([c2, r2]) => c2 === c && r2 === r + 1)
    const place = { frames: covered ? body : top, pal: WORLD_PAL, x: 4 * c, y: GROUND - 4 * (r + 1), linger: placing }
    if (!placing) return track({ ...place, keys: [[0.7, 0, 0, 1], [1, 0, 0, 0]] })
    const t = 0.06 + (i * 0.8) / cells.length
    return track(appear(t, { ...place, keys: [[t, 0, -2], [t + 0.04, 0, 0]] }))
  })
}
// Every wall in every material, placing and standing.
const wallsFor = (placing: boolean) =>
  Object.fromEntries(Object.entries(MATERIALS).map(([k, m]) => [k, WALLS.map(cells => wall(cells, m, placing))])) as Record<keyof typeof MATERIALS, TrackDraw[][]>
const WALL_DRAWS = { placing: wallsFor(true), standing: wallsFor(false) }
const wallLayer = (placing: boolean): TrackDraw =>
  perLeg('draw', ({ leg, scene }) => WALL_DRAWS[placing ? 'placing' : 'standing'][materialOf(scene)][wallOf(leg)])
const buildSwing = swing('HAMMER', 'HAMMER_DOWN', 300)

// ── Crafting ────────────────────────────────────────────────────────────

// Each scene has its own station: a workbench outdoors and in the cabin, a
// furnace in the cavern, an anvil under the night sky.
const STATION: Record<string, Rows[]> = { forest: [WORKBENCH], cabin: [WORKBENCH], cavern: [FURNACE_A, FURNACE_B], night: [ANVIL] }
const STATION_GAP = 2

type Made = { rows: Rows; pal: Palette }

// The station, a spark over it while the hammer rings, and what was made.
function station(frames: Rows[], anchor: 'ahead' | 'target', made?: Made): TrackDraw[] {
  const first = frames[0] ?? []
  const h = first.length
  const w = width(first)
  const place = { anchor, gap: STATION_GAP }
  const out: TrackDraw[] = [track({ frames, pal: WORLD_PAL, tick: 250, linger: true, ...place })]
  if (made) {
    out.push(track({ frames: [SPARK, SPARK_B, SPARK_OFF], pal: SPARK_PAL, tick: 150, ...place, x: 1, y: GROUND - h - 3, show: [0.08, 0.7] }))
    // Over the station, but never above the terminal's top row, and a flat
    // hop into the hero for the same reason.
    const y = Math.max(0, GROUND - h - made.rows.length - 1)
    out.push(...glinting({ frames: made.rows, pal: made.pal, ...place, x: Math.floor((w - width(made.rows)) / 2), y, from: 0.72, at: 0.86, span: 0.12, peak: 1 }))
  }
  return out
}
// A scene's station drawing, for every scene: the station and spark beneath
// the hero, what was made flying into it over it (perLeg sorts the layers).
function stations(anchor: 'ahead' | 'target', made?: Made): (ctx: { scene: string }) => TrackDraw[] {
  const by = new Map(Object.entries(STATION).map(([scene, frames]) => [scene, station(frames, anchor, made)]))
  const fallback = station([WORKBENCH], anchor, made)
  return ({ scene }) => by.get(scene) ?? fallback
}
const forgeSwing = swing('HAMMER', 'HAMMER_DOWN', 300)
const BLADE_PAL: Palette = { ...ITEM_PAL, t: 0xe6ebf0, T: 0xa7b0bb, k: 0x6b4430 }

function forge(made: Made, line: string): Activity {
  const at = stations('ahead', made)
  return {
    move: { stay: 3800 },
    pose: forgeSwing.pose,
    lines: ['*clang clang*', 'almost…'],
    cues: [[3300, line]],
    ...layers(perLeg('draw', at), forgeSwing.tool, perLeg('over', at)),
  }
}

// ── Fighting ────────────────────────────────────────────────────────────

type Foe = { walk: Rows[]; hit: Rows; pal: Palette; hitPal: Palette; tick: number; bounce: number }
// A foe comes at the hero, so it faces the other way from it. track() turns
// rows the way the hero faces, so a foe's rows go in turned around.
const toward = (rows: Rows) => faceRight(rows)
const ZOMBIE: Foe = { walk: [toward(ZOMBIE_A), toward(ZOMBIE_B)], hit: toward(ZOMBIE_HIT), pal: MOB_PAL, hitPal: MOB_PAL, tick: 320, bounce: 0 }
// A slime flashes pale when struck.
const SLIME: Foe = { walk: [toward(SLIME_A), toward(SLIME_B)], hit: toward(SLIME_A), pal: MOB_PAL, hitPal: { ...MOB_PAL, j: 0xeefae6, J: 0xffffff, i: 0xb8d0a8 }, tick: 220, bounce: 2 }
// A slime in the forest by day; after dark, and anywhere else, a zombie. The
// time of day is the one the fight began in (Motion.phase, carried into its
// strike or shot), so the foe that came in is the foe that is struck.
const FOES = { slime: SLIME, zombie: ZOMBIE }
type FoeId = keyof typeof FOES
const foeOf = ({ leg, scene, phase }: { leg: Motion; scene: string; phase: Phase }): FoeId =>
  scene === 'forest' && (leg.phase ?? phase) !== 'night' ? 'slime' : 'zombie'

const SWORD_GAP = 3
const BOW_GAP = 14

// Shambling (or bouncing) in from far ahead to `gap` before the hero.
function approach(foe: Foe, gap: number): TrackDraw {
  const keys: Key[] = foe.bounce
    ? hops(0, 0.85, 24, 0, 7, foe.bounce).map(([t, dx, dy], i) => [t, dx, dy, i === 0 ? 0 : 1])
    : [[0, 24, 0, 0], [0.08, 22, 0, 1], [0.85, 0, 0, 1]]
  return track({ frames: foe.walk, pal: foe.pal, tick: foe.tick, gap, keys, linger: true })
}

// Struck at `hits`, knocked back a little each time, then a puff and a coin.
// [from, to] windows of the leg, all at `gap` ahead. The coin shows once the
// puff has billowed, so the foe is seen to go before the drop appears; it
// arcs low, to stay under the terminal's top row.
function struck(foe: Foe, gap: number, hits: [number, number], end: number): TrackDraw[] {
  const [h1, h2] = hits
  const w = width(foe.walk[0] ?? [])
  const flash = FLASH
  return [
    track({ frames: foe.walk, pal: foe.pal, tick: foe.tick, gap, show: [0, h1] }),
    track({ frames: foe.hit, pal: foe.hitPal, gap, show: [h1, h1 + flash], keys: [[h1, 0, 0], [h1 + flash, 2, 0]] }),
    track({ frames: foe.walk, pal: foe.pal, tick: foe.tick, gap, x: 2, show: [h1 + flash, h2] }),
    track({ frames: foe.hit, pal: foe.hitPal, gap, show: [h2, h2 + flash], keys: [[h2, 2, 0], [h2 + flash, 5, -1]] }),
    poof(h2 + flash, end, { gap, x: 5 + Math.floor((w - POOF_W) / 2), y: GROUND - 7 }),
    ...glinting({ frames: [COIN_A, COIN_B], pal: ITEM_PAL, tick: 140, gap, x: 5 + Math.floor((w - 5) / 2), from: h2 + flash + 0.1, at: end, span: 0.14, peak: 3 }),
  ]
}
// Where the foe stands at `t` of a fight struck at `hits`, in px forward of its place.
const FLASH = 0.1
const foeX = (hits: [number, number], t: number) => (t < hits[0] + FLASH ? 0 : t < hits[1] + FLASH ? 2 : 5)
// Each foe's drawings for one kind of fight, built up front.
const perFoe = <T>(f: (foe: Foe) => T): Record<FoeId, T> => ({ slime: f(FOES.slime), zombie: f(FOES.zombie) })
const APPROACH = { sword: perFoe(foe => approach(foe, SWORD_GAP)), bow: perFoe(foe => approach(foe, BOW_GAP)) }
const STRIKE_HITS: [number, number] = [0.28, 0.55]
const SHOOT_HITS: [number, number] = [0.3, 0.6]
const STRIKE_END = 0.84
const SHOOT_END = 0.85
const STRIKE = perFoe(foe => struck(foe, SWORD_GAP, STRIKE_HITS, STRIKE_END))
const SHOOT = perFoe(foe => struck(foe, BOW_GAP, SHOOT_HITS, SHOOT_END))

const swordSwing = swing('SWORD', 'SWORD_DOWN', 300)
// Arrows leave the bow and fly to the foe's front: from the nock on the
// hand (right-facing column) to the foe's near edge.
const arrowX = HERO_COLS - gripAt('BOW', 'ARROW')[0] - width(ARROW)
const arrowFlight = HERO_COLS + BOW_GAP - (arrowX + width(ARROW))
const arrow = (from: number, to: number, extra: number) =>
  held('BOW', ['ARROW'], { show: [from, to], linger: false, keys: [[from, 0, 0], [to, arrowFlight + extra, 0]] })

// ── Summons and damage numbers ──────────────────────────────────────────

// The minions (Pack.crew, summons.ts) dash in at the foe between the hero's
// two blows, a ripple down the line: out from behind the hero, a stand at
// the foe's front in the attack frame, and back. The whole line reaches the
// same spot, the foe's front once the first blow has knocked it back; the
// nearest minion goes this far, from its own place behind the hero to a
// pixel into the foe. The followers are drawn beneath the hero and the foe,
// so a dash that only touched the foe and turned would be hidden behind the
// hero all the way: the stand is what shows the attack, on both surfaces
// (the terminal repaints 10 times a second, so it catches a stand of 190 ms).
export const SUMMON_STAGGER = 120
const reachFor = (gap: number) => HERO_COLS + gap + 2 + 1 + SUMMON_GAP
// The part of the dash spent going out, and where the way back starts.
const DASH_OUT = 0.25
const DASH_BACK = 0.65
// `during`: the nearest minion's dash, as fractions of the leg; `peak`, the
// middle of its stand at the foe; `hit`, the moment it gets there.
type Fight = { gap: number; hits: [number, number]; during: [number, number]; peak: number; hit: number }
const fight = (gap: number, hits: [number, number], during: [number, number]): Fight => {
  const [a, b] = during
  return { gap, hits, during, peak: a + ((DASH_OUT + DASH_BACK) / 2) * (b - a), hit: a + DASH_OUT * (b - a) }
}
export const FIGHTS = {
  strike: fight(SWORD_GAP, STRIKE_HITS, [0.3, 0.5]),
  shoot: fight(BOW_GAP, SHOOT_HITS, [0.32, 0.5]),
} satisfies Record<string, Fight>
const summonsJoin = (f: Fight): CrewJoin => {
  const reach = reachFor(f.gap)
  return {
    during: f.during,
    // Level all the way: a flyer's bob already reaches the terminal's top row.
    keys: [[0, 0, 0], [DASH_OUT, reach, 0], [DASH_BACK, reach, 0], [1, 0, 0]],
    stagger: SUMMON_STAGGER,
    together: true,
  }
}

// A number floats up off the foe on every hit, the hero's and each minion's,
// and fades: gold for the hero (red, and double, for a critical), white for
// a minion. Rolled from the leg's start, so both surfaces show the same. The
// desktop has headroom for it to rise into, over the foe's head; the 10-row
// terminal has none, so there it is the bare digits on the top rows, shown
// for the same moment.
const NUMBER_SPAN = 0.2
// A minion's number is up for a little less than three of the ripple's
// steps, so no more than three are ever up at once, each in a place of its
// own (MINION_SPOTS), and the line's later hits take the places of its first.
const MINION_SPOTS = 3
const MINION_NUMBER_MS = MINION_SPOTS * SUMMON_STAGGER - 30
type Tone = keyof typeof DAMAGE_PAL
// `slot` is the minion's, or -1 for the hero's own blow; `span` the part of the leg it is up.
type Hit = { t: number; span: number; value: number; tone: Tone; slot: number }
function hitsOf(f: Fight, leg: Motion, slots: readonly number[]): Hit[] {
  const out: Hit[] = f.hits.map((t, i) => {
    const value = 7 + hashPick(leg.t0 + 0.37 * (i + 1), 12)
    return hashPick(leg.t0 + 1.3 * (i + 1), 5) === 0 ? { t, span: NUMBER_SPAN, value: value * 2, tone: 'red', slot: -1 } : { t, span: NUMBER_SPAN, value, tone: 'yellow', slot: -1 }
  })
  const dur = Math.max(1, leg.dur)
  // Each minion's lands as it reaches the foe.
  const span = MINION_NUMBER_MS / dur
  for (const slot of slots) out.push({ t: f.hit + (SUMMON_STAGGER * slot) / dur, span, value: 3 + hashPick(leg.t0 + 0.11 * (slot + 3), 7), tone: 'white', slot })
  return out
}
// The digits alone, without the outline or the blank rows round it.
const bare = (rows: Rows) => rows.slice(1, -1).map(r => r.slice(1, -1).replace(/k/g, '.'))
// The hero's number is over the foe as its blow knocks it back, but never
// nearer the hero than two pixels past the foe's front: the minions make
// their stand at the front. The minions' go beyond it, on the far side from
// the hero and clear of where the hero's second blow puts its own, in
// MINION_SPOTS places, `step` apart so that two up at once never read as one
// number, the middle one `low` px lower, a zigzag. [x, y] of the number's
// left edge and top, from the foe's place before it was struck, for a number
// `w` wide whose widest (the hero's two digits) is `widest`.
const KNOCKED_MOST = foeX([0, 0], 1)
function numberPlace(slot: number, foeW: number, knocked: number, w: number, widest: number, step: number, low: number): [number, number] {
  const over = (n: number) => Math.max(2, Math.floor((foeW - n) / 2))
  if (slot < 0) return [knocked + over(w), 0]
  const spot = slot % MINION_SPOTS
  return [KNOCKED_MOST + over(widest) + widest + 2 + spot * step, spot % 2 ? low : 0]
}
// One number's drawing, made once for each place, moment and value it is
// ever drawn at (a fight's are a handful), and kept.
const NUMBERS = new Map<string, TrackDraw>()
const WIDEST = width(damageRows(88))
function numberAt(f: Fight, foeW: number, hit: Hit): TrackDraw {
  const t = Math.round(hit.t * 1e4) / 1e4
  const span = Math.round(hit.span * 1e4) / 1e4
  const key = `${f.gap}|${foeW}|${t}|${span}|${hit.value}|${hit.tone}|${hit.slot}`
  let d = NUMBERS.get(key)
  if (!d) {
    const rows = damageRows(hit.value)
    const digits = bare(rows)
    // Where the blow knocks the foe to.
    const knocked = foeX(f.hits, t + FLASH)
    const end = t + span
    const place = { pal: DAMAGE_PAL[hit.tone], gap: f.gap, layer: 'over' as const, mirror: false, show: [t, end] as [number, number] }
    const [x, y] = numberPlace(hit.slot, foeW, knocked, width(rows), WIDEST, width(rows) + 3, 3)
    const desk = track({ ...place, frames: rows, x, y: y - 1, keys: [[t, 0, 1, 1], [t + span * 0.5, 0, -2, 1], [end, 0, -3, 0]] })
    // The terminal's digits are 2 px narrower and shorter: from the top row,
    // the zigzag's low one beside the foe, where the rows are free.
    const [tx, ty] = numberPlace(hit.slot, foeW, knocked, width(digits), WIDEST - 2, width(digits) + 3, 2)
    const term = track({ ...place, frames: digits, x: tx, y: ty })
    d = { layer: 'over', svg: desk.svg, cells: term.cells }
    if (NUMBERS.size > 400) NUMBERS.clear()
    NUMBERS.set(key, d)
  }
  return d
}
const damageNumbers = (f: Fight) =>
  perLeg('over', ctx => {
    const foeW = width(FOES[foeOf(ctx)].walk[0] ?? [])
    return hitsOf(f, ctx.leg, ctx.joining ?? []).map(hit => numberAt(f, foeW, hit))
  })

// ── Bunnies ─────────────────────────────────────────────────────────────

const BUNNY_GAP = 4
const bunnyHop: Key[] = [[0, 0, 0], [0.5, 0, -1], [1, 0, 0]]

// ── While Claude works ──────────────────────────────────────────────────

const workSwing = swing('HAMMER', 'HAMMER_DOWN', 250)
const workStation = (rows: Rows[]) => [
  track({ frames: rows, pal: WORLD_PAL, tick: 250, gap: STATION_GAP }),
  track({ frames: [SPARK, SPARK_B, SPARK_OFF, SPARK_OFF], pal: SPARK_PAL, tick: 125, gap: STATION_GAP, x: 1, y: GROUND - (rows[0]?.length ?? 0) - 3 }),
]
const WORK: Record<string, TrackDraw[]> = {
  read: [held('SIT', ['BOOK'])],
  edit: [...workStation([ANVIL]), workSwing.tool],
  bash: [...workStation([FURNACE_A, FURNACE_B]), workSwing.tool],
  lantern: [held('HOLD_A', ['LANTERN'])],
  torch: [held('HOLD_A', ['TORCH_A', 'TORCH_B'], { tick: 180 })],
}
const workOf = (prop: string | null | undefined, scene: string): TrackDraw[] | undefined =>
  prop === 'search' ? WORK[scene === 'cavern' || scene === 'night' ? 'torch' : 'lantern'] : prop ? WORK[prop] : undefined

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
    // The axe brandished up and ahead; the terminal, with no room above the
    // head for it, cheers empty-handed.
    ...layers(...timberTracks, held('CHEER', ['AXE_HIGH'], {}, false)),
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
    target: perLeg('target', stations('target')),
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
      perLeg('draw', ctx => APPROACH[ctx.leg.hit ? 'bow' : 'sword'][foeOf(ctx)]),
      held('HOLD_A', ['SWORD_DOWN'], { only: leg => !leg.hit }),
      held('HOLD_A', ['BOW_ARC'], { only: leg => !!leg.hit }),
    ),
  },
  strike: {
    move: { stay: 2400 },
    pose: swordSwing.pose,
    cues: [[600, 'hyah!'], [2000, '+1 coin']],
    crew: summonsJoin(FIGHTS.strike),
    ...layers(perLeg('draw', ctx => STRIKE[foeOf(ctx)]), swordSwing.tool, perLeg('over', ctx => STRIKE[foeOf(ctx)]), damageNumbers(FIGHTS.strike)),
  },
  shoot: {
    move: { stay: 2600 },
    pose: { frames: [BOW] },
    cues: [[300, 'steady…'], [2200, 'bullseye!']],
    ...layers(
      perLeg('draw', ctx => SHOOT[foeOf(ctx)]),
      held('BOW', ['BOW_ARC']),
      arrow(0.12, 0.3, 0),
      arrow(0.44, 0.6, 2),
      perLeg('over', ctx => SHOOT[foeOf(ctx)]),
      damageNumbers(FIGHTS.shoot),
    ),
    crew: summonsJoin(FIGHTS.shoot),
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
    draw: perLeg('draw', ctx => workOf(ctx.hero.prop, ctx.scene)),
  },
}
