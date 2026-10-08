import type { HeroState, Motion } from '../../types'
import type { Bed, Draw, Pack, Palette, Rows, SvgCtx } from '../packs/types'
import { clamp01, cycle, faceRight, frames, hex, rects } from './draw'
import { BED_X, HAT_PAD, HEADROOM, HERO_H, HERO_W, LANE_H, MAX_X, PX, SLIDE_MS } from './geometry'
import { bedShown, hasCompanion, isHappy, isInBed, lane, lookOf, moodColor, QUIET_COLOR } from './lane'
import type { Extras, Lane } from './lane'
import { posAt, trackKeys } from './motion'

// ── Desktop: one self-animating SVG for the whole lane ──────────────────

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function bubbleSvg(c: HeroState, onLeft: boolean, tint: number): string {
  if (!c.say) return ''
  const raw = c.say.length > 28 ? c.say.slice(0, 27) + '…' : c.say
  const hasDots = raw.endsWith('…')
  const text = hasDots ? raw.slice(0, -1) : raw
  const sparkle = c.mood === 'done'
  const chars = text.length + (hasDots ? 3 : 0) + (sparkle ? 2 : 0)
  const w = Math.round(chars * 6.6 + 14)
  const h = 18
  const y = 6
  const x = onLeft ? -w - 5 : HERO_W + 5
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

function floaters(c: HeroState, isNapping: boolean): string {
  // Little particles that drift up from the hero's head.
  const drift = (glyph: string, x: number, delay: number, color: string, size: number) =>
    `<text x="${x}" y="8" font-size="${size}" fill="${color}" opacity="0">${glyph}
      <animate attributeName="y" values="8;-2" dur="1.6s" begin="${delay}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;1;0" dur="1.6s" begin="${delay}s" repeatCount="indefinite"/>
    </text>`
  if (isNapping) return drift('z', 24, 0, hex(QUIET_COLOR), 9) + drift('Z', 30, 0.8, hex(QUIET_COLOR), 11)
  if (c.mood === 'pet') return drift('♥', 6, 0, '#db61a2', 9) + drift('♥', 26, 0.5, '#db61a2', 8)
  return ''
}

// A shiny hero sparkles now and then.
const SHINY = [[3, 2, 0], [31, 9, 1.3], [17, -6, 2.1]]
  .map(([x, y, d]) => `<text x="${x}" y="${y}" font-size="7" fill="#f5c542" opacity="0">✦<animate attributeName="opacity" values="0;1;0;0" keyTimes="0;0.1;0.25;1" dur="3.2s" begin="${d}s" repeatCount="indefinite"/></text>`)
  .join('')

const BOB = '<animateTransform attributeName="transform" type="translate" values="0 0;0 -2;0 0" dur="3s" repeatCount="indefinite"/>'

// The bed, sliding in at bedtime and out on waking, in lane coordinates.
function bedSvg(c: HeroState, m: Motion, now: number, bed: Bed): string {
  const shown = bedShown(c, m, now)
  if (shown === null) return ''
  const w = bed.rows[0].length * PX
  const y = HEADROOM + HERO_H - bed.rows.length * PX - bed.float
  const away = -(BED_X + w + 4)
  const isLeaving = c.mood !== 'sleep'
  const since = isLeaving ? (c.wokeAt ?? now) : m.t0
  const slide = now - since < SLIDE_MS
    ? `<animateTransform attributeName="transform" type="translate" from="${isLeaving ? 0 : away} 0" to="${isLeaving ? away : 0} 0" dur="${SLIDE_MS}ms" begin="${Math.round(since - now)}ms" fill="freeze"/>`
    : ''
  return `<g transform="translate(${BED_X} ${y})"><g>${slide}<g>${bed.float ? BOB : ''}<g shape-rendering="crispEdges">${rects(bed.rows, bed.pal)}</g></g></g></g>`
}

// The hero's body, dressed and facing the way it's going, with blinks.
function heroSvg(pack: Pack, c: HeroState, l: Lane, pal: Palette, marking: string, hat: string, remaining: number): string {
  const { hero } = pack
  const dressed = (rows: Rows) => {
    const d = hero.dress(rows, marking, hat)
    return l.dir === 1 ? faceRight(d) : d
  }
  const draw = (rows: Rows) => rects(dressed(rows), pal)
  const eyes = (rows: Rows) => (isHappy(c.mood) ? hero.closeEyes(rows) : rows)

  let body: string
  if (l.posture === 'asleep') {
    body = draw(hero.asleep)
  } else if (l.posture === 'walk') {
    const stride = c.mood === 'working' ? hero.rush : l.act?.stride ?? hero.stride
    body = frames(draw(eyes(hero.walk[0])), draw(eyes(hero.walk[1])), (stride * 2) / 1000, remaining)
  } else {
    const p = l.pose ?? hero.sit
    const look = p.shut ? (rows: Rows) => rows : eyes
    const shown = p.frames.map(f => draw(look(f)))
    body = shown.length > 1 ? cycle(shown, p.period ?? 1) : shown[0]
  }
  // Blinks: closed-eye pixels laid over the open eyes of the first frame
  // for a moment (see Pose.shut for poses whose head moves).
  if (l.posture !== 'asleep' && !isHappy(c.mood) && !l.pose?.shut) {
    const open = l.posture === 'walk' ? hero.walk[0] : (l.pose ?? hero.sit).frames[0]
    body += `<g opacity="0">${rects(dressed(hero.closeEyes(open)), pal, dressed(open))}<animate attributeName="opacity" values="0;1;0" keyTimes="0;0.95;0.98" dur="4s" calcMode="discrete" repeatCount="indefinite"/></g>`
  }
  return body
}

// Pixel art on every layer: stage and target are put in a crispEdges group,
// as draw and over already are (they sit in the hero's), so one drawing
// helper serves any layer. A layer whose svg sets its own edges says so
// (Draw.ownEdges) and is left as it is; an empty one stays empty.
function crisp(layer: Draw, svg: string): string {
  return !svg.trim() || layer.ownEdges ? svg : `<g shape-rendering="crispEdges">${svg}</g>`
}

export function laneSvg(pack: Pack, c: HeroState, m: Motion, now: number, palette: Palette, sceneId: string, x: Extras = {}): string {
  const l = lane(pack, c, m, now, sceneId)
  const { act, walking, busy, dir, scene } = l
  const id = lookOf(pack, x.identity)
  const cur = posAt(m, now)
  const remaining = walking ? m.t0 + m.dur - now : 0
  const pct = (p: number) => `${(clamp01(p) * MAX_X).toFixed(3)}%`
  const at = (ms: number) => `${Math.round(m.t0 + ms - now)}ms`
  const ctx: SvgCtx = {
    leg: m,
    hero: c,
    now,
    dir,
    scene: l.sceneId,
    face: rows => (dir === 1 ? faceRight(rows) : rows),
    PX,
    walking,
    remaining,
    ahead: (w, gap = 3) => (dir === 1 ? HERO_W + gap : -w - gap),
    at,
    pct,
  }
  const body = heroSvg(pack, c, l, { ...palette, ...pack.hero.hatPal }, id.marking, x.hat ?? 'none', remaining)

  const isPounce = busy && !walking && act?.leap === 'pounce'
  const bounce = c.mood === 'oops'
    ? '<animateTransform attributeName="transform" type="translate" values="-2 0;2 0;-2 0" dur="0.12s" repeatCount="indefinite"/>'
    : c.mood === 'done'
      ? '<animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" dur="0.35s" repeatCount="3"/>'
      : walking && act?.leap === 'hop'
        ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -7;0 0" keyTimes="0;0.4;1" dur="0.45s" repeatDur="${Math.round(remaining)}ms"/>`
        : isPounce
          ? `<animateTransform attributeName="transform" type="translate" values="0 0;${dir * 6} -7;${dir * 9} 0" keyTimes="0;0.5;1" dur="0.4s" begin="${at(0)}" fill="freeze"/>`
          : ''
  const glide = walking
    ? `<animate attributeName="x" from="${pct(cur)}" to="${pct(m.to)}" dur="${Math.round(remaining)}ms" fill="freeze"/>`
    : ''
  const bubbleLeft = hasCompanion(act) && busy ? dir === 1 && cur > 0.2 : Math.max(cur, m.to) > 0.55
  const isNapping = l.posture === 'asleep'
  const gauge = typeof x.ctx === 'number' ? pack.gauge(x.ctx) : null
  const target = busy && act?.target
    ? `<svg x="${pct(m.to)}" y="${HEADROOM}" width="${HERO_W}" height="${HERO_H}" overflow="visible">${crisp(act.target, act.target.svg(ctx))}</svg>`
    : ''
  // A stage is in the lane's own frame, where pct() resolves against the lane.
  const stage = busy && act?.stage
    ? `<svg x="0" y="${HEADROOM}" width="100%" height="${HERO_H}" overflow="visible">${crisp(act.stage, act.stage.svg(ctx))}</svg>`
    : ''
  // Over the hero, moving with its hops and bounces.
  // A layer with nothing for the desktop (a terminal-only one) adds nothing.
  const overSvg = act?.over ? act.over.svg(ctx) : ''
  const over = overSvg ? `<g transform="translate(0 ${HAT_PAD * PX})">${overSvg}</g>` : ''

  // The activity's own track for the body, as one keyframed move over the leg
  // that lets go when the leg ends.
  const keys = busy && act?.arc?.length ? trackKeys(act.arc, m.dur) : null
  const arc = keys
    ? `<animateTransform attributeName="transform" type="translate" values="${keys.map(([, dx, dy]) => `${dir * dx * PX} ${dy * PX}`).join(';')}" keyTimes="${keys.map(([k]) => Number(k.toFixed(4))).join(';')}" dur="${Math.round(m.dur)}ms" begin="${at(0)}"/>`
    : ''
  const lifted = `<g transform="translate(0 ${-HAT_PAD * PX})"><g>${bounce}${body}${over}</g></g>`

  // In bed: shifted onto it and lifted, after a little hop up.
  let bedOpen = '<g><g><g>'
  let floatX = 0
  if (isInBed(c, m)) {
    const p = scene.bed
    const dx = BED_X + (p.rows[0].length * PX - HERO_W) / 2
    const lift = (p.rows.length - 1) * PX + p.float
    const hopUp = `<animateTransform attributeName="transform" type="translate" values="${-dx} ${lift};${-dx / 2} ${lift / 2 - 8};0 0" dur="0.35s" begin="${at(0)}" fill="freeze"/>`
    bedOpen = `<g transform="translate(${dx} ${-lift})"><g>${p.float ? BOB : ''}<g>${hopUp}`
    floatX = dx + 14 // z's drift beside the hero, not off the top of the lane
  }

  // color-scheme lets the frame follow the app's light or dark appearance,
  // so a lane with no backdrop stays see-through instead of a white page.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${LANE_H}" overflow="visible" style="background:transparent">
  <style>:root{color-scheme:light dark;background:transparent}</style>
  ${scene.backdrop(x.hour ?? 12)}
  ${gauge ? `<svg x="100%" y="${HEADROOM}" overflow="visible"><g shape-rendering="crispEdges" transform="translate(${-gauge.rows[0].length * PX - 8} ${HERO_H - gauge.rows.length * PX})">${rects(gauge.rows, gauge.pal)}</g></svg>` : ''}
  ${bedSvg(c, m, now, scene.bed)}
  ${stage}${target}
  <svg x="${pct(cur)}" y="${HEADROOM}" width="${HERO_W}" height="${HERO_H}" overflow="visible">${glide}
    ${bedOpen}
    <g shape-rendering="crispEdges">
      ${act?.draw?.svg(ctx) ?? ''}
      ${arc ? `<g>${arc}${lifted}</g>` : lifted}
    </g>
    ${floatX ? '' : floaters(c, isNapping)}
    ${id.shiny ? SHINY : ''}
    ${isNapping ? '' : bubbleSvg(c, bubbleLeft, moodColor(c.mood))}
    </g></g></g>
    ${floatX ? `<g transform="translate(${floatX} 0)">${floaters(c, isNapping)}</g>` : ''}
  </svg>
</svg>`
}
