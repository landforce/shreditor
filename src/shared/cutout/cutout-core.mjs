// Background removal ("cutout") core, shared by the editor, the headless harness
// and the agent tools (Node). Pure functions only: the model registry, the
// sample grid, the storage layout and the settings rules. docs/background-removal.md
// explains the design.
//
// A cutout analysis samples alpha masks of a media's SOURCE frames on a fixed
// grid (sample i sits at i / rate seconds of source time) over the ranges clips
// use. Masks cover the full source frame, so crop, flip and resize never
// invalidate them. They are stored per media under
//   media/<mediaId>/cache/cutout/index.json             (what was analysed)
//   media/<mediaId>/cache/cutout/<key>/s0000123.png      (one 8-bit mask per sample)
// keyed by the media's content fingerprint, the model and the sample rate.

const CUTOUT_SUBJECTS = ['auto', 'person', 'object']
const CUTOUT_DEFAULT_RATE = 10
const CUTOUT_MAX_RATE = 120
const CUTOUT_MAX_FEATHER = 100
const CUTOUT_INDEX_VERSION = 1
/** Long edge of a stored mask, in pixels. */
export const CUTOUT_MASK_LONG_EDGE = 640
/** A person mask with fewer pixels above half than this share counts as blank (auto → object). */
export const CUTOUT_BLANK_COVERAGE = 0.002

/**
 * The models. URLs are pinned to a Hugging Face commit and every download is
 * checked against its SHA-256 (the LFS object id). Licences were checked on the
 * upstream repositories (docs/background-removal.md, THIRD_PARTY_NOTICES.md).
 */
export const CUTOUT_MODELS = {
  modnet: {
    id: 'modnet',
    subject: 'person',
    label: 'MODNet portrait matting',
    license: 'Apache-2.0',
    repo: 'Xenova/modnet',
    revision: 'fa2fa546052fba4c08921230a26cc69a333fca12',
    input: { kind: 'modnet', shortEdge: 512, multiple: 32, mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5] },
    files: {
      // fp32 runs on both WebGPU and wasm; it is small enough not to need a half-precision copy.
      webgpu: {
        path: 'onnx/model.onnx',
        bytes: 25888640,
        sha256: '07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9',
      },
      wasm: {
        path: 'onnx/model.onnx',
        bytes: 25888640,
        sha256: '07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9',
      },
    },
  },
  // Objects: U-2-Net (salient object detection). BiRefNet lite was the first
  // choice but does not run in onnxruntime-web here: on WebGPU one of its ops
  // needs 11 storage buffers per shader stage (Apple adapters allow 10) and on
  // wasm it runs out of the 4 GB heap (docs/background-removal.md).
  u2net: {
    id: 'u2net',
    subject: 'object',
    label: 'U-2-Net',
    license: 'Apache-2.0',
    repo: 'BritishWerewolf/U-2-Net',
    revision: 'c08042b462485d8597c89d3ce831d00be8582c5c',
    input: {
      kind: 'square',
      width: 320,
      height: 320,
      mean: [0.485, 0.456, 0.406],
      std: [0.229, 0.224, 0.225],
      minMax: true,
    },
    files: {
      webgpu: {
        path: 'onnx/model.onnx',
        bytes: 175997641,
        sha256: '8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491',
      },
      wasm: {
        path: 'onnx/model.onnx',
        bytes: 175997641,
        sha256: '8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491',
      },
    },
  },
}

/** The model that cuts out a subject ('auto' is resolved per media before this). */
export function cutoutModelFor(subject) {
  return subject === 'object' ? CUTOUT_MODELS.u2net : CUTOUT_MODELS.modnet
}

/** Pinned download URL of one model file. */
export function cutoutModelUrl(model, backend) {
  const file = model.files[backend] ?? model.files.wasm
  return `https://huggingface.co/${model.repo}/resolve/${model.revision}/${file.path}`
}

/** The file name a model file is cached under on disk (the headless model cache). */
export function cutoutModelFileName(model, backend) {
  const file = model.files[backend] ?? model.files.wasm
  return `${model.id}-${file.sha256.slice(0, 12)}.onnx`
}

// ---------------------------------------------------------------------------
// Settings

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value))

const isNumberIn = (lo, hi) => (v) => typeof v === 'number' && v >= lo && v <= hi
const isBoolean = (v) => typeof v === 'boolean'

/** Optional fields: [field, valid?, what it must be]. */
const CUTOUT_FIELD_RULES = [
  ['feather', isNumberIn(0, CUTOUT_MAX_FEATHER), `a number from 0 to ${CUTOUT_MAX_FEATHER}`],
  ['invert', isBoolean, 'true or false'],
  ['refine', isNumberIn(0, 1), 'a number from 0 to 1'],
  [
    'sampleRate',
    (v) => v === 'full' || isNumberIn(1, CUTOUT_MAX_RATE)(v),
    `'full' or a number from 1 to ${CUTOUT_MAX_RATE}`,
  ],
  ['strokes', Array.isArray, 'an array'],
]

/**
 * A problem with a cutout settings object, or null. Shared by the project
 * schema and the setCutout op so both accept exactly the same values.
 */
export function cutoutSettingsProblem(value) {
  if (value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'cutout: must be an object'
  if (!isBoolean(value.enabled)) return 'cutout.enabled: must be true or false'
  if (!CUTOUT_SUBJECTS.includes(value.subject))
    return `cutout.subject: must be one of ${CUTOUT_SUBJECTS.join(', ')}`
  const bad = CUTOUT_FIELD_RULES.find(([field, valid]) => value[field] !== undefined && !valid(value[field]))
  return bad ? `cutout.${bad[0]}: must be ${bad[2]}` : null
}

/** Merge a setCutout op's fields into an item's cutout (defaults for a new one). */
export function mergeCutoutSettings(current, patch) {
  const next = {
    enabled: false,
    subject: 'auto',
    ...(current ?? {}),
  }
  for (const key of ['enabled', 'subject', 'feather', 'invert', 'refine', 'sampleRate']) {
    if (patch[key] !== undefined) next[key] = patch[key]
  }
  return next
}

/** Whether an item draws with its background removed. */
export function isCutoutActive(item) {
  return Boolean(item && item.type === 'video' && item.cutout && item.cutout.enabled)
}

/** Samples per second of source for a cutout ('full' = every source frame). */
export function resolveCutoutRate(sampleRate, sourceFps) {
  if (sampleRate === 'full') {
    return Number.isFinite(sourceFps) && sourceFps > 0 ? sourceFps : 30
  }
  if (typeof sampleRate === 'number' && Number.isFinite(sampleRate) && sampleRate > 0) {
    return clamp(sampleRate, 1, CUTOUT_MAX_RATE)
  }
  return CUTOUT_DEFAULT_RATE
}

// ---------------------------------------------------------------------------
// The sample grid

const EPSILON = 1e-6

/** The source window [start, end) an item plays, in source seconds, or null. */
export function itemSourceRange(item, projectFps) {
  if (!item || item.type !== 'video') return null
  const fps = Number.isFinite(projectFps) && projectFps > 0 ? projectFps : 30
  const sourceFps = item.sourceFps > 0 ? item.sourceFps : fps
  const startFrames = item.sourceStart ?? item.trimStart ?? item.offset ?? 0
  const start = Math.max(0, startFrames / sourceFps)
  const speed = item.speed > 0 ? item.speed : 1
  const end =
    item.sourceEnd !== undefined && item.sourceEnd > startFrames
      ? item.sourceEnd / sourceFps
      : start + (item.durationInFrames / fps) * speed
  return end > start ? { start, end } : null
}

/** Merge overlapping/adjacent integer ranges [a, b] (inclusive), sorted. */
export function mergeIndexRanges(ranges) {
  const sorted = ranges
    .filter((r) => Array.isArray(r) && Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[1] >= r[0])
    .map((r) => [r[0], r[1]])
    .sort((a, b) => a[0] - b[0])
  const out = []
  for (const range of sorted) {
    const last = out.at(-1)
    if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1])
    else out.push(range)
  }
  return out
}

/** Index ranges in `need` that `have` lacks. */
export function subtractIndexRanges(need, have) {
  const merged = mergeIndexRanges(have)
  const out = []
  for (const [a0, b0] of mergeIndexRanges(need)) {
    let a = a0
    for (const [c, d] of merged) {
      if (d < a || c > b0) continue
      if (c > a) out.push([a, c - 1])
      a = Math.max(a, d + 1)
      if (a > b0) break
    }
    if (a <= b0) out.push([a, b0])
  }
  return out
}

function countIndexRanges(ranges) {
  return mergeIndexRanges(ranges).reduce((sum, [a, b]) => sum + b - a + 1, 0)
}

export function hasIndex(ranges, index) {
  return ranges.some(([a, b]) => index >= a && index <= b)
}

/**
 * The sample indices covering source seconds [start, end), with one sample of
 * padding each side so interpolation has both neighbours at the edges.
 * `maxIndex` (from the media's duration) clamps the end.
 */
export function sampleRangeFor(range, rate, maxIndex = Infinity) {
  const first = Math.max(0, Math.floor(range.start * rate + EPSILON) - 1)
  const last = Math.min(maxIndex, Math.ceil(range.end * rate - EPSILON) + 1)
  return last >= first ? [first, last] : null
}

/** The highest valid sample index for a media of `durationSeconds`. */
export function maxSampleIndex(durationSeconds, rate) {
  if (!(durationSeconds > 0)) return Infinity
  return Math.max(0, Math.ceil(durationSeconds * rate - EPSILON) - 1)
}

/**
 * Which samples to blend for source time `seconds`: { a, b, t } blends a → b by
 * t; { a, t: 0 } uses one. Falls back to the nearest stored neighbour within one
 * sample when the pair is incomplete; null when nothing is near.
 */
export function interpolationFor(seconds, rate, has) {
  const position = Math.max(0, seconds * rate)
  const i0 = Math.floor(position + EPSILON)
  const t = Math.max(0, position - i0)
  if (t < 1e-3 && has(i0)) return { a: i0, b: i0, t: 0 }
  if (has(i0) && has(i0 + 1)) return { a: i0, b: i0 + 1, t }
  const nearest = t < 0.5 ? [i0, i0 + 1, i0 - 1] : [i0 + 1, i0, i0 + 2]
  for (const index of nearest) {
    if (index >= 0 && has(index)) return { a: index, b: index, t: 0 }
  }
  return null
}

// ---------------------------------------------------------------------------
// Identity and storage layout

/** 32-bit FNV-1a, hex. */
function fnv1a(text) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * A media's content fingerprint: the file's size and modification time (the
 * identity the workspace already uses to dedupe imports), plus its frame size
 * and duration. `contentHash` is left out on purpose: it is computed lazily, so
 * using it would change the key (and drop the masks) the first time it appears.
 */
export function mediaFingerprint(meta) {
  if (!meta) return 'unknown'
  const parts = [
    meta.fileSize ?? 0,
    meta.fileLastModified ?? 0,
    meta.width ?? 0,
    meta.height ?? 0,
    Math.round((meta.duration ?? 0) * 1000),
  ]
  return `f${fnv1a(parts.join('|'))}`
}

const rateLabel = (rate) => String(Math.round(rate * 1000) / 1000).replace('.', '_')

/** The folder name of one analysis: fingerprint, model and sample rate. */
export function cutoutAnalysisKey({ fingerprint, model, rate }) {
  return `${fingerprint}-${model}-r${rateLabel(rate)}`
}

/** Path segments of a media's cutout folder, relative to the workspace. */
export function cutoutDirSegments(mediaId) {
  return ['media', mediaId, 'cache', 'cutout']
}

export const CUTOUT_INDEX_FILE = 'index.json'

/** File of one sample's mask, relative to the media's cutout folder. */
export function cutoutSamplePath(key, index) {
  return `${key}/s${String(index).padStart(7, '0')}.png`
}

export function emptyCutoutIndex() {
  return { version: CUTOUT_INDEX_VERSION, entries: {}, auto: {} }
}

/** Parse an index.json (tolerating a missing or broken one). */
export function parseCutoutIndex(value) {
  if (!value || typeof value !== 'object' || value.version !== CUTOUT_INDEX_VERSION)
    return emptyCutoutIndex()
  return {
    version: CUTOUT_INDEX_VERSION,
    entries: value.entries && typeof value.entries === 'object' ? value.entries : {},
    auto: value.auto && typeof value.auto === 'object' ? value.auto : {},
  }
}

/**
 * Fold a writer's view into the index on disk: sample ranges union, the newest
 * metadata wins. Two writers (the editor and the agent service) can then add
 * samples to the same analysis without dropping each other's.
 */
export function mergeCutoutIndex(disk, mine) {
  const out = parseCutoutIndex(disk)
  const add = parseCutoutIndex(mine)
  for (const [key, entry] of Object.entries(add.entries)) {
    const prior = out.entries[key]
    out.entries[key] = {
      ...(prior ?? {}),
      ...entry,
      done: mergeIndexRanges([...(prior?.done ?? []), ...(entry.done ?? [])]),
    }
  }
  out.auto = { ...out.auto, ...add.auto }
  return out
}

/** The subject 'auto' resolved for a media fingerprint (person until decided). */
function resolveAutoSubject(index, fingerprint) {
  const decided = index?.auto?.[fingerprint]
  return decided === 'object' ? 'object' : decided === 'person' ? 'person' : null
}

/**
 * Where a cutout's masks are, for one media: the analysis key and its entry, or
 * a reason. `subject` 'auto' follows the media's decision (pending until made).
 */
export function findCutoutEntry(index, { fingerprint, subject, rate }) {
  const resolved = subject === 'auto' ? resolveAutoSubject(index, fingerprint) : subject
  if (!resolved) return { key: null, entry: null, subject: null }
  const model = cutoutModelFor(resolved).id
  const key = cutoutAnalysisKey({ fingerprint, model, rate })
  return { key, entry: index?.entries?.[key] ?? null, subject: resolved }
}

/**
 * How much of what a set of clips needs is analysed:
 * { needed, done, missing: [[a,b]...] } in samples.
 */
export function cutoutCoverage(need, entry) {
  const done = entry?.done ?? []
  const missing = subtractIndexRanges(need, done)
  const needed = countIndexRanges(need)
  return { needed, done: needed - countIndexRanges(missing), missing }
}
