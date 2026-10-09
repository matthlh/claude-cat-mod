import { test, expect, mock } from 'claude-code/testing'

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }
const mountBand = ($: any) => $.ui.mount({ plugin: 'token-tycoon', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false } as any, viewport: { columns: 120, rows: 40 } })

test('/tycoon puts the band away and brings it back, and a new session remembers', async ($: any, on: any) => {
  mock.store(on)
  mock.clock(on, { now: 1_000_000 })
  on('command.register', async (_$: any, e: any) => ({ value: { command: e.name } }))
  on('session.start', async (_$: any, e: any) => ({ cwd: e.cwd }))
  // Put away, the band hands the drawing on; nothing is beneath it here.
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }))
  const state: Record<string, any> = {}
  on('state.set', async (_$: any, e: any, next: any) => {
    if (e.plugin === 'token-tycoon') state[e.key] = e.value
    return next(e)
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const tycoon = (args = '') => $.command.run({ command: 'tycoon', args, ...RUN })

  expect((await tycoon('off')).text).toContain('put away')
  expect(state.isHidden).toBe(true)
  expect(state.prefs.shown).toBe(false)
  const ui = await mountBand($)
  expect(await ui.find({ key: 'prompt' })).toBeUndefined()
  await ui.unmount()

  expect((await tycoon()).text).toContain('back')
  expect(state.isHidden).toBe(false)
  expect(state.prefs.shown).toBe(true)

  await tycoon('off')
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect(state.isHidden).toBe(true)
})

test('↻ hands over to the switcher when pixel-cat has one, else puts the band away itself', async ($: any, on: any) => {
  mock.store(on)
  mock.clock(on, { now: 1_000_000 })
  let commands: string[] = []
  const ran: { command: string; args: string }[] = []
  on('command.list', async () => ({ value: commands.map(name => ({ name, description: '', source: 'plugin' })) }))
  on('command.run', async (_$: any, e: any, next: any) => {
    if (e.command === 'tycoon') return next(e)
    ran.push({ command: e.command, args: e.args })
    return { text: '' }
  })
  const state: Record<string, any> = {}
  on('state.set', async (_$: any, e: any, next: any) => {
    if (e.plugin === 'token-tycoon') state[e.key] = e.value
    return next(e)
  })

  const ui = await mountBand($)
  expect((await ui.find({ key: 'cycle' }))?.props?.label).toBe('↻ Off')
  await ui.press({ key: 'cycle' })
  expect(state.isHidden).toBe(true)
  expect(ran).toEqual([])

  await $.command.run({ command: 'tycoon', args: 'on', ...RUN })
  expect(state.isHidden).toBe(false)
  commands = ['mods']
  await ui.press({ key: 'cycle' })
  expect(ran).toEqual([{ command: 'mods', args: 'off' }])
  // The switcher's own /tycoon off does the putting away, not this press.
  expect(state.isHidden).toBe(false)
  await ui.unmount()
})
