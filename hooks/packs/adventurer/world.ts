// The Adventurer pack's world: four scenes with their beds, and the large
// props the hero works with. Plain data and pure string builders, no imports.
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

type Rows = string[]
type Palette = Record<string, number>
export type Bed = { rows: Rows; pal: Palette; float: number }
export type WorldScene = { label: string; bg: number; bed: Bed; backdrop(hour: number): string }
export type AdventurerScene = 'forest' | 'cavern' | 'night' | 'cabin'

// Lane geometry, as in engine/geometry.ts (PX, LANE_H).
const PX = 3
const H = 42
// The ground line: floors and turf run from here to the bottom, behind the
// hero's legs and boots.
const GROUND = 36

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')
const num = (n: number) => String(Math.round(n * 100) / 100)

// One path per colour, one subpath per run of it: a fraction of the
// characters of a rect per run, which keeps each backdrop under budget.
function art(rows: Rows, pal: Palette, s = PX, dx = 0, dy = 0): string {
  const d: Record<string, string> = {}
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]
      let run = 1
      while (row[x + run] === ch) run++
      if (pal[ch] !== undefined) d[ch] = (d[ch] ?? '') + `M${num(dx + x * s)} ${num(dy + y * s)}h${num(run * s)}v${num(s)}h${num(-run * s)}z`
      x += run
    }
  })
  return Object.keys(d).map(ch => `<path fill="${hex(pal[ch])}" d="${d[ch]}"/>`).join('')
}

// A shape defined once and placed at percent x positions (fixed pixel size,
// so it keeps its shape however wide the lane is).
const def = (id: string, body: string) => `<g id="${id}">${body}</g>`
const place = (id: string, spots: [number, number][]) => spots.map(([p, y]) => `<use href="#${id}" x="${p}%" y="${y}"/>`).join('')
// Something drawn once at a percent x and a pixel y.
const at = (p: number, y: number, body: string) => `<svg x="${num(p)}%" y="${y}" overflow="visible">${body}</svg>`

// A pixel tile repeated across the lane from y down, one tile tall unless
// told otherwise.
function band(id: string, tile: Rows, pal: Palette, y: number, s = PX, height = tile.length * s): string {
  const w = tile[0].length * s
  const h = tile.length * s
  return `<pattern id="${id}" y="${y}" width="${w}" height="${h}" patternUnits="userSpaceOnUse">${art(tile, pal, s)}</pattern><rect y="${y}" width="100%" height="${height}" fill="url(#${id})"/>`
}

// The lane's rounded box: everything a backdrop draws is clipped to it.
function lane(body: string): string {
  return `<clipPath id="advClip"><rect width="100%" height="${H}" rx="6"/></clipPath><g clip-path="url(#advClip)" shape-rendering="crispEdges">${body}</g>`
}

// Two frames, the first shown for the first half of each period.
function flicker(a: string, b: string, period: number, begin = 0): string {
  const anim = (v: string) => `<animate attributeName="opacity" values="${v}" dur="${period}s" begin="${begin}s" calcMode="discrete" repeatCount="indefinite"/>`
  return `<g>${a}${anim('1;0')}</g><g opacity="0">${b}${anim('0;1')}</g>`
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

// ── Time of day ─────────────────────────────────────────────────────────

// A whole hour in 0..23; anything that is not a number reads as noon.
function clock(hour: number): number {
  return Number.isFinite(hour) ? ((Math.floor(hour) % 24) + 24) % 24 : 12
}

const mix = (a: number, b: number, t: number) => {
  const ch = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

// The outdoor light at four times of day; the hours between are blended.
type Light = {
  top: number; low: number // sky, zenith and horizon
  far: number // distant hills
  tree: number; treeLo: number; trunk: number // the treeline
  grass: number; grassHi: number; grassLo: number; dirt: number; dirtLo: number; dirtHi: number
  orb: number; cloud: number
}
const DAY: Light = {
  top: 0x6aa6d8, low: 0xb2d8ee, far: 0x96bccb,
  tree: 0x6a9a86, treeLo: 0x557f73, trunk: 0x6d5c50,
  grass: 0x4f9a41, grassHi: 0x77bd58, grassLo: 0x3b7c35, dirt: 0x93643f, dirtLo: 0x6c472c, dirtHi: 0xae7c52,
  orb: 0xfff1b5, cloud: 0xf3f8fb,
}
const DAWN: Light = {
  top: 0x6b6cab, low: 0xf0b6a2, far: 0xa092b0,
  tree: 0x6a7590, treeLo: 0x58627c, trunk: 0x5c4f56,
  grass: 0x4a8442, grassHi: 0x6ca655, grassLo: 0x37693a, dirt: 0x845a42, dirtLo: 0x603f31, dirtHi: 0x9b6d50,
  orb: 0xffd8a0, cloud: 0xf6d2ca,
}
const DUSK: Light = {
  top: 0x4c4688, low: 0xee985f, far: 0x8e6e8c,
  tree: 0x575a76, treeLo: 0x474964, trunk: 0x4d4044,
  grass: 0x44743c, grassHi: 0x63924c, grassLo: 0x325a35, dirt: 0x795339, dirtLo: 0x58392a, dirtHi: 0x8f6346,
  orb: 0xffb874, cloud: 0xf3b48e,
}
const NIGHT: Light = {
  top: 0x0d1330, low: 0x202c5a, far: 0x141b3a,
  tree: 0x0e1429, treeLo: 0x0b1022, trunk: 0x0b1022,
  grass: 0x21482f, grassHi: 0x2d5f3e, grassLo: 0x183726, dirt: 0x302a35, dirtLo: 0x221e27, dirtHi: 0x3b343f,
  orb: 0xf3ead0, cloud: 0x26315c,
}

// The cat's hours: night from 21:00 to 4:59, dawn at 5 and 6, dusk 18 to 20.
function lightAt(hour: number): Light {
  const h = clock(hour)
  const blend = (a: Light, b: Light, t: number): Light => {
    const out = {} as Light
    for (const k in a) (out as Record<string, number>)[k] = mix((a as Record<string, number>)[k], (b as Record<string, number>)[k], t)
    return out
  }
  if (h >= 21 || h < 5) return NIGHT
  if (h === 5) return blend(NIGHT, DAWN, 0.6)
  if (h === 6) return DAWN
  if (h === 7) return blend(DAWN, DAY, 0.6)
  if (h < 17) return DAY
  if (h === 17) return blend(DAY, DUSK, 0.35)
  if (h === 18) return blend(DAY, DUSK, 0.75)
  if (h === 19) return DUSK
  return blend(DUSK, NIGHT, 0.5)
}

export type WorldSky = { top: string; low: string; isNight: boolean; phase: 'night' | 'dawn' | 'day' | 'dusk' }

// The sky for a local hour, for anything else that wants to match it.
export function worldSky(hour: number): WorldSky {
  const h = clock(hour)
  const l = lightAt(h)
  const phase = h >= 21 || h < 5 ? 'night' : h < 7 ? 'dawn' : h >= 18 ? 'dusk' : 'day'
  return { top: hex(l.top), low: hex(l.low), isNight: phase === 'night', phase }
}

// A vertical sky gradient.
const skyGrad = (id: string, top: number, low: number) =>
  `<linearGradient id="${id}" x2="0" y2="1"><stop offset="0" stop-color="${hex(top)}"/><stop offset="1" stop-color="${hex(low)}"/></linearGradient>`

const SUN = ['..oo..', '.oOOo.', 'oOOOOo', 'oOOOOo', '.oOOo.', '..oo..']
const MOON = ['..MMM.', '.MMm..', 'MMm...', 'MMm...', 'MMm...', '.MMm..', '..MMM.']
const CLOUD = ['...ccc....', '.cccccccc.', 'cccccccccc', '.CCCCCCCC.']

// ── Forest ──────────────────────────────────────────────────────────────
// Sky for the hour (sun by day, moon and stars by night), soft blue hills,
// a quiet treeline, and grass-topped dirt blocks along the bottom.

const HILL_A = [
  '..........hhhhhh..............',
  '......hhhhhhhhhhhhhh..........',
  '...hhhhhhhhhhhhhhhhhhhhh......',
  '.hhhhhhhhhhhhhhhhhhhhhhhhhhh..',
  'hhhhhhhhhhhhhhhhhhhhhhhhhhhhhh',
]
const HILL_B = ['.......hhhh.........', '...hhhhhhhhhhhh.....', 'hhhhhhhhhhhhhhhhhhhh']
// The treeline, 2 CSS px a pixel: smaller than the props, so it reads as
// further off. a canopy, b its shade, t trunk.
const PINE = ['...a...', '..aab..', '..aab..', '.aaabb.', '..aab..', '.aaabb.', 'aaaabbb', '.aaabb.', 'aaaabbb', '...t...', '...t...']
const BUSH = ['..aaab..', '.aaaaabb', 'aaaaaabb', 'aaaaabbb', '.aaabbb.', '..abbb..', '...tt...', '...tt...', '...tt...']
// Three blocks of grass over dirt: grass behind the hero's legs, dirt behind
// its boots. The darker pixel every 4 columns is a block's seam.
const TURF = ['kGGGgGkGGGGg', 'lDeDlDDDlDeD']
const TUFT = ['k.k.', 'GkGk']
const FLOWER = ['.y.', 'yoy', '.G.']

function forestSvg(hour: number): string {
  const h = clock(hour)
  const l = lightAt(h)
  const night = h >= 21 || h < 5
  const v = 'advF'
  const tree = { a: l.tree, b: l.treeLo, t: l.trunk }
  const defs = `<defs>${skyGrad(`${v}s`, l.top, l.low)}${def(`${v}h`, art(HILL_A, { h: l.far }))}${def(`${v}k`, art(HILL_B, { h: l.far }))}${def(`${v}p`, art(PINE, tree, 2))}${def(`${v}b`, art(BUSH, tree, 2))}${def(`${v}c`, art(CLOUD, { c: l.cloud, C: mix(l.cloud, l.low, 0.5) }, 2))}${def(`${v}t`, art(TUFT, { G: l.grass, k: l.grassHi }, 2))}${night ? '' : def(`${v}f`, art(FLOWER, { y: 0xf2d86a, o: 0xe2774a, G: l.grass }, 2))}</defs>`
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
  const clouds = night ? '' : `<g opacity="0.85">${place(`${v}c`, [[13, 5], [37, 9], [74, 4]])}</g>`
  const hills = place(`${v}h`, [[-4, GROUND - 15], [22, GROUND - 15], [55, GROUND - 15], [80, GROUND - 15]]) + place(`${v}k`, [[11, GROUND - 9], [40, GROUND - 9], [70, GROUND - 9], [93, GROUND - 9]]) + `<rect y="${GROUND - 3}" width="100%" height="3" fill="${hex(l.far)}"/>`
  const trees =
    place(`${v}p`, [[3, GROUND - 22], [17, GROUND - 22], [29, GROUND - 22], [46, GROUND - 22], [62, GROUND - 22], [75, GROUND - 22], [89, GROUND - 22]]) +
    place(`${v}b`, [[9, GROUND - 18], [24, GROUND - 18], [38, GROUND - 18], [55, GROUND - 18], [68, GROUND - 18], [83, GROUND - 18], [96, GROUND - 18]])
  const turf = band(`${v}g`, TURF, { G: l.grass, k: l.grassHi, g: l.grassLo, D: l.dirt, l: l.dirtLo, e: l.dirtHi }, GROUND)
  const tufts = place(`${v}t`, [[6, GROUND - 4], [21, GROUND - 4], [34, GROUND - 4], [51, GROUND - 4], [66, GROUND - 4], [79, GROUND - 4], [93, GROUND - 4]]) + (night ? '' : place(`${v}f`, [[13, GROUND - 6], [43, GROUND - 6], [72, GROUND - 6], [87, GROUND - 6]]))
  return `${defs}${lane(`${sky}${orb}${clouds}${hills}${trees}${turf}${tufts}`)}`
}

// ── Cavern ──────────────────────────────────────────────────────────────
// A dark rock wall with ore specks, mine supports, two torches throwing a
// warm flickering glow, stalactites and a stone floor.

// The rock, 16 x 8 pixels at 3 px, repeated: a darker and a lighter mottle.
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
const SPECKS: Record<string, Rows> = {
  copper: ['Cc.', '.CC'],
  iron: ['.I', 'Ii', 'I.'],
  gold: ['Y.Y', '.y.'],
  gem: ['.g', 'gG'],
}
const SPECK_PAL: Palette = { C: 0xc47a45, c: 0x8f552e, I: 0xb89c88, i: 0x80695b, Y: 0xd9b443, y: 0x9e7c26, g: 0x3fa9b8, G: 0x93e2ec }
const DRIP = ['ssss', '.sS.', '.s..', '.s..']
const DRIP_B = ['sss', '.S.']
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
const STONE_FLOOR = ['SzSSSSSzSSzS', 'qsssqsssqsss']

function cavernSvg(_hour: number): string {
  const torch = (p: number, begin: number) =>
    at(p, 8, `<circle cx="4.5" cy="4" r="30" fill="url(#advGlow)"><animate attributeName="opacity" values="1;0.7;0.95;0.75;1" dur="1.9s" begin="${begin}s" repeatCount="indefinite"/></circle>${flicker(art(TORCH_WALL, WORLD_PAL), art(TORCH_WALL_B, WORLD_PAL), 0.4, begin)}`)
  const defs = `<defs><radialGradient id="advGlow"><stop offset="0" stop-color="#ffb04a" stop-opacity="0.42"/><stop offset="0.5" stop-color="#ff8a2e" stop-opacity="0.13"/><stop offset="1" stop-color="#ff8a2e" stop-opacity="0"/></radialGradient>${def('advSup', art(SUPPORT, { B: 0x4c3627, b: 0x3a291d, P: 0x45311f, p: 0x33241a }, 2))}${def('advDrip', art(DRIP, { s: 0x37333f, S: 0x46414f }, 2))}${def('advDripB', art(DRIP_B, { s: 0x37333f, S: 0x46414f }, 2))}</defs>`
  const wall = `<rect width="100%" height="${H}" fill="#25222b"/>${band('advRock', ROCK, { a: 0x1d1b22, b: 0x2e2a35 }, 0, PX, H)}`
  const specks = ([[7, 9, 'copper'], [13, 26, 'gem'], [23, 30, 'iron'], [34, 5, 'gold'], [41, 18, 'iron'], [52, 27, 'copper'], [58, 4, 'gem'], [74, 27, 'gold'], [80, 13, 'copper'], [88, 6, 'iron'], [95, 22, 'copper']] as [number, number, string][])
    .map(([p, y, k]) => at(p, y, art(SPECKS[k], SPECK_PAL, 2)))
    .join('')
  const sparkle = `<g fill="#d8fbff">${[[13.6, 25], [58.6, 3]].map(([p, y]) => `<rect x="${p}%" y="${y}" width="1" height="1"/>`).join('')}<animate attributeName="opacity" values="0;1;0;0" keyTimes="0;0.1;0.2;1" dur="3.1s" repeatCount="indefinite"/></g>`
  const supports = place('advSup', [[28, 0], [69, 0]])
  const drips = place('advDrip', [[11, 0], [43, 0], [86, 0]]) + place('advDripB', [[19, 0], [53, 0], [62, 0], [97, 0]])
  const floor = band('advFloor', STONE_FLOOR, { z: 0x5f5b6a, S: 0x4a4652, s: 0x3a3742, q: 0x2c2a33 }, H - STONE_FLOOR.length * PX)
  return `${defs}${lane(`${wall}${specks}${sparkle}${supports}${drips}${torch(17, 0)}${torch(56, 0.7)}${floor}`)}`
}

// ── Night ───────────────────────────────────────────────────────────────
// A dark blue sky, a crescent moon that crosses it through the night,
// twinkling stars and a falling one, dark hills with pines, and fireflies.

const NIGHT_HILL = [
  '.........nnnnnn...............',
  '....nnnnnnnnnnnnnnnn..........',
  '.nnnnnnnnnnnnnnnnnnnnnnnnn....',
  'nnnnnnnnnnnnnnnnnnnnnnnnnnnnnn',
]

function nightSvg(hour: number): string {
  const h = clock(hour)
  // Left of centre in the evening, right by morning; by day it waits high.
  const t = h >= 18 ? (h - 18) / 12 : h < 6 ? (h + 6) / 12 : 0.5
  const moonX = 8 + t * 78
  const moonY = Math.round(2 + 8 * (1 - Math.sin(Math.PI * (0.1 + 0.8 * t))))
  const defs = `<defs>${skyGrad('advNs', 0x0b1027, 0x1f2a58)}<radialGradient id="advHalo"><stop offset="0" stop-color="#f3ead0" stop-opacity="0.28"/><stop offset="1" stop-color="#f3ead0" stop-opacity="0"/></radialGradient>${def('advNh', art(NIGHT_HILL, { n: 0x141b3a }))}${def('advNp', art(PINE, { a: 0x0d1329, b: 0x0a0f22, t: 0x0a0f22 }, 2))}</defs>`
  const sky = `<rect width="100%" height="${H}" fill="url(#advNs)"/>`
  const field = stars([[3, 5], [8, 16], [14, 3], [20, 11], [25, 20], [31, 6], [37, 14], [44, 3], [50, 10], [55, 18], [61, 5], [67, 13], [73, 3], [78, 19], [84, 8], [90, 15], [95, 4], [98, 12]], '#e6e8ff')
  const falling = `<svg x="58%" y="2" overflow="visible"><path d="M0 0h2v1h2v1h2v1h-6z" fill="#f4f1ff" opacity="0"><animate attributeName="opacity" values="0;1;0;0" keyTimes="0;0.03;0.07;1" dur="11s" begin="2s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="translate" values="0 0;-40 14;-40 14" keyTimes="0;0.07;1" dur="11s" begin="2s" repeatCount="indefinite"/></path></svg>`
  const moon = at(moonX, moonY, `<circle cx="6" cy="7" r="15" fill="url(#advHalo)"/>${art(MOON, { M: 0xf3ead0, m: 0xcfc6a6 }, 2)}`)
  const hills = place('advNh', [[-3, GROUND - 12], [21, GROUND - 12], [47, GROUND - 12], [74, GROUND - 12]]) + `<rect y="${GROUND - 3}" width="100%" height="3" fill="#141b3a"/>`
  const pines = place('advNp', [[6, GROUND - 22], [10, GROUND - 22], [33, GROUND - 22], [52, GROUND - 22], [57, GROUND - 22], [81, GROUND - 22], [92, GROUND - 22]])
  const turf = band('advNg', TURF, { G: NIGHT.grass, k: NIGHT.grassHi, g: NIGHT.grassLo, D: NIGHT.dirt, l: NIGHT.dirtLo, e: NIGHT.dirtHi }, GROUND)
  const flies = ([[15, 27], [39, 23], [63, 29], [87, 24]] as [number, number][])
    .map(([p, y], i) => `<rect x="${p}%" y="${y}" width="2" height="2" fill="#d6f07a" opacity="0"><animate attributeName="opacity" values="0;0.9;0" dur="${3 + (i % 2)}s" begin="${i * 0.9}s" repeatCount="indefinite"/><animate attributeName="y" values="${y};${y - 5};${y}" dur="${5 + i}s" repeatCount="indefinite"/></rect>`)
    .join('')
  return `${defs}${lane(`${sky}${field}${falling}${moon}${hills}${pines}${turf}${flies}`)}`
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
  const night = h >= 21 || h < 5
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
  const candle = lit ? flicker(art(CANDLE, CANDLE_PAL, 1.5), art(CANDLE_B, CANDLE_PAL, 1.5), 0.42) : art(CANDLE_OUT, CANDLE_PAL, 1.5)
  const table = at(70, GROUND - TABLE.length * 2, `${art(TABLE, { v: 0x8a6244, t: 0x6a4834, u: 0x4e3424 }, 2)}<g transform="translate(7 -6)">${glow}${candle}</g>${art(MUG, { m: 0x8a95a3, M: 0xb6c0cc }, 2, 19, -6)}`)
  const floor = `<rect y="${GROUND + 1}" width="100%" height="${H - GROUND - 1}" fill="#5a4030"/><rect y="${GROUND}" width="100%" height="1" fill="#2a1c15"/><rect y="${GROUND + 1}" width="100%" height="1" fill="#74563f"/>`
  const joints = `<g fill="#3e2b20">${[9, 23, 38, 54, 67, 83, 96].map(p => `<rect x="${p}%" y="${GROUND + 2}" width="1" height="${H - GROUND - 2}"/>`).join('')}</g>`
  const picture = at(88, 8, art(PICTURE, PICTURE_PAL, 2))
  return `${defs}${lane(`${wall}${at(22, 9, window)}${shelf}${table}${picture}${floor}${joints}`)}`
}

// ── Beds ────────────────────────────────────────────────────────────────
// Row 0 is the surface the sleeper lies on: its bottom row covers the middle
// 12 columns of it. The hero lies facing left, head on the bed's left end.
// Terminal: rows + (float ? 1 : 0) must stay <= 5 to keep the sleeper on it.

export const ADVENTURER_BEDS: Record<AdventurerScene, Bed> = {
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

export const ADVENTURER_SCENES: AdventurerScene[] = ['forest', 'cavern', 'night', 'cabin']

// Terminal: one background colour behind the lane's cells.
export const ADVENTURER_BG: Record<AdventurerScene, number> = { forest: 0x17301f, cavern: 0x1c1a21, night: 0x10162a, cabin: 0x33251c }

export const ADVENTURER_BACKDROPS: Record<AdventurerScene, (hour: number) => string> = {
  forest: forestSvg,
  cavern: cavernSvg,
  night: nightSvg,
  cabin: cabinSvg,
}

// The pack's scenes, in the shape Pack.scenes takes.
export const ADVENTURER_WORLD: Record<AdventurerScene, WorldScene> = {
  forest: { label: 'Forest', bg: ADVENTURER_BG.forest, bed: ADVENTURER_BEDS.forest, backdrop: forestSvg },
  cavern: { label: 'Cavern', bg: ADVENTURER_BG.cavern, bed: ADVENTURER_BEDS.cavern, backdrop: cavernSvg },
  night: { label: 'Night', bg: ADVENTURER_BG.night, bed: ADVENTURER_BEDS.night, backdrop: nightSvg },
  cabin: { label: 'Cabin', bg: ADVENTURER_BG.cabin, bed: ADVENTURER_BEDS.cabin, backdrop: cabinSvg },
}

// The desktop backdrop for a scene at a local hour (0..23).
export function adventurerBackdrop(scene: AdventurerScene, hour = 12): string {
  return ADVENTURER_BACKDROPS[scene](hour)
}

// ── Props ───────────────────────────────────────────────────────────────
// All drawn with WORLD_PAL, at lane scale. Blocks are 4 x 4 and tile: a
// lighter top-left and a darker bottom row and right column make the seams
// when they stack. CRACK_n is laid over a block as it is mined.

export const WORLD_PAL: Palette = {
  // leaves: body, shade, light
  L: 0x4f9d3a, l: 0x2f6b2c, k: 0x86c95a,
  // bark, its shade; cut wood and its rings
  T: 0x7a5232, t: 0x51361f, r: 0xe0bb85, R: 0xa97c4b,
  // grass; dirt: body, shade, light
  G: 0x63b347, g: 0x3f8a36, D: 0x93623c, d: 0x6a4329, e: 0xb07a4d,
  // stone: body, shade, light
  S: 0x8b909a, s: 0x5f636d, z: 0xb4b9c2,
  // planks: body, shade, light
  W: 0xb98550, w: 0x8a5c33, v: 0xd6a66b,
  // ores: copper, iron, gold, each with its shade
  C: 0xe8874a, c: 0xa8562a, I: 0xe6b494, i: 0x9e6f56, Y: 0xf8d24a, y: 0xc8941c,
  // cracks
  x: 0x231c19,
  // iron: anvil and tool heads, shade, shine; chest bands; chest inside
  A: 0x5b616d, a: 0x3b3f48, h: 0x9fa6b2, b: 0x4e535d, n: 0x3a2618,
  // furnace mouth; fire: core, flame, edge
  K: 0x19161b, f: 0xffe07a, F: 0xff9a2e, o: 0xd9442b,
}

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

export const BLOCK_DIRT = ['eDDd', 'DDeD', 'DdDD', 'dddd']
// Dirt with grass on top, for the top row of anything built from dirt.
export const BLOCK_GRASS = ['GGkG', 'gDgG', 'DeDd', 'dddd']
export const BLOCK_STONE = ['zzSs', 'zSSs', 'SSSs', 'ssss']
export const BLOCK_WOOD = ['vWWw', 'wwww', 'Wvww', 'wwww']
export const ORE_BLOCK_COPPER = ['zCSs', 'SScs', 'CSSC', 'sssc']
export const ORE_BLOCK_IRON = ['zSIs', 'ISis', 'SSSI', 'siss']
export const ORE_BLOCK_GOLD = ['zSYs', 'YSys', 'SSSY', 'syss']
// Each stage keeps the last one's cracks and adds more.
export const CRACK_1 = ['....', '.x..', '..x.', '....']
export const CRACK_2 = ['...x', '.xx.', '..x.', '....']
export const CRACK_3 = ['x..x', '.xx.', '..x.', '.x.x']
export const CRACKS = [CRACK_1, CRACK_2, CRACK_3]

export const WORKBENCH = ['.a.....A..', '.aa.wwwAa.', 'vvvvvvvvvv', 'WWWWWWWWWW', 'w.wwwwww.w', 'w........w']
// The horn points left; mirror the rows to face it right.
export const ANVIL = ['..hhhhhh', 'hhAAAAAa', '...AAa..', '..AAAAa.', '.aaaaaaa']
export const FURNACE_A = ['..sSs..', '.zSSSs.', 'zSKKKSs', 'SKfFoKs', 'SKFfFKs', 'sssssss']
export const FURNACE_B = ['..sSs..', '.zSSSs.', 'zSKfKSs', 'SKFfFKs', 'SKoFFKs', 'sssssss']
export const CHEST_SHUT = ['.vvvvvv.', 'vWWWWWWw', 'bbbYYbbb', 'bWWyYWWb', 'bwwwwwwb']
// The lid swings up and back: its inside shows above the gold.
export const CHEST_OPEN = ['.wvvvvw.', '.wnnnnw.', 'bnYyYYnb', 'bbbbbbbb', 'bWWyYWWb', 'bwwwwwwb']
export const TORCH_WALL = ['.f.', 'fFf', 'FoF', '.T.', '.t.']
// The flame's other frame, for a flicker.
export const TORCH_WALL_B = ['f..', '.fF', 'FoF', '.T.', '.t.']

export const WORLD_PROPS: Record<string, Rows> = {
  TREE, LOG, STUMP,
  BLOCK_DIRT, BLOCK_GRASS, BLOCK_STONE, BLOCK_WOOD, ORE_BLOCK_COPPER, ORE_BLOCK_IRON, ORE_BLOCK_GOLD,
  CRACK_1, CRACK_2, CRACK_3,
  WORKBENCH, ANVIL, FURNACE_A, FURNACE_B, CHEST_SHUT, CHEST_OPEN, TORCH_WALL, TORCH_WALL_B,
}
