/**
 * Track heights are a local view preference, not project data.
 *
 * Two localStorage keys back them: the global Track Size preset
 * (`editor:trackSizePreset`, owned by the editor store) supplies the base row
 * height, and `editor:trackHeights:<projectId>` holds per-track overrides for
 * tracks the user has dragged to a custom height. `items-store.setTracks()`
 * re-derives `TimelineTrack.height` from these on every write, so the height
 * stored in a project file is ignored.
 *
 * Overrides are held in memory and flushed to localStorage on a short debounce
 * so a drag gesture doesn't write once per mousemove.
 */
import { useEditorStore } from '@/shared/state/editor'
import { isConciseWorkspace } from '@/config/editor-workspaces'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { TRACK_SIZE_PRESET_HEIGHTS } from '../constants'
import { clampTrackHeight } from './track-resize'
import { getTrackKind } from './classic-tracks'

/** Lane heights in the Concise workspace, keyed by what the track holds. */
export const CONCISE_TRACK_HEIGHTS = {
  video: 80,
  audio: 40,
  text: 28,
  empty: 20,
} as const

const OVERRIDES_KEY_PREFIX = 'editor:trackHeights:'
const PERSIST_DEBOUNCE_MS = 250

let activeProjectId: string | null = null
let overrides = new Map<string, number>()
let persistTimer: ReturnType<typeof setTimeout> | null = null

function storageKey(projectId: string): string {
  return `${OVERRIDES_KEY_PREFIX}${projectId}`
}

function writeOverrides(): void {
  if (!activeProjectId) return
  try {
    if (overrides.size === 0) {
      localStorage.removeItem(storageKey(activeProjectId))
      return
    }
    localStorage.setItem(storageKey(activeProjectId), JSON.stringify(Object.fromEntries(overrides)))
  } catch {
    /* noop */
  }
}

function schedulePersist(): void {
  if (persistTimer !== null) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    writeOverrides()
  }, PERSIST_DEBOUNCE_MS)
}

/** Write any pending overrides immediately (end of a resize gesture). */
export function flushTrackHeightOverrides(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  writeOverrides()
}

/** Base row height for tracks with no override, from the saved Track Size preset. */
export function getPresetTrackHeight(): number {
  return TRACK_SIZE_PRESET_HEIGHTS[useEditorStore.getState().trackSizePreset]
}

/** Concise lane height from what the track holds: video 80, audio 40, text-only 28, empty 20. */
export function getConciseTrackHeight(
  track: Pick<TimelineTrack, 'name' | 'kind'>,
  items: readonly Pick<TimelineItem, 'type'>[] | undefined,
): number {
  if (!items || items.length === 0) return CONCISE_TRACK_HEIGHTS.empty
  if (items.every((item) => item.type === 'text' || item.type === 'subtitle')) {
    return CONCISE_TRACK_HEIGHTS.text
  }
  return getTrackKind(track as TimelineTrack) === 'audio' ||
    items.every((item) => item.type === 'audio')
    ? CONCISE_TRACK_HEIGHTS.audio
    : CONCISE_TRACK_HEIGHTS.video
}

/**
 * Row height for a track: a per-track override wins; otherwise the Track Size
 * preset, or per-kind heights in the Concise workspace (pass the track and its
 * items so the kind can be read).
 */
export function resolveTrackHeight(
  trackId: string,
  track?: Pick<TimelineTrack, 'name' | 'kind'>,
  items?: readonly Pick<TimelineItem, 'type'>[],
): number {
  const override = overrides.get(trackId)
  if (override !== undefined) return override
  if (track && isConciseWorkspace(useEditorStore.getState().workspace)) {
    return getConciseTrackHeight(track, items)
  }
  return getPresetTrackHeight()
}

/** Swap the override set to the given project. Flushes the outgoing project first. */
export function loadTrackHeightOverrides(projectId: string): void {
  flushTrackHeightOverrides()
  activeProjectId = projectId
  overrides = new Map()

  try {
    const raw = localStorage.getItem(storageKey(projectId))
    if (!raw) return

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return

    for (const [trackId, height] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof height === 'number' && Number.isFinite(height)) {
        overrides.set(trackId, clampTrackHeight(height))
      }
    }
  } catch {
    /* noop */
  }
}

/**
 * Record a custom height for one track. A height equal to the current preset is
 * stored as "no override" so a later preset change still moves the track.
 */
export function setTrackHeightOverride(trackId: string, height: number): void {
  const clamped = clampTrackHeight(height)
  if (clamped === getPresetTrackHeight()) {
    overrides.delete(trackId)
  } else {
    overrides.set(trackId, clamped)
  }
  schedulePersist()
}

export function clearTrackHeightOverride(trackId: string): void {
  if (!overrides.delete(trackId)) return
  schedulePersist()
}

export function clearAllTrackHeightOverrides(): void {
  if (overrides.size === 0) return
  overrides.clear()
  schedulePersist()
}
