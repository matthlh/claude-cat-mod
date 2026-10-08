import { test, expect } from 'claude-code/testing'
import { laneSvg, laneCells, PALETTES } from '../hooks/register'
import type { Cat, Motion, Scene } from '../types'

// The golden test draws each leg at its start, 30%, 70% and after, so a fishing
// leg's catch (its last 1200 ms) is never on screen there. This sweeps that
// window every 40 ms on both surfaces, in every scene, both ways, and pins
// each run to hashes taken from the drawings before the pack refactor
// (ce8436f), when the terminal drew the leaping fish over the cat's face.
//
// A change here is a change to the catch. If one is intended, set PRINT to
// true, copy the printed table over CATCH below, and set it back to false.
const PRINT = false

const SCENES: Scene[] = ['clear', 'grass', 'night', 'cozy']
const DIRS = [1, -1] as const
const DURS = [7000, 10_000]
const SPOTS = [0.3, 0.62]
const SURFACES = ['svg', 40, 100] as const
const STEP = 40

// FNV-1a over UTF-16 code units: only compared with itself.
function fnv(s: string, h = 0x811c9dc5): number {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h >>> 0
}

type Run = { label: string; frames: () => string[] }

function runs(hit: boolean): Run[] {
  const out: Run[] = []
  for (const scene of SCENES) {
    for (const dir of DIRS) {
      for (const dur of DURS) {
        for (const spot of SPOTS) {
          for (const surface of SURFACES) {
            const t0 = 40_000
            const frames = () => {
              const list: string[] = []
              // From just before the leap to just after it, when the spot goes.
              for (let el = dur - 1240; el <= dur - 240; el += STEP) {
                const m: Motion = { from: spot, to: spot, t0, dur, activity: 'fish', hit }
                const c: Cat = { mood: 'idle', dir, say: null }
                const x = { ctx: 50, identity: { marking: 'none', shiny: false }, hat: 'none', hour: 12 }
                const now = t0 + el
                list.push(surface === 'svg' ? laneSvg(c, m, now, PALETTES.orange, scene, x) : laneCells(c, m, now, PALETTES.orange, surface, scene, x))
              }
              return list
            }
            out.push({ label: `${scene} ${dir === 1 ? 'R' : 'L'} ${dur} @${spot} ${surface === 'svg' ? 'svg' : `cells${surface}`}`, frames })
          }
        }
      }
    }
  }
  return out
}

const CATCH = `
clear R 7000 @0.3 svg 20092024
clear R 7000 @0.3 cells40 91115838
clear R 7000 @0.3 cells100 83cceae8
clear R 7000 @0.62 svg d9152a84
clear R 7000 @0.62 cells40 72cdacf0
clear R 7000 @0.62 cells100 a737a048
clear R 10000 @0.3 svg 12d3cb94
clear R 10000 @0.3 cells40 91115838
clear R 10000 @0.3 cells100 83cceae8
clear R 10000 @0.62 svg e510ed38
clear R 10000 @0.62 cells40 72cdacf0
clear R 10000 @0.62 cells100 a737a048
clear L 7000 @0.3 svg 772a837a
clear L 7000 @0.3 cells40 bec24e4e
clear L 7000 @0.3 cells100 0ff7fb92
clear L 7000 @0.62 svg 23d8f956
clear L 7000 @0.62 cells40 db49d5a2
clear L 7000 @0.62 cells100 523005e2
clear L 10000 @0.3 svg afc7eb1c
clear L 10000 @0.3 cells40 bec24e4e
clear L 10000 @0.3 cells100 0ff7fb92
clear L 10000 @0.62 svg 1271de94
clear L 10000 @0.62 cells40 db49d5a2
clear L 10000 @0.62 cells100 523005e2
grass R 7000 @0.3 svg bc3e1656
grass R 7000 @0.3 cells40 696910a7
grass R 7000 @0.3 cells100 c1968557
grass R 7000 @0.62 svg 91136f72
grass R 7000 @0.62 cells40 f0b46e1f
grass R 7000 @0.62 cells100 8ff00977
grass R 10000 @0.3 svg bcece030
grass R 10000 @0.3 cells40 22758284
grass R 10000 @0.3 cells100 ba2e8458
grass R 10000 @0.62 svg d44ed4c8
grass R 10000 @0.62 cells40 4874dc78
grass R 10000 @0.62 cells100 632507b8
grass L 7000 @0.3 svg 7ebe8b34
grass L 7000 @0.3 cells40 91135206
grass L 7000 @0.3 cells100 93491352
grass L 7000 @0.62 svg 88d3d2b4
grass L 7000 @0.62 cells40 01ca8272
grass L 7000 @0.62 cells100 05ca0352
grass L 10000 @0.3 svg 36dd8fc0
grass L 10000 @0.3 cells40 40a76d4d
grass L 10000 @0.3 cells100 f5803211
grass L 10000 @0.62 svg fb6af9c4
grass L 10000 @0.62 cells40 1a72e665
grass L 10000 @0.62 cells100 52dcbf51
night R 7000 @0.3 svg 57a1619a
night R 7000 @0.3 cells40 10ebd8fc
night R 7000 @0.3 cells100 007a674c
night R 7000 @0.62 svg 9eaa429a
night R 7000 @0.62 cells40 d48e2d3b
night R 7000 @0.62 cells100 eb7572fc
night R 10000 @0.3 svg db36b244
night R 10000 @0.3 cells40 dcbffdcc
night R 10000 @0.3 cells100 bc3007c0
night R 10000 @0.62 svg a2c077b0
night R 10000 @0.62 cells40 387be527
night R 10000 @0.62 cells100 25ed63f0
night L 7000 @0.3 svg c07e9598
night L 7000 @0.3 cells40 7258a035
night L 7000 @0.3 cells100 a6d60d82
night L 7000 @0.62 svg 6dce746c
night L 7000 @0.62 cells40 f0200202
night L 7000 @0.62 cells100 b0c14cc2
night L 10000 @0.3 svg f5c53774
night L 10000 @0.3 cells40 a5f5400e
night L 10000 @0.3 cells100 979647fa
night L 10000 @0.62 svg 24497f7c
night L 10000 @0.62 cells40 35c9bfda
night L 10000 @0.62 cells100 5e54d99a
cozy R 7000 @0.3 svg b036f7d0
cozy R 7000 @0.3 cells40 f475368e
cozy R 7000 @0.3 cells100 81bee6fe
cozy R 7000 @0.62 svg 0713b7a0
cozy R 7000 @0.62 cells40 cd7b0b8e
cozy R 7000 @0.62 cells100 77c7b77e
cozy R 10000 @0.3 svg de457cfa
cozy R 10000 @0.3 cells40 f475368e
cozy R 10000 @0.3 cells100 81bee6fe
cozy R 10000 @0.62 svg b0f57a42
cozy R 10000 @0.62 cells40 cd7b0b8e
cozy R 10000 @0.62 cells100 77c7b77e
cozy L 7000 @0.3 svg 7727dd82
cozy L 7000 @0.3 cells40 772510bf
cozy L 7000 @0.3 cells100 259446d3
cozy L 7000 @0.62 svg 240ff70a
cozy L 7000 @0.62 cells40 3590d793
cozy L 7000 @0.62 cells100 9f9d4083
cozy L 10000 @0.3 svg 9bb598bc
cozy L 10000 @0.3 cells40 772510bf
cozy L 10000 @0.3 cells100 259446d3
cozy L 10000 @0.62 svg ac842e40
cozy L 10000 @0.62 cells40 3590d793
cozy L 10000 @0.62 cells100 9f9d4083
`

test("a fishing leg's catch draws as it did before the pack refactor, every 40 ms", () => {
  const got = runs(true).map(r => `${r.label} ${r.frames().reduce((h, f) => fnv(f, h), 0x811c9dc5).toString(16).padStart(8, '0')}`)
  if (PRINT) {
    console.log(['const CATCH = `', ...got, '`'].join('\n'))
    throw new Error('PRINT is on')
  }
  const want = CATCH.trim().split('\n')
  expect(got.length).toBe(want.length)
  expect(got.filter((g, i) => g !== want[i])).toEqual([])
})

test('the leaping catch is on screen in every terminal frame of the leap', () => {
  const hits = runs(true).filter(r => !r.label.endsWith('svg'))
  const misses = runs(false).filter(r => !r.label.endsWith('svg'))
  hits.forEach((r, i) => {
    const a = r.frames()
    const b = misses[i].frames()
    // Frames 1..23 are el = dur-1200 .. dur-320: the leap itself.
    for (let k = 1; k <= 23; k++) {
      if (a[k] === b[k]) throw new Error(`${r.label}: the catch is hidden ${1200 - 40 * (k - 1)} ms before the end`)
    }
  })
})
