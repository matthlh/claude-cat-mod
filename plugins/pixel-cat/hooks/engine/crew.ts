import type { Follower, Motion } from '../../types'
import type { Activity, Crew, CrewJoin, Dir, Pack, Palette, Rows } from '../packs/types'
import { clamp01, cycleFrames, faceRight, fmt, frames, hex, paths, posePeriod, widthOf } from './draw'
import { HEADROOM, HERO_COLS, HERO_H, HERO_W, LANE_PIX, LANE_ROWS, PX } from './geometry'
import { IN_BED, posAt, sameLeg } from './motion'

// The crew: one follower for each agent of this session that is working,
// trailing the hero. The brain looks at $.agent.list() once a tick and keeps
// a slot per agent (muster); both surfaces draw the followers from that and
// the hero's path, the pack only says what they look like (Pack.crew).
//
// Each follower walks the hero's own path, `lag` ms later than the one ahead
// of it, standing off behind the hero by its slot. The path is the trail:
// the last few legs the hero walked, and which way it faced on each. Where a
// leg asks a follower to stand somewhere else (the hero turned, or there is
// no room behind it, or it went to bed), the follower carries on along the
// old path until its lag is up, then walks round from wherever it is to its
// new place, facing the way it walks. Slots never move while an agent works,
// so nobody reshuffles: a gap stays where one left, until a new agent (or one
// waiting out of sight beyond the last visible slot) fills it.

/** A leg the hero walked, and which way it faced on it: the followers' path. */
export type Trail = { leg: Motion; dir: Dir }

/** The most followers drawn: on the desktop always, on the terminal on a wide enough lane. */
export const CREW_MAX = 5
/** The terminal draws one follower for each this many columns, up to CREW_MAX. */
const COLS_PER_FOLLOWER = 30
/** A follower fading in as its agent starts, and the puff it comes and goes in. */
const ENTER_MS = 400
const POOF_MS = 400
/** The happy hop as its agent finishes, then the poof it goes in. */
export const HOP_MS = 500
export const LEAVE_MS = HOP_MS + POOF_MS
/**
 * How long a leg stays in the trail after it ended: more than twice the
 * farthest follower's lag and longest walk-round (about 4 s), so a walk-round
 * still under way, even one that started from the middle of another, never
 * loses where it began.
 */
export const TRAIL_MS = 10_000
const TRAIL_MAX = 24
// Sprite px per ms a follower walks round to a new place.
const SLIDE_PX_MS = 0.04
const DEFAULT_LAG = 250
const DEFAULT_GAP = 2
const DEFAULT_STRIDE = 160
const GROUND = HERO_H / PX
// A flyer's bob: up and down a step every this many ms, a step out of time with the next one.
const BOB_MS = 600
// The happy hop: [fraction of HOP_MS, sprite px up], eased between.
const HOP: [number, number][] = [[0, 0], [0.25, 2], [0.5, 0], [0.75, 1], [1, 0]]
// Followers that stand in front of the hero, for want of room behind it,
// stand this far past its front: clear of a prop or a foe ahead of it.
const FRONT_CLEAR = HERO_COLS

/** The statuses that count as working: the rest (idle, completed, failed, killed) send a follower home. */
const WORKING_STATUSES: readonly string[] = ['pending', 'running', 'waiting']

export function isWorking(status: string): boolean {
  return WORKING_STATUSES.includes(status)
}

/** How many followers stand for an agent that is still working. */
export function workingCount(crew: readonly Follower[] | undefined): number {
  return (crew ?? []).filter(f => f.leavingAt === undefined).length
}

/** How many followers a terminal lane `cols` wide draws. */
export function terminalCap(cols: number): number {
  return Math.max(0, Math.min(CREW_MAX, Math.floor(cols / COLS_PER_FOLLOWER)))
}

/** The leg's join, if the pack has followers, the activity a join, and the join says yes to this leg. */
export function joinOf(pack: Pack, act: Activity | undefined, m: Motion): CrewJoin | undefined {
  const join = act?.crew
  return pack.crew && join && (!join.only || join.only(m)) ? join : undefined
}

/**
 * Ctx.joining: the slots of the followers an activity's join brings in on
 * leg `m`, nearest first: those drawn (the first `cap` slots) and still at
 * work. None when the pack has no followers, the activity no join, or the
 * join says no to this leg.
 */
export function joining(pack: Pack, act: Activity | undefined, m: Motion, crew: readonly Follower[] | undefined, cap: number): number[] {
  if (!joinOf(pack, act, m)) return []
  return (crew ?? []).filter(f => f.slot < cap && f.leavingAt === undefined).map(f => f.slot).sort((a, b) => a - b)
}

/**
 * The trail after the hero is seen on leg `m`, facing `dir`, at `now`: a new
 * leg goes on the end (any at or after its start, replaced, come off), the
 * same leg keeps its facing current, and legs that ended over TRAIL_MS ago
 * are dropped. Answers `trail` itself when nothing changed.
 */
export function extendTrail(trail: readonly Trail[], m: Motion, dir: Dir, now: number): Trail[] {
  const last = trail[trail.length - 1]
  if (last && sameLeg(last.leg, m)) return last.dir === dir ? (trail as Trail[]) : [...trail.slice(0, -1), { leg: m, dir }]
  const before = trail.filter(t => t.leg.t0 < m.t0)
  const kept = before.filter((t, i) => (before[i + 1]?.leg.t0 ?? m.t0) >= now - TRAIL_MS)
  return [...kept, { leg: m, dir }].slice(-TRAIL_MAX)
}

const sameCrew = (a: readonly Follower[], b: readonly Follower[]) =>
  a.length === b.length &&
  a.every((f, i) => {
    const g = b[i]
    return !!g && f.id === g.id && f.slot === g.slot && f.since === g.since && f.leavingAt === g.leavingAt
  })

/**
 * The crew after a look at the agent list at `now`. A working agent with no
 * follower gets one, in the lowest free slot; a follower whose agent stopped
 * working (or left the list) starts leaving, and is gone LEAVE_MS later,
 * freeing its slot; one whose agent works again comes back in the same slot.
 * A freed slot within the `cap` drawn (CREW_MAX on the desktop, fewer on a
 * narrow terminal) goes first to a follower waiting beyond them, the lowest
 * first, so the places in sight fill before any out of it. Answers `crew`
 * itself when nothing changed.
 */
export function muster(crew: readonly Follower[], agents: readonly { id: string; status: string }[], now: number, cap = CREW_MAX): Follower[] {
  const on = new Set(agents.filter(a => isWorking(a.status)).map(a => a.id))
  let out: Follower[] = []
  for (const f of crew) {
    if (f.leavingAt === undefined) out.push(on.has(f.id) ? f : { ...f, leavingAt: now })
    else if (on.has(f.id)) out.push({ id: f.id, slot: f.slot, since: now })
    else if (now < f.leavingAt + LEAVE_MS) out.push(f)
  }
  const used = new Set(out.map(f => f.slot))
  const seen = Math.max(0, Math.min(CREW_MAX, cap))
  for (let s = 0; s < seen; s++) {
    if (used.has(s)) continue
    const waiting = out.filter(f => f.slot >= seen && f.leavingAt === undefined).sort((a, b) => a.slot - b.slot)[0]
    if (!waiting) break
    used.delete(waiting.slot)
    used.add(s)
    out = out.map(f => (f === waiting ? { ...f, slot: s, since: now } : f))
  }
  const known = new Set(out.map(f => f.id))
  for (const a of agents) {
    if (!on.has(a.id) || known.has(a.id)) continue
    let slot = 0
    while (used.has(slot)) slot++
    used.add(slot)
    known.add(a.id)
    out.push({ id: a.id, slot, since: now })
  }
  out.sort((a, b) => a.slot - b.slot)
  return sameCrew(crew, out) ? (crew as Follower[]) : out
}

/**
 * A CrewJoin for a lunge: the followers dash `reach` sprite px forward and
 * back, the farthest point at `at` of the leg (a strike's moment), over
 * `span` of the leg (default 0.16). `rise` lifts them that many px at the
 * peak; a negative one dives, for flyers.
 */
export function lunge(at: number, reach: number, o: { span?: number; rise?: number; stagger?: number; together?: boolean; only?(leg: Motion): boolean } = {}): CrewJoin {
  const span = o.span ?? 0.16
  const a = clamp01(at - span / 2)
  const b = Math.max(a + 0.001, clamp01(at + span / 2))
  const peak = clamp01((clamp01(at) - a) / (b - a))
  const join: CrewJoin = { during: [a, b], keys: [[0, 0, 0], [peak, reach, -(o.rise ?? 0)], [1, 0, 0]] }
  if (o.stagger !== undefined) join.stagger = o.stagger
  if (o.only) join.only = o.only
  if (o.together) join.together = true
  return join
}

// ── One follower's moves, the same on both surfaces ─────────────────────

/** Every sprite one kind of follower draws, for its size. */
export function crewSprites(art: Crew): Rows[] {
  return [...art.move, ...art.idle.frames, ...(art.act?.frames ?? []), ...(art.cheer ? [art.cheer] : []), ...(art.rest?.frames ?? [])]
}

/**
 * The art the follower in `slot` is drawn with: its kind (Crew.kinds) laid
 * over the crew's own. While the hero sleeps (`asleep`), a crew with a rest
 * pose shows it, on the ground.
 */
export function crewArt(art: Crew, slot: number, asleep = false): Crew {
  const kind = art.kinds?.length ? art.kinds[slot % art.kinds.length] : undefined
  const a: Crew = kind ? { ...art, ...kind } : art
  if (!asleep || !a.rest) return a
  const grounded: Crew = { ...a, idle: a.rest }
  delete grounded.flying
  return grounded
}

/** Every kind of follower a crew has: its kinds laid over it, or itself. */
export function crewArts(art: Crew): Crew[] {
  return art.kinds?.length ? art.kinds.map((_, i) => crewArt(art, i)) : [art]
}

/** The lane in sprite px: how far the hero's left edge travels, and how wide it is. */
export type Room = { span: number; width: number }

/** What both surfaces need to draw the crew at one moment. */
export type CrewScene = {
  art: Crew | undefined
  crew: readonly Follower[] | undefined
  m: Motion
  /** the legs before this one, oldest first (any at or after m.t0 are left out) */
  trail: readonly Trail[] | undefined
  /** which way the hero faces now */
  dir: Dir
  /** a leg's join, if its followers join in on it (joinOf) */
  joinOf(leg: Motion): CrewJoin | undefined
  now: number
  /** the hero is asleep in its bed: followers with a rest pose settle (Crew.rest) */
  asleep?: boolean
  /** the lane's size, to keep the followers in it; absent, the lane is taken to be endless */
  room?: Room
  /** sprite px from the hero's left edge at lane position 0 to the far side of its bed and its z's */
  bed?: number
}

/** Where a leg asks a follower to stand: sprite px from the hero's left edge, and the way it faces. */
type Place = { off: number; face: Dir }
/** A walk-round: from where it was at `at` to a leg's place, `ms` long, facing the way it walks. */
type Turn = { at: number; from: number; to: number; ms: number; face: Dir }

type One = {
  art: Crew
  f: Follower
  /** its place in the line: its slot */
  j: number
  /** ms behind the hero along its path */
  lag: number
  gap: number
  fw: number
  fh: number
  m: Motion
  /** the trail and this leg, oldest first */
  legs: Trail[]
  /** where it stands before the first walk-round, and the walk-rounds in order */
  start: Place
  turns: Turn[]
  join?: CrewJoin
  pal: Palette
}

/** Sprite px from the hero's left edge to the follower's, standing behind a hero that faces `side`. */
function standOff(o: Pick<One, 'j' | 'fw' | 'gap'>, side: Dir): number {
  return side === 1 ? -(o.j + 1) * (o.fw + o.gap) : HERO_COLS + o.gap + o.j * (o.fw + o.gap)
}

/**
 * Where a leg asks it to stand. Behind the hero as a rule; by the bed while
 * the hero sleeps in it; and on a leg on the spot that nobody joins in on,
 * where the room behind the hero runs out (the hero faces the room, so its
 * back is to the near edge), in front of it instead, past anything the hero
 * is busy with, facing the hero, the ones that fit behind staying there.
 */
function placeOf(o: Pick<One, 'j' | 'fw' | 'gap'>, t: Trail, sc: CrewScene): Place {
  const { leg, dir } = t
  const step = o.fw + o.gap
  if (sc.bed !== undefined && leg.activity === IN_BED) return { off: Math.max(standOff(o, -1), sc.bed + o.gap + o.j * step), face: -1 }
  const behind: Place = { off: standOff(o, dir), face: dir }
  const room = sc.room
  if (!room || leg.from !== leg.to || sc.joinOf(leg)) return behind
  const x = posAt(leg, leg.t0) * room.span
  const inLane = (off: number) => x + off >= 0 && x + off + o.fw <= room.width
  if (inLane(behind.off)) return behind
  // How many slots fit behind, and so this one's place among those in front.
  const fit = dir === 1 ? Math.floor(x / step) : Math.floor((room.width - x - HERO_COLS - o.gap - o.fw) / step) + 1
  const k = o.j - Math.max(0, fit)
  const front = dir === 1 ? HERO_COLS + FRONT_CLEAR + o.gap + k * step : -FRONT_CLEAR - (k + 1) * step
  return inLane(front) ? { off: front, face: -dir as Dir } : behind
}

function offWith(start: Place, turns: readonly Turn[], t: number): number {
  let turn: Turn | undefined
  for (const u of turns) if (u.at <= t) turn = u
  if (!turn) return start.off
  return turn.from + (turn.to - turn.from) * (turn.ms > 0 ? clamp01((t - turn.at) / turn.ms) : 1)
}

function one(sc: CrewScene, f: Follower): One | null {
  if (!sc.art) return null
  const art = crewArt(sc.art, f.slot, sc.asleep)
  const sprites = crewSprites(art)
  const shape = { j: f.slot, gap: art.gap ?? DEFAULT_GAP, fw: Math.max(1, ...sprites.map(widthOf)) }
  const lag = (f.slot + 1) * (art.lag ?? DEFAULT_LAG)
  const legs: Trail[] = [...(sc.trail ?? []).filter(t => t.leg.t0 < sc.m.t0), { leg: sc.m, dir: sc.dir }]
  const first = legs[0] ?? { leg: sc.m, dir: sc.dir }
  const start = placeOf(shape, first, sc)
  const turns: Turn[] = []
  let was = start
  for (const t of legs.slice(1)) {
    const p = placeOf(shape, t, sc)
    if (p.off === was.off && p.face === was.face) continue
    const at = t.leg.t0 + lag
    const from = offWith(start, turns, at)
    turns.push({ at, from, to: p.off, ms: Math.abs(p.off - from) / SLIDE_PX_MS, face: p.face })
    was = p
  }
  const join = sc.joinOf(sc.m)
  return {
    art,
    f,
    ...shape,
    lag,
    fh: Math.max(1, ...sprites.map(r => r.length)),
    m: sc.m,
    legs,
    start,
    turns,
    ...(join ? { join } : {}),
    pal: art.coats[f.slot % art.coats.length] ?? art.coats[0],
  }
}

// The hero's lane position at `s`, on the leg it was on then.
function heroAt(o: One, s: number): number {
  let at: Motion | undefined
  for (const t of o.legs) if (t.leg.t0 <= s) at = t.leg
  return at ? posAt(at, s) : (o.legs[0]?.leg.from ?? o.m.from)
}

/** The follower's lane position at `t`: the hero's, its lag earlier. */
function laneAt(o: One, t: number): number {
  return heroAt(o, t - o.lag)
}

/** Sprite px from the hero's left edge to the follower's at `t`, walking round as legs ask. */
function offAt(o: One, t: number): number {
  return offWith(o.start, o.turns, t)
}

function turnAt(o: One, t: number): Turn | undefined {
  let turn: Turn | undefined
  for (const u of o.turns) if (u.at <= t) turn = u
  return turn
}

/** Which way it faces at `t`: the way it walks round, then the way its place asks. */
function sideAt(o: One, t: number): Dir {
  const turn = turnAt(o, t)
  if (!turn) return o.start.face
  if (t < turn.at + turn.ms && turn.to !== turn.from) return turn.to > turn.from ? 1 : -1
  return turn.face
}

function moving(o: One, t: number): boolean {
  const s = t - o.lag
  const walks = o.legs.some(({ leg }, i) => {
    const end = Math.min(leg.t0 + leg.dur, o.legs[i + 1]?.leg.t0 ?? Infinity)
    return leg.from !== leg.to && s >= leg.t0 && s < end
  })
  if (walks) return true
  const turn = turnAt(o, t)
  return !!turn && turn.to !== turn.from && t < turn.at + turn.ms
}

// When its part of the join starts, staggered down the line.
const joinStart = (o: One) => o.m.t0 + (o.join?.stagger ?? 0) * o.j

function joinWindow(o: One): [number, number] | null {
  if (!o.join || !(o.m.dur > 0) || !Number.isFinite(o.m.dur)) return null
  const [a, b] = o.join.during
  const st = joinStart(o)
  return b > a ? [st + clamp01(a) * o.m.dur, st + clamp01(b) * o.m.dur] : null
}

// How far it goes for each px of dx: further back, further, for a join that goes together.
function reachOf(o: One): number {
  if (!o.join?.together) return 1
  const most = Math.max(0, ...(o.join.keys ?? []).map(k => Math.abs(k[1])))
  return most > 0 ? (most + o.j * (o.fw + o.gap)) / most : 1
}

// Where the join puts it at `t`: [dx forward, dy down] in sprite px.
function joinAt(o: One, t: number): [number, number] {
  const w = joinWindow(o)
  const keys = o.join?.keys
  if (!w || !keys?.length || t < w[0] || t >= w[1]) return [0, 0]
  const u = (t - w[0]) / (w[1] - w[0])
  const ks = [...keys].sort((a, b) => a[0] - b[0])
  let i = 0
  while (i + 1 < ks.length && (ks[i + 1]?.[0] ?? Infinity) <= u) i++
  const a = ks[i]
  const b = ks[i + 1]
  if (!a) return [0, 0]
  const r = reachOf(o)
  if (!b || u <= a[0]) return [a[1] * r, a[2]]
  const k = (u - a[0]) / Math.max(1e-9, b[0] - a[0])
  return [(a[1] + (b[1] - a[1]) * k) * r, a[2] + (b[2] - a[2]) * k]
}

type State = 'idle' | 'move' | 'act' | 'cheer' | 'gone'
function stateAt(o: One, t: number): State {
  const { leavingAt } = o.f
  if (leavingAt !== undefined && t >= leavingAt + HOP_MS) return 'gone'
  if (leavingAt !== undefined && t >= leavingAt) return 'cheer'
  const w = joinWindow(o)
  if (w && t >= w[0] && t < w[1]) return 'act'
  return moving(o, t) ? 'move' : 'idle'
}

// Every moment after `now` where something about it changes, in order.
function changes(o: One, now: number): number[] {
  const out: number[] = []
  const add = (t: number | undefined) => {
    if (t !== undefined && Number.isFinite(t) && t > now) out.push(Math.round(t))
  }
  for (const { leg } of o.legs) {
    add(leg.t0 + o.lag)
    add(leg.t0 + leg.dur + o.lag)
  }
  for (const turn of o.turns) {
    add(turn.at)
    add(turn.at + turn.ms)
  }
  const w = joinWindow(o)
  if (w) {
    add(w[0])
    add(w[1])
  }
  if (o.f.leavingAt !== undefined) {
    add(o.f.leavingAt)
    add(o.f.leavingAt + HOP_MS)
    add(o.f.leavingAt + LEAVE_MS)
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

// Sprite px up, `ms` into the happy hop.
function hopAt(ms: number): number {
  const u = ms / HOP_MS
  for (let i = 1; i < HOP.length; i++) {
    const [ta, ya] = HOP[i - 1] ?? [0, 0]
    const [tb, yb] = HOP[i] ?? [1, 0]
    if (u <= tb) return ya + (yb - ya) * clamp01((u - ta) / Math.max(1e-9, tb - ta))
  }
  return 0
}

// A flyer's bob at `t`: 1 on the up step.
const bobUp = (o: One, t: number) => ((Math.floor(t / BOB_MS + o.j) % 2) + 2) % 2

const PUFF: { frames: [Rows, ...Rows[]]; pal: Palette } = {
  frames: [
    ['.....', '..w..', '.www.', '..w..', '.....'],
    ['.w.w.', 'w...w', '..y..', 'w...w', '.w.w.'],
    ['w...w', '.....', '..y..', '.....', 'w...w'],
  ],
  pal: { w: 0xf2efe8, y: 0xf5c542 },
}

// Which followers are drawn: those in the first `cap` slots, until they are gone.
function shown(crew: readonly Follower[], cap: number, now: number): Follower[] {
  return crew.filter(f => f.slot < cap && (f.leavingAt === undefined || now < f.leavingAt + LEAVE_MS))
}

// Working, but beyond the slots drawn.
function hiddenCount(crew: readonly Follower[], cap: number): number {
  return crew.filter(f => f.slot >= cap && f.leavingAt === undefined).length
}

// Its left edge at `t`, in sprite px from the lane's.
function xAt(o: One, t: number, span: number): number {
  return laneAt(o, t) * span + offAt(o, t) + joinAt(o, t)[0] * sideAt(o, t)
}

// Working, drawn, and entirely outside the lane at `now`: counted in "+N" with those out of sight.
function offLane(o: One, now: number, room: Room | undefined): boolean {
  if (!room || o.f.leavingAt !== undefined) return false
  const x = xAt(o, now, room.span)
  return x + o.fw <= 0 || x >= room.width
}

// Where "+N" goes when no follower in the lane carries it: beside the hero
// (left edge `heroX`, `heroW` wide, both in the lane's units), behind it,
// unless only the front has room for a label `w` wide.
function besideHero(dir: Dir, heroX: number, heroW: number, w: number, width: number | undefined): Dir {
  const behind: Dir = dir === 1 ? -1 : 1
  if (width === undefined) return behind
  const fits = (s: Dir) => (s === -1 ? heroX - 1 - w >= 0 : heroX + heroW + 1 + w <= width)
  return fits(behind) || !fits(-behind as Dir) ? behind : (-behind as Dir)
}

// ── Desktop ─────────────────────────────────────────────────────────────

const msOf = (n: number) => `${Math.round(n)}ms`
const FONT = 'font-family="ui-monospace, Menlo, monospace" font-size="9" font-weight="bold"'

function label(n: number, x: number, y: number, anchor: 'start' | 'end', color: number, extra = ''): string {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" ${FONT} fill="${hex(color)}"${extra}>+${n}</text>`
}

/**
 * Every follower drawn, beneath the hero, in lane coordinates: each in an svg
 * whose x is the hero's glide begun its lag later, so they trail. `pct` turns
 * a lane position into the hero's left edge there, `cur` is the hero's
 * position now. "+N" for the working ones out of sight (beyond CREW_MAX, or
 * outside the lane) goes beside the last one in the lane, or beside the hero
 * when none is.
 */
export function crewSvg(sc: CrewScene, pct: (p: number) => string, cur: number, labelColor: number): string {
  const { art, crew, now } = sc
  if (!art || !crew?.length) return ''
  const ones = shown(crew, CREW_MAX, now).flatMap(f => one(sc, f) ?? [])
  const away = ones.filter(o => offLane(o, now, sc.room))
  const more = hiddenCount(crew, CREW_MAX) + away.length
  const last = ones.filter(o => !away.includes(o)).reduce<One | undefined>((a, o) => (!a || o.j > a.j ? o : a), undefined)
  const out = [...ones].sort((a, b) => b.j - a.j).map(o => followerSvg(o, now, pct, o === last ? more : 0, labelColor))
  if (!last && more) {
    const width = sc.room ? sc.room.width * PX : undefined
    const side = besideHero(sc.dir, cur * (sc.room?.span ?? 0) * PX, HERO_W, `+${more}`.length * 6, width)
    const x = side === -1 ? -4 : HERO_W + 4
    out.push(`<svg x="${pct(cur)}" y="${HEADROOM}" width="${HERO_W}" height="${HERO_H}" overflow="visible">${label(more, x, HERO_H - 6, side === -1 ? 'end' : 'start', labelColor)}</svg>`)
  }
  return out.length ? `<g shape-rendering="crispEdges">${out.join('')}</g>` : ''
}

// One sprite standing on the follower's feet, as paths (compact: five of them share the frame's cap).
const spriteSvg = (o: One, rows: Rows) => paths(rows, o.pal, PX, 0, (o.fh - rows.length) * PX)

function poseSvg(o: One, frameList: Rows[], period: number): string {
  return frameList.length > 1 ? cycleFrames(frameList.map(r => spriteSvg(o, r)), period) : spriteSvg(o, frameList[0] ?? [])
}

function followerSvg(o: One, now: number, pct: (p: number) => string, more: number, labelColor: number): string {
  const { art, f } = o
  const times = [now, ...changes(o, now)]
  const end = times[times.length - 1] ?? now
  const total = end - now
  const kt = total > 0 ? `keyTimes="${times.map(t => fmt((t - now) / total, 6)).join(';')}"` : ''
  const timing = `${kt} dur="${msOf(total)}" fill="freeze"`
  // The state through the stretch from each moment to the next (after the last, for good).
  const mid = (i: number) => {
    const t = times[i] ?? now
    const next = times[i + 1]
    return next === undefined ? t + 1 : (t + next) / 2
  }
  // A value at each moment, eased (positions) or stepped (states); still when it never changes.
  const anim = (values: string[], attr: string, discrete: boolean, transform?: string) => {
    if (total <= 0 || values.every(v => v === values[0])) return ''
    const head = transform ? `<animateTransform attributeName="transform" type="${transform}"` : `<animate attributeName="${attr}"`
    return `${head} values="${values.join(';')}" ${discrete ? 'calcMode="discrete" ' : ''}${timing}/>`
  }

  // Along the hero's path, its lag behind.
  const xs = times.map(t => pct(laneAt(o, t)))
  const glide = anim(xs, 'x', false)
  // Standing off from the hero, walking round to a new place.
  const offs = times.map(t => `${fmt(offAt(o, t) * PX, 6)} 0`)
  const off = `<g transform="translate(${offs[0]})">${anim(offs, '', false, 'translate')}`
  // Joining in: forward the way it faces, and down.
  let joinAnim = ''
  const w = joinWindow(o)
  if (w && o.join?.keys?.length && w[1] > now) {
    const dur = o.m.dur
    const st = joinStart(o)
    const ks = [...o.join.keys].sort((a, b) => a[0] - b[0])
    const [a, b] = o.join.during.map(clamp01) as [number, number]
    const side = sideAt(o, w[0])
    const pts: [number, number, number][] = []
    if (a > 0) pts.push([0, 0, 0])
    const r = reachOf(o)
    for (const [t, dx, dy] of ks) pts.push([a + (b - a) * clamp01(t), dx * side * r, dy])
    const lastKey = pts[pts.length - 1]
    if (b < 1) {
      if (lastKey && (lastKey[1] !== 0 || lastKey[2] !== 0)) pts.push([b, 0, 0])
      pts.push([1, 0, 0])
    }
    if (pts[0]?.[0] !== 0) pts.unshift([0, 0, 0])
    joinAnim = `<animateTransform attributeName="transform" type="translate" values="${pts.map(p => `${fmt(p[1] * PX, 6)} ${fmt(p[2] * PX, 6)}`).join(';')}" keyTimes="${pts.map(p => fmt(p[0], 6)).join(';')}" dur="${msOf(dur)}" begin="${msOf(st - now)}" fill="freeze"/>`
  }
  // Hovering, for a flyer, with a bob a step up and down, in step with the terminal's.
  const height = art.flying?.height ?? 0
  const bobPx = (art.flying?.bob ?? 1) * PX
  const phase = ((now / BOB_MS + o.j) % 2 + 2) % 2
  const bob = art.flying && bobPx
    ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 ${-bobPx}" calcMode="discrete" dur="${msOf(2 * BOB_MS)}" begin="${msOf(-phase * BOB_MS)}" repeatCount="indefinite"/>`
    : ''
  const top = (GROUND - o.fh - height) * PX
  // The happy hop as its agent finishes.
  const hop = f.leavingAt !== undefined && now < f.leavingAt + HOP_MS
    ? `<animateTransform attributeName="transform" type="translate" values="${HOP.map(([, y]) => `0 ${fmt(-y * PX)}`).join(';')}" keyTimes="${HOP.map(([t]) => fmt(t)).join(';')}" dur="${HOP_MS}ms" begin="${msOf(f.leavingAt - now)}"/>`
    : ''
  const fade = now < f.since + ENTER_MS ? `<animate attributeName="opacity" values="0;1" dur="${ENTER_MS}ms" begin="${msOf(f.since - now)}"/>` : ''

  // What it shows: one group a state, each up while the state holds.
  const states = times.map((_, i) => stateAt(o, mid(i)))
  const group = (state: State, body: string) => {
    if (!states.includes(state) && stateAt(o, now) !== state) return ''
    const vals = states.map(s => (s === state ? '1' : '0'))
    const start = stateAt(o, now) === state ? '1' : '0'
    return `<g${start === '1' ? '' : ' opacity="0"'}>${anim([start, ...vals.slice(1)], 'opacity', true)}${body}</g>`
  }
  const stride = art.stride ?? DEFAULT_STRIDE
  const idle = group('idle', poseSvg(o, art.idle.frames, posePeriod(art.idle)))
  const walk = group('move', frames(spriteSvg(o, art.move[0]), spriteSvg(o, art.move[1]), (stride * 2) / 1000))
  const act = o.join ? group('act', poseSvg(o, (art.act ?? art.idle).frames, posePeriod(art.act ?? art.idle))) : ''
  const cheer = f.leavingAt !== undefined ? group('cheer', spriteSvg(o, art.cheer ?? art.idle.frames[0])) : ''
  // Facing the way it walks or stands: rows face left as written.
  const sides = times.map((_, i) => sideAt(o, mid(i)))
  const flip = (s: Dir) => (s === 1 ? '-1 1' : '1 1')
  const faceVals = [flip(sideAt(o, now)), ...sides.slice(1).map(flip)]
  const cx = (o.fw * PX) / 2
  const body = `<g transform="translate(${fmt(cx, 6)} 0)"><g transform="scale(${faceVals[0]})">${anim(faceVals, '', true, 'scale')}<g transform="translate(${fmt(-cx, 6)} 0)">${idle}${walk}${act}${cheer}</g></g></g>`

  // The puff it comes and goes in, each frame up for its share.
  const puff = art.poof ?? PUFF
  const pw = widthOf(puff.frames[0])
  const ph = puff.frames[0].length
  const puffs: string[] = []
  const window = (from: number) => {
    const n = puff.frames.length
    puff.frames.forEach((rows, i) => {
      const b = from + (i * POOF_MS) / n
      const d = POOF_MS / n
      if (b + d <= now) return
      puffs.push(`<g opacity="0"><set attributeName="opacity" to="1" begin="${msOf(b - now)}" dur="${msOf(d)}"/>${paths(rows, puff.pal, PX, Math.floor((o.fw - pw) / 2) * PX, (o.fh - ph) * PX)}</g>`)
    })
  }
  window(f.since)
  if (f.leavingAt !== undefined) window(f.leavingAt + HOP_MS)

  // "+N" on its far side: behind it, the way it faces.
  let tag = ''
  if (more) {
    const y = top + o.fh * PX - 3
    const left = label(more, -3, y, 'end', labelColor)
    const right = label(more, o.fw * PX + 3, y, 'start', labelColor)
    const shows = (s: Dir) => [s === sideAt(o, now) ? '1' : '0', ...sides.slice(1).map(x => (x === s ? '1' : '0'))]
    const wrap = (s: Dir, text: string) => {
      const vals = shows(s)
      if (vals.every(v => v === '0')) return ''
      return `<g${vals[0] === '1' ? '' : ' opacity="0"'}>${anim(vals, 'opacity', true)}${text}</g>`
    }
    tag = wrap(1, left) + wrap(-1, right)
  }

  return `<svg x="${xs[0]}" y="${HEADROOM}" width="${HERO_W}" height="${HERO_H}" overflow="visible">${glide}${off}<g>${joinAnim}<g transform="translate(0 ${fmt(top, 6)})"><g>${bob}<g>${hop}<g>${fade}${body}</g></g>${puffs.join('')}</g></g></g>${tag}</g></svg>`
}

// ── Terminal ────────────────────────────────────────────────────────────

/**
 * Every follower drawn on a terminal lane `cols` wide, sampled at now: one
 * for each COLS_PER_FOLLOWER columns, up to CREW_MAX. The lane's `room` is in
 * columns (span: those the hero's left edge travels). Answers where "+N"
 * goes, if anything is out of sight.
 */
export function crewCells(
  sc: CrewScene & { room: Room },
  cols: number,
  heroX: number,
  plot: (rows: Rows, x: number, y: number, pal: Palette) => void,
): { x: number; y: number; text: string } | null {
  const { art, crew, now, room } = sc
  if (!art || !crew?.length) return null
  const cap = terminalCap(cols)
  const ones = shown(crew, cap, now).flatMap(f => one(sc, f) ?? [])
  const away = ones.filter(o => offLane(o, now, room))
  const more = hiddenCount(crew, cap) + away.length
  let tag: { x: number; y: number; text: string } | null = null
  let lastSlot = -1
  for (const o of [...ones].sort((a, b) => b.j - a.j)) {
    const { f, art: kind } = o
    const side = sideAt(o, now)
    const state = stateAt(o, now)
    const x = Math.round(xAt(o, now, room.span))
    const jy = joinAt(o, now)[1]
    const height = kind.flying?.height ?? 0
    const bob = kind.flying && bobUp(o, now) ? -(kind.flying.bob ?? 1) : 0
    const hop = state === 'cheer' && f.leavingAt !== undefined ? -Math.round(hopAt(now - f.leavingAt)) : 0
    const ground = GROUND - height + bob
    const puff = kind.poof ?? PUFF
    const puffAt = (from: number) => {
      const rows = puff.frames[Math.floor(((now - from) / POOF_MS) * puff.frames.length)]
      if (now < from || !rows) return
      plot(rows, x + Math.floor((o.fw - widthOf(rows)) / 2), ground - Math.round((o.fh + rows.length) / 2), puff.pal)
    }
    if (state === 'gone') {
      if (f.leavingAt !== undefined) puffAt(f.leavingAt + HOP_MS)
    } else {
      // Coming in, it shows once it is half faded in on the desktop, under its puff.
      if (now >= f.since + ENTER_MS / 2) {
        const pick = (list: Rows[], tick: number) => list[Math.floor(now / Math.max(1, tick)) % list.length] ?? list[0] ?? []
        const rows =
          state === 'cheer' ? kind.cheer ?? kind.idle.frames[0]
          : state === 'act' ? pick((kind.act ?? kind.idle).frames, (kind.act ?? kind.idle).tick ?? 500)
          : state === 'move' ? pick(kind.move, kind.stride ?? DEFAULT_STRIDE)
          : pick(kind.idle.frames, kind.idle.tick ?? 500)
        // Never above the lane's top row: a flyer's hop is cut short instead.
        const y = Math.max(Math.min(0, LANE_PIX - rows.length), ground - rows.length + hop + Math.round(jy))
        plot(side === 1 ? faceRight(rows) : rows, x, y, o.pal)
      }
      puffAt(f.since)
    }
    if (o.j > lastSlot && more && !away.includes(o)) {
      lastSlot = o.j
      const text = `+${more}`
      tag = { x: side === 1 ? x - 1 - text.length : x + o.fw + 1, y: LANE_ROWS - 2, text }
    }
  }
  if (!tag && more) {
    const text = `+${more}`
    const side = besideHero(sc.dir, heroX, HERO_COLS, text.length, room.width)
    tag = { x: side === -1 ? heroX - 1 - text.length : heroX + HERO_COLS + 1, y: LANE_ROWS - 2, text }
  }
  return tag
}
