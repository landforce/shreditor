import { describe, expect, it } from 'vite-plus/test'
import { createFormatTracks, resolveFormat } from '@formats/registry.mjs'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { addMissingFormatTracks, findMissingFormatTracks } from './format-tracks'

const layout = (id: string) => createFormatTracks(id) as unknown as TimelineTrack[]

describe('findMissingFormatTracks', () => {
  it('finds nothing missing on the format’s own layout', () => {
    expect(findMissingFormatTracks(layout('vlog'), resolveFormat('vlog'))).toEqual([])
  })

  it('lists the layout entries another format lacks', () => {
    const missing = findMissingFormatTracks(layout('graphic-yap'), resolveFormat('greenscreen'))
    expect(missing.map((entry) => entry.name)).toEqual(['Plates'])
  })

  it('matches by role and kind, so plain V1/A1 tracks satisfy nothing', () => {
    const plain = [
      { id: 'track-1', name: 'V1', kind: 'video', order: 0 },
      { id: 'track-2', name: 'A1', kind: 'audio', order: 1 },
    ] as TimelineTrack[]
    expect(findMissingFormatTracks(plain, resolveFormat('ten-shot'))).toHaveLength(4)
  })
})

describe('addMissingFormatTracks', () => {
  it('adds the missing tracks next to their layout neighbours and keeps everything else', () => {
    const item = { id: 'clip-1', trackId: 'track-images' } as TimelineItem
    const before = layout('graphic-yap').map((track) =>
      track.id === 'track-images' ? { ...track, items: [item], locked: true } : track,
    )

    const { tracks, added } = addMissingFormatTracks(before, resolveFormat('greenscreen'))

    expect(added.map((track) => [track.name, track.formatRole, track.kind])).toEqual([
      ['Plates', 'plates', 'video'],
    ])
    // Nothing removed, existing tracks keep ids, settings and items.
    for (const old of before) {
      const kept = tracks.find((track) => track.id === old.id)
      expect(kept).toMatchObject({ name: old.name, locked: old.locked, items: old.items })
    }
    // Plates goes under Speaker (its layout predecessor), above the audio.
    expect(tracks.map((track) => track.name)).toEqual([
      'Title',
      'Captions',
      'Images',
      'Speaker',
      'Plates',
      'Speaker audio',
      'Music',
    ])
    expect(tracks.map((track) => track.order)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('keeps video tracks above audio tracks', () => {
    const fromGreenscreen = addMissingFormatTracks(layout('greenscreen'), resolveFormat('vlog'))
    expect(fromGreenscreen.tracks.map((track) => track.name)).toEqual([
      'Title',
      'Captions',
      'B-roll',
      'Speaker',
      'Plates',
      'Voiceover',
      'Music',
      'SFX',
      'Speaker audio',
    ])

    const plain = [
      { id: 'track-1', name: 'V1', kind: 'video', order: 0, height: 80 },
      { id: 'track-2', name: 'A1', kind: 'audio', order: 1, height: 80 },
    ] as TimelineTrack[]
    const fromPlain = addMissingFormatTracks(plain, resolveFormat('ten-shot'))
    expect(fromPlain.tracks.map((track) => track.name)).toEqual([
      'Title',
      'Labels',
      'Shots',
      'V1',
      'Music',
      'A1',
    ])
    // Text tracks are slim; the rest match the project's track height.
    expect(fromPlain.added.map((track) => [track.name, track.height])).toEqual([
      ['Title', 48],
      ['Labels', 48],
      ['Shots', 80],
      ['Music', 80],
    ])
  })

  it('gives added tracks unique ids', () => {
    const taken = [
      { ...layout('vlog')[0]!, id: 'track-plates', name: 'Odd', formatRole: undefined },
    ]
    const { added } = addMissingFormatTracks(taken, resolveFormat('greenscreen'))
    const plates = added.find((track) => track.formatRole === 'plates')!
    expect(plates.id).toBe('track-plates-2')
  })

  it('returns the same tracks when nothing is missing', () => {
    const tracks = layout('ten-shot')
    expect(addMissingFormatTracks(tracks, resolveFormat('ten-shot'))).toEqual({ tracks, added: [] })
  })
})
