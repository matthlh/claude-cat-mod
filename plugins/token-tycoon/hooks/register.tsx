import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Fx, FxKind, GenId, Mood, Prefs, Save, ToolId } from '../types'
import { FRAMES, FRAME_SIZE } from './frames'

// ── State ────────────────────────────────────────────────────────────────

const PANE = 'token-tycoon'

export const FRESH: Save = {
  tokens: 0,
  earned: 0,
  lifetime: 0,
  clicks: 0,
  owned: { agent: 0, subagent: 0, robot: 0, swarm: 0, fleet: 0, lab: 0 },
  model: 0,
  infra: 0,
  tools: { read: false, edit: false, bash: false, grep: false, web: false },
  points: 0,
  trained: 0,
  bonusHits: 0,
  frenzies: 0,
  frenzyUntil: 0,
  played: 0,
  savedAt: 0,
}

export const save = atom({ plugin: 'token-tycoon', key: 'save' } as const, { ...FRESH } as Save)
export const fx = atom({ plugin: 'token-tycoon', key: 'fx' } as const, { at: 0, gain: 0, kind: null } as Fx)
const isHidden = atom({ plugin: 'token-tycoon', key: 'isHidden' } as const, false)
const prefs = atom({ plugin: 'token-tycoon', key: 'prefs' } as const, { popups: true } as Prefs)
// What the character is doing, set by the hooks; frames follow from it and fx.
const mood = atom({ plugin: 'token-tycoon', key: 'mood' } as const, 'idle' as Mood)

// ── The game ─────────────────────────────────────────────────────────────
// Cookie Clicker with Claude's furniture: a prompt earns tokens, agents earn
// tokens every second, and the shop multiplies both.

export type Gen = { id: GenId; label: string; rate: number; cost: number; hotkey: string }
export const GENS: Gen[] = [
  { id: 'agent', label: 'Agent', rate: 0.1, cost: 15, hotkey: '1' },
  { id: 'subagent', label: 'Subagent', rate: 1, cost: 100, hotkey: '2' },
  { id: 'robot', label: 'Robot', rate: 8, cost: 1100, hotkey: '3' },
  { id: 'swarm', label: 'Agent swarm', rate: 47, cost: 12000, hotkey: '4' },
  { id: 'fleet', label: 'Model fleet', rate: 260, cost: 130000, hotkey: '5' },
  { id: 'lab', label: 'Research lab', rate: 1400, cost: 1400000, hotkey: '6' },
]

export type Tier = { label: string; mult: number; cost: number }
export const MODELS: Tier[] = [
  { label: 'Haiku', mult: 1, cost: 0 },
  { label: 'Sonnet', mult: 2, cost: 100 },
  { label: 'Opus', mult: 5, cost: 1000 },
  { label: 'Fable', mult: 20, cost: 20000 },
  { label: 'Mythos', mult: 100, cost: 500000 },
]
export const INFRA: Tier[] = [
  { label: 'Laptop', mult: 1, cost: 0 },
  { label: 'GPU', mult: 2, cost: 600 },
  { label: 'Rack', mult: 4, cost: 10000 },
  { label: 'Data center', mult: 8, cost: 150000 },
  { label: 'Cluster', mult: 16, cost: 2500000 },
]

export type Tool = { id: ToolId; label: string; cost: number; desc: string; hotkey: string }
export const TOOLS: Tool[] = [
  { id: 'read', label: 'Read', cost: 200, desc: 'agents +25%', hotkey: 'r' },
  { id: 'edit', label: 'Edit', cost: 900, desc: 'each prompt also earns 5% of your per-second income', hotkey: 'e' },
  { id: 'bash', label: 'Bash', cost: 5000, desc: '20% chance a prompt counts twice', hotkey: 'b' },
  { id: 'grep', label: 'Grep', cost: 20000, desc: 'crit chance 5% → 15%', hotkey: 'g' },
  { id: 'web', label: 'WebSearch', cost: 80000, desc: 'earn while away for 8h instead of 4h', hotkey: 'w' },
]

export function modelAt(i: number): Tier {
  return MODELS[Math.max(0, Math.min(MODELS.length - 1, i))] as Tier
}
export function infraAt(i: number): Tier {
  return INFRA[Math.max(0, Math.min(INFRA.length - 1, i))] as Tier
}

export const CRIT_MULT = 10
export const POINT_EVERY = 500000
// Owning this many of one agent doubles that agent, each time.
export const MILESTONES = [10, 25, 50, 100, 200, 400]
export const FRENZY_MULT = 7
export const FRENZY_MS = 30_000
export const OFFLINE_RATE = 0.5
export const OFFLINE_CAP_H = 4

export function prestigeMult(points: number): number {
  return 1 + 0.25 * points
}
export function pointsFor(earned: number): number {
  return Math.floor(Math.sqrt(earned / POINT_EVERY))
}
export function milestoneMult(owned: number): number {
  return Math.pow(2, MILESTONES.filter(n => owned >= n).length)
}
export function nextMilestone(owned: number): number | null {
  return MILESTONES.find(n => owned < n) ?? null
}
export function isFrenzy(s: Save, now: number): boolean {
  return now < (s.frenzyUntil ?? 0)
}
// What one of this agent earns per second, with every multiplier but frenzy.
export function genRate(s: Save, g: Gen): number {
  return g.rate * milestoneMult(s.owned[g.id] ?? 0) * infraAt(s.infra).mult * (s.tools.read ? 1.25 : 1) * prestigeMult(s.points)
}
export function baseDps(s: Save): number {
  return GENS.reduce((sum, g) => sum + genRate(s, g) * (s.owned[g.id] ?? 0), 0)
}
export function dps(s: Save, now = 0): number {
  return baseDps(s) * (isFrenzy(s, now) ? FRENZY_MULT : 1)
}
export function clickGain(s: Save): number {
  return (modelAt(s.model).mult + (s.tools.edit ? 0.05 * baseDps(s) : 0)) * prestigeMult(s.points)
}
export function critChance(s: Save): number {
  return s.tools.grep ? 0.15 : 0.05
}
export function genCost(g: Gen, owned: number): number {
  return Math.ceil(g.cost * Math.pow(1.15, owned))
}
export function offlineCapMs(s: Save): number {
  return OFFLINE_CAP_H * (s.tools.web ? 2 : 1) * 3600_000
}
export function nextTier(list: Tier[], at: number): Tier | null {
  return at + 1 < list.length ? (list[at + 1] as Tier) : null
}
// The cheapest thing in the shop you can't afford yet: what to save for.
export function savingFor(s: Save): { label: string; cost: number } | null {
  const items: { label: string; cost: number }[] = GENS.map(g => ({ label: g.label, cost: genCost(g, s.owned[g.id] ?? 0) }))
  const m = nextTier(MODELS, s.model)
  if (m) items.push({ label: `Model → ${m.label}`, cost: m.cost })
  const i = nextTier(INFRA, s.infra)
  if (i) items.push({ label: `Infra → ${i.label}`, cost: i.cost })
  for (const t of TOOLS) if (!s.tools[t.id]) items.push({ label: t.label, cost: t.cost })
  const ahead = items.filter(x => x.cost > s.tokens).sort((a, b) => a.cost - b.cost)
  return ahead[0] ?? null
}
export function canBuy(s: Save): { label: string; cost: number } | null {
  const items: { label: string; cost: number }[] = GENS.map(g => ({ label: g.label, cost: genCost(g, s.owned[g.id] ?? 0) }))
  const m = nextTier(MODELS, s.model)
  if (m) items.push({ label: `Model → ${m.label}`, cost: m.cost })
  const i = nextTier(INFRA, s.infra)
  if (i) items.push({ label: `Infra → ${i.label}`, cost: i.cost })
  for (const t of TOOLS) if (!s.tools[t.id]) items.push({ label: t.label, cost: t.cost })
  const ok = items.filter(x => x.cost <= s.tokens).sort((a, b) => b.cost - a.cost)
  return ok[0] ?? null
}

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '∞'
  const abs = Math.abs(n)
  if (abs < 10) return (Math.round(n * 10) / 10).toString()
  if (abs < 1000) return Math.round(n).toString()
  const units = ['K', 'M', 'B', 'T', 'Qa', 'Qi']
  let v = abs
  let i = -1
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  const digits = v < 10 ? 2 : v < 100 ? 1 : 0
  return (n < 0 ? '-' : '') + v.toFixed(digits) + units[i]
}
export function fmtTime(ms: number): string {
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}
// Adds tokens: to the purse, this run's total and the lifetime total.
export function earn(s: Save, amount: number): Save {
  return { ...s, tokens: s.tokens + amount, earned: s.earned + amount, lifetime: s.lifetime + amount }
}

// ── Art ──────────────────────────────────────────────────────────────────
// Letter grids: '.' is transparent. The terminal shows a chibi beside a big
// token; the desktop shows the sprite-sheet coder (frames.ts) beside it.

const BOT_A = [
  '....hhhhhhhh....',
  '...hhhhhhhhhh...',
  '..hhhhhhhhhhhh..',
  '..hhffffffffhh..',
  '..hfEEffffEEfh..',
  '..hfEeffffEefh..',
  '..hfEEffffEEfh..',
  '..hffffffffffh..',
  '...ffffVVffff...',
  '....ffffffff....',
  '......nnnn......',
  '...wwooooooww...',
  '..w.oooccooo.w..',
  '..w.oooooooo.w..',
  '....ssssssss....',
  '.....pp..pp.....',
  '.....pp..pp.....',
  '....bbb..bbb....',
]
const BOT_B = [
  '....hhhhhhhh...T',
  '...hhhhhhhhhh.T.',
  '..hhhhhhhhhhhhT.',
  '..hhffffffffhhw.',
  '..hfEEffffEEfhw.',
  '..hfEeffffEefww.',
  '..hfEEffffEEfw..',
  '..hffffffffffw..',
  '...ffffVVffffw..',
  '....ffffffffw...',
  '......nnnn.w....',
  '...wwoooooow....',
  '..w.oooccooo....',
  '..w.oooooooo....',
  '....ssssssss....',
  '.....pp..pp.....',
  '.....pp..pp.....',
  '....bbb..bbb....',
]
// The big token: a gold coin with a ✦ on it.
const COIN = [
  '......LLLLLLLL......',
  '....LLHHHHHHHHLL....',
  '...LHHHFFFFFFHHHL...',
  '..LHHFFFFFFFFFFHHL..',
  '.LHHFFFFFWWFFFFFHHL.',
  '.LHFFFFFFWWFFFFFFHL.',
  'LHHFFFFFWWWWFFFFFHHD',
  'LHFFFFWWWWWWWWFFFFHD',
  'LHFFFFFFWWWWFFFFFFHD',
  'LHFFFFFFFWWFFFFFFFHD',
  'LHFFFFFFFWWFFFFFFFDD',
  'LHFFFFFFFFFFFFFFFDDD',
  '.LHFFFFFFFFFFFFFDDD.',
  '.LHFFFFFFFFFFFFDDDD.',
  '..LFFFFFFFFFFFDDDD..',
  '...LFFFFFFFFFDDDD...',
  '....LLFFFFFDDDD.....',
  '......DDDDDDDD......',
]
export type Palette = Record<string, number>
const BOT_PAL: Palette = { h: 0x5a3b2e, f: 0xf6d2b3, n: 0xdcb18f, E: 0x3fb8f0, e: 0xffffff, V: 0xb0555b, o: 0xd97757, s: 0xa8553a, c: 0xf4ece2, w: 0xf6d2b3, p: 0x3c4a7a, b: 0x2b2b30, T: 0xffd54a }
const COIN_PAL: Palette = { L: 0xfff3b0, H: 0xffe066, F: 0xf5c542, W: 0xfffbe8, D: 0xb8860b }
const FRENZY_PAL: Palette = { L: 0xffd0a0, H: 0xffa54a, F: 0xf58a2a, W: 0xfff4d6, D: 0xb35a10 }
const SPARK = 0xffe66d

export const SCENE_W = 48
export const SCENE_H = 32
const BOT_X = 3
const COIN_X = 24
const COIN_Y = 7
const PX = 3

type Pixels = (number | undefined)[]
function plot(pixels: Pixels, rows: string[], x0: number, y0: number, pal: Palette) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = pal[row[x] ?? '.']
      const px = x0 + x
      const py = y0 + y
      if (c !== undefined && px >= 0 && px < SCENE_W && py >= 0 && py < SCENE_H) pixels[py * SCENE_W + px] = c
    }
  })
}

// The scene as pixels: the chibi, the coin, and sparks while a press lands.
export function scenePixels(s: Save, f: Fx, now: number, frame: 0 | 1): Pixels {
  const pixels: Pixels = new Array(SCENE_W * SCENE_H)
  const hitting = now - f.at < 400 && (f.kind === 'click' || f.kind === 'free' || f.kind === 'crit')
  plot(pixels, frame ? BOT_B : BOT_A, BOT_X, 7, BOT_PAL)
  plot(pixels, COIN, COIN_X, COIN_Y, isFrenzy(s, now) ? FRENZY_PAL : COIN_PAL)
  if (hitting || isFrenzy(s, now)) {
    const sp = { S: SPARK }
    plot(pixels, ['S...', '.S..', '..S.', '.S..', 'S...'], COIN_X - 4, 10, sp)
    plot(pixels, ['...S', '..S.', '.S..', '..S.', '...S'], COIN_X + 20, 10, sp)
    if (f.kind === 'crit' && hitting) plot(pixels, ['S.S', '.S.', 'S.S'], COIN_X + 8, 2, sp)
  }
  return pixels
}

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0')

// ── Desktop: two SVGs side by side ──
// The coder (frames.ts) never changes with the score, so her animation keeps
// running; the coin redraws when a press lands.
export const SPLIT_X = 22
export const CHAR_PX = 96
export const PORTRAIT_W = CHAR_PX
export const PORTRAIT_H = CHAR_PX
const BOT_W = PORTRAIT_W
const BLOCK_W = (SCENE_W - SPLIT_X) * PX
const SCENE_PX_H = SCENE_H * PX

function rects(pix: Pixels, x0: number, x1: number, dx: number): string {
  let out = ''
  for (let y = 0; y < SCENE_H; y++)
    for (let x = x0; x < x1; x++) {
      const c = pix[y * SCENE_W + x]
      if (c !== undefined) out += `<rect x="${(x - dx) * PX}" y="${y * PX}" width="${PX}" height="${PX}" fill="${hex(c)}"/>`
    }
  return out
}

const CARD = '#1e1e1e'
const svgOpen = (w: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${SCENE_PX_H}" width="${w}" height="${SCENE_PX_H}" shape-rendering="crispEdges" style="background:${CARD}"><rect width="100%" height="100%" fill="${CARD}"/>`

// Each state is one steady base frame, with other frames shown only during
// short slots of a cycle (a blink, a glance up), plus a smooth motion on top.
const F = { idle: 0, eyesClosed: 1, lookUp: 2, blink: 3, typing: 4, thinking: 5, sleep1: 6, sleep2: 7, oops: 8, cheer1: 9, cheer2: 10, over1: 11, over2: 12, hit: 13 }
type Slot = [number, number]
type Scene = { base: number; cycle: number; extras: { frame: number; slots: Slot[] }[]; motion: string }
export type BotState = Mood | 'frenzy'
// A bob with a little squash and stretch, anchored at the feet.
const bob = (px: number, dur: number, squash = 0.02) =>
  `<animateTransform attributeName="transform" type="translate" values="0 0;0 ${-px};0 0" keyTimes="0;0.5;1" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" dur="${dur}s" repeatCount="indefinite" additive="sum"/>` +
  `<animateTransform attributeName="transform" type="scale" values="1 1;${1 - squash} ${1 + squash};1 1" keyTimes="0;0.5;1" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" dur="${dur}s" repeatCount="indefinite" additive="sum"/>`
const shake = (px: number, dur: number) =>
  `<animateTransform attributeName="transform" type="translate" values="0 0;${px} 0;0 0;${-px} 0;0 0" dur="${dur}s" repeatCount="indefinite"/>`
function sceneFor(st: BotState): Scene {
  if (st === 'frenzy')
    return { base: F.cheer1, cycle: 0.8, extras: [{ frame: F.cheer2, slots: [[0.5, 1]] }], motion: bob(4, 0.4, 0.05) }
  if (st === 'working')
    return { base: F.typing, cycle: 9, extras: [{ frame: F.thinking, slots: [[0.6, 0.8]] }], motion: bob(1.5, 0.8, 0.025) }
  if (st === 'sleep')
    return { base: F.sleep1, cycle: 3, extras: [{ frame: F.sleep2, slots: [[0.5, 1]] }], motion: bob(1, 3, 0.015) }
  if (st === 'oops')
    return { base: F.oops, cycle: 1, extras: [], motion: shake(0.6, 0.5) }
  return {
    base: F.idle,
    cycle: 30,
    extras: [
      { frame: F.blink, slots: [[0.15, 0.155], [0.48, 0.485], [0.83, 0.835]] },
      { frame: F.lookUp, slots: [[0.62, 0.7]] },
    ],
    motion: bob(2, 2.6, 0.03),
  }
}
// A frame is a set of paths in FRAME_SIZE units, scaled to the character box.
function frameImage(i: number, dx: number): string {
  const k = (CHAR_PX / FRAME_SIZE).toFixed(4)
  return `<g transform="translate(${dx} 0) scale(${k})">${FRAMES[i] ?? FRAMES[0] ?? ''}</g>`
}
// Opacity steps over one cycle: 1 inside the slots, 0 outside (or the reverse).
function stepped(slots: Slot[], cycle: number, inside: number): string {
  const marks = [0, ...slots.flat(), 1].filter((v, i, a) => i === 0 || v !== a[i - 1])
  const vals: number[] = []
  for (let i = 0; i < marks.length; i++) {
    const t = marks[i]!
    const isIn = slots.some(([a, b]) => t >= a && t < b)
    vals.push(isIn ? inside : 1 - inside)
  }
  return `<animate attributeName="opacity" values="${vals.join(';')}" keyTimes="${marks.map(v => v.toFixed(3)).join(';')}" dur="${cycle}s" calcMode="discrete" repeatCount="indefinite"/>`
}
function botBodyFor(st: BotState, dx: number): string {
  const sc = sceneFor(st)
  const all = sc.extras.flatMap(x => x.slots)
  let out = `<g>${frameImage(sc.base, dx)}${all.length ? stepped(all, sc.cycle, 0) : ''}</g>`
  for (const x of sc.extras) out += `<g>${frameImage(x.frame, dx)}${stepped(x.slots, sc.cycle, 1)}</g>`
  return `<g transform-origin="${CHAR_PX / 2} ${CHAR_PX}" style="transform-origin:${CHAR_PX / 2}px ${CHAR_PX}px">${out}${sc.motion}</g>`
}
// The docs and the tests still get a frame without a mood.
function botBody(dx: number): string {
  return botBodyFor('idle', dx)
}

// The coin half: squashes when a press lands, with the gain floating up.
function blockBody(s: Save, f: Fx, now: number, dx: number): string {
  const age = now - f.at
  const pressed = age < 400 && (f.kind === 'click' || f.kind === 'free' || f.kind === 'crit')
  const pix = scenePixels(s, f, now, 0)
  const cx = (COIN_X + 10 - dx) * PX
  const cy = (COIN_Y + 9) * PX
  const squash = pressed
    ? `<animateTransform attributeName="transform" type="scale" values="1 1;${f.kind === 'crit' ? '1.25 0.75' : '1.1 0.88'};0.96 1.05;1 1" dur="${f.kind === 'crit' ? '0.45s' : '0.3s'}" begin="0s" repeatCount="1"/>`
    : isFrenzy(s, now)
      ? `<animateTransform attributeName="transform" type="scale" values="1 1;1.05 1.05;1 1" dur="0.5s" repeatCount="indefinite"/>`
      : `<animateTransform attributeName="transform" type="scale" values="1 1;1.02 1.02;1 1" dur="2.4s" repeatCount="indefinite"/>`
  const float = (text: string, fill: string, dur: string) =>
    `<text x="${cx}" y="${9 * PX}" font-family="monospace" font-size="12" font-weight="bold" text-anchor="middle" fill="${fill}" stroke="#000" stroke-width="2" paint-order="stroke">${text}<animate attributeName="y" from="${9 * PX}" to="${4 * PX}" dur="${dur}" begin="0s" fill="freeze"/><animate attributeName="opacity" from="1" to="0" dur="${dur}" begin="0s" fill="freeze"/></text>`
  const pop =
    age < 1200 && f.gain > 0 && (f.kind === 'click' || f.kind === 'free' || f.kind === 'crit')
      ? float(`+${fmt(f.gain)}${f.kind === 'crit' ? '!' : ''}`, f.kind === 'crit' ? '#ffe66d' : '#ffffff', '0.9s')
      : age < 2000 && f.gain > 0 && (f.kind === 'offline' || f.kind === 'frenzy')
        ? float(f.kind === 'frenzy' ? '×7!' : `+${fmt(f.gain)}`, '#8fe08f', '1.6s')
        : ''
  return `<g transform-origin="${cx} ${cy}" style="transform-origin:${cx}px ${cy}px">${rects(pix, SPLIT_X, SCENE_W, dx)}${squash}</g>${pop}`
}

// Only the mood (and a frenzy) changes this source, so clicks and the score
// never restart her animation.
export function botSvg(st: BotState = 'idle'): string {
  return svgOpen(BOT_W) + botBodyFor(st, 0) + '</svg>'
}
export function blockSvg(s: Save, f: Fx, now: number): string {
  return svgOpen(BLOCK_W) + blockBody(s, f, now, SPLIT_X) + '</svg>'
}
// The whole scene in one SVG, for docs and tests.
export function sceneSvg(s: Save, f: Fx, now: number): string {
  return svgOpen(PORTRAIT_W + BLOCK_W) + botBody(0) + `<g transform="translate(${PORTRAIT_W},0)">` + blockBody(s, f, now, SPLIT_X) + '</g></svg>'
}

// ── Terminal: the scene as a Raster of half blocks ──
const DEFAULT = 0x01000000
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0, b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63)
    out += i + 1 < bytes.length ? B64.charAt((n >> 6) & 63) : '='
    out += i + 2 < bytes.length ? B64.charAt(n & 63) : '='
  }
  return out
}
// The terminal gets the scene at half width and five rows tall.
export const CELL_W = SCENE_W / 2
export const SCENE_ROWS = 5
export function sceneCells(s: Save, f: Fx, now: number): string {
  const pix = scenePixels(s, f, now, (Math.floor(now / 800) % 2) as 0 | 1)
  const sy = SCENE_H / (SCENE_ROWS * 2)
  const at = (x: number, y: number): number | undefined => {
    const py = Math.min(SCENE_H - 2, Math.floor(y * sy))
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const c = pix[(py + dy) * SCENE_W + x * 2 + dx]
      if (c !== undefined) return c
    }
    return undefined
  }
  const grid = new Uint32Array(CELL_W * SCENE_ROWS * 3)
  for (let row = 0; row < SCENE_ROWS; row++)
    for (let x = 0; x < CELL_W; x++) {
      const top = at(x, row * 2)
      const bottom = at(x, row * 2 + 1)
      const i = (row * CELL_W + x) * 3
      const [ch, fg, bg]: [number, number, number] =
        top === undefined && bottom === undefined ? [0x20, DEFAULT, DEFAULT]
        : top === undefined ? [0x2584, bottom as number, DEFAULT]
        : [0x2580, top, bottom ?? DEFAULT]
      grid[i] = ch
      grid[i + 1] = fg
      grid[i + 2] = bg
    }
  return base64(new Uint8Array(grid.buffer))
}

// ── Helpers that take the engine ─────────────────────────────────────────
// Top-level declarations so a press never depends on one drawing's closure.

function ignorePress() {}

let dirty = false
let lastActivity = 0
let oopsUntil = 0
// Seconds played and income not yet written to the state (see the tick).
let playedAcc = 0
let pending = 0
const SLEEP_AFTER_MS = 5 * 60_000

async function toast($: EngineInterface, text: string) {
  if ((await read($, prefs)).popups) $.ui.toast(text)
}
async function setMood($: EngineInterface, md: Mood) {
  if ((await read($, mood)) !== md) await update($, mood, () => md)
}
async function touch($: EngineInterface, md: Mood) {
  lastActivity = await $.clock.now()
  await setMood($, md)
}
async function commit($: EngineInterface, s: Save) {
  await update($, save, () => s)
  dirty = true
}
async function persist($: EngineInterface) {
  const s = await read($, save)
  const stamped = { ...earn(s, pending), played: (s.played ?? 0) + playedAcc, savedAt: await $.clock.now() }
  pending = 0
  playedAcc = 0
  await update($, save, () => stamped)
  await $.store.set('save', stamped)
  dirty = false
}
async function flash($: EngineInterface, kind: FxKind, gain: number) {
  const at = await $.clock.now()
  await update($, fx, () => ({ at, gain, kind }))
}

// One prompt: from the button, or free from a real tool call.
async function prompt($: EngineInterface, kind: 'click' | 'free') {
  const s0 = await read($, save)
  const isCrit = Math.random() < critChance(s0)
  const twice = s0.tools.bash && Math.random() < 0.2
  const gain = clickGain(s0) * (isCrit ? CRIT_MULT : 1) * (twice ? 2 : 1)
  const s = earn(s0, gain + pending)
  pending = 0
  await commit($, {
    ...s,
    clicks: s0.clicks + (kind === 'click' ? 1 : 0),
    bonusHits: s0.bonusHits + (kind === 'free' ? 1 : 0),
  })
  await flash($, isCrit ? 'crit' : kind, gain)
}

// A finished turn starts a frenzy: every agent works ×7 for 30 seconds.
async function frenzy($: EngineInterface) {
  const now = await $.clock.now()
  const s = await read($, save)
  await commit($, { ...s, frenzyUntil: now + FRENZY_MS, frenzies: (s.frenzies ?? 0) + 1 })
  await flash($, 'frenzy', baseDps(s) * FRENZY_MULT)
  if (baseDps(s) > 0) await toast($, `🔥 Frenzy! Your agents earn ×${FRENZY_MULT} for ${FRENZY_MS / 1000}s`)
}

async function buyGen($: EngineInterface, id: GenId) {
  const s = await read($, save)
  const g = GENS.find(x => x.id === id)!
  const cost = genCost(g, s.owned[id] ?? 0)
  if (s.tokens < cost) return
  const n = (s.owned[id] ?? 0) + 1
  await commit($, { ...s, tokens: s.tokens - cost, owned: { ...s.owned, [id]: n } })
  if (MILESTONES.includes(n)) {
    await flash($, 'buy', 0)
    await toast($, `🚀 ${n} ${g.label.toLowerCase()}s: they now earn ×${milestoneMult(n)}`)
  }
}
async function buyTier($: EngineInterface, which: 'model' | 'infra') {
  const s = await read($, save)
  const list = which === 'model' ? MODELS : INFRA
  const next = nextTier(list, s[which])
  if (!next || s.tokens < next.cost) return
  await commit($, { ...s, tokens: s.tokens - next.cost, [which]: s[which] + 1 })
  await flash($, 'buy', 0)
  await toast($, which === 'model' ? `🧠 ${next.label}: prompts ×${next.mult}` : `🏭 ${next.label} online: agents ×${next.mult}`)
}
async function buyTool($: EngineInterface, id: ToolId) {
  const s = await read($, save)
  const t = TOOLS.find(x => x.id === id)!
  if (s.tools[id] || s.tokens < t.cost) return
  await commit($, { ...s, tokens: s.tokens - t.cost, tools: { ...s.tools, [id]: true } })
  await flash($, 'buy', 0)
}
async function train($: EngineInterface) {
  const s = await read($, save)
  const gained = pointsFor(s.earned)
  if (gained < 1) return
  const points = s.points + gained
  await commit($, { ...FRESH, points, trained: s.trained + 1, lifetime: s.lifetime, played: s.played, savedAt: s.savedAt })
  await persist($)
  await toast($, `✨ Trained a new model! ${points} point${points === 1 ? '' : 's'}: everything ×${prestigeMult(points)}`)
}

function summary(s: Save, now: number): string[] {
  const pts = pointsFor(s.earned)
  const next = savingFor(s)
  return [
    `✦ ${fmt(s.tokens)} tokens · +${fmt(dps(s, now))}/sec · ⚡ ${fmt(clickGain(s))} per prompt${isFrenzy(s, now) ? ` · 🔥 frenzy ${Math.ceil((s.frenzyUntil - now) / 1000)}s` : ''}`,
    `Agents: ${GENS.filter(g => s.owned[g.id]).map(g => `${s.owned[g.id]} ${g.label.toLowerCase()}`).join(', ') || 'none yet'}`,
    `Upgrades: ${modelAt(s.model).label}, ${infraAt(s.infra).label}${TOOLS.some(t => s.tools[t.id]) ? ', ' + TOOLS.filter(t => s.tools[t.id]).map(t => t.label).join(', ') : ''}`,
    next ? `Saving for: ${next.label} (${fmt(next.cost)} ✦)` : 'You own everything in the shop.',
    `Gathered ✦ ${fmt(s.lifetime)} over ${fmtTime((s.played ?? 0) + playedAcc)} · ${fmt(s.clicks)} prompts, ${fmt(s.bonusHits)} free hits, ${s.frenzies ?? 0} frenzies`,
    `Models trained: ${s.trained} (${s.points} points, ×${prestigeMult(s.points)})${pts >= 1 ? `, ${pts} more ready to claim in the shop` : ''}`,
  ]
}

// ── Hooks ────────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'idle', description: 'Open the Token Tycoon shop (and show your progress)' })

    const stored = (await $.store.get('save')) as Partial<Save> | undefined
    const p = (await $.store.get('prefs')) as Partial<Prefs> | undefined
    if (p) await update($, prefs, x => ({ ...x, ...p }))
    const now = await $.clock.now()
    lastActivity = now
    let s: Save = {
      ...FRESH,
      ...(stored ?? {}),
      owned: { ...FRESH.owned, ...(stored?.owned ?? {}) },
      tools: { ...FRESH.tools, ...(stored?.tools ?? {}) },
    }

    // Offline earnings: the agents kept working at half pace while you were away.
    const rate = baseDps(s)
    const away = s.savedAt ? Math.min(now - s.savedAt, offlineCapMs(s)) : 0
    if (rate > 0 && away >= 60_000) {
      const gain = rate * (away / 1000) * OFFLINE_RATE
      s = earn(s, gain)
      const mins = Math.round(away / 60_000)
      const when = mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}` : `${mins}m`
      await update($, fx, () => ({ at: now, gain, kind: 'offline' as FxKind }))
      await toast($, `🤖 While you were away (${when}) your agents earned +${fmt(gain)} ✦`)
    }
    await update($, save, () => s)
    await persist($)

    let ticks = 0
    $.clock.every(1000, async () => {
      ticks++
      playedAcc += 1000
      dirty = true
      const t = await $.clock.now()
      const md = await read($, mood)
      if (md === 'oops' && t > oopsUntil) await setMood($, 'idle')
      else if (md === 'idle' && lastActivity && t - lastActivity > SLEEP_AFTER_MS) await setMood($, 'sleep')
      const cur = await read($, save)
      const rate = dps(cur, t)
      if (rate > 0) {
        pending += rate
        // Redraw only every few seconds (or when a frenzy ends).
        const frenzyJustEnded = cur.frenzyUntil && t >= cur.frenzyUntil && t - cur.frenzyUntil < 1000
        if (ticks % 5 === 0 || frenzyJustEnded) {
          const gain = pending
          pending = 0
          await commit($, earn(cur, gain))
        }
      }
      if (dirty && ticks % 15 === 0) await persist($)
    })

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await prompt($, 'free').catch(() => {})
    await touch($, 'working').catch(() => {})
    const res = await next(e)
    if (res && typeof res === 'object' && 'is_error' in res && (res as { is_error?: boolean }).is_error) {
      oopsUntil = (await $.clock.now()) + 4000
      await setMood($, 'oops').catch(() => {})
    }
    return res
  })

  on('prompt.submit', async ($, e, next) => {
    await touch($, 'working')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.isAborted && e.reason !== 'error') await frenzy($)
    if (e.reason === 'error') {
      oopsUntil = (await $.clock.now()) + 4000
      await touch($, 'oops')
    } else await touch($, 'idle')
    await persist($)
    return next(e)
  })

  on('command.run', { command: 'idle' }, async $ => {
    await update($, isHidden, () => false)
    const opened = await $.ui.open({ id: PANE, title: 'Token Tycoon' })
    const s = await read($, save)
    const now = await $.clock.now()
    return {
      text: [opened.isPlaced ? 'Shop opened.' : 'Shop pane needs a wider window; here is where you stand:', ...summary(s, now)].join('\n'),
    }
  })

  on('ui.press', { plugin: 'token-tycoon', element: 'prompt' }, async $ => {
    await prompt($, 'click')
    if ((await read($, mood)) === 'sleep') await touch($, 'idle')
    else lastActivity = await $.clock.now()
    return { element: 'prompt' }
  })
  on('ui.press', { plugin: 'token-tycoon', element: 'shop' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Token Tycoon' })
    return { element: 'shop' }
  })
  on('ui.press', { plugin: 'token-tycoon', element: 'hide' }, async $ => {
    await update($, isHidden, () => true)
    return { element: 'hide' }
  })
  on('ui.press', { plugin: 'token-tycoon', element: 'buy-agent' }, async $ => {
    await buyGen($, 'agent')
    return { element: 'buy-agent' }
  })
  on('ui.press', { plugin: 'token-tycoon', element: 'buy-subagent' }, async $ => {
    await buyGen($, 'subagent')
    return { element: 'buy-subagent' }
  })
  on('ui.press', { plugin: 'token-tycoon', element: 'buy-robot' }, async $ => {
    await buyGen($, 'robot')
    return { element: 'buy-robot' }
  })
  on('ui.press', { plugin: 'token-tycoon', element: 'buy-swarm' }, async $ => {
    await buyGen($, 'swarm')
    return { element: 'buy-swarm' }
  })
  on('ui.press', { plugin: 'token-tycoon', element: 'buy-fleet' }, async $ => {
    await buyGen($, 'fleet')
    return { element: 'buy-fleet' }
  })
  on('ui.press', { plugin: 'token-tycoon', element: 'buy-lab' }, async $ => {
    await buyGen($, 'lab')
    return { element: 'buy-lab' }
  })
  on('ui.press', { plugin: 'token-tycoon', element: 'buy-model' }, async $ => {
    await buyTier($, 'model')
    return { element: 'buy-model' }
  })
  on('ui.press', { plugin: 'token-tycoon', element: 'buy-infra' }, async $ => {
    await buyTier($, 'infra')
    return { element: 'buy-infra' }
  })
  on('ui.press', { plugin: 'token-tycoon', element: 'buy-read' }, async $ => {
    await buyTool($, 'read')
    return { element: 'buy-read' }
  })
  on('ui.press', { plugin: 'token-tycoon', element: 'buy-edit' }, async $ => {
    await buyTool($, 'edit')
    return { element: 'buy-edit' }
  })
  on('ui.press', { plugin: 'token-tycoon', element: 'buy-bash' }, async $ => {
    await buyTool($, 'bash')
    return { element: 'buy-bash' }
  })
  on('ui.press', { plugin: 'token-tycoon', element: 'buy-grep' }, async $ => {
    await buyTool($, 'grep')
    return { element: 'buy-grep' }
  })
  on('ui.press', { plugin: 'token-tycoon', element: 'buy-web' }, async $ => {
    await buyTool($, 'web')
    return { element: 'buy-web' }
  })
  on('ui.press', { plugin: 'token-tycoon', element: 'train' }, async $ => {
    await train($)
    return { element: 'train' }
  })
  on('ui.press', { plugin: 'token-tycoon', element: 'popups' }, async $ => {
    await update($, prefs, p => ({ ...p, popups: !p.popups }))
    await $.store.set('prefs', await read($, prefs))
    return { element: 'popups' }
  })

  // ── The band above the prompt ──
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)
    const { Box, Text, Button, Raster, Svg } = $.ui.resolve(e) as any
    const now = await $.clock.now()
    const s = await read($, save)
    const f = await read($, fx)
    const md: Mood = e.props.isWorking && (await read($, mood)) !== 'sleep' ? 'working' : await read($, mood)
    const columns = e.viewport?.columns ?? 80
    const narrow = columns < 70
    const frenzyLeft = isFrenzy(s, now) ? Math.ceil((s.frenzyUntil - now) / 1000) : 0
    const next_ = savingFor(s)
    const buyable = canBuy(s)

    const art =
      e.surface === 'terminal' ? (
        <Raster key="scene" columns={CELL_W} rows={SCENE_ROWS} cells={sceneCells(s, f, now)} />
      ) : (
        <Box flexDirection="row" flexShrink={0}>
          <Svg source={botSvg(frenzyLeft > 0 && md !== 'sleep' ? 'frenzy' : md)} alt={`the coder, ${md}`} width={BOT_W} height={SCENE_PX_H} isInteractive />
          <Svg source={blockSvg(s, f, now)} alt={`${fmt(s.tokens)} tokens`} width={BLOCK_W} height={SCENE_PX_H} isInteractive />
        </Box>
      )
    const COL = narrow ? 9 : 12
    const col = (icon: string, value: string, label: string, color?: string) => (
      <Box width={COL} flexShrink={0}>
        <Text wrap="truncate">
          <Text color={color} bold={color === 'yellow'}>{`${icon}${value}`}</Text>
          <Text dimColor>{label}</Text>
        </Text>
      </Box>
    )

    return (
      <Box flexDirection="column" paddingX={1} rowGap={1}>
        <Box flexDirection="row" alignItems="center" columnGap={3}>
          {art}
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">
              <Text color="yellow" bold>{`✦ ${fmt(s.tokens)}`}</Text>
              <Text dimColor>{' tokens'}</Text>
            </Text>
            <Box flexDirection="row">
              {col('+', fmt(dps(s, now)), '/sec', 'green')}
              {col('⚡ ', fmt(clickGain(s)), '/prompt')}
              {frenzyLeft > 0 && col('🔥 ', `×${FRENZY_MULT}`, ` ${frenzyLeft}s`, 'red')}
            </Box>
            <Text wrap="truncate-end" dimColor>
              {frenzyLeft > 0
                ? `frenzy! every agent earns ×${FRENZY_MULT}`
                : buyable
                  ? `you can buy: ${buyable.label} (${fmt(buyable.cost)} ✦)`
                  : next_
                    ? `saving for: ${next_.label} (${fmt(next_.cost)} ✦)`
                    : 'you own the whole shop'}
            </Text>
          </Box>
          <Box flexShrink={0} alignSelf="flex-start">
            <Button key="hide" label="hide" plain dimColor onPress={ignorePress} />
          </Box>
        </Box>
        <Box flexDirection="row" justifyContent="space-between">
          <Button key="prompt" label="Prompt ⚡" variant="primary" hotkey="p" onPress={ignorePress} />
          <Button key="shop" label="Shop 🛒" onPress={ignorePress} />
        </Box>
      </Box>
    )
  })

  // ── The shop pane ──
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e) as any
    const s = await read($, save)
    const p = await read($, prefs)
    const now = await $.clock.now()
    const nextModel = nextTier(MODELS, s.model)
    const nextInfra = nextTier(INFRA, s.infra)
    const pts = pointsFor(s.earned)
    const nextPointAt = POINT_EVERY * (pts + 1) * (pts + 1)
    const frenzyLeft = isFrenzy(s, now) ? Math.ceil((s.frenzyUntil - now) / 1000) : 0

    const section = (title: string, children: any) => (
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold>{title}</Text>
        {children}
      </Box>
    )
    // Affordable: a button and a yellow price. Not yet: plain dim text, no
    // button at all, so nothing lights up under the pointer.
    const row = (key: string, label: string, hotkey: string, cost: number, detail: string) => {
      const can = s.tokens >= cost
      return (
        <Box flexDirection="column" paddingBottom={1}>
          {can ? (
            <Box flexDirection="row" columnGap={2} alignItems="center">
              <Button key={key} label={label} hotkey={hotkey} onPress={ignorePress} />
              <Text color="yellow" bold>{`${fmt(cost)} ✦`}</Text>
            </Box>
          ) : (
            <Text dimColor>{`  ${label}   ${fmt(cost)} ✦`}</Text>
          )}
          <Text dimColor wrap="wrap">{`  ${detail}`}</Text>
        </Box>
      )
    }
    const owned = (label: string, detail: string) => (
      <Box flexDirection="column" paddingBottom={1}>
        <Text color="green">{`✓ ${label}`}<Text dimColor>{'  owned'}</Text></Text>
        <Text dimColor wrap="wrap">{`  ${detail}`}</Text>
      </Box>
    )
    const stat = (icon: string, value: string, label: string, color?: string) => (
      <Box flexDirection="column" flexGrow={1}>
        <Text>
          <Text color={color} bold>{`${icon} ${value}`}</Text>
        </Text>
        <Text dimColor>{label}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column" paddingX={1} rowGap={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" columnGap={2}>
            {stat('✦', fmt(s.tokens), 'tokens', 'yellow')}
            {stat('▲', fmt(dps(s, now)), '/sec', 'green')}
            {stat('⚡', fmt(clickGain(s)), '/prompt')}
            {stat('✧', `${Math.round(critChance(s) * 100)}%`, `crit ×${CRIT_MULT}`)}
          </Box>
          {frenzyLeft > 0 && <Text color="red">{`🔥 Frenzy: agents ×${FRENZY_MULT} for ${frenzyLeft}s more`}</Text>}
          <Box paddingTop={1}>
            <Button key="prompt" label="Prompt ⚡" variant="primary" hotkey="p" onPress={ignorePress} />
          </Box>
        </Box>

        {section('Agents', GENS.map(g => {
          const n = s.owned[g.id] ?? 0
          const nm = nextMilestone(n)
          const each = `+${fmt(genRate(s, g))}/sec each`
          const total = n ? ` · ${fmt(genRate(s, g) * n)}/sec from ${n}` : ''
          return row(`buy-${g.id}`, n ? `${g.label} ×${n}` : g.label, g.hotkey, genCost(g, n), `${each}${total}${nm ? ` · ×2 at ${nm}` : ''}`)
        }))}

        {section('Upgrades', [
          nextModel
            ? row('buy-model', `Model → ${nextModel.label}`, 'm', nextModel.cost, `prompts ×${nextModel.mult} (now ×${modelAt(s.model).mult})`)
            : owned(`Model: ${modelAt(s.model).label}`, `prompts ×${modelAt(s.model).mult}, the best there is`),
          nextInfra
            ? row('buy-infra', `Infra → ${nextInfra.label}`, 'i', nextInfra.cost, `agents ×${nextInfra.mult} (now ×${infraAt(s.infra).mult})`)
            : owned(`Infra: ${infraAt(s.infra).label}`, `agents ×${infraAt(s.infra).mult}, the best there is`),
        ])}

        {section('Tools', TOOLS.map(t => (s.tools[t.id] ? owned(t.label, t.desc) : row(`buy-${t.id}`, t.label, t.hotkey, t.cost, t.desc))))}

        {section('Train a new model', [
          pts >= 1 ? (
            <Box flexDirection="row" columnGap={2} alignItems="center">
              <Button key="train" label={`Train (+${pts})`} hotkey="t" variant="primary" onPress={ignorePress} />
              <Text dimColor wrap="wrap">{`reset run · ×${prestigeMult(s.points + pts)} forever`}</Text>
            </Box>
          ) : (
            <Text dimColor wrap="wrap">{`${fmt(s.earned)} / ${fmt(nextPointAt)} ✦ this run`}</Text>
          ),
          <Text dimColor>{`${s.trained} trained · ${s.points} pts · ×${prestigeMult(s.points)}`}</Text>,
        ])}

        {section('Stats', [
          <Box flexDirection="row" columnGap={2}>
            {stat('✦', fmt(s.lifetime), 'gathered', 'yellow')}
            {stat('◷', fmtTime((s.played ?? 0) + playedAcc), 'played')}
            {stat('⚡', fmt(s.clicks), 'prompts')}
            {stat('🔥', String(s.frenzies ?? 0), 'frenzies')}
          </Box>,
          <Text dimColor wrap="wrap">{`${fmt(s.bonusHits)} free prompts from real tool calls · a finished turn starts a frenzy · agents keep earning while you're away (½ pace, ${OFFLINE_CAP_H * (s.tools.web ? 2 : 1)}h max)`}</Text>,
          <Box paddingTop={1}>
            <Button key="popups" label={`Popups: ${p.popups ? 'On' : 'Off'}`} onPress={ignorePress} />
          </Box>,
        ])}
      </Box>
    )
  })
}
