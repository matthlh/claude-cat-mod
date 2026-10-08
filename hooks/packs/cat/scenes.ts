import { LANE_H as H, TERMINAL_DEFAULT } from '../../engine/geometry'
import type { Scene } from '../types'
import { BOWL, RIVER, TANK } from './critters'
import type { Spot } from './critters'

// Desktop: a backdrop drawn behind the cat, in percent so it fills any width.
// Time of day: a tint over the sky, by local hour.
function skyAt(hour: number): { color: string; tint: number; isNight: boolean } {
  if (hour >= 21 || hour < 5) return { color: '#1b2547', tint: 0.45, isNight: true }
  if (hour < 7) return { color: '#f6b4a5', tint: 0.14, isNight: false }
  if (hour >= 18) return { color: '#f39a5b', tint: 0.14, isNight: false }
  return { color: '#9fd3ff', tint: 0, isNight: false }
}

function starsSvg(spots: number[][], opacity: number): string {
  return spots
    .map(([p, y], i) => `<circle cx="${p}%" cy="${y}" r="0.9" fill="#e8e6ff" opacity="${opacity}"><animate attributeName="opacity" values="${opacity};0.15;${opacity}" dur="${2 + (i % 3)}s" begin="${i * 0.37}s" repeatCount="indefinite"/></circle>`)
    .join('')
}

// A cat scene also brings the spot the cat fishes at, so a scene is all in
// one place and one without a spot does not type.
export type CatScene = Scene & { spot: Spot }

// Each scene's bed is where the cat sleeps. Hidden until bedtime, when it
// slides in from the left; `float` lifts it off the ground (the night cloud).
export const SCENES: Record<string, CatScene> = {
  clear: {
    label: 'Clear',
    bg: TERMINAL_DEFAULT,
    bed: {
      rows: ['.cccccccccccccc.', 'cCCCCCCCCCCCCCCc', 'cccccccccccccccc', '.cccccccccccccc.'],
      pal: { c: 0x6f63c9, C: 0xb3a9f0 },
      float: 0,
    },
    spot: BOWL,
    backdrop: hour => (skyAt(hour).isNight ? starsSvg([[12, 6], [38, 10], [63, 5], [88, 9]], 0.5) : ''),
  },
  grass: {
    label: 'Grass',
    bg: 0x14301c,
    bed: {
      rows: ['.SSSSSSSSSS.', 'TTTTTTTTTTTT', '.TTtTTTTtTT.', '.TTTTtTTTTT.', 'TTTTTTTTTTTT'],
      pal: { S: 0xc79a6b, T: 0x7a5234, t: 0x5b3a22 },
      float: 0,
    },
    spot: RIVER,
    backdrop: hour => {
      const sky = skyAt(hour)
      const tint = sky.tint ? `<rect x="0" y="0" width="100%" height="${H}" rx="6" fill="${sky.color}" opacity="${sky.tint}"/>` : ''
      const stars = sky.isNight ? starsSvg([[8, 6], [27, 12], [46, 5], [70, 9], [91, 6]], 0.8) : ''
      const tufts = [6, 19, 33, 47, 61, 74, 88]
        .map(p => `<svg x="${p}%" y="${H - 11}" overflow="visible"><path d="M0 6 l2 -5 l1 5 l2 -6 l1 6" fill="none" stroke="#4f9a5a" stroke-width="1.2"/></svg>`)
        .join('')
      return `${tint}${stars}<rect x="0" y="${H - 5}" width="100%" height="5" rx="2" fill="#2f6b3a"/>${tufts}`
    },
  },
  night: {
    label: 'Night',
    bg: 0x10162a,
    bed: {
      rows: ['...LLL....LL....', '.LLLLLLLLLLLLL..', 'LLLLLLLLLLLLLLLL', '.llllllllllllll.'],
      pal: { L: 0xe6e9f7, l: 0xaab1cf },
      float: 5,
    },
    spot: RIVER,
    backdrop: () => {
      const stars = [[4, 6], [13, 18], [22, 5], [37, 11], [51, 4], [63, 16], [71, 7], [83, 13], [95, 5]]
        .map(([p, y], i) => `<circle cx="${p}%" cy="${y}" r="0.9" fill="#e8e6ff"><animate attributeName="opacity" values="1;0.2;1" dur="${2 + (i % 3)}s" begin="${i * 0.37}s" repeatCount="indefinite"/></circle>`)
        .join('')
      return `<rect x="0" y="0" width="100%" height="${H}" rx="6" fill="#141a2e"/>${stars}<circle cx="92%" cy="9" r="5" fill="#f2e9c9"/><circle cx="91%" cy="8" r="5" fill="#141a2e" transform="translate(-3 -1)"/>`
    },
  },
  cozy: {
    label: 'Cozy',
    bg: 0x33261f,
    bed: {
      rows: ['PPPPPPPPPPPPPP', 'pppppppppppppp', '.....RRRR.....', '.....RrRR.....', '.....RRrR.....', '..pppppppppp..'],
      pal: { P: 0xc9876b, p: 0x9a5f49, R: 0xd9c08f, r: 0xb39a6a },
      float: 0,
    },
    spot: TANK,
    backdrop: hour => {
      // A window showing the sky outside, with the moon at night.
      const sky = skyAt(hour)
      const moon = sky.isNight ? '<circle cx="18" cy="7" r="2.5" fill="#f2e9c9"/>' : ''
      const window = `<svg x="28%" y="6" overflow="visible"><rect width="26" height="15" rx="2" fill="${sky.color}" stroke="#5a4334" stroke-width="2"/><line x1="13" y1="0" x2="13" y2="15" stroke="#5a4334" stroke-width="1.5"/>${moon}</svg>`
      return `<rect x="0" y="0" width="100%" height="${H}" rx="6" fill="#3a2c24"/>${window}<rect x="0" y="${H - 4}" width="100%" height="4" fill="#5a4334"/><rect x="70%" y="${H - 7}" width="18%" height="3" rx="1.5" fill="#a2554a" opacity="0.8"/>`
    },
  },
}
