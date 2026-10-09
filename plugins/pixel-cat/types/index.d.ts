export type Mood = 'idle' | 'sit' | 'working' | 'done' | 'oops' | 'sleep' | 'tired' | 'pet'

/** The hero's state, whichever pack draws it. */
export type HeroState = {
  mood: Mood
  /** which way the hero last faced: 1 right, -1 left */
  dir: 1 | -1
  say: string | null
  /** when the current line started, in ms, for the typewriter reveal */
  sayAt?: number
  /** when it last woke from a proper sleep, so the bed can slide away */
  wokeAt?: number
  /** what it's working with while Claude runs a tool */
  prop?: ToolProp | null
}

/** The name it had before packs; still the state's key ('cat') and the tests' name for it. */
export type Cat = HeroState

export type ToolProp = 'read' | 'edit' | 'bash' | 'search'

/** The time of day: night 21:00-4:59, dawn 5-6, dusk 18-20, day the rest (hooks/engine/time.ts). */
export type Phase = 'night' | 'dawn' | 'day' | 'dusk'

/**
 * One leg of the hero's walk: from one spot to another (0 = left end of the
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
  /** whether this leg ends in a hit: rolled from the activity's `hit` chance, on any leg */
  hit?: boolean
  /**
   * The time of day this run of legs began in: set when a leg is picked
   * fresh, and carried into its follow-ups and repeats, so a sequence (a
   * fight and its finish) keeps one time of day even across 21:00.
   */
  phase?: Phase
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

/** Rolled once per install and kept: what makes this hero yours, in every pack. */
export type Identity = {
  marking: Marking
  shiny: boolean
}

/** Lifetime counts that unlock hats. */
export type Stats = {
  turns: number
  tools: number
}

/** One pack's look, remembered while another pack is on. */
export type Look = {
  coat: Coat
  scene: Scene
  hat: Hat
}

/**
 * Where the ↻ switcher stands: this mod's hero (whichever pack), Token
 * Tycoon's turn (this mod draws nothing), or off (only the strip that brings
 * the next one back).
 */
export type Mode = 'hero' | 'tycoon' | 'off'

export type Prefs = {
  /** absent in prefs saved before packs: loads as the 'cat' pack */
  pack: PackId
  /** absent in prefs saved before the switcher: 'hero' */
  mode?: Mode
  coat: Coat
  speed: Speed
  scene: Scene
  popups: boolean
  showUsage: boolean
  hat: Hat
  /** each other pack's look, by pack id, as it was when the hero left it (absent until a switch) */
  looks?: Record<PackId, Look>
}

/**
 * One follower: an agent of this session that is working (a subagent or a
 * teammate; a workflow's agents are not listed), drawn trailing the hero as
 * the pack's Pack.crew. Session state only, never written to the store.
 */
export type Follower = {
  /** the agent's id, as $.agent.list() gives it */
  id: string
  /** its place in the line, 0 nearest the hero: kept while its agent works, so nobody reshuffles */
  slot: number
  /** when it joined, or came back, in ms */
  since: number
  /** when its agent stopped working, in ms: it hops, then goes in a poof */
  leavingAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'pixel-cat': {
      /** the hero's state; the key keeps its old name so nothing saved or hooked moves */
      cat: HeroState
      motion: Motion
      limits: Limits
      isHidden: boolean
      prefs: Prefs
      isSettingsOpen: boolean
      identity: Identity
      stats: Stats
      /** this session's working agents, by slot (engine/crew.ts muster) */
      crew: Follower[]
    }
  }
}
