// Summoned minions for the Adventurer pack. Plain data only: rows and
// palettes, no drawing code.
// '.' is transparent; every other char is a key into the minion's own
// palette (0xRRGGBB). Everything faces LEFT in source, like the hero;
// faceRight() mirrors it. Each fits in 8 x 8, drawn from its top left, its
// bottom row the one that rests on the ground (or hovers, for a flyer), and
// is outlined in a dark ink of its own colour (x) so it reads on any scenery.
// Wherever there is a K it is an eye, and every palette has d, so closeEyes()
// (engine/draw) gives any of them a happy squint, as it does the hero. At 8
// rows tall, a flyer has two of the terminal's ten rows to hover and bob in:
// one off the ground, and one more on the bob's up step.

import type { Palette, Rows } from '../types'

export type Minion = {
  /** two frames shown in turn while it keeps the hero company */
  idle: [Rows, Rows]
  /** the frame it strikes in */
  attack: Rows
  pal: Palette
  /** true: it hovers off the ground; false: it keeps to the ground */
  flying: boolean
  /** ms each idle frame shows */
  tick: number
}

// A little fire sprite: a round ember body under a flickering crest, two
// stubby horns, no legs, just a wisp of flame. It spits a spark to attack.
// x ink, R body, r its shade, o glow, F flame core, f flame, h horn, e eye,
// K pupil, m mouth.
const IMP: Minion = {
  idle: [
    [
      '...ff...',
      'h.fFFf.h',
      'hxoFFoxh',
      'xoRRRRrx',
      'xeKReKrx',
      'xRmmRRrx',
      '.xRRrrx.',
      '..xffx..',
    ],
    [
      '..f..f..',
      'h..fF..h',
      'hxofFoxh',
      'xoRRRRrx',
      'xeKReKrx',
      'xRmmRRrx',
      '.xRRrrx.',
      '...ff...',
    ],
  ],
  attack: [
    '...ff...',
    'h.fFFf.h',
    'hxoFFoxh',
    'xoRRRRrx',
    'xKKRKKrx',
    'FxmmRRrx',
    'fFmRrrx.',
    'F.xffx..',
  ],
  pal: {
    x: 0x4a1408, R: 0xe8562a, r: 0xb2341a, o: 0xff9a3a, F: 0xfff1a8, f: 0xffc94a,
    h: 0x8a3a20, e: 0xfff6d8, K: 0x2a0e08, d: 0x2a0e08, m: 0x5a1408,
  },
  flying: true,
  tick: 160,
}

// A baby jelly, a rosy dome with a curl on top and a darker heart inside:
// squat on the ground, then tall as it springs. Round shoulders, so it
// reads as a blob and not a cone at lane size. j body, J shine, c core,
// x ink, e eye, K pupil, m mouth.
const SLIME: Minion = {
  idle: [
    [
      '........',
      '........',
      '...x....',
      '..xjxx..',
      '.xJjjjx.',
      'xJeKjjjx',
      'xjjjjccx',
      '.xxxxxx.',
    ],
    [
      '...x....',
      '..xjx...',
      '.xJjjx..',
      '.xeKjjx.',
      '.xjjjjx.',
      '.xjjjcx.',
      '..xxxx..',
      '........',
    ],
  ],
  attack: [
    '........',
    '....x...',
    '...xjxx.',
    '..xJjjjx',
    '.xeKjjjx',
    'xmmjjjcx',
    'xjjjjccx',
    '.xxxxxx.',
  ],
  pal: { x: 0x8a2a52, j: 0xf27aa6, J: 0xffe0ec, c: 0xd2508a, e: 0xffffff, K: 0x3a1024, d: 0x3a1024, m: 0x5a1430 },
  flying: false,
  tick: 260,
}

// A chubby striped hornet: a big dark eye, amber body banded dark, pale
// wings that blur up and down, a stinger at the back that it swings round
// and drives forward to attack. a amber, A its shade, b band, w wing,
// W wing edge, s stinger, x ink, e eye shine, K eye.
const HORNET: Minion = {
  idle: [
    [
      '...WW...',
      '..WwwW..',
      '.xxxWxx.',
      'xeKaabAx',
      'xKKaAbAs',
      '.xmaabx.',
      '..xxxx..',
      '........',
    ],
    [
      '........',
      '........',
      '.xxxxxx.',
      'xeKaWwWx',
      'xKKaAwWs',
      '.xmaabx.',
      '..xxxx..',
      '........',
    ],
  ],
  attack: [
    '..WW....',
    '.WwwW...',
    '.xxWxxx.',
    'xeKaabAx',
    'xKKaAbAx',
    '.xmxbAx.',
    '..sxxx..',
    '.s......',
  ],
  pal: { x: 0x2a1a0a, a: 0xf2b630, A: 0xc0801a, b: 0x3a2a14, w: 0xeef6ff, W: 0xa8c4d8, s: 0x4a3418, e: 0xffffff, K: 0x161012, d: 0x161012, m: 0x6a4a20 },
  flying: true,
  tick: 90,
}

// A fuzzy jumping spider: a round body with a pale band, two big shiny front
// eyes, legs that step in turn, and front legs raised with fangs bared to
// strike. f fur, F its light, b band, l leg, x ink, e eye shine, K eye,
// m fang.
const SPIDER: Minion = {
  idle: [
    [
      '........',
      '.l.xxx.l',
      'l.xfbFxl',
      '.xxfbfx.',
      'xeKfffx.',
      'xKKxxx.l',
      'l.l..l.l',
      '.l.l..l.',
    ],
    [
      '........',
      'l..xxx..',
      '.lxfbFxl',
      '.xxfbfxl',
      'xeKfffx.',
      'xKKxxxl.',
      '.l.l.l.l',
      'l...l...',
    ],
  ],
  attack: [
    'l.......',
    '.l.xxx.l',
    '..xfbFxl',
    'lxxfbfx.',
    'xeKfffx.',
    'xKKxxx.l',
    'mm.l.l.l',
    '........',
  ],
  pal: { x: 0x1c1418, f: 0xb0703f, F: 0xe09a5a, b: 0xf0dcb0, l: 0x9a6440, e: 0xffffff, K: 0x101014, d: 0x101014, m: 0xf2ece0 },
  flying: false,
  tick: 120,
}

// A stout raven, round as a pigeon: a head with a pale eye glint and a
// heavy beak, a blue-black body with a sheen, a wing that beats up and down,
// and tucked feet; it sweeps the wing back for a diving peck. A head, a beak
// and feet of its own, so it reads as a bird and not a dark wedge.
// k body, S its sheen, w wing, W its light, x ink, e eye glint, y beak,
// Y its shade.
const RAVEN: Minion = {
  idle: [
    [
      '.....xx.',
      '..xxxWWx',
      '.xkkxwWx',
      'xekkkxwx',
      'yykkkkSx',
      '.xkkkkkx',
      '..xkkkx.',
      '...x.x..',
    ],
    [
      '........',
      '..xxx...',
      '.xkkkxxx',
      'xekkWWWx',
      'yykkwWWx',
      '.xkkkwwx',
      '..xkkkx.',
      '...x.x..',
    ],
  ],
  attack: [
    '......xx',
    '..xxxxWx',
    '.xkkxwWx',
    'xekkkwxx',
    'yykkkkSx',
    'Y.xkkkkx',
    '...xkkx.',
    '....x.x.',
  ],
  pal: { x: 0x0e0e18, k: 0x3c4268, S: 0x7a8cc4, w: 0x2c3050, W: 0x6a78b0, e: 0xffffff, d: 0x0e0e18, y: 0xd0ccbc, Y: 0x7a7868 },
  flying: true,
  tick: 150,
}

// In the order the slots take them: five, one for each place in sight (CREW_MAX).
export const MINIONS = {
  imp: IMP,
  slime: SLIME,
  hornet: HORNET,
  spider: SPIDER,
  raven: RAVEN,
} satisfies Record<string, Minion>

export type MinionId = keyof typeof MINIONS
