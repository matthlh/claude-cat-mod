import { test, expect, mock } from 'claude-code/testing'
import { laneCells } from '../hooks/engine/cells'
import { CREW_MAX, crewCells, extendTrail, HOP_MS, joinOf, LEAVE_MS, lunge, muster, terminalCap, TRAIL_MS, workingCount } from '../hooks/engine/crew'
import type { Trail } from '../hooks/engine/crew'
import { activityOf, coatOf } from '../hooks/engine/lane'
import { legDir } from '../hooks/engine/motion'
import { laneSvg } from '../hooks/engine/svg'
import { PACKS, packProblems } from '../hooks/packs/index'
import type { Dir, Pack, Rows } from '../hooks/packs/types'
import type { Follower, HeroState, Motion } from '../types'
import { decodeCells } from './raster'

// The crew: one follower for each agent of this session that is working.

const SVG_CAP = 131_072
const CAT = PACKS.cat as Pack
const NOW = 100_000
const hero: HeroState = { mood: 'idle', dir: -1, say: null }
const sitting: Motion = { from: 0.4, to: 0.4, t0: NOW - 5000, dur: 8000, activity: 'sit' }
const crewOf = (n: number): Follower[] => Array.from({ length: n }, (_, i) => ({ id: `a${i}`, slot: i, since: 0 }))
const agents = (list: [string, string][]) => list.map(([id, status]) => ({ id, status, description: '', type: 'general-purpose' }))
// Each follower drawn on the desktop has one facing group.
const followersIn = (svg: string) => (svg.match(/<g transform="scale\(/g) ?? []).length

// The terminal's text: printable characters as they are, pixels as '#', blanks as ' '.
function textOf(cells: string, cols: number): string[] {
  const c = decodeCells(cells)
  const rows: string[] = []
  for (let y = 0; y < 5; y++) {
    let line = ''
    for (let x = 0; x < cols; x++) {
      const ch = c[(y * cols + x) * 3] ?? 0x20
      line += ch === 0x20 ? ' ' : ch === 0x2580 || ch === 0x2584 ? '#' : String.fromCodePoint(ch)
    }
    rows.push(line)
  }
  return rows
}
// The columns the hero and its followers cover on the ground row, as runs.
function runs(line: string): [number, number][] {
  const out: [number, number][] = []
  for (let x = 0; x < line.length; x++) {
    if (line[x] !== '#') continue
    const start = x
    while (line[x + 1] === '#') x++
    out.push([start, x])
  }
  return out
}

// ── Counting ────────────────────────────────────────────────────────────

test('only pending, running and waiting agents count as working', () => {
  const crew = muster([], agents([['p', 'pending'], ['r', 'running'], ['w', 'waiting'], ['i', 'idle'], ['c', 'completed'], ['f', 'failed'], ['k', 'killed']]), 1000)
  expect(crew.map(f => f.id)).toEqual(['p', 'r', 'w'])
  expect(crew.map(f => f.slot)).toEqual([0, 1, 2])
  expect(workingCount(crew)).toBe(3)
  // Nothing changed: the very same crew, so the brain writes no state.
  expect(muster(crew, agents([['p', 'pending'], ['r', 'running'], ['w', 'waiting'], ['c', 'completed']]), 2000)).toBe(crew)
})

test('slots are kept per agent: one leaving leaves a gap, a newcomer fills it, nobody reshuffles', () => {
  let crew = muster([], agents([['a', 'running'], ['b', 'running'], ['c', 'running']]), 0)
  // b finishes: it hops and poofs in its own slot, the others stay put.
  crew = muster(crew, agents([['a', 'running'], ['b', 'completed'], ['c', 'running']]), 1000)
  expect(crew).toEqual([{ id: 'a', slot: 0, since: 0 }, { id: 'b', slot: 1, since: 0, leavingAt: 1000 }, { id: 'c', slot: 2, since: 0 }])
  expect(workingCount(crew)).toBe(2)
  // A newcomer while b is still leaving takes the next free slot, not b's.
  crew = muster(crew, agents([['a', 'running'], ['c', 'running'], ['d', 'pending']]), 1500)
  expect(crew.find(f => f.id === 'd')?.slot).toBe(3)
  // Once b is gone, its slot is free: the next newcomer takes it.
  crew = muster(crew, agents([['a', 'running'], ['c', 'running'], ['d', 'running']]), 1000 + LEAVE_MS)
  expect(crew.map(f => [f.id, f.slot])).toEqual([['a', 0], ['c', 2], ['d', 3]])
  crew = muster(crew, agents([['a', 'running'], ['c', 'running'], ['d', 'running'], ['e', 'running']]), 3000)
  expect(crew.map(f => [f.id, f.slot])).toEqual([['a', 0], ['e', 1], ['c', 2], ['d', 3]])
  // An agent dropped from the list altogether leaves too.
  crew = muster(crew, agents([['a', 'running'], ['e', 'running'], ['d', 'running']]), 4000)
  expect(crew.find(f => f.id === 'c')?.leavingAt).toBe(4000)
  // One back at work before it is gone keeps its slot.
  crew = muster(crew, agents([['a', 'running'], ['e', 'running'], ['c', 'waiting'], ['d', 'running']]), 4200)
  expect(crew.find(f => f.id === 'c')).toEqual({ id: 'c', slot: 2, since: 4200 })
})

test('a slot freed within the visible ones goes to the first agent waiting out of sight', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
  let crew = muster([], agents(ids.map(id => [id, 'running'])), 0)
  expect(crew.map(f => f.slot)).toEqual([0, 1, 2, 3, 4, 5, 6])
  crew = muster(crew, agents(ids.filter(id => id !== 'b').map(id => [id, 'running'])), 1000)
  crew = muster(crew, agents(ids.filter(id => id !== 'b').map(id => [id, 'running'])), 1000 + LEAVE_MS)
  // f (slot 5, out of sight) steps into b's slot; nobody in sight moves.
  expect(crew.map(f => [f.id, f.slot])).toEqual([['a', 0], ['f', 1], ['c', 2], ['d', 3], ['e', 4], ['g', 6]])
  expect(crew.find(f => f.id === 'f')?.since).toBe(1000 + LEAVE_MS)
})

// ── The hooks ───────────────────────────────────────────────────────────

test('the brain tick follows $.agent.list(), keeps the crew out of the store, and /cat counts it', async ($: any, on: any) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, percent: 20 }, rateLimits: [] } }))
  on('command.register', async (_$: any, e: any) => ({ value: { command: e.name } }))
  on('session.start', async (_$: any, e: any) => ({ cwd: e.cwd }))
  let list = agents([['a', 'running'], ['b', 'pending'], ['x', 'completed']])
  on('agent.list', async () => ({ value: list }))
  // The store, in memory, noting every key written.
  const mem: Record<string, unknown> = {}
  const stored: string[] = []
  on('store.get', async (_$: any, e: any) => ({ value: mem[e.key] }))
  on('store.set', async (_$: any, e: any) => {
    stored.push(e.key)
    mem[e.key] = e.value
    return { value: undefined }
  })
  const state: Record<string, any> = {}
  on('state.set', async (_$: any, e: any, next: any) => {
    if (e.plugin === 'pixel-cat') state[e.key] = e.value
    return next(e)
  })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  expect(state.crew.map((f: Follower) => [f.id, f.slot])).toEqual([['a', 0], ['b', 1]])

  const cat = () => $.command.run({ command: 'cat', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect((await cat()).text).toContain("Agents working: 2 (counts this session's agents only)")

  list = agents([['b', 'running']])
  await clock.advance(1000)
  expect(state.crew.find((f: Follower) => f.id === 'a')?.leavingAt).toBeGreaterThan(0)
  await clock.advance(2000)
  expect(state.crew).toEqual([{ id: 'b', slot: 1, since: expect.any(Number) }])
  expect((await cat()).text).toContain('Agents working: 1 ')

  // Whatever a session's crew does, the store holds prefs, identity and stats only.
  expect(stored).toContain('identity')
  expect(stored.includes('crew')).toBe(false)
})

// ── Drawing ─────────────────────────────────────────────────────────────

test('no crew draws exactly as before, on both surfaces, in every pack', () => {
  for (const pack of Object.values(PACKS)) {
    const coat = coatOf(pack)
    const scene = pack.defaults.scene
    for (const crew of [undefined, [] as Follower[]]) {
      expect(laneSvg(pack, hero, sitting, NOW, coat, scene, { crew })).toBe(laneSvg(pack, hero, sitting, NOW, coat, scene))
      expect(laneCells(pack, hero, sitting, NOW, coat, 120, scene, { crew })).toBe(laneCells(pack, hero, sitting, NOW, coat, 120, scene))
    }
    // A pack without followers draws none, whoever is working.
    if (!pack.crew) expect(laneSvg(pack, hero, sitting, NOW, coat, scene, { crew: crewOf(9) })).toBe(laneSvg(pack, hero, sitting, NOW, coat, scene))
  }
})

test('0, 1, 3 and 9 followers on both surfaces, every desktop frame under the cap, "+N" for the rest', () => {
  const coat = coatOf(CAT)
  for (const n of [0, 1, 3, 9]) {
    const crew = crewOf(n)
    // The desktop draws up to CREW_MAX, labelling the rest.
    const svg = laneSvg(CAT, hero, sitting, NOW, coat, 'clear', { crew })
    expect(followersIn(svg)).toBe(Math.min(n, CREW_MAX))
    const more = n - Math.min(n, CREW_MAX)
    expect(svg.includes('>+')).toBe(more > 0)
    if (more) expect(svg).toContain(`>+${more}</text>`)

    // The terminal: one for each 30 columns, up to five.
    for (const cols of [20, 80, 160]) {
      const cap = terminalCap(cols)
      const lines = textOf(laneCells(CAT, hero, sitting, NOW, coat, cols, 'clear', { crew }), cols)
      const ground = lines[4] ?? ''
      // The hero, and a run of pixels for each follower drawn.
      expect(runs(ground).length).toBe(1 + Math.min(n, cap))
      const rest = n - Math.min(n, cap)
      const label = lines.join('\n').match(/\+(\d+)/)
      expect(label ? Number(label[1]) : 0).toBe(rest)
    }
  }
  expect(terminalCap(29)).toBe(0)
  expect(terminalCap(80)).toBe(2)
  expect(terminalCap(400)).toBe(CREW_MAX)

  // Every activity of every pack, either way, with 9 working: within the cap.
  for (const pack of Object.values(PACKS)) {
    for (const scene of Object.keys(pack.scenes)) {
      for (const [i, activity] of Object.keys(pack.activities).entries()) {
        const a = pack.activities[activity]
        const still = !!a?.move && 'stay' in a.move
        const m: Motion = { from: 0.4, to: still ? 0.4 : 0.6, t0: NOW - 500, dur: 3000, activity, hit: i % 2 === 0 }
        for (const dir of [1, -1] as const) {
          const trail = [{ leg: { from: 0.7, to: 0.4, t0: NOW - 4000, dur: 3500 }, dir: -dir as 1 | -1 }]
          const crew = crewOf(9).map((f, k) => (k === 2 ? { ...f, leavingAt: NOW - 100 } : k === 3 ? { ...f, since: NOW - 100 } : f))
          const svg = laneSvg(pack, { ...hero, dir, say: 'working on it' }, m, NOW, coatOf(pack), scene, { crew, trail, ctx: 50, hour: 22 })
          expect(svg.length).toBeLessThan(SVG_CAP)
        }
      }
    }
  }
})

test('followers trail the hero along its path, their lag behind it', () => {
  const coat = coatOf(CAT)
  const walking: Motion = { from: 0.1, to: 0.9, t0: NOW - 2000, dur: 8000, activity: 'walk' }
  const right = { ...hero, dir: 1 as const }
  // Desktop: each follower glides the hero's way, from where the hero was its lag ago.
  const svg = laneSvg(CAT, right, walking, NOW, coat, 'clear', { crew: crewOf(2) })
  expect((svg.match(/<animate attributeName="x" values=/g) ?? []).length).toBe(2)
  // Terminal: the nearest follower is a lag behind, the next one more.
  const cols = 160
  const ground = textOf(laneCells(CAT, right, walking, NOW, coat, cols, 'clear', { crew: crewOf(2) }), cols)[4] ?? ''
  const spans = runs(ground)
  expect(spans.length).toBe(3)
  const [far, near, cat] = spans as [[number, number], [number, number], [number, number]]
  expect(far[1] < near[0] && near[1] < cat[0]).toBe(true)
  // Stopped, they stand a fixed step apart instead.
  const stopped = textOf(laneCells(CAT, right, { ...walking, t0: NOW - 20_000 }, NOW, coat, cols, 'clear', { crew: crewOf(2) }), cols)[4] ?? ''
  const [f2, n2, c2] = runs(stopped) as [[number, number], [number, number], [number, number]]
  expect(c2[0] - n2[0]).toBeLessThan(cat[0] - near[0])
  expect(n2[0] - f2[0]).toBe(9)
})

test('a follower leaving hops, poofs and is gone, on both surfaces', () => {
  const coat = coatOf(CAT)
  const at = NOW - 100
  const crew = (leavingAt: number): Follower[] => [{ id: 'a', slot: 0, since: 0 }, { id: 'b', slot: 1, since: 0, leavingAt }, { id: 'c', slot: 2, since: 0 }]
  // Desktop: the hop and the puff are in the drawing made as it leaves.
  const svg = laneSvg(CAT, hero, sitting, NOW, coat, 'clear', { crew: crew(at) })
  expect(svg).toContain('values="0 0;0 -6;0 0;0 -3;0 0" keyTimes="0;0.25;0.5;0.75;1"')
  expect(svg).toContain('<set attributeName="opacity" to="1"')
  expect(followersIn(svg)).toBe(3)
  // Gone: drawn just as if it never was, its slot left empty.
  const later = laneSvg(CAT, hero, sitting, NOW, coat, 'clear', { crew: crew(NOW - LEAVE_MS - 1) })
  expect(followersIn(later)).toBe(2)
  const without = [{ id: 'a', slot: 0, since: 0 }, { id: 'c', slot: 2, since: 0 }]
  expect(later).toBe(laneSvg(CAT, hero, sitting, NOW, coat, 'clear', { crew: without }))
  // Terminal: hopping, then a puff, then nothing.
  const cols = 160
  const draw = (c: Follower[]) => laneCells(CAT, hero, sitting, NOW, coat, cols, 'clear', { crew: c })
  const gone = draw(without)
  expect(draw(crew(NOW - 100))).not.toBe(gone)
  expect(draw(crew(NOW - HOP_MS - 100))).not.toBe(gone)
  expect(draw(crew(NOW - LEAVE_MS))).toBe(gone)
})

test('an activity makes the followers join in: a lunge timed to a moment of the leg', () => {
  const coat = coatOf(CAT)
  const join = lunge(0.5, 3, { span: 0.2 })
  expect(join.during).toEqual([0.4, 0.6])
  const leg: Motion = { from: 0.5, to: 0.5, t0: NOW, dur: 3000, activity: 'strike' }
  const pack: Pack = { ...CAT, activities: { ...CAT.activities, strike: { move: { stay: 3000 }, crew: { ...join, only: l => !!l.hit } } } }
  // Desktop: the lunge is SMIL over the leg, peaking at the strike.
  const svg = laneSvg(pack, hero, { ...leg, hit: true }, NOW, coat, 'clear', { crew: crewOf(1) })
  expect(svg).toContain('values="0 0;0 0;-9 0;0 0;0 0" keyTimes="0;0.4;0.5;0.6;1"')
  expect(laneSvg(pack, hero, { ...leg, hit: false }, NOW, coat, 'clear', { crew: crewOf(1) })).not.toContain('keyTimes="0;0.4;0.5;0.6;1"')
  // Terminal: forward at the strike (facing left: fewer columns), back after.
  const cols = 160
  const nearest = (t: number, hit = true) => {
    const ground = textOf(laneCells(pack, hero, { ...leg, hit }, t, coat, cols, 'clear', { crew: crewOf(1) }), cols)[4] ?? ''
    return (runs(ground)[1] ?? [0, 0])[0]
  }
  // Facing left, forward is fewer columns: at rest in its act pose as the
  // window opens, 3 px forward at the strike, back to sitting after.
  const sitting = nearest(NOW + 1000)
  const crouched = nearest(NOW + 1200)
  expect(nearest(NOW + 1500)).toBe(crouched - 3)
  expect(nearest(NOW + 2000)).toBe(sitting)
  expect(nearest(NOW + 1500, false)).toBe(sitting)
  // The cat's own pounce brings the kittens along.
  expect(CAT.activities.caught?.crew).toBeDefined()
})

test('flying followers hover above the ground; bad crews are refused', () => {
  const coat = coatOf(CAT)
  const crew = CAT.crew
  if (!crew) throw new Error('the cat has kittens')
  const flyers: Pack = { ...CAT, crew: { ...crew, flying: { height: 3 } } }
  const cols = 120
  const ground = (p: Pack) => textOf(laneCells(p, hero, sitting, NOW, coat, cols, 'clear', { crew: crewOf(1) }), cols)[4] ?? ''
  // On the ground row the walker's feet show; the flyer is off it, only the hero is.
  expect(runs(ground(CAT)).length).toBe(2)
  expect(runs(ground(flyers)).length).toBe(1)
  expect(packProblems(flyers)).toEqual([])
  // Hovering, with a bob a step up every other 600 ms, out of step with the
  // next one, and in step with the terminal (NOW is 400 ms into a step).
  const svg = laneSvg(flyers, hero, sitting, NOW, coat, 'clear', { crew: crewOf(2) })
  expect(svg).toContain('values="0 0;0 -3" calcMode="discrete" dur="1200ms" begin="-400ms"')
  expect(svg).toContain('values="0 0;0 -3" calcMode="discrete" dur="1200ms" begin="-1000ms"')
  // Too tall to fly that high, too wide, a join outside the leg.
  expect(packProblems({ ...CAT, crew: { ...crew, flying: { height: 6 } } }).length).toBe(1)
  expect(packProblems({ ...CAT, crew: { ...crew, move: [['.'.repeat(13)], ['o']] } }).length).toBe(1)
  expect(packProblems({ ...CAT, activities: { ...CAT.activities, sit: { crew: { during: [0.5, 1.2] } } } }).length).toBe(1)
})

// ── The trail, the room, the bed ────────────────────────────────────────

test('the trail keeps the last few legs: a new one on the end, the same one kept current, old ones dropped', () => {
  const leg = (t0: number, from: number, to: number): Motion => ({ from, to, t0, dur: 1000, activity: 'walk' })
  let trail: Trail[] = []
  trail = extendTrail(trail, leg(0, 0.2, 0.3), 1, 0)
  const same = extendTrail(trail, leg(0, 0.2, 0.3), 1, 500)
  expect(same).toBe(trail)
  trail = extendTrail(trail, leg(1000, 0.3, 0.2), -1, 1000)
  trail = extendTrail(trail, { ...leg(2000, 0.2, 0.2), activity: 'sit' }, -1, 2000)
  // The hero turned on the spot: the same leg, facing the new way.
  trail = extendTrail(trail, { ...leg(2000, 0.2, 0.2), activity: 'sit' }, 1, 2100)
  expect(trail.map(t => [t.leg.t0, t.dir])).toEqual([[0, 1], [1000, -1], [2000, 1]])
  // A leg that ended over TRAIL_MS ago is gone; the one before the new one stays.
  trail = extendTrail(trail, leg(20_000, 0.2, 0.5), 1, 20_000)
  expect(trail.map(t => t.leg.t0)).toEqual([2000, 20_000])
  trail = extendTrail(trail, leg(31_000, 0.5, 0.6), 1, 31_000)
  expect(trail.map(t => t.leg.t0)).toEqual([20_000, 31_000])
  expect(TRAIL_MS).toBeGreaterThan(5 * 260 + 2600)
})

test('no follower jumps when the hero turns again before they have walked round', () => {
  const cols = 200
  const span = cols - 13
  // Right 1.5 s, left 0.9 s, right 1 s, then a sit: each leg shorter than the farthest walk-round.
  const legs: Trail[] = []
  let t = 0
  let at = 0.5
  for (const [d, ms] of [[1, 1500], [-1, 900], [1, 1000], [0, 6000]] as const) {
    const to = at + d * 0.06 * (ms / 1000)
    legs.push({ leg: { from: at, to, t0: t, dur: ms, activity: d ? 'walk' : 'sit' }, dir: d || 1 })
    at = to
    t += ms
  }
  const crew = crewOf(5)
  let trail: Trail[] = []
  const was = new Map<number, number>()
  let worst = 0
  for (let now = 0; now < t; now += 50) {
    const cur = [...legs].reverse().find(l => l.leg.t0 <= now) ?? legs[0]
    if (!cur) break
    trail = extendTrail(trail, cur.leg, legDir(cur.leg, cur.dir), now)
    const x0 = Math.round((cur.leg.from + (cur.leg.to - cur.leg.from) * Math.min(1, (now - cur.leg.t0) / cur.leg.dur)) * span)
    const plot = (_r: Rows, x: number, _y: number, pal: Record<string, number>) => {
      const key = pal.o
      if (key === undefined) return
      const before = was.get(key)
      if (before !== undefined) worst = Math.max(worst, Math.abs(x - before))
      was.set(key, x)
    }
    const sc = { art: CAT.crew, crew, m: cur.leg, trail, dir: cur.dir as Dir, joinOf: (leg: Motion) => joinOf(CAT, activityOf(CAT, leg.activity), leg), now, room: { span, width: cols } }
    crewCells(sc, cols, x0, plot)
  }
  // A step of the walk and of the walk-round, at most, in one 50 ms frame.
  expect(worst).toBeLessThanOrEqual(3)
})

test('with no room behind the hero, the followers that do not fit stand in front of it, facing it', () => {
  const coat = coatOf(CAT)
  const right: HeroState = { mood: 'sit', dir: 1, say: null }
  const edge: Motion = { from: 0.02, to: 0.02, t0: NOW - 1000, dur: 8000, activity: 'sit' }
  // Terminal: every follower drawn is in the lane, and only those beyond the cap are counted.
  const cols = 160
  const lines = textOf(laneCells(CAT, right, edge, NOW, coat, cols, 'clear', { crew: crewOf(7) }), cols)
  const spans = runs(lines[4] ?? '')
  expect(spans.length).toBe(1 + CREW_MAX)
  const [heroSpan] = spans
  expect(spans.slice(1).every(([a]) => a > (heroSpan?.[1] ?? cols))).toBe(true)
  expect(lines.join('\n').match(/\+(\d+)/)?.[1]).toBe('2')
  // Desktop, with the lane's width: all in front, none off the left edge.
  const svg = laneSvg(CAT, right, edge, NOW, coat, 'clear', { crew: crewOf(5), laneW: 823 })
  const offs = [...svg.matchAll(/overflow="visible"><g transform="translate\((-?[\d.]+) 0\)">/g)].map(x => Number(x[1]))
  expect(offs.length).toBe(5)
  expect(offs.every(x => x > 0)).toBe(true)
  // Mid-lane, they stay behind.
  const mid = laneSvg(CAT, right, { ...edge, from: 0.5, to: 0.5 }, NOW, coat, 'clear', { crew: crewOf(5), laneW: 823 })
  expect([...mid.matchAll(/overflow="visible"><g transform="translate\((-?[\d.]+) 0\)">/g)].every(x => Number(x[1]) < 0)).toBe(true)
})

test('asleep in bed, the followers stand past its foot and the z\'s', () => {
  const coat = coatOf(CAT)
  const bed: Motion = { from: 0, to: 0, t0: NOW - 5000, dur: 60_000, activity: 'perch' }
  const cols = 160
  for (const scene of Object.keys(CAT.scenes)) {
    const pw = CAT.scenes[scene]?.bed.rows[0]?.length ?? 0
    const lines = textOf(laneCells(CAT, { mood: 'sleep', dir: -1, say: null }, bed, NOW, coat, cols, scene, { crew: crewOf(2) }), cols)
    const spans = runs(lines[4] ?? '')
    const z = Math.max(...lines.map(l => Math.max(l.lastIndexOf('z'), l.lastIndexOf('Z'))))
    // The bed (with the hero in it), then the two kittens clear of it and of the z's.
    const kittens = spans.filter(([a]) => a > pw)
    expect(kittens.length).toBe(2)
    expect(kittens[0]?.[0]).toBeGreaterThan(Math.max(pw, z))
  }
})

test('the followers are drawn beneath what is ahead of the hero, on both surfaces', () => {
  const coat = coatOf(CAT)
  const INK = 0x123456
  const cols = 120
  const sit = CAT.activities.sit ?? {}
  const covered: Pack = {
    ...CAT,
    activities: {
      ...CAT.activities,
      sit: { ...sit, draw: { svg: () => '<rect id="ahead"/>', cells: ctx => ctx.plot(Array.from({ length: 10 }, () => 'k'.repeat(cols)), 0, 0, { k: INK }) } },
    },
  }
  const m: Motion = { from: 0.4, to: 0.4, t0: NOW - 1000, dur: 8000, activity: 'sit' }
  const cells = decodeCells(laneCells(covered, hero, m, NOW, coat, cols, 'clear', { crew: crewOf(2) }))
  const kitten = new Set(Object.values(CAT.crew?.coats[0] ?? {}).filter(c => !Object.values(coat).includes(c)))
  const colours = new Set<number>()
  for (let i = 0; i < cells.length; i += 3) colours.add(cells[i + 1] ?? 0).add(cells[i + 2] ?? 0)
  expect(kitten.size).toBeGreaterThan(0)
  expect([...kitten].some(c => colours.has(c))).toBe(false)
  const svg = laneSvg(covered, hero, m, NOW, coat, 'clear', { crew: crewOf(2) })
  expect(svg.indexOf('<g transform="scale(')).toBeLessThan(svg.indexOf('id="ahead"'))
})

test('Ctx.joining names only the followers a join brings in', () => {
  const coat = coatOf(CAT)
  const seen: (readonly number[] | undefined)[] = []
  const probe = { svg: (c: { joining?: readonly number[] }) => (seen.push(c.joining), ''), cells: (c: { joining?: readonly number[] }) => void seen.push(c.joining) }
  const m: Motion = { from: 0.4, to: 0.4, t0: NOW - 100, dur: 3000, activity: 'probe' }
  const withJoin = (crew: Pack['activities'][string]['crew']): Pack => ({ ...CAT, activities: { ...CAT.activities, probe: { move: { stay: 3000 }, draw: probe, ...(crew ? { crew } : {}) } } })
  const both = (pack: Pack) => {
    seen.length = 0
    laneSvg(pack, hero, m, NOW, coat, 'clear', { crew: crewOf(3) })
    laneCells(pack, hero, m, NOW, coat, 120, 'clear', { crew: crewOf(3) })
    return seen.map(s => [...(s ?? [])])
  }
  expect(both(withJoin(lunge(0.5, 3)))).toEqual([[0, 1, 2], [0, 1, 2]].map((s, i) => (i ? s.slice(0, terminalCap(120)) : s)))
  expect(both(withJoin(undefined))).toEqual([[], []])
  expect(both(withJoin({ ...lunge(0.5, 3), only: () => false }))).toEqual([[], []])
  const { crew: _none, ...noCrew } = withJoin(lunge(0.5, 3))
  expect(both(noCrew)).toEqual([[], []])
})

test('on a narrow terminal, a place in sight goes to an agent waiting out of it', () => {
  const ids = ['a', 'b', 'c', 'd']
  const cap = terminalCap(80)
  let crew = muster([], agents(ids.map(id => [id, 'running'])), 0, cap)
  crew = muster(crew, agents(ids.filter(id => id !== 'a').map(id => [id, 'running'])), 1000, cap)
  crew = muster(crew, agents(ids.filter(id => id !== 'a').map(id => [id, 'running'])), 1000 + LEAVE_MS, cap)
  expect(crew.map(f => [f.id, f.slot])).toEqual([['c', 0], ['b', 1], ['d', 3]])
  // The desktop's places are all in sight already: nobody moves.
  let wide = muster([], agents(ids.map(id => [id, 'running'])), 0)
  wide = muster(wide, agents(ids.filter(id => id !== 'a').map(id => [id, 'running'])), 1000 + LEAVE_MS)
  wide = muster(wide, agents(ids.filter(id => id !== 'a').map(id => [id, 'running'])), 2000 + LEAVE_MS)
  expect(wide.map(f => [f.id, f.slot])).toEqual([['b', 1], ['c', 2], ['d', 3]])
})
