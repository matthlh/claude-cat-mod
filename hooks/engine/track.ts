import type { Motion } from '../../types'
import type { Activity, CellsCtx, Draw, Palette, Rows, SvgCtx } from '../packs/types'
import { clamp01, faceRight, rects } from './draw'
import { HERO_COLS, HERO_H, HERO_W, PX } from './geometry'

// One declarative description of a moving sprite, drawn the same on both
// surfaces, so a pack writes each animation once instead of twice by hand.
//
// A sprite has frames (shown in turn, `tick` ms each), a place (its anchor),
// and keys: [t, dx, dy, opacity], eased linearly from key to key and held
// before the first and after the last. t is a fraction of the leg, or of a
// `loop` ms long when one is given. dx is forward, the way the hero faces;
// dy is down; both in sprite px. `show` is the part of the leg (fractions)
// the sprite is on screen at all.
//
// The desktop gets one SMIL drawing keyed to the leg's start (ctx.at), so a
// redraw mid-leg carries on where it was: a translate with keyTimes for the
// keys, opacity flips for the frames, a discrete opacity window for `show`.
// The terminal samples the same keys at `now`, picks the frame by time and
// plots it. Every desktop animation that holds where it ends spans the whole
// leg from its start (see legTimed); only loops and cycling frames, which
// never end, run on clocks of their own.
//
// Both surfaces work out the place in the right-facing frame and mirror it
// about the hero's box when the hero faces left, so the two directions are
// exact mirror images on both surfaces.
//
// Every coordinate is in sprite px in the layer's frame: x from the left edge
// of the hero's box (the hero's own for draw and over, its destination's for
// target, the hero's box at the spot for a spot), y from the top of the lane
// (0) to the ground (GROUND). The terminal shows rows 0..GROUND-1 only; the
// desktop has HEADROOM px above row 0 as well.

/** The ground, as a row: a sprite resting on it has its top at GROUND - its height. */
export const GROUND = HERO_H / PX

/** [t, dx, dy, opacity]: t a fraction (0..1) of the leg or loop, dx forward, dy down, opacity 0..1 (default 1). */
export type Key = [t: number, dx: number, dy: number, opacity?: number]

/**
 * Where a sprite sits before its keys move it, and so which layer it is in:
 * - 'ahead': `gap` px in front of the hero (layer draw, or over)
 * - 'hero': centred on the hero's box (layer over, or draw)
 * - 'target': `gap` px in front of where the hero stands at the leg's end (layer target)
 * - { spot }: centred on where the hero would stand at lane position `spot`, 0..1 (layer stage)
 */
export type Anchor = 'ahead' | 'hero' | 'target' | { spot: number }

export type LayerName = 'stage' | 'target' | 'draw' | 'over'

/** What every drawing here shares: its colours, its place and when it shows. */
export type Place = {
  pal: Palette
  /** default 'ahead' */
  anchor?: Anchor
  /** for 'ahead' and 'target': sprite px between the hero's front and the sprite (default 1) */
  gap?: number
  /** px forward of the anchor's place, before the keys (default 0) */
  x?: number
  /** the sprite's top row (default: resting on the ground) */
  y?: number
  /** the part of the leg it is on screen, as fractions (default [0, 1]) */
  show?: [number, number]
  /**
   * Desktop: hold the last frame after the leg ends, until the next leg
   * replaces the drawing (up to a brain tick), instead of going with the leg.
   * A redraw made after the leg ended shows nothing either way, and the
   * terminal draws no layer once its leg is over.
   */
  linger?: boolean
  /** turn the rows the way the hero faces (default true); the place mirrors either way */
  mirror?: boolean
  /** for 'ahead' and 'hero': beneath the hero ('draw') or on top of it, moving with its hops and arc ('over') */
  layer?: 'draw' | 'over'
  /** draw it only on legs this says yes to: a drop on a leg that hits, say */
  only?(leg: Motion): boolean
}

export type Sprite = Place & {
  /** one sprite's rows, or several shown in turn; each rests on the ground unless `y` is set */
  frames: Rows | Rows[]
  /** ms each frame shows (default 500), counted from when it is first shown */
  tick?: number
  /** play the frames once and stay on the last, instead of cycling */
  hold?: boolean
  /** default: one key, [0, 0, 0, 1], still */
  keys?: Key[]
  /** ms: the keys' t is a fraction of this, repeated from when it is first shown */
  loop?: number
}

/** A Draw that knows which of an activity's layers it belongs in. */
export type TrackDraw = Draw & { layer: LayerName }

type K = [number, number, number, number]

const fmt = (n: number) => String(Number(n.toFixed(3)))
const mod = (a: number, n: number) => ((a % n) + n) % n
const widthOf = (rows: Rows) => rows.reduce((w, r) => Math.max(w, r.length), 0)
const legMs = (m: Motion) => Math.max(1, Math.round(m.dur))

function framesOf(f: Rows | Rows[]): Rows[] {
  return f.length === 0 ? [] : typeof f[0] === 'string' ? [f as Rows] : (f as Rows[])
}

// Keys in time order (ties keep their order: a jump), from t = 0 to t = 1.
function norm(keys: Key[] | undefined): K[] {
  const ks: K[] = (keys?.length ? keys : [[0, 0, 0, 1] as Key]).map(([t, dx, dy, op = 1]) => [clamp01(t), dx, dy, clamp01(op)])
  ks.sort((a, b) => a[0] - b[0])
  const first = ks[0]
  const last = ks[ks.length - 1]
  if (first[0] > 0) ks.unshift([0, first[1], first[2], first[3]])
  if (last[0] < 1) ks.push([1, last[1], last[2], last[3]])
  return ks
}

function sampleK(ks: K[], t: number): [number, number, number] {
  let i = 0
  while (i + 1 < ks.length && ks[i + 1][0] <= t) i++
  const a = ks[i]
  const b = ks[i + 1]
  if (!b) return [a[1], a[2], a[3]]
  const k = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 1
  return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k]
}

/** Where keys put a sprite at t (0..1): [dx, dy, opacity], as both surfaces see it. */
export function sample(keys: Key[] | undefined, t: number): [number, number, number] {
  return sampleK(norm(keys), clamp01(t))
}

const anchorOf = (p: Place): Anchor => p.anchor ?? 'ahead'

function layerOf(p: Place): LayerName {
  const a = anchorOf(p)
  if (a === 'target') return 'target'
  if (typeof a === 'object') return 'stage'
  return p.layer ?? (a === 'hero' ? 'over' : 'draw')
}

// The left edge of a sprite `w` wide, facing right, from the left edge of the
// frame's hero box, before x and the keys.
function baseX(p: Place, w: number): number {
  const a = anchorOf(p)
  return a === 'ahead' || a === 'target' ? HERO_COLS + (p.gap ?? 1) : Math.floor((HERO_COLS - w) / 2)
}

function windowOf(p: Place): [number, number] {
  const [a, b] = p.show ?? [0, 1]
  return [clamp01(a), clamp01(b)]
}

// Rows as drawn in the right-facing frame (the desktop mirrors the whole frame
// for a hero facing left, which turns them back).
const facing = (p: Place, rows: Rows, dir: 1 | -1) => (p.mirror !== false || dir === -1 ? faceRight(rows) : rows)

// ── Desktop ─────────────────────────────────────────────────────────────

// Around a drawing in the right-facing frame: the mirror for a hero facing
// left, the `show` window (and going with the leg at its end), and the
// lane position for a spot.
function shell(p: Place, ctx: SvgCtx, inner: string): string {
  const { dir, at } = ctx
  const dur = legMs(ctx.leg)
  const [a, b] = windowOf(p)
  let out = dir === 1 ? inner : `<g transform="matrix(-1 0 0 1 ${HERO_W} 0)">${inner}</g>`
  const whole = a <= 0 && b >= 1
  if (!(whole && p.linger)) {
    // Hidden underneath; shown by an animation over the leg. fill="remove"
    // drops it back to hidden when the leg ends, even for a drawing made
    // after its leg is over (the draw layer is drawn until the next leg).
    const fill = p.linger ? 'freeze' : 'remove'
    let anim: string
    if (whole) {
      anim = `<animate attributeName="opacity" from="1" to="1" dur="${dur}ms" begin="${at(0)}" fill="${fill}"/>`
    } else {
      const values = [a > 0 ? 0 : 1]
      const times = [0]
      if (a > 0) {
        values.push(1)
        times.push(a)
      }
      if (b < 1) {
        values.push(0)
        times.push(b)
      }
      anim = `<animate attributeName="opacity" values="${values.join(';')}" keyTimes="${times.map(fmt).join(';')}" calcMode="discrete" dur="${dur}ms" begin="${at(0)}" fill="${fill}"/>`
    }
    out = `<g opacity="0">${anim}${out}</g>`
  }
  const anchor = anchorOf(p)
  return typeof anchor === 'object' ? `<svg x="${ctx.pct(anchor.spot)}" overflow="visible">${out}</svg>` : out
}

// Frames in turn, each `tick` ms from `start` ms into the leg: cycling, or
// once and held on the last. A held run is timed over the whole leg (see
// legTimed), so a redraw after it finished still shows the last frame.
function flip(list: string[], tick: number, start: number, ctx: SvgCtx, hold: boolean): string {
  if (list.length === 1) return list[0]
  const n = list.length
  const dur = legMs(ctx.leg)
  const anim = (i: number) => {
    if (!hold) {
      const values = list.map((_, j) => (j === i ? 1 : 0)).join(';')
      return `<animate attributeName="opacity" values="${values}" calcMode="discrete" dur="${n * tick}ms" begin="${ctx.at(start)}" repeatCount="indefinite"/>`
    }
    const from = (k: number) => clamp01((start + k * tick) / dur)
    const times = [0]
    const values = [i === 0 ? 1 : 0]
    if (i > 0) {
      times.push(from(i))
      values.push(1)
    }
    if (i < n - 1) {
      times.push(from(i + 1))
      values.push(0)
    }
    return `<animate attributeName="opacity" values="${values.join(';')}" keyTimes="${times.map(fmt).join(';')}" calcMode="discrete" ${legTimed(ctx)}/>`
  }
  return list.map((f, i) => `<g${i ? ' opacity="0"' : ''}>${f}${anim(i)}</g>`).join('')
}

// Anything that holds where it ends is timed over the whole leg, from its
// start: a renderer drops an animation whose run ended before the drawing
// was made, so a fill="freeze" on a shorter one would be lost on any redraw
// after it finished (a line said, a mood change), and the drawing would jump
// back to where it began.
const legTimed = (ctx: SvgCtx) => `dur="${legMs(ctx.leg)}ms" begin="${ctx.at(0)}" fill="freeze"`

function spriteSvg(s: Sprite, ctx: SvgCtx): string {
  const frames = framesOf(s.frames)
  const ks = norm(s.keys)
  const [a, b] = windowOf(s)
  if (!frames.length || b <= a || ks.every(k => k[3] === 0)) return ''
  const { dir, at } = ctx
  const dur = legMs(ctx.leg)
  const start = Math.round(a * dur)
  const shown = frames.map(rows => {
    const x = baseX(s, widthOf(rows)) + (s.x ?? 0)
    const y = s.y ?? GROUND - rows.length
    return `<g transform="translate(${x * PX} ${y * PX})">${rects(facing(s, rows, dir), s.pal)}</g>`
  })
  const body = flip(shown, Math.max(1, Math.round(s.tick ?? 500)), start, ctx, !!s.hold)

  const timing = s.loop ? `dur="${Math.max(1, Math.round(s.loop))}ms" begin="${at(start)}" repeatCount="indefinite"` : legTimed(ctx)
  const keyTimes = `keyTimes="${ks.map(k => fmt(k[0])).join(';')}"`
  const moves = ks.some(k => k[1] !== ks[0][1] || k[2] !== ks[0][2])
  const fades = ks.some(k => k[3] !== ks[0][3])
  let attrs = ''
  let anims = ''
  if (moves) {
    const values = ks.map(k => `${fmt(k[1] * PX)} ${fmt(k[2] * PX)}`).join(';')
    anims += `<animateTransform attributeName="transform" type="translate" values="${values}" ${keyTimes} ${timing}/>`
  } else if (ks[0][1] || ks[0][2]) {
    attrs += ` transform="translate(${fmt(ks[0][1] * PX)} ${fmt(ks[0][2] * PX)})"`
  }
  if (fades) {
    anims += `<animate attributeName="opacity" values="${ks.map(k => fmt(k[3])).join(';')}" ${keyTimes} ${timing}/>`
  } else if (ks[0][3] < 1) {
    attrs += ` opacity="${fmt(ks[0][3])}"`
  }
  return shell(s, ctx, `<g${attrs}>${anims}${body}</g>`)
}

// ── Terminal ────────────────────────────────────────────────────────────

// Where the leg is, if the sprite is on screen: [fraction of the leg, ms
// since it was first shown].
function clock(p: Place, ctx: CellsCtx): [number, number] | null {
  const m = ctx.leg
  const dur = Math.max(1, m.dur)
  const elapsed = ctx.now - m.t0
  const u = clamp01(elapsed / dur)
  const [a, b] = windowOf(p)
  if (b <= a || u < a || (b < 1 && u >= b)) return null
  return [u, elapsed - a * dur]
}

// Plot rows whose right-facing left edge is `xr` from the frame's hero box.
function put(p: Place, ctx: CellsCtx, rows: Rows, xr: number, y: number): void {
  const w = widthOf(rows)
  const x = ctx.dir === 1 ? xr : HERO_COLS - xr - w
  const anchor = anchorOf(p)
  const x0 = typeof anchor === 'object' ? ctx.col(anchor.spot) : ctx.x
  ctx.plot(p.mirror === false ? rows : ctx.face(rows), x0 + x, y, p.pal)
}

function spriteCells(s: Sprite, ctx: CellsCtx): void {
  const frames = framesOf(s.frames)
  const now = clock(s, ctx)
  if (!frames.length || !now) return
  const [u, shown] = now
  const loop = s.loop ? Math.max(1, Math.round(s.loop)) : 0
  const t = loop ? mod(shown, loop) / loop : u
  const [dx, dy, op] = sampleK(norm(s.keys), t)
  if (op < 0.5) return
  const tick = Math.max(1, Math.round(s.tick ?? 500))
  const i = Math.floor(shown / tick)
  const rows = frames[s.hold ? Math.max(0, Math.min(frames.length - 1, i)) : mod(i, frames.length)]
  put(s, ctx, rows, baseX(s, widthOf(rows)) + (s.x ?? 0) + Math.round(dx), (s.y ?? GROUND - rows.length) + Math.round(dy))
}

// ── The API ─────────────────────────────────────────────────────────────

function guarded(p: Place, layer: LayerName, svg: (ctx: SvgCtx) => string, cells: (ctx: CellsCtx) => void): TrackDraw {
  return {
    layer,
    svg: ctx => (p.only && !p.only(ctx.leg) ? '' : svg(ctx)),
    cells: ctx => {
      if (!p.only || p.only(ctx.leg)) cells(ctx)
    },
  }
}

/** One sprite, its frames and its keys, as a Draw for the layer its anchor puts it in (`.layer`). */
export function track(s: Sprite): TrackDraw {
  return guarded(s, layerOf(s), ctx => spriteSvg(s, ctx), ctx => spriteCells(s, ctx))
}

/** Several drawings in one layer, the first beneath. */
export function stack(...draws: Draw[]): Draw {
  return {
    svg: ctx => draws.map(d => d.svg(ctx)).join(''),
    cells: ctx => {
      for (const d of draws) d.cells(ctx)
    },
    ...(draws.length && draws.every(d => d.ownEdges) ? { ownEdges: true } : {}),
  }
}

/** An activity's layers from its tracks, each in the layer it names, in the order given: spread it into the Activity. */
export function layers(...tracks: TrackDraw[]): Pick<Activity, LayerName> {
  const out: Pick<Activity, LayerName> = {}
  for (const name of ['stage', 'target', 'draw', 'over'] as const) {
    const mine = tracks.filter(d => d.layer === name)
    if (mine.length) out[name] = mine.length === 1 ? mine[0] : stack(...mine)
  }
  return out
}

/** Not on screen until `t` of the leg; its frames and any loop start there. */
export function appear<T extends Place>(t: number, p: T): T {
  return { ...p, show: [t, p.show?.[1] ?? 1] }
}

/** Gone from `t` of the leg on. */
export function vanish<T extends Place>(t: number, p: T): T {
  return { ...p, show: [p.show?.[0] ?? 0, t] }
}

export type Pop = Omit<Sprite, 'keys' | 'loop' | 'show'> & {
  /** the fraction of the leg it leaves its place */
  at: number
  /** the fraction of the leg it flies for (default 0.15); it is gone when it lands */
  span?: number
  /** when it first shows, if before `at`: a drop that sits a moment first (default `at`) */
  from?: number
  /** rows the arc rises above the line between its ends (default 4) */
  peak?: number
  /** where it lands in the hero's box: [px forward of centred, top row] (default centred, mid-height) */
  into?: [number, number]
}

/**
 * A drop that arcs from its place into the hero and is gone when it lands:
 * ore out of a rock, a coin out of a slime. Over the hero unless its anchor
 * says otherwise.
 */
export function popTo(p: Pop): TrackDraw {
  const first = framesOf(p.frames)[0] ?? []
  const w = widthOf(first)
  const h = first.length
  const x0 = baseX(p, w) + (p.x ?? 0)
  const y0 = p.y ?? GROUND - h
  const x1 = Math.floor((HERO_COLS - w) / 2) + (p.into?.[0] ?? 0)
  const y1 = p.into?.[1] ?? Math.floor((GROUND - h) / 2)
  const at = clamp01(p.at)
  const end = clamp01(at + (p.span ?? 0.15))
  const peak = p.peak ?? 4
  const keys: Key[] = [[0, 0, 0]]
  const STEPS = 8
  for (let i = 0; i <= STEPS; i++) {
    const k = i / STEPS
    const x = x0 + (x1 - x0) * k
    const y = y0 + (y1 - y0) * k - 4 * peak * k * (1 - k)
    keys.push([at + (end - at) * k, Number((x - x0).toFixed(2)), Number((y - y0).toFixed(2))])
  }
  return track({ ...p, layer: p.layer ?? 'over', keys, show: [Math.min(at, p.from ?? at), end] })
}

export type Fall = Place & {
  /** standing */
  rows: Rows
  /** terminal: lying on the ground once it has landed, its back end at the pivot */
  fallen: Rows
  /** terminal: while it tips, if not the standing rows */
  tipping?: Rows
  /** the fractions of the leg it starts to tip and lands */
  from: number
  to: number
  /** degrees it turns, forward (default 90) */
  angle?: number
  /** the point it turns about, in px from the top left of `rows` as written, facing left (default the middle of its foot) */
  pivot?: [number, number]
  /** rows it rises as it turns, so a wide top lands on the ground instead of in it (default just that much) */
  lift?: number
}

// The steps of a fall, gathering speed: [fraction of the fall, fraction of
// the turn], with a step held at each end so it spans the leg (legTimed).
const FALL = [0, 0, 0.25, 0.5, 0.75, 1, 1].map(k => k * k)

/**
 * Something tall tipping over, away from the hero: a felled tree. The desktop
 * turns it about its foot and holds it there; the terminal, which cannot turn
 * pixels, shows `tipping` while it falls and swaps to `fallen` when it lands.
 */
export function fallOver(f: Fall): TrackDraw {
  const w = widthOf(f.rows)
  const h = f.rows.length
  const [pxLeft, py] = f.pivot ?? [w / 2, h]
  const px = w - pxLeft // facing right
  const angle = f.angle ?? 90
  const rad = (angle * Math.PI) / 180
  const lowest = Math.max(...[[0, 0], [w, 0], [0, h], [w, h]].map(([cx, cy]) => py + (cx - px) * Math.sin(rad) + (cy - py) * Math.cos(rad)))
  const lift = f.lift ?? Math.max(0, Math.round(lowest - h))
  const from = clamp01(f.from)
  const to = Math.max(from, clamp01(f.to))

  const svg = (ctx: SvgCtx) => {
    const [a, b] = windowOf(f)
    if (b <= a || !w) return ''
    const x = baseX(f, w) + (f.x ?? 0)
    const y = f.y ?? GROUND - h
    const times = [0, from, from + (to - from) * 0.25, from + (to - from) * 0.5, from + (to - from) * 0.75, to, 1]
    const timing = `keyTimes="${times.map(fmt).join(';')}" ${legTimed(ctx)}`
    const turn = FALL.map(k => `${fmt(k * angle)} ${fmt(px * PX)} ${fmt(py * PX)}`).join(';')
    const rise = FALL.map(k => `0 ${fmt(-k * lift * PX)}`).join(';')
    const lifted = lift ? `<animateTransform attributeName="transform" type="translate" values="${rise}" ${timing}/>` : ''
    const inner = `<g transform="translate(${x * PX} ${y * PX})"><g>${lifted}<g>
      <animateTransform attributeName="transform" type="rotate" values="${turn}" ${timing}/>${rects(facing(f, f.rows, ctx.dir), f.pal)}</g></g></g>`
    return shell(f, ctx, inner)
  }

  const cells = (ctx: CellsCtx) => {
    const now = clock(f, ctx)
    if (!now || !w) return
    const u = now[0]
    const x = baseX(f, w) + (f.x ?? 0)
    const y = f.y ?? GROUND - h
    if (u >= to) put(f, ctx, f.fallen, x + Math.round(px), y + h - f.fallen.length)
    else put(f, ctx, u >= from ? f.tipping ?? f.rows : f.rows, x, y)
  }

  return guarded(f, layerOf(f), svg, cells)
}
