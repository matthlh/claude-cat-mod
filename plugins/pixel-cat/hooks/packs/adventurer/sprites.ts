// Adventurer pack sprites. Plain data: rows and palettes, and damageRows(),
// which spells a number in the damage font.
// '.' is transparent; every other char is a key into a palette (0xRRGGBB).
// Everything faces LEFT in source, like the cat; faceRight() mirrors it.

import type { Palette } from '../types'

// ── Hero, 12 x 10 ─────────────────────────────────────────────────────────
// A chibi adventurer in chunky 16-bit style: a big head inside a dark outline
// and boots ringed in the same ink (they carry the silhouette on light
// backgrounds), mid-tone clothes (they carry it on dark ones) in two tones,
// the darker running down the back and the far leg like an outline of its own.
// Letters: x head outline, k the same ink on the body (never x there: hero.ts
// finds the neck as the row under the last x), h headwear (hair, helmet or
// hood) on top, r its brim or fringe, g its shade, L a detail at its front (a
// lamp, a gem), a the back of the head, A its shade, s skin, i skin shade (the
// ear, the mouth), H eye shine, K eye, t shirt, T shirt shade (its back edge),
// p near leg, P far leg (the back edge), b near boot, B far boot. The engine's
// closeEyes() turns the eyes into o (skin) and d (a lash line), so every
// outfit defines both. The body starts on the row under the head's outline
// (the last row with an x): hero.ts puts the markings there, and hangs a cape
// on the first pixel past the last T or P of its first three rows, so those
// rows end on T or P with nothing behind.
// The head sits in the same place in every pose but SIT and SLEEP, so a
// blink laid over one frame fits every frame of a pose.
const HEAD = [
  '...xxxxxx...',
  '..xhhhhhgx..',
  '.xLrrrrrggx.',
  '.xsHKssaaAx.',
  '.xsKKssiaAx.',
  '..xsisssAx..',
]
export const STAND = [...HEAD, '...ttttTT...', '...sttTTT...', '...ppPPPP...', '..kbbkBBBk..']
// Near leg forward, then far leg forward, the near arm swinging against it.
export const WALK_A = [...HEAD, '...ttttTT...', '...ttttTTs..', '..pppkPPP...', '.kbbk..kBBk.']
export const WALK_B = [...HEAD, '...ttttTT...', '..sttttTT...', '..PPPkppp...', '.kBBk..kbbk.']
// The arm held out in front at shoulder height, for a torch or a lantern.
export const HOLD_A = [...HEAD, 'sttttttTT...', '...tttTTT...', '..pppkPPP...', '.kbbk..kBBk.']
// Wind-up: the arm goes up the back of the head, the tool raised behind it.
export const SWING_A = [
  '...xxxxxx...',
  '..xhhhhhgx..',
  '.xLrrrrrggx.',
  '.xsHKssaaAx.',
  '.xsKKssiaAxs',
  '..xsisssAxt.',
  '...ttttTTt..',
  '...tttTTT...',
  '..pppkPPP...',
  '.kbbk..kBBk.',
]
// The strike: the arm straight out in front, the tool brought down ahead.
export const SWING_B = [...HEAD, '...ttttTT...', '.sttttTTT...', '..pppkPPP...', '.kbbk..kBBk.']
// Front arm out with the bow, the other hand drawing the string to the chest.
export const BOW = [...HEAD, 'sttstttTT...', '...tttTTT...', '..pppkPPP...', '.kbbk..kBBk.']
export const CHEER = [
  '...xxxxxx...',
  '..xhhhhhgx..',
  'sxLrrrrrggxs',
  'sxsHKssaaAxs',
  'txsKKssiaAxT',
  '.txsisssAxT.',
  '..ttttttTT..',
  '...tttTTT...',
  '...ppPPPP...',
  '..kbbkBBBk..',
]
// Sitting on the ground, legs out in front, toes up.
export const SIT = [
  '............',
  '...xxxxxx...',
  '..xhhhhhgx..',
  '.xLrrrrrggx.',
  '.xsHKssaaAx.',
  '.xsKKssiaAx.',
  '..xsisssAx..',
  '...ttttTT...',
  'b.stttTTT...',
  'bbppppPPP...',
]
// Flat on the back, head on the left (the beds put the pillow there), face
// up, eyes shut, boots pointing up at the far end.
export const SLEEP = [
  '..xxx.......',
  '.xhssx....b.',
  'xhrddsxtsppb',
  'xaAsssxTTPPB',
  '.xxxxx......',
]

// Where a held tool goes: the hand pixel [x, y] in each pose, in the
// left-facing rows above. Facing right, x becomes 11 - x.
export const HANDS = {
  STAND: [3, 7],
  HOLD_A: [0, 6],
  SWING_A: [11, 4],
  SWING_B: [1, 7],
  BOW: [0, 6],
  CHEER: [0, 2],
  SIT: [2, 8],
} as const satisfies Record<string, readonly [number, number]>

// ── Outfits: one set of hero rows, six palettes ───────────────────────────
// Each keeps its look from before, now in two tones: h lighter than r on the
// headwear, g and A a clear step darker, T and P dark enough to read as the
// back edge. None of these letters may be a marking's or a hat's (hero.ts).
const FACE: Palette = { x: 0x1c1310, k: 0x1c1310, s: 0xf3c9a0, i: 0xd99d76, o: 0xf3c9a0, d: 0x3a2418, H: 0xffffff, K: 0x1e1b22 }
export const OUTFITS: Record<string, Palette> = {
  // Brown hair, green shirt, brown trousers.
  starter: {
    ...FACE, h: 0x9c6436, r: 0x8a5530, g: 0x5e3720, L: 0x8a5530, a: 0x8a5530, A: 0x5e3720,
    t: 0x4fb043, T: 0x23662d, p: 0xa8744a, P: 0x6a4328, b: 0x6e4a32, B: 0x3a2516,
  },
  // Yellow hard hat with a lamp, orange vest, denim.
  miner: {
    ...FACE, h: 0xf7cc3e, r: 0xd9a21c, g: 0xa8780f, L: 0xfff6c0, a: 0x6a4428, A: 0x432818,
    t: 0xf08a24, T: 0xa84e10, p: 0x4f74aa, P: 0x2f4a78, b: 0x6e4a32, B: 0x3a2516,
  },
  // Purple hood and robe, a gold gem.
  mage: {
    ...FACE, h: 0x9a6cf0, r: 0x6a48c8, g: 0x45308c, L: 0xf5c542, a: 0x8a5ce6, A: 0x4c3398,
    t: 0x8a5ce6, T: 0x4a2f9a, p: 0x7a4fd6, P: 0x45298a, b: 0x5a4090, B: 0x2e2050,
  },
  // Dark green hood, leather jerkin, olive trousers.
  ranger: {
    ...FACE, h: 0x3a8a52, r: 0x256a3a, g: 0x174428, L: 0x2f7a46, a: 0x2f7a46, A: 0x174428,
    t: 0x9a7448, T: 0x5a3e22, p: 0x76804a, P: 0x464e2a, b: 0x6e4a32, B: 0x3a2516,
  },
  // Silver helmet and plate.
  knight: {
    ...FACE, h: 0xd2d9e2, r: 0x8f99a8, g: 0x5f6878, L: 0x7d8796, a: 0xb8c0cc, A: 0x666f7e,
    t: 0xa9b3c1, T: 0x5a6474, p: 0x8790a0, P: 0x515969, b: 0x56606e, B: 0x2e333c,
  },
  // The same plate in gold, a red gem on the brow.
  gold: {
    ...FACE, h: 0xffdc6a, r: 0xd9a628, g: 0xa0700c, L: 0xe5484d, a: 0xf2c440, A: 0xa0700c,
    t: 0xf0bf3a, T: 0xa47410, p: 0xd9a830, P: 0x8c660c, b: 0x8a6210, B: 0x4e3604,
  },
}

// ── Held tools, <= 8 x 8, drawn with TOOL_PAL ─────────────────────────────
// Draw a tool UNDER the hero (the activity's draw layer) with GRIPS[tool] on
// HANDS[pose]: the hand then covers the grip, and the bow's string goes
// behind the face. Raised tools (SWING_A, CHEER) point up from the grip and
// back over the shoulder; the *_DOWN versions point ahead of the hero, for
// SWING_B. In SWING_A a raised tool reaches 2 rows above row 0 and 6 columns
// behind the frame (CHEER's axe 4 rows above, the desktop's full headroom;
// the 10-row terminal raster has no headroom, so the terminal slides a raised
// tool down its handle instead: see SLIDE in activities.ts); in SWING_B a
// *_DOWN tool reaches 5 columns ahead, its head at the ground.
export const PICKAXE = [
  '..nnnm.',
  '.N...nm',
  '....wNn',
  '...w..n',
  '..w...N',
  '.w.....',
  'W......',
]
export const PICKAXE_DOWN = [
  '.m.....',
  'mn.....',
  'nNwwwwW',
  'N......',
  'N......',
]
export const AXE = [
  '...mm..',
  '..mnnN.',
  '..nnwN.',
  '...wN..',
  '..w....',
  '.w.....',
  'W......',
]
// The same axe turned to point up and ahead from the grip: brandished in
// CHEER's front fist, its head clear of the face and of any hat.
export const AXE_HIGH = [
  '..mm...',
  '.Nnnm..',
  '.Nwnn..',
  '..Nw...',
  '....w..',
  '.....w.',
  '......W',
]
export const AXE_DOWN = [
  'm......',
  'mnN....',
  'mnNwwwW',
  'mnN....',
  'm......',
]
export const SWORD = [
  '.....mm',
  '....mmn',
  '...mmn.',
  '.y.mn..',
  '..yn...',
  '.W.y...',
  'W......',
]
export const SWORD_DOWN = [
  '.....y..',
  'mmmmmyWW',
  '.nnnny..',
]
export const HAMMER = [
  'mmmmn',
  'nnnnN',
  '..w..',
  '..w..',
  '..w..',
  '..W..',
]
export const HAMMER_DOWN = [
  'mn....',
  'mnwwwW',
  'nN....',
]
// Drawn: the string pulled back to a point on the right, where BOW's other
// hand meets the chest.
export const BOW_ARC = [
  '.r...',
  'r.s..',
  'r..s.',
  'rW..s',
  'r..s.',
  'r.s..',
  '.r...',
]
// Flies left: a barbed head in front, feathers at the back; the grip is the
// nock end.
export const ARROW = [
  '.m...qq',
  'mnwwwwq',
  '.m...qq',
]
export const TORCH_A = [
  '.R.',
  'RfR',
  'fFf',
  '.f.',
  '.w.',
  '.w.',
  '.W.',
]
export const TORCH_B = [
  'R..',
  '.fR',
  'fFf',
  '.f.',
  '.w.',
  '.w.',
  '.W.',
]
// Open, held up to read in SIT.
export const BOOK = [
  '.eeCee.',
  'celCelc',
  'celCelc',
  'cccCccc',
]
// A lantern on a short pole, held up like the torch: a ring and a cap, two
// rows of lit glass, a base, then the pole.
export const LANTERN = [
  '.k.',
  'kyk',
  'yLy',
  'yLy',
  'kyk',
  '.w.',
  '.W.',
]

// The grip pixel [x, y] of each tool.
export const GRIPS = {
  PICKAXE: [0, 6],
  PICKAXE_DOWN: [6, 2],
  AXE: [0, 6],
  AXE_HIGH: [6, 6],
  AXE_DOWN: [6, 2],
  SWORD: [0, 6],
  SWORD_DOWN: [6, 1],
  HAMMER: [2, 5],
  HAMMER_DOWN: [5, 1],
  BOW_ARC: [1, 3],
  ARROW: [6, 1],
  TORCH_A: [1, 6],
  TORCH_B: [1, 6],
  BOOK: [6, 3],
  LANTERN: [1, 6],
} as const satisfies Record<string, readonly [number, number]>

export const TOOL_PAL: Palette = {
  m: 0xe6ebf0, n: 0xa7b0bb, N: 0x5d6570, // steel: edge, face, shadow
  w: 0xb07a4a, W: 0x6b4430, // handle, grip
  y: 0xe0b33c, k: 0x4a4038, // brass, iron
  r: 0xa0683a, s: 0xd8d0c0, q: 0xe0566b, // bow, string, fletching
  R: 0xe8562a, f: 0xffa53d, F: 0xfff1a8, // flame edge, flame, flame core
  e: 0xf2e8d2, l: 0x8a8070, c: 0x7a3fb0, C: 0x4a2a70, // pages, text, cover, spine
  L: 0xfff6c2, // lantern glow
}

// ── Enemies and critters, drawn with MOB_PAL ──────────────────────────────
// Facing left like everything else. A generic shambling zombie, 10 x 10, in
// the hero's proportions: x outline, z grey-green skin, Z its shade, g patchy
// hair, e glowing eye, K pupil, m open mouth, c torn shirt, C its shade,
// u trousers, U far leg. A has the feet apart, B together with the body a
// row lower.
export const ZOMBIE_A = [
  '..xxxxx...',
  '.xgzgzzx..',
  'xzzzzzzZx.',
  'xeKzeKzZx.',
  'xzzzzzzZx.',
  '.xzmmzZx..',
  'zzcccccCx.',
  '..cCcCCC..',
  '..uu.UU...',
  '.zz...ZZ..',
]
export const ZOMBIE_B = [
  '..........',
  '..xxxxx...',
  '.xgzgzzx..',
  'xzzzzzzZx.',
  'xeKzeKzZx.',
  'xzzzzzzZx.',
  'zzxmmzZxC.',
  '..cccccC..',
  '..ucCUU...',
  '..zzZZ....',
]
// Knocked back a pixel and flashing pale (w, W), a spark (X) where the
// blow landed. Show it for a beat after a hit, then ZOMBIE_A again.
export const ZOMBIE_HIT = [
  '...xxxxx..',
  '..xwwwwwx.',
  '.xwwwwwwWx',
  '.xKwwKwwWx',
  '.xwwwwwwWx',
  'X.xwmmwWx.',
  '.Xww.cccC.',
  'X..cCcCCC.',
  '...uu.UU..',
  '..ww...WW.',
]
// Squashed on landing, stretched in the air. j body, J shine, i rim.
export const SLIME_A = [
  '......',
  '.iiii.',
  'ijJjji',
  'iKjjKi',
  'iiiiii',
]
export const SLIME_B = [
  '..ii..',
  '.ijji.',
  '.iJji.',
  '.KjKj.',
  '..ii..',
]
// Sitting, then mid-hop. a fur, A shade, v nose, n tail.
export const BUNNY_A = [
  '.aA...',
  '.aA...',
  'aKaa..',
  'vaaaan',
  '.AaaA.',
]
export const BUNNY_B = [
  '......',
  '..aA..',
  'aKaaa.',
  'vaaaan',
  'A...A.',
]
// A puff of smoke where something vanishes, about as big as a block or a
// slime: a burst, a cloud, then wisps. p puff, P its light, q its shade.
export const POOF_1 = [
  '.......',
  '...q...',
  '..qPq..',
  '.qPPPq.',
  '..qPq..',
  '...q...',
]
export const POOF_2 = [
  '..pp.p.',
  '.pPPpPp',
  'pPPPPPp',
  'pPPPPpq',
  '.qpPpq.',
  '..qqq..',
]
export const POOF_3 = [
  'p.....p',
  '..p.p..',
  '.q...q.',
  '..q.q..',
  'p.....p',
  '.......',
]

export const MOB_PAL: Palette = {
  x: 0x1f2a1c,
  z: 0x8fa878, Z: 0x67805a, g: 0x3e4a32, e: 0xf2e05a, K: 0x1a1a1a, m: 0x4a2020,
  c: 0x7a5a8a, C: 0x56405f, u: 0x5a4a3a, U: 0x433628,
  w: 0xeefae6, W: 0xb8d0a8, X: 0xfff1a8,
  j: 0x6fd06a, J: 0xe0ffd8, i: 0x3e8f3e,
  a: 0xd8c4a8, A: 0x9c8064, v: 0xf08f9a, n: 0xffffff,
  p: 0xc4c8ce, P: 0xeef0f2, q: 0x8a9099,
}

// ── Drops and crafted items, <= 5 x 5, drawn with ITEM_PAL ────────────────
// A coin spins between its face (A) and its edge (B).
export const COIN_A = [
  '.yyy.',
  'yYyyo',
  'yyOyo',
  'yyyoo',
  '.ooo.',
]
export const COIN_B = [
  '..y..',
  '.yYo.',
  '.yOo.',
  '.yyo.',
  '..o..',
]
export const WOOD = [
  '.rbbb',
  'rRrbb',
  'rrrbB',
  '.rBBB',
]
export const STONE = [
  '.ggg.',
  'gGggg',
  'ggggd',
  '.dddd',
]
// Ore: a chunk of the same stone with flecks of copper (c), iron (f), gold (y).
export const ORE_COPPER = [
  '.ggg.',
  'gcGgg',
  'ggcgd',
  '.dddc',
]
export const ORE_IRON = [
  '.ggg.',
  'gfGgg',
  'ggfgd',
  '.dddf',
]
export const ORE_GOLD = [
  '.ggg.',
  'gyGgg',
  'ggygd',
  '.dddy',
]
// Crafted at the bench: a wooden sword and a chair (side on, facing left).
export const WOOD_SWORD = [
  '....t',
  '...tT',
  'k.tT.',
  '.kT..',
  'k.k..',
]
export const CHAIR = [
  '...R',
  '...R',
  'tttR',
  't..R',
  't..R',
]

export const ITEM_PAL: Palette = {
  y: 0xf5c542, Y: 0xfff1a8, o: 0xc9961a, O: 0x9a6e10, // gold
  r: 0xe0bb85, R: 0xa87a4a, b: 0x8a5a3c, B: 0x5e3b24, // cut wood, bark
  g: 0x9aa0a6, G: 0xc9ced4, d: 0x6a7078, // stone
  c: 0xf08a3a, f: 0xe0a88a, // copper, iron
  t: 0xe0b47a, T: 0x9a6b47, k: 0x5e3b24, // crafted wood
}

// ── Effects, drawn with their own palettes ────────────────────────────────
// Floating damage numbers: a 3 x 5 digit font. n is the face, N its lower
// half a shade darker; damageRows() spells a number in it, one blank column
// between digits, and rings it in k ink that follows the strokes (corners
// left open) so it reads over any scenery. Colour it with one of DAMAGE_PAL:
// white for a hit, yellow for a strong one, red for a hit taken.
const DIGITS: string[][] = [
  ['nnn', 'n.n', 'n.n', 'N.N', 'NNN'],
  ['.n.', 'nn.', '.n.', '.N.', 'NNN'],
  ['nnn', '..n', 'nnn', 'N..', 'NNN'],
  ['nnn', '..n', '.nn', '..N', 'NNN'],
  ['n.n', 'n.n', 'nnn', '..N', '..N'],
  ['nnn', 'n..', 'nnn', '..N', 'NNN'],
  ['nnn', 'n..', 'nnn', 'N.N', 'NNN'],
  ['nnn', '..n', '..n', '.N.', '.N.'],
  ['nnn', 'n.n', 'nnn', 'N.N', 'NNN'],
  ['nnn', 'n.n', 'nnn', '..N', 'NNN'],
]
export function damageRows(value: number): string[] {
  const digits = String(Math.max(0, Math.floor(value))).split('').map(d => DIGITS[Number(d)] ?? DIGITS[0] ?? [])
  const w = digits.length * 4 + 1
  const grid = Array.from({ length: 7 }, () => Array.from({ length: w }, () => '.'))
  digits.forEach((glyph, i) => glyph.forEach((row, y) => [...row].forEach((ch, x) => {
    const line = grid[y + 1]
    if (ch !== '.' && line) line[1 + i * 4 + x] = ch
  })))
  const ink = (x: number, y: number) => /[nN]/.test(grid[y]?.[x] ?? '.')
  return grid.map((row, y) => row.map((ch, x) => {
    if (ch !== '.') return ch
    return ink(x - 1, y) || ink(x + 1, y) || ink(x, y - 1) || ink(x, y + 1) ? 'k' : '.'
  }).join(''))
}
const INK = 0x1c1310
export const DAMAGE_PAL: Record<'white' | 'yellow' | 'red', Palette> = {
  white: { n: 0xffffff, N: 0xcfd6e0, k: INK },
  yellow: { n: 0xffe45c, N: 0xf0a828, k: INK },
  red: { n: 0xff6a5a, N: 0xd42e3a, k: INK },
}

// A drop's sparkle, 5 x 5, shown in turn: a glint, a four-point star, then a
// wider twinkle as it fades. W white core, w pale gold, y gold.
export const SPARKLE_1 = [
  '.....',
  '..w..',
  '.wWw.',
  '..w..',
  '.....',
]
export const SPARKLE_2 = [
  '..y..',
  '..w..',
  'ywWwy',
  '..w..',
  '..y..',
]
export const SPARKLE_3 = [
  'y...y',
  '.w.w.',
  '.....',
  '.w.w.',
  'y...y',
]
export const FX_PAL: Palette = {
  W: 0xffffff, w: 0xfff3b0, y: 0xf5c542, // sparkle
}
