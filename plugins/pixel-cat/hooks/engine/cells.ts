import type { HeroState, Motion } from '../../types'
import type { CellsCtx, Pack, Palette, Rows } from '../packs/types'
import { crewCells, joiningSlots, terminalCap } from './crew'
import { faceRight } from './draw'
import { HAT_PAD, HERO_COLS, LANE_PIX, LANE_ROWS, TERMINAL_DEFAULT } from './geometry'
import { bedShown, hasCompanion, isHappy, isInBed, lane, lookOf, moodColor, QUIET_COLOR, shut, wear } from './lane'
import type { Extras, Lane } from './lane'
import { posAt } from './motion'
import { hourOf, phaseAt } from './time'

// ── Terminal: the lane is one Raster, repainted in place ────────────────

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

// Only printable ASCII goes into Raster cells, so nothing is double width.
function ascii(s: string): string {
  return s.replace(/…/g, '...').replace(/♥/g, '<3').replace(/[^\x20-\x7e]/g, '')
}

function terminalLine(c: HeroState, now: number): string | null {
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

// The hero's sprite this frame, facing left, before it's dressed.
function heroRows(pack: Pack, c: HeroState, l: Lane, now: number): Rows {
  const { hero } = pack
  if (l.posture === 'asleep') return hero.asleep
  let rows: Rows
  if (l.posture === 'walk') {
    const stride = c.mood === 'working' ? hero.rush : l.act?.stride ?? hero.stride
    rows = hero.walk[Math.floor(now / stride) % 2] ?? hero.walk[0]
  } else {
    const p = l.pose ?? hero.idle
    rows = p.frames[Math.floor(now / (p.tick ?? 500)) % p.frames.length] ?? p.frames[0]
    if (p.shut) return rows
  }
  return isHappy(c.mood) || now % 4000 > 3850 ? shut(hero, rows) : rows
}

export function laneCells(pack: Pack, c: HeroState, m: Motion, now: number, palette: Palette, cols: number, sceneId: string, x: Extras = {}): string {
  const l = lane(pack, c, m, now, sceneId)
  const { act, walking, busy, dir, scene } = l
  const bg = scene.bg
  // Paint pixels first (cols x 10), then pack two per cell with half blocks.
  const pixels: (number | undefined)[] = new Array(cols * LANE_PIX)
  const plot = (rows: Rows, x0: number, y0: number, colors: Palette) => {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const color = colors[row.charAt(x)]
        const px = x0 + x
        const py = y0 + y
        if (color !== undefined && px >= 0 && px < cols && py >= 0 && py < LANE_PIX) pixels[py * cols + px] = color
      }
    })
  }

  const elapsed = now - m.t0
  const span = Math.max(0, cols - HERO_COLS - 1)
  const shake = c.mood === 'oops' ? (Math.floor(now / 120) % 2 ? 1 : -1) : 0
  let cx = Math.max(0, Math.min(span, Math.round(posAt(m, now) * span) + shake))
  const face = (rows: Rows) => (dir === 1 ? faceRight(rows) : rows)

  // The bed slides in from the left at bedtime.
  const bed = scene.bed
  const pw = bed.rows[0]?.length ?? 0
  const ph = bed.rows.length
  const shown = bedShown(c, m, now)
  if (shown !== null) plot(bed.rows, Math.round(1 - (pw + 2) * (1 - shown)), LANE_PIX - ph - (bed.float ? 1 : 0), bed.pal)

  let cy = walking && act?.leap === 'hop' && Math.floor(now / 225) % 2 ? 1 : 0
  if (busy && !walking && act?.leap === 'pounce' && elapsed > 200) {
    cx = Math.max(0, Math.min(span, cx + dir * 2)) // pounced
  }
  if (isInBed(c, m)) {
    cx = 1 + Math.floor((pw - HERO_COLS) / 2)
    cy = -Math.min(4, ph - 1 + (bed.float ? 1 : 0))
  }
  // The gauge at the right end shows how much context is left.
  if (typeof x.ctx === 'number') {
    const gauge = pack.gauge(x.ctx)
    plot(gauge.rows, cols - (gauge.rows[0]?.length ?? 0) - 1, LANE_PIX - gauge.rows.length, gauge.pal)
  }
  // What the activity brings, beneath the hero as on the desktop: its stage
  // (in lane columns), something at its destination, and something ahead.
  // Before packs the terminal plotted the cat first and these on top, the
  // reverse of the desktop. Beneath on both surfaces is deliberate; anything
  // that should cover the hero belongs in `over`. The one drawing that
  // changed: 'caught' under mood 'sleep' with a coat whose blush differs
  // from the mouse's tail, where the tail now hides under the sleeping body.
  // The brain never plans that; it can show for one repaint between the two
  // state writes at bedtime.
  const hour = hourOf(x.hour ?? 12)
  const crew = joiningSlots(x.crew, terminalCap(cols))
  const at = (x0: number, put = plot): CellsCtx => ({
    leg: m,
    hero: c,
    now,
    dir,
    scene: l.sceneId,
    hour,
    phase: phaseAt(hour),
    face,
    x: x0,
    ahead: (w, gap = 1) => (dir === 1 ? x0 + HERO_COLS + gap : x0 - w - gap),
    col: p => Math.round(p * span),
    plot: put,
    crew,
  })
  if (busy && act) {
    act.stage?.cells(at(0))
    act.target?.cells(at(Math.round(m.to * span)))
    act.draw?.cells(at(cx))
  }
  // The followers, beneath the hero as on the desktop.
  const tag = crewCells({ art: pack.crew, crew: x.crew, m, trail: x.trail, dir, join: act?.crew, now, asleep: isInBed(c, m) }, cols, span, cx, plot)
  const id = lookOf(pack, x.identity)
  const dressed = wear(pack.hero, heroRows(pack, c, l, now), id.marking, x.hat ?? 'none', l.posture === 'asleep')
  plot(face(dressed), cx, cy - HAT_PAD, { ...palette, ...pack.hero.hatPal })
  // Over the hero, moving with its hops.
  if (busy && act?.over) act.over.cells(at(cx, (rows, x0, y0, pal) => plot(rows, x0, y0 + cy, pal)))

  const grid = new Uint32Array(cols * LANE_ROWS * 3)
  for (let y = 0; y < LANE_ROWS; y++) {
    for (let x = 0; x < cols; x++) {
      const top = pixels[y * 2 * cols + x]
      const bottom = pixels[(y * 2 + 1) * cols + x]
      const cell =
        top === undefined && bottom === undefined ? [0x20, TERMINAL_DEFAULT, bg]
        : top === undefined ? [0x2584, bottom ?? bg, bg]
        : [0x2580, top, bottom ?? bg]
      grid.set(cell, (y * cols + x) * 3)
    }
  }
  const put = (x: number, y: number, ch: string, fg: number) => {
    if (x < 0 || x >= cols || y < 0 || y >= LANE_ROWS) return
    grid.set([ch.codePointAt(0) ?? 0x20, fg, bg], (y * cols + x) * 3)
  }

  if (tag) for (let i = 0; i < tag.text.length; i++) put(tag.x + i, tag.y, tag.text.charAt(i), QUIET_COLOR)

  if (l.posture === 'asleep') {
    const z = ['z', 'zZ', 'zZz', ' Zz', '  z'][Math.floor(now / 500) % 5] ?? 'z'
    const zx = dir === 1 || isInBed(c, m) ? cx + HERO_COLS : cx - 4
    for (let i = 0; i < z.length; i++) put(zx + i, 1, z.charAt(i), QUIET_COLOR)
  }

  const line = l.posture === 'asleep' ? null : terminalLine(c, now)
  if (line) {
    const tint = moodColor(c.mood)
    const bw = line.length + 4
    const right = cx + HERO_COLS + 1
    const fitsLeft = cx - 1 - bw >= 0
    const isLeft = fitsLeft && (right + bw > cols || (hasCompanion(act) && busy && dir === 1))
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
    for (let i = 0; i < text.length; i++) put(bx + 2 + i, 2, text.charAt(i), tint)
  }

  return base64(new Uint8Array(grid.buffer))
}
