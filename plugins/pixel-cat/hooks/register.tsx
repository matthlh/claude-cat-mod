import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Follower, HeroState, Identity, Limits, Look, Mode, Mood, Motion, Phase, Prefs, Speed, Stats, ToolProp } from '../types'
import { nextLeg, planLeg, strollPace } from './engine/brain'
import { laneCells as drawCells } from './engine/cells'
import { CREW_MAX, extendTrail, isWorking, muster, terminalCap, workingCount } from './engine/crew'
import type { Trail } from './engine/crew'
import { DESKTOP_PX_PER_COLUMN, HERO_COLS, LANE_H, LANE_ROWS, SLIDE_MS } from './engine/geometry'
import { HAT_TIERS, hatLabel, hatsOf, unlockedHats } from './engine/hats'
import { activityOf, coatOf, lookOf } from './engine/lane'
import type { Extras } from './engine/lane'
import { IN_BED, TO_BED, isWalking, legDir, posAt } from './engine/motion'
import { laneSvg as drawSvg } from './engine/svg'
import { phaseAt } from './engine/time'
import { COATS } from './packs/cat/sprites'
import { DEFAULT_PACK, PACKS, packFor } from './packs/index'
import type { HatDef, Pack, Palette } from './packs/types'

export type { Extras }

// ── State ────────────────────────────────────────────────────────────────
// The hooks only write state when something changes (a mood, a line, a new
// leg of the walk). The frames in between are drawn by the surfaces: the
// desktop SVG animates itself, and the terminal lane is repainted in place.

// It says hello from the first frame, before session.start has run.
const cat = atom({ plugin: 'pixel-cat', key: 'cat' } as const, {
  mood: 'idle',
  dir: 1,
  say: DEFAULT_PACK.text.hello,
  sayAt: 0,
} as HeroState)
const motion = atom({ plugin: 'pixel-cat', key: 'motion' } as const, {
  from: 0.1,
  to: 0.1,
  t0: 0,
  dur: 0,
} as Motion)
const limits = atom({ plugin: 'pixel-cat', key: 'limits' } as const, {
  fiveHour: null,
  sevenDay: null,
  context: null,
  fiveHourResets: null,
} as Limits)
const isHidden = atom({ plugin: 'pixel-cat', key: 'isHidden' } as const, false)
// Saved prefs from before packs had no `pack`, and load as the default one.
const DEFAULT_PREFS: Prefs = {
  pack: DEFAULT_PACK.id,
  coat: DEFAULT_PACK.defaults.coat,
  speed: 'normal',
  scene: DEFAULT_PACK.defaults.scene,
  popups: true,
  showUsage: true,
  hat: 'none',
}
const prefs = atom({ plugin: 'pixel-cat', key: 'prefs' } as const, DEFAULT_PREFS)
const isSettingsOpen = atom({ plugin: 'pixel-cat', key: 'isSettingsOpen' } as const, false)
const identity = atom({ plugin: 'pixel-cat', key: 'identity' } as const, { marking: 'none', shiny: false } as Identity)
const stats = atom({ plugin: 'pixel-cat', key: 'stats' } as const, { turns: 0, tools: 0 } as Stats)
// This session's working agents. Session state only: every open session would
// write it once a second, so it never goes near the store (prefs, hats, stats).
const crew = atom({ plugin: 'pixel-cat', key: 'crew' } as const, [] as Follower[])

const BRAIN_MS = 1000 // how often the hero decides what to do next
const BLIT_MS = 100 // terminal repaint rate
const NAP_AFTER_MS = 5 * 60_000
const ANNOUNCE_AFTER_S = 20
const HUNGRY_AT = 85 // context percent

// The lane drawings, for the tests: the cat unless `pack` names another.
export function laneSvg(c: HeroState, m: Motion, now: number, coat: Palette, scene: string, x: Extras & { pack?: string } = {}): string {
  return drawSvg(packFor(x.pack), c, m, now, coat, scene, x)
}

export function laneCells(c: HeroState, m: Motion, now: number, coat: Palette, cols: number, scene: string, x: Extras & { pack?: string } = {}): string {
  return drawCells(packFor(x.pack), c, m, now, coat, cols, scene, x)
}

// The cat's coats by name, for the tests.
export const PALETTES = COATS

// What the hero works with for each kind of tool Claude runs.
function toolProp(name: string): ToolProp | null {
  if (/^(Read|NotebookRead)$/.test(name)) return 'read'
  if (/Edit|Write/.test(name)) return 'edit'
  if (/^(Bash|BashOutput|Shell|PowerShell)$/.test(name)) return 'bash'
  if (/Grep|Glob|Search|Web|Fetch|^LS$/i.test(name)) return 'search'
  return null
}

// A look carried into a pack: kept where the pack has it, else its default.
function fit(look: Look, pack: Pack): Look {
  return {
    coat: Object.hasOwn(pack.coats, look.coat) ? look.coat : pack.defaults.coat,
    scene: Object.hasOwn(pack.scenes, look.scene) ? look.scene : pack.defaults.scene,
    hat: pack.hats.some(h => h.id === look.hat) ? look.hat : 'none',
  }
}

// Switching packs remembers the pack being left's coat, scene and hat, and
// puts back the new pack's own as it was left. A pack never worn before
// keeps whatever the old look has that it has too, and its defaults.
export function withPack(p: Prefs, pack: Pack): Prefs {
  const { looks, ...rest } = p
  const mine: Look = { coat: p.coat, scene: p.scene, hat: p.hat }
  const saved = looks?.[pack.id]
  const others = Object.fromEntries(Object.entries(looks ?? {}).filter(([id]) => id !== pack.id))
  return { ...rest, pack: pack.id, ...fit(saved ?? mine, pack), looks: { ...others, [p.pack]: mine } }
}

// The next item in a list after `v`, round to the first.
function nextOf<T>(list: [T, ...T[]], v: T): T {
  return list[(list.indexOf(v) + 1) % list.length] ?? list[0]
}

function title(w: string): string {
  return w.charAt(0).toUpperCase() + w.slice(1)
}

// A random item of a list, or the fallback when it is empty.
function pick<T>(list: readonly T[], fallback: T): T {
  return list[Math.floor(Math.random() * list.length)] ?? fallback
}

const SPEED_CYCLE: [Speed, ...Speed[]] = ['chill', 'normal', 'zoomies']
// A list's keys as a non-empty list, or the fallback when it has none.
const keysOr = (o: object, fallback: string): [string, ...string[]] => {
  const keys = Object.keys(o)
  return keys.length ? (keys as [string, ...string[]]) : [fallback]
}

function pctColor(p: number | null): string | undefined {
  if (p === null) return undefined
  return p >= 90 ? 'red' : p >= 70 ? 'yellow' : 'green'
}

function fmtReset(iso: string | null): string {
  if (!iso) return ''
  const mins = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60_000))
  return mins >= 60 ? ` (resets ${Math.floor(mins / 60)}h${mins % 60}m)` : ` (resets ${mins}m)`
}

// Buttons must carry an onPress, but the work happens in the ui.press hooks
// below, matched by key, so a press never depends on one drawing's closure.
function ignorePress() {}

async function activePack($: EngineInterface): Promise<Pack> {
  return packFor((await read($, prefs)).pack)
}

async function toast($: EngineInterface, text: string) {
  if ((await read($, prefs)).popups) $.ui.toast(text)
}

// Counts a finished task or a tool call; answers the active pack's hats that
// just unlocked. Unlocks are the engine's tiers, shared by every pack, so the
// other packs' hats for the same tier unlock with it: a switch finds them
// already there, under the same hint /cat gives.
async function bumpStats($: EngineInterface, fn: (s: Stats) => Stats): Promise<HatDef[]> {
  const before = await read($, stats)
  const after = fn(before)
  await update($, stats, () => after)
  await $.store.set('stats', after)
  return hatsOf(await activePack($)).filter(h => !h.need(before) && h.need(after))
}

async function setPrefs($: EngineInterface, fn: (p: Prefs) => Prefs) {
  await update($, prefs, fn)
  await $.store.set('prefs', await read($, prefs))
}

// ── The mod switcher ─────────────────────────────────────────────────────
// One ↻ button (and /mods) walks a loop of stops: each pack of this mod, then
// Token Tycoon, a separate mod this one drives through its /tycoon command,
// then off, where only a one-line strip is drawn to come back from. The stop
// is saved with the prefs, so a new session opens where the last one left.

type Stop = { id: string; label: string; mode: Mode; pack?: Pack }
const TYCOON: Stop = { id: 'tycoon', label: 'Token Tycoon', mode: 'tycoon' }
const OFF: Stop = { id: 'off', label: 'Off', mode: 'off' }

function modeOf(p: Prefs): Mode {
  return p.mode ?? 'hero'
}

// Whether Token Tycoon is installed: it registers /tycoon. The band asks on
// every redraw, so the answer is kept for a few seconds.
let tycoonSeenAt = -Infinity
let tycoonSeen = false
async function hasTycoon($: EngineInterface, now: number): Promise<boolean> {
  if (now - tycoonSeenAt < 5000) return tycoonSeen
  tycoonSeenAt = now
  try {
    tycoonSeen = (await $.command.list()).some(c => c.name === 'tycoon')
  } catch {
    tycoonSeen = false
  }
  return tycoonSeen
}

function stops(withTycoon: boolean): [Stop, ...Stop[]] {
  const packs = Object.values(PACKS).map((pack): Stop => ({ id: pack.id, label: pack.label, mode: 'hero', pack }))
  const all = [...packs, ...(withTycoon ? [TYCOON] : []), OFF]
  return [all[0] ?? OFF, ...all.slice(1)]
}

// The stop the prefs name; Token Tycoon's with it gone counts as off, so the
// strip is there to come back from.
function stopOf(list: [Stop, ...Stop[]], p: Prefs): Stop {
  const mode = modeOf(p)
  const found = list.find(s => (mode === 'hero' ? s.mode === 'hero' && s.pack?.id === p.pack : s.mode === mode))
  return found ?? (mode === 'tycoon' ? OFF : list[0])
}

async function switchTo($: EngineInterface, stop: Stop, withTycoon: boolean) {
  await setPrefs($, p => ({ ...(stop.pack ? withPack(p, stop.pack) : p), mode: stop.mode }))
  if (stop.mode === 'hero') await update($, isHidden, () => false)
  // Token Tycoon follows: out for its own stop, put away for every other.
  if (withTycoon) {
    try {
      await $.command.run({ command: 'tycoon', args: stop.mode === 'tycoon' ? 'on' : 'off' })
    } catch {
      // Gone since it was last seen; nothing to put away.
    }
  }
}

function pickStop(list: [Stop, ...Stop[]], current: Stop, want: string): Stop | undefined {
  const w = want.trim().toLowerCase()
  if (!w || w === 'next') return nextOf(list, current)
  return list.find(s => s.id === w || s.label.toLowerCase().startsWith(w))
}

// ── Hooks ────────────────────────────────────────────────────────────────

export const register: Register = on => {
  let lastActivity = 0
  let turnStartedAt = 0
  let sayUntil = 0
  let moodUntil = 0
  const warned = new Set<string>()
  // Lines queued for later in a leg ("hey!! come back" after the bird escapes).
  let cues: { at: number; text: string }[] = []
  // Where the terminal lane is mounted, for in-place repaints.
  let site: { requestId: string; cols: number } | null = null
  // The last few legs drawn, and which way the hero faced on each: the
  // followers' path, which they finish while their lag runs out. Seen by the
  // drawings, so it needs no state of its own; lost on a reload, it costs a
  // step at most.
  let path: Trail[] = []
  const trailOf = (c: HeroState, m: Motion, now: number): Trail[] => (path = extendTrail(path, m, legDir(m, c.dir), now))
  // Assigned in session.start, where the timers live.
  let wake: (mood: Mood, say: string | null, holdMs: number, prop?: ToolProp | null) => Promise<void> = async () => {}
  let hungry = false

  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get('prefs')) as Partial<Prefs> | undefined
    if (saved) await update($, prefs, () => ({ ...DEFAULT_PREFS, ...saved }))
    const pack = await activePack($)
    // Registered once, so it names no pack: switching packs needs no restart.
    await $.command.register({
      name: 'cat',
      description: 'Show or hide the pixel pet above the prompt (and see your usage limits)',
    })
    await $.command.register({
      name: 'mods',
      description: 'Switch what shows above the prompt: cat, adventurer, tycoon or off (alone: the next one)',
    })
    lastActivity = await $.clock.now()
    sayUntil = lastActivity + 5000
    // Restart the greeting's typewriter; in another pack, greet in its words.
    // A later session.start says nothing new once the hello has expired.
    await update($, cat, c => ({ ...c, say: c.say === DEFAULT_PACK.text.hello ? pack.text.hello : c.say, sayAt: lastActivity }))

    // A new leg: what the hero does next, where to, and for how long. The
    // brain is woken the moment it ends, so the next leg follows on without a
    // gap (the terminal draws a leg's layers only while it runs).
    const plan = async (now: number, mood: Mood, from: number, activity: string, chain?: number, phase?: Phase) => {
      const p = await read($, prefs)
      const { leg, dir } = planLeg(packFor(p.pack), now, mood, from, activity, p.speed, chain, phase)
      await update($, motion, () => leg)
      if (dir) await update($, cat, c => ({ ...c, dir }))
      if (leg.dur > 0 && Number.isFinite(leg.dur)) {
        $.clock.after(Math.max(1, Math.ceil(leg.t0 + leg.dur - (await $.clock.now())) + 1), () => void brain())
      }
    }

    const say = async (now: number, text: string) => {
      sayUntil = now + 2500
      await update($, cat, x => ({ ...x, say: text, sayAt: now }))
    }

    // Once a second, and when a leg ends: expire lines and moods, nap, and
    // pick the next leg. One at a time: a call while one runs runs again after.
    let thinking = false
    let again = false
    const brain = async () => {
      if (thinking) {
        again = true
        return
      }
      thinking = true
      try {
        do {
          again = false
          await think()
        } while (again)
      } finally {
        thinking = false
      }
    }
    const think = async () => {
      const now = await $.clock.now()
      const c = await read($, cat)
      const m = await read($, motion)
      const p = await read($, prefs)
      const pack = packFor(p.pack)
      const fiveHour = (await read($, limits)).fiveHour ?? 0
      const isLow = fiveHour >= 80
      const isOut = fiveHour >= 100
      const here = posAt(m, now)
      const ctx = (await read($, limits)).context ?? 0
      const phase = phaseAt(new Date().getHours())
      let mood = c.mood

      if (c.say && now > sayUntil) await update($, cat, x => ({ ...x, say: null }))
      const due = cues.filter(q => q.at <= now)
      cues = cues.filter(q => q.at > now)
      for (const q of due) await say(now, q.text)
      if (now > moodUntil && (mood === 'done' || mood === 'oops' || mood === 'pet')) mood = 'sit'

      // Bedtime: after a long quiet spell, or when the 5-hour limit runs
      // out, the hero walks back to its bed (which slides in) and sleeps.
      const isBedtime = now - lastActivity > NAP_AFTER_MS || (isOut && now > moodUntil)
      if (mood !== 'working' && mood !== 'sleep' && isBedtime) {
        cues = []
        const dur = Math.max(SLIDE_MS + 200, (here / strollPace(p.speed)) * 1000)
        sayUntil = now + 3000
        await update($, cat, (x): HeroState => ({ ...x, mood: 'sleep', dir: -1, say: isOut ? pack.text.outOfJuice : pack.text.bedtime, sayAt: now }))
        await update($, motion, () => ({ from: here, to: 0, t0: now, dur, activity: TO_BED }))
        return
      }
      if (mood === 'sleep') {
        // Arrived: hop up and curl up in bed.
        if (m.activity === TO_BED && now >= m.t0 + m.dur) {
          await update($, motion, () => ({ from: 0, to: 0, t0: now, dur: 0, activity: IN_BED }))
        }
        return
      }

      if (ctx < HUNGRY_AT) hungry = false
      if (now >= m.t0 + m.dur) {
        // From the moment the last leg ended, so a chained leg starts where
        // the one before stopped (the brain is woken for it, a millisecond or
        // so late). A leg that ended a while back, before this session or
        // before a tick that came late, is followed from now instead, so the
        // next one does not jump ahead.
        const end = m.t0 + m.dur
        const start = now - end <= 250 ? end : now
        let activity = pack.roles.stroll
        let chain: number | undefined
        let legPhase = phase
        if (mood !== 'working') {
          const n = nextLeg(pack, m, { isHungry: ctx >= HUNGRY_AT && !hungry, isLow, isLate: phase === 'night', isSaying: !!c.say })
          activity = n.activity
          chain = n.chain
          mood = n.mood
          if (n.carriesOn && m.phase) legPhase = m.phase
          if (n.saidHungry) hungry = true
          if (n.line) await say(now, n.line)
          for (const [ms, text] of n.cues) cues.push({ at: start + ms, text })
        }
        await plan(start, mood, posAt(m, start), activity, chain, legPhase)
      }
      if (mood !== c.mood) await update($, cat, x => ({ ...x, mood }))
    }

    // Terminal only: repaint the lane in place, ten times a second.
    const repaint = async () => {
      if (!site || (await read($, isHidden))) return
      const now = await $.clock.now()
      const p = await read($, prefs)
      const pack = packFor(p.pack)
      const c = await read($, cat)
      const m = await read($, motion)
      const extras: Extras = {
        ctx: (await read($, limits)).context,
        identity: await read($, identity),
        hat: p.hat,
        hour: new Date().getHours(),
        crew: await read($, crew),
        trail: trailOf(c, m, now),
      }
      const cells = drawCells(pack, c, m, now, coatOf(pack, p.coat), site.cols, p.scene, extras)
      const res = await $.ui.blit({ requestId: site.requestId, key: 'lane', cells, columns: site.cols, rows: LANE_ROWS })
      if ('deny' in res && res.deny) site = null
    }

    wake = async (mood: Mood, say: string | null, holdMs: number, prop?: ToolProp | null) => {
      const now = await $.clock.now()
      const { roles } = await activePack($)
      lastActivity = now
      cues = []
      const wasAsleep = (await read($, cat)).mood === 'sleep'
      if (say) sayUntil = now + Math.max(holdMs, 3000)
      moodUntil = now + holdMs
      const m = await read($, motion)
      const here = posAt(m, now)
      if (mood === 'working' && prop) {
        // Sit down with the right prop, facing the side with room for it.
        await update($, motion, () => ({ from: here, to: here, t0: now, dur: holdMs, activity: roles.work }))
        await update($, cat, (c): HeroState => ({ ...c, dir: here < 0.5 ? 1 : -1 }))
      } else if (mood === 'working') {
        if (!isWalking(m, now) || m.activity !== roles.stroll) await plan(now, 'working', here, roles.stroll)
      } else {
        await update($, motion, () => ({ from: here, to: here, t0: now, dur: holdMs, activity: roles.rest }))
      }
      await update($, cat, c => ({
        ...c,
        mood,
        say: say ?? c.say,
        sayAt: say ? now : c.sayAt,
        wokeAt: wasAsleep ? now : c.wokeAt,
        prop: mood === 'working' ? (prop ?? null) : null,
      }))
    }

    // This hero's own look, rolled once: a marking, and a 1 in 50 chance of
    // shiny. Every pack shares it; lookOf maps the marking into each pack's own.
    let who = (await $.store.get('identity')) as Identity | undefined
    if (!who) {
      who = { marking: pick(pack.markings, 'none'), shiny: Math.random() < 1 / 50 }
      await $.store.set('identity', who)
    }
    await update($, identity, () => who as Identity)
    const counts = (await $.store.get('stats')) as Stats | undefined
    if (counts) await update($, stats, () => ({ turns: counts.turns ?? 0, tools: counts.tools ?? 0 }))

    // Once a tick too: who is working, from this session's agent list.
    let mustering = false
    const roll = async () => {
      if (mustering) return
      mustering = true
      try {
        const agents = await $.agent.list()
        const before = await read($, crew)
        // On a narrow terminal, a place in sight goes to one waiting out of it.
        const after = muster(before, agents, await $.clock.now(), site ? terminalCap(site.cols) : CREW_MAX)
        if (after !== before) await update($, crew, () => after)
      } catch {
        // No list this tick (not bound yet, say): the crew stays as it was.
      } finally {
        mustering = false
      }
    }

    $.clock.every(BRAIN_MS, () => {
      void brain()
      void roll()
    })
    $.clock.every(BLIT_MS, () => void repaint())

    const usage = await $.session.usage()
    const five = usage.rateLimits.find(r => r.kind === 'five_hour')
    await update($, limits, () => ({
      fiveHour: five?.percentUsed ?? null,
      sevenDay: usage.rateLimits.find(r => r.kind === 'seven_day')?.percentUsed ?? null,
      context: usage.context.percent ?? null,
      fiveHourResets: five?.resetsAt ?? null,
    }))

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    turnStartedAt = await $.clock.now()
    await wake('working', 'on it!', 60 * 60_000)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const name = e.tool.replace(/^mcp__[^_]+(?:_[^_]+)*__/, '')
    const prop = toolProp(name)
    await wake('working', `${name}…`, 60 * 60_000, prop)
    const pack = await activePack($)
    for (const h of await bumpStats($, s => ({ ...s, tools: s.tools + 1 }))) {
      await toast($, pack.toasts.hat(h.label))
    }
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError === true) {
      await wake('oops', `${name} failed`, 4000)
      await wake('working', null, 60 * 60_000, prop)
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const secs = Math.round(((await $.clock.now()) - turnStartedAt) / 1000)
    const pack = await activePack($)
    if (e.reason === 'answer') {
      await wake('done', pack.text.done(secs), 8000)
      for (const h of await bumpStats($, s => ({ ...s, turns: s.turns + 1 }))) {
        await toast($, pack.toasts.hat(h.label))
        await wake('pet', `new hat: ${h.label}!`, 4000)
      }
      if (secs >= ANNOUNCE_AFTER_S) await toast($, pack.toasts.finished(secs))
    } else if (e.reason === 'aborted') {
      await wake('sit', 'ok, stopped', 4000)
    } else {
      await wake('oops', pack.text.oops, 6000)
      await toast($, pack.toasts.failed)
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const pack = await activePack($)
    const find = (kind: string) => e.rateLimits.find(r => r.kind === kind)
    const five = find('five_hour')
    const week = find('seven_day')
    const before = (await read($, limits)).context
    const after = e.context.percent ?? null
    if (before !== null && after !== null && before - after >= 20) await wake('pet', pack.text.fed, 3000)
    await update($, limits, () => ({
      fiveHour: five?.percentUsed ?? null,
      sevenDay: week?.percentUsed ?? null,
      context: e.context.percent ?? null,
      fiveHourResets: five?.resetsAt ?? null,
    }))

    for (const [label, pct] of [['5h', five?.percentUsed], ['7d', week?.percentUsed], ['context', e.context.percent]] as const) {
      for (const at of [75, 90]) {
        const id = `${label}-${at}`
        if ((pct ?? 0) >= at && !warned.has(id)) {
          warned.add(id)
          await toast($, pack.toasts.usage(label, pct))
          await wake('tired', `${label} at ${pct}%…`, 6000)
        }
      }
    }

    return next(e)
  })

  on('command.run', { command: 'cat' }, async $ => {
    const pack = await activePack($)
    const wasHidden = await read($, isHidden)
    await update($, isHidden, () => !wasHidden)
    const l = await read($, limits)
    const who = await read($, identity)
    const st = await read($, stats)
    const owned = unlockedHats(pack, st).map(id => hatLabel(pack, id))
    const nextHat = hatsOf(pack).find(h => !h.need(st))
    const pct = (p: number | null) => (p === null ? 'n/a' : `${p}%`)
    let working = workingCount(await read($, crew))
    try {
      working = (await $.agent.list()).filter(a => isWorking(a.status)).length
    } catch {
      // The last tick's count, then.
    }
    return {
      text: [
        wasHidden ? pack.text.shown : pack.text.hidden,
        `5-hour limit: ${pct(l.fiveHour)}${fmtReset(l.fiveHourResets)}`,
        `7-day limit: ${pct(l.sevenDay)}`,
        `Context: ${pct(l.context)}`,
        `Agents working: ${working} (counts this session's agents only)`,
        '',
        `Your ${pack.noun}: ${pack.text.look(lookOf(pack, who))}${who.shiny ? ', ✨ shiny (1 in 50)!' : ''}`,
        `Tasks finished: ${st.turns}, tool calls: ${st.tools}`,
        `Hats: ${owned.length ? owned.join(', ') : 'none yet'}${nextHat ? ` (next: ${nextHat.label} at ${nextHat.hint})` : ''}`,
      ].join('\n'),
    }
  })

  on('command.run', { command: 'mods' }, async ($, e) => {
    const list = stops(await hasTycoon($, await $.clock.now()))
    const current = stopOf(list, await read($, prefs))
    const pick = pickStop(list, current, e.args)
    if (!pick) return { text: `No mod called "${e.args.trim()}". Mods: ${list.map(s => s.label).join(', ')}.` }
    await switchTo($, pick, list.includes(TYCOON))
    if (pick.pack) await wake('pet', pick.pack.text.hello, 2500)
    return {
      text: [
        `Showing: ${pick.label}.`,
        `Mods: ${list.map(s => (s === pick ? `[${s.label}]` : s.label)).join(' → ')}`,
        '/mods alone moves to the next one, /mods <name> picks one, and the ↻ button above the prompt does the same.',
      ].join('\n'),
    }
  })
  on('ui.press', { plugin: 'pixel-cat', element: 'cycle' }, async $ => {
    const list = stops(await hasTycoon($, await $.clock.now()))
    const pick = nextOf(list, stopOf(list, await read($, prefs)))
    await switchTo($, pick, list.includes(TYCOON))
    if (pick.pack) await wake('pet', pick.pack.text.hello, 2500)
    return { element: 'cycle' }
  })
  on('ui.press', { plugin: 'pixel-cat', element: 'pet' }, async $ => {
    const { text } = await activePack($)
    const asleep = (await read($, cat)).mood === 'sleep'
    await wake('pet', pick(asleep ? text.petAsleep : text.pet, '♥'), 3000)
    return { element: 'pet' }
  })

  on('ui.press', { plugin: 'pixel-cat', element: 'hide' }, async $ => {
    await update($, isHidden, () => true)
    return { element: 'hide' }
  })

  on('ui.press', { plugin: 'pixel-cat', element: 'settings' }, async $ => {
    await update($, isSettingsOpen, open => !open)
    return { element: 'settings' }
  })

  on('ui.press', { plugin: 'pixel-cat', element: 'set-pack' }, async $ => {
    const pack = packFor(nextOf(keysOr(PACKS, DEFAULT_PACK.id), (await read($, prefs)).pack))
    await setPrefs($, p => withPack(p, pack))
    await wake('pet', pack.text.hello, 2500)
    return { element: 'set-pack' }
  })

  on('ui.press', { plugin: 'pixel-cat', element: 'set-coat' }, async $ => {
    const pack = await activePack($)
    await setPrefs($, p => ({ ...p, coat: nextOf(keysOr(pack.coats, pack.defaults.coat), p.coat) }))
    await wake('pet', 'new look!', 2500)
    return { element: 'set-coat' }
  })

  on('ui.press', { plugin: 'pixel-cat', element: 'set-speed' }, async $ => {
    await setPrefs($, p => ({ ...p, speed: nextOf(SPEED_CYCLE, p.speed) }))
    return { element: 'set-speed' }
  })

  on('ui.press', { plugin: 'pixel-cat', element: 'set-scene' }, async $ => {
    const pack = await activePack($)
    await setPrefs($, p => ({ ...p, scene: nextOf(keysOr(pack.scenes, pack.defaults.scene), p.scene) }))
    return { element: 'set-scene' }
  })

  on('ui.press', { plugin: 'pixel-cat', element: 'set-popups' }, async $ => {
    await setPrefs($, p => ({ ...p, popups: !p.popups }))
    return { element: 'set-popups' }
  })

  on('ui.press', { plugin: 'pixel-cat', element: 'set-hat' }, async $ => {
    const pack = await activePack($)
    const owned = unlockedHats(pack, await read($, stats))
    if (owned.length === 0) {
      const hint = pack.hats.length ? HAT_TIERS[0]?.hint : undefined
      await wake('sit', hint ? `no hats yet! (${hint})` : 'no hats here!', 3500)
    } else {
      await setPrefs($, p => ({ ...p, hat: nextOf(['none', ...owned], owned.includes(p.hat) ? p.hat : 'none') }))
      await wake('pet', 'fancy!', 2500)
    }
    return { element: 'set-hat' }
  })

  on('ui.press', { plugin: 'pixel-cat', element: 'set-usage' }, async $ => {
    await setPrefs($, p => ({ ...p, showUsage: !p.showUsage }))
    return { element: 'set-usage' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)

    const now = await $.clock.now()
    const pr = await read($, prefs)
    // Where the switcher stands: on Token Tycoon's stop this band draws
    // nothing, and on off only the strip that brings the next mod back.
    const list = stops(await hasTycoon($, now))
    const stop = stopOf(list, pr)
    const after = nextOf(list, stop)
    if (stop.mode === 'tycoon') {
      site = null
      return next(e)
    }
    const { Box, Text, Button, Raster, Svg } = $.ui.resolve(e) as any
    if (stop.mode === 'off') {
      site = null
      return (
        <Box paddingX={1}>
          <Button key="cycle" label={`↻ ${after.label}`} plain dimColor onPress={ignorePress} />
        </Box>
      )
    }
    const c = await read($, cat)
    const m = await read($, motion)
    const l = await read($, limits)
    const isSetting = await read($, isSettingsOpen)
    const who = await read($, identity)
    const st = await read($, stats)
    const pack = packFor(pr.pack)
    const extras: Extras = {
      ctx: l.context,
      identity: who,
      hat: pr.hat,
      hour: new Date().getHours(),
      crew: await read($, crew),
      trail: trailOf(c, m, now),
    }
    const usageNote = now < m.t0 + m.dur ? activityOf(pack, m.activity)?.usageNote : undefined
    const coat = coatOf(pack, pr.coat)
    const columns = e.viewport?.columns ?? 80

    const laneW = Math.max(240, Math.round((columns - 2) * DESKTOP_PX_PER_COLUMN))
    let lane
    if (e.surface === 'terminal') {
      const cols = Math.max(HERO_COLS + 1, Math.min(512, columns - 2))
      site = { requestId: e.requestId, cols }
      lane = <Raster key="lane" columns={cols} rows={LANE_ROWS} cells={drawCells(pack, c, m, now, coat, cols, pr.scene, extras)} />
    } else {
      lane = (
        <Svg
          source={drawSvg(pack, c, m, now, coat, pr.scene, { ...extras, laneW })}
          alt={`Claude ${pack.noun} (${c.mood})${c.say ? `: ${c.say}` : ''}`}
          width={laneW}
          height={LANE_H}
          isInteractive
        />
      )
    }

    const fmt = (label: string, p: number | null) =>
      p === null ? null : (
        <Text dimColor={p < 70} color={pctColor(p)}>
          {label} {p}%{'  '}
        </Text>
      )

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row" width="100%">
          {lane}
        </Box>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2}>
          {isSetting ? (
            <Box flexDirection="row" columnGap={1} flexWrap="wrap">
              {Object.keys(PACKS).length > 1 ? <Button key="set-pack" label={`Pack: ${pack.label}`} onPress={ignorePress} /> : null}
              <Button key="set-coat" label={`${pack.coatLabel}: ${title(pr.coat)}`} onPress={ignorePress} />
              <Button key="set-speed" label={`Speed: ${title(pr.speed)}`} onPress={ignorePress} />
              <Button key="set-scene" label={`Scene: ${pack.scenes[pr.scene]?.label ?? title(pr.scene)}`} onPress={ignorePress} />
              <Button key="set-hat" label={unlockedHats(pack, st).length ? `Hat: ${hatLabel(pack, pr.hat)}` : 'Hat: 🔒'} onPress={ignorePress} />
              <Button key="set-popups" label={`Popups: ${pr.popups ? 'On' : 'Off'}`} onPress={ignorePress} />
              <Button key="set-usage" label={`Usage: ${pr.showUsage ? 'On' : 'Off'}`} onPress={ignorePress} />
            </Box>
          ) : pr.showUsage && usageNote ? (
            <Text dimColor wrap="truncate-end">
              {usageNote}
            </Text>
          ) : pr.showUsage ? (
            <Text wrap="truncate-end">
              {fmt('5h', l.fiveHour)}
              {fmt('7d', l.sevenDay)}
              {fmt('ctx', l.context)}
            </Text>
          ) : (
            <Text> </Text>
          )}
          <Box flexDirection="row" columnGap={1} flexShrink={0}>
            <Button key="pet" label="Pet ♥" onPress={ignorePress} />
            <Button key="settings" label={isSetting ? 'Done' : '⚙'} onPress={ignorePress} />
            <Button key="cycle" label={`↻ ${after.label}`} onPress={ignorePress} />
            <Button key="hide" label="Hide" onPress={ignorePress} />
          </Box>
        </Box>
      </Box>
    )
  })
}
