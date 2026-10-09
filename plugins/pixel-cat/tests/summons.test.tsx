import { test, expect } from 'claude-code/testing'
import { laneCells } from '../hooks/engine/cells'
import { CREW_MAX, crewArt, LEAVE_MS, muster } from '../hooks/engine/crew'
import { HERO_COLS, LANE_PIX, LANE_ROWS } from '../hooks/engine/geometry'
import { coatOf } from '../hooks/engine/lane'
import { laneSvg } from '../hooks/engine/svg'
import { FIGHTS, SUMMON_STAGGER } from '../hooks/packs/adventurer/activities'
import { MINIONS } from '../hooks/packs/adventurer/minions'
import { DAMAGE_PAL, ITEM_PAL, MOB_PAL, OUTFITS, TOOL_PAL } from '../hooks/packs/adventurer/sprites'
import { SUMMON_ORDER, SUMMONS, summonFor } from '../hooks/packs/adventurer/summons'
import { packFor } from '../hooks/packs/index'
import type { Palette } from '../hooks/packs/types'
import type { Follower, HeroState, Motion } from '../types'
import { pixelsOf } from './raster'

// The Adventurer's summons: a minion for each agent at work (Pack.crew),
// dashing at the foe in a fight, with a damage number for every hit.

const SVG_CAP = 131_072
const PACK = packFor('adventurer')
const COAT = coatOf(PACK)
const NOW = 200_000
const COLS = 160
const cellsLength = (cols: number) => Math.ceil((cols * LANE_ROWS * 12) / 3) * 4
const crewOf = (n: number): Follower[] => Array.from({ length: n }, (_, i) => ({ id: `a${i}`, slot: i, since: 0 }))
const agents = (list: [string, string][]) => list.map(([id, status]) => ({ id, status }))
// Each follower drawn on the desktop has one facing group.
const followersIn = (svg: string) => (svg.match(/<g transform="scale\(/g) ?? []).length
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')

const pixels = (cells: string, cols = COLS) => pixelsOf(cells, cols)
// The colours of a minion that nothing else in a fight is drawn in.
const others = new Set([...Object.values(OUTFITS), MOB_PAL, TOOL_PAL, ITEM_PAL, ...Object.values(DAMAGE_PAL)].flatMap(p => Object.values(p)))
const own = (pal: Palette) => new Set(Object.values(pal).filter(c => !others.has(c)))
const columnsOf = (cells: string, pal: Palette) => {
  const mine = own(pal)
  return pixels(cells).filter(([, , c]) => mine.has(c))
}
const heroCol = (p: number) => Math.round(p * (COLS - HERO_COLS - 1))

test('0, 1, 3 and 9 agents: summons in every scene and activity, on both surfaces, every desktop frame under the cap', () => {
  const sitting: Motion = { from: 0.5, to: 0.5, t0: NOW - 5000, dur: 8000, activity: 'sit' }
  const hero: HeroState = { mood: 'idle', dir: 1, say: null }
  for (const n of [0, 1, 3, 9]) {
    const crew = crewOf(n)
    for (const scene of Object.keys(PACK.scenes)) {
      // The desktop draws up to CREW_MAX of them, the rest a "+N".
      const svg = laneSvg(PACK, hero, sitting, NOW, COAT, scene, { crew })
      expect(followersIn(svg) - followersIn(laneSvg(PACK, hero, sitting, NOW, COAT, scene))).toBe(Math.min(n, CREW_MAX))
      expect(svg.includes(`>+${n - CREW_MAX}</text>`)).toBe(n > CREW_MAX)
      const cells = laneCells(PACK, hero, sitting, NOW, COAT, COLS, scene, { crew })
      expect(cells === laneCells(PACK, hero, sitting, NOW, COAT, COLS, scene)).toBe(n === 0)

      for (const [i, activity] of Object.keys(PACK.activities).entries()) {
        const a = PACK.activities[activity]
        const still = !!a?.move && 'stay' in a.move
        const m: Motion = { from: 0.4, to: still ? 0.4 : 0.6, t0: NOW, dur: 2600, activity, hit: i % 2 === 0 }
        for (const k of [0.1, 0.4, 0.5, 0.9]) {
          for (const dir of [1, -1] as const) {
            const c: HeroState = { mood: activity === PACK.roles.work ? 'working' : 'idle', dir, say: k > 0.5 ? 'hi' : null, sayAt: NOW, prop: 'edit' }
            const x = { crew, trail: [{ leg: { from: 0.8, to: 0.4, t0: NOW - 4000, dur: 3500 }, dir: -dir as 1 | -1 }], ctx: 40, hour: (i * 5) % 24 }
            const at = NOW + k * m.dur
            const frame = laneSvg(PACK, c, m, at, COAT, scene, x)
            if (frame.length >= SVG_CAP) throw new Error(`${activity} in ${scene} with ${n} at ${k}: ${frame.length} chars`)
            expect(laneCells(PACK, c, m, at, COAT, COLS, scene, x).length).toBe(cellsLength(COLS))
          }
        }
      }
    }
  }
  // Bedtime, too.
  for (const n of [0, 1, 3, 9]) {
    const bed: Motion = { from: 0, to: 0, t0: NOW - 1000, dur: 60_000, activity: 'perch' }
    const svg = laneSvg(PACK, { mood: 'sleep', dir: -1, say: null }, bed, NOW, COAT, 'night', { crew: crewOf(n) })
    expect(svg.length).toBeLessThan(SVG_CAP)
  }
})

test("each slot is a kind of its own, and an agent keeps its minion while it keeps its slot", () => {
  expect(SUMMON_ORDER).toEqual(['imp', 'slime', 'hornet', 'spider', 'raven'])
  // One kind for each place in sight, so every kind is seen.
  expect(SUMMON_ORDER.length).toBe(CREW_MAX)
  for (let slot = 0; slot < 12; slot++) {
    const kind = MINIONS[summonFor(slot)]
    const art = crewArt(SUMMONS, slot)
    expect(art.coats[0]).toBe(kind.pal)
    expect(art.act?.frames[0]).toEqual(kind.attack)
    expect(!!art.flying).toBe(kind.flying)
  }
  // Agents come and go; the ones in sight never change creature.
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
  let crew = muster([], agents(ids.map(id => [id, 'running'])), 0)
  const kindOf = (id: string) => {
    const f = crew.find(x => x.id === id)
    return f ? summonFor(f.slot) : undefined
  }
  const before = Object.fromEntries(['a', 'c', 'e'].map(id => [id, kindOf(id)]))
  expect(before).toEqual({ a: 'imp', c: 'hornet', e: 'raven' })
  const working = (list: string[]) => agents(list.map(id => [id, 'running']))
  crew = muster(crew, working(['a', 'c', 'e', 'f', 'g', 'h']), 1000)
  crew = muster(crew, working(['a', 'c', 'e', 'f', 'g', 'h', 'i']), 1000 + LEAVE_MS)
  crew = muster(crew, working(['a', 'c', 'e', 'g', 'h', 'i', 'j']), 5000)
  crew = muster(crew, working(['a', 'c', 'e', 'g', 'h', 'i', 'j']), 5000 + LEAVE_MS)
  for (const id of ['a', 'c', 'e']) expect(kindOf(id)).toBe(before[id])
  // One waiting out of sight steps into a freed slot and keeps the kind it came in as.
  expect(kindOf('g')).toBe('spider')
  crew = muster(crew, working(['a', 'c', 'e', 'g', 'h', 'i', 'j', 'k']), 9000)
  expect(kindOf('g')).toBe('spider')

  // Drawn: the agent in slot 2 is the hornet, in the hornet's own colours.
  const sitting: Motion = { from: 0.5, to: 0.5, t0: NOW - 5000, dur: 8000, activity: 'sit' }
  const svg = laneSvg(PACK, { mood: 'idle', dir: 1, say: null }, sitting, NOW, COAT, 'cavern', { crew: [{ id: 'c', slot: 2, since: 0 }] })
  const hornetOnly = [...own(MINIONS.hornet.pal)].filter(c => !Object.values(MINIONS.imp.pal).includes(c))
  const impOnly = [...own(MINIONS.imp.pal)].filter(c => !Object.values(MINIONS.hornet.pal).includes(c))
  expect(hornetOnly.some(c => svg.includes(hex(c)))).toBe(true)
  expect(impOnly.some(c => svg.includes(hex(c)))).toBe(false)
})

test('flyers hover behind the hero, walkers keep to the ground; in bed they all settle, eyes shut', () => {
  const sitting: Motion = { from: 0.5, to: 0.5, t0: NOW - 5000, dur: 8000, activity: 'sit' }
  const awake = laneCells(PACK, { mood: 'idle', dir: -1, say: null }, sitting, NOW, COAT, COLS, 'forest', { crew: crewOf(2) })
  const lowest = (cells: string, pal: Palette) => Math.max(...columnsOf(cells, pal).map(([, y]) => y))
  // The imp (slot 0) flies, clear of the ground; the slime (slot 1) sits on
  // it, or springs a row off it.
  expect(lowest(awake, MINIONS.imp.pal)).toBeLessThan(LANE_PIX - 2)
  expect(lowest(awake, MINIONS.slime.pal)).toBeGreaterThanOrEqual(LANE_PIX - 2)
  // Behind the hero: it faces left, so they are to its right.
  const hx = heroCol(0.5)
  expect(Math.min(...columnsOf(awake, MINIONS.imp.pal).map(([x]) => x))).toBeGreaterThanOrEqual(hx + HERO_COLS)

  // Asleep in bed: on the ground, and no eye whites.
  const bed: Motion = { from: 0, to: 0, t0: NOW - 5000, dur: 60_000, activity: 'perch' }
  const asleep = laneCells(PACK, { mood: 'sleep', dir: -1, say: null }, bed, NOW, COAT, COLS, 'forest', { crew: crewOf(2) })
  expect(lowest(asleep, MINIONS.imp.pal)).toBe(LANE_PIX - 1)
  const eye = MINIONS.imp.pal.e ?? -1
  expect(pixels(awake).some(([, , c]) => c === eye)).toBe(true)
  expect(pixels(asleep).some(([, , c]) => c === eye)).toBe(false)
  // The desktop: no hovering bob while the hero sleeps.
  const bob = 'values="0 0;0 -3" calcMode="discrete" dur="1200ms"'
  expect(laneSvg(PACK, { mood: 'idle', dir: -1, say: null }, sitting, NOW, COAT, 'forest', { crew: crewOf(2) })).toContain(bob)
  expect(laneSvg(PACK, { mood: 'sleep', dir: -1, say: null }, bed, NOW, COAT, 'forest', { crew: crewOf(2) })).not.toContain(bob)
})

test('in a fight the whole line dashes at the foe in its attack frame, and comes back', () => {
  const fight = FIGHTS.strike
  const m: Motion = { from: 0.3, to: 0.3, t0: NOW, dur: 2400, activity: 'strike' }
  const hero: HeroState = { mood: 'idle', dir: 1, say: null }
  const hx = heroCol(0.3)
  // The foe's front, once the first blow has knocked it back.
  const foe = hx + HERO_COLS + fight.gap + 2
  const crew = crewOf(3)
  const cells = (t: number) => laneCells(PACK, hero, m, t, COAT, COLS, 'forest', { crew })
  for (const [slot, id] of [[0, 'imp'], [2, 'hornet']] as const) {
    const peak = NOW + fight.peak * m.dur + SUMMON_STAGGER * slot
    const at = columnsOf(cells(peak), MINIONS[id].pal).map(([x]) => x)
    expect(Math.max(...at)).toBeGreaterThanOrEqual(foe)
    const back = columnsOf(cells(NOW + 0.95 * m.dur), MINIONS[id].pal).map(([x]) => x)
    expect(Math.max(...back)).toBeLessThan(hx)
  }
  // The desktop: one lunge each, the line's farthest going furthest.
  const moves = (svg: string) => [...svg.matchAll(/type="translate" values="([^"]+)" keyTimes="[^"]+" dur="2400ms"/g)].map(x => x[1] ?? '')
  const reach = (v: string) => Math.max(...v.split(';').map(p => Number(p.split(' ')[0])))
  const alone = new Set(moves(laneSvg(PACK, hero, m, NOW, COAT, 'forest')))
  const lunges = moves(laneSvg(PACK, hero, m, NOW, COAT, 'forest', { crew })).filter(v => !alone.has(v) && reach(v) > 0)
  expect(lunges.length).toBe(3)
  // Drawn farthest first.
  const [far, mid, near] = lunges.map(reach) as [number, number, number]
  expect(far > mid && mid > near && near > 0).toBe(true)
})

test('a damage number rises off the foe on every hit: the hero\'s, and each minion\'s', () => {
  const fight = FIGHTS.strike
  const m: Motion = { from: 0.3, to: 0.3, t0: NOW, dur: 2400, activity: 'strike' }
  const hero: HeroState = { mood: 'idle', dir: 1, say: null }
  const hx = heroCol(0.3)
  const gold = new Set([DAMAGE_PAL.yellow.n, DAMAGE_PAL.red.n])
  const white = DAMAGE_PAL.white.n
  // Terminal: the digits on the top rows, over the foe, while each number lasts.
  const top = (t: number, crew: Follower[], colour: (c: number) => boolean) =>
    pixels(laneCells(PACK, hero, m, t, COAT, COLS, 'forest', { crew })).filter(([x, y, c]) => y < 5 && x >= hx + HERO_COLS - 8 && colour(c)).length
  const [h1] = fight.hits
  expect(top(NOW + (h1 - 0.05) * m.dur, [], c => gold.has(c))).toBe(0)
  expect(top(NOW + (h1 + 0.05) * m.dur, [], c => gold.has(c))).toBeGreaterThan(0)
  for (const slot of [0, 1, 2]) {
    const t = NOW + fight.peak * m.dur + SUMMON_STAGGER * slot + 30
    expect(top(t, crewOf(3), c => c === white)).toBeGreaterThan(top(t, [], c => c === white))
  }
  // Desktop: two gold numbers always, and a white one for each minion.
  const count = (svg: string, c: number | undefined) => (c === undefined ? 0 : svg.split(`fill="${hex(c)}"`).length - 1)
  const plain = laneSvg(PACK, hero, m, NOW, COAT, 'forest')
  const three = laneSvg(PACK, hero, m, NOW, COAT, 'forest', { crew: crewOf(3) })
  expect(count(plain, DAMAGE_PAL.yellow.n) + count(plain, DAMAGE_PAL.red.n)).toBeGreaterThanOrEqual(2)
  expect(count(plain, DAMAGE_PAL.white.N)).toBe(0)
  expect(count(three, DAMAGE_PAL.white.N)).toBeGreaterThanOrEqual(3)
  // A leg rolls the same numbers every time it is drawn.
  expect(laneSvg(PACK, hero, m, NOW, COAT, 'forest', { crew: crewOf(3) })).toBe(three)
  // A bow fight too.
  const shoot: Motion = { ...m, activity: 'shoot', dur: 2600 }
  expect(count(laneSvg(PACK, hero, shoot, NOW, COAT, 'night', { crew: crewOf(2) }), DAMAGE_PAL.white.N)).toBeGreaterThanOrEqual(2)
})

test('a flyer keeps its whole sprite on the terminal through its bob', () => {
  const sitting: Motion = { from: 0.5, to: 0.5, t0: NOW - 5000, dur: 8000, activity: 'sit' }
  // The imp: both its frames reach from the top row to the bottom one.
  for (const [slot, id] of [[0, 'imp']] as const) {
    const rows = new Set<number>()
    for (let t = NOW; t < NOW + 1200; t += 100) {
      const ys = columnsOf(laneCells(PACK, { mood: 'idle', dir: -1, say: null }, sitting, t, COAT, COLS, 'forest', { crew: [{ id: 'a', slot, since: 0 }] }), MINIONS[id].pal).map(([, y]) => y)
      // Every row of the 8 drawn, top and bottom, at every moment.
      expect(Math.max(...ys) - Math.min(...ys)).toBe(7)
      rows.add(Math.min(...ys))
    }
    // It does bob: two heights.
    expect(rows.size).toBe(2)
  }
})
