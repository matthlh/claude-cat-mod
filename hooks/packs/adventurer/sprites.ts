// Adventurer pack sprites. Plain data only: rows and palettes, no imports.
// '.' is transparent; every other char is a key into a palette (0xRRGGBB).
// Everything faces LEFT in source, like the cat; faceRight() mirrors it.

type Palette = Record<string, number>

// ── Hero, 12 x 10 ─────────────────────────────────────────────────────────
// A chibi adventurer: big head with a dark outline (it carries the
// silhouette on light backgrounds), mid-tone clothes (they carry it on dark).
// Letters: x outline, h headwear (hair, helmet or hood), r its brim or
// fringe, g its shade, L a detail at its front (a lamp, a gem), a the back
// of the head, A its shade, s skin, H eye shine, K eye, t shirt, T shirt
// shade, p near leg, P far leg, b near boot, B far boot. closeEyes() turns
// the eyes into o (skin) and d (a lash line), so every outfit defines both.
// The head sits in the same place in every pose but SIT and SLEEP, so a
// blink laid over one frame fits every frame of a pose.
const HEAD = [
  '...xxxxxx...',
  '..xhhhhhhx..',
  '.xLrrrrrrgx.',
  '.xsHKssaaax.',
  '.xsKKsssaAx.',
  '..xsssssAx..',
]
export const STAND = [...HEAD, '...tttttT...', '...stttTT...', '...pppPPP...', '..bbb.BBB...']
// Near leg forward, then far leg forward, the near arm swinging against it.
export const WALK_A = [...HEAD, '...tttttT...', '...ttttTTs..', '..pppPPPP...', '.bb.....BB..']
export const WALK_B = [...HEAD, '...tttttT...', '..sttttTT...', '..PPPpppp...', '.BB.....bb..']
// The arm held out in front at shoulder height, for a torch or a lantern.
export const HOLD_A = [...HEAD, 'stttttttT...', '...ttttTT...', '..pppPPPP...', '.bb.....BB..']
export const HOLD_B = [...HEAD, 'stttttttT...', '...ttttTT...', '..PPPpppp...', '.BB.....bb..']
// Wind-up: the arm goes up the back of the head, the tool raised behind it.
export const SWING_A = [
  '...xxxxxx...',
  '..xhhhhhhx..',
  '.xLrrrrrrgx.',
  '.xsHKssaaax.',
  '.xsKKsssaAxs',
  '..xsssssAxt.',
  '...tttttTt..',
  '...ttttTT...',
  '..pppPPPP...',
  '.bb.....BB..',
]
// The strike: the arm straight out in front, the tool brought down ahead.
export const SWING_B = [...HEAD, '...tttttT...', '.stttttTT...', '..pppPPPP...', '.bb.....BB..']
// Front arm out with the bow, the other hand drawing the string to the chest.
export const BOW = [...HEAD, 'sttsttttT...', '...ttttTT...', '..pppPPPP...', '.bb.....BB..']
export const CHEER = [
  '...xxxxxx...',
  '..xhhhhhhx..',
  'sxLrrrrrrgxs',
  'sxsHKssaaaxs',
  'txsKKsssaAxT',
  '.txsssssAxT.',
  '..ttttttTT..',
  '...ttttTT...',
  '...pppPPP...',
  '..bbb.BBB...',
]
// Sitting on the ground, legs out in front, toes up.
export const SIT = [
  '............',
  '...xxxxxx...',
  '..xhhhhhhx..',
  '.xLrrrrrrgx.',
  '.xsHKssaaax.',
  '.xsKKsssaAx.',
  '..xsssssAx..',
  '...tttttT...',
  'b.sttttTT...',
  'bbpppppPP...',
]
// Flat on the back, head on the left (the beds put the pillow there), face
// up, eyes shut, boots pointing up at the far end.
export const SLEEP = [
  '..xxx.......',
  '.xhssx....b.',
  'xhrddsxtsppb',
  'xaasssxTTPPB',
  '.xxxxx......',
]

// Where a held tool goes: the hand pixel [x, y] in each pose, in the
// left-facing rows above. Facing right, x becomes 11 - x.
export const HANDS: Record<string, [number, number]> = {
  STAND: [3, 7],
  WALK_A: [9, 7],
  WALK_B: [2, 7],
  HOLD_A: [0, 6],
  HOLD_B: [0, 6],
  SWING_A: [11, 4],
  SWING_B: [1, 7],
  BOW: [0, 6],
  CHEER: [0, 2],
  SIT: [2, 8],
}
// BOW's other hand, where the drawn string meets the chest; CHEER's other fist.
export const BOW_DRAW_HAND: [number, number] = [3, 6]
export const CHEER_BACK_HAND: [number, number] = [11, 2]

// ── Outfits: one set of hero rows, six palettes ───────────────────────────
const FACE: Palette = { x: 0x241a16, s: 0xf3c9a0, o: 0xf3c9a0, d: 0x3a2418, H: 0xffffff, K: 0x1e1b22 }
export const OUTFITS: Record<string, Palette> = {
  // Brown hair, green shirt, brown trousers.
  starter: {
    ...FACE, r: 0x8a5530, h: 0x8a5530, g: 0x6a3f22, L: 0x8a5530, a: 0x8a5530, A: 0x6a3f22,
    t: 0x4fb043, T: 0x2f7d34, p: 0xa8744a, P: 0x805634, b: 0x6e4a32, B: 0x553826,
  },
  // Yellow hard hat with a lamp, orange vest, denim.
  miner: {
    ...FACE, r: 0xd9a21c, h: 0xf2c230, g: 0xc4901c, L: 0xfff6c0, a: 0x6a4428, A: 0x4e301c,
    t: 0xf08a24, T: 0xbd5f14, p: 0x4f74aa, P: 0x3a5884, b: 0x6e4a32, B: 0x553826,
  },
  // Purple hood and robe, a gold gem.
  mage: {
    ...FACE, r: 0x6a48c8, h: 0x8a5ce6, g: 0x6040b8, L: 0xf5c542, a: 0x8a5ce6, A: 0x6040b8,
    t: 0x8a5ce6, T: 0x6040b8, p: 0x7a4fd6, P: 0x5a36a8, b: 0x5a4090, B: 0x45306e,
  },
  // Dark green hood, leather jerkin, olive trousers.
  ranger: {
    ...FACE, r: 0x256a3a, h: 0x2f7a46, g: 0x1f5a32, L: 0x2f7a46, a: 0x2f7a46, A: 0x1f5a32,
    t: 0x9a7448, T: 0x6e5030, p: 0x76804a, P: 0x5a6236, b: 0x6e4a32, B: 0x553826,
  },
  // Silver helmet and plate.
  knight: {
    ...FACE, r: 0x8f99a8, h: 0xb8c0cc, g: 0x7d8796, L: 0x7d8796, a: 0xb8c0cc, A: 0x7d8796,
    t: 0xa9b3c1, T: 0x6f7a8a, p: 0x8790a0, P: 0x687180, b: 0x56606e, B: 0x444b57,
  },
  // The same plate in gold, a red gem on the brow.
  gold: {
    ...FACE, r: 0xd9a628, h: 0xf2c440, g: 0xc4901c, L: 0xe5484d, a: 0xf2c440, A: 0xc4901c,
    t: 0xf0bf3a, T: 0xb8861a, p: 0xd9a830, P: 0xa87e1c, b: 0x8a6210, B: 0x6e4c0a,
  },
}

// ── Held tools, <= 8 x 8, drawn with TOOL_PAL ─────────────────────────────
// Draw a tool UNDER the hero (the activity's draw layer) with GRIPS[tool] on
// HANDS[pose]: the hand then covers the grip, and the bow's string goes
// behind the face. Raised tools (SWING_A, CHEER) point up from the grip and
// back over the shoulder; the *_DOWN versions point ahead of the hero, for
// SWING_B. In SWING_A a raised tool reaches 2 rows above row 0 and 6 columns
// behind the frame (CHEER's sword 4 rows above, the desktop's full headroom;
// the 10-row terminal raster clips what is above row 0); in SWING_B a *_DOWN
// tool reaches 5 columns ahead, its head at the ground.
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
// Drawn: the string pulled back to a point on the right, at BOW_DRAW_HAND.
export const BOW_ARC = [
  '.r...',
  'r.s..',
  'r..s.',
  'rW..s',
  'r..s.',
  'r.s..',
  '.r...',
]
// Flies left; the grip is the nock end.
export const ARROW = [
  'm...q.',
  'nwwwwq',
  'm...q.',
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
// Hangs from its handle at the hand.
export const LANTERN = [
  '.k.',
  'kyk',
  'yLy',
  'kyk',
]

// The grip pixel [x, y] of each tool.
export const GRIPS: Record<string, [number, number]> = {
  PICKAXE: [0, 6],
  PICKAXE_DOWN: [6, 2],
  AXE: [0, 6],
  AXE_DOWN: [6, 2],
  SWORD: [0, 6],
  SWORD_DOWN: [6, 1],
  HAMMER: [2, 5],
  HAMMER_DOWN: [5, 1],
  BOW_ARC: [1, 3],
  ARROW: [5, 1],
  TORCH_A: [1, 6],
  TORCH_B: [1, 6],
  BOOK: [6, 3],
  LANTERN: [1, 0],
}

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
// A puff of smoke where something vanishes: p puff, P its light, q its shade.
export const POOF_1 = [
  '.....',
  '..q..',
  '.qPq.',
  '..q..',
  '.....',
]
export const POOF_2 = [
  '.pp..',
  'pPPpp',
  'pPPPp',
  'qpPpq',
  '.qqq.',
]
export const POOF_3 = [
  'p...p',
  '.q.q.',
  '.....',
  '.q.q.',
  'p...p',
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
// What a slime leaves behind, in its colours.
export const GEL = [
  '..j..',
  '.jJj.',
  'jJjjj',
  'jjjji',
  '.iii.',
]
export const HEART = [
  'hh.hh',
  'hWhhH',
  '.hhH.',
  '..H..',
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
  j: 0x6fd06a, J: 0xd8ffd0, i: 0x3e8f3e, // gel
  h: 0xe5484d, H: 0xa8262b, W: 0xffc2c4, // heart
  t: 0xe0b47a, T: 0x9a6b47, k: 0x5e3b24, // crafted wood
}
