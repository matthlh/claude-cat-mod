import { test, expect, mock } from 'claude-code/testing'

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }

// The ↻ button and /mods walk one loop: each pack, then Token Tycoon (there
// when something registered /tycoon), then off, then round again. Token
// Tycoon is driven through its command, and the stop is saved with the prefs.
test('the switcher cycles packs, Token Tycoon and off, and remembers its stop', async ($: any, on: any) => {
  mock.store(on)
  mock.clock(on, { now: 1_000_000 })
  const ran: { command: string; args: string }[] = []
  on('command.list', async () => ({ value: [{ name: 'tycoon', description: '', source: 'plugin' }] }))
  // Matched to /tycoon alone: a catch-all would sit on the stack during the
  // test's own /mods run, and the engine skips the hooks a run came through.
  on('command.run', { command: 'tycoon' }, async (_$: any, e: any) => {
    ran.push({ command: e.command, args: e.args })
    return { text: '' }
  })
  on('command.register', async (_$: any, e: any) => ({ value: { command: e.name } }))
  on('session.start', async (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, percent: 20 }, rateLimits: [] } }))
  // On Token Tycoon's stop the band hands the drawing on; nothing is beneath it here.
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }))
  const state: Record<string, any> = {}
  on('state.set', async (_$: any, e: any, next: any) => {
    if (e.plugin === 'pixel-cat') state[e.key] = e.value
    return next(e)
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const mount = () => $.ui.mount({ plugin: 'pixel-cat', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false } as any, viewport: { columns: 120, rows: 40 } })
  const label = async (ui: any) => (await ui.find({ key: 'cycle' }))?.props?.label

  let ui = await mount()
  expect(await label(ui)).toBe('↻ Adventurer')
  await ui.press({ key: 'cycle' })
  expect(state.prefs).toMatchObject({ mode: 'hero', pack: 'adventurer' })
  const OFF = { command: 'tycoon', args: 'off' }
  const ON = { command: 'tycoon', args: 'on' }
  expect(ran).toEqual([OFF])
  expect(await label(ui)).toBe('↻ Token Tycoon')
  await ui.press({ key: 'cycle' })
  expect(state.prefs.mode).toBe('tycoon')
  expect(ran).toEqual([OFF, ON])
  // Token Tycoon's turn: this band draws nothing at all.
  expect(await ui.find({ key: 'pet' })).toBeUndefined()
  expect(await ui.find({ key: 'cycle' })).toBeUndefined()
  await ui.unmount()

  // /mods alone moves on: off, where only the strip is drawn.
  const mods = (args: string) => $.command.run({ command: 'mods', args, ...RUN })
  expect((await mods('')).text).toContain('Showing: Off')
  // (The /tycoon off it runs isn't seen here: no hook runs beneath its own
  // plugin's call of the same event, and the test raised this /mods itself.
  // The button path above covers the hand-off.)
  ui = await mount()
  expect(await ui.find({ key: 'pet' })).toBeUndefined()
  expect(await label(ui)).toBe('↻ Cat')
  await ui.press({ key: 'cycle' })
  expect(state.prefs).toMatchObject({ mode: 'hero', pack: 'cat' })
  expect(await ui.find({ key: 'pet' })).toBeDefined()
  expect(await label(ui)).toBe('↻ Adventurer')
  await ui.unmount()

  // By name, however spelled, and an unknown name answers with the list.
  expect((await mods('TYCOON')).text).toContain('Showing: Token Tycoon')
  expect((await mods('adventurer')).text).toContain('Showing: Adventurer')
  expect((await mods('tetris')).text).toContain('No mod called "tetris"')
  expect(state.prefs).toMatchObject({ mode: 'hero', pack: 'adventurer' })

  // The adventurer's own look was kept through the trip, as a pack switch keeps it.
  expect(state.prefs.looks).toBeDefined()
})

test('without Token Tycoon the loop skips it, and its saved stop reads as off', async ($: any, on: any) => {
  mock.store(on, { prefs: { pack: 'cat', coat: 'orange', speed: 'normal', scene: 'clear', popups: true, showUsage: true, hat: 'none', mode: 'tycoon' } })
  mock.clock(on, { now: 2_000_000 })
  const ran: string[] = []
  on('command.list', async () => ({ value: [] }))
  on('command.run', { command: 'tycoon' }, async (_$: any, e: any) => {
    ran.push(e.command)
    return { text: '' }
  })
  on('command.register', async (_$: any, e: any) => ({ value: { command: e.name } }))
  on('session.start', async (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, percent: 20 }, rateLimits: [] } }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'pixel-cat', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } as any, viewport: { columns: 100, rows: 30 } })
  // Saved on Token Tycoon's stop, now gone: the strip, not nothing.
  expect(await ui.find({ key: 'pet' })).toBeUndefined()
  expect((await ui.find({ key: 'cycle' }))?.props?.label).toBe('↻ Cat')
  await ui.press({ key: 'cycle' })
  expect((await ui.find({ key: 'cycle' }))?.props?.label).toBe('↻ Adventurer')
  await ui.press({ key: 'cycle' })
  expect((await ui.find({ key: 'cycle' }))?.props?.label).toBe('↻ Off')
  await ui.unmount()
  expect(ran).toEqual([])
  const r = await $.command.run({ command: 'mods', args: 'tycoon', ...RUN })
  expect(r.text).toContain('No mod called "tycoon"')
})
