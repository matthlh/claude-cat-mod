import { test, expect, mock } from 'claude-code/testing'

// What an install saved before packs existed: prefs with no `pack`, plus the
// identity and stats it rolled and counted. Loading it must keep every choice,
// read as the cat pack, and draw and answer as it always did.
const OLD_PREFS = { coat: 'tuxedo', speed: 'zoomies', scene: 'night', popups: true, showUsage: true, hat: 'party' }
const OLD_IDENTITY = { marking: 'socks', shiny: true }
const OLD_STATS = { turns: 9, tools: 99 }

test('data saved before packs loads through session.start unchanged, as the cat', async ($: any, on: any) => {
  mock.store(on, { prefs: OLD_PREFS, identity: OLD_IDENTITY, stats: OLD_STATS })
  mock.clock(on, { now: 1_000_000 })
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, percent: 20 }, rateLimits: [{ kind: 'five_hour', percentUsed: 40 }] } }))
  on('command.register', async (_$: any, e: any) => ({ value: { command: e.name } }))
  on('session.start', async (_$: any, e: any) => ({ cwd: e.cwd }))
  const state: Record<string, any> = {}
  on('state.set', async (_$: any, e: any, next: any) => {
    if (e.plugin === 'pixel-cat') state[e.key] = e.value
    return next(e)
  })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect(state.prefs).toEqual({ pack: 'cat', ...OLD_PREFS })
  expect(state.identity).toEqual(OLD_IDENTITY)
  expect(state.stats).toEqual(OLD_STATS)

  // /cat hides it and says what it has; again brings it back.
  const cat = () => $.command.run({ command: 'cat', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const hidden = await cat()
  expect(hidden.text).toContain('Your cat: socks marking, ✨ shiny')
  expect(hidden.text).toContain('Tasks finished: 9, tool calls: 99')
  expect(state.isHidden).toBe(true)
  await cat()
  expect(state.isHidden).toBe(false)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'pixel-cat', surface, component: 'AbovePrompt', props: { hasSurvey: false } as any, viewport: { columns: 140, rows: 40 } })
    await ui.press({ key: 'settings' })
    expect((await ui.find({ key: 'set-coat' }))?.props?.label).toBe('Coat: Tuxedo')
    expect((await ui.find({ key: 'set-speed' }))?.props?.label).toBe('Speed: Zoomies')
    expect((await ui.find({ key: 'set-scene' }))?.props?.label).toBe('Scene: Night')
    await ui.press({ key: 'settings' })
    await ui.unmount()
  }
  // Still nothing but the missing pack filled in.
  expect(state.prefs).toEqual({ pack: 'cat', ...OLD_PREFS })
})

// Each pack keeps its own look: a cat on tuxedo + cozy + party hat that tries
// the adventurer and comes back is still on tuxedo + cozy + party hat, and the
// adventurer's outfit is where it was left, on both surfaces.
test('switching packs and back keeps each pack its own coat, scene and hat', async ($: any, on: any) => {
  const LOOK = { coat: 'tuxedo', scene: 'cozy', hat: 'party' }
  mock.store(on, { prefs: { pack: 'cat', speed: 'normal', popups: true, showUsage: true, ...LOOK }, stats: { turns: 12, tools: 3 } })
  mock.clock(on, { now: 1_000_000 })
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, percent: 20 }, rateLimits: [] } }))
  on('command.register', async (_$: any, e: any) => ({ value: { command: e.name } }))
  on('session.start', async (_$: any, e: any) => ({ cwd: e.cwd }))
  const state: Record<string, any> = {}
  on('state.set', async (_$: any, e: any, next: any) => {
    if (e.plugin === 'pixel-cat') state[e.key] = e.value
    return next(e)
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'pixel-cat', surface, component: 'AbovePrompt', props: { hasSurvey: false } as any, viewport: { columns: 140, rows: 40 } })
    const label = async (key: string) => (await ui.find({ key }))?.props?.label
    await ui.press({ key: 'settings' })
    expect(await label('set-hat')).toBe('Hat: Party hat')

    await ui.press({ key: 'set-pack' })
    expect(state.prefs.pack).toBe('adventurer')
    expect(await label('set-coat')).toMatch(/^Outfit: /)
    // Pick an outfit to come back to.
    await ui.press({ key: 'set-coat' })
    const outfit = state.prefs.coat
    expect(outfit).not.toBe('tuxedo')

    await ui.press({ key: 'set-pack' })
    expect(state.prefs).toMatchObject({ pack: 'cat', ...LOOK })
    expect(await label('set-coat')).toBe('Coat: Tuxedo')
    expect(await label('set-scene')).toBe('Scene: Cozy')

    await ui.press({ key: 'set-pack' })
    expect(state.prefs.pack).toBe('adventurer')
    expect(state.prefs.coat).toBe(outfit)
    await ui.press({ key: 'set-pack' })
    expect(state.prefs).toMatchObject({ pack: 'cat', ...LOOK })
    await ui.press({ key: 'settings' })
    await ui.unmount()
  }
})

// The brain is woken the moment a leg ends, so one leg follows the next with
// no gap: the terminal, which draws a leg's layers only while it runs, never
// shows a bare hero between a chop and its timber, or a build and its admiring.
test('each leg starts the moment the one before it ends', async ($: any, on: any) => {
  mock.store(on, { prefs: { pack: 'adventurer', coat: 'starter', speed: 'normal', scene: 'forest', popups: false, showUsage: true, hat: 'none' } })
  const clock = mock.clock(on, { now: 5_000_000 })
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, percent: 20 }, rateLimits: [] } }))
  on('command.register', async (_$: any, e: any) => ({ value: { command: e.name } }))
  on('session.start', async (_$: any, e: any) => ({ cwd: e.cwd }))
  const legs: any[] = []
  on('state.set', async (_$: any, e: any, next: any) => {
    if (e.plugin === 'pixel-cat' && e.key === 'motion') legs.push(e.value)
    return next(e)
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await clock.advance(120_000)
  expect(legs.length).toBeGreaterThan(10)
  // The first leg follows the empty one the session starts with, from now.
  for (let i = 2; i < legs.length; i++) {
    const [prev, leg] = [legs[i - 1], legs[i]]
    if (leg.t0 !== prev.t0 + prev.dur) throw new Error(`leg ${i} (${leg.activity}) starts ${leg.t0 - (prev.t0 + prev.dur)} ms after ${prev.activity} ends`)
  }
})
