import type { Cat, Identity, Mood, Motion, Stats } from '../../types'

// A pack is everything the lane draws and does, as data: the hero's sprites
// and looks, its scenes, and its activities. The engine (hooks/engine) reads
// one and never names an activity, sprite or scene itself.
//
// Sprites are string[] rows facing LEFT: '.' is transparent, every other
// char a key into a Palette of 0xRRGGBB.

export type Rows = string[]
export type Palette = Record<string, number>
export type Dir = 1 | -1

/** A pose on the spot: one sprite, or two that alternate. */
export type Pose = {
  frames: [Rows] | [Rows, Rows]
  /** desktop: seconds for one cycle of both frames (default 1) */
  period?: number
  /** terminal: ms each frame shows (default 500) */
  tick?: number
  /** the eyes are already shut: no blinks, no happy squint */
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
  /** the rows wearing a marking and a hat, padded HAT_PAD rows on top */
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
  hero: Cat
  now: number
  dir: Dir
  scene: string
  /** left-facing rows turned the way the hero faces */
  face(rows: Rows): Rows
}

/** Desktop: CSS px in the hero's frame (0..HERO_W wide), or the target's. */
export type SvgCtx = Ctx & {
  PX: number
  walking: boolean
  /** ms left of a moving leg, else 0 */
  remaining: number
  /** x of a thing `w` px wide, `gap` px ahead of the hero */
  ahead(w: number, gap?: number): number
  /** a SMIL begin `ms` after the leg started */
  at(ms: number): string
  /** a lane position (0..1) as a lane x */
  pct(p: number): string
}

/** Terminal: sprite pixels, one column each, LANE_PIX rows. */
export type CellsCtx = Ctx & {
  /** the hero's left column, or the target's */
  x: number
  /** column of a thing `w` wide, `gap` columns ahead of the hero */
  ahead(w: number, gap?: number): number
  /** a lane position (0..1) as a column */
  col(p: number): number
  plot(rows: Rows, x: number, y: number, pal: Palette): void
}

export type Draw = { svg(ctx: SvgCtx): string; cells(ctx: CellsCtx): void }

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
  pose?: Pose | 'loaf' | ((hero: Cat) => Pose | undefined)
  /** a hop on every step, or a pounce as a leg on the spot starts */
  leap?: 'hop' | 'pounce'
  /** the hero's mood while it lasts, instead of idle (or tired) */
  mood?: Mood
  /** the chance this leg ends in a hit (Motion.hit) */
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
  /** ahead of the hero (desktop: always; terminal: while the leg lasts) */
  draw?: Draw
  /** at the leg's destination, while the leg lasts */
  target?: Draw
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
  /** in order: the weighted pick walks them in this order */
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
