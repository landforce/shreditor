import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { useEditorStore } from '@/shared/state/editor'
import { COMPACT_TRACK_HEIGHT, DEFAULT_TRACK_HEIGHT, MAX_TRACK_HEIGHT } from '../constants'
import {
  CONCISE_TRACK_HEIGHTS,
  getConciseTrackHeight,
  clearAllTrackHeightOverrides,
  clearTrackHeightOverride,
  flushTrackHeightOverrides,
  loadTrackHeightOverrides,
  resolveTrackHeight,
  setTrackHeightOverride,
} from './track-heights'

describe('track-heights', () => {
  beforeEach(() => {
    localStorage.clear()
    clearAllTrackHeightOverrides()
    useEditorStore.getState().setTrackSizePreset('medium')
    loadTrackHeightOverrides('project-a')
  })

  it('falls back to the preset for tracks with no override', () => {
    expect(resolveTrackHeight('v1')).toBe(DEFAULT_TRACK_HEIGHT)

    useEditorStore.getState().setTrackSizePreset('compact')
    expect(resolveTrackHeight('v1')).toBe(COMPACT_TRACK_HEIGHT)
  })

  it('clamps overrides into the supported range', () => {
    setTrackHeightOverride('v1', MAX_TRACK_HEIGHT + 500)
    expect(resolveTrackHeight('v1')).toBe(MAX_TRACK_HEIGHT)
  })

  it('does not store an override equal to the preset, so a preset change still moves the track', () => {
    setTrackHeightOverride('v1', DEFAULT_TRACK_HEIGHT)
    useEditorStore.getState().setTrackSizePreset('large')

    expect(resolveTrackHeight('v1')).toBe(MAX_TRACK_HEIGHT)
  })

  it('keeps a real override pinned across preset changes until cleared', () => {
    setTrackHeightOverride('v1', 88)
    useEditorStore.getState().setTrackSizePreset('large')
    expect(resolveTrackHeight('v1')).toBe(88)

    clearTrackHeightOverride('v1')
    expect(resolveTrackHeight('v1')).toBe(MAX_TRACK_HEIGHT)
  })

  it('scopes overrides per project and restores them on reload', () => {
    setTrackHeightOverride('track-1', 88)
    flushTrackHeightOverrides()

    // Default track ids collide across projects, so project B must not inherit.
    loadTrackHeightOverrides('project-b')
    expect(resolveTrackHeight('track-1')).toBe(DEFAULT_TRACK_HEIGHT)

    loadTrackHeightOverrides('project-a')
    expect(resolveTrackHeight('track-1')).toBe(88)
  })

  it('flushes pending overrides before switching projects', () => {
    setTrackHeightOverride('track-1', 120)
    // No explicit flush: switching projects must not lose the debounced write.
    loadTrackHeightOverrides('project-b')
    loadTrackHeightOverrides('project-a')

    expect(resolveTrackHeight('track-1')).toBe(120)
  })
})

describe('concise track heights', () => {
  beforeEach(() => {
    localStorage.clear()
    clearAllTrackHeightOverrides()
    loadTrackHeightOverrides('project-concise')
    useEditorStore.setState({ workspace: 'concise' })
  })

  afterEach(() => {
    useEditorStore.setState({ workspace: 'edit' })
  })

  const video = { name: 'V1', kind: 'video' as const }
  const audio = { name: 'A1', kind: 'audio' as const }

  it('sizes lanes by what they hold', () => {
    expect(getConciseTrackHeight(video, [{ type: 'video' }])).toBe(80)
    expect(getConciseTrackHeight(audio, [{ type: 'audio' }])).toBe(40)
    expect(getConciseTrackHeight(video, [{ type: 'text' }, { type: 'subtitle' }])).toBe(28)
    expect(getConciseTrackHeight(video, [])).toBe(20)
    expect(getConciseTrackHeight(video, undefined)).toBe(20)
    expect(CONCISE_TRACK_HEIGHTS).toEqual({ video: 80, audio: 40, text: 28, empty: 20 })
  })

  it('uses the concise height only in the concise workspace', () => {
    expect(resolveTrackHeight('v1', video, [{ type: 'video' }])).toBe(80)

    useEditorStore.setState({ workspace: 'edit' })
    expect(resolveTrackHeight('v1', video, [{ type: 'video' }])).toBe(DEFAULT_TRACK_HEIGHT)
  })

  it('still honours a per-track override', () => {
    setTrackHeightOverride('v1', 120)
    expect(resolveTrackHeight('v1', video, [{ type: 'video' }])).toBe(120)
  })
})
