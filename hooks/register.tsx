import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Cat, Limits, Mood } from '../types'

const cat = atom({ plugin: 'claude-cat', key: 'cat' } as const, {
  mood: 'idle',
  x: 0,
  dir: 1,
  frame: 0,
  say: 'hi!',
} as Cat)
const limits = atom({ plugin: 'claude-cat', key: 'limits' } as const, {
  fiveHour: null,
  sevenDay: null,
  context: null,
  fiveHourResets: null,
} as Limits)
const isHidden = atom({ plugin: 'claude-cat', key: 'isHidden' } as const, false)

const TICK_MS = 250
const NAP_AFTER_MS = 5 * 60_000
const ANNOUNCE_AFTER_S = 20

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

const PALETTE: Record<string, number> = {
  o: 0xd97757, // Claude orange
  d: 0x9e4f36,
  H: 0xffffff,
  K: 0x1f1e1d,
  r: 0xf4a4a0,
  n: 0xe8737a,
  w: 0xfbefe4,
}

function pixels(c: Cat): string[] {
  const isMoving = c.mood === 'idle' || c.mood === 'working' || c.mood === 'tired'
  const base = c.mood === 'sleep' ? LOAF : isMoving ? (c.frame % 2 === 0 ? WALK_A : WALK_B) : SIT
  const isClosed = c.mood === 'done' || c.mood === 'pet' || c.mood === 'tired' || c.frame % 16 === 7
  // Closed eyes: the top eye row becomes fur, the bottom a dark lash line.
  const rows = isClosed
    ? base.map(r => (r.includes('H') ? r.replace(/[HK]/g, 'o') : r.replace(/K/g, 'd')))
    : base
  return c.dir === 1 ? rows.map(r => [...r].reverse().join('')) : rows
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')

// Desktop: crisp SVG pixels, one rect per horizontal run of a color.
function svgCat(rows: string[], px: number): string {
  const rects: string[] = []
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]
      let run = 1
      while (row[x + run] === ch) run++
      if (PALETTE[ch] !== undefined) {
        rects.push(`<rect x="${x * px}" y="${y * px}" width="${run * px}" height="${px}" fill="${hex(PALETTE[ch])}"/>`)
      }
      x += run
    }
  })
  const w = rows[0].length * px
  const h = rows.length * px
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${rects.join('')}</svg>`
}

// Terminal: two pixels per cell with half blocks, packed as Raster cells.
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
function rasterCells(rows: string[]): string {
  const words: number[] = []
  for (let y = 0; y < rows.length; y += 2) {
    for (let x = 0; x < rows[y].length; x++) {
      const top = PALETTE[rows[y][x]]
      const bottom = PALETTE[rows[y + 1]?.[x] ?? '.']
      if (top === undefined && bottom === undefined) words.push(0x20, DEFAULT, DEFAULT)
      else if (top === undefined) words.push(0x2584, bottom, DEFAULT)
      else words.push(0x2580, top, bottom ?? DEFAULT)
    }
  }
  const u32 = Uint32Array.from(words)
  return base64(new Uint8Array(u32.buffer))
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

export const register: Register = on => {
  let room = 40 // columns the cat may walk in; refreshed by each render
  let lastActivity = 0
  let turnStartedAt = 0
  let sayUntil = 0
  let moodUntil = 0
  const warned = new Set<string>()
  let stopTicker: (() => void) | null = null
  // Assigned in session.start, where the timers live.
  let wake: (mood: Mood, say: string | null, holdMs: number) => Promise<void> = async () => {}

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cat',
      description: 'Show or hide the Claude cat (and see your usage limits)',
    })
    lastActivity = await $.clock.now()
    sayUntil = lastActivity + 5000

    const startTicker = () => {
      if (stopTicker) return
      const timer = $.clock.every(TICK_MS, () => void tick())
      stopTicker = () => timer.cancel()
    }

    const tick = async () => {
      const now = await $.clock.now()
      const lim = await read($, limits)
      const isLow = (lim.fiveHour ?? 0) >= 80

      await update($, cat, c => {
        let { mood, x, dir, frame, say } = c
        frame += 1
        if (say && now > sayUntil) say = null
        if (now > moodUntil && (mood === 'done' || mood === 'oops' || mood === 'pet')) {
          mood = 'sit'
        }
        if (mood !== 'working' && now - lastActivity > NAP_AFTER_MS) {
          mood = 'sleep'
          say = null
        }

        // Wandering: idle cats stroll and sit down at random; working cats run.
        if (mood === 'idle' || mood === 'sit' || mood === 'tired') {
          const base: Mood = isLow ? 'tired' : 'idle'
          if (mood === 'sit' && Math.random() < 0.04) mood = base
          else if (mood !== 'sit' && Math.random() < 0.02) mood = 'sit'
          else if (mood !== 'sit') mood = base
        }
        const speed = mood === 'working' ? 1 : mood === 'idle' ? (frame % 2) : mood === 'tired' ? (frame % 4 === 0 ? 1 : 0) : 0
        x += speed * dir
        if (x >= room) { x = room; dir = -1 }
        if (x <= 0) { x = 0; dir = 1 }
        if (speed > 0 && Math.random() < 0.01) dir = dir === 1 ? -1 : 1

        return { mood, x, dir, frame, say }
      })

      if ((await read($, cat)).mood === 'sleep' && stopTicker) {
        stopTicker()
        stopTicker = null
      }
    }

    wake = async (mood: Mood, say: string | null, holdMs: number) => {
      const now = await $.clock.now()
      lastActivity = now
      if (say) sayUntil = now + Math.max(holdMs, 3000)
      moodUntil = now + holdMs
      await update($, cat, c => ({ ...c, mood, say: say ?? c.say }))
      startTicker()
    }

    startTicker()
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
      if (secs >= ANNOUNCE_AFTER_S) $.ui.toast(`🐱 Claude finished (${secs}s)`)
    } else if (e.reason === 'aborted') {
      await wake('sit', 'ok, stopped', 4000)
    } else {
      await wake('oops', 'hit an error :(', 6000)
      $.ui.toast('🐱 Claude stopped on an error')
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
          $.ui.toast(`🐱 ${label} usage at ${pct}%`)
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)

    const { Box, Text, Button, Raster, Svg } = $.ui.resolve(e) as any
    const c = await read($, cat)
    const l = await read($, limits)
    const columns = e.viewport?.columns ?? 80
    room = Math.max(0, columns - 34 - 12 - 18)
    const x = Math.min(c.x, room)
    const rows = pixels(c)
    const fmt = (label: string, p: number | null) =>
      p === null ? null : (
        <Text dimColor={p < 70} color={pctColor(p)}>
          {label} {p}%{'  '}
        </Text>
      )

    return (
      <Box flexDirection="row">
        <Box flexDirection="row" flexGrow={1} marginLeft={x} alignItems="center">
          {e.surface === 'terminal' ? (
            <Raster key="cat" columns={12} rows={5} cells={rasterCells(rows)} />
          ) : (
            <Svg source={svgCat(rows, 4)} alt={`Claude cat (${c.mood})`} width={48} height={40} />
          )}
          {c.say ? <Text color="cyan"> ‹{c.say}›</Text> : null}
          {c.mood === 'sleep' ? <Text dimColor> z z</Text> : null}
        </Box>
        <Box flexDirection="column" alignItems="flex-end">
          <Text>
            {fmt('5h', l.fiveHour)}
            {fmt('7d', l.sevenDay)}
            {fmt('ctx', l.context)}
          </Text>
          <Box flexDirection="row" gap={1}>
            <Button key="pet" label="Pet" onPress={() => wake('pet', 'purrr ♥', 3000)} />
            <Button key="hide" label="Hide" onPress={() => update($, isHidden, () => true)} />
          </Box>
        </Box>
      </Box>
    )
  })
}
