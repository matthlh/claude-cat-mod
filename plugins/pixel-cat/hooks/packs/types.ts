import type { HeroState, Identity, Mood, Motion, Phase, Stats } from '../../types'

// A pack is everything the lane draws and does, as data: the hero's sprites
// and looks, its scenes, and its activities. The engine (hooks/engine) reads
// one and never names a sprite or scene itself, and names only two activity
// ids: bedtime's legs, 'bed' and 'perch', which are reserved (see
// Pack.activities). Those two are the cat's words, kept as they are because
// saved state and the frozen golden test use them (see engine/motion.ts);
// they are only ids, and every pack's bed is drawn from its Scene.bed.
//
// Sprites are string[] rows facing LEFT: '.' is transparent, every other
// char a key into a Palette of 0xRRGGBB.

export type Rows = string[]
export type Palette = Record<string, number>
export type Dir = 1 | -1

/** A pose on the spot: one sprite, or several shown in turn (a swing, a chop). */
export type Pose = {
  frames: [Rows, ...Rows[]]
  /** ms each frame shows (default 500); set this, and both surfaces keep step */
  tick?: number
  /**
   * desktop: seconds for one cycle of all its frames, each an equal share
   * (default: frames x tick, in step with the terminal). Only the cat's
   * older poses set it, to keep their drawings as they were.
   */
  period?: number
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
  /** the pose on the spot, at rest, when the activity has none of its own */
  idle: Pose
  /** asleep, eyes shut */
  asleep: Rows
  /** shut eyes, for a blink or a happy squint (default: engine/draw.ts closeEyes) */
  closeEyes?(rows: Rows): Rows
  /**
   * Puts the marking and the hat on. `rows` is the sprite with HAT_PAD blank
   * rows already added on top by the engine, room for the hat; return rows
   * of the same size. The marking is always 'none' or one of Pack.markings
   * (the engine maps a marking rolled under another pack onto one of this
   * pack's own). `asleep`: these are the Hero.asleep rows.
   */
  dress(rows: Rows, marking: string, hat: string, asleep: boolean): Rows
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
  /** the local hour (0..23) the lane is drawn at */
  hour: number
  /** its time of day, for anything drawn differently after dark */
  phase: Phase
  /** left-facing rows turned the way the hero faces */
  face(rows: Rows): Rows
  /**
   * The slots of the followers drawn and still at work (Pack.crew), nearest
   * first: those an activity's join brings in, for a drawing that answers
   * each of them (a hit for each, say). Absent or empty: none.
   */
  crew?: readonly number[]
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

export type Draw = {
  svg(ctx: SvgCtx): string
  cells(ctx: CellsCtx): void
  /**
   * Desktop: the svg sets its own shape-rendering, so the engine leaves it as
   * it is instead of putting it in a crispEdges group (stage and target; draw
   * and over are inside the hero's crisp group either way).
   */
  ownEdges?: boolean
}

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

/**
 * Followers: one for each agent of this session that is working, trailing
 * the hero along its path, the nearest first (engine/crew.ts). The engine
 * moves them; a pack only says how they look. Sprites face LEFT, like the
 * hero's, at most HERO_COLS wide and LANE_PIX tall (less a flyer's height),
 * and stand on the ground unless they fly.
 */
export type Crew = {
  /** moving: two frames in turn */
  move: [Rows, Rows]
  /** terminal ms per moving frame; a desktop cycle is two of them (default 160) */
  stride?: number
  /** on the spot */
  idle: Pose
  /** joining in with an activity (Activity.crew), if not the idle pose */
  act?: Pose
  /** the happy hop as its agent finishes, before the poof (default the idle pose's first frame) */
  cheer?: Rows
  /** on the spot while the hero sleeps in its bed, on the ground even for a flyer (default the idle pose, as it is) */
  rest?: Pose
  /** colours by slot: the follower in slot n wears coats[n % coats.length] */
  coats: [Palette, ...Palette[]]
  /** fly instead of walk: hover `height` sprite px above the ground, bobbing `bob` px (default 1) */
  flying?: { height: number; bob?: number }
  /** sprite px between the hero and the first follower, and between followers (default 2) */
  gap?: number
  /** ms each follower trails the one ahead of it along the hero's path (default 250) */
  lag?: number
  /** the puff it comes and goes in, frames in turn over 400 ms (default the engine's own) */
  poof?: { frames: [Rows, ...Rows[]]; pal: Palette }
  /**
   * Different followers by slot: the one in slot n is drawn with
   * kinds[n % kinds.length] laid over this crew's own art, so each keeps its
   * kind as long as it keeps its slot. Leave `flying` off the crew itself
   * when only some kinds fly. Absent: every follower is the same but for its coat.
   */
  kinds?: CrewKind[]
}

/** One kind of follower (Crew.kinds): whatever it sets replaces the crew's own. The line's spacing and lag stay the crew's. */
export type CrewKind = Partial<Omit<Crew, 'kinds' | 'gap' | 'lag'>>

/**
 * How the followers join in with an activity's leg: a lunge at a foe, timed
 * to the strike, say. lunge() in engine/crew.ts builds one.
 */
export type CrewJoin = {
  /** the part of the leg (fractions) they join in for: they show Crew.act, moved by `keys` */
  during: [number, number]
  /**
   * [t, dx, dy]: t a fraction of `during`, dx sprite px forward (the way the
   * hero faces), dy down; eased linearly, at rest outside `during` (default
   * still)
   */
  keys?: [number, number, number][]
  /** ms each follower starts after the one ahead of it, a ripple down the line (default 0) */
  stagger?: number
  /**
   * dx counts from the nearest follower's place: those further back go
   * further, in the same time, so every one of them reaches the same spot
   * (a foe ahead of the hero). Default: each moves dx from its own place.
   */
  together?: boolean
  /** join in only on legs this says yes to: a strike that lands, say */
  only?(leg: Motion): boolean
}

export type Activity = {
  /** how often it comes up on its own: by day, late at night, when the limit runs low */
  weight?: { day?: number; night?: number; tired?: number }
  move?: Move
  /** pace multiplier while idle */
  pace?: number
  /** terminal ms per walking frame, if not the hero's stride */
  stride?: number
  /** the pose on the spot while it lasts; 'asleep' sleeps (Hero.asleep) */
  pose?: Pose | 'asleep' | ((hero: HeroState) => Pose | undefined)
  /** a hop on every step, or a pounce as a leg on the spot starts */
  leap?: 'hop' | 'pounce'
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
   * next leg replaces it, which the brain plans the moment this one ends.
   * An animation meant to be gone by the leg's end should end itself
   * (fill="remove", or end on an invisible frame) rather than freeze.
   */
  draw?: Draw
  /** on top of the hero, in its frame and moving with its hops: a swung tool, say (lasts as `draw` does) */
  over?: Draw
  /** the followers join in (Pack.crew): they show their act pose, moved as it says */
  crew?: CrewJoin
}

/** A pack's hat for one unlock tier: its id (the key its dress() draws) and the name it goes by. */
export type HatArt = { id: string; label: string }
/** A hat with what unlocks it, from the engine's tiers (engine/hats.ts). */
export type HatDef = HatArt & { need(s: Stats): boolean; hint: string }

export type Pack = {
  id: string
  label: string
  /** what the hero is called in messages */
  noun: string
  /** what the settings button calls a coat: 'Coat', 'Outfit' */
  coatLabel: string
  hero: Hero
  /** palettes by name */
  coats: Record<string, Palette>
  scenes: Record<string, Scene>
  markings: string[]
  /** one hat for each of the engine's unlock tiers, in tier order (engine/hats.ts) */
  hats: HatArt[]
  defaults: { coat: string; scene: string }
  /**
   * In order: the weighted pick walks them in this order. 'bed' and 'perch'
   * are bedtime's legs and reserved: packs/index.ts refuses a pack that
   * defines either (give a pack's own bed activity another id).
   */
  activities: Record<string, Activity>
  /** the activities the hooks start themselves */
  roles: { stroll: string; rest: string; work: string }
  /** followers for this session's working agents, drawn behind the hero; none when absent */
  crew?: Crew
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
    /** a turn finished after `secs` seconds */
    done(secs: number): string
    /** a turn ended on an error */
    oops: string
  }
  toasts: {
    hat(label: string): string
    finished(secs: number): string
    failed: string
    usage(label: string, pct: number | null | undefined): string
  }
}
