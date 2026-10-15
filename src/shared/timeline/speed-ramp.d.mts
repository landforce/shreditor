// Types for ./speed-ramp.mjs (shared by the editor, the agent service and the scorecard).

import type { EasingConfig, EasingType } from '@/types/keyframe'

/** One key of a clip's speed curve. `frame` is clip-local timeline frames. */
export interface SpeedRampKey {
  frame: number
  speed: number
  /** How the speed moves to the next key (default linear). */
  easing?: EasingType
  easingConfig?: EasingConfig
  /** Stable id (the editor's speed keyframe lane uses it). */
  id?: string
}

export type SpeedRampPreset = 'ease-in' | 'ease-out' | 'hero' | 'whip'

export interface SpeedRampPresetOptions {
  durationInFrames: number
  frame?: number
  speed?: number
  baseSpeed?: number
  startSpeed?: number
  endSpeed?: number
  holdFrames?: number
  rampFrames?: number
}

/** What the time map reads from an item. */
export interface SpeedRampTimedItem {
  speed?: number
  speedRamp?: readonly SpeedRampKey[]
  sourceFps?: number
  durationInFrames?: number
}

export const MIN_SPEED: number
export const MAX_SPEED: number
export const DEFAULT_SPEED: number
export const SPEED_RAMP_PRESETS: readonly SpeedRampPreset[]

export function easeProgress(t: number, easing?: EasingType, easingConfig?: EasingConfig): number
export function clampSpeed(speed: number): number
export function getSpeedRamp(item: SpeedRampTimedItem | null | undefined): readonly SpeedRampKey[] | null
export function hasSpeedRamp(item: SpeedRampTimedItem | null | undefined): boolean
export function normalizeSpeedRamp(keys: readonly SpeedRampKey[] | null | undefined): SpeedRampKey[]
export function speedRampKeysProblem(keys: unknown, durationInFrames: number): string | null
export function pruneSpeedRamp(keys: readonly SpeedRampKey[], durationInFrames: number): SpeedRampKey[]
export function shiftSpeedRamp(keys: readonly SpeedRampKey[], delta: number): SpeedRampKey[]
export function scaleSpeedRamp(
  keys: readonly SpeedRampKey[],
  frameScale: number,
  speedScale: number,
): SpeedRampKey[]
export function sameSpeedRamp(
  a: readonly SpeedRampKey[] | null | undefined,
  b: readonly SpeedRampKey[] | null | undefined,
): boolean
export function speedAtFrame(keys: readonly SpeedRampKey[], frame: number): number
export function speedRampIntegral(keys: readonly SpeedRampKey[]): {
  at(frame: number): number
  inverse(value: number): number
}
export function itemSpeedAt(item: SpeedRampTimedItem, localFrame: number): number
export function sourceFramesAtLocalFrame(
  item: SpeedRampTimedItem,
  localFrame: number,
  fps: number,
): number
export function localFrameAtSourceFrames(
  item: SpeedRampTimedItem,
  sourceFrames: number,
  fps: number,
): number
export function sourceSpanFrames(
  item: SpeedRampTimedItem,
  fps: number,
  durationInFrames?: number,
): number
export function sourceFramesBetween(
  item: SpeedRampTimedItem,
  startFrame: number,
  endFrame: number,
  fps: number,
): number
export function speedRange(item: SpeedRampTimedItem): { min: number; max: number }
export function maxDurationForMedia(
  item: SpeedRampTimedItem,
  sourceStart: number,
  sourceDuration: number,
  fps: number,
): number
export function speedRampPreset(name: string, options: SpeedRampPresetOptions): SpeedRampKey[]
export function joinedSpeedRamp(
  left: SpeedRampTimedItem & { durationInFrames: number },
  right: SpeedRampTimedItem & { durationInFrames: number },
): SpeedRampKey[] | null | undefined
