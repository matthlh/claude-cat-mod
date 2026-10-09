// The terminal lane's Raster cells, decoded for the tests: base64 of
// little-endian u32 triples [char, fg, bg], one per cell.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** The terminal raster back into a flat list of [char, fg, bg] cells. */
export function decodeCells(s: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < s.length; i += 4) {
    const n = (B64.indexOf(s.charAt(i)) << 18) | (B64.indexOf(s.charAt(i + 1)) << 12) | ((B64.indexOf(s.charAt(i + 2)) & 63) << 6) | (B64.indexOf(s.charAt(i + 3)) & 63)
    bytes.push((n >> 16) & 255)
    if (s[i + 2] !== '=') bytes.push((n >> 8) & 255)
    if (s[i + 3] !== '=') bytes.push(n & 255)
  }
  const out: number[] = []
  const at = (i: number) => bytes[i] ?? 0
  for (let i = 0; i + 3 < bytes.length; i += 4) out.push((at(i) | (at(i + 1) << 8) | (at(i + 2) << 16) | (at(i + 3) << 24)) >>> 0)
  return out
}

/** The raster as sprite pixels: [x, y, colour] for each half cell drawn. */
export function pixelsOf(cells: string, cols: number): [number, number, number][] {
  const c = decodeCells(cells)
  const out: [number, number, number][] = []
  for (let i = 0; i < c.length / 3; i++) {
    const [ch = 0, fg = 0, bg = 0] = c.slice(i * 3, i * 3 + 3)
    const x = i % cols
    const y = Math.floor(i / cols) * 2
    if (ch === 0x2580) out.push([x, y, fg], [x, y + 1, bg])
    if (ch === 0x2584) out.push([x, y + 1, fg])
  }
  return out
}
