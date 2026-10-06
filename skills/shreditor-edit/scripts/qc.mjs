// Per-clip sound and picture measurements for `shred qc`. Numbers come from
// ffmpeg on the ORIGINAL file; the hints are prompts for a look or a listen,
// never instructions: whether a clip gets a fix is the agent's and user's call.
import { spawnSync } from 'node:child_process'

function ffmpeg(args, { stdout = false } = {}) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  if (r.status !== 0)
    throw new Error(`ffmpeg failed: ${r.stderr.trim().split('\n').slice(-2).join(' ')}`)
  return stdout ? r.stdout : r.stderr
}

const percentile = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : Number.NaN
const median = (values) =>
  percentile(
    [...values].sort((a, b) => a - b),
    0.5,
  )
const overall = (log, key) =>
  Number(new RegExp(`${key}: (-?[\\d.]+|-inf)`).exec(log)?.[1] ?? Number.NaN)

const SILENT_DB = -100

/**
 * RMS of every 50 ms window (48 kHz mono), sorted ascending. Digital silence
 * (a muted head, a gated recorder) is left out unless it is a large share of
 * the clip, so a second of silence doesn't hide noisy pauses.
 */
function windowLevels(file) {
  const out = ffmpeg(
    [
      '-i',
      file,
      '-vn',
      '-af',
      'aformat=channel_layouts=mono:sample_rates=48000,asetnsamples=n=2400:p=0,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
      '-f',
      'null',
      '-',
    ],
    { stdout: true },
  )
  const all = [...out.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) =>
    Math.max(SILENT_DB - 20, Number(m[1]) || SILENT_DB - 20),
  )
  const sounding = all.filter((db) => db > SILENT_DB)
  return (sounding.length >= all.length * 0.7 ? sounding : all).sort((a, b) => a - b)
}

function bandStats(file, filter) {
  const log = ffmpeg([
    '-i',
    file,
    '-vn',
    '-af',
    `aformat=channel_layouts=mono${filter},astats=measure_perchannel=none:measure_overall=Peak_level+RMS_level`,
    '-f',
    'null',
    '-',
  ])
  return { peak: overall(log, 'Peak level dB'), rms: overall(log, 'RMS level dB') }
}

function hasAudio(file) {
  const r = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'a',
      '-show_entries',
      'stream=index',
      '-of',
      'csv=p=0',
      file,
    ],
    { encoding: 'utf8' },
  )
  return r.status === 0 && r.stdout.trim().length > 0
}

export function measureSound(file) {
  if (!hasAudio(file)) return null
  const levels = windowLevels(file)
  if (!levels.length) return null
  const full = bandStats(file, '')
  const low = bandStats(file, ',lowpass=f=80,lowpass=f=80')
  const air = bandStats(file, ',highpass=f=5000,highpass=f=5000')
  return {
    peakDb: full.peak,
    rmsDb: full.rms,
    // The quietest tenth of windows is the pauses: the noise you'd hear between lines.
    noiseFloorDb: percentile(levels, 0.1),
    speechDb: percentile(levels, 0.9),
    lowRmsDb: low.rms,
    lowPeakDb: low.peak,
    airRmsDb: air.rms,
  }
}

export function measurePicture(file, durationSeconds) {
  // About 12 frames spread across the clip, normalised to 8-bit 4:2:0 so 10-bit sources read the same.
  const every = Math.max(0.5, (durationSeconds || 24) / 12)
  const out = ffmpeg(
    [
      '-i',
      file,
      '-an',
      '-vf',
      `fps=1/${every},scale=360:-2,format=yuv420p,signalstats,metadata=print:file=-`,
      '-f',
      'null',
      '-',
    ],
    { stdout: true },
  )
  const series = (key) =>
    [...out.matchAll(new RegExp(`lavfi\\.signalstats\\.${key}=(-?[\\d.]+)`, 'g'))].map((m) =>
      Number(m[1]),
    )
  const ylow = series('YLOW')
  if (!ylow.length) return null
  return {
    frames: ylow.length,
    shadows: median(ylow),
    mids: median(series('YAVG')),
    highlights: median(series('YHIGH')),
    max: median(series('YMAX')),
    saturation: median(series('SATAVG')),
    u: median(series('UAVG')) - 128,
    v: median(series('VAVG')) - 128,
  }
}

// U (Cb) above neutral is blue, below is yellow; V (Cr) above is red, below is green.
function castName(u, v) {
  if (Math.abs(u) > 2 * Math.abs(v)) return u > 0 ? 'blue' : 'yellow'
  if (Math.abs(v) > 2 * Math.abs(u)) return v > 0 ? 'red' : 'green'
  if (v > 0) return u > 0 ? 'magenta' : 'warm/orange'
  return u > 0 ? 'cool/cyan' : 'green-yellow'
}

/** Plain-language prompts for a look or a listen. Thresholds are deliberately loose. */
export function soundHints(s) {
  const hints = []
  if (s.peakDb >= -0.1)
    hints.push(
      `peaks hit ${s.peakDb.toFixed(1)} dBFS: probably clipped; listen to the loud lines (a limiter can't undo clipping)`,
    )
  if (s.noiseFloorDb >= -48)
    hints.push(
      `pauses sit at ${s.noiseFloorDb.toFixed(0)} dBFS: audible background noise; listen, then consider noise reduction`,
    )
  else if (s.noiseFloorDb >= -56)
    hints.push(
      `pauses at ${s.noiseFloorDb.toFixed(0)} dBFS: some room tone; usually fine under music`,
    )
  if (s.speechDb - s.noiseFloorDb < 20)
    hints.push(
      `only ${(s.speechDb - s.noiseFloorDb).toFixed(0)} dB between voice and pauses: noisy or distant mic`,
    )
  if (s.rmsDb - s.lowRmsDb < 12)
    hints.push(
      'a lot of energy below 80 Hz: rumble, wind or handling; a high-pass around 80–100 Hz may help',
    )
  if (s.peakDb - s.lowPeakDb < 6)
    hints.push(
      'loud low-frequency bursts: likely mic pops (plosives); a high-pass and a listen to the P/B words',
    )
  if (s.rmsDb - s.airRmsDb < 14)
    hints.push('a lot of energy above 5 kHz: hiss or harsh sibilance; listen to the S sounds')
  return hints
}

export function pictureHints(p) {
  const hints = []
  if (p.highlights < 150)
    hints.push(
      `brightest tenth only reaches ${p.highlights}/235: underexposed or dark; exposure/gain may help`,
    )
  if (p.max >= 234 && p.highlights >= 225)
    hints.push('large areas at white: highlights clipped (can only be darkened, not recovered)')
  if (p.shadows > 50 && p.highlights < 190 && p.saturation < 20)
    hints.push(
      'low contrast and saturation: looks like a flat/log profile; it needs contrast and saturation (or a LUT)',
    )
  else if (p.shadows > 60)
    hints.push(`blacks sit at ${p.shadows}: lifted/milky shadows; contrast or lift may help`)
  const castStrength = Math.hypot(p.u, p.v)
  if (castStrength > 6)
    hints.push(
      `${castName(p.u, p.v)} cast (strength ${castStrength.toFixed(0)}): check white balance (temperature/tint)`,
    )
  if (p.saturation < 6) hints.push('very low saturation: near monochrome or washed out')
  return hints
}

// Designed sound (music, SFX) and graphics aren't recordings to clean up.
const NO_SOUND_HINTS = new Set(['music', 'sfx'])
const NO_PICTURE_HINTS = new Set(['graphics', 'overlay'])

/** One media's measurements and hints. Stills and graphics aren't measured. */
export function qcMedia(meta, file) {
  const mime = meta?.mimeType ?? ''
  const category = meta?.category ?? null
  if (mime.startsWith('image/')) return { category, skipped: 'still image' }
  const sound = measureSound(file)
  const picture = mime.startsWith('video/') ? measurePicture(file, meta?.duration) : null
  const hints = [
    ...(sound && !NO_SOUND_HINTS.has(category) ? soundHints(sound) : []),
    ...(picture && !NO_PICTURE_HINTS.has(category) ? pictureHints(picture) : []),
  ]
  return { category, sound, picture, hints }
}
