export type Mood = 'idle' | 'sit' | 'working' | 'done' | 'oops' | 'sleep' | 'tired' | 'pet'

export type Cat = {
  mood: Mood
  /** which way the cat last faced: 1 right, -1 left */
  dir: 1 | -1
  say: string | null
  /** when the current line started, in ms, for the typewriter reveal */
  sayAt?: number
  /** when it last woke from a proper sleep, so the perch can slide away */
  wokeAt?: number
  /** what it's working with while Claude runs a tool */
  prop?: ToolProp | null
}

export type ToolProp = 'read' | 'edit' | 'bash' | 'search'

/**
 * One leg of the cat's walk: from one spot to another (0 = left end of the
 * lane, 1 = right end), starting at t0 and taking dur ms; from === to is a
 * pause. Both surfaces interpolate it, so the hooks write it once per leg.
 */
export type Motion = {
  from: number
  to: number
  t0: number
  dur: number
  /** what the cat is up to on this leg; absent is a plain walk or pause */
  activity?: Activity
  /** laser: how many more zips follow this one */
  chain?: number
  /** fish: whether this fishing trip ends with a catch */
  hit?: boolean
}

export type Activity =
  | 'walk' | 'sit' | 'groom' | 'nap' | 'hop' | 'yarn' | 'mouse' | 'butterfly'
  | 'caught' | 'bird' | 'flyaway' | 'fish' | 'laser'
  // bedtime: walking to the perch, then asleep on it
  | 'bed' | 'perch'
  // while Claude runs a tool: sitting with a book, laptop, terminal or magnifier
  | 'busy'
  // mischief: walk to a mug and knock it off its table; sit on the usage stats
  | 'knock' | 'shove' | 'meter' | 'sitmeter'

export type Limits = {
  fiveHour: number | null
  sevenDay: number | null
  context: number | null
  fiveHourResets: string | null
}

export type Coat = 'orange' | 'tuxedo' | 'black' | 'grey' | 'cream' | 'sakura'
export type Speed = 'chill' | 'normal' | 'zoomies'
export type Scene = 'clear' | 'grass' | 'night' | 'cozy'

export type Hat = 'none' | 'party' | 'beanie' | 'wizard' | 'crown'
export type Marking = 'none' | 'blaze' | 'socks' | 'tip' | 'spot'

/** Rolled once per install and kept: what makes this cat yours. */
export type Identity = {
  marking: Marking
  shiny: boolean
}

/** Lifetime counts that unlock hats. */
export type Stats = {
  turns: number
  tools: number
}

export type Prefs = {
  coat: Coat
  speed: Speed
  scene: Scene
  popups: boolean
  showUsage: boolean
  hat: Hat
}

declare module 'claude-code' {
  interface PluginState {
    'pixel-cat': {
      cat: Cat
      motion: Motion
      limits: Limits
      isHidden: boolean
      prefs: Prefs
      isSettingsOpen: boolean
      identity: Identity
      stats: Stats
    }
  }
}
