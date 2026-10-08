# Vectorise the sliced frames: one shared palette, one <path> per colour, plus
# overlays that hold only the pixels where a frame differs from its base frame.
# usage: vec.py <frames dir> <size> <colours> <out frames.ts> <check.svg>
import sys, os
from PIL import Image
D, SIZE, COLORS, OUT, CHECK = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5]
names = ['idle', 'eyesClosed', 'lookUp', 'blink', 'typing', 'thinking', 'sleep1', 'sleep2', 'oops', 'cheer1', 'cheer2', 'overclock1', 'overclock2', 'hit']
imgs = [Image.open(os.path.join(D, f'f{i:02d}.png')).convert('RGBA').resize((SIZE, SIZE), Image.LANCZOS) for i in range(14)]
# one palette for every frame, from all their opaque pixels together
strip = Image.new('RGB', (SIZE * 14, SIZE), (0, 0, 0))
for i, im in enumerate(imgs):
    strip.paste(im.convert('RGB'), (i * SIZE, 0), im.getchannel('A'))
pal = strip.quantize(colors=COLORS, method=Image.Quantize.MEDIANCUT, dither=0)
def grid(im):
    q = im.convert('RGB').quantize(palette=pal, dither=0).convert('RGB')
    px, ap = q.load(), im.getchannel('A').load()
    return [[px[x, y] if ap[x, y] >= 100 else None for x in range(SIZE)] for y in range(SIZE)]
def paths(g):
    runs = {}
    for y in range(SIZE):
        x = 0
        while x < SIZE:
            c = g[y][x]
            if c is None: x += 1; continue
            w = 1
            while x + w < SIZE and g[y][x + w] == c: w += 1
            runs.setdefault(c, []).append((x, y, w)); x += w
    return ''.join(f'<path fill="#{c[0]:02x}{c[1]:02x}{c[2]:02x}" d="{"".join(f"M{x} {y}h{w}v1h-{w}z" for x, y, w in rs)}"/>' for c, rs in runs.items())
grids = [grid(im) for im in imgs]
frames = [paths(g) for g in grids]
pairs = []  # overlays turned out as large as whole frames; kept for a pixel-aligned sheet
overlays = {}
for f, b in pairs:
    g = [[grids[f][y][x] if grids[f][y][x] != grids[b][y][x] and grids[f][y][x] is not None else None for x in range(SIZE)] for y in range(SIZE)]
    overlays[f'{f}/{b}'] = paths(g)
esc = lambda s: s.replace("'", "\\'")
out = ['// The character frames as SVG paths (one per colour, a shared palette),',
       f'// {SIZE}x{SIZE}, sliced from docs/sheet.webp by docs/slice.py, vectorised by docs/vec.py.',
       '// Index order: ' + ', '.join(f'{i} {n}' for i, n in enumerate(names)),
       f'export const FRAME_SIZE = {SIZE}', 'export const FRAMES: string[] = [']
out += [f"  '{esc(f)}'," for f in frames]
out += [']']
open(OUT, 'w').write('\n'.join(out) + '\n')
print('frames', [len(f) for f in frames]); print('overlays', {k: len(v) for k, v in overlays.items()})
open(CHECK, 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" viewBox="0 0 {SIZE*3} {SIZE}" width="{SIZE*9}" height="{SIZE*3}"><rect width="100%" height="100%" fill="#2a2a2e"/>{frames[0]}<g transform="translate({SIZE} 0)">{frames[3]}</g><g transform="translate({SIZE*2} 0)">{frames[5]}</g></svg>')
