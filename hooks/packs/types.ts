import type { HeroState, Identity, Mood, Motion, Stats } from '../../types'

// A pack is everything the lane draws and does, as data: the hero's sprites
// and looks, its scenes, and its activities. The engine (hooks/engine) reads
// one and never names a sprite or scene itself, and names only two activity
// ids: bedtime's legs, 'bed' and 'perch', which are reserved (see
// Pack.activities).
//
// Sprites are string[] rows facing LEFT: '.' is transparent, every other
// char a key into a Palette of 0xRRGGBB.

export type Rows = string[]
export type Palette = Record<string, number>
export type Dir = 1 | -1

/** A pose on the spot: one sprite, or several shown in turn (a swing, a chop). */
export type Pose = {
  frames: [Rows, ...Rows[]]
  /** desktop: seconds for one cycle of all its frames, each an equal share (default 1) */
  period?: number
  /** terminal: ms each frame shows (default 500) */
  tick?: number
  /**
   * The eyes are already shut: no blinks, no happy squint. Desktop blinks lay
   * closed eyes over the FIRST frame's eyes for the whole pose, so a pose
   * whose frames move the head should set this too.
   */
  shut?: boolean
}

export type Hero = {
  walk: [Rows, Rows]
  /** terminal ms per walking frame; a desktop cycle is two of them */
  stride: number
  /** the stride while Claude is working */
  rush: number
  /** the pose on the spot when the activity has none of its own */
  sit: Pose
  /** asleep, eyes shut */
  loaf: Rows
  /** shut eyes, for a blink or a happy squint */
  closeEyes(rows: Rows): Rows
  /**
   * The rows wearing a marking and a hat, padded HAT_PAD rows on top. The
   * marking is always 'none' or one of Pack.markings (the engine maps a
   * marking rolled under another pack onto one of this pack's own).
   */
  dress(rows: Rows, marking: string, hat: string): Rows
  /** the hats' colours, laid over the coat */
  hatPal: Palette
}

/** Where the hero sleeps: slides in from the left at bedtime. */
export type Bed = { rows: Rows; pal: Palette; float: number }

export type Scene = {
  label: string
  /** terminal: the colour behind the lane's cells */
  bg: number
  bed: Bed
  /** desktop: drawn behind everything, in percent x so it fills any width */
  backdrop(hour: number): string
}

/** What both surfaces hand an activity's drawing. */
type Ctx = {
  leg: Motion
  hero: HeroState
  now: number
  dir: Dir
  scene: string
  /** left-facing rows turned the way the hero faces */
  face(rows: Rows): Rows
}

/**
 * Desktop: CSS px in a frame HERO_W wide whose left edge is the hero's (for
 * draw and over) or the destination's (for target); for stage the frame is
 * the whole lane, from its left edge.
 */
export type SvgCtx = Ctx & {
  PX: number
  walking: boolean
  /** ms left of a moving leg, else 0 */
  remaining: number
  /** x of a thing `w` px wide, `gap` px ahead of the hero */
  ahead(w: number, gap?: number): number
  /** a SMIL begin `ms` after the leg started */
  at(ms: number): string
  /**
   * A lane position (0..1) as a percentage x: where the hero's left edge is
   * at that position. Percentages resolve against the frame's width, so this
   * lands on the lane only in a `stage`; in draw, over and target the frame
   * is HERO_W px wide.
   */
  pct(p: number): string
}

/** Terminal: sprite pixels, one column each, LANE_PIX rows. */
export type CellsCtx = Ctx & {
  /** the hero's left column (draw, over), the target's (target), or 0 (stage) */
  x: number
  /** column of a thing `w` wide, `gap` columns ahead of the hero */
  ahead(w: number, gap?: number): number
  /** a lane position (0..1) as a column: the hero's left column there, as pct() */
  col(p: number): number
  plot(rows: Rows, x: number, y: number, pal: Palette): void
}

export type Draw = { svg(ctx: SvgCtx): string; cells(ctx: CellsCtx): void }

/**
 * The hero's body moved off its spot while a leg lasts: a jump attack's arc,
 * a knockback. Keyframes of [ms into the leg, dx, dy] in sprite px (dx the
 * way the hero faces, dy down), in time order, eased linearly from 0, 0 at
 * the leg's start through each key, and held at the last until the leg
 * ends; then the body is back on its spot, on both surfaces. Two keys at
 * the same ms make a jump.
 */
export type Track = [number, number, number][]

/** How a leg moves. Absent: wander to a random spot. */
export type Move =
  /** stay put for a time in ms (a range is rolled); faceRoom turns to the wider side */
  | { stay: number | [number, number]; faceRoom?: boolean }
  /** a little way off, toward the wider side */
  | { near: [number, number] }
  /** a short dash either way */
  | { zip: [number, number] }
  /** a fixed lane position */
  | { spot: number }

export type FollowUp = { activity: string; line?: string }

export type Activity = {
  /** how often it comes up on its own: by day, late at night, when the limit runs low */
  weight?: { day?: number; night?: number; tired?: number }
  move?: Move
  /** pace multiplier while idle */
  pace?: number
  /** terminal ms per walking frame, if not the hero's stride */
  stride?: number
  /** the pose on the spot while it lasts; 'loaf' sleeps */
  pose?: Pose | 'loaf' | ((hero: HeroState) => Pose | undefined)
  /** a hop on every step, or a pounce as a leg on the spot starts */
  leap?: 'hop' | 'pounce'
  /** the hero's body (and its `over` layer) follows this track while the leg lasts, on top of any leap */
  arc?: Track
  /** the hero's mood while it lasts, instead of idle (or tired) */
  mood?: Mood
  /** the chance a leg of it ends in a hit (Motion.hit), whether it stays or moves: a catch, a strike that lands */
  hit?: number
  /** picked fresh, it runs again this many times before its `then` */
  repeat?: [number, number]
  /** what this leg leads into; null falls back to a fresh pick */
  then?(leg: Motion): FollowUp | null
  /** the follow-up comes before the hunger line */
  thenFirst?: boolean
  lines?: string[]
  /** lines said this many ms into the leg */
  cues?: [number, string][]
  /** while it lasts, the usage line reads this instead */
  usageNote?: string
  // Layers, bottom to top, the same on both surfaces: stage, target, draw,
  // the hero, over.
  /** in the lane's own frame (pct and col place it), beneath everything else, while the leg lasts */
  stage?: Draw
  /** at the leg's destination, beneath the hero, while the leg lasts */
  target?: Draw
  /**
   * ahead of the hero, beneath it (desktop: always; terminal: while the leg
   * lasts). The desktop drawing is made once per leg and stays up until the
   * next leg replaces it, up to a brain tick (1 s) after this one ends: an
   * animation meant to be gone by then should end itself (fill="remove", or
   * end on an invisible frame) rather than freeze.
   */
  draw?: Draw
  /** on top of the hero, in its frame and moving with its hops and arc: a swung tool, say (lasts as `draw` does) */
  over?: Draw
}

export type HatDef = { id: string; label: string; need(s: Stats): boolean; hint: string }

export type Pack = {
  id: string
  label: string
  /** what the hero is called in messages */
  noun: string
  hero: Hero
  /** palettes by name */
  coats: Record<string, Palette>
  scenes: Record<string, Scene>
  markings: string[]
  hats: HatDef[]
  defaults: { coat: string; scene: string }
  /**
   * In order: the weighted pick walks them in this order. 'bed' and 'perch'
   * are bedtime's legs and reserved: packs/index.ts refuses a pack that
   * defines either (give a pack's own bed activity another id).
   */
  activities: Record<string, Activity>
  /** the activities the hooks start themselves */
  roles: { stroll: string; rest: string; work: string }
  /** the context gauge at the right end of the lane, by percent used */
  gauge(ctx: number): { rows: Rows; pal: Palette }
  text: {
    hello: string
    bedtime: string
    outOfJuice: string
    hungry: string
    fed: string
    pet: string[]
    petAsleep: string[]
    shown: string
    hidden: string
    look(id: Identity): string
  }
  toasts: {
    hat(label: string): string
    finished(secs: number): string
    failed: string
    usage(label: string, pct: number | null | undefined): string
  }
}
