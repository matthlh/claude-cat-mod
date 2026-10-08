export type Mood = 'idle' | 'sit' | 'working' | 'done' | 'oops' | 'sleep' | 'tired' | 'pet'

export type Cat = {
  mood: Mood
  /** which way the cat last faced: 1 right, -1 left */
  dir: 1 | -1
  say: string | null
  /** when the current line started, in ms, for the typewriter reveal */
  sayAt?: number
  /** when it last woke from a proper sleep, so the bed can slide away */
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
  /** what the hero is up to on this leg; absent is a plain walk or pause */
  activity?: Activity
  /** a repeating activity: how many more legs of it follow this one */
  chain?: number
  /** whether this leg ends in a catch (an activity with a hit chance: the cat's fishing) */
  hit?: boolean
}

/**
 * An activity id from the active pack (hooks/packs/<pack>/), or one of
 * bedtime's two legs: 'bed' (walking to the bed) and 'perch' (asleep in it).
 */
export type Activity = string

export type Limits = {
  fiveHour: number | null
  sevenDay: number | null
  context: number | null
  fiveHourResets: string | null
}

export type Speed = 'chill' | 'normal' | 'zoomies'

/** A registered pack's id: 'cat', or another folder under hooks/packs. */
export type PackId = string
/** Ids from the active pack: a key of its coats, scenes, hats ('none' for bare) and markings. */
export type Coat = string
export type Scene = string
export type Hat = string
export type Marking = string

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
  /** absent in prefs saved before packs: loads as the cat */
  pack: PackId
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
