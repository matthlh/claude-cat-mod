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
}

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

export type Limits = {
  fiveHour: number | null
  sevenDay: number | null
  context: number | null
  fiveHourResets: string | null
}

export type Coat = 'orange' | 'tuxedo' | 'black' | 'grey' | 'cream' | 'sakura'
export type Speed = 'chill' | 'normal' | 'zoomies'
export type Scene = 'clear' | 'grass' | 'night' | 'cozy'

export type Prefs = {
  coat: Coat
  speed: Speed
  scene: Scene
  popups: boolean
  showUsage: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'claude-cat': {
      cat: Cat
      motion: Motion
      limits: Limits
      isHidden: boolean
      prefs: Prefs
      isSettingsOpen: boolean
    }
  }
}
