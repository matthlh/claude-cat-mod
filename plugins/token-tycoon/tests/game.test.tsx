import { test, expect, mock } from 'claude-code/testing'
import { FRESH, clickGain, dps, genCost, milestoneMult, fmt, pointsFor, sceneSvg, sceneCells, GENS } from '../hooks/register'

test('the numbers: clicks, income, milestones, prices, prestige', async () => {
  expect(clickGain(FRESH)).toBe(1)
  expect(dps(FRESH)).toBe(0)
  const some = { ...FRESH, owned: { ...FRESH.owned, agent: 10, subagent: 2 } }
  expect(milestoneMult(10)).toBe(2)
  expect(milestoneMult(9)).toBe(1)
  expect(Math.abs(dps(some) - (10 * 0.1 * 2 + 2 * 1)) < 1e-9).toBe(true)
  expect(Math.abs(dps({ ...some, frenzyUntil: 10_000 }, 5000) - (10 * 0.1 * 2 + 2 * 1) * 7) < 1e-9).toBe(true)
  expect(genCost(GENS[0]!, 0)).toBe(15)
  expect(genCost(GENS[0]!, 1)).toBe(18)
  expect(fmt(999)).toBe('999')
  expect(fmt(1234)).toBe('1.23K')
  expect(pointsFor(499_999)).toBe(0)
  expect(pointsFor(500_000)).toBe(1)
  expect(pointsFor(2_000_000)).toBe(2)
})

test('the scene draws on both surfaces', async () => {
  const f = { at: 0, gain: 0, kind: null }
  const svg = sceneSvg(FRESH, { at: 1000, gain: 7, kind: 'click' }, 1200)
  expect(svg).toContain('<animate')
  expect(svg).toContain('+7')
  expect(sceneCells(FRESH, f, 0).length).toBeGreaterThan(100)
})

test('band draws, prompt earns tokens, shop pane sells agents', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  const text = async (ui: any) => JSON.stringify(await ui.drawn())
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({
      plugin: 'token-tycoon',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false } as any,
      viewport: { columns: 120, rows: 40 },
    })
    expect(await ui.drawn()).toMatchObject({ type: 'Box' })
    expect(await ui.find({ type: surface === 'terminal' ? 'Raster' : 'Svg' })).toBeDefined()
    const before = await text(ui)
    await ui.press({ key: 'prompt' })
    expect(await text(ui)).not.toBe(before)
    await ui.unmount()
  }

  const pane = await $.ui.mount({
    plugin: 'token-tycoon',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'token-tycoon',
    props: { title: 'Token Tycoon', isFocused: false } as any,
    viewport: { columns: 90, rows: 40 },
  })
  // Two clicks so far: too poor, the row is plain text with no button.
  expect(await pane.find({ key: 'buy-agent' })).toBeUndefined()
  expect(await text(pane)).toContain('Agent   15 ✦')
  for (let i = 0; i < 20; i++) await pane.press({ key: 'prompt' })
  expect(String((await pane.find({ key: 'buy-agent' }))?.props?.label)).toBe('Agent')
  await pane.press({ key: 'buy-agent' })
  expect(await text(pane)).toContain('Agent ×1')
  await pane.unmount()
})
