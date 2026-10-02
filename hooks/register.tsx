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
  ['walk', 26], ['sit', 16], ['nap', 14], ['hop', 9], ['yarn', 12], ['mouse', 11], ['butterfly', 12],
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
}

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
const TOYS: Palette = {
  y: 0xe0566b,
  Y: 0xf5a3ae,
  g: 0xa7adb4,
  K: 0x1f1e1d,
  t: 0xf4a4a0,
  B: 0x8f8cf2,
  k: 0x2b2840,
}

function posture(c: Cat, m: Motion, now: number): 'walk' | 'sit' | 'loaf' {
  if (c.mood === 'sleep') return 'loaf'
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
const LANE_H = 30
// The desktop reports its width in monospace columns; the SVG wants pixels.
const DESKTOP_PX_PER_COLUMN = 8.4
const MAX_X = 85 // the cat's left edge travels 0%..85% of the lane

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
      <animate attributeName="y" values="8;-6" dur="1.6s" begin="${delay}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;1;0" dur="1.6s" begin="${delay}s" repeatCount="indefinite"/>
    </text>`
  if (isNapping) return drift('z', 24, 0, hex(QUIET_COLOR), 9) + drift('Z', 30, 0.8, hex(QUIET_COLOR), 11)
  if (c.mood === 'pet') return drift('♥', 6, 0, '#db61a2', 9) + drift('♥', 26, 0.5, '#db61a2', 8)
  return ''
}

// The toy or critter on this leg, in the cat's own coordinates (0..36),
// placed ahead of the cat in the direction it faces.
function companionSvg(m: Motion, dir: 1 | -1, walking: boolean, remaining: number): string {
  const ahead = (w: number) => (dir === 1 ? CAT_W + 3 : -w - 3)
  const flip = (rows: string[]) => (dir === 1 ? faceRight(rows) : rows)
  const until = walking ? remaining : undefined
  if (m.activity === 'yarn') {
    const s = 5 * PX
    const x = ahead(s)
    const spin = walking
      ? `<animateTransform attributeName="transform" type="rotate" from="0 ${s / 2} ${s / 2}" to="${dir * 360} ${s / 2} ${s / 2}" dur="0.7s" repeatDur="${Math.round(remaining)}ms"/>`
      : ''
    return `<g transform="translate(${x} ${LANE_H - s})"><g>${spin}${rects(YARN, TOYS)}</g></g>`
  }
  if (m.activity === 'mouse') {
    const w = 7 * PX
    return `<g transform="translate(${ahead(w) - dir * 6} ${LANE_H - 4 * PX})">${frames(rects(flip(MOUSE_A), TOYS), rects(flip(MOUSE_B), TOYS), 0.16, until)}</g>`
  }
  if (m.activity === 'butterfly') {
    const w = 5 * PX
    return `<g transform="translate(${ahead(w)} 4)"><g>
      <animateTransform attributeName="transform" type="translate" values="0 0;4 -3;1 2;-3 -1;0 0" dur="1.8s" repeatCount="indefinite"/>
      ${frames(rects(FLY_OPEN, TOYS), rects(FLY_SHUT, TOYS), 0.25)}
    </g></g>`
  }
  return ''
}

export function laneSvg(c: Cat, m: Motion, now: number, pal: Palette, scene: Scene): string {
  const cur = posAt(m, now)
  const walking = isWalking(m, now)
  const remaining = walking ? m.t0 + m.dur - now : 0
  const dir = m.to > m.from && walking ? 1 : m.to < m.from && walking ? -1 : c.dir
  const pct = (p: number) => `${(clamp01(p) * MAX_X).toFixed(3)}%`
  const flip = (rows: string[]) => (dir === 1 ? faceRight(rows) : rows)
  const pose = posture(c, m, now)
  const eyes = (rows: string[]) => (isHappy(c.mood) ? closeEyes(rows) : rows)

  let body: string
  if (pose === 'loaf') {
    body = rects(flip(LOAF.map(r => r.replace(/[HK]/g, 'd'))), pal)
  } else if (pose === 'walk') {
    const legs = c.mood === 'working' || m.activity === 'mouse' ? 0.2 : 0.32
    body = frames(rects(flip(eyes(WALK_A)), pal), rects(flip(eyes(WALK_B)), pal), legs, remaining)
  } else {
    body = frames(rects(flip(eyes(SIT)), pal), rects(flip(eyes(SIT_WAG)), pal), 1.2)
  }
  // Blinks: closed-eye pixels laid over the open eyes for a moment.
  if (pose !== 'loaf' && !isHappy(c.mood)) {
    const open = flip(pose === 'walk' ? WALK_A : SIT)
    const shut = flip(closeEyes(pose === 'walk' ? WALK_A : SIT))
    body += `<g opacity="0">${rects(shut, pal, open)}<animate attributeName="opacity" values="0;1;0" keyTimes="0;0.95;0.98" dur="4s" calcMode="discrete" repeatCount="indefinite"/></g>`
  }

  const bounce = c.mood === 'oops'
    ? '<animateTransform attributeName="transform" type="translate" values="-2 0;2 0;-2 0" dur="0.12s" repeatCount="indefinite"/>'
    : c.mood === 'done'
      ? '<animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" dur="0.35s" repeatCount="3"/>'
      : walking && m.activity === 'hop'
        ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -7;0 0" keyTimes="0;0.4;1" dur="0.45s" repeatDur="${Math.round(remaining)}ms"/>`
        : ''
  const glide = walking
    ? `<animate attributeName="x" from="${pct(cur)}" to="${pct(m.to)}" dur="${Math.round(remaining)}ms" fill="freeze"/>`
    : ''
  const tint = MOOD_COLOR[c.mood] ?? QUIET_COLOR
  const hasCompanion = m.activity === 'yarn' || m.activity === 'mouse' || m.activity === 'butterfly'
  const bubbleLeft = hasCompanion && now < m.t0 + m.dur ? dir === 1 : Math.max(cur, m.to) > 0.55
  const isNapping = pose === 'loaf'

  // color-scheme lets the frame follow the app's light or dark appearance,
  // so a Clear lane stays see-through instead of a white page.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${LANE_H}" overflow="visible" style="background:transparent">
  <style>:root{color-scheme:light dark;background:transparent}</style>
  ${sceneSvg(scene)}
  <svg x="${pct(cur)}" y="0" width="${CAT_W}" height="${LANE_H}" overflow="visible">${glide}
    <g shape-rendering="crispEdges">
      ${now < m.t0 + m.dur || !walking ? companionSvg(m, dir, walking, remaining) : ''}
      <g>${bounce}${body}</g>
    </g>
    ${floaters(c, isNapping)}
    ${isNapping ? '' : bubbleSvg(c, bubbleLeft, tint)}
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
  const dir = m.to > m.from && walking ? 1 : m.to < m.from && walking ? -1 : c.dir
  const span = Math.max(0, cols - SPRITE_W - 1)
  const shake = c.mood === 'oops' ? (Math.floor(now / 120) % 2 ? 1 : -1) : 0
  const cx = Math.max(0, Math.min(span, Math.round(posAt(m, now) * span) + shake))
  const pose = posture(c, m, now)
  const flip = (rows: string[]) => (dir === 1 ? faceRight(rows) : rows)

  let rows: string[]
  if (pose === 'loaf') rows = LOAF.map(r => r.replace(/[HK]/g, 'd'))
  else if (pose === 'walk') rows = Math.floor(now / (c.mood === 'working' || m.activity === 'mouse' ? 100 : 160)) % 2 ? WALK_B : WALK_A
  else rows = Math.floor(now / 600) % 2 ? SIT_WAG : SIT
  if (pose !== 'loaf' && (isHappy(c.mood) || now % 4000 > 3850)) rows = closeEyes(rows)
  const hop = walking && m.activity === 'hop' && Math.floor(now / 225) % 2 ? -2 : 0
  plot(flip(rows), cx, hop, pal)

  // Companions ahead of the cat.
  const busy = now < m.t0 + m.dur
  const ahead = (w: number) => (dir === 1 ? cx + SPRITE_W + 1 : cx - w - 1)
  if (busy && m.activity === 'yarn') plot(YARN, ahead(5), PIX - 5, TOYS)
  if (busy && m.activity === 'mouse') plot(flip(Math.floor(now / 80) % 2 ? MOUSE_B : MOUSE_A), ahead(7) + dir * 2, PIX - 4, TOYS)
  if (busy && m.activity === 'butterfly') {
    plot(Math.floor(now / 250) % 2 ? FLY_SHUT : FLY_OPEN, ahead(5) + (Math.floor(now / 700) % 2), Math.floor(now / 500) % 2, TOYS)
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
    const zx = dir === 1 ? cx + SPRITE_W : cx - 4
    for (let i = 0; i < z.length; i++) put(zx + i, 1, z[i], QUIET_COLOR)
  }

  const line = pose === 'loaf' ? null : terminalLine(c, now)
  if (line) {
    const tint = MOOD_COLOR[c.mood] ?? QUIET_COLOR
    const bw = line.length + 4
    const right = cx + SPRITE_W + 1
    const isLeft = right + bw > cols && cx - 1 - bw >= 0
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
    const plan = async (now: number, mood: Mood, from: number, activity: Activity) => {
      const p = await read($, prefs)
      if (activity === 'sit' || activity === 'nap') {
        const dur = activity === 'nap' ? 15_000 + Math.random() * 30_000 : 2000 + Math.random() * 4000
        await update($, motion, () => ({ from, to: from, t0: now, dur, activity }))
        return
      }
      const base = mood === 'working' ? RUN_PACE[p.speed] : mood === 'tired' ? TIRED_PACE : PACE[p.speed]
      const boost = activity === 'mouse' ? 3 : activity === 'yarn' ? 1.8 : activity === 'hop' ? 1.4 : activity === 'butterfly' ? 0.8 : 1
      const pace = mood === 'working' ? base : base * boost
      let to = Math.random()
      if (Math.abs(to - from) < 0.2) to = from < 0.5 ? from + 0.3 + Math.random() * 0.4 : from - 0.3 - Math.random() * 0.4
      to = clamp01(to)
      const dur = Math.max(800, (Math.abs(to - from) / pace) * 1000)
      await update($, motion, () => ({ from, to, t0: now, dur, activity }))
      await update($, cat, c => ({ ...c, dir: to > from ? 1 : -1 }))
    }

    // Once a second: expire lines and moods, nap, and pick the next leg.
    const brain = async () => {
      const now = await $.clock.now()
      const c = await read($, cat)
      const m = await read($, motion)
      const isLow = ((await read($, limits)).fiveHour ?? 0) >= 80
      const here = posAt(m, now)
      let mood = c.mood

      if (c.say && now > sayUntil) await update($, cat, x => ({ ...x, say: null }))
      if (now > moodUntil && (mood === 'done' || mood === 'oops' || mood === 'pet')) mood = 'sit'
      if (mood !== 'working' && mood !== 'sleep' && now - lastActivity > NAP_AFTER_MS) {
        await update($, cat, x => ({ ...x, mood: 'sleep', say: null }))
        await update($, motion, () => ({ from: here, to: here, t0: now, dur: 0 }))
        return
      }
      if (mood === 'sleep') return

      if (now >= m.t0 + m.dur) {
        let activity: Activity = 'walk'
        if (mood !== 'working') {
          mood = isLow ? 'tired' : 'idle'
          activity = pick(isLow ? TIRED_ACTIVITIES : IDLE_ACTIVITIES)
          if (activity === 'sit') mood = 'sit'
          // Now and then, say something about it.
          const lines = LINES[activity]
          if (lines && !c.say && Math.random() < 0.5) {
            sayUntil = now + 2500
            await update($, cat, x => ({ ...x, say: lines[Math.floor(Math.random() * lines.length)], sayAt: now }))
          }
        }
        await plan(now, mood, here, activity)
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
      if (say) sayUntil = now + Math.max(holdMs, 3000)
      moodUntil = now + holdMs
      const m = await read($, motion)
      const here = posAt(m, now)
      if (mood === 'working') {
        if (!isWalking(m, now) || m.activity !== 'walk') await plan(now, 'working', here, 'walk')
      } else {
        await update($, motion, () => ({ from: here, to: here, t0: now, dur: holdMs, activity: 'sit' as Activity }))
      }
      await update($, cat, c => ({ ...c, mood, say: say ?? c.say, sayAt: say ? now : c.sayAt }))
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
