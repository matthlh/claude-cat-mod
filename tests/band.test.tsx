import { test, expect, mock } from 'claude-code/testing'

test('band draws and buttons respond on each surface', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({
      plugin: 'claude-cat',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false } as any,
      viewport: { columns: 120, rows: 40 },
    })
    expect(await ui.drawn()).toMatchObject({ type: 'Box' })
    await ui.press({ key: 'settings' })
    expect(await ui.find({ key: 'set-coat' })).toBeDefined()
    const before = (await ui.find({ key: 'set-coat' }))?.props?.label
    await ui.press({ key: 'set-coat' })
    const after = (await ui.find({ key: 'set-coat' }))?.props?.label
    expect(after).not.toBe(before)
    await ui.press({ key: 'settings' })
    expect(await ui.find({ key: 'set-coat' })).toBeUndefined()
    await ui.unmount()
  }
})

test('the lane has a click layer that takes clicks', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({
      plugin: 'claude-cat',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false } as any,
      viewport: { columns: 120, rows: 40 },
    })
    expect(await ui.find({ key: 'petter' })).toBeDefined()
    await ui.resize({ columns: 118, rows: 2, in: 'petter' })
    // On the cat (it starts at 10% of the lane), then on the floor. The test
    // kit raises no session.start, so this checks the path, not the reaction.
    await ui.pointer({ type: 'down', x: surface === 'desktop' ? 12 : 17, y: 0, button: 'left' })
    await ui.pointer({ type: 'down', x: 100, y: 0, button: 'left' })
    expect(await ui.drawn()).toMatchObject({ type: 'Box' })
    await ui.unmount()
  }
})
