// Types for ./checks.mjs.
import type { Kit } from './kit.mjs'

export type KitCheckStatus = 'pass' | 'fail' | 'warn' | 'look' | 'listen' | 'na'

export interface KitCheckResult {
  id: string
  section: string
  text: string
  type: string
  status: KitCheckStatus
  detail: string
  ranges: Array<{ startFrame: number; endFrame: number }>
}

export interface KitScorecard {
  creator: string | null
  kitVersion: string
  checks: KitCheckResult[]
  summary: Record<KitCheckStatus, number>
}

/** A dumpLayout entry: the item's drawn box, and for text the laid-out lines. */
export interface KitLayoutEntry {
  id: string
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  textLayout?: {
    box: { x: number; y: number; width: number; height: number }
    lines: Array<{ text: string; x: number; y: number; width: number; height: number }>
    background?: { x: number; y: number; width: number; height: number; radius: number }
    lineBackgrounds?: Array<{ x: number; y: number; width: number; height: number; radius: number }>
  }
}

interface KitProject {
  metadata?: { fps?: number; width?: number; height?: number }
  format?: { id: string; variant?: string }
  timeline?: { tracks: unknown[]; items: unknown[]; transitions?: unknown[] }
}

export function scoreKit(
  project: KitProject,
  kit: Kit,
  options?: {
    layouts?: Map<string, KitLayoutEntry> | Record<string, KitLayoutEntry>
    mediaById?: Record<string, { category?: string; mimeType?: string } | undefined>
  },
): KitScorecard
export function kitLayoutItems(
  project: KitProject,
  options?: { mediaById?: Record<string, { category?: string } | undefined> },
): Array<{ id: string; from: number; durationInFrames: number }>
