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

function computeBlockEnergy(mono: Float32Array, blockCount: number): Float64Array {
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
  return blockEnergy
}

function computeRms(blockEnergy: Float64Array, frameCount: number) {
  const rms = new Float64Array(frameCount)
  let maxRms = 0
  for (let f = 0; f < frameCount; f++) {
    const value = Math.sqrt((blockEnergy[f]! + blockEnergy[f + 1]!) / FRAME_SIZE)
    rms[f] = value
    if (value > maxRms) maxRms = value
  }
  return { rms, maxRms }
}

/** Positive rise of the log-compressed RMS from one frame to the next. */
function computeFlux(rms: Float64Array, maxRms: number): Float64Array {
  const frameCount = rms.length
  const compressed = new Float64Array(frameCount)
  for (let f = 0; f < frameCount; f++) compressed[f] = Math.log1p((100 * rms[f]!) / maxRms)

  const flux = new Float64Array(frameCount)
  for (let f = 1; f < frameCount; f++) flux[f] = Math.max(0, compressed[f]! - compressed[f - 1]!)
  return flux
}

/** Subtract a short moving average so steady loudness changes do not read as onsets. */
function subtractMovingAverage(flux: Float64Array): Float32Array {
  const frameCount = flux.length
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
  return strength
}

function computeOnsetEnvelope(mono: Float32Array): OnsetEnvelope | null {
  const blockCount = Math.floor(mono.length / HOP_SIZE)
  const frameCount = blockCount - 1
  if (frameCount < 8) return null

  const { rms, maxRms } = computeRms(computeBlockEnergy(mono, blockCount), frameCount)
  if (maxRms < 1e-6) return null

  return { strength: subtractMovingAverage(computeFlux(rms, maxRms)) }
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

type TempoRange = Required<
  Pick<BeatDetectionOptions, 'minBpm' | 'maxBpm' | 'preferredMinBpm' | 'preferredMaxBpm'>
>

function strongestBpm(strength: Float32Array, framesPerSecond: number, range: TempoRange): number {
  const { minBpm, maxBpm, preferredMinBpm, preferredMaxBpm } = range
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
  return bestBpm
}

/** Fold a doubled/halved tempo into the preferred octave when it fits nearly as well. */
function foldIntoPreferredOctave(
  bestBpm: number,
  strength: Float32Array,
  framesPerSecond: number,
  range: TempoRange,
): number {
  const { minBpm, maxBpm, preferredMinBpm, preferredMaxBpm } = range
  const fitAt = (bpm: number) => autocorrelationAt(strength, lagForBpm(bpm, framesPerSecond))
  const base = fitAt(bestBpm)
  if (bestBpm < preferredMinBpm && bestBpm * 2 <= maxBpm) {
    return fitAt(bestBpm * 2) >= base * 0.7 ? bestBpm * 2 : bestBpm
  }
  if (bestBpm > preferredMaxBpm && bestBpm / 2 >= minBpm) {
    return fitAt(bestBpm / 2) >= base * 0.7 ? bestBpm / 2 : bestBpm
  }
  return bestBpm
}

function estimateTempo(strength: Float32Array, framesPerSecond: number, range: TempoRange): number {
  const bestBpm = strongestBpm(strength, framesPerSecond, range)
  if (bestBpm === 0) return 0
  return foldIntoPreferredOctave(bestBpm, strength, framesPerSecond, range)
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

function maxOf(values: Float32Array): number {
  let max = 0
  for (const value of values) if (value > max) max = value
  return max
}

/**
 * The rise first shows in the frame that just took in the onset: its newest
 * hop of samples holds the attack. Find the loudest sample there.
 */
function loudestSampleIndex(mono: Float32Array, frame: number): number {
  const regionStart = frame * HOP_SIZE + FRAME_SIZE - HOP_SIZE
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
  return loudest
}

function pickOnsetPeaks(
  strength: Float32Array,
  mono: Float32Array,
  sampleRate: number,
): OnsetPeak[] {
  const max = maxOf(strength)
  if (max === 0) return []
  const threshold = max * 0.15
  const peaks: OnsetPeak[] = []
  for (let f = 1; f < strength.length - 1; f++) {
    const value = strength[f]!
    if (value < threshold || value <= strength[f - 1]! || value < strength[f + 1]!) continue
    peaks.push({ time: loudestSampleIndex(mono, f) / sampleRate, strength: value })
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

function resolveOptions(options: BeatDetectionOptions) {
  return {
    minBpm: options.minBpm ?? 60,
    maxBpm: options.maxBpm ?? 200,
    preferredMinBpm: options.preferredMinBpm ?? 80,
    preferredMaxBpm: options.preferredMaxBpm ?? 160,
    tolerance: options.snapToleranceSeconds ?? 0.04,
  }
}

interface SnapPass {
  snapped: number[]
  points: Array<{ index: number; time: number }>
}

function snapGridToPeaks(
  peaks: OnsetPeak[],
  start: number,
  step: number,
  duration: number,
  tolerance: number,
): SnapPass {
  const grid = gridTimes(start, step, duration)
  const points: SnapPass['points'] = []
  const snapped = grid.map((time, index) => {
    const peakTime = nearestPeakTime(peaks, time, tolerance)
    if (peakTime === null) return time
    points.push({ index, time: peakTime })
    return peakTime
  })
  return { snapped, points }
}

/** Where the first beat falls: the first grid line at or after 0. */
function normalizeFirstTime(firstTime: number, interval: number): number {
  let time = firstTime
  while (time < 0) time += interval
  while (time - interval >= 0) time -= interval
  return time
}

interface GridSnapContext {
  peaks: OnsetPeak[]
  duration: number
  tolerance: number
  minBpm: number
  maxBpm: number
}

/**
 * Snap the grid to onset peaks, then re-fit it through the beats that found an
 * onset so a slightly-off tempo estimate cannot drift away from the music, and
 * snap once more.
 */
function snapAndRefit(
  ctx: GridSnapContext,
  bpm: number,
  firstTime: number,
  interval: number,
): { snapped: number[]; interval: number } {
  const { peaks, duration, tolerance, minBpm, maxBpm } = ctx
  const pass = snapGridToPeaks(peaks, firstTime, interval, duration, tolerance)
  const fit = fitGrid(pass.points)
  if (!fit || fit.interval <= 0) return { snapped: pass.snapped, interval }
  const fitBpm = 60 / fit.interval
  if (fitBpm < minBpm || fitBpm > maxBpm || Math.abs(fitBpm - bpm) / bpm >= 0.05) {
    return { snapped: pass.snapped, interval }
  }
  const start = normalizeFirstTime(fit.start, fit.interval)
  const refit = snapGridToPeaks(peaks, start, fit.interval, duration, tolerance)
  return { snapped: refit.snapped, interval: fit.interval }
}

function beatStrengthAt(strength: Float32Array, time: number, sampleRate: number): number {
  return sampleAt(strength, (time * sampleRate - FRAME_SIZE + HOP_SIZE / 2) / HOP_SIZE)
}

function computeConfidence(strength: Float32Array, beats: number[], sampleRate: number): number {
  let onBeat = 0
  for (const time of beats) onBeat += beatStrengthAt(strength, time, sampleRate)
  let total = 0
  for (const value of strength) total += value
  const meanStrength = total / strength.length
  const ratio = meanStrength > 0 ? onBeat / beats.length / meanStrength : 1
  return Math.max(0, Math.min(1, 1 - 1 / Math.max(1, ratio)))
}

function pickDownbeats(
  strength: Float32Array,
  beats: number[],
  sampleRate: number,
): number[] | undefined {
  if (beats.length < 8) return undefined
  const sums = [0, 0, 0, 0]
  beats.forEach((time, index) => {
    sums[index % 4]! += beatStrengthAt(strength, time, sampleRate)
  })
  const offset = sums.indexOf(Math.max(...sums))
  return beats.filter((_, index) => index % 4 === offset)
}

export function detectBeats(
  buffer: BeatDetectionInput,
  options: BeatDetectionOptions = {},
): BeatAnalysis {
  const { sampleRate } = buffer
  const { minBpm, maxBpm, preferredMinBpm, preferredMaxBpm, tolerance } = resolveOptions(options)

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
  const interval = (periodFrames * HOP_SIZE) / sampleRate
  // Start at the first beat at or after 0 (the phase can sit anywhere in a period).
  const firstTime = normalizeFirstTime(frameToSeconds(phaseFrames), interval)

  const peaks = pickOnsetPeaks(strength, mono, sampleRate)
  const result = snapAndRefit(
    { peaks, duration, tolerance, minBpm, maxBpm },
    bpm,
    firstTime,
    interval,
  )

  const { snapped } = result
  const beats = snapped.filter((time, i) => i === 0 || time > snapped[i - 1]!)
  if (beats.length === 0) return { ...EMPTY }

  const downbeats = pickDownbeats(strength, beats, sampleRate)
  const confidence = computeConfidence(strength, beats, sampleRate)

  return {
    bpm: Math.round((60 / result.interval) * 100) / 100,
    beats,
    ...(downbeats ? { downbeats } : {}),
    confidence: Math.round(confidence * 1000) / 1000,
  }
}
