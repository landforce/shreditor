import { describe, expect, it } from 'vitest'
import { detectBeats } from './beat-detection'

const SAMPLE_RATE = 44100

/** Seeded noise so the test is deterministic. */
function makeNoise(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0xffffffff - 0.5
  }
}

function clickTrack(bpm: number, seconds: number, firstClick = 0.2, noiseLevel = 0.02) {
  const data = new Float32Array(Math.floor(seconds * SAMPLE_RATE))
  const random = makeNoise(7)
  for (let i = 0; i < data.length; i++) data[i] = random() * noiseLevel
  const interval = 60 / bpm
  const clicks: number[] = []
  for (let t = firstClick; t < seconds - 0.05; t += interval) {
    clicks.push(t)
    const start = Math.round(t * SAMPLE_RATE)
    for (let i = 0; i < 400 && start + i < data.length; i++) {
      data[start + i]! += 0.8 * Math.exp(-i / 80) * Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE)
    }
  }
  return { data, clicks }
}

function expectBeatsOnClicks(beats: number[], clicks: number[], toleranceSeconds: number) {
  for (const click of clicks) {
    const nearest = Math.min(...beats.map((beat) => Math.abs(beat - click)))
    expect(nearest).toBeLessThanOrEqual(toleranceSeconds)
  }
}

describe('detectBeats', () => {
  it('finds 120 BPM and puts the beats on the clicks', () => {
    const { data, clicks } = clickTrack(120, 10)
    const result = detectBeats({ sampleRate: SAMPLE_RATE, channelData: [data] })
    expect(Math.abs(result.bpm - 120)).toBeLessThanOrEqual(2)
    expect(result.confidence).toBeGreaterThan(0.5)
    expectBeatsOnClicks(result.beats, clicks, 0.025)
    expect(result.downbeats?.length).toBeGreaterThan(0)
  })

  it('finds 90 BPM', () => {
    const { data, clicks } = clickTrack(90, 12, 0.35)
    const result = detectBeats({ sampleRate: SAMPLE_RATE, channelData: [data, data] })
    expect(Math.abs(result.bpm - 90)).toBeLessThanOrEqual(2)
    expectBeatsOnClicks(result.beats, clicks, 0.025)
  })

  it('folds a fast click track into the preferred octave', () => {
    const { data } = clickTrack(240, 10)
    const result = detectBeats({ sampleRate: SAMPLE_RATE, channelData: [data] })
    expect(result.bpm).toBeGreaterThanOrEqual(80)
    expect(result.bpm).toBeLessThanOrEqual(160)
  })

  it('reports nothing for silence', () => {
    const result = detectBeats({
      sampleRate: SAMPLE_RATE,
      channelData: [new Float32Array(SAMPLE_RATE * 10)],
    })
    expect(result.confidence).toBe(0)
    expect(result.beats).toEqual([])
  })

  it('reports nothing for audio too short to analyse', () => {
    const result = detectBeats({ sampleRate: SAMPLE_RATE, channelData: [new Float32Array(1000)] })
    expect(result.beats).toEqual([])
  })
})
