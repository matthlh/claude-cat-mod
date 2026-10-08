import { test, expect } from 'claude-code/testing'
import { laneSvg, laneCells, PALETTES } from '../hooks/register'
import type { Extras } from '../hooks/register'
import type { Activity, Cat, Coat, Hat, Marking, Mood, Motion, Scene, ToolProp } from '../types'
import { GOLDEN } from './golden.fixture'

// Golden hashes of the lane drawings: the desktop SVG and the terminal cells,
// over a fixed matrix of activities, moods, scenes, directions, moments in a
// leg, hats, markings, coats, context, time of day, widths and speech. Each
// case is one drawing call, stored as its FNV-1a hash (in golden.fixture.ts),
// so a refactor of the drawing code can prove it changed nothing, byte for byte.
//
// Everything below is deterministic: the secondary choices for a leg (its coat,
// hat, span, duration, start time...) are picked by hashing the leg's own name,
// never by Math.random or the clock.
//
// When a change to the drawings IS intended: set REGENERATE to true, run
//   claude plugin test . 2>&1 | sed -n '/^\/\/ golden.fixture.ts begin$/,/^\/\/ golden.fixture.ts end$/p' > /tmp/golden.fixture.ts
// check the test failed only because REGENERATE is on, copy that file over
// tests/golden.fixture.ts, and set REGENERATE back to false. Never regenerate to
// make a refactor pass: a refactor that moves a hash has changed a drawing.
const REGENERATE = false

// ── FNV-1a, 32-bit, over the string's UTF-8 bytes ───────────────────────────

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

function fnv1a(s: string): number {
  let h = FNV_OFFSET
  const byte = (b: number) => {
    h = Math.imul(h ^ b, FNV_PRIME)
  }
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i)
    if (c < 0x80) {
      h = Math.imul(h ^ c, FNV_PRIME)
      continue
    }
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1)
      if (lo >= 0xdc00 && lo < 0xe000) {
        c = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00)
        i++
      }
    }
    if (c < 0x800) {
      byte(0xc0 | (c >> 6))
      byte(0x80 | (c & 63))
    } else if (c < 0x10000) {
      byte(0xe0 | (c >> 12))
      byte(0x80 | ((c >> 6) & 63))
      byte(0x80 | (c & 63))
    } else {
      byte(0xf0 | (c >> 18))
      byte(0x80 | ((c >> 12) & 63))
      byte(0x80 | ((c >> 6) & 63))
      byte(0x80 | (c & 63))
    }
  }
  return h >>> 0
}

const hex8 = (n: number) => n.toString(16).padStart(8, '0')

// ── The matrix ──────────────────────────────────────────────────────────────

const MOODS: Mood[] = ['idle', 'working', 'done', 'oops', 'sleep', 'tired', 'pet', 'sit']
const SCENES: Scene[] = ['clear', 'grass', 'night', 'cozy']
const COATS: Coat[] = ['orange', 'tuxedo', 'black', 'grey', 'cream', 'sakura']
const HATS: Hat[] = ['none', 'party', 'beanie', 'wizard', 'crown']
const MARKINGS: Marking[] = ['none', 'blaze', 'socks', 'tip', 'spot']
const DIRS = [1, -1] as const
// null and absent both mean "no reading"; the rest walk the bowl from full to empty.
const CTXS: (number | null | undefined)[] = [null, undefined, 0, 23, 50, 81, 100]
// Day, dusk, night, dawn, small hours, afternoon.
const HOURS = [12, 19, 23, 6, 2, 15]
const SAYS: (string | null)[] = [
  null,
  null,
  'hi!',
  'hunting…',
  'got one! ♥',
  'out of juice… nap time and then some',
  'a<b & "c">d',
  '✦ ok',
]
// Where a moving leg runs (low, high); a right-facing leg goes low to high.
const SPANS: [number, number][] = [[0, 0.45], [0.12, 0.38], [0.3, 0.72], [0.5, 0.95], [0.6, 1]]
// Where a still leg sits.
const SPOTS = [0, 0.08, 0.3, 0.5, 0.62, 0.9, 1]
// When the line started, relative to the leg's start (absent: long ago).
const SAY_AT: (number | undefined)[] = [undefined, 0, -3000, 1000, 300]
// When it woke from the perch, relative to the leg's start (the perch slides away).
const WOKE_AT: (number | undefined)[] = [undefined, undefined, -100, 300, -5000]
const STRAY_PROPS: (ToolProp | null | undefined)[] = [undefined, null, 'edit', 'search']
// The start of the leg, 30% and 70% through, and a while after it ended.
const MOMENTS = [['start', 0], ['30%', 0.3], ['70%', 0.7], ['after', -1]] as const
type Moment = (typeof MOMENTS)[number]
const AT_30 = MOMENTS[1]

type Variant = {
  name: string
  activity?: Activity
  moves: boolean
  durs: number[]
  /** the cat's prop (busy only); absent picks a stray one */
  prop?: ToolProp | null
  hit?: boolean
  /** drawn in every scene rather than one picked scene */
  everyScene?: boolean
}

const moving = (name: string, activity: Activity | undefined, durs: number[], everyScene = false): Variant => ({ name, activity, moves: true, durs, everyScene })
const still = (name: string, activity: Activity | undefined, durs: number[], everyScene = false): Variant => ({ name, activity, moves: false, durs, everyScene })
const busy = (prop: ToolProp | null): Variant => ({ ...still(`busy:${prop}`, 'busy', [1500, 6000]), prop })

// Every Activity in types/index.d.ts, plus a plain walk and a pause with none.
const VARIANTS: Variant[] = [
  moving('walk', 'walk', [800, 2600, 5200]),
  moving('none:walk', undefined, [900, 3000]),
  still('none:pause', undefined, [3000], true),
  still('sit', 'sit', [4000, 7500]),
  still('groom', 'groom', [4000, 6500]),
  still('nap', 'nap', [15_000, 40_000]),
  moving('hop', 'hop', [1200, 3000]),
  moving('yarn', 'yarn', [1000, 2600]),
  moving('mouse', 'mouse', [800, 1600]),
  moving('butterfly', 'butterfly', [1500, 4000]),
  still('caught', 'caught', [3000]),
  moving('bird', 'bird', [2400, 5000]),
  still('flyaway', 'flyaway', [3000]),
  { ...still('fish:hit', 'fish', [7000, 10_000], true), hit: true },
  { ...still('fish:miss', 'fish', [7000, 10_000], true), hit: false },
  moving('laser', 'laser', [800, 1200]),
  moving('bed', 'bed', [900, 4200], true),
  still('perch', 'perch', [0], true),
  busy('read'),
  busy('edit'),
  busy('bash'),
  busy('search'),
  busy(null),
  moving('knock', 'knock', [1500, 3000]),
  still('shove', 'shove', [3600]),
  moving('meter', 'meter', [1000, 4000]),
  still('sitmeter', 'sitmeter', [8000, 12_000]),
]
const variant = (name: string) => VARIANTS.find(v => v.name === name)!

function pick<T>(key: string, axis: string, list: readonly T[]): T {
  return list[fnv1a(`${key}/${axis}`) % list.length]
}

type Surface = 'svg' | 40 | 100
type Case = { label: string; draw: () => string }

// What a block pins down instead of picking.
type Forced = {
  scene?: Scene
  hat?: Hat
  marking?: Marking
  shiny?: boolean
  ctx?: number | null | undefined
  hour?: number
  say?: string | null
  spot?: number
  bare?: boolean
}

const show = (v: unknown) => (v === undefined ? '-' : JSON.stringify(v))

// One leg of the walk, drawn at the given moments on the given surfaces.
function leg(key: string, v: Variant, mood: Mood, dir: 1 | -1, moments: readonly Moment[], surfaces: (moment: string) => Surface[], f: Forced = {}): Case[] {
  const t0 = 40_000 + (fnv1a(`${key}/t0`) % 30_000)
  const dur = pick(key, 'dur', v.durs)
  const span = pick(key, 'span', SPANS)
  const spot = f.spot ?? pick(key, 'spot', SPOTS)
  const [from, to] = v.activity === 'perch' ? [0, 0] : v.moves ? (dir === 1 ? span : [span[1], span[0]]) : [spot, spot]
  const scene = f.scene ?? pick(key, 'scene', SCENES)
  const coat = pick(key, 'coat', COATS)
  const say = 'say' in f ? (f.say ?? null) : pick(key, 'say', SAYS)
  const sayAt = pick(key, 'sayAt', SAY_AT)
  const wokeAt = mood === 'sleep' ? undefined : pick(key, 'wokeAt', WOKE_AT)
  const prop = 'prop' in v ? v.prop : pick(key, 'prop', STRAY_PROPS)
  const chain = v.activity === 'laser' ? pick(key, 'chain', [undefined, 0, 3]) : undefined
  const bare = f.bare ?? pick(key, 'bare', [false, false, false, false, false, false, true])
  const hat = f.hat ?? pick(key, 'hat', HATS)
  const marking = f.marking ?? pick(key, 'marking', MARKINGS)
  const shiny = f.shiny ?? pick(key, 'shiny', [false, true])
  const ctx = 'ctx' in f ? f.ctx : pick(key, 'ctx', CTXS)
  const hour = f.hour ?? pick(key, 'hour', HOURS)

  const looks = bare
    ? 'bare'
    : `hat=${hat} mark=${marking} shiny=${shiny} ctx=${show(ctx)} hour=${hour}`
  const about = `coat=${coat} scene=${scene} ${from}->${to} dur=${dur} t0=${t0} ${looks} say=${show(say)} sayAt=${show(sayAt)} woke=${show(wokeAt)} prop=${show(prop)}`

  const out: Case[] = []
  for (const [name, frac] of moments) {
    const base = dur || 4000
    const now = t0 + (frac < 0 ? base + 900 : Math.round(frac * base))
    for (const surface of surfaces(name)) {
      // Fresh objects per call, so a drawing that mutated its input could not
      // leak into the next case.
      const draw = () => {
        const m: Motion = { from, to, t0, dur }
        if (v.activity !== undefined) m.activity = v.activity
        if (v.hit !== undefined) m.hit = v.hit
        if (chain !== undefined) m.chain = chain
        const c: Cat = { mood, dir, say }
        if (sayAt !== undefined) c.sayAt = t0 + sayAt
        if (wokeAt !== undefined) c.wokeAt = t0 + wokeAt
        if (prop !== undefined) c.prop = prop
        const x: Extras | undefined = bare ? undefined : { ctx, identity: { marking, shiny }, hat, hour }
        return surface === 'svg'
          ? laneSvg(c, m, now, PALETTES[coat], scene, x)
          : laneCells(c, m, now, PALETTES[coat], surface, scene, x)
      }
      out.push({ label: `${key} @${name} ${surface === 'svg' ? 'svg' : `cells${surface}`} [${about}]`, draw })
    }
  }
  return out
}

const svgAndCells = (key: string) => (moment: string): Surface[] => ['svg', pick(`${key} ${moment}`, 'cols', [40, 100] as const)]
const allSurfaces = (): Surface[] => ['svg', 40, 100]
const dirName = (d: 1 | -1) => (d === 1 ? 'R' : 'L')

function buildCases(): Case[] {
  const cases: Case[] = []

  // Every activity x mood x direction, at four moments of the leg. Scene-bound
  // activities (fishing spots, the perch) and a bare pause go through every scene.
  for (const v of VARIANTS) {
    for (const mood of MOODS) {
      for (const dir of DIRS) {
        for (const scene of v.everyScene ? SCENES : [undefined]) {
          const key = `main ${v.name} ${mood} ${dirName(dir)}${scene ? ` ${scene}` : ''}`
          cases.push(...leg(key, v, mood, dir, MOMENTS, svgAndCells(key), scene ? { scene } : {}))
        }
      }
    }
  }

  // Every hat x marking x shiny, both ways, on each body: walking, sitting,
  // loafing, grooming, and asleep on the perch.
  for (const hat of HATS) {
    for (const marking of MARKINGS) {
      for (const shiny of [false, true]) {
        for (const dir of DIRS) {
          for (const pose of ['walk', 'sit', 'nap', 'groom', 'perch']) {
            const key = `wardrobe ${pose} ${hat} ${marking} ${shiny ? 'shiny' : 'plain'} ${dirName(dir)}`
            const mood: Mood = pose === 'perch' ? 'sleep' : 'idle'
            const f: Forced = { hat, marking, shiny, bare: false, ctx: null, hour: 12, say: null }
            cases.push(...leg(key, variant(pose), mood, dir, [AT_30], svgAndCells(key), f))
          }
        }
      }
    }
  }

  // Every scene at every hour (the sky tint, stars and the window's moon).
  for (const scene of SCENES) {
    for (let hour = 0; hour < 24; hour++) {
      const key = `sky ${scene} ${hour}`
      cases.push(...leg(key, variant('none:pause'), 'idle', 1, [AT_30], () => ['svg'], { scene, hour, bare: false, say: null }))
    }
  }

  // The food bowl from overfull to past empty, on both terminal widths.
  for (const ctx of [null, undefined, -10, 0, 4, 5, 12, 50, 87, 95, 96, 100, 140]) {
    const key = `ctx ${show(ctx)}`
    cases.push(...leg(key, variant('sit'), 'idle', 1, [AT_30], allSurfaces, { ctx, bare: false, say: null }))
  }

  // Speech bubbles against both lane edges, with and without a companion
  // ahead, on the desktop and both terminal widths.
  for (const say of SAYS.filter(s => s !== null)) {
    for (const spot of [0, 0.15, 0.5, 0.85, 1]) {
      for (const dir of DIRS) {
        for (const v of [variant('sit'), variant('busy:read')]) {
          const key = `bubble ${v.name} ${spot} ${dirName(dir)} ${show(say)}`
          const mood = pick(key, 'mood', MOODS.filter(m => m !== 'sleep'))
          cases.push(...leg(key, v, mood, dir, [AT_30], allSurfaces, { say, spot }))
        }
      }
    }
  }

  return cases
}

// ── The test ────────────────────────────────────────────────────────────────

test('the lane drawings match their golden hashes, byte for byte', { timeoutMs: 120_000 }, () => {
  // FNV-1a's published test vectors, so the hashes mean what they say.
  expect([fnv1a(''), fnv1a('a'), fnv1a('foobar')].map(hex8)).toEqual(['811c9dc5', 'e40c292c', 'bf9cf968'])

  const cases = buildCases()
  const got = cases.map(k => hex8(fnv1a(k.draw())))

  if (REGENERATE) {
    const lines: string[] = []
    for (let i = 0; i < got.length; i += 10) lines.push(got.slice(i, i + 10).join(' '))
    console.log(
      [
        '// golden.fixture.ts begin',
        '// One FNV-1a hash per case in tests/golden.test.tsx, in the order it builds',
        `// them (${got.length} cases). Generated by that test with REGENERATE on;`,
        '// never edit by hand.',
        'export const GOLDEN = `',
        ...lines,
        '`',
        '// golden.fixture.ts end',
      ].join('\n'),
    )
    throw new Error(`REGENERATE is on: printed ${got.length} hashes; copy them into tests/golden.fixture.ts and turn it off`)
  }

  const want = GOLDEN.trim().split(/\s+/)
  // A different count means the matrix itself changed, not the drawings.
  expect(cases.length).toBe(want.length)
  const changed: string[] = []
  got.forEach((h, i) => {
    if (h !== want[i]) changed.push(`${cases[i].label}: ${want[i]} -> ${h}`)
  })
  expect({ changed: changed.length, first: changed.slice(0, 12) }).toEqual({ changed: 0, first: [] })
})
