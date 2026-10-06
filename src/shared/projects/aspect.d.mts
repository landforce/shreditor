// Types for ./aspect.mjs (shared by the editor and the agent tools).

/** "9:16", "16:9", "1:1", "4:5", or a reduced "W:H". */
export type AspectKey = string

export const NAMED_ASPECTS: readonly AspectKey[]
export function aspectRatio(key: AspectKey): number
export function aspectKey(width: number, height: number): AspectKey
export function parseAspect(text: string): AspectKey
export function closestAspect(
  target: AspectKey,
  candidates: Iterable<AspectKey> | null | undefined,
): AspectKey | null
export function sortAspects(keys: Iterable<AspectKey>): AspectKey[]
export function canvasForAspect(
  key: AspectKey,
  shortSide: number,
): { width: number; height: number }
