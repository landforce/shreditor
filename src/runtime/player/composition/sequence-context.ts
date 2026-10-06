import { createContext, useContext } from 'react'

export interface SequenceContextValue {
  from: number
  durationInFrames: number
  localFrame: number
  parentFrom: number
}

export const SequenceContext = createContext<SequenceContextValue | null>(null)

export function useSequenceContext(): SequenceContextValue | null {
  return useContext(SequenceContext)
}

/**
 * Maps the clock's absolute frame for a subtree before its Sequences read it: a
 * held motion template instance plays its composition on its own timing (in,
 * hold, out). Nested remaps compose (outer first).
 */
export type SequenceFrameRemap = (frame: number) => number

export const SequenceFrameRemapContext = createContext<SequenceFrameRemap | null>(null)

export function useSequenceFrameRemap(): SequenceFrameRemap | null {
  return useContext(SequenceFrameRemapContext)
}
