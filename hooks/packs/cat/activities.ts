import { faceRight, frames, rects } from '../../engine/draw'
import { HERO_H, LANE_PIX, PX } from '../../engine/geometry'
import type { Activity, Dir } from '../types'
import {
  BIRD, BIRD_DOWN, BIRD_PECK, BIRD_UP, FISH, FLY_OPEN, FLY_SHUT, MOUSE_A, MOUSE_B, MUG, PROP_COLORS, SPOT_PAL,
  TABLE, TOOL_ROWS, TOYS, YARN,
} from './critters'
import { SCENES } from './scenes'
import { GROOM_A, GROOM_B, SIT, SIT_PAW } from './sprites'

const scurry = (now: number) => (Math.floor(now / 80) % 2 ? MOUSE_B : MOUSE_A)

// A table with a mug on it (desktop), `x` px ahead of the cat.
const tableSvg = (x: number) => `<g transform="translate(${x} ${HERO_H - TABLE.length * PX})">${rects(TABLE, PROP_COLORS)}</g>`
const mugAt = (x: number, dir: Dir) => [x + (dir === 1 ? 2 : 3) * PX, HERO_H - TABLE.length * PX - MUG.length * PX]
const mugRows = (dir: Dir) => (dir === 1 ? MUG : faceRight(MUG))

// Everything the cat does, in the order the weighted pick walks them.
// Mostly calm (strolling, sitting, grooming, napping), with play now and
// then; late at night it mostly naps.
export const ACTIVITIES: Record<string, Activity> = {
  walk: { weight: { day: 18, night: 10, tired: 20 } },

  sit: { weight: { day: 22, night: 20, tired: 25 }, move: { stay: [3000, 8000] }, mood: 'sit' },

  groom: {
    weight: { day: 16, night: 15, tired: 10 },
    move: { stay: [4000, 7000] },
    pose: { frames: [GROOM_A, GROOM_B], period: 0.5, tick: 250, shut: true },
    lines: ['*lick lick*', 'grooming…', 'must look good'],
  },

  nap: { weight: { day: 14, night: 50, tired: 45 }, move: { stay: [15_000, 45_000] }, pose: 'asleep' },

  hop: { weight: { day: 4 }, pace: 1.4, leap: 'hop', lines: ['wheee', 'boing boing'] },

  yarn: {
    weight: { day: 5 },
    pace: 1.8,
    lines: ['yarn!!', 'mine!', 'boing'],
    draw: {
      svg: ({ dir, walking, remaining, ahead }) => {
        const s = 5 * PX
        const spin = walking
          ? `<animateTransform attributeName="transform" type="rotate" from="0 ${s / 2} ${s / 2}" to="${dir * 360} ${s / 2} ${s / 2}" dur="0.7s" repeatDur="${Math.round(remaining)}ms"/>`
          : ''
        return `<g transform="translate(${ahead(s)} ${HERO_H - s})"><g>${spin}${rects(YARN, TOYS)}</g></g>`
      },
      cells: ({ ahead, plot }) => plot(YARN, ahead(5), LANE_PIX - 5, TOYS),
    },
  },

  mouse: {
    weight: { day: 5 },
    pace: 3,
    stride: 100,
    lines: ['a mouse!', 'get back here', 'hunting…'],
    then: () => (Math.random() < 0.6 ? { activity: 'caught' } : null),
    draw: {
      svg: ({ dir, walking, remaining, ahead, face }) =>
        `<g transform="translate(${ahead(7 * PX) - dir * 6} ${HERO_H - 4 * PX})">${frames(rects(face(MOUSE_A), TOYS), rects(face(MOUSE_B), TOYS), 0.16, walking ? remaining : undefined)}</g>`,
      cells: ({ now, dir, ahead, face, plot }) => plot(face(scurry(now)), ahead(7) + dir * 2, LANE_PIX - 4, TOYS),
    },
  },

  butterfly: {
    weight: { day: 5 },
    pace: 0.8,
    lines: ['ooh', 'pretty…', 'hi butterfly'],
    draw: {
      svg: ({ ahead }) => `<g transform="translate(${ahead(5 * PX)} 4)"><g>
      <animateTransform attributeName="transform" type="translate" values="0 0;4 -3;1 2;-3 -1;0 0" dur="1.8s" repeatCount="indefinite"/>
      ${frames(rects(FLY_OPEN, TOYS), rects(FLY_SHUT, TOYS), 0.25)}
    </g></g>`,
      cells: ({ now, ahead, plot }) =>
        plot(Math.floor(now / 250) % 2 ? FLY_SHUT : FLY_OPEN, ahead(5) + (Math.floor(now / 700) % 2), Math.floor(now / 500) % 2, TOYS),
    },
  },

  fish: {
    weight: { day: 5 },
    // Fishing faces whichever side has room for the bowl or river.
    move: { stay: [7000, 11_000], faceRoom: true },
    hit: 0.5,
    pose: { frames: [SIT, SIT_PAW], period: 1, tick: 500 },
    lines: ['fishing…', 'fishy fishy', 'shh, fish'],
    then: leg => ({ activity: 'sit', line: leg.hit ? 'got one! ♥' : 'next time…' }),
    draw: {
      svg: ({ leg: m, dir, scene, ahead, at }) => {
        const spot = SCENES[scene].spot
        const w = spot.rows[0].length * PX
        const h = spot.rows.length * PX
        const x = ahead(w, 2)
        const k = Math.min(0.2, 400 / m.dur).toFixed(3)
        let fish: string
        if (spot.swim) {
          const [x0, x1, y] = spot.swim
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
        return `<g transform="translate(${x} ${HERO_H - h})"><g opacity="0">
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;${k};${(1 - Number(k)).toFixed(3)};1" dur="${m.dur}ms" begin="${at(0)}" fill="freeze"/>
      ${rects(spot.rows, SPOT_PAL)}${fish}</g>${hit}</g>`
      },
      cells: ({ leg: m, now, scene, ahead, plot }) => {
        const elapsed = now - m.t0
        if (elapsed <= 300 || elapsed >= m.dur - 300) return
        const spot = SCENES[scene].spot
        const w = spot.rows[0].length
        const h = spot.rows.length
        const px = ahead(w)
        plot(spot.rows, px, LANE_PIX - h, SPOT_PAL)
        if (spot.swim) {
          const [x0, x1, y] = spot.swim
          const t = (now % 3000) / 1500
          plot(FISH, px + x0 + Math.round((t < 1 ? t : 2 - t) * (x1 - x0)), LANE_PIX - h + y, TOYS)
        } else {
          const phase = now % 2500
          if (phase < 900) plot(FISH, px + Math.floor(w / 2) - 3 + Math.floor(phase / 300), LANE_PIX - 3 - Math.round(Math.sin((Math.PI * phase) / 900) * 5), TOYS)
        }
      },
    },
    // The catch leaps onto the cat's face, so on the terminal it is drawn
    // over the cat. The desktop's catch stays in `draw`, timed by SMIL, so
    // this layer draws nothing there.
    over: {
      svg: () => '',
      cells: ({ leg: m, now, dir, scene, x, ahead, plot }) => {
        const elapsed = now - m.t0
        const k = (elapsed - (m.dur - 1200)) / 900
        if (!m.hit || elapsed <= 300 || elapsed >= m.dur - 300 || k < 0 || k >= 1) return
        const spot = SCENES[scene].spot
        const w = spot.rows[0].length
        const h = spot.rows.length
        const sx = ahead(w) + Math.floor(w / 2)
        const ex = dir === 1 ? x + 9 : x + 1
        plot(FISH, Math.round(sx + (ex - sx) * k), Math.round(LANE_PIX - h - Math.sin(Math.PI * k) * 4 + (4 - LANE_PIX + h) * k), TOYS)
      },
    },
  },

  bird: {
    weight: { day: 4 },
    // Creep a little way toward a bird that has landed nearby.
    move: { near: [0.12, 0.25] },
    pace: 0.45,
    stride: 300,
    lines: ['shhh…', 'birb.', 'stalking…'],
    then: () => ({ activity: 'flyaway' }),
    // Pecking at the spot the cat is creeping to.
    target: {
      ownEdges: true,
      svg: ({ ahead, face }) => `
    <g shape-rendering="crispEdges" transform="translate(${ahead(5 * PX)} ${HERO_H - 4 * PX})">${frames(rects(face(BIRD), TOYS), rects(face(BIRD_PECK), TOYS), 0.7)}</g>
  `,
      cells: ({ now, ahead, face, plot }) => plot(face(Math.floor(now / 350) % 2 ? BIRD_PECK : BIRD), ahead(5), LANE_PIX - 4, TOYS),
    },
  },

  laser: {
    weight: { day: 3 },
    // Short, frantic zips this way and that, a few in a row.
    move: { zip: [0.15, 0.45] },
    pace: 4.5,
    stride: 100,
    repeat: [2, 4],
    lines: ['THE DOT', 'red dot!!', 'gotta get it'],
    then: () => ({ activity: 'sit', line: "where'd it go?" }),
    draw: {
      svg: ({ ahead }) => `<g transform="translate(${ahead(6) + 3} ${HERO_H - 3})"><g>
      <animateTransform attributeName="transform" type="translate" values="0 0;3 -2;-2 1;2 2;-3 -1;0 0" dur="0.5s" repeatCount="indefinite"/>
      <circle r="4.5" fill="#ff3b3b" opacity="0.3"/><circle r="1.8" fill="#ff6060"/>
    </g></g>`,
      cells: ({ now, ahead, plot }) => {
        const j = [0, 1, -1, 1, 0, -1][Math.floor(now / 90) % 6]
        plot(['L'], ahead(1) + j, LANE_PIX - 1 - (j === 1 ? 1 : 0), { L: 0xff3b3b })
      },
    },
  },

  knock: {
    weight: { day: 4 },
    // A table with a mug on it, a little way off.
    move: { near: [0.12, 0.27] },
    lines: ['ooh, a mug', "what's this…"],
    then: () => ({ activity: 'shove' }),
    thenFirst: true,
    target: {
      ownEdges: true,
      svg: ({ dir, ahead }) => {
        const x = ahead(TABLE[0].length * PX)
        const [mugX, mugY] = mugAt(x, dir)
        return `<g shape-rendering="crispEdges">
      ${tableSvg(x)}
      <g transform="translate(${mugX} ${mugY})">${rects(mugRows(dir), PROP_COLORS)}</g>
    </g>`
      },
      cells: ({ ahead, plot }) => {
        const bx = ahead(TABLE[0].length)
        plot(TABLE, bx, LANE_PIX - TABLE.length, PROP_COLORS)
        plot(MUG, bx + 2, LANE_PIX - TABLE.length - MUG.length, PROP_COLORS)
      },
    },
  },

  meter: {
    weight: { day: 3, night: 5 },
    move: { spot: 0 }, // the usage numbers sit below the left end
    lines: ['brb', 'one sec'],
    then: () => ({ activity: 'sitmeter' }),
    thenFirst: true,
  },

  caught: {
    move: { stay: 3000 },
    leap: 'pounce',
    pose: { frames: [SIT_PAW] },
    lines: ['got it!', 'gotcha!'],
    cues: [[2100, 'hey! come back']],
    // Pinned under a paw, wriggling, then it slips free and scurries off.
    draw: {
      svg: ({ leg: m, dir, ahead, at, face }) => `<g transform="translate(${ahead(7 * PX) + dir * 2} ${HERO_H - 4 * PX})"><g>
      <animateTransform attributeName="transform" type="translate" values="0 0;0 0;${dir * 140} 0" keyTimes="0;0.72;1" dur="${m.dur}ms" begin="${at(0)}" fill="freeze"/>
      <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.85;1" dur="${m.dur}ms" begin="${at(0)}" fill="freeze"/>
      ${frames(rects(face(MOUSE_A), TOYS), rects(face(MOUSE_B), TOYS), 0.16)}
    </g></g>`,
      cells: ({ leg: m, now, dir, ahead, face, plot }) => {
        const elapsed = now - m.t0
        const run = elapsed > m.dur * 0.72 ? Math.round((elapsed - m.dur * 0.72) / 20) : 0
        plot(face(scurry(now)), ahead(7) - dir * 2 + dir * run, LANE_PIX - 4, TOYS)
      },
    },
  },

  flyaway: {
    move: { stay: 3000 },
    leap: 'pounce',
    lines: ['nom?!', 'nom nom'],
    cues: [[1600, 'nooo come back']],
    // Gone in the pounce ("nom?!"), then it bursts out and flies away.
    draw: {
      svg: ({ leg: m, dir, ahead, at, face }) => `<g transform="translate(${ahead(5 * PX)} ${HERO_H - 4 * PX})"><g>
      <animateTransform attributeName="transform" type="translate" values="0 0;0 0;${dir * 90} -70" keyTimes="0;0.53;1" dur="${m.dur}ms" begin="${at(0)}" fill="freeze"/>
      <animate attributeName="opacity" values="1;0;0;1;1;0" keyTimes="0;0.12;0.52;0.54;0.92;1" dur="${m.dur}ms" begin="${at(0)}" fill="freeze"/>
      ${frames(rects(face(BIRD_UP), TOYS), rects(face(BIRD_DOWN), TOYS), 0.18)}
    </g></g>`,
      cells: ({ leg: m, now, dir, ahead, face, plot }) => {
        const elapsed = now - m.t0
        const wings = face(Math.floor(now / 180) % 2 ? BIRD_DOWN : BIRD_UP)
        if (elapsed < 350) plot(wings, ahead(5), LANE_PIX - 4, TOYS)
        else if (elapsed > 1600) {
          const k = (elapsed - 1600) / (m.dur - 1600)
          plot(wings, ahead(5) + dir * Math.round(k * 30), LANE_PIX - 4 - Math.round(k * 10), TOYS)
        }
      },
    },
  },

  shove: {
    move: { stay: 3600 },
    pose: { frames: [SIT, SIT_PAW], period: 0.45, tick: 200 },
    lines: ['*tap*', '*tap tap*'],
    cues: [[2100, '*CRASH*'], [3300, 'oops :3']],
    // Tap, tap… then the mug slides off the edge and smashes.
    draw: {
      svg: ({ leg: m, dir, ahead, at }) => {
        const x = ahead(TABLE[0].length * PX)
        const [mugX, mugY] = mugAt(x, dir)
        const fall = TABLE.length * PX
        const shards = `<g opacity="0" transform="translate(${mugX + dir * 22} ${HERO_H - 3})"><animate attributeName="opacity" values="0;0;1" keyTimes="0;0.6;0.61" dur="${m.dur}ms" begin="${at(0)}" fill="freeze"/>${rects(['M.m.M'], PROP_COLORS)}</g>`
        return `${shards}${tableSvg(x)}
      <g transform="translate(${mugX} ${mugY})"><g>
        <animateTransform attributeName="transform" type="translate" values="0 0;0 0;${dir * 16} 0;${dir * 22} ${fall}" keyTimes="0;0.4;0.52;0.6" dur="${m.dur}ms" begin="${at(0)}" fill="freeze"/>
        <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.6;0.61" dur="${m.dur}ms" begin="${at(0)}" fill="freeze"/>
        ${rects(mugRows(dir), PROP_COLORS)}
      </g></g>`
      },
      cells: ({ leg: m, now, dir, ahead, plot }) => {
        const bx = ahead(TABLE[0].length)
        plot(TABLE, bx, LANE_PIX - TABLE.length, PROP_COLORS)
        const k = (now - m.t0) / m.dur
        const mx = bx + 2 + (k < 0.4 ? 0 : dir * Math.round(Math.min(1, (k - 0.4) / 0.2) * 7))
        const my = LANE_PIX - TABLE.length - MUG.length + (k < 0.52 ? 0 : Math.round(Math.min(1, (k - 0.52) / 0.08) * TABLE.length))
        if (k < 0.6) plot(MUG, mx, my, PROP_COLORS)
        else plot(['M.m.M'], bx + 2 + dir * 8, LANE_PIX - 1, PROP_COLORS)
      },
    },
  },

  sitmeter: {
    move: { stay: [8000, 14_000] },
    lines: ['this spot is warm', 'mine now', 'comfy'],
    usageNote: '🐾 your cat is sitting on your stats (Pet to move it)',
  },

  // While Claude runs a tool: a book, laptop, terminal or magnifier, and
  // typing away at the laptop or terminal.
  busy: {
    pose: hero => (hero.prop === 'edit' || hero.prop === 'bash' ? { frames: [SIT, SIT_PAW], period: 0.25, tick: 200 } : undefined),
    draw: {
      svg: ({ hero, dir, ahead }) => {
        if (!hero.prop) return ''
        const rows = TOOL_ROWS[hero.prop]
        const wander = hero.prop === 'search'
          ? '<animateTransform attributeName="transform" type="translate" values="0 0;-4 -4;3 -2;0 0" dur="2.2s" repeatCount="indefinite"/>'
          : ''
        return `<g transform="translate(${ahead(rows[0].length * PX)} ${HERO_H - rows.length * PX})"><g>${wander}${rects(dir === 1 ? rows : faceRight(rows), PROP_COLORS)}</g></g>`
      },
      cells: ({ hero, dir, ahead, plot }) => {
        if (!hero.prop) return
        const rows = TOOL_ROWS[hero.prop]
        plot(dir === 1 ? rows : faceRight(rows), ahead(rows[0].length), LANE_PIX - rows.length, PROP_COLORS)
      },
    },
  },
}
