import type { HeroState, Identity, Mood, Motion } from '../../types'
import type { Activity, Dir, Hero, Pack, Palette, Pose, Rows, Scene } from '../packs/types'
import { clamp01, closeEyes } from './draw'
import { HAT_PAD, HERO_COLS, SLIDE_MS } from './geometry'
import { IN_BED, RESERVED_ACTIVITIES, TO_BED, isWalking } from './motion'

// What both surfaces need to know about the lane at one moment.

export type Extras = { ctx?: number | null; identity?: Identity; hat?: string; hour?: number }

export type Lane = {
  act: Activity | undefined
  walking: boolean
  /** the leg is still running */
  busy: boolean
  dir: Dir
  posture: 'walk' | 'sit' | 'asleep'
  /** the activity's own pose on the spot, while the leg runs */
  pose: Pose | undefined
  sceneId: string
  scene: Scene
}

// Bedtime's legs never resolve to a pack's activity, even one that slipped
// past packs/index.ts: the bed, not the pack, draws them.
export function activityOf(pack: Pack, id: string | undefined): Activity | undefined {
  return id !== undefined && Object.hasOwn(pack.activities, id) && !RESERVED_ACTIVITIES.includes(id) ? pack.activities[id] : undefined
}

// The identity is rolled once and shared by every pack, but markings belong
// to a pack. One this pack lacks maps to one of its own, the same one every
// time, so the hero keeps a look of its own in each pack.
export function lookOf(pack: Pack, id: Identity | undefined): Identity {
  // A saved identity is trusted to be well formed only so far: one rolled
  // without a marking (or by an older version) reads as 'none'.
  const who = id ? (typeof id.marking === 'string' ? id : { ...id, marking: 'none' }) : { marking: 'none', shiny: false }
  const { markings } = pack
  if (who.marking === 'none' || markings.includes(who.marking)) return who
  if (markings.length === 0) return { ...who, marking: 'none' }
  let h = 0
  for (let i = 0; i < who.marking.length; i++) h = (h * 31 + who.marking.charCodeAt(i)) >>> 0
  return { ...who, marking: markings[h % markings.length] ?? 'none' }
}

// The hero's rows dressed: HAT_PAD blank rows on top, the room a hat sits
// in (both surfaces draw the result HAT_PAD rows higher), then the pack puts
// on the marking and the hat.
export function wear(hero: Hero, rows: Rows, marking: string, hat: string, asleep: boolean): Rows {
  const pad: Rows = Array.from({ length: HAT_PAD }, () => '.'.repeat(HERO_COLS))
  return hero.dress([...pad, ...rows], marking, hat, asleep)
}

// Shut eyes, the pack's own way or the engine's.
export function shut(hero: Hero, rows: Rows): Rows {
  return (hero.closeEyes ?? closeEyes)(rows)
}

// A pack's coat by id, or its default one.
export function coatOf(pack: Pack, id?: string): Palette {
  return (id !== undefined && Object.hasOwn(pack.coats, id) && pack.coats[id]) || pack.coats[pack.defaults.coat] || {}
}

// A pack's scene by id, or its default one.
export function sceneOf(pack: Pack, sceneId: string): { id: string; scene: Scene } {
  const id = Object.hasOwn(pack.scenes, sceneId) ? sceneId : pack.defaults.scene
  const scene = pack.scenes[id]
  if (!scene) throw new Error(`pack '${pack.id}' has no scene '${id}'`)
  return { id, scene }
}

export function lane(pack: Pack, c: HeroState, m: Motion, now: number, sceneId: string): Lane {
  const act = activityOf(pack, m.activity)
  const walking = isWalking(m, now)
  const busy = now < m.t0 + m.dur
  const own = busy ? (typeof act?.pose === 'function' ? act.pose(c) : act?.pose) : undefined
  const { id, scene } = sceneOf(pack, sceneId)
  return {
    act,
    walking,
    busy,
    dir: m.to > m.from && walking ? 1 : m.to < m.from && walking ? -1 : c.dir,
    posture: walking ? 'walk' : c.mood === 'sleep' || own === 'asleep' ? 'asleep' : 'sit',
    pose: own === 'asleep' ? undefined : own,
    sceneId: id,
    scene,
  }
}

// Activities with a toy or critter ahead of the hero, or at its destination.
export function hasCompanion(a: Activity | undefined): boolean {
  return !!(a?.draw || a?.target)
}

export function isHappy(mood: Mood): boolean {
  return mood === 'done' || mood === 'pet' || mood === 'tired'
}

export function isInBed(c: HeroState, m: Motion): boolean {
  return c.mood === 'sleep' && m.activity === IN_BED
}

// How far the bed has slid in (1) or out (0), or null when it's away.
export function bedShown(c: HeroState, m: Motion, now: number): number | null {
  if (c.mood === 'sleep' && m.activity === TO_BED) return clamp01((now - m.t0) / SLIDE_MS)
  if (isInBed(c, m)) return 1
  if (c.mood !== 'sleep' && c.wokeAt !== undefined && now - c.wokeAt < SLIDE_MS) return 1 - clamp01((now - c.wokeAt) / SLIDE_MS)
  return null
}

const MOOD_COLOR: Partial<Record<Mood, number>> = {
  done: 0x3fb950,
  oops: 0xf85149,
  tired: 0xd29922,
  pet: 0xdb61a2,
  working: 0x39c5cf,
}
export const QUIET_COLOR = 0x8b949e

export function moodColor(mood: Mood): number {
  return MOOD_COLOR[mood] ?? QUIET_COLOR
}
