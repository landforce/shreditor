/**
 * Beat detection for music tracks. Pure DSP, no React, no DOM.
 *
 * Mono mix -> onset strength envelope (log-compressed RMS rise per 1024-sample
 * frame at a 512 hop, minus a moving average) -> tempo by autocorrelation inside
 * 60-200 BPM (the 80-160 octave preferred, doubled/halved tempos folded) -> beat
 * phase by maximising envelope energy -> beats at a constant interval, snapped
 * to the nearest onset peak within +-40 ms, then re-fit so the grid cannot drift.
 * Every pass is linear in the number of samples.
 */

export interface BeatDetectionInput {
  sampleRate: number
  channelData: Float32Array[]
}

export interface BeatDetectionOptions {
  minBpm?: number
  maxBpm?: number
  /** Octave the detector prefers when a tempo and its double/half both fit. */
  preferredMinBpm?: number
  preferredMaxBpm?: number
  /** How far (seconds) a beat may move to land on an onset peak. */
  snapToleranceSeconds?: number
}

export interface BeatAnalysis {
  bpm: number
  /** Beat times in seconds from the start of the audio. */
  beats: number[]
  /** Every fourth beat (the bar starts), when the track is long enough to tell. */
  downbeats?: number[]
  /** 0-1: how strongly the onset energy lines up with the grid. */
  confidence: number
}

const FRAME_SIZE = 1024
const HOP_SIZE = 512
const MIN_SECONDS = 2
const BPM_STEP = 0.5
const MOVING_AVERAGE_FRAMES = 21

const EMPTY: BeatAnalysis = { bpm: 0, beats: [], confidence: 0 }

function mixToMono(input: BeatDetectionInput): Float32Array {
  const channels = input.channelData.filter((channel) => channel.length > 0)
  if (channels.length === 0) return new Float32Array(0)
  const length = Math.min(...channels.map((channel) => channel.length))
  if (channels.length === 1) return channels[0]!.subarray(0, length)
  const mono = new Float32Array(length)
  const scale = 1 / channels.length
  for (const channel of channels) {
    for (let i = 0; i < length; i++) mono[i]! += channel[i]! * scale
  }
  return mono
}

interface OnsetEnvelope {
  /** Onset strength per frame (>= 0). */
  strength: Float32Array
}

function computeOnsetEnvelope(mono: Float32Array): OnsetEnvelope | null {
  const blockCount = Math.floor(mono.length / HOP_SIZE)
  const frameCount = blockCount - 1
  if (frameCount < 8) return null

  const blockEnergy = new Float64Array(blockCount)
  for (let b = 0; b < blockCount; b++) {
    let sum = 0
    const start = b * HOP_SIZE
    for (let i = start; i < start + HOP_SIZE; i++) {
      const v = mono[i]!
      sum += v * v
    }
    blockEnergy[b] = sum
  }

  const rms = new Float64Array(frameCount)
  let maxRms = 0
  for (let f = 0; f < frameCount; f++) {
    const value = Math.sqrt((blockEnergy[f]! + blockEnergy[f + 1]!) / FRAME_SIZE)
    rms[f] = value
    if (value > maxRms) maxRms = value
  }
  if (maxRms < 1e-6) return null

  const compressed = new Float64Array(frameCount)
  for (let f = 0; f < frameCount; f++) compressed[f] = Math.log1p((100 * rms[f]!) / maxRms)

  const flux = new Float64Array(frameCount)
  for (let f = 1; f < frameCount; f++) flux[f] = Math.max(0, compressed[f]! - compressed[f - 1]!)

  // Subtract a short moving average so steady loudness changes do not read as onsets.
  const strength = new Float32Array(frameCount)
  const half = (MOVING_AVERAGE_FRAMES - 1) / 2
  let windowSum = 0
  let windowStart = 0
  let windowEnd = -1
  for (let f = 0; f < frameCount; f++) {
    const lo = Math.max(0, f - half)
    const hi = Math.min(frameCount - 1, f + half)
    while (windowEnd < hi) windowSum += flux[++windowEnd]!
    while (windowStart < lo) windowSum -= flux[windowStart++]!
    const mean = windowSum / (hi - lo + 1)
    strength[f] = Math.max(0, flux[f]! - mean)
  }
  return { strength }
}

/** Linear interpolation of the envelope at a fractional frame index (0 outside). */
function sampleAt(values: Float32Array, position: number): number {
  if (position < 0 || position > values.length - 1) return 0
  const lower = Math.floor(position)
  const fraction = position - lower
  const a = values[lower]!
  if (fraction === 0 || lower + 1 >= values.length) return a
  return a + (values[lower + 1]! - a) * fraction
}

/** Mean of env[i] * env[i + lag] for a fractional lag, in frames. */
function autocorrelationAt(values: Float32Array, lag: number): number {
  const count = Math.floor(values.length - lag)
  if (count <= 0) return 0
  let sum = 0
  for (let i = 0; i < count; i++) {
    const a = values[i]!
    if (a === 0) continue
    sum += a * sampleAt(values, i + lag)
  }
  return sum / count
}

function lagForBpm(bpm: number, framesPerSecond: number): number {
  return (60 / bpm) * framesPerSecond
}

function estimateTempo(
  strength: Float32Array,
  framesPerSecond: number,
  options: Required<
    Pick<BeatDetectionOptions, 'minBpm' | 'maxBpm' | 'preferredMinBpm' | 'preferredMaxBpm'>
  >,
): number {
  const { minBpm, maxBpm, preferredMinBpm, preferredMaxBpm } = options
  const periodicity = (bpm: number) => {
    const lag = lagForBpm(bpm, framesPerSecond)
    return autocorrelationAt(strength, lag) + 0.5 * autocorrelationAt(strength, lag * 2)
  }

  let bestBpm = 0
  let bestScore = -1
  for (let bpm = minBpm; bpm <= maxBpm + 1e-9; bpm += BPM_STEP) {
    const inPreferred = bpm >= preferredMinBpm && bpm <= preferredMaxBpm
    const score = periodicity(bpm) * (inPreferred ? 1 : 0.8)
    if (score > bestScore) {
      bestScore = score
      bestBpm = bpm
    }
  }
  if (bestBpm === 0) return 0

  // Fold a doubled/halved tempo into the preferred octave when it fits nearly as well.
  const fitAt = (bpm: number) => autocorrelationAt(strength, lagForBpm(bpm, framesPerSecond))
  const base = fitAt(bestBpm)
  if (bestBpm < preferredMinBpm && bestBpm * 2 <= maxBpm) {
    if (fitAt(bestBpm * 2) >= base * 0.7) bestBpm *= 2
  } else if (bestBpm > preferredMaxBpm && bestBpm / 2 >= minBpm) {
    if (fitAt(bestBpm / 2) >= base * 0.7) bestBpm /= 2
  }
  return bestBpm
}

function findPhase(strength: Float32Array, periodFrames: number): number {
  let bestPhase = 0
  let bestScore = -1
  for (let phase = 0; phase < periodFrames; phase += 0.5) {
    let score = 0
    for (let position = phase; position <= strength.length - 1; position += periodFrames) {
      score += sampleAt(strength, position)
    }
    if (score > bestScore) {
      bestScore = score
      bestPhase = phase
    }
  }
  return bestPhase
}

interface OnsetPeak {
  /** Refined onset time in seconds. */
  time: number
  strength: number
}

function pickOnsetPeaks(
  strength: Float32Array,
  mono: Float32Array,
  sampleRate: number,
): OnsetPeak[] {
  let max = 0
  for (const value of strength) if (value > max) max = value
  if (max === 0) return []
  const threshold = max * 0.15
  const peaks: OnsetPeak[] = []
  for (let f = 1; f < strength.length - 1; f++) {
    const value = strength[f]!
    if (value < threshold || value <= strength[f - 1]! || value < strength[f + 1]!) continue
    // The rise first shows in the frame that just took in the onset: its newest
    // hop of samples holds the attack. Find the loudest sample there.
    const regionStart = f * HOP_SIZE + FRAME_SIZE - HOP_SIZE
    const regionEnd = Math.min(mono.length, regionStart + HOP_SIZE)
    let loudest = regionStart
    let loudestValue = 0
    for (let i = regionStart; i < regionEnd; i++) {
      const magnitude = Math.abs(mono[i]!)
      if (magnitude > loudestValue) {
        loudestValue = magnitude
        loudest = i
      }
    }
    peaks.push({ time: loudest / sampleRate, strength: value })
  }
  return peaks
}

function nearestPeakTime(peaks: OnsetPeak[], time: number, tolerance: number): number | null {
  let low = 0
  let high = peaks.length - 1
  while (low < high) {
    const mid = (low + high) >> 1
    if (peaks[mid]!.time < time) low = mid + 1
    else high = mid
  }
  let best: number | null = null
  let bestDistance = tolerance
  for (let i = Math.max(0, low - 1); i <= Math.min(peaks.length - 1, low); i++) {
    const distance = Math.abs(peaks[i]!.time - time)
    if (distance <= bestDistance) {
      bestDistance = distance
      best = peaks[i]!.time
    }
  }
  return best
}

function gridTimes(firstTime: number, interval: number, duration: number): number[] {
  const times: number[] = []
  for (let k = 0; ; k++) {
    const time = firstTime + k * interval
    if (time > duration) break
    if (time >= 0) times.push(time)
  }
  return times
}

/** Least-squares line through (index, time); returns the start and the interval. */
function fitGrid(
  points: Array<{ index: number; time: number }>,
): { start: number; interval: number } | null {
  if (points.length < 4) return null
  let sumI = 0
  let sumT = 0
  for (const p of points) {
    sumI += p.index
    sumT += p.time
  }
  const meanI = sumI / points.length
  const meanT = sumT / points.length
  let covariance = 0
  let variance = 0
  for (const p of points) {
    covariance += (p.index - meanI) * (p.time - meanT)
    variance += (p.index - meanI) ** 2
  }
  if (variance === 0) return null
  const interval = covariance / variance
  return { start: meanT - interval * meanI, interval }
}

export function detectBeats(
  buffer: BeatDetectionInput,
  options: BeatDetectionOptions = {},
): BeatAnalysis {
  const { sampleRate } = buffer
  const minBpm = options.minBpm ?? 60
  const maxBpm = options.maxBpm ?? 200
  const preferredMinBpm = options.preferredMinBpm ?? 80
  const preferredMaxBpm = options.preferredMaxBpm ?? 160
  const tolerance = options.snapToleranceSeconds ?? 0.04

  if (!(sampleRate > 0)) return { ...EMPTY }
  const mono = mixToMono(buffer)
  const duration = mono.length / sampleRate
  if (duration < MIN_SECONDS) return { ...EMPTY }

  const envelope = computeOnsetEnvelope(mono)
  if (!envelope) return { ...EMPTY }
  const { strength } = envelope

  const framesPerSecond = sampleRate / HOP_SIZE
  const bpm = estimateTempo(strength, framesPerSecond, {
    minBpm,
    maxBpm,
    preferredMinBpm,
    preferredMaxBpm,
  })
  if (bpm <= 0) return { ...EMPTY }

  const periodFrames = lagForBpm(bpm, framesPerSecond)
  const phaseFrames = findPhase(strength, periodFrames)
  // A strength frame's time is the middle of the hop of samples it just took in.
  const frameToSeconds = (frame: number) =>
    (frame * HOP_SIZE + FRAME_SIZE - HOP_SIZE / 2) / sampleRate
  let interval = (periodFrames * HOP_SIZE) / sampleRate
  let firstTime = frameToSeconds(phaseFrames)
  // Start at the first beat at or after 0 (the phase can sit anywhere in a period).
  while (firstTime - interval >= 0) firstTime -= interval

  const peaks = pickOnsetPeaks(strength, mono, sampleRate)

  const snapAll = (start: number, step: number) => {
    const grid = gridTimes(start, step, duration)
    const points: Array<{ index: number; time: number }> = []
    const snapped = grid.map((time, index) => {
      const peakTime = nearestPeakTime(peaks, time, tolerance)
      if (peakTime === null) return time
      points.push({ index, time: peakTime })
      return peakTime
    })
    return { snapped, points }
  }

  let pass = snapAll(firstTime, interval)
  // Re-fit the grid through the beats that found an onset, so a slightly-off tempo
  // estimate cannot drift away from the music, then snap once more.
  const fit = fitGrid(pass.points)
  if (fit && fit.interval > 0) {
    const fitBpm = 60 / fit.interval
    if (fitBpm >= minBpm && fitBpm <= maxBpm && Math.abs(fitBpm - bpm) / bpm < 0.05) {
      interval = fit.interval
      firstTime = fit.start
      while (firstTime < 0) firstTime += interval
      while (firstTime - interval >= 0) firstTime -= interval
      pass = snapAll(firstTime, interval)
    }
  }

  const beats = pass.snapped.filter((time, i) => i === 0 || time > pass.snapped[i - 1]!)
  if (beats.length === 0) return { ...EMPTY }

  let onBeat = 0
  for (const time of beats)
    onBeat += sampleAt(strength, (time * sampleRate - FRAME_SIZE + HOP_SIZE / 2) / HOP_SIZE)
  let total = 0
  for (const value of strength) total += value
  const meanStrength = total / strength.length
  const ratio = meanStrength > 0 ? onBeat / beats.length / meanStrength : 1
  const confidence = Math.max(0, Math.min(1, 1 - 1 / Math.max(1, ratio)))

  let downbeats: number[] | undefined
  if (beats.length >= 8) {
    const sums = [0, 0, 0, 0]
    beats.forEach((time, index) => {
      sums[index % 4]! += sampleAt(
        strength,
        (time * sampleRate - FRAME_SIZE + HOP_SIZE / 2) / HOP_SIZE,
      )
    })
    const offset = sums.indexOf(Math.max(...sums))
    downbeats = beats.filter((_, index) => index % 4 === offset)
  }

  return {
    bpm: Math.round((60 / interval) * 100) / 100,
    beats,
    ...(downbeats ? { downbeats } : {}),
    confidence: Math.round(confidence * 1000) / 1000,
  }
}
