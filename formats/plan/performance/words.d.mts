// Types for ./words.mjs.

export interface TranscriptWord {
  text: string
  /** Source seconds. */
  start: number
  end: number
}

export function tokens(text: unknown): string[]
export function wordsIn(
  words: TranscriptWord[] | null | undefined,
  inSec: number,
  outSec: number,
): TranscriptWord[]
export const joinText: (words: Array<{ text?: string }>) => string
export function commonLength(a: string[], b: string[]): number
export function similarity(a: string, b: string): number
export function findPhrase(
  words: TranscriptWord[],
  phrase: string,
): { first: number; last: number } | null
