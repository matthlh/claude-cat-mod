import sys, os, base64
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGBA')
W, H = im.size
COLS, ROWS, SIZE = 7, 2, int(os.environ.get("SIZE", "96"))
cw, rh = W / COLS, H / ROWS
# white -> transparent, with a soft edge for near-white
px = im.load()
for y in range(H):
    for x in range(W):
        r, g, b, a = px[x, y]
        if a < 24: px[x, y] = (0, 0, 0, 0)
cells = []
for row in range(ROWS):
    for col in range(COLS):
        box = (int(col * cw), int(row * rh), int((col + 1) * cw), int((row + 1) * rh))
        cell = im.crop(box)
        # keep the main block of columns around the centre; drop slivers of
        # a neighbour that spilled across the grid line
        A = cell.getchannel('A')
        cols = [sum(A.getpixel((x, y)) for y in range(A.height)) for x in range(A.width)]
        peak = max(cols) or 1
        mid = A.width // 2
        lo = mid
        while lo > 0 and cols[lo - 1] > peak * 0.02: lo -= 1
        hi = mid
        while hi < A.width - 1 and cols[hi + 1] > peak * 0.02: hi += 1
        cell = cell.crop((lo, 0, hi + 1, A.height))
        bbox = cell.getchannel('A').getbbox()
        cells.append(cell.crop(bbox) if bbox else cell)
# one scale for every frame, so the character stays the same size
maxw = max(c.width for c in cells); maxh = max(c.height for c in cells)
scale = (SIZE - 4) / max(maxw, maxh)
# the body sits on the same baseline: align bottoms, centre horizontally
frames = []
for i, c in enumerate(cells):
    w, h = max(1, round(c.width * scale)), max(1, round(c.height * scale))
    small = c.resize((w, h), Image.LANCZOS)
    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(small, ((SIZE - w) // 2, SIZE - 2 - h), small)
    q = canvas.quantize(colors=48, method=Image.Quantize.FASTOCTREE, dither=0).convert('RGBA')
    # quantize loses alpha fidelity; restore the original alpha
    q.putalpha(canvas.getchannel('A'))
    q = q.quantize(colors=64, method=Image.Quantize.FASTOCTREE, dither=0)
    path = os.path.join(out, f'f{i:02d}.png')
    q.save(path, optimize=True)
    frames.append(path)
    print(i, c.size, os.path.getsize(path))
print('total', sum(os.path.getsize(p) for p in frames))
sheet = Image.new('RGBA', (SIZE * 7, SIZE * 2), (42, 42, 46, 255))
for i, p in enumerate(frames):
    sheet.paste(Image.open(p).convert('RGBA'), ((i % 7) * SIZE, (i // 7) * SIZE))
sheet.resize((SIZE * 7 * 2, SIZE * 2 * 2), Image.NEAREST).save(os.path.join(out, 'contact.png'))
names = ['idle', 'eyesClosed', 'lookUp', 'blink', 'typing', 'thinking', 'sleep1', 'sleep2', 'oops', 'cheer1', 'cheer2', 'overclock1', 'overclock2', 'hit']
lines = ['// The character frames: 96×96 PNGs sliced from docs/sheet.webp by docs/slice.py.', '// Index order: ' + ', '.join(f'{i} {n}' for i, n in enumerate(names)), 'export const FRAME_SIZE = 96', 'export const FRAMES: string[] = [']
for p in frames:
    lines.append("  '" + base64.b64encode(open(p, 'rb').read()).decode() + "',")
lines.append(']')
open(sys.argv[3], 'w').write('\n'.join(lines) + '\n')
print('frames.ts chars', sum(len(l) for l in lines))
