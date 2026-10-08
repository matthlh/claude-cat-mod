// Lane geometry shared by every pack. The hero is a 12 x 10 sprite.

export const PX = 3 // CSS pixels per sprite pixel
export const HERO_COLS = 12
export const HERO_W = HERO_COLS * PX // 36
export const HERO_H = 30
// Room above the hero so hops and bounces don't clip its head.
export const HEADROOM = 12
export const LANE_H = HERO_H + HEADROOM
// Hats sit on the hero's head, in rows padded on above the sprite.
export const HAT_PAD = 4
// The desktop reports its width in monospace columns; the SVG wants pixels.
export const DESKTOP_PX_PER_COLUMN = 8.4
export const MAX_X = 85 // the hero's left edge travels 0%..85% of the lane
// Where the bed sits at bedtime, and how long it takes to slide in or out.
export const BED_X = 4
export const SLIDE_MS = 700
// Terminal: the lane is LANE_ROWS cells tall, two sprite pixels per cell.
export const LANE_ROWS = 5
export const LANE_PIX = LANE_ROWS * 2
// The terminal's own colour: a lane cell with no background of its own.
export const TERMINAL_DEFAULT = 0x01000000
