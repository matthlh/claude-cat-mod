import { test, expect, mock } from 'claude-code/testing'

test('desktop lane is one animated svg; terminal lane is a full-width raster', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  const d = await $.ui.mount({ plugin: 'pixel-cat', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false } as any, viewport: { columns: 100, rows: 40 } })
  const svg = await d.find({ type: 'Svg' })
  const src = String((svg as any)?.props?.source)
  expect(src).toContain('<animate')
  await d.unmount()
  const t = await $.ui.mount({ plugin: 'pixel-cat', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } as any, viewport: { columns: 100, rows: 40 } })
  const r = await t.find({ type: 'Raster' })
  expect((r as any)?.props?.columns).toBe(98)
  await t.unmount()
})
