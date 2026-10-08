import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Activity, Cat, Coat, Hat, Identity, Limits, Marking, Mood, Motion, Prefs, Scene, Speed, Stats, ToolProp } from '../types'

// ── State ────────────────────────────────────────────────────────────────
// The hooks only write state when something changes (a mood, a line, a new
// leg of the walk). The frames in between are drawn by the surfaces: the
// desktop SVG animates itself, and the terminal lane is repainted in place.

const cat = atom({ plugin: 'pixel-cat', key: 'cat' } as const, {
  mood: 'idle',
  dir: 1,
  say: 'hi!',
  sayAt: 0,
} as Cat)
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
const DEFAULT_PREFS: Prefs = { coat: 'orange', speed: 'normal', scene: 'clear', popups: true, showUsage: true, hat: 'none' }
const prefs = atom({ plugin: 'pixel-cat', key: 'prefs' } as const, {
  coat: 'orange',
  speed: 'normal',
  scene: 'clear',
  popups: true,
  showUsage: true,
  hat: 'none',
} as Prefs)
const isSettingsOpen = atom({ plugin: 'pixel-cat', key: 'isSettingsOpen' } as const, false)
const identity = atom({ plugin: 'pixel-cat', key: 'identity' } as const, { marking: 'none', shiny: false } as Identity)
const stats = atom({ plugin: 'pixel-cat', key: 'stats' } as const, { turns: 0, tools: 0 } as Stats)

const COATS: Coat[] = ['orange', 'tuxedo', 'black', 'grey', 'cream', 'sakura']
const SPEEDS: Speed[] = ['chill', 'normal', 'zoomies']

const BRAIN_MS = 1000 // how often the cat decides what to do next
const BLIT_MS = 100 // terminal repaint rate
const NAP_AFTER_MS = 5 * 60_000
const ANNOUNCE_AFTER_S = 20

// Lane speed in lane-widths per second.
const PACE: Record<Speed, number> = { chill: 0.03, normal: 0.06, zoomies: 0.18 }
const RUN_PACE: Record<Speed, number> = { chill: 0.12, normal: 0.2, zoomies: 0.35 }
const TIRED_PACE = 0.025

// How often each idle activity comes up (relative weights).
// Mostly calm (strolling, sitting, grooming, napping), with play now and then.
const IDLE_ACTIVITIES: [Activity, number][] = [
  ['walk', 18], ['sit', 22], ['groom', 16], ['nap', 14],
  ['hop', 4], ['yarn', 5], ['mouse', 5], ['butterfly', 5], ['fish', 5], ['bird', 4], ['laser', 3],
  ['knock', 4], ['meter', 3],
]
// Late at night it mostly naps.
const NIGHT_ACTIVITIES: [Activity, number][] = [['walk', 10], ['sit', 20], ['groom', 15], ['nap', 50], ['meter', 5]]
const TIRED_ACTIVITIES: [Activity, number][] = [['walk', 20], ['sit', 25], ['groom', 10], ['nap', 45]]

function pick(options: [Activity, number][]): Activity {
  let roll = Math.random() * options.reduce((sum, [, w]) => sum + w, 0)
  for (const [a, w] of options) {
    roll -= w
    if (roll <= 0) return a
  }
  return options[0][0]
}

const LINES: Partial<Record<Activity, string[]>> = {
  yarn: ['yarn!!', 'mine!', 'boing'],
  mouse: ['a mouse!', 'get back here', 'hunting…'],
  butterfly: ['ooh', 'pretty…', 'hi butterfly'],
  hop: ['wheee', 'boing boing'],
  groom: ['*lick lick*', 'grooming…', 'must look good'],
  fish: ['fishing…', 'fishy fishy', 'shh, fish'],
  bird: ['shhh…', 'birb.', 'stalking…'],
  laser: ['THE DOT', 'red dot!!', 'gotta get it'],
  caught: ['got it!', 'gotcha!'],
  flyaway: ['nom?!', 'nom nom'],
  knock: ['ooh, a mug', "what's this…"],
  shove: ['*tap*', '*tap tap*'],
  meter: ['brb', 'one sec'],
  sitmeter: ['this spot is warm', 'mine now', 'comfy'],
}

// Activities that happen on the spot, and how long they last (ms).
function stillFor(a: Activity): number | null {
  if (a === 'sit') return 3000 + Math.random() * 5000
  if (a === 'groom') return 4000 + Math.random() * 3000
  if (a === 'nap') return 15_000 + Math.random() * 30_000
  if (a === 'fish') return 7000 + Math.random() * 4000
  if (a === 'caught' || a === 'flyaway') return 3000
  if (a === 'shove') return 3600
  if (a === 'sitmeter') return 8000 + Math.random() * 6000
  return null
}

// Activities with a toy or critter ahead of the cat.
const WITH_COMPANION = new Set<Activity | undefined>(['yarn', 'mouse', 'butterfly', 'bird', 'laser', 'fish', 'caught', 'flyaway', 'busy', 'knock', 'shove'])

// What the cat works with for each kind of tool Claude runs.
function toolProp(name: string): ToolProp | null {
  if (/^(Read|NotebookRead)$/.test(name)) return 'read'
  if (/Edit|Write/.test(name)) return 'edit'
  if (/^(Bash|BashOutput|Shell|PowerShell)$/.test(name)) return 'bash'
  if (/Grep|Glob|Search|Web|Fetch|^LS$/i.test(name)) return 'search'
  return null
}

// Hats, and what unlocks them.
const HATS: { hat: Hat; label: string; need: (s: Stats) => boolean; hint: string }[] = [
  { hat: 'party', label: 'Party hat', need: s => s.turns >= 10, hint: '10 finished tasks' },
  { hat: 'beanie', label: 'Beanie', need: s => s.tools >= 100, hint: '100 tool calls' },
  { hat: 'crown', label: 'Crown', need: s => s.turns >= 150, hint: '150 finished tasks' },
  { hat: 'wizard', label: 'Wizard hat', need: s => s.tools >= 500, hint: '500 tool calls' },
]
function unlockedHats(s: Stats): Hat[] {
  return HATS.filter(h => h.need(s)).map(h => h.hat)
}

const MARKINGS: Marking[] = ['none', 'blaze', 'socks', 'tip', 'spot']

function cycle<T>(list: T[], v: T): T {
  return list[(list.indexOf(v) + 1) % list.length]
}

function title(w: string): string {
  return w[0].toUpperCase() + w.slice(1)
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function posAt(m: Motion, now: number): number {
  if (m.dur <= 0) return m.to
  return m.from + (m.to - m.from) * clamp01((now - m.t0) / m.dur)
}

function isWalking(m: Motion, now: number): boolean {
  return m.from !== m.to && now < m.t0 + m.dur
}

// ── Sprites ──────────────────────────────────────────────────────────────
// Chibi pixel sprites, 12x10, facing left.
// o fur, d shade, H eye shine, K eye, r blush, n nose, w chest.
const HEAD = [
  '.o.....o....',
  '.oo...oo....',
  'ooooooooo...',
  'oHKoooHKo...',
  'oKKoooKKo...',
  'rooonooor...',
]
const WALK_A = [...HEAD, '.ooooooo...d', '..owwwooo.d.', '..oooooooo..', '..oo...oo...']
const WALK_B = [...HEAD, '.ooooooo...d', '..owwwooo.d.', '..oooooooo..', '...oo.oo....']
const SIT = [...HEAD, '.ooooooo....', '.owwwooo.d..', '.oowwooood..', '..oo..oo....']
const SIT_WAG = [...HEAD, '.ooooooo..d.', '.owwwooo.d..', '.oowwooood..', '..oo..oo....']
// Grooming: eyes shut, a paw up at the mouth, the tongue flicking out.
const GROOM_A = closeEyes(SIT).map((r, y) => (y === 5 ? 'wwoonooor...' : y === 6 ? 'wooooooo....' : r))
const GROOM_B = GROOM_A.map((r, y) => (y === 5 ? 'wnoonooor...' : r))
// Markings and hats, drawn into every sprite so each pose wears them.
// Hats sit between the ears, in rows padded on above the sprite.
const HAT_PAD = 4
const HAT_ROWS: Record<Exclude<Hat, 'none'>, string[]> = {
  party: ['.Z.', '.P.', 'PQP', 'QPQ'],
  beanie: ['..Z..', '.UUU.', 'UVUVU'],
  wizard: ['..X..', '.XYX.', '.XXX.', 'XXXXX'],
  crown: ['Y.Y.Y', 'YYYYY'],
}
const HAT_PAL: Palette = { P: 0xff6fae, Q: 0xffc2dc, Z: 0xffd54a, U: 0x4a7fd6, V: 0x8fb3ee, X: 0x7a4fd6, Y: 0xf5c542 }

function setAt(row: string, x: number, ch: string): string {
  return x < 0 || x >= row.length ? row : row.slice(0, x) + ch + row.slice(x + 1)
}

function mark(rows: string[], m: Marking): string[] {
  const out = [...rows]
  if (m === 'blaze') {
    const y = out.findIndex(r => r.includes('ooooooooo'))
    if (y >= 0) out[y] = setAt(out[y], 4, 'w')
  } else if (m === 'socks') {
    const y = out.length - 1
    out[y] = out[y].replace('oo', 'ww')
  } else if (m === 'tip') {
    const y = out.findIndex(r => r.lastIndexOf('d') >= 9)
    if (y >= 0) out[y] = setAt(out[y], out[y].lastIndexOf('d'), 'w')
  } else if (m === 'spot') {
    const y = out.findIndex((r, i) => i > 0 && !r.includes('K') && r.includes('w'))
    if (y >= 0 && out[y][6] === 'o') out[y] = setAt(out[y], 6, 'd')
  }
  return out
}

// A sprite with its marking and hat, padded HAT_PAD rows on top (draw it
// HAT_PAD rows higher). Facing left, before any flip.
function dress(rows: string[], m: Marking, hat: Hat): string[] {
  const out = [...Array(HAT_PAD).fill('.'.repeat(SPRITE_W)), ...mark(rows, m)]
  if (hat === 'none') return out
  const h = HAT_ROWS[hat]
  const ears = rows.findIndex(r => r.includes('o'))
  const bottom = HAT_PAD + ears + 1
  const x0 = 4 - Math.floor(h[0].length / 2)
  h.forEach((line, i) => {
    const y = bottom - (h.length - 1) + i
    for (let x = 0; x < line.length; x++) if (line[x] !== '.') out[y] = setAt(out[y], x0 + x, line[x])
  })
  return out
}

// One front paw reaching out (for fishing and pinning a mouse).
const SIT_PAW = [...HEAD, '.ooooooo....', 'oowwwooo.d..', '.oowwooood..', '......oo....']
const LOAF = [
  '............',
  '............',
  '............',
  '............',
  '.o.....o....',
  '.oo...oo....',
  'oooooooooo..',
  'oddoooddoooo',
  'rooonooroood',
  '.oooooooooo.',
]
const SPRITE_W = 12

// Closed eyes: the top eye row becomes fur, the bottom a dark lash line.
function closeEyes(rows: string[]): string[] {
  return rows.map(r => (r.includes('H') ? r.replace(/[HK]/g, 'o') : r.replace(/K/g, 'd')))
}

function faceRight(rows: string[]): string[] {
  return rows.map(r => [...r].reverse().join(''))
}

function isHappy(mood: Mood): boolean {
  return mood === 'done' || mood === 'pet' || mood === 'tired'
}

type Palette = Record<string, number>
const BASE: Palette = { H: 0xffffff, K: 0x1f1e1d, r: 0xf4a4a0, n: 0xe8737a, w: 0xfbefe4 }
export const PALETTES: Record<Coat, Palette> = {
  orange: { ...BASE, o: 0xd97757, d: 0x9e4f36 }, // Claude orange
  tuxedo: { ...BASE, o: 0x2e2e33, d: 0x141416, K: 0xb8d86a, w: 0xf7f7f7 },
  black: { ...BASE, o: 0x1f1f24, d: 0x050506, K: 0xf2c94c, w: 0x3a3a42, r: 0x8a4a55 },
  grey: { ...BASE, o: 0x9aa0a6, d: 0x5f6368, w: 0xeceff1 },
  cream: { ...BASE, o: 0xf1d6a8, d: 0xc49a5e },
  sakura: { ...BASE, o: 0xf6b8c8, d: 0xd4869c, n: 0xd9566b },
}

const MOOD_COLOR: Partial<Record<Mood, number>> = {
  done: 0x3fb950,
  oops: 0xf85149,
  tired: 0xd29922,
  pet: 0xdb61a2,
  working: 0x39c5cf,
}
const QUIET_COLOR = 0x8b949e

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')

// ── Companions ───────────────────────────────────────────────────────────
// y yarn, Y yarn shine, g mouse, t mouse tail, B wings, k body. Facing left.
const YARN = ['.yyy.', 'yYyyy', 'yyYyy', 'yyyYy', '.yyy.']
const MOUSE_A = ['.gg....', 'gKgggg.', '.gggggt', '..g.g..']
const MOUSE_B = ['.gg....', 'gKgggg.', '.gggggt', '.g...g.']
const FLY_OPEN = ['BB.BB', 'BBkBB', '.BkB.']
const FLY_SHUT = ['.BkB.', '.BkB.', '..k..']
// b bird, p beak, q legs; f fish, F fin.
const BIRD = ['.bb..', 'pbbbb', '.bbb.', '..q..']
const BIRD_PECK = ['.....', '.bb..', 'pbbbb', '.bbq.']
const BIRD_UP = ['.b.b.', 'pbbbb', '..bb.', '.....']
const BIRD_DOWN = ['.....', 'pbbbb', 'bb.bb', '.....']
const FISH = ['fffF', '.ffF']

// Props: a book, a laptop, a terminal, a magnifying glass; a table and a mug.
const TOOL_ROWS: Record<ToolProp, string[]> = {
  read: ['.wwcww.', 'wwwcwww', 'wwwcwww', 'ccccccc'],
  edit: ['kkkkk..', 'ksssk..', 'ksssk..', 'kkkkk..', 'ggggggg'],
  bash: ['kkkkkk', 'kGkkkk', 'kkGkkk', 'kGkGGk', 'kkkkkk', '..gg..'],
  search: ['.ggg..', 'gWWWg.', 'gWWWg.', '.ggg..', '....h.', '.....h'],
}
const TABLE = ['TTTTTTT', 't.....t', 't.....t', 't.....t']
const MUG = ['MMM.', 'MMMm', 'MMM.']
const PROP_COLORS: Palette = {
  k: 0x2b2b33, s: 0x6fb3ff, g: 0xb0b6bf, G: 0x3fb950, w: 0xf5f0e6, c: 0xb5523b, W: 0xcfe8f3, h: 0x8a5a3c,
  T: 0x9a6b47, t: 0x7a5234, M: 0xe8e4da, m: 0xc9c3b5,
}
// The food bowl shows how much context is left: full when fresh, empty near the limit.
const BOWL_PAL: Palette = { F: 0xd39a5b, f: 0xa86a35, B: 0xd9534f, b: 0xa83a37 }
function bowlRows(ctx: number): string[] {
  const n = Math.round(12 * clamp01(1 - ctx / 100))
  const low = Math.min(6, n)
  const high = Math.max(0, n - 6)
  const fill = (k: number, ch: string) => '.' + ch.repeat(k).padEnd(6, '.') + '.'
  return [fill(high, 'F'), fill(low, 'f'), 'BBBBBBBB', '.bbbbbb.']
}
const TOYS: Palette = {
  b: 0x9c7a5b,
  p: 0xf2b544,
  q: 0x5d4037,
  f: 0xf2994a,
  F: 0xf7c59f,
  y: 0xe0566b,
  Y: 0xf5a3ae,
  g: 0xa7adb4,
  K: 0x1f1e1d,
  t: 0xf4a4a0,
  B: 0x8f8cf2,
  k: 0x2b2840,
}

// Fishing spots: G glass, W water, w ripple, s sand, P plant, k stand.
type Prop = { rows: string[]; swim?: [number, number, number] } // fish x range and row
const PROPS: Record<'bowl' | 'tank' | 'river', Prop> = {
  bowl: { rows: ['.G....G.', 'G......G', 'GWWWWWWG', 'GWWWWWWG', 'GWWWWWWG', '.GWWWWG.', '..GGGG..'], swim: [1, 3, 3] },
  tank: {
    rows: ['GGGGGGGGGG', 'G........G', 'GWWWWWWWWG', 'GWWWWWWWWG', 'GWWWWWWPWG', 'GWWWWWPWWG', 'GssssssPsG', 'kkkkkkkkkk'],
    swim: [1, 5, 3],
  },
  river: { rows: ['..WwWWWWWwWW..', '.WWWWWwWWWWWW.', 'WWWWWWWWWWWWWW'] },
}
const PROP_PAL: Palette = { G: 0xcfe8f3, W: 0x3f8fd6, w: 0x9fd0f5, s: 0xe3c78a, P: 0x4caf50, k: 0x5a4a3f }
const SCENE_PROP: Record<Scene, keyof typeof PROPS> = { clear: 'bowl', cozy: 'tank', grass: 'river', night: 'river' }

// Where the cat sleeps, by scene. Hidden until bedtime, when it slides in
// from the left; `float` lifts it off the ground (the night cloud).
type Perch = { rows: string[]; pal: Palette; float: number }
const PERCHES: Record<Scene, Perch> = {
  clear: {
    rows: ['.cccccccccccccc.', 'cCCCCCCCCCCCCCCc', 'cccccccccccccccc', '.cccccccccccccc.'],
    pal: { c: 0x6f63c9, C: 0xb3a9f0 },
    float: 0,
  },
  grass: {
    rows: ['.SSSSSSSSSS.', 'TTTTTTTTTTTT', '.TTtTTTTtTT.', '.TTTTtTTTTT.', 'TTTTTTTTTTTT'],
    pal: { S: 0xc79a6b, T: 0x7a5234, t: 0x5b3a22 },
    float: 0,
  },
  night: {
    rows: ['...LLL....LL....', '.LLLLLLLLLLLLL..', 'LLLLLLLLLLLLLLLL', '.llllllllllllll.'],
    pal: { L: 0xe6e9f7, l: 0xaab1cf },
    float: 5,
  },
  cozy: {
    rows: ['PPPPPPPPPPPPPP', 'pppppppppppppp', '.....RRRR.....', '.....RrRR.....', '.....RRrR.....', '..pppppppppp..'],
    pal: { P: 0xc9876b, p: 0x9a5f49, R: 0xd9c08f, r: 0xb39a6a },
    float: 0,
  },
}
const SLIDE_MS = 700

function isOnPerch(c: Cat, m: Motion): boolean {
  return c.mood === 'sleep' && m.activity === 'perch'
}

// How far the perch has slid in (1) or out (0), or null when it's away.
function perchShown(c: Cat, m: Motion, now: number): number | null {
  if (c.mood === 'sleep' && m.activity === 'bed') return clamp01((now - m.t0) / SLIDE_MS)
  if (isOnPerch(c, m)) return 1
  if (c.mood !== 'sleep' && c.wokeAt !== undefined && now - c.wokeAt < SLIDE_MS) return 1 - clamp01((now - c.wokeAt) / SLIDE_MS)
  return null
}

function posture(c: Cat, m: Motion, now: number): 'walk' | 'sit' | 'loaf' {
  if (c.mood === 'sleep') return isWalking(m, now) ? 'walk' : 'loaf'
  if (isWalking(m, now)) return 'walk'
  return m.activity === 'nap' && now < m.t0 + m.dur ? 'loaf' : 'sit'
}

// ── Scenes ───────────────────────────────────────────────────────────────

const SCENES: Scene[] = ['clear', 'grass', 'night', 'cozy']
// Terminal: one background colour behind the lane's cells.
const SCENE_BG: Record<Scene, number> = { clear: 0x01000000, grass: 0x14301c, night: 0x10162a, cozy: 0x33261f }

// Desktop: a backdrop drawn behind the cat, in percent so it fills any width.
// Time of day: a tint over the sky, by local hour.
function skyAt(hour: number): { color: string; tint: number; isNight: boolean } {
  if (hour >= 21 || hour < 5) return { color: '#1b2547', tint: 0.45, isNight: true }
  if (hour < 7) return { color: '#f6b4a5', tint: 0.14, isNight: false }
  if (hour >= 18) return { color: '#f39a5b', tint: 0.14, isNight: false }
  return { color: '#9fd3ff', tint: 0, isNight: false }
}

function starsSvg(spots: number[][], opacity: number): string {
  return spots
    .map(([p, y], i) => `<circle cx="${p}%" cy="${y}" r="0.9" fill="#e8e6ff" opacity="${opacity}"><animate attributeName="opacity" values="${opacity};0.15;${opacity}" dur="${2 + (i % 3)}s" begin="${i * 0.37}s" repeatCount="indefinite"/></circle>`)
    .join('')
}

export type Extras = { ctx?: number | null; identity?: Identity; hat?: Hat; hour?: number }

function sceneSvg(scene: Scene, hour = 12): string {
  const H = LANE_H
  const sky = skyAt(hour)
  if (scene === 'clear') return sky.isNight ? starsSvg([[12, 6], [38, 10], [63, 5], [88, 9]], 0.5) : ''
  if (scene === 'grass') {
    const tint = sky.tint ? `<rect x="0" y="0" width="100%" height="${H}" rx="6" fill="${sky.color}" opacity="${sky.tint}"/>` : ''
    const stars = sky.isNight ? starsSvg([[8, 6], [27, 12], [46, 5], [70, 9], [91, 6]], 0.8) : ''
    const tufts = [6, 19, 33, 47, 61, 74, 88]
      .map(p => `<svg x="${p}%" y="${H - 11}" overflow="visible"><path d="M0 6 l2 -5 l1 5 l2 -6 l1 6" fill="none" stroke="#4f9a5a" stroke-width="1.2"/></svg>`)
      .join('')
    return `${tint}${stars}<rect x="0" y="${H - 5}" width="100%" height="5" rx="2" fill="#2f6b3a"/>${tufts}`
  }
  if (scene === 'night') {
    const stars = [[4, 6], [13, 18], [22, 5], [37, 11], [51, 4], [63, 16], [71, 7], [83, 13], [95, 5]]
      .map(([p, y], i) => `<circle cx="${p}%" cy="${y}" r="0.9" fill="#e8e6ff"><animate attributeName="opacity" values="1;0.2;1" dur="${2 + (i % 3)}s" begin="${i * 0.37}s" repeatCount="indefinite"/></circle>`)
      .join('')
    return `<rect x="0" y="0" width="100%" height="${H}" rx="6" fill="#141a2e"/>${stars}<circle cx="92%" cy="9" r="5" fill="#f2e9c9"/><circle cx="91%" cy="8" r="5" fill="#141a2e" transform="translate(-3 -1)"/>`
  }
  if (scene === 'cozy') {
    // A window showing the sky outside, with the moon at night.
    const moon = sky.isNight ? '<circle cx="18" cy="7" r="2.5" fill="#f2e9c9"/>' : ''
    const window = `<svg x="28%" y="6" overflow="visible"><rect width="26" height="15" rx="2" fill="${sky.color}" stroke="#5a4334" stroke-width="2"/><line x1="13" y1="0" x2="13" y2="15" stroke="#5a4334" stroke-width="1.5"/>${moon}</svg>`
    return `<rect x="0" y="0" width="100%" height="${H}" rx="6" fill="#3a2c24"/>${window}<rect x="0" y="${H - 4}" width="100%" height="4" fill="#5a4334"/><rect x="70%" y="${H - 7}" width="18%" height="3" rx="1.5" fill="#a2554a" opacity="0.8"/>`
  }
  return ''
}

// ── Desktop: one self-animating SVG for the whole lane ──────────────────

const PX = 3 // CSS pixels per sprite pixel
const CAT_W = SPRITE_W * PX // 36
const CAT_H = 30
// Room above the cat so hops and bounces don't clip its head.
const HEADROOM = 12
const LANE_H = CAT_H + HEADROOM
// The desktop reports its width in monospace columns; the SVG wants pixels.
const DESKTOP_PX_PER_COLUMN = 8.4
const MAX_X = 85 // the cat's left edge travels 0%..85% of the lane
const PERCH_X = 4

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// One rect per horizontal run of a colour; with `except`, only the pixels
// that differ from it (an overlay).
function rects(rows: string[], pal: Palette, except?: string[], px = PX): string {
  if (except) rows = rows.map((r, y) => [...r].map((ch, x) => (except[y][x] === ch ? '.' : ch)).join(''))
  const out: string[] = []
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]
      let run = 1
      while (row[x + run] === ch) run++
      if (pal[ch] !== undefined) {
        out.push(`<rect x="${x * px}" y="${y * px}" width="${run * px}" height="${px}" fill="${hex(pal[ch])}"/>`)
      }
      x += run
    }
  })
  return out.join('')
}

// Flips between two frames: the first shown for the first half of each period.
function frames(a: string, b: string, period: number, until?: number): string {
  const repeat = until !== undefined ? `repeatDur="${Math.max(1, Math.round(until))}ms"` : 'repeatCount="indefinite"'
  const anim = (v: string) => `<animate attributeName="opacity" values="${v}" dur="${period}s" calcMode="discrete" ${repeat}/>`
  return `<g>${a}${anim('1;0')}</g><g opacity="0">${b}${anim('0;1')}</g>`
}

function bubbleSvg(c: Cat, onLeft: boolean, tint: number): string {
  if (!c.say) return ''
  const raw = c.say.length > 28 ? c.say.slice(0, 27) + '…' : c.say
  const hasDots = raw.endsWith('…')
  const text = hasDots ? raw.slice(0, -1) : raw
  const sparkle = c.mood === 'done'
  const chars = text.length + (hasDots ? 3 : 0) + (sparkle ? 2 : 0)
  const w = Math.round(chars * 6.6 + 14)
  const h = 18
  const y = 6
  const x = onLeft ? -w - 5 : CAT_W + 5
  const color = hex(tint)
  const tail = onLeft
    ? `<path d="M${x + w} ${y + 7} l5 2 l-5 2 z" fill="${color}" fill-opacity="0.16"/>`
    : `<path d="M${x} ${y + 7} l-5 2 l5 2 z" fill="${color}" fill-opacity="0.16"/>`
  const dots = hasDots
    ? [0, 1, 2]
        .map(i => `<tspan opacity="0">.<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.2;0.8;1" dur="1.2s" begin="${i * 0.2}s" repeatCount="indefinite"/></tspan>`)
        .join('')
    : ''
  const star = sparkle
    ? `<tspan>✦<animate attributeName="opacity" values="1;0.3;1" dur="0.8s" repeatCount="indefinite"/></tspan> `
    : ''
  return `<g opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.15s" fill="freeze"/>
    <animateTransform attributeName="transform" type="translate" from="0 3" to="0 0" dur="0.18s" fill="freeze"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="${color}" fill-opacity="0.16" stroke="${color}" stroke-opacity="0.7"/>
    ${tail}
    <text x="${x + 7}" y="${y + 12.5}" font-family="ui-monospace, Menlo, monospace" font-size="11" fill="${color}">${star}${xmlEscape(text)}${dots}</text>
  </g>`
}

function floaters(c: Cat, isNapping: boolean): string {
  // Little particles that drift up from the cat's head.
  const drift = (glyph: string, x: number, delay: number, color: string, size: number) =>
    `<text x="${x}" y="8" font-size="${size}" fill="${color}" opacity="0">${glyph}
      <animate attributeName="y" values="8;-2" dur="1.6s" begin="${delay}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;1;0" dur="1.6s" begin="${delay}s" repeatCount="indefinite"/>
    </text>`
  if (isNapping) return drift('z', 24, 0, hex(QUIET_COLOR), 9) + drift('Z', 30, 0.8, hex(QUIET_COLOR), 11)
  if (c.mood === 'pet') return drift('♥', 6, 0, '#db61a2', 9) + drift('♥', 26, 0.5, '#db61a2', 8)
  return ''
}

// A shiny cat sparkles now and then.
const SHINY = [[3, 2, 0], [31, 9, 1.3], [17, -6, 2.1]]
  .map(([x, y, d]) => `<text x="${x}" y="${y}" font-size="7" fill="#f5c542" opacity="0">✦<animate attributeName="opacity" values="0;1;0;0" keyTimes="0;0.1;0.25;1" dur="3.2s" begin="${d}s" repeatCount="indefinite"/></text>`)
  .join('')

const BOB = '<animateTransform attributeName="transform" type="translate" values="0 0;0 -2;0 0" dur="3s" repeatCount="indefinite"/>'

// The perch, sliding in at bedtime and out on waking, in lane coordinates.
function perchSvg(c: Cat, m: Motion, now: number, scene: Scene): string {
  const shown = perchShown(c, m, now)
  if (shown === null) return ''
  const p = PERCHES[scene]
  const w = p.rows[0].length * PX
  const y = HEADROOM + CAT_H - p.rows.length * PX - p.float
  const away = -(PERCH_X + w + 4)
  const isLeaving = c.mood !== 'sleep'
  const since = isLeaving ? (c.wokeAt ?? now) : m.t0
  const slide = now - since < SLIDE_MS
    ? `<animateTransform attributeName="transform" type="translate" from="${isLeaving ? 0 : away} 0" to="${isLeaving ? away : 0} 0" dur="${SLIDE_MS}ms" begin="${Math.round(since - now)}ms" fill="freeze"/>`
    : ''
  return `<g transform="translate(${PERCH_X} ${y})"><g>${slide}<g>${p.float ? BOB : ''}<g shape-rendering="crispEdges">${rects(p.rows, p.pal)}</g></g></g></g>`
}

// The toy or critter on this leg, in the cat's own coordinates (0..36),
// placed ahead of the cat in the direction it faces. One-shot animations
// start at the leg's start (a negative begin), so a redraw mid-leg picks
// them up where they were.
function companionSvg(m: Motion, dir: 1 | -1, walking: boolean, remaining: number, now: number, scene: Scene, prop?: ToolProp | null): string {
  const ahead = (w: number) => (dir === 1 ? CAT_W + 3 : -w - 3)
  const flip = (rows: string[]) => (dir === 1 ? faceRight(rows) : rows)
  const until = walking ? remaining : undefined
  const at = (ms: number) => `${Math.round(m.t0 + ms - now)}ms`
  if (m.activity === 'yarn') {
    const s = 5 * PX
    const x = ahead(s)
    const spin = walking
      ? `<animateTransform attributeName="transform" type="rotate" from="0 ${s / 2} ${s / 2}" to="${dir * 360} ${s / 2} ${s / 2}" dur="0.7s" repeatDur="${Math.round(remaining)}ms"/>`
      : ''
    return `<g transform="translate(${x} ${CAT_H - s})"><g>${spin}${rects(YARN, TOYS)}</g></g>`
  }
  if (m.activity === 'mouse') {
    const w = 7 * PX
    return `<g transform="translate(${ahead(w) - dir * 6} ${CAT_H - 4 * PX})">${frames(rects(flip(MOUSE_A), TOYS), rects(flip(MOUSE_B), TOYS), 0.16, until)}</g>`
  }
  if (m.activity === 'butterfly') {
    const w = 5 * PX
    return `<g transform="translate(${ahead(w)} 4)"><g>
      <animateTransform attributeName="transform" type="translate" values="0 0;4 -3;1 2;-3 -1;0 0" dur="1.8s" repeatCount="indefinite"/>
      ${frames(rects(FLY_OPEN, TOYS), rects(FLY_SHUT, TOYS), 0.25)}
    </g></g>`
  }
  if (m.activity === 'busy' && prop) {
    const rows = TOOL_ROWS[prop]
    const w = rows[0].length * PX
    const h = rows.length * PX
    const rowsFacing = dir === 1 ? rows : faceRight(rows)
    const wander = prop === 'search'
      ? '<animateTransform attributeName="transform" type="translate" values="0 0;-4 -4;3 -2;0 0" dur="2.2s" repeatCount="indefinite"/>'
      : ''
    return `<g transform="translate(${ahead(w)} ${CAT_H - h})"><g>${wander}${rects(rowsFacing, PROP_COLORS)}</g></g>`
  }
  if (m.activity === 'shove') {
    // Tap, tap… then the mug slides off the edge and smashes.
    const tw = TABLE[0].length * PX
    const x = ahead(tw)
    const mugX = x + (dir === 1 ? 2 : 3) * PX
    const mugY = CAT_H - TABLE.length * PX - MUG.length * PX
    const fall = TABLE.length * PX
    const shards = `<g opacity="0" transform="translate(${mugX + dir * 22} ${CAT_H - 3})"><animate attributeName="opacity" values="0;0;1" keyTimes="0;0.6;0.61" dur="${m.dur}ms" begin="${at(0)}" fill="freeze"/>${rects(['M.m.M'], PROP_COLORS)}</g>`
    return `${shards}<g transform="translate(${x} ${CAT_H - TABLE.length * PX})">${rects(TABLE, PROP_COLORS)}</g>
      <g transform="translate(${mugX} ${mugY})"><g>
        <animateTransform attributeName="transform" type="translate" values="0 0;0 0;${dir * 16} 0;${dir * 22} ${fall}" keyTimes="0;0.4;0.52;0.6" dur="${m.dur}ms" begin="${at(0)}" fill="freeze"/>
        <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.6;0.61" dur="${m.dur}ms" begin="${at(0)}" fill="freeze"/>
        ${rects(dir === 1 ? MUG : faceRight(MUG), PROP_COLORS)}
      </g></g>`
  }
  if (m.activity === 'laser') {
    return `<g transform="translate(${ahead(6) + 3} ${CAT_H - 3})"><g>
      <animateTransform attributeName="transform" type="translate" values="0 0;3 -2;-2 1;2 2;-3 -1;0 0" dur="0.5s" repeatCount="indefinite"/>
      <circle r="4.5" fill="#ff3b3b" opacity="0.3"/><circle r="1.8" fill="#ff6060"/>
    </g></g>`
  }
  if (m.activity === 'caught') {
    // Pinned under a paw, wriggling, then it slips free and scurries off.
    return `<g transform="translate(${ahead(7 * PX) + dir * 2} ${CAT_H - 4 * PX})"><g>
      <animateTransform attributeName="transform" type="translate" values="0 0;0 0;${dir * 140} 0" keyTimes="0;0.72;1" dur="${m.dur}ms" begin="${at(0)}" fill="freeze"/>
      <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.85;1" dur="${m.dur}ms" begin="${at(0)}" fill="freeze"/>
      ${frames(rects(flip(MOUSE_A), TOYS), rects(flip(MOUSE_B), TOYS), 0.16)}
    </g></g>`
  }
  if (m.activity === 'flyaway') {
    // Gone in the pounce ("nom?!"), then it bursts out and flies away.
    return `<g transform="translate(${ahead(5 * PX)} ${CAT_H - 4 * PX})"><g>
      <animateTransform attributeName="transform" type="translate" values="0 0;0 0;${dir * 90} -70" keyTimes="0;0.53;1" dur="${m.dur}ms" begin="${at(0)}" fill="freeze"/>
      <animate attributeName="opacity" values="1;0;0;1;1;0" keyTimes="0;0.12;0.52;0.54;0.92;1" dur="${m.dur}ms" begin="${at(0)}" fill="freeze"/>
      ${frames(rects(flip(BIRD_UP), TOYS), rects(flip(BIRD_DOWN), TOYS), 0.18)}
    </g></g>`
  }
  if (m.activity === 'fish') {
    const prop = PROPS[SCENE_PROP[scene]]
    const w = prop.rows[0].length * PX
    const h = prop.rows.length * PX
    const x = dir === 1 ? CAT_W + 2 : -w - 2
    const k = Math.min(0.2, 400 / m.dur).toFixed(3)
    let fish: string
    if (prop.swim) {
      const [x0, x1, y] = prop.swim
      fish = `<g transform="translate(${x0 * PX} ${y * PX})"><g>
        <animateTransform attributeName="transform" type="translate" values="0 0;${(x1 - x0) * PX} 0;0 0" dur="3s" repeatCount="indefinite"/>
        ${rects(FISH, TOYS)}</g></g>`
    } else {
      // A fish leaps out of the river now and then.
      fish = `<g opacity="0" transform="translate(${w / 2 - 8} 0)"><g>
        <animateTransform attributeName="transform" type="translate" values="0 ${h};5 -12;10 ${h};10 ${h}" keyTimes="0;0.18;0.36;1" dur="2.5s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.04;0.32;0.36;1" dur="2.5s" repeatCount="indefinite"/>
        ${rects(FISH, TOYS)}</g></g>`
    }
    // A catch: in the last moment a fish leaps up into the cat's paws.
    const mouthX = (dir === 1 ? 26 : 2) - x
    const hit = m.hit
      ? `<g opacity="0" transform="translate(${w / 2 - 6} ${h - 6})"><g>
        <animateTransform attributeName="transform" type="translate" values="0 0;${mouthX / 2} -24;${mouthX} -${h - 18}" dur="0.9s" begin="${at(m.dur - 1200)}" fill="freeze"/>
        <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.85;1" dur="0.9s" begin="${at(m.dur - 1200)}" fill="freeze"/>
        ${rects(FISH, TOYS)}</g></g>`
      : ''
    return `<g transform="translate(${x} ${CAT_H - h})"><g opacity="0">
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;${k};${(1 - Number(k)).toFixed(3)};1" dur="${m.dur}ms" begin="${at(0)}" fill="freeze"/>
      ${rects(prop.rows, PROP_PAL)}${fish}</g>${hit}</g>`
  }
  return ''
}

// A bird pecking, or a mug on a table, at the spot the cat is walking to,
// in lane coordinates.
function stalkedBirdSvg(m: Motion, dir: 1 | -1, now: number, pct: (p: number) => string): string {
  if (now >= m.t0 + m.dur) return ''
  if (m.activity === 'knock') {
    const tw = TABLE[0].length * PX
    const x = dir === 1 ? CAT_W + 3 : -tw - 3
    return `<svg x="${pct(m.to)}" y="${HEADROOM}" width="${CAT_W}" height="${CAT_H}" overflow="visible"><g shape-rendering="crispEdges">
      <g transform="translate(${x} ${CAT_H - TABLE.length * PX})">${rects(TABLE, PROP_COLORS)}</g>
      <g transform="translate(${x + (dir === 1 ? 2 : 3) * PX} ${CAT_H - TABLE.length * PX - MUG.length * PX})">${rects(dir === 1 ? MUG : faceRight(MUG), PROP_COLORS)}</g>
    </g></svg>`
  }
  if (m.activity !== 'bird') return ''
  const flip = (rows: string[]) => (dir === 1 ? faceRight(rows) : rows)
  const x = dir === 1 ? CAT_W + 3 : -5 * PX - 3
  return `<svg x="${pct(m.to)}" y="${HEADROOM}" width="${CAT_W}" height="${CAT_H}" overflow="visible">
    <g shape-rendering="crispEdges" transform="translate(${x} ${CAT_H - 4 * PX})">${frames(rects(flip(BIRD), TOYS), rects(flip(BIRD_PECK), TOYS), 0.7)}</g>
  </svg>`
}

export function laneSvg(c: Cat, m: Motion, now: number, catPal: Palette, scene: Scene, x: Extras = {}): string {
  const id = x.identity ?? { marking: 'none', shiny: false }
  const hat = x.hat ?? 'none'
  const pal = { ...catPal, ...HAT_PAL }
  const cur = posAt(m, now)
  const walking = isWalking(m, now)
  const busy = now < m.t0 + m.dur
  const remaining = walking ? m.t0 + m.dur - now : 0
  const dir = m.to > m.from && walking ? 1 : m.to < m.from && walking ? -1 : c.dir
  const pct = (p: number) => `${(clamp01(p) * MAX_X).toFixed(3)}%`
  // Every cat sprite wears its marking and hat, then faces the way it's going.
  const flip = (rows: string[]) => {
    const d = dress(rows, id.marking, hat)
    return dir === 1 ? faceRight(d) : d
  }
  const pose = posture(c, m, now)
  const eyes = (rows: string[]) => (isHappy(c.mood) ? closeEyes(rows) : rows)
  const at = (ms: number) => `${Math.round(m.t0 + ms - now)}ms`

  let body: string
  if (pose === 'loaf') {
    body = rects(flip(LOAF.map(r => r.replace(/[HK]/g, 'd'))), pal)
  } else if (pose === 'walk') {
    const legs = c.mood === 'working' || m.activity === 'mouse' || m.activity === 'laser' ? 0.2 : m.activity === 'bird' ? 0.6 : 0.32
    body = frames(rects(flip(eyes(WALK_A)), pal), rects(flip(eyes(WALK_B)), pal), legs, remaining)
  } else if (busy && m.activity === 'groom') {
    body = frames(rects(flip(GROOM_A), pal), rects(flip(GROOM_B), pal), 0.5)
  } else if (busy && m.activity === 'fish') {
    body = frames(rects(flip(eyes(SIT)), pal), rects(flip(eyes(SIT_PAW)), pal), 1)
  } else if (busy && (m.activity === 'shove' || (m.activity === 'busy' && (c.prop === 'edit' || c.prop === 'bash')))) {
    // Typing away, or tapping the mug.
    body = frames(rects(flip(eyes(SIT)), pal), rects(flip(eyes(SIT_PAW)), pal), m.activity === 'shove' ? 0.45 : 0.25)
  } else if (busy && m.activity === 'caught') {
    body = rects(flip(eyes(SIT_PAW)), pal)
  } else {
    body = frames(rects(flip(eyes(SIT)), pal), rects(flip(eyes(SIT_WAG)), pal), 1.2)
  }
  // Blinks: closed-eye pixels laid over the open eyes for a moment.
  if (pose !== 'loaf' && !isHappy(c.mood) && !(busy && m.activity === 'groom')) {
    const open = flip(pose === 'walk' ? WALK_A : SIT)
    const shut = flip(closeEyes(pose === 'walk' ? WALK_A : SIT))
    body += `<g opacity="0">${rects(shut, pal, open)}<animate attributeName="opacity" values="0;1;0" keyTimes="0;0.95;0.98" dur="4s" calcMode="discrete" repeatCount="indefinite"/></g>`
  }

  const isPounce = busy && !walking && (m.activity === 'caught' || m.activity === 'flyaway')
  const bounce = c.mood === 'oops'
    ? '<animateTransform attributeName="transform" type="translate" values="-2 0;2 0;-2 0" dur="0.12s" repeatCount="indefinite"/>'
    : c.mood === 'done'
      ? '<animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" dur="0.35s" repeatCount="3"/>'
      : walking && m.activity === 'hop'
        ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -7;0 0" keyTimes="0;0.4;1" dur="0.45s" repeatDur="${Math.round(remaining)}ms"/>`
        : isPounce
          ? `<animateTransform attributeName="transform" type="translate" values="0 0;${dir * 6} -7;${dir * 9} 0" keyTimes="0;0.5;1" dur="0.4s" begin="${at(0)}" fill="freeze"/>`
          : ''
  const glide = walking
    ? `<animate attributeName="x" from="${pct(cur)}" to="${pct(m.to)}" dur="${Math.round(remaining)}ms" fill="freeze"/>`
    : ''
  const tint = MOOD_COLOR[c.mood] ?? QUIET_COLOR
  const hasCompanion = WITH_COMPANION.has(m.activity) && busy
  const bubbleLeft = hasCompanion ? dir === 1 && cur > 0.2 : Math.max(cur, m.to) > 0.55
  const isNapping = pose === 'loaf'

  // On the perch: shifted onto it and lifted, after a little hop up.
  let perchOpen = '<g><g><g>'
  let floatX = 0
  if (isOnPerch(c, m)) {
    const p = PERCHES[scene]
    const dx = PERCH_X + (p.rows[0].length * PX - CAT_W) / 2
    const lift = (p.rows.length - 1) * PX + p.float
    const hopUp = `<animateTransform attributeName="transform" type="translate" values="${-dx} ${lift};${-dx / 2} ${lift / 2 - 8};0 0" dur="0.35s" begin="${at(0)}" fill="freeze"/>`
    perchOpen = `<g transform="translate(${dx} ${-lift})"><g>${p.float ? BOB : ''}<g>${hopUp}`
    floatX = dx + 14 // z's drift beside the cat, not off the top of the lane
  }

  // color-scheme lets the frame follow the app's light or dark appearance,
  // so a Clear lane stays see-through instead of a white page.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${LANE_H}" overflow="visible" style="background:transparent">
  <style>:root{color-scheme:light dark;background:transparent}</style>
  ${sceneSvg(scene, x.hour ?? 12)}
  ${typeof x.ctx === 'number' ? `<svg x="100%" y="${HEADROOM}" overflow="visible"><g shape-rendering="crispEdges" transform="translate(${-8 * PX - 8} ${CAT_H - 4 * PX})">${rects(bowlRows(x.ctx), BOWL_PAL)}</g></svg>` : ''}
  ${perchSvg(c, m, now, scene)}
  ${stalkedBirdSvg(m, dir, now, pct)}
  <svg x="${pct(cur)}" y="${HEADROOM}" width="${CAT_W}" height="${CAT_H}" overflow="visible">${glide}
    ${perchOpen}
    <g shape-rendering="crispEdges">
      ${busy || !walking ? companionSvg(m, dir, walking, remaining, now, scene, c.prop) : ''}
      <g transform="translate(0 ${-HAT_PAD * PX})"><g>${bounce}${body}</g></g>
    </g>
    ${floatX ? '' : floaters(c, isNapping)}
    ${id.shiny ? SHINY : ''}
    ${isNapping ? '' : bubbleSvg(c, bubbleLeft, tint)}
    </g></g></g>
    ${floatX ? `<g transform="translate(${floatX} 0)">${floaters(c, isNapping)}</g>` : ''}
  </svg>
</svg>`
}

// ── Terminal: the lane is one Raster, repainted in place ────────────────

const DEFAULT = 0x01000000
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '='
    out += i + 2 < bytes.length ? B64[n & 63] : '='
  }
  return out
}

// Only printable ASCII goes into Raster cells, so nothing is double width.
function ascii(s: string): string {
  return s.replace(/…/g, '...').replace(/♥/g, '<3').replace(/[^\x20-\x7e]/g, '')
}

function terminalLine(c: Cat, now: number): string | null {
  if (!c.say) return null
  let line = ascii(c.say)
  if (line.length > 28) line = line.slice(0, 25) + '...'
  const typed = Math.max(1, Math.floor((now - (c.sayAt ?? 0)) / 40))
  if (typed < line.length) return line.slice(0, typed)
  if (line.endsWith('...')) line = line.slice(0, -3) + ['.  ', '.. ', '...'][Math.floor(now / 300) % 3]
  if (c.mood === 'pet') line += ['  <3', ' <3<3'][Math.floor(now / 400) % 2]
  if (c.mood === 'done') line = `${Math.floor(now / 300) % 2 ? '*' : '+'} ${line}`
  return line
}

export function laneCells(c: Cat, m: Motion, now: number, pal: Palette, cols: number, scene: Scene, x: Extras = {}): string {
  const ROWS = 5
  const PIX = ROWS * 2
  const bg = SCENE_BG[scene]
  // Paint pixels first (cols x 10), then pack two per cell with half blocks.
  const pixels: (number | undefined)[] = new Array(cols * PIX)
  const plot = (rows: string[], x0: number, y0: number, colors: Palette) => {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const color = colors[row[x]]
        const px = x0 + x
        const py = y0 + y
        if (color !== undefined && px >= 0 && px < cols && py >= 0 && py < PIX) pixels[py * cols + px] = color
      }
    })
  }

  const walking = isWalking(m, now)
  const busy = now < m.t0 + m.dur
  const elapsed = now - m.t0
  const dir = m.to > m.from && walking ? 1 : m.to < m.from && walking ? -1 : c.dir
  const span = Math.max(0, cols - SPRITE_W - 1)
  const shake = c.mood === 'oops' ? (Math.floor(now / 120) % 2 ? 1 : -1) : 0
  let cx = Math.max(0, Math.min(span, Math.round(posAt(m, now) * span) + shake))
  const pose = posture(c, m, now)
  const flip = (rows: string[]) => (dir === 1 ? faceRight(rows) : rows)

  // The perch slides in from the left at bedtime.
  const perch = PERCHES[scene]
  const pw = perch.rows[0].length
  const ph = perch.rows.length
  const shown = perchShown(c, m, now)
  if (shown !== null) plot(perch.rows, Math.round(1 - (pw + 2) * (1 - shown)), PIX - ph - (perch.float ? 1 : 0), perch.pal)

  let rows: string[]
  if (pose === 'loaf') rows = LOAF.map(r => r.replace(/[HK]/g, 'd'))
  else if (pose === 'walk') rows = Math.floor(now / (c.mood === 'working' || m.activity === 'mouse' || m.activity === 'laser' ? 100 : m.activity === 'bird' ? 300 : 160)) % 2 ? WALK_B : WALK_A
  else if (busy && m.activity === 'caught') rows = SIT_PAW
  else if (busy && m.activity === 'groom') rows = Math.floor(now / 250) % 2 ? GROOM_B : GROOM_A
  else if (busy && (m.activity === 'shove' || (m.activity === 'busy' && (c.prop === 'edit' || c.prop === 'bash')))) {
    rows = Math.floor(now / 200) % 2 ? SIT_PAW : SIT
  }
  else if (busy && m.activity === 'fish') rows = Math.floor(now / 500) % 2 ? SIT_PAW : SIT
  else rows = Math.floor(now / 600) % 2 ? SIT_WAG : SIT
  if (pose !== 'loaf' && (isHappy(c.mood) || now % 4000 > 3850)) rows = closeEyes(rows)
  let cy = walking && m.activity === 'hop' && Math.floor(now / 225) % 2 ? 1 : 0
  if (busy && !walking && (m.activity === 'caught' || m.activity === 'flyaway') && elapsed > 200) {
    cx = Math.max(0, Math.min(span, cx + dir * 2)) // pounced
  }
  if (isOnPerch(c, m)) {
    cx = 1 + Math.floor((pw - SPRITE_W) / 2)
    cy = -Math.min(4, ph - 1 + (perch.float ? 1 : 0))
  }
  // The food bowl at the right end shows how much context is left.
  if (typeof x.ctx === 'number') plot(bowlRows(x.ctx), cols - 9, PIX - 4, BOWL_PAL)
  const id = x.identity ?? { marking: 'none', shiny: false }
  const dressed = dress(rows, id.marking, x.hat ?? 'none')
  plot(dir === 1 ? faceRight(dressed) : dressed, cx, cy - HAT_PAD, { ...pal, ...HAT_PAL })

  // Companions ahead of the cat.
  const ahead = (w: number) => (dir === 1 ? cx + SPRITE_W + 1 : cx - w - 1)
  const wings = Math.floor(now / 180) % 2 ? BIRD_DOWN : BIRD_UP
  if (busy && m.activity === 'yarn') plot(YARN, ahead(5), PIX - 5, TOYS)
  if (busy && m.activity === 'mouse') plot(flip(Math.floor(now / 80) % 2 ? MOUSE_B : MOUSE_A), ahead(7) + dir * 2, PIX - 4, TOYS)
  if (busy && m.activity === 'butterfly') {
    plot(Math.floor(now / 250) % 2 ? FLY_SHUT : FLY_OPEN, ahead(5) + (Math.floor(now / 700) % 2), Math.floor(now / 500) % 2, TOYS)
  }
  if (busy && m.activity === 'busy' && c.prop) {
    const rows = TOOL_ROWS[c.prop]
    plot(dir === 1 ? rows : faceRight(rows), ahead(rows[0].length), PIX - rows.length, PROP_COLORS)
  }
  if (busy && m.activity === 'knock') {
    const tx = Math.round(m.to * span)
    const bx = dir === 1 ? tx + SPRITE_W + 1 : tx - TABLE[0].length - 1
    plot(TABLE, bx, PIX - TABLE.length, PROP_COLORS)
    plot(MUG, bx + 2, PIX - TABLE.length - MUG.length, PROP_COLORS)
  }
  if (busy && m.activity === 'shove') {
    const bx = ahead(TABLE[0].length)
    plot(TABLE, bx, PIX - TABLE.length, PROP_COLORS)
    const k = elapsed / m.dur
    const mx = bx + 2 + (k < 0.4 ? 0 : dir * Math.round(Math.min(1, (k - 0.4) / 0.2) * 7))
    const my = PIX - TABLE.length - MUG.length + (k < 0.52 ? 0 : Math.round(Math.min(1, (k - 0.52) / 0.08) * TABLE.length))
    if (k < 0.6) plot(MUG, mx, my, PROP_COLORS)
    else plot(['M.m.M'], bx + 2 + dir * 8, PIX - 1, PROP_COLORS)
  }
  if (busy && m.activity === 'laser') {
    const j = [0, 1, -1, 1, 0, -1][Math.floor(now / 90) % 6]
    plot(['L'], ahead(1) + j, PIX - 1 - (j === 1 ? 1 : 0), { L: 0xff3b3b })
  }
  if (busy && m.activity === 'bird') {
    const tx = Math.round(m.to * span)
    plot(flip(Math.floor(now / 350) % 2 ? BIRD_PECK : BIRD), dir === 1 ? tx + SPRITE_W + 1 : tx - 6, PIX - 4, TOYS)
  }
  if (busy && m.activity === 'caught') {
    const run = elapsed > m.dur * 0.72 ? Math.round((elapsed - m.dur * 0.72) / 20) : 0
    plot(flip(Math.floor(now / 80) % 2 ? MOUSE_B : MOUSE_A), ahead(7) - dir * 2 + dir * run, PIX - 4, TOYS)
  }
  if (busy && m.activity === 'flyaway') {
    if (elapsed < 350) plot(flip(wings), ahead(5), PIX - 4, TOYS)
    else if (elapsed > 1600) {
      const k = (elapsed - 1600) / (m.dur - 1600)
      plot(flip(wings), ahead(5) + dir * Math.round(k * 30), PIX - 4 - Math.round(k * 10), TOYS)
    }
  }
  if (busy && m.activity === 'fish' && elapsed > 300 && elapsed < m.dur - 300) {
    const prop = PROPS[SCENE_PROP[scene]]
    const w = prop.rows[0].length
    const h = prop.rows.length
    const px = ahead(w)
    plot(prop.rows, px, PIX - h, PROP_PAL)
    if (prop.swim) {
      const [x0, x1, y] = prop.swim
      const t = (now % 3000) / 1500
      plot(FISH, px + x0 + Math.round((t < 1 ? t : 2 - t) * (x1 - x0)), PIX - h + y, TOYS)
    } else {
      const phase = now % 2500
      if (phase < 900) plot(FISH, px + Math.floor(w / 2) - 3 + Math.floor(phase / 300), PIX - 3 - Math.round(Math.sin((Math.PI * phase) / 900) * 5), TOYS)
    }
    const k = (elapsed - (m.dur - 1200)) / 900
    if (m.hit && k >= 0 && k < 1) {
      const sx = px + Math.floor(w / 2)
      const ex = dir === 1 ? cx + 9 : cx + 1
      plot(FISH, Math.round(sx + (ex - sx) * k), Math.round(PIX - h - Math.sin(Math.PI * k) * 4 + (4 - PIX + h) * k), TOYS)
    }
  }

  const grid = new Uint32Array(cols * ROWS * 3)
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < cols; x++) {
      const top = pixels[y * 2 * cols + x]
      const bottom = pixels[(y * 2 + 1) * cols + x]
      const cell =
        top === undefined && bottom === undefined ? [0x20, DEFAULT, bg]
        : top === undefined ? [0x2584, bottom!, bg]
        : [0x2580, top, bottom ?? bg]
      grid.set(cell, (y * cols + x) * 3)
    }
  }
  const put = (x: number, y: number, ch: string, fg: number) => {
    if (x < 0 || x >= cols || y < 0 || y >= ROWS) return
    grid.set([ch.codePointAt(0) ?? 0x20, fg, bg], (y * cols + x) * 3)
  }

  if (pose === 'loaf') {
    const z = ['z', 'zZ', 'zZz', ' Zz', '  z'][Math.floor(now / 500) % 5]
    const zx = dir === 1 || isOnPerch(c, m) ? cx + SPRITE_W : cx - 4
    for (let i = 0; i < z.length; i++) put(zx + i, 1, z[i], QUIET_COLOR)
  }

  const line = pose === 'loaf' ? null : terminalLine(c, now)
  if (line) {
    const tint = MOOD_COLOR[c.mood] ?? QUIET_COLOR
    const bw = line.length + 4
    const right = cx + SPRITE_W + 1
    const fitsLeft = cx - 1 - bw >= 0
    const isLeft = fitsLeft && (right + bw > cols || (WITH_COMPANION.has(m.activity) && busy && dir === 1))
    const bx = isLeft ? cx - 1 - bw : right
    const text = isLeft ? line : line.slice(0, Math.max(0, cols - right - 4))
    const w = text.length + 4
    put(bx, 1, '╭', tint)
    put(bx + w - 1, 1, '╮', tint)
    put(bx, 3, '╰', tint)
    put(bx + w - 1, 3, '╯', tint)
    for (let i = 1; i < w - 1; i++) {
      put(bx + i, 1, '─', tint)
      put(bx + i, 3, '─', tint)
    }
    put(bx, 2, isLeft ? '│' : '┤', tint)
    put(bx + w - 1, 2, isLeft ? '├' : '│', tint)
    put(isLeft ? bx + w : bx - 1, 2, '─', tint)
    for (let i = 0; i < w - 2; i++) put(bx + 1 + i, 2, ' ', tint)
    for (let i = 0; i < text.length; i++) put(bx + 2 + i, 2, text[i], tint)
  }

  return base64(new Uint8Array(grid.buffer))
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

async function toast($: EngineInterface, text: string) {
  if ((await read($, prefs)).popups) $.ui.toast(text)
}

// Counts a finished task or a tool call; answers the hats that just unlocked.
async function bumpStats($: EngineInterface, fn: (s: Stats) => Stats): Promise<typeof HATS> {
  const before = await read($, stats)
  const after = fn(before)
  await update($, stats, () => after)
  await $.store.set('stats', after)
  return HATS.filter(h => !h.need(before) && h.need(after))
}

async function setPrefs($: EngineInterface, fn: (p: Prefs) => Prefs) {
  await update($, prefs, fn)
  await $.store.set('prefs', await read($, prefs))
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
  // Assigned in session.start, where the timers live.
  let wake: (mood: Mood, say: string | null, holdMs: number, prop?: ToolProp | null) => Promise<void> = async () => {}
  let hungry = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cat',
      description: 'Show or hide the Claude cat (and see your usage limits)',
    })
    lastActivity = await $.clock.now()
    sayUntil = lastActivity + 5000
    await update($, cat, c => ({ ...c, sayAt: lastActivity }))

    // A new leg: what the cat does next, where to, and for how long.
    const plan = async (now: number, mood: Mood, from: number, activity: Activity, chain?: number) => {
      const p = await read($, prefs)
      const still = stillFor(activity)
      if (still !== null) {
        // Fishing faces whichever side has room for the bowl or river.
        const hit = activity === 'fish' ? Math.random() < 0.5 : undefined
        await update($, motion, () => ({ from, to: from, t0: now, dur: still, activity, hit }))
        if (activity === 'fish') await update($, cat, c => ({ ...c, dir: from < 0.5 ? 1 : -1 }))
        return
      }
      const base = mood === 'working' ? RUN_PACE[p.speed] : mood === 'tired' ? TIRED_PACE : PACE[p.speed]
      const boost =
        activity === 'laser' ? 4.5 : activity === 'mouse' ? 3 : activity === 'yarn' ? 1.8 : activity === 'hop' ? 1.4
        : activity === 'butterfly' ? 0.8 : activity === 'bird' ? 0.45 : 1
      const pace = mood === 'working' ? base : base * boost
      let to = Math.random()
      if (activity === 'laser') {
        // Short, frantic zips this way and that.
        const sign = Math.random() < 0.5 ? 1 : -1
        to = from + sign * (0.15 + Math.random() * 0.3)
        if (to < 0.05 || to > 0.95) to = from - sign * (0.15 + Math.random() * 0.3)
      } else if (activity === 'knock') {
        // A table with a mug on it, a little way off.
        to = from < 0.5 ? from + 0.12 + Math.random() * 0.15 : from - 0.12 - Math.random() * 0.15
      } else if (activity === 'meter') {
        to = 0 // the usage numbers sit below the left end
      } else if (activity === 'bird') {
        // Creep a little way toward a bird that has landed nearby.
        to = from < 0.5 ? from + 0.12 + Math.random() * 0.13 : from - 0.12 - Math.random() * 0.13
      } else if (Math.abs(to - from) < 0.2) {
        to = from < 0.5 ? from + 0.3 + Math.random() * 0.4 : from - 0.3 - Math.random() * 0.4
      }
      // Keep toys and critters ahead of the cat on screen.
      to = WITH_COMPANION.has(activity) ? Math.max(0.12, Math.min(0.95, to)) : clamp01(to)
      const dur = Math.max(800, (Math.abs(to - from) / pace) * 1000)
      await update($, motion, () => ({ from, to, t0: now, dur, activity, chain }))
      await update($, cat, c => ({ ...c, dir: to > from ? 1 : -1 }))
    }

    const say = async (now: number, text: string) => {
      sayUntil = now + 2500
      await update($, cat, x => ({ ...x, say: text, sayAt: now }))
    }

    // Once a second: expire lines and moods, nap, and pick the next leg.
    const brain = async () => {
      const now = await $.clock.now()
      const c = await read($, cat)
      const m = await read($, motion)
      const fiveHour = (await read($, limits)).fiveHour ?? 0
      const isLow = fiveHour >= 80
      const isOut = fiveHour >= 100
      const here = posAt(m, now)
      const ctx = (await read($, limits)).context ?? 0
      const hour = new Date().getHours()
      let mood = c.mood

      if (c.say && now > sayUntil) await update($, cat, x => ({ ...x, say: null }))
      const due = cues.filter(q => q.at <= now)
      cues = cues.filter(q => q.at > now)
      for (const q of due) await say(now, q.text)
      if (now > moodUntil && (mood === 'done' || mood === 'oops' || mood === 'pet')) mood = 'sit'

      // Bedtime: after a long quiet spell, or when the 5-hour limit runs
      // out, the cat walks back to its perch (which slides in) and sleeps.
      const isBedtime = now - lastActivity > NAP_AFTER_MS || (isOut && now > moodUntil)
      if (mood !== 'working' && mood !== 'sleep' && isBedtime) {
        cues = []
        const pace = PACE[(await read($, prefs)).speed]
        const dur = Math.max(SLIDE_MS + 200, (here / pace) * 1000)
        sayUntil = now + 3000
        await update($, cat, x => ({ ...x, mood: 'sleep', dir: -1, say: isOut ? 'out of juice… nap time' : 'bedtime…', sayAt: now }))
        await update($, motion, () => ({ from: here, to: 0, t0: now, dur, activity: 'bed' as Activity }))
        return
      }
      if (mood === 'sleep') {
        // Arrived: hop up and curl up on the perch.
        if (m.activity === 'bed' && now >= m.t0 + m.dur) {
          await update($, motion, () => ({ from: 0, to: 0, t0: now, dur: 0, activity: 'perch' as Activity }))
        }
        return
      }

      if (ctx < 85) hungry = false
      if (now >= m.t0 + m.dur) {
        let activity: Activity = 'walk'
        let chain: number | undefined
        if (mood !== 'working') {
          mood = isLow ? 'tired' : 'idle'
          // Some activities lead into the next: a chased mouse may get
          // caught, a stalked bird gets pounced on, the laser zips again.
          let line: string | null = null
          if (m.activity === 'knock') activity = 'shove'
          else if (m.activity === 'meter') activity = 'sitmeter'
          else if (ctx >= 85 && !hungry) {
            hungry = true
            activity = 'sit'
            line = 'my bowl is almost empty…'
          } else if (m.activity === 'mouse' && Math.random() < 0.6) activity = 'caught'
          else if (m.activity === 'bird') activity = 'flyaway'
          else if (m.activity === 'laser' && (m.chain ?? 0) > 0) {
            activity = 'laser'
            chain = (m.chain ?? 1) - 1
          } else if (m.activity === 'laser') {
            activity = 'sit'
            line = "where'd it go?"
          } else if (m.activity === 'fish') {
            activity = 'sit'
            line = m.hit ? 'got one! ♥' : 'next time…'
          } else {
            const isLate = hour >= 23 || hour < 6
            activity = pick(isLow ? TIRED_ACTIVITIES : isLate ? NIGHT_ACTIVITIES : IDLE_ACTIVITIES)
            if (activity === 'laser') chain = 2 + Math.floor(Math.random() * 3)
          }
          if (activity === 'sit') mood = 'sit'
          // Now and then, say something about it.
          const lines = LINES[activity]
          const isFollowUp = activity === 'caught' || activity === 'flyaway' || activity === 'shove' || activity === 'sitmeter'
          const isRepeat = activity === 'laser' && m.activity === 'laser'
          if (!line && lines && !isRepeat && (isFollowUp || (!c.say && Math.random() < 0.5))) {
            line = lines[Math.floor(Math.random() * lines.length)]
          }
          if (line) await say(now, line)
          if (activity === 'caught') cues.push({ at: now + 2100, text: 'hey! come back' })
          if (activity === 'flyaway') cues.push({ at: now + 1600, text: 'nooo come back' })
          if (activity === 'shove') {
            cues.push({ at: now + 2100, text: '*CRASH*' })
            cues.push({ at: now + 3300, text: 'oops :3' })
          }
        }
        await plan(now, mood, here, activity, chain)
      }
      if (mood !== c.mood) await update($, cat, x => ({ ...x, mood }))
    }

    // Terminal only: repaint the lane in place, ten times a second.
    const repaint = async () => {
      if (!site || (await read($, isHidden))) return
      const now = await $.clock.now()
      const p = await read($, prefs)
      const pal = PALETTES[p.coat] ?? PALETTES.orange
      const extras: Extras = {
        ctx: (await read($, limits)).context,
        identity: await read($, identity),
        hat: p.hat ?? 'none',
        hour: new Date().getHours(),
      }
      const cells = laneCells(await read($, cat), await read($, motion), now, pal, site.cols, p.scene ?? 'clear', extras)
      const res = await $.ui.blit({ requestId: site.requestId, key: 'lane', cells, columns: site.cols, rows: 5 })
      if ('deny' in res && res.deny) site = null
    }

    wake = async (mood: Mood, say: string | null, holdMs: number, prop?: ToolProp | null) => {
      const now = await $.clock.now()
      lastActivity = now
      cues = []
      const wasAsleep = (await read($, cat)).mood === 'sleep'
      if (say) sayUntil = now + Math.max(holdMs, 3000)
      moodUntil = now + holdMs
      const m = await read($, motion)
      const here = posAt(m, now)
      if (mood === 'working' && prop) {
        // Sit down with the right prop, facing the side with room for it.
        await update($, motion, () => ({ from: here, to: here, t0: now, dur: holdMs, activity: 'busy' as Activity }))
        await update($, cat, c => ({ ...c, dir: here < 0.5 ? 1 : -1 }))
      } else if (mood === 'working') {
        if (!isWalking(m, now) || m.activity !== 'walk') await plan(now, 'working', here, 'walk')
      } else {
        await update($, motion, () => ({ from: here, to: here, t0: now, dur: holdMs, activity: 'sit' as Activity }))
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

    const saved = (await $.store.get('prefs')) as Partial<Prefs> | undefined
    if (saved) await update($, prefs, () => ({ ...DEFAULT_PREFS, ...saved }))
    // This cat's own look, rolled once: a marking, and a 1 in 50 chance of shiny.
    let who = (await $.store.get('identity')) as Identity | undefined
    if (!who) {
      who = { marking: MARKINGS[Math.floor(Math.random() * MARKINGS.length)], shiny: Math.random() < 1 / 50 }
      await $.store.set('identity', who)
    }
    await update($, identity, () => who as Identity)
    const counts = (await $.store.get('stats')) as Stats | undefined
    if (counts) await update($, stats, () => ({ turns: counts.turns ?? 0, tools: counts.tools ?? 0 }))

    $.clock.every(BRAIN_MS, () => void brain())
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
    for (const h of await bumpStats($, s => ({ ...s, tools: s.tools + 1 }))) {
      await toast($, `🎩 Your cat unlocked a hat: ${h.label}! Wear it from ⚙ → Hat`)
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
    if (e.reason === 'answer') {
      await wake('done', `done! ${secs}s`, 8000)
      for (const h of await bumpStats($, s => ({ ...s, turns: s.turns + 1 }))) {
        await toast($, `🎩 Your cat unlocked a hat: ${h.label}! Wear it from ⚙ → Hat`)
        await wake('pet', `new hat: ${h.label}!`, 4000)
      }
      if (secs >= ANNOUNCE_AFTER_S) await toast($, `🐱 Claude finished (${secs}s)`)
    } else if (e.reason === 'aborted') {
      await wake('sit', 'ok, stopped', 4000)
    } else {
      await wake('oops', 'hit an error :(', 6000)
      await toast($, '🐱 Claude stopped on an error')
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const find = (kind: string) => e.rateLimits.find(r => r.kind === kind)
    const five = find('five_hour')
    const week = find('seven_day')
    const before = (await read($, limits)).context
    const after = e.context.percent ?? null
    if (before !== null && after !== null && before - after >= 20) await wake('pet', 'nom nom! bowl refilled', 3000)
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
          await toast($, `🐱 ${label} usage at ${pct}%`)
          await wake('tired', `${label} at ${pct}%…`, 6000)
        }
      }
    }

    return next(e)
  })

  on('command.run', { command: 'cat' }, async $ => {
    const wasHidden = await read($, isHidden)
    await update($, isHidden, () => !wasHidden)
    const l = await read($, limits)
    const who = await read($, identity)
    const st = await read($, stats)
    const owned = unlockedHats(st)
    const nextHat = HATS.find(h => !h.need(st))
    const pct = (p: number | null) => (p === null ? 'n/a' : `${p}%`)
    return {
      text: [
        wasHidden ? 'Cat is back 🐱' : 'Cat hidden (run /cat again to bring it back).',
        `5-hour limit: ${pct(l.fiveHour)}${fmtReset(l.fiveHourResets)}`,
        `7-day limit: ${pct(l.sevenDay)}`,
        `Context: ${pct(l.context)}`,
        '',
        `Your cat: ${who.marking === 'none' ? 'plain coat' : `${who.marking} marking`}${who.shiny ? ', ✨ shiny (1 in 50)!' : ''}`,
        `Tasks finished: ${st.turns}, tool calls: ${st.tools}`,
        `Hats: ${owned.length ? owned.join(', ') : 'none yet'}${nextHat ? ` (next: ${nextHat.label} at ${nextHat.hint})` : ''}`,
      ].join('\n'),
    }
  })

  on('ui.press', { plugin: 'pixel-cat', element: 'pet' }, async $ => {
    const asleep = (await read($, cat)).mood === 'sleep'
    const lines = asleep ? ['mrrp?', '*yawn*'] : ['purrr ♥', 'mrrp!', '♥ ♥ ♥', 'more pets pls']
    await wake('pet', lines[Math.floor(Math.random() * lines.length)], 3000)
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

  on('ui.press', { plugin: 'pixel-cat', element: 'set-coat' }, async $ => {
    await setPrefs($, p => ({ ...p, coat: cycle(COATS, p.coat) }))
    await wake('pet', 'new look!', 2500)
    return { element: 'set-coat' }
  })

  on('ui.press', { plugin: 'pixel-cat', element: 'set-speed' }, async $ => {
    await setPrefs($, p => ({ ...p, speed: cycle(SPEEDS, p.speed) }))
    return { element: 'set-speed' }
  })

  on('ui.press', { plugin: 'pixel-cat', element: 'set-scene' }, async $ => {
    await setPrefs($, p => ({ ...p, scene: cycle(SCENES, p.scene ?? 'clear') }))
    return { element: 'set-scene' }
  })

  on('ui.press', { plugin: 'pixel-cat', element: 'set-popups' }, async $ => {
    await setPrefs($, p => ({ ...p, popups: !p.popups }))
    return { element: 'set-popups' }
  })

  on('ui.press', { plugin: 'pixel-cat', element: 'set-hat' }, async $ => {
    const owned = unlockedHats(await read($, stats))
    if (owned.length === 0) {
      await wake('sit', `no hats yet! (${HATS[0].hint})`, 3500)
    } else {
      await setPrefs($, p => ({ ...p, hat: cycle(['none', ...owned] as Hat[], owned.includes(p.hat) ? p.hat : 'none') }))
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

    const { Box, Text, Button, Raster, Svg } = $.ui.resolve(e) as any
    const now = await $.clock.now()
    const c = await read($, cat)
    const m = await read($, motion)
    const l = await read($, limits)
    const pr = await read($, prefs)
    const isSetting = await read($, isSettingsOpen)
    const who = await read($, identity)
    const st = await read($, stats)
    const extras: Extras = { ctx: l.context, identity: who, hat: pr.hat ?? 'none', hour: new Date().getHours() }
    const isOnStats = m.activity === 'sitmeter' && now < m.t0 + m.dur
    const pal = PALETTES[pr.coat] ?? PALETTES.orange
    const columns = e.viewport?.columns ?? 80

    let lane
    if (e.surface === 'terminal') {
      const cols = Math.max(SPRITE_W + 1, Math.min(512, columns - 2))
      site = { requestId: e.requestId, cols }
      lane = <Raster key="lane" columns={cols} rows={5} cells={laneCells(c, m, now, pal, cols, pr.scene ?? 'clear', extras)} />
    } else {
      lane = (
        <Svg
          source={laneSvg(c, m, now, pal, pr.scene ?? 'clear', extras)}
          alt={`Claude cat (${c.mood})${c.say ? `: ${c.say}` : ''}`}
          width={Math.max(240, Math.round((columns - 2) * DESKTOP_PX_PER_COLUMN))}
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
              <Button key="set-coat" label={`Coat: ${title(pr.coat)}`} onPress={ignorePress} />
              <Button key="set-speed" label={`Speed: ${title(pr.speed)}`} onPress={ignorePress} />
              <Button key="set-scene" label={`Scene: ${title(pr.scene ?? 'clear')}`} onPress={ignorePress} />
              <Button key="set-hat" label={unlockedHats(st).length ? `Hat: ${title(pr.hat ?? 'none')}` : 'Hat: 🔒'} onPress={ignorePress} />
              <Button key="set-popups" label={`Popups: ${pr.popups ? 'On' : 'Off'}`} onPress={ignorePress} />
              <Button key="set-usage" label={`Usage: ${pr.showUsage ? 'On' : 'Off'}`} onPress={ignorePress} />
            </Box>
          ) : pr.showUsage && isOnStats ? (
            <Text dimColor wrap="truncate-end">
              🐾 your cat is sitting on your stats (Pet to move it)
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
            <Button key="hide" label="Hide" onPress={ignorePress} />
          </Box>
        </Box>
      </Box>
    )
  })
}
