// Types for ./suggest.mjs.
import type { FormatId } from './registry.mjs'

export interface FootageEntry {
  kind?: 'video' | 'image' | 'audio'
  speech?: string | null
  alpha?: boolean
  /** Share (0-1) of strongly green pixels in a sampled frame; 0.25+ reads as green screen. */
  greenShare?: number
  category?: string
  error?: string
}

export interface FootageSignals {
  talkingHeads: number
  keyed: number
  voiceovers: number
  broll: number
  /** Photos, screenshots and graphics. */
  stills: number
  music: number
}

export function suggestFormat(entries: FootageEntry[]): {
  id: FormatId
  name: string
  reason: string
  alternatives: FormatId[]
  signals: FootageSignals
} | null
