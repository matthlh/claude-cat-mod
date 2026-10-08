import type { Mood, Motion, Speed } from '../../types'
import type { Dir, Move, Pack } from '../packs/types'
import { clamp01 } from './draw'
import { activityOf, hasCompanion } from './lane'

// Lane speed in lane-widths per second.
const PACE: Record<Speed, number> = { chill: 0.03, normal: 0.06, zoomies: 0.18 }
const RUN_PACE: Record<Speed, number> = { chill: 0.12, normal: 0.2, zoomies: 0.35 }
const TIRED_PACE = 0.025

export function strollPace(speed: Speed): number {
  return PACE[speed]
}

function roll([lo, hi]: [number, number]): number {
  return lo + Math.random() * (hi - lo)
}

// Anywhere, but a good stretch from here.
function wander(from: number): number {
  const to = Math.random()
  if (Math.abs(to - from) >= 0.2) return to
  return from < 0.5 ? from + 0.3 + Math.random() * 0.4 : from - 0.3 - Math.random() * 0.4
}

// Where a moving leg ends, from where it starts.
function destination(move: Exclude<Move, { stay: unknown }> | undefined, from: number): number {
  if (!move) return wander(from)
  if ('spot' in move) return move.spot
  if ('near' in move) return from < 0.5 ? from + roll(move.near) : from - roll(move.near)
  // A short dash this way or that, turning back at the edges.
  const sign = Math.random() < 0.5 ? 1 : -1
  const to = from + sign * roll(move.zip)
  return to < 0.05 || to > 0.95 ? from - sign * roll(move.zip) : to
}

// A new leg: what the hero does next, where to, and for how long; and which
// way it then faces, when that changes.
export function planLeg(pack: Pack, now: number, mood: Mood, from: number, activity: string, speed: Speed, chain?: number): { leg: Motion; dir?: Dir } {
  const a = activityOf(pack, activity)
  const move = a?.move
  if (move && 'stay' in move) {
    const dur = typeof move.stay === 'number' ? move.stay : roll(move.stay)
    const hit = a?.hit === undefined ? undefined : Math.random() < a.hit
    return { leg: { from, to: from, t0: now, dur, activity, hit }, dir: move.faceRoom ? (from < 0.5 ? 1 : -1) : undefined }
  }
  const base = mood === 'working' ? RUN_PACE[speed] : mood === 'tired' ? TIRED_PACE : PACE[speed]
  const pace = mood === 'working' ? base : base * (a?.pace ?? 1)
  // Keep toys and critters ahead of the hero on screen.
  const dest = destination(move, from)
  const to = hasCompanion(a) ? Math.max(0.12, Math.min(0.95, dest)) : clamp01(dest)
  const dur = Math.max(800, (Math.abs(to - from) / pace) * 1000)
  return { leg: { from, to, t0: now, dur, activity, chain }, dir: to > from ? 1 : -1 }
}

type Column = 'day' | 'night' | 'tired'

function pick(pack: Pack, column: Column): string {
  const options = Object.entries(pack.activities)
    .map(([id, a]) => [id, a.weight?.[column] ?? 0] as const)
    .filter(([, w]) => w > 0)
  let left = Math.random() * options.reduce((sum, [, w]) => sum + w, 0)
  for (const [id, w] of options) {
    left -= w
    if (left <= 0) return id
  }
  return options[0][0]
}

type Choice = { activity: string; chain?: number; line?: string; how: 'then' | 'hunger' | 'repeat' | 'pick' }

function fresh(pack: Pack, column: Column): Choice {
  const activity = pick(pack, column)
  const repeat = activityOf(pack, activity)?.repeat
  return { activity, chain: repeat && repeat[0] + Math.floor(Math.random() * (repeat[1] - repeat[0] + 1)), how: 'pick' }
}

export type Next = {
  activity: string
  chain?: number
  mood: Mood
  line: string | null
  cues: [number, string][]
  /** the hunger line was said */
  fed: boolean
}

// What follows an idle leg. Some activities lead into the next (a chased
// mouse may get caught, a stalked bird gets pounced on, the laser zips
// again); otherwise a fresh pick, weighted by the time of day and the limit.
export function nextLeg(pack: Pack, prev: Motion, s: { isHungry: boolean; isLow: boolean; isLate: boolean; isSaying: boolean }): Next {
  const was = activityOf(pack, prev.activity)
  const follow = (): Choice | null => {
    const f = was?.then?.(prev)
    return f ? { ...f, how: 'then' } : null
  }
  const left = prev.chain ?? 0
  const next: Choice =
    (was?.thenFirst && follow()) ||
    (s.isHungry && { activity: pack.roles.rest, line: pack.text.hungry, how: 'hunger' }) ||
    (was?.repeat && prev.activity && left > 0 && { activity: prev.activity, chain: left - 1, how: 'repeat' }) ||
    (!was?.thenFirst && follow()) ||
    fresh(pack, s.isLow ? 'tired' : s.isLate ? 'night' : 'day')
  const a = activityOf(pack, next.activity)
  // Now and then, say something about it; always, right after a follow-up.
  let line = next.line ?? null
  if (!line && a?.lines && next.how !== 'repeat' && (next.how === 'then' || (!s.isSaying && Math.random() < 0.5))) {
    line = a.lines[Math.floor(Math.random() * a.lines.length)]
  }
  return {
    activity: next.activity,
    chain: next.chain,
    mood: a?.mood ?? (s.isLow ? 'tired' : 'idle'),
    line,
    cues: a?.cues ?? [],
    fed: next.how === 'hunger',
  }
}
