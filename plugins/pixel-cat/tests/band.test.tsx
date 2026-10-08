import { test, expect, mock } from 'claude-code/testing'

test('band draws and buttons respond on each surface', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({
      plugin: 'pixel-cat',
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
    await ui.press({ key: 'pet' })
    await ui.unmount()
  }
})
