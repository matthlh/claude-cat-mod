import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Activity, Cat, Coat, Limits, Mood, Motion, Prefs, Scene, Speed } from '../types'

// ── State ────────────────────────────────────────────────────────────────
// The hooks only write state when something changes (a mood, a line, a new
// leg of the walk). The frames in between are drawn by the surfaces: the
// desktop SVG animates itself, and the terminal lane is repainted in place.

const cat = atom({ plugin: 'claude-cat', key: 'cat' } as const, {
  mood: 'idle',
  dir: 1,
  say: 'hi!',
  sayAt: 0,
} as Cat)
const motion = atom({ plugin: 'claude-cat', key: 'motion' } as const, {
  from: 0.1,
  to: 0.1,
  t0: 0,
  dur: 0,
} as Motion)
const limits = atom({ plugin: 'claude-cat', key: 'limits' } as const, {
  fiveHour: null,
  sevenDay: null,
  context: null,
  fiveHourResets: null,
} as Limits)
const isHidden = atom({ plugin: 'claude-cat', key: 'isHidden' } as const, false)
const DEFAULT_PREFS: Prefs = { coat: 'orange', speed: 'normal', scene: 'clear', popups: true, showUsage: true }
const prefs = atom({ plugin: 'claude-cat', key: 'prefs' } as const, {
  coat: 'orange',
  speed: 'normal',
  scene: 'clear',
  popups: true,
  showUsage: true,
} as Prefs)
const isSettingsOpen = atom({ plugin: 'claude-cat', key: 'isSettingsOpen' } as const, false)

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
const IDLE_ACTIVITIES: [Activity, number][] = [
  ['walk', 22], ['sit', 13], ['nap', 12], ['hop', 8], ['yarn', 10], ['mouse', 10], ['butterfly', 9],
  ['fish', 9], ['bird', 8], ['laser', 7],
]
const TIRED_ACTIVITIES: [Activity, number][] = [['walk', 25], ['sit', 30], ['nap', 45]]

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
  fish: ['fishing…', 'fishy fishy', 'shh, fish'],
  bird: ['shhh…', 'birb.', 'stalking…'],
  laser: ['THE DOT', 'red dot!!', 'gotta get it'],
  caught: ['got it!', 'gotcha!'],
  flyaway: ['nom?!', 'nom nom'],
}

// Activities that happen on the spot, and how long they last (ms).
function stillFor(a: Activity): number | null {
  if (a === 'sit') return 2000 + Math.random() * 4000
  if (a === 'nap') return 15_000 + Math.random() * 30_000
  if (a === 'fish') return 7000 + Math.random() * 4000
  if (a === 'caught' || a === 'flyaway') return 3000
  return null
}

// Activities with a toy or critter ahead of the cat.
const WITH_COMPANION = new Set<Activity | undefined>(['yarn', 'mouse', 'butterfly', 'bird', 'laser', 'fish', 'caught', 'flyaway'])

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
function sceneSvg(scene: Scene): string {
  const H = LANE_H
  if (scene === 'grass') {
    const tufts = [6, 19, 33, 47, 61, 74, 88]
      .map(p => `<svg x="${p}%" y="${H - 11}" overflow="visible"><path d="M0 6 l2 -5 l1 5 l2 -6 l1 6" fill="none" stroke="#4f9a5a" stroke-width="1.2"/></svg>`)
      .join('')
    return `<rect x="0" y="${H - 5}" width="100%" height="5" rx="2" fill="#2f6b3a"/>${tufts}`
  }
  if (scene === 'night') {
    const stars = [[4, 6], [13, 18], [22, 5], [37, 11], [51, 4], [63, 16], [71, 7], [83, 13], [95, 5]]
      .map(([p, y], i) => `<circle cx="${p}%" cy="${y}" r="0.9" fill="#e8e6ff"><animate attributeName="opacity" values="1;0.2;1" dur="${2 + (i % 3)}s" begin="${i * 0.37}s" repeatCount="indefinite"/></circle>`)
      .join('')
    return `<rect x="0" y="0" width="100%" height="${H}" rx="6" fill="#141a2e"/>${stars}<circle cx="92%" cy="9" r="5" fill="#f2e9c9"/><circle cx="91%" cy="8" r="5" fill="#141a2e" transform="translate(-3 -1)"/>`
  }
  if (scene === 'cozy') {
    return `<rect x="0" y="0" width="100%" height="${H}" rx="6" fill="#3a2c24"/><rect x="0" y="${H - 4}" width="100%" height="4" fill="#5a4334"/><rect x="70%" y="${H - 7}" width="18%" height="3" rx="1.5" fill="#a2554a" opacity="0.8"/>`
  }
  return ''
}

// ── Desktop: one self-animating SVG for the whole lane ──────────────────

const PX = 3 // CSS pixels per sprite pixel
const CAT_W = SPRITE_W * PX // 36
const CAT_H = 30
// Room above the cat so hops and bounces don't clip its head.
const HEADROOM = 8
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
function companionSvg(m: Motion, dir: 1 | -1, walking: boolean, remaining: number, now: number, scene: Scene): string {
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

// A bird pecking at the spot the cat is creeping toward, in lane coordinates.
function stalkedBirdSvg(m: Motion, dir: 1 | -1, now: number, pct: (p: number) => string): string {
  if (m.activity !== 'bird' || now >= m.t0 + m.dur) return ''
  const flip = (rows: string[]) => (dir === 1 ? faceRight(rows) : rows)
  const x = dir === 1 ? CAT_W + 3 : -5 * PX - 3
  return `<svg x="${pct(m.to)}" y="${HEADROOM}" width="${CAT_W}" height="${CAT_H}" overflow="visible">
    <g shape-rendering="crispEdges" transform="translate(${x} ${CAT_H - 4 * PX})">${frames(rects(flip(BIRD), TOYS), rects(flip(BIRD_PECK), TOYS), 0.7)}</g>
  </svg>`
}

export function laneSvg(c: Cat, m: Motion, now: number, pal: Palette, scene: Scene): string {
  const cur = posAt(m, now)
  const walking = isWalking(m, now)
  const busy = now < m.t0 + m.dur
  const remaining = walking ? m.t0 + m.dur - now : 0
  const dir = m.to > m.from && walking ? 1 : m.to < m.from && walking ? -1 : c.dir
  const pct = (p: number) => `${(clamp01(p) * MAX_X).toFixed(3)}%`
  const flip = (rows: string[]) => (dir === 1 ? faceRight(rows) : rows)
  const pose = posture(c, m, now)
  const eyes = (rows: string[]) => (isHappy(c.mood) ? closeEyes(rows) : rows)
  const at = (ms: number) => `${Math.round(m.t0 + ms - now)}ms`

  let body: string
  if (pose === 'loaf') {
    body = rects(flip(LOAF.map(r => r.replace(/[HK]/g, 'd'))), pal)
  } else if (pose === 'walk') {
    const legs = c.mood === 'working' || m.activity === 'mouse' || m.activity === 'laser' ? 0.2 : m.activity === 'bird' ? 0.6 : 0.32
    body = frames(rects(flip(eyes(WALK_A)), pal), rects(flip(eyes(WALK_B)), pal), legs, remaining)
  } else if (busy && m.activity === 'fish') {
    body = frames(rects(flip(eyes(SIT)), pal), rects(flip(eyes(SIT_PAW)), pal), 1)
  } else if (busy && m.activity === 'caught') {
    body = rects(flip(eyes(SIT_PAW)), pal)
  } else {
    body = frames(rects(flip(eyes(SIT)), pal), rects(flip(eyes(SIT_WAG)), pal), 1.2)
  }
  // Blinks: closed-eye pixels laid over the open eyes for a moment.
  if (pose !== 'loaf' && !isHappy(c.mood)) {
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
  ${sceneSvg(scene)}
  ${perchSvg(c, m, now, scene)}
  ${stalkedBirdSvg(m, dir, now, pct)}
  <svg x="${pct(cur)}" y="${HEADROOM}" width="${CAT_W}" height="${CAT_H}" overflow="visible">${glide}
    ${perchOpen}
    <g shape-rendering="crispEdges">
      ${busy || !walking ? companionSvg(m, dir, walking, remaining, now, scene) : ''}
      <g>${bounce}${body}</g>
    </g>
    ${floatX ? '' : floaters(c, isNapping)}
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

export function laneCells(c: Cat, m: Motion, now: number, pal: Palette, cols: number, scene: Scene): string {
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
  plot(flip(rows), cx, cy, pal)

  // Companions ahead of the cat.
  const ahead = (w: number) => (dir === 1 ? cx + SPRITE_W + 1 : cx - w - 1)
  const wings = Math.floor(now / 180) % 2 ? BIRD_DOWN : BIRD_UP
  if (busy && m.activity === 'yarn') plot(YARN, ahead(5), PIX - 5, TOYS)
  if (busy && m.activity === 'mouse') plot(flip(Math.floor(now / 80) % 2 ? MOUSE_B : MOUSE_A), ahead(7) + dir * 2, PIX - 4, TOYS)
  if (busy && m.activity === 'butterfly') {
    plot(Math.floor(now / 250) % 2 ? FLY_SHUT : FLY_OPEN, ahead(5) + (Math.floor(now / 700) % 2), Math.floor(now / 500) % 2, TOYS)
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
  let wake: (mood: Mood, say: string | null, holdMs: number) => Promise<void> = async () => {}

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

      if (now >= m.t0 + m.dur) {
        let activity: Activity = 'walk'
        let chain: number | undefined
        if (mood !== 'working') {
          mood = isLow ? 'tired' : 'idle'
          // Some activities lead into the next: a chased mouse may get
          // caught, a stalked bird gets pounced on, the laser zips again.
          let line: string | null = null
          if (m.activity === 'mouse' && Math.random() < 0.6) activity = 'caught'
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
            activity = pick(isLow ? TIRED_ACTIVITIES : IDLE_ACTIVITIES)
            if (activity === 'laser') chain = 2 + Math.floor(Math.random() * 3)
          }
          if (activity === 'sit') mood = 'sit'
          // Now and then, say something about it.
          const lines = LINES[activity]
          const isFollowUp = activity === 'caught' || activity === 'flyaway'
          const isRepeat = activity === 'laser' && m.activity === 'laser'
          if (!line && lines && !isRepeat && (isFollowUp || (!c.say && Math.random() < 0.5))) {
            line = lines[Math.floor(Math.random() * lines.length)]
          }
          if (line) await say(now, line)
          if (activity === 'caught') cues.push({ at: now + 2100, text: 'hey! come back' })
          if (activity === 'flyaway') cues.push({ at: now + 1600, text: 'nooo come back' })
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
      const cells = laneCells(await read($, cat), await read($, motion), now, pal, site.cols, p.scene ?? 'clear')
      const res = await $.ui.blit({ requestId: site.requestId, key: 'lane', cells, columns: site.cols, rows: 5 })
      if ('deny' in res && res.deny) site = null
    }

    wake = async (mood: Mood, say: string | null, holdMs: number) => {
      const now = await $.clock.now()
      lastActivity = now
      cues = []
      const wasAsleep = (await read($, cat)).mood === 'sleep'
      if (say) sayUntil = now + Math.max(holdMs, 3000)
      moodUntil = now + holdMs
      const m = await read($, motion)
      const here = posAt(m, now)
      if (mood === 'working') {
        if (!isWalking(m, now) || m.activity !== 'walk') await plan(now, 'working', here, 'walk')
      } else {
        await update($, motion, () => ({ from: here, to: here, t0: now, dur: holdMs, activity: 'sit' as Activity }))
      }
      await update($, cat, c => ({ ...c, mood, say: say ?? c.say, sayAt: say ? now : c.sayAt, wokeAt: wasAsleep ? now : c.wokeAt }))
    }

    const saved = (await $.store.get('prefs')) as Partial<Prefs> | undefined
    if (saved) await update($, prefs, () => ({ ...DEFAULT_PREFS, ...saved }))

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
    await wake('working', `${name}…`, 60 * 60_000)
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError === true) {
      await wake('oops', `${name} failed`, 4000)
      await wake('working', null, 60 * 60_000)
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const secs = Math.round(((await $.clock.now()) - turnStartedAt) / 1000)
    if (e.reason === 'answer') {
      await wake('done', `done! ${secs}s`, 8000)
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
    const pct = (p: number | null) => (p === null ? 'n/a' : `${p}%`)
    return {
      text: [
        wasHidden ? 'Cat is back 🐱' : 'Cat hidden (run /cat again to bring it back).',
        `5-hour limit: ${pct(l.fiveHour)}${fmtReset(l.fiveHourResets)}`,
        `7-day limit: ${pct(l.sevenDay)}`,
        `Context: ${pct(l.context)}`,
      ].join('\n'),
    }
  })

  on('ui.press', { plugin: 'claude-cat', element: 'pet' }, async () => {
    await wake('pet', 'purrr ♥', 3000)
    return { element: 'pet' }
  })

  on('ui.press', { plugin: 'claude-cat', element: 'hide' }, async $ => {
    await update($, isHidden, () => true)
    return { element: 'hide' }
  })

  on('ui.press', { plugin: 'claude-cat', element: 'settings' }, async $ => {
    await update($, isSettingsOpen, open => !open)
    return { element: 'settings' }
  })

  on('ui.press', { plugin: 'claude-cat', element: 'set-coat' }, async $ => {
    await setPrefs($, p => ({ ...p, coat: cycle(COATS, p.coat) }))
    await wake('pet', 'new look!', 2500)
    return { element: 'set-coat' }
  })

  on('ui.press', { plugin: 'claude-cat', element: 'set-speed' }, async $ => {
    await setPrefs($, p => ({ ...p, speed: cycle(SPEEDS, p.speed) }))
    return { element: 'set-speed' }
  })

  on('ui.press', { plugin: 'claude-cat', element: 'set-scene' }, async $ => {
    await setPrefs($, p => ({ ...p, scene: cycle(SCENES, p.scene ?? 'clear') }))
    return { element: 'set-scene' }
  })

  on('ui.press', { plugin: 'claude-cat', element: 'set-popups' }, async $ => {
    await setPrefs($, p => ({ ...p, popups: !p.popups }))
    return { element: 'set-popups' }
  })

  on('ui.press', { plugin: 'claude-cat', element: 'set-usage' }, async $ => {
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
    const pal = PALETTES[pr.coat] ?? PALETTES.orange
    const columns = e.viewport?.columns ?? 80

    let lane
    if (e.surface === 'terminal') {
      const cols = Math.max(SPRITE_W + 1, Math.min(512, columns - 2))
      site = { requestId: e.requestId, cols }
      lane = <Raster key="lane" columns={cols} rows={5} cells={laneCells(c, m, now, pal, cols, pr.scene ?? 'clear')} />
    } else {
      lane = (
        <Svg
          source={laneSvg(c, m, now, pal, pr.scene ?? 'clear')}
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
              <Button key="set-popups" label={`Popups: ${pr.popups ? 'On' : 'Off'}`} onPress={ignorePress} />
              <Button key="set-usage" label={`Usage: ${pr.showUsage ? 'On' : 'Off'}`} onPress={ignorePress} />
            </Box>
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
            <Button key="pet" label="Pet" onPress={ignorePress} />
            <Button key="settings" label={isSetting ? 'Done' : '⚙'} onPress={ignorePress} />
            <Button key="hide" label="Hide" onPress={ignorePress} />
          </Box>
        </Box>
      </Box>
    )
  })
}
