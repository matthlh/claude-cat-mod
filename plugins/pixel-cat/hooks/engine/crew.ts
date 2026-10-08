import type { Follower, Motion } from '../../types'
import type { Crew, CrewJoin, Dir, Palette, Rows } from '../packs/types'
import { clamp01, cycleFrames, faceRight, frames, hex, paths, posePeriod } from './draw'
import { HEADROOM, HERO_COLS, HERO_H, HERO_W, LANE_ROWS, PX } from './geometry'
import { posAt } from './motion'

// The crew: one follower for each agent of this session that is working,
// trailing the hero. The brain looks at $.agent.list() once a tick and keeps
// a slot per agent (muster); both surfaces draw the followers from that and
// the hero's path, the pack only says what they look like (Pack.crew).
//
// Each follower walks the hero's own path, `lag` ms later than the one ahead
// of it, standing off behind the hero by its slot. When the hero heads the
// other way, a follower carries on along the old path until its lag is up,
// then walks round to the hero's new back. Slots never move while an agent
// works, so nobody reshuffles: a gap stays where one left, until a new agent
// (or one waiting out of sight beyond the last visible slot) fills it.

/** The leg before the current one, and which way the hero faced on it: where a follower still is while its lag runs out. */
export type Trail = { leg: Motion; dir: Dir }

/** The most followers drawn: on the desktop always, on the terminal on a wide enough lane. */
export const CREW_MAX = 5
/** The terminal draws one follower for each this many columns, up to CREW_MAX. */
export const COLS_PER_FOLLOWER = 30
/** A follower fading in as its agent starts. */
export const ENTER_MS = 400
/** The happy hop as its agent finishes, then the poof it goes in. */
export const HOP_MS = 500
export const POOF_MS = 400
export const LEAVE_MS = HOP_MS + POOF_MS
// Sprite px per ms a follower walks to the hero's other side when it turns.
const SLIDE_PX_MS = 0.04
const DEFAULT_LAG = 250
const DEFAULT_GAP = 2
const DEFAULT_STRIDE = 160
const GROUND = HERO_H / PX

/** The statuses that count as working: the rest (idle, completed, failed, killed) send a follower home. */
export const WORKING_STATUSES: readonly string[] = ['pending', 'running', 'waiting']

export function isWorking(status: string): boolean {
  return WORKING_STATUSES.includes(status)
}

/** How many followers stand for an agent that is still working. */
export function workingCount(crew: readonly Follower[] | undefined): number {
  return (crew ?? []).filter(f => f.leavingAt === undefined).length
}

/** The slots of the followers drawn (the first `cap`) and still at work, nearest first: Ctx.crew. */
export function joiningSlots(crew: readonly Follower[] | undefined, cap: number): number[] {
  return (crew ?? []).filter(f => f.slot < cap && f.leavingAt === undefined).map(f => f.slot).sort((a, b) => a - b)
}

/** How many followers a terminal lane `cols` wide draws. */
export function terminalCap(cols: number): number {
  return Math.max(0, Math.min(CREW_MAX, Math.floor(cols / COLS_PER_FOLLOWER)))
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
 * A freed slot within CREW_MAX goes first to a follower waiting beyond it,
 * the lowest first. Answers `crew` itself when nothing changed.
 */
export function muster(crew: readonly Follower[], agents: readonly { id: string; status: string }[], now: number): Follower[] {
  const on = new Set(agents.filter(a => isWorking(a.status)).map(a => a.id))
  let out: Follower[] = []
  for (const f of crew) {
    if (f.leavingAt === undefined) out.push(on.has(f.id) ? f : { ...f, leavingAt: now })
    else if (on.has(f.id)) out.push({ id: f.id, slot: f.slot, since: now })
    else if (now < f.leavingAt + LEAVE_MS) out.push(f)
  }
  const used = new Set(out.map(f => f.slot))
  for (let s = 0; s < CREW_MAX; s++) {
    if (used.has(s)) continue
    const waiting = out.filter(f => f.slot >= CREW_MAX && f.leavingAt === undefined).sort((a, b) => a.slot - b.slot)[0]
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

const widthOf = (rows: Rows) => rows.reduce((w, r) => Math.max(w, r.length), 0)

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
  trail?: Trail
  /** which way the hero faces now */
  dir: Dir
  join?: CrewJoin
  pal: Palette
}

function one(crew: Crew, f: Follower, m: Motion, trail: Trail | undefined, dir: Dir, join: CrewJoin | undefined, asleep = false): One {
  const art = crewArt(crew, f.slot, asleep)
  const sprites = crewSprites(art)
  return {
    art,
    f,
    j: f.slot,
    lag: (f.slot + 1) * (art.lag ?? DEFAULT_LAG),
    gap: art.gap ?? DEFAULT_GAP,
    fw: Math.max(1, ...sprites.map(widthOf)),
    fh: Math.max(1, ...sprites.map(r => r.length)),
    m,
    trail,
    dir,
    join: join && (!join.only || join.only(m)) ? join : undefined,
    pal: art.coats[f.slot % art.coats.length] ?? art.coats[0],
  }
}

// The hero's lane position at `s`, on this leg or, before it, the one before.
function heroAt(o: One, s: number): number {
  if (s >= o.m.t0) return posAt(o.m, s)
  return o.trail ? posAt(o.trail.leg, s) : o.m.from
}

/** The follower's lane position at `t`: the hero's, its lag earlier. */
function laneAt(o: One, t: number): number {
  return heroAt(o, t - o.lag)
}

/** Sprite px from the hero's left edge to the follower's, standing behind a hero that faces `side`. */
function standOff(o: One, side: Dir): number {
  return side === 1 ? -(o.j + 1) * (o.fw + o.gap) : HERO_COLS + o.gap + o.j * (o.fw + o.gap)
}

type Turn = { at: number; from: Dir; ms: number }
function turnOf(o: One): Turn | null {
  const was = o.trail?.dir ?? o.dir
  if (was === o.dir) return null
  return { at: o.m.t0 + o.lag, from: was, ms: Math.max(1, Math.abs(standOff(o, o.dir) - standOff(o, was)) / SLIDE_PX_MS) }
}

function offAt(o: One, t: number): number {
  const turn = turnOf(o)
  if (!turn) return standOff(o, o.dir)
  if (t < turn.at) return standOff(o, turn.from)
  const k = clamp01((t - turn.at) / turn.ms)
  return standOff(o, turn.from) + (standOff(o, o.dir) - standOff(o, turn.from)) * k
}

function sideAt(o: One, t: number): Dir {
  const turn = turnOf(o)
  return turn && t < turn.at ? turn.from : o.dir
}

function moving(o: One, t: number): boolean {
  const s = t - o.lag
  const walks = (leg: Motion) => leg.from !== leg.to && s >= leg.t0 && s < leg.t0 + leg.dur
  if (walks(o.m) || (o.trail && s < o.m.t0 && walks(o.trail.leg))) return true
  const turn = turnOf(o)
  return !!turn && t >= turn.at && t < turn.at + turn.ms
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
  if (o.trail) {
    add(o.trail.leg.t0 + o.lag)
    add(o.trail.leg.t0 + o.trail.leg.dur + o.lag)
  }
  add(o.m.t0 + o.lag)
  add(o.m.t0 + o.m.dur + o.lag)
  const turn = turnOf(o)
  if (turn) {
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

/** What both surfaces need to draw the crew at one moment. */
export type CrewScene = {
  art: Crew | undefined
  crew: readonly Follower[] | undefined
  m: Motion
  trail: Trail | undefined
  dir: Dir
  /** the current leg's activity's join, if it has one */
  join: CrewJoin | undefined
  now: number
  /** the hero is asleep in its bed: followers with a rest pose settle (Crew.rest) */
  asleep?: boolean
}

// ── Desktop ─────────────────────────────────────────────────────────────

const fmt = (n: number) => String(Number(n.toFixed(6)))
const msOf = (n: number) => `${Math.round(n)}ms`
const FONT = 'font-family="ui-monospace, Menlo, monospace" font-size="9" font-weight="bold"'

function label(n: number, x: number, y: number, anchor: 'start' | 'end', color: number, extra = ''): string {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" ${FONT} fill="${hex(color)}"${extra}>+${n}</text>`
}

/**
 * Every follower drawn, beneath the hero, in lane coordinates: each in an svg
 * whose x is the hero's glide begun its lag later, so they trail. `pct` turns
 * a lane position into the hero's left edge there, `cur` is the hero's
 * position now. "+N" for the working ones out of sight goes beside the last
 * one drawn, or behind the hero when none is.
 */
export function crewSvg(sc: CrewScene, pct: (p: number) => string, cur: number, labelColor: number): string {
  const { art, crew, now } = sc
  if (!art || !crew?.length) return ''
  const drawn = shown(crew, CREW_MAX, now)
  const more = hiddenCount(crew, CREW_MAX)
  const last = drawn.reduce<Follower | undefined>((a, f) => (!a || f.slot > a.slot ? f : a), undefined)
  const out = [...drawn].sort((a, b) => b.slot - a.slot).map(f => followerSvg(one(art, f, sc.m, sc.trail, sc.dir, sc.join, sc.asleep), now, pct, f === last ? more : 0, labelColor))
  if (!last && more) {
    const x = sc.dir === 1 ? -4 : HERO_W + 4
    out.push(`<svg x="${pct(cur)}" y="${HEADROOM}" width="${HERO_W}" height="${HERO_H}" overflow="visible">${label(more, x, HERO_H - 6, sc.dir === 1 ? 'end' : 'start', labelColor)}</svg>`)
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
  const kt = total > 0 ? `keyTimes="${times.map(t => fmt((t - now) / total)).join(';')}"` : ''
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
  // Standing off behind the hero, walking round when it turns.
  const offs = times.map(t => `${fmt(offAt(o, t) * PX)} 0`)
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
    joinAnim = `<animateTransform attributeName="transform" type="translate" values="${pts.map(p => `${fmt(p[1] * PX)} ${fmt(p[2] * PX)}`).join(';')}" keyTimes="${pts.map(p => fmt(p[0])).join(';')}" dur="${msOf(dur)}" begin="${msOf(st - now)}" fill="freeze"/>`
  }
  // Hovering, for a flyer.
  const height = art.flying?.height ?? 0
  const bobPx = (art.flying?.bob ?? 1) * PX
  const bob = art.flying && bobPx ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 ${-bobPx};0 0" dur="1.2s" begin="${fmt(-o.j * 0.4)}s" repeatCount="indefinite"/>` : ''
  const top = (GROUND - o.fh - height) * PX
  // The happy hop as its agent finishes.
  const hop = f.leavingAt !== undefined && now < f.leavingAt + HOP_MS
    ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -9;0 0;0 -6;0 0" dur="${HOP_MS}ms" begin="${msOf(f.leavingAt - now)}"/>`
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
  // Facing the way the hero does, as it gets there: rows face left as written.
  const sides = times.map((_, i) => sideAt(o, mid(i)))
  const flip = (s: Dir) => (s === 1 ? '-1 1' : '1 1')
  const faceVals = [flip(sideAt(o, now)), ...sides.slice(1).map(flip)]
  const cx = (o.fw * PX) / 2
  const body = `<g transform="translate(${fmt(cx)} 0)"><g transform="scale(${faceVals[0]})">${anim(faceVals, '', true, 'scale')}<g transform="translate(${fmt(-cx)} 0)">${idle}${walk}${act}${cheer}</g></g></g>`

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

  return `<svg x="${xs[0]}" y="${HEADROOM}" width="${HERO_W}" height="${HERO_H}" overflow="visible">${glide}${off}<g>${joinAnim}<g transform="translate(0 ${fmt(top)})"><g>${bob}<g>${hop}<g>${fade}${body}</g></g>${puffs.join('')}</g></g></g>${tag}</g></svg>`
}

// ── Terminal ────────────────────────────────────────────────────────────

/**
 * Every follower drawn on the terminal, sampled at now: one for each
 * COLS_PER_FOLLOWER columns, up to CREW_MAX. `span` is the columns the hero's
 * left edge travels. Answers where "+N" goes, if anything is out of sight.
 */
export function crewCells(
  sc: CrewScene,
  cols: number,
  span: number,
  heroX: number,
  plot: (rows: Rows, x: number, y: number, pal: Palette) => void,
): { x: number; y: number; text: string } | null {
  const { art, crew, now } = sc
  if (!art || !crew?.length) return null
  const cap = terminalCap(cols)
  const drawn = shown(crew, cap, now)
  const more = hiddenCount(crew, cap)
  let tag: { x: number; y: number; text: string } | null = null
  let lastSlot = -1
  for (const f of [...drawn].sort((a, b) => b.slot - a.slot)) {
    const o = one(art, f, sc.m, sc.trail, sc.dir, sc.join, sc.asleep)
    const kind = o.art
    const side = sideAt(o, now)
    const state = stateAt(o, now)
    const [jx, jy] = joinAt(o, now)
    const x = Math.round(laneAt(o, now) * span + offAt(o, now) + jx * side)
    const height = kind.flying?.height ?? 0
    const bob = kind.flying && Math.floor(now / 600 + o.j) % 2 ? -(kind.flying.bob ?? 1) : 0
    let hop = 0
    if (state === 'cheer' && f.leavingAt !== undefined) {
      const k = Math.floor(((now - f.leavingAt) / HOP_MS) * 4)
      hop = k === 0 ? -2 : k === 2 ? -1 : 0
    }
    const ground = GROUND - height + bob
    const puff = kind.poof ?? PUFF
    const puffAt = (from: number) => {
      const i = Math.floor(((now - from) / POOF_MS) * puff.frames.length)
      const rows = puff.frames[i]
      if (now < from || !rows) return false
      plot(rows, x + Math.floor((o.fw - widthOf(rows)) / 2), ground - Math.round((o.fh + rows.length) / 2), puff.pal)
      return true
    }
    if (state === 'gone') {
      if (f.leavingAt !== undefined) puffAt(f.leavingAt + HOP_MS)
    } else if (now < f.since + ENTER_MS / 2 && puffAt(f.since)) {
      // Still in its puff.
    } else {
      const pick = (list: Rows[], tick: number) => list[Math.floor(now / Math.max(1, tick)) % list.length] ?? list[0] ?? []
      const rows =
        state === 'cheer' ? kind.cheer ?? kind.idle.frames[0]
        : state === 'act' ? pick((kind.act ?? kind.idle).frames, (kind.act ?? kind.idle).tick ?? 500)
        : state === 'move' ? pick(kind.move, kind.stride ?? DEFAULT_STRIDE)
        : pick(kind.idle.frames, kind.idle.tick ?? 500)
      plot(side === 1 ? faceRight(rows) : rows, x, ground - rows.length + hop + Math.round(jy), o.pal)
    }
    if (f.slot > lastSlot && more) {
      lastSlot = f.slot
      const text = `+${more}`
      tag = { x: side === 1 ? x - 1 - text.length : x + o.fw + 1, y: LANE_ROWS - 2, text }
    }
  }
  if (!tag && more) {
    const text = `+${more}`
    tag = { x: sc.dir === 1 ? heroX - 1 - text.length : heroX + HERO_COLS + 1, y: LANE_ROWS - 2, text }
  }
  return tag
}
