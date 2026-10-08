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
