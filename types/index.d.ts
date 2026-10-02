export type Mood = 'idle' | 'sit' | 'working' | 'done' | 'oops' | 'sleep' | 'tired' | 'pet'

export type Cat = {
  mood: Mood
  x: number
  dir: 1 | -1
  frame: number
  say: string | null
}

export type Limits = {
  fiveHour: number | null
  sevenDay: number | null
  context: number | null
  fiveHourResets: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'claude-cat': { cat: Cat; limits: Limits; isHidden: boolean }
  }
}
