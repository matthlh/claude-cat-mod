export type Mood = 'idle' | 'sit' | 'working' | 'done' | 'oops' | 'sleep' | 'tired' | 'pet'

export type Cat = {
  mood: Mood
  /** which way the cat last faced: 1 right, -1 left */
  dir: 1 | -1
  say: string | null
  /** when the current line started, in ms, for the typewriter reveal */
  sayAt?: number
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
}

export type Activity = 'walk' | 'sit' | 'nap' | 'hop' | 'yarn' | 'mouse' | 'butterfly'

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
