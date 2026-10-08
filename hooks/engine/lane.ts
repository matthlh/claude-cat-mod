import type { Cat, Identity, Mood, Motion } from '../../types'
import type { Activity, Dir, Pack, Pose, Scene } from '../packs/types'
import { clamp01 } from './draw'
import { SLIDE_MS } from './geometry'
import { IN_BED, TO_BED, isWalking } from './motion'

// What both surfaces need to know about the lane at one moment.

export type Extras = { ctx?: number | null; identity?: Identity; hat?: string; hour?: number }

export type Lane = {
  act: Activity | undefined
  walking: boolean
  /** the leg is still running */
  busy: boolean
  dir: Dir
  posture: 'walk' | 'sit' | 'loaf'
  /** the activity's own pose on the spot, while the leg runs */
  pose: Pose | undefined
  sceneId: string
  scene: Scene
}

export function activityOf(pack: Pack, id: string | undefined): Activity | undefined {
  return id !== undefined && Object.hasOwn(pack.activities, id) ? pack.activities[id] : undefined
}

export function lane(pack: Pack, c: Cat, m: Motion, now: number, sceneId: string): Lane {
  const act = activityOf(pack, m.activity)
  const walking = isWalking(m, now)
  const busy = now < m.t0 + m.dur
  const own = busy ? (typeof act?.pose === 'function' ? act.pose(c) : act?.pose) : undefined
  const id = Object.hasOwn(pack.scenes, sceneId) ? sceneId : pack.defaults.scene
  return {
    act,
    walking,
    busy,
    dir: m.to > m.from && walking ? 1 : m.to < m.from && walking ? -1 : c.dir,
    posture: walking ? 'walk' : c.mood === 'sleep' || own === 'loaf' ? 'loaf' : 'sit',
    pose: own === 'loaf' ? undefined : own,
    sceneId: id,
    scene: pack.scenes[id],
  }
}

// Activities with a toy or critter ahead of the hero, or at its destination.
export function hasCompanion(a: Activity | undefined): boolean {
  return !!(a?.draw || a?.target)
}

export function isHappy(mood: Mood): boolean {
  return mood === 'done' || mood === 'pet' || mood === 'tired'
}

export function isInBed(c: Cat, m: Motion): boolean {
  return c.mood === 'sleep' && m.activity === IN_BED
}

// How far the bed has slid in (1) or out (0), or null when it's away.
export function bedShown(c: Cat, m: Motion, now: number): number | null {
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
