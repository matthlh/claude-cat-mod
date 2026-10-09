// The Adventurer pack's world: four scenes with their beds, and the large
// props the hero works with. Plain data and pure string builders, on the
// engine's geometry and drawing helpers.
//
// The same mechanism as the cat's scenes. Each scene has:
//  - a desktop backdrop, (hour) => an SVG fragment drawn first in the 42 px
//    lane: percent x so it fills any width, clipped to the lane's rounded box;
//  - a terminal background colour (0xRRGGBB) behind the lane's cells;
//  - a bed that slides in from the left at bedtime. Row 0 is the surface: the
//    sleeper's bottom row lies on it. `float` lifts it off the ground.
//
// Sprites are string[] rows: '.' is transparent, every other char a key into
// a palette of 0xRRGGBB. Props use WORLD_PAL; beds carry their own palette.
//
// Legibility rule for every backdrop: the hero and the mobs are drawn in
// front at full strength, so scenery stays darker, cooler or paler than they
// are, and nothing busy sits behind the hero's legs (y 36..42).

import { faceRight, frames, hex, num, paths as art } from '../../engine/draw'
import { HEADROOM, HERO_H, LANE_H as H, PX } from '../../engine/geometry'
import { hourOf as clock, phaseAt } from '../../engine/time'
import type { Bed, Palette, Rows, Scene } from '../types'

type AdventurerScene = 'forest' | 'cavern' | 'night' | 'cabin'

// The ground line, in CSS px down the lane: floors and turf run from here to
// the bottom, behind the hero's legs and boots (its bottom 2 sprite rows).
const GROUND_Y_PX = HEADROOM + HERO_H - 2 * PX

// A shape defined once and placed at percent x positions (fixed pixel size,
// so it keeps its shape however wide the lane is).
const def = (id: string, body: string) => `<g id="${id}">${body}</g>`
const place = (id: string, spots: [number, number][]) => spots.map(([p, y]) => `<use href="#${id}" x="${p}%" y="${y}"/>`).join('')
// Something drawn once at a percent x and a pixel y.
const at = (p: number, y: number, body: string) => `<svg x="${num(p)}%" y="${y}" overflow="visible">${body}</svg>`

// A pixel tile repeated across the lane from y down, one tile tall unless
// told otherwise.
function band(id: string, tile: Rows, pal: Palette, y: number, s = PX, height = tile.length * s): string {
  const w = (tile[0]?.length ?? 0) * s
  const h = tile.length * s
  return `<pattern id="${id}" y="${y}" width="${w}" height="${h}" patternUnits="userSpaceOnUse">${art(tile, pal, s)}</pattern><rect y="${y}" width="100%" height="${height}" fill="url(#${id})"/>`
}

// The lane's rounded box: everything a backdrop draws is clipped to it.
function lane(body: string): string {
  return `<clipPath id="advClip"><rect width="100%" height="${H}" rx="6"/></clipPath><g clip-path="url(#advClip)" shape-rendering="crispEdges">${body}</g>`
}

// Stars in three groups that twinkle out of step, one animation per group.
function stars(spots: [number, number][], fill: string): string {
  const groups: string[] = ['', '', '']
  spots.forEach(([p, y], i) => {
    const s = i % 5 === 0 ? 2 : 1
    groups[i % 3] += `<rect x="${p}%" y="${y}" width="${s}" height="${s}"/>`
  })
  return groups
    .map((g, i) => `<g fill="${fill}">${g}<animate attributeName="opacity" values="1;0.25;1" dur="${2.2 + i * 0.9}s" begin="${i * 0.6}s" repeatCount="indefinite"/></g>`)
    .join('')
}

// ── Tiles ───────────────────────────────────────────────────────────────
// Blocks are 4 x 4 and tile, drawn with WORLD_PAL. Lit from the top left: a
// lighter top row and left column, a darker bottom row and right column, so
// the seams show when they stack. CRACK_n is laid over a block as it is
// mined. The scenes build their ground from the same tiles (see strip()).

export const WORLD_PAL: Palette = {
  // leaves: body, shade, light (k is also the grass's highlight)
  L: 0x4f9d3a, l: 0x2f6b2c, k: 0x92d65e,
  // bark, its shade; cut wood and its rings
  T: 0x7a5232, t: 0x51361f, r: 0xe0bb85, R: 0xa97c4b,
  // grass and its shade; dirt: body, shade, light
  G: 0x5cb83e, g: 0x3a8a2e, D: 0x96603a, d: 0x6a3f24, e: 0xb88050,
  // stone: body, shade, light
  S: 0x8a8f99, s: 0x5c606b, z: 0xb4bac3,
  // planks: body, shade, light
  W: 0xbf8a52, w: 0x8a5a30, v: 0xdcae72,
  // ores: copper, iron, gold, each with its shade
  C: 0xf0904a, c: 0xa8522a, I: 0xe8c0a0, i: 0xa07058, Y: 0xffd84a, y: 0xc8901a,
  // cracks
  x: 0x231c19,
  // iron: anvil and tool heads, shade, shine
  A: 0x5b616d, a: 0x3b3f48, h: 0x9fa6b2,
  // furnace mouth; fire: core, flame, edge
  K: 0x19161b, f: 0xffe07a, F: 0xff9a2e, o: 0xd9442b,
}

// Dirt with a pebble (e) and a dark fleck or two (d).
export const BLOCK_DIRT = ['DDeD', 'eDDd', 'DdDD', 'dDdd']
// Dirt with grass on top, for the top row of anything built from dirt: a
// bright lip with a ragged edge that hangs into the dirt.
export const BLOCK_GRASS = ['kGkG', 'GgDG', 'gDeD', 'dDdd']
// Stone with a crack in its face.
export const BLOCK_STONE = ['zzzS', 'zSSs', 'zsSs', 'ssss']
// Two planks with grain, a dark seam between them.
export const BLOCK_WOOD = ['vvvv', 'WWwW', 'wwww', 'WvWw']
// Ore: a vein (light, then shade) running corner to corner through stone.
export const ORE_BLOCK_COPPER = ['zzCS', 'zCcS', 'CcSs', 'csss']
export const ORE_BLOCK_IRON = ['zIzS', 'IiSS', 'SSIs', 'ssis']
export const ORE_BLOCK_GOLD = ['zSYS', 'SYyS', 'YySs', 'ysss']
// Each stage keeps the last one's cracks and adds more.
const CRACK_1 = ['....', '.x..', '..x.', '....']
const CRACK_2 = ['...x', '.xx.', '..x.', '....']
const CRACK_3 = ['x..x', '.xx.', '..x.', '.x.x']
export const CRACKS = [CRACK_1, CRACK_2, CRACK_3]

// The top `n` rows of some tiles laid side by side, every other one turned
// round so the strip doesn't repeat every block: the ground the hero walks
// on, made of the blocks it builds with.
function strip(tiles: Rows[], n: number): Rows {
  return Array.from({ length: n }, (_, y) => tiles.map((t, i) => (i % 2 ? faceRight(t) : t)[y] ?? '').join(''))
}
const TURF = strip([BLOCK_GRASS, BLOCK_GRASS, ['GkGG', 'gGDg'], BLOCK_GRASS], 2)
const STONE_FLOOR = strip([BLOCK_STONE, BLOCK_STONE, ['zzSz', 'zSsS'], BLOCK_STONE], 2)

// ── Layers ──────────────────────────────────────────────────────────────
// Backdrops are built back to front from layers that repeat across the lane
// at their own widths, so they never line up the same way twice: the further
// a layer, the paler and bluer it is (or, at night and underground, the
// closer to the dark).

// A skyline from column heights, one base-36 digit a column, in pixels: the
// top pixel of each column is its rim (a), the rest its body (b), the bottom
// `low` rows its shade (c). `hang` turns it upside down, hanging from the top.
function ridge(heights: string, rows: number, low = 0, hang = false): Rows {
  const out = Array.from({ length: rows }, (_, y) =>
    [...heights]
      .map(ch => {
        const top = rows - parseInt(ch, 36)
        return y < top ? '.' : y === top ? 'a' : y >= rows - low ? 'c' : 'b'
      })
      .join(''),
  )
  return hang ? out.reverse() : out
}

// Rows repeated across the lane, `s` px a pixel, from y, the pattern shifted
// `dx` px so neighbouring layers repeat out of step. The tile keeps a clear
// pixel row above and below the art: a renderer that smooths a pattern
// across its wrap would otherwise smear the far edge's colour along the near
// one as a hairline.
function layer(id: string, rows: Rows, pal: Palette, y: number, s = 2, dx = 0): string {
  const w = (rows[0]?.length ?? 0) * s
  const h = (rows.length + 2) * s
  return `<pattern id="${id}" x="${dx}" y="${y - s}" width="${w}" height="${h}" patternUnits="userSpaceOnUse">${art(rows, pal, s, 0, s)}</pattern><rect y="${y - s}" width="100%" height="${h}" fill="url(#${id})"/>`
}

// Rolling far hills, 80 columns of 5 to 11 px: they rise well clear of the
// treeline in front of them.
const FAR_HILLS = ridge('abbbbbbbbaaaa999888888899999aaaaaaaaa9998877766655555555555555556666677788899aaa', 11)
// A treeline of round crowns, 64 columns: rim, body, and a shaded foot.
const MID_TREES = ridge('7766566653578887546777667776467776666665467776446777656665467888', 8, 2)
// A near tree, tall enough to frame the lane: A light, a leaves, b shade,
// t trunk, T its shade.
const NEAR_TREE = [
  '....AAab....',
  '..AAAaaabb..',
  '.AAaaaaaabb.',
  'AAaaaaaaabbb',
  'Aaaaaaaabbbb',
  'aaaaaaabbbbb',
  '.aaaaabbbbb.',
  '..abbbtbbb..',
  '.....tT.....',
  '.....tT.....',
  '.....tT.....',
  '.....tT.....',
  '....ttTT....',
]

// ── Time of day ─────────────────────────────────────────────────────────

const mix = (a: number, b: number, t: number) => {
  const ch = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

// The outdoor light at four times of day; the hours between are blended.
type Light = {
  top: number; low: number // sky, zenith and horizon
  far: number; farHi: number // distant hills and their rim
  mid: number; midHi: number; midLo: number // the treeline
  tree: number; treeHi: number; treeLo: number; trunk: number // near trees
  grass: number; grassHi: number; grassLo: number; dirt: number; dirtLo: number; dirtHi: number
  orb: number; cloud: number
}
const DAY: Light = {
  top: 0x5a9de0, low: 0xb6dcf2, far: 0x92bccc, farHi: 0xb0d3df,
  mid: 0x78a993, midHi: 0x8fbc9f, midLo: 0x64927f,
  tree: 0x4e8a5d, treeHi: 0x64a068, treeLo: 0x3b6c4c, trunk: 0x5e4a3c,
  grass: 0x55ab3a, grassHi: 0x86c85a, grassLo: 0x37802c, dirt: 0x8c5a37, dirtLo: 0x633b22, dirtHi: 0xac784b,
  orb: 0xfff1b5, cloud: 0xf5f9fc,
}
const DAWN: Light = {
  top: 0x6b6cab, low: 0xf0b6a2, far: 0xb09ab6, farHi: 0xcdb1c0,
  mid: 0x7f7c98, midHi: 0x958aa4, midLo: 0x6b6984,
  tree: 0x55617a, treeHi: 0x6a7088, treeLo: 0x434d64, trunk: 0x4d4248,
  grass: 0x4e9441, grassHi: 0x78b25a, grassLo: 0x356e36, dirt: 0x845a42, dirtLo: 0x5a3c2c, dirtHi: 0xa06e50,
  orb: 0xffd8a0, cloud: 0xf6d2ca,
}
const DUSK: Light = {
  top: 0x4c4688, low: 0xee985f, far: 0x9a7090, farHi: 0xc08a8e,
  mid: 0x6c5f80, midHi: 0x86708a, midLo: 0x58506e,
  tree: 0x48506a, treeHi: 0x5c5c74, treeLo: 0x383f58, trunk: 0x43383e,
  grass: 0x467e3c, grassHi: 0x6c9c50, grassLo: 0x325a33, dirt: 0x795339, dirtLo: 0x553828, dirtHi: 0x92664a,
  orb: 0xffb874, cloud: 0xf3b48e,
}
const NIGHT: Light = {
  top: 0x0d1330, low: 0x202c5a, far: 0x1a2350, farHi: 0x27336a,
  mid: 0x121a3a, midHi: 0x1b2650, midLo: 0x0f152e,
  tree: 0x0c1228, treeHi: 0x141d3c, treeLo: 0x090d1e, trunk: 0x090d1e,
  grass: 0x21482f, grassHi: 0x2f6040, grassLo: 0x183726, dirt: 0x302a35, dirtLo: 0x221e27, dirtHi: 0x3b343f,
  orb: 0xf3ead0, cloud: 0x26315c,
}

// The engine's hours (engine/time.ts): night from 21:00 to 4:59, dawn at 5
// and 6, dusk 18 to 20, blended an hour either side.
function lightAt(hour: number): Light {
  const h = clock(hour)
  const blend = (a: Light, b: Light, t: number): Light => {
    const out = {} as Light
    for (const k of Object.keys(a) as (keyof Light)[]) out[k] = mix(a[k], b[k], t)
    return out
  }
  if (phaseAt(h) === 'night') return NIGHT
  if (h === 5) return blend(NIGHT, DAWN, 0.6)
  if (h === 6) return DAWN
  if (h === 7) return blend(DAWN, DAY, 0.6)
  if (h < 17) return DAY
  if (h === 17) return blend(DAY, DUSK, 0.35)
  if (h === 18) return blend(DAY, DUSK, 0.75)
  if (h === 19) return DUSK
  return blend(DUSK, NIGHT, 0.5)
}

// A vertical sky gradient.
const skyGrad = (id: string, top: number, low: number) =>
  `<linearGradient id="${id}" x2="0" y2="1"><stop offset="0" stop-color="${hex(top)}"/><stop offset="1" stop-color="${hex(low)}"/></linearGradient>`

const SUN = ['..oo..', '.oOOo.', 'oOOOOo', 'oOOOOo', '.oOOo.', '..oo..']
const MOON = ['..MMM.', '.MMm..', 'MMm...', 'MMm...', 'MMm...', '.MMm..', '..MMM.']
const CLOUD = ['...ccc....', '.cccccccc.', 'cccccccccc', '.CCCCCCCC.']

// The turf for a light: grass blocks' top rows, in its colours.
const turf = (id: string, l: Light) => layer(id, TURF, { G: l.grass, k: l.grassHi, g: l.grassLo, D: l.dirt, d: l.dirtLo, e: l.dirtHi }, GROUND_Y_PX, PX)

// ── Forest ──────────────────────────────────────────────────────────────
// Sky for the hour (sun by day, moon and stars by night), then three layers
// tinted for depth: pale far hills, a hazy treeline of round crowns, a few
// near trees; and the turf, the top of the same grass blocks the hero digs.

const TUFT = ['k.k.', 'GkGk']
const FLOWER = ['.y.', 'yoy', '.G.']

function forestSvg(hour: number): string {
  const h = clock(hour)
  const l = lightAt(h)
  const night = phaseAt(h) === 'night'
  const v = 'advF'
  const defs = `<defs>${skyGrad(`${v}s`, l.top, l.low)}${def(`${v}n`, art(NEAR_TREE, { A: l.treeHi, a: l.tree, b: l.treeLo, t: l.trunk, T: mix(l.trunk, 0, 0.3) }, 2))}${def(`${v}c`, art(CLOUD, { c: l.cloud, C: mix(l.cloud, l.low, 0.5) }, 2))}${def(`${v}t`, art(TUFT, { G: l.grass, k: l.grassHi }, 2))}${night ? '' : def(`${v}f`, art(FLOWER, { y: 0xf2d86a, o: 0xe2774a, G: l.grass }, 2))}</defs>`
  const sky = `<rect width="100%" height="${H}" fill="url(#${v}s)"/>`
  // The sun rises behind the hills on the left at 5:00 and sets on the
  // right after 19:00; the first stars come out at 20:00, and the moon
  // crosses from 21:00 to 4:00.
  const field: [number, number][] = [[5, 4], [12, 13], [19, 6], [27, 10], [35, 3], [42, 14], [49, 7], [57, 4], [64, 12], [71, 6], [77, 15], [90, 11], [96, 4]]
  let orb = ''
  if (night) {
    const t = ((h + 3) % 24) / 8
    orb = stars(field, '#e8e8ff') + at(8 + t * 80, Math.round(2 + 8 * (1 - Math.sin(Math.PI * (0.1 + 0.8 * t)))), art(MOON, { M: l.orb, m: mix(l.orb, l.top, 0.35) }, 2))
  } else if (h === 20) {
    orb = `<g opacity="0.45">${stars(field, '#e8e8ff')}</g>`
  } else {
    const t = (h - 5) / 14
    const y = Math.round(3 + 14 * (1 - Math.sin(Math.PI * t)))
    orb = `<svg x="${num(5 + t * 86)}%" y="${y}" overflow="visible"><circle cx="6" cy="6" r="11" fill="${hex(l.orb)}" opacity="0.25"/>${art(SUN, { o: l.orb, O: mix(l.orb, 0xffffff, 0.5) }, 2)}</svg>`
  }
  const clouds = night ? '' : `<g opacity="0.85">${place(`${v}c`, [[13, 4], [37, 8], [74, 3]])}</g>`
  const far = layer(`${v}h`, FAR_HILLS, { a: l.farHi, b: l.far }, GROUND_Y_PX - FAR_HILLS.length * 2, 2, 40)
  const mid = layer(`${v}m`, MID_TREES, { a: l.midHi, b: l.mid, c: l.midLo }, GROUND_Y_PX - MID_TREES.length * 2, 2, 7)
  const near = place(`${v}n`, [[2, 10], [19, 10], [41, 10], [63, 10], [81, 10], [97, 10]])
  const tufts = place(`${v}t`, [[6, GROUND_Y_PX - 4], [21, GROUND_Y_PX - 4], [34, GROUND_Y_PX - 4], [51, GROUND_Y_PX - 4], [66, GROUND_Y_PX - 4], [79, GROUND_Y_PX - 4], [93, GROUND_Y_PX - 4]]) + (night ? '' : place(`${v}f`, [[13, GROUND_Y_PX - 6], [43, GROUND_Y_PX - 6], [72, GROUND_Y_PX - 6], [87, GROUND_Y_PX - 6]]))
  return `${defs}${lane(`${sky}${orb}${clouds}${far}${mid}${near}${turf(`${v}g`, l)}${tufts}`)}`
}

// ── Cavern ──────────────────────────────────────────────────────────────
// Three depths of rock: the far wall in near-black mottle with ore glinting
// in it, torch-lit mounds and a mine's timber supports in the middle, and a
// fringe of stalactites hanging in front; two torches throw a warm,
// flickering glow, over a floor of the same stone blocks the hero mines.

// The far wall, 16 x 8 pixels at 3 px, repeated: a darker and a lighter mottle.
const ROCK = [
  '..aa.........b..',
  '.aaaa.......bb..',
  '..a......aa.....',
  '.......aaaa...b.',
  '.b......aa...aa.',
  'bb..........aaaa',
  '.....bb......a..',
  'aa...b...a......',
]
const SPECKS = {
  copper: ['Cc.', '.CC'],
  iron: ['.I', 'Ii', 'I.'],
  gold: ['Y.Y', '.y.'],
  gem: ['.g', 'gG'],
} satisfies Record<string, Rows>
const SPECK_PAL: Palette = { C: 0xc47a45, c: 0x8f552e, I: 0xb89c88, i: 0x80695b, Y: 0xd9b443, y: 0x9e7c26, g: 0x3fa9b8, G: 0x93e2ec }
// Torch-lit mounds rising from the floor, and the stalactites in front.
const MOUNDS = ridge('566665554444444433211111112234444433333344555554433222233333221111111234', 6)
const CEILING = ridge('2222474221112242221124696422232235322223585333221122421113632211', 9, 0, true)
// A mine support: two posts and a beam, 2 px a pixel.
const SUPPORT = [
  'BBBBBBBBBBBBBBBBBBBBBB',
  'bbbbbbbbbbbbbbbbbbbbbb',
  '.Pp................Pp.',
  '.Pp................Pp.',
  '.Pp................Pp.',
  '.Pp................Pp.',
  '.Pp................Pp.',
  '.Pp................Pp.',
  '.Pp................Pp.',
  '.Pp................Pp.',
  '.Pp................Pp.',
  '.Pp................Pp.',
  '.Pp................Pp.',
  '.Pp................Pp.',
  '.Pp................Pp.',
  '.Pp................Pp.',
]

function cavernSvg(_hour: number): string {
  const torch = (p: number, begin: number) =>
    at(p, 8, `<circle cx="4.5" cy="4" r="30" fill="url(#advGlow)"><animate attributeName="opacity" values="1;0.7;0.95;0.75;1" dur="1.9s" begin="${begin}s" repeatCount="indefinite"/></circle>${frames(art(TORCH_WALL, WORLD_PAL), art(TORCH_WALL_B, WORLD_PAL), 0.4, begin)}`)
  const defs = `<defs><radialGradient id="advGlow"><stop offset="0" stop-color="#ffb04a" stop-opacity="0.4"/><stop offset="0.5" stop-color="#ff8a2e" stop-opacity="0.12"/><stop offset="1" stop-color="#ff8a2e" stop-opacity="0"/></radialGradient>${def('advSup', art(SUPPORT, { B: 0x4c3627, b: 0x3a291d, P: 0x45311f, p: 0x33241a }, 2))}</defs>`
  const wall = `<rect width="100%" height="${H}" fill="#18161d"/>${band('advRock', ROCK, { a: 0x121016, b: 0x201d26 }, 0, PX, H)}`
  const mounds = layer('advMnd', MOUNDS, { a: 0x3a3442, b: 0x26222d }, H - STONE_FLOOR.length * PX - MOUNDS.length * PX, PX, 50)
  const specks = ([[7, 9, 'copper'], [13, 22, 'gem'], [23, 26, 'iron'], [34, 5, 'gold'], [41, 15, 'iron'], [52, 24, 'copper'], [58, 4, 'gem'], [74, 22, 'gold'], [80, 13, 'copper'], [88, 6, 'iron'], [95, 20, 'copper']] as [number, number, keyof typeof SPECKS][])
    .map(([p, y, k]) => at(p, y, art(SPECKS[k], SPECK_PAL, 2)))
    .join('')
  const sparkle = `<g fill="#d8fbff">${[[13.6, 21], [58.6, 3]].map(([p, y]) => `<rect x="${p}%" y="${y}" width="1" height="1"/>`).join('')}<animate attributeName="opacity" values="0;1;0;0" keyTimes="0;0.1;0.2;1" dur="3.1s" repeatCount="indefinite"/></g>`
  const supports = place('advSup', [[28, 0], [69, 0]])
  const ceiling = layer('advCeil', CEILING, { a: 0x3a3442, b: 0x0e0c12 }, 0, PX, 20)
  const floor = layer('advFloor', STONE_FLOOR, { z: 0x5c5866, S: 0x47434f, s: 0x34313b }, H - STONE_FLOOR.length * PX, PX)
  return `${defs}${lane(`${wall}${mounds}${specks}${sparkle}${ceiling}${supports}${torch(17, 0)}${torch(56, 0.7)}${floor}`)}`
}

// ── Night ───────────────────────────────────────────────────────────────
// A dark blue sky, a crescent moon that crosses it through the night,
// twinkling stars and a falling one, then three silhouettes, each nearer one
// darker, rimmed in moonlight: far hills, a treeline, tall pines; fireflies
// over the turf.

const NIGHT_HILLS = ridge('888888777665544433333333444444333333222222333445566677777777666666777777', 8)
// A tall pine, 2 px a pixel: a body, A its moonlit edge, t trunk.
const PINE = [
  '....A....',
  '...Aa....',
  '...Aaa...',
  '..Aaaa...',
  '...Aaa...',
  '..Aaaaa..',
  '.Aaaaaa..',
  '..Aaaaa..',
  '.Aaaaaaa.',
  'Aaaaaaaaa',
  '....t....',
  '....t....',
]

function nightSvg(hour: number): string {
  const h = clock(hour)
  // Left of centre in the evening, right by morning; by day it waits high.
  const t = h >= 18 ? (h - 18) / 12 : h < 6 ? (h + 6) / 12 : 0.5
  const moonX = 8 + t * 78
  const moonY = Math.round(2 + 8 * (1 - Math.sin(Math.PI * (0.1 + 0.8 * t))))
  const defs = `<defs>${skyGrad('advNs', 0x0b1027, 0x1f2a58)}<radialGradient id="advHalo"><stop offset="0" stop-color="#f3ead0" stop-opacity="0.28"/><stop offset="1" stop-color="#f3ead0" stop-opacity="0"/></radialGradient>${def('advNp', art(PINE, { A: 0x18213f, a: 0x0a0e20, t: 0x080b18 }, 2))}</defs>`
  const sky = `<rect width="100%" height="${H}" fill="url(#advNs)"/>`
  const field = stars([[3, 5], [8, 16], [14, 3], [20, 11], [25, 20], [31, 6], [37, 14], [44, 3], [50, 10], [55, 18], [61, 5], [67, 13], [73, 3], [78, 19], [84, 8], [90, 15], [95, 4], [98, 12]], '#e6e8ff')
  const falling = `<svg x="58%" y="2" overflow="visible"><path d="M0 0h2v1h2v1h2v1h-6z" fill="#f4f1ff" opacity="0"><animate attributeName="opacity" values="0;1;0;0" keyTimes="0;0.03;0.07;1" dur="11s" begin="2s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="translate" values="0 0;-40 14;-40 14" keyTimes="0;0.07;1" dur="11s" begin="2s" repeatCount="indefinite"/></path></svg>`
  const moon = at(moonX, moonY, `<circle cx="6" cy="7" r="15" fill="url(#advHalo)"/>${art(MOON, { M: 0xf3ead0, m: 0xcfc6a6 }, 2)}`)
  const hills = layer('advNh', NIGHT_HILLS, { a: 0x2a3670, b: 0x19224a }, GROUND_Y_PX - NIGHT_HILLS.length * 2, 2, 30)
  const trees = layer('advNm', MID_TREES, { a: 0x1c2752, b: 0x111834, c: 0x0d1329 }, GROUND_Y_PX - MID_TREES.length * 2, 2, 90)
  const pines = place('advNp', [[4, GROUND_Y_PX - 24], [9, GROUND_Y_PX - 24], [31, GROUND_Y_PX - 24], [52, GROUND_Y_PX - 24], [57, GROUND_Y_PX - 24], [80, GROUND_Y_PX - 24], [93, GROUND_Y_PX - 24]])
  const flies = ([[15, 27], [39, 23], [63, 29], [87, 24]] as [number, number][])
    .map(([p, y], i) => `<rect x="${p}%" y="${y}" width="2" height="2" fill="#d6f07a" opacity="0"><animate attributeName="opacity" values="0;0.9;0" dur="${3 + (i % 2)}s" begin="${i * 0.9}s" repeatCount="indefinite"/><animate attributeName="y" values="${y};${y - 5};${y}" dur="${5 + i}s" repeatCount="indefinite"/></rect>`)
    .join('')
  return `${defs}${lane(`${sky}${field}${falling}${moon}${hills}${trees}${pines}${turf('advNg', NIGHT)}${flies}`)}`
}

// ── Cabin ───────────────────────────────────────────────────────────────
// A plank wall, a curtained window onto the sky for the hour, a shelf, a
// table with a candle (lit from dusk to dawn), and floorboards.

// Two boards, 64 x 14 px, with staggered joints and nails.
const PLANKS =
  '<rect width="64" height="14" fill="#3f2c23"/><rect y="7" width="64" height="7" fill="#3a2820"/>' +
  '<path fill="#2a1c15" d="M0 6h64v1h-64zM0 13h64v1h-64zM22 0h1v6h-1zM52 7h1v6h-1z"/>' +
  '<path fill="#4a3429" d="M3 2h12v1h-12zM30 4h16v1h-16zM8 10h18v1h-18zM40 9h9v1h-9z"/>' +
  '<path fill="#6a5040" d="M20 3h1v1h-1zM24 3h1v1h-1zM50 10h1v1h-1zM54 10h1v1h-1z"/>'
const SHELF = ['.b..pp.....', '.b..pp..jj.', 'bbb.Pp..jj.', 'sssssssssss', '.s.......s.']
const SHELF_PAL: Palette = { b: 0x4d7a8c, p: 0x9a4a5a, P: 0xc56a7a, j: 0x8a8f72, s: 0x5e4232 }
const TABLE = ['vvvvvvvvvvvvvvvv', 'tttttttttttttttt', '.uuuuuuuuuuuuuu.', '.u............u.', '.u............u.']
const CANDLE = ['.f.', '.F.', '.c.', 'ccc']
const CANDLE_B = ['f..', '.F.', '.c.', 'ccc']
const CANDLE_OUT = ['...', '...', '.c.', 'ccc']
const CANDLE_PAL: Palette = { f: 0xffd45c, F: 0xff8c2e, c: 0xe9dfc8 }
const MUG = ['mmm.', 'mMmm', 'mmm.']
// A little painting of a hill under a sky, in a frame.
const PICTURE = ['ffffffff', 'fsssssyf', 'fssssssf', 'fssgggsf', 'fggGgggf', 'ffffffff']
const PICTURE_PAL: Palette = { f: 0x7a5a2c, s: 0x7da7c4, y: 0xe8d58a, g: 0x4e8a4a, G: 0x6aa85a }

function cabinSvg(hour: number): string {
  const h = clock(hour)
  const l = lightAt(h)
  const night = phaseAt(h) === 'night'
  const lit = night || h >= 18 || h < 6
  const v = 'advC'
  const defs = `<defs><pattern id="advPlanks" width="64" height="14" patternUnits="userSpaceOnUse">${PLANKS}</pattern>${skyGrad(`${v}s`, l.top, l.low)}<radialGradient id="advCandle"><stop offset="0" stop-color="#ffc46b" stop-opacity="0.4"/><stop offset="1" stop-color="#ffc46b" stop-opacity="0"/></radialGradient></defs>`
  const wall = `<rect width="100%" height="${H}" fill="url(#advPlanks)"/>${night ? `<rect width="100%" height="${H}" fill="#0b0814" opacity="0.3"/>` : ''}`
  // The window: 30 x 20, four panes of sky with the sun or the moon.
  const view = night
    ? `${art(MOON, { M: l.orb, m: mix(l.orb, l.top, 0.35) }, 1.5, 17, 2)}<path fill="#e8e8ff" d="M5 4h1v1h-1zM10 11h1v1h-1zM23 13h1v1h-1z"/>`
    : `${art(SUN, { o: l.orb, O: mix(l.orb, 0xffffff, 0.5) }, 1.5, 18, 3)}${art(CLOUD, { c: l.cloud, C: mix(l.cloud, l.low, 0.5) }, 1.5, 3, 9)}`
  const window =
    `<rect x="-2" y="-2" width="34" height="24" fill="#2b1d15"/><svg x="1" y="1" width="28" height="18"><rect width="28" height="18" fill="url(#${v}s)"/>${view}</svg>` +
    `<path fill="#2b1d15" d="M14 1h2v18h-2zM1 9h28v2h-28z"/><path fill="#7a5640" d="M-4 22h38v3h-38z"/>` +
    `<path fill="#8c3d38" d="M-6 -3h6v22h-2v-14h-2v18h-2z"/><path fill="#8c3d38" d="M30 -3h6v26h-2v-18h-2v14h-2z"/><path fill="#6e2e2a" d="M-6 -3h36v2h-36z"/>`
  const shelf = at(47, 10, art(SHELF, SHELF_PAL, 2))
  const glow = lit ? `<circle cx="4.5" cy="1" r="22" fill="url(#advCandle)"><animate attributeName="opacity" values="1;0.75;1;0.85;1" dur="2.3s" repeatCount="indefinite"/></circle>` : ''
  const candle = lit ? frames(art(CANDLE, CANDLE_PAL, 1.5), art(CANDLE_B, CANDLE_PAL, 1.5), 0.42) : art(CANDLE_OUT, CANDLE_PAL, 1.5)
  const table = at(70, GROUND_Y_PX - TABLE.length * 2, `${art(TABLE, { v: 0x8a6244, t: 0x6a4834, u: 0x4e3424 }, 2)}<g transform="translate(7 -6)">${glow}${candle}</g>${art(MUG, { m: 0x8a95a3, M: 0xb6c0cc }, 2, 19, -6)}`)
  const floor = `<rect y="${GROUND_Y_PX + 1}" width="100%" height="${H - GROUND_Y_PX - 1}" fill="#5a4030"/><rect y="${GROUND_Y_PX}" width="100%" height="1" fill="#2a1c15"/><rect y="${GROUND_Y_PX + 1}" width="100%" height="1" fill="#74563f"/>`
  const joints = `<g fill="#3e2b20">${[9, 23, 38, 54, 67, 83, 96].map(p => `<rect x="${p}%" y="${GROUND_Y_PX + 2}" width="1" height="${H - GROUND_Y_PX - 2}"/>`).join('')}</g>`
  const picture = at(88, 8, art(PICTURE, PICTURE_PAL, 2))
  return `${defs}${lane(`${wall}${at(22, 9, window)}${shelf}${table}${picture}${floor}${joints}`)}`
}

// ── Beds ────────────────────────────────────────────────────────────────
// Row 0 is the surface the sleeper lies on: its bottom row covers the middle
// 12 columns of it. The hero lies facing left, head on the bed's left end.
// Terminal: rows + (float ? 1 : 0) must stay <= 5 to keep the sleeper on it.

const BEDS: Record<AdventurerScene, Bed> = {
  // A bedroll on a canvas ground sheet: pillow at the head, blanket rolled
  // up at the foot.
  forest: {
    rows: ['.PP.BBBBBBBBBBr.', 'PPPpBBbBBBBbBBrr', 'nnnnnnnnnnnnnnnn'],
    pal: { P: 0xf0e9d6, p: 0xc9bea2, B: 0xb8443a, b: 0xe2a942, r: 0x7e2e27, n: 0xb59a6c },
    float: 0,
  },
  // A fur pelt over a stone slab.
  cavern: {
    rows: ['.FFFFFFFFFFFF.', 'FfFFfFFFfFFfFF', 'zzzzzzzzzzzzzz', 'SS.ss....ss.SS'],
    pal: { F: 0xd9c4a0, f: 0xa88f6a, z: 0x9a97a3, S: 0x6e6b78, s: 0x56535f },
    float: 0,
  },
  // A little island of turf, bobbing in the air like the cat's cloud.
  night: {
    rows: ['GkGGGGGkGGGGkG', 'gGgggGgggGgggg', '.DDdDDDDDdDDD.', '...DDdrDDd....'],
    pal: { G: 0x4f9e48, k: 0x7cc566, g: 0x357a35, D: 0x7a4f31, d: 0x5a3922, r: 0x9a7a52 },
    float: 5,
  },
  // A low wooden bed: pillow, quilt, frame and legs.
  cabin: {
    rows: ['HPPPQBBBBBBBBBBH', 'HPPPQBBbBBBbBBBH', 'HwwwwwwwwwwwwwwH', 'H..............H'],
    pal: { H: 0x5a3a24, P: 0xf2ede1, Q: 0xd9d2c0, B: 0x4f78c4, b: 0x2f528f, w: 0x9a6b47 },
    float: 0,
  },
}

// ── Scenes ──────────────────────────────────────────────────────────────

// The pack's scenes, in the shape Pack.scenes takes; `bg` is the terminal's
// one background colour behind the lane's cells.
export const ADVENTURER_WORLD: Record<AdventurerScene, Scene> = {
  forest: { label: 'Forest', bg: 0x17301f, bed: BEDS.forest, backdrop: forestSvg },
  cavern: { label: 'Cavern', bg: 0x1c1a21, bed: BEDS.cavern, backdrop: cavernSvg },
  night: { label: 'Night', bg: 0x10162a, bed: BEDS.night, backdrop: nightSvg },
  cabin: { label: 'Cabin', bg: 0x33251c, bed: BEDS.cabin, backdrop: cabinSvg },
}

// ── Props ───────────────────────────────────────────────────────────────
// All drawn with WORLD_PAL (see Tiles), at lane scale.

export const TREE = [
  '...kLLL...',
  '.kkLLLLLl.',
  'kLLLLkLLLl',
  'kLLkLLLLll',
  'LLLLLLLlLl',
  '.lLLLlLll.',
  '..llTlll..',
  '....Tt....',
  '....Tt....',
  '...TTtt...',
]
export const LOG = ['.tTTTTTTTTr.', 'TTttTTTTTrRr', 'TTTTTtTTTRrR', '.tttttttttr.']
export const STUMP = ['.rrrrrr.', '.rRRRRr.', '.TTtTTt.', '.TtTTtT.', 'TTtTTtTt']

export const WORKBENCH = ['.a.....A..', '.aa.wwwAa.', 'vvvvvvvvvv', 'WWWWWWWWWW', 'w.wwwwww.w', 'w........w']
// The horn points left; mirror the rows to face it right.
export const ANVIL = ['..hhhhhh', 'hhAAAAAa', '...AAa..', '..AAAAa.', '.aaaaaaa']
export const FURNACE_A = ['..sSs..', '.zSSSs.', 'zSKKKSs', 'SKfFoKs', 'SKFfFKs', 'sssssss']
export const FURNACE_B = ['..sSs..', '.zSSSs.', 'zSKfKSs', 'SKFfFKs', 'SKoFFKs', 'sssssss']
const TORCH_WALL = ['.f.', 'fFf', 'FoF', '.T.', '.t.']
// The flame's other frame, for a flicker.
const TORCH_WALL_B = ['f..', '.fF', 'FoF', '.T.', '.t.']
