export type GenId = 'agent' | 'subagent' | 'robot' | 'swarm' | 'fleet' | 'lab'
export type ToolId = 'read' | 'edit' | 'bash' | 'grep' | 'web'

export type Save = {
  tokens: number
  earned: number
  lifetime: number
  clicks: number
  owned: Record<GenId, number>
  model: number
  infra: number
  tools: Record<ToolId, boolean>
  points: number
  trained: number
  bonusHits: number
  frenzies: number
  frenzyUntil: number
  played: number
  savedAt: number
}

export type FxKind = 'click' | 'free' | 'crit' | 'buy' | 'frenzy' | 'offline' | null
export type Fx = { at: number; gain: number; kind: FxKind }

export type Prefs = { popups: boolean }
export type Mood = 'idle' | 'working' | 'sleep' | 'oops'

declare module 'claude-code' {
  interface PluginState {
    'token-tycoon': { save: Save; fx: Fx; isHidden: boolean; prefs: Prefs; mood: Mood }
  }
}
