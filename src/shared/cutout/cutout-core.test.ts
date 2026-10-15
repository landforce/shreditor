import { describe, expect, it } from 'vite-plus/test'
import {
  CUTOUT_MODELS,
  cutoutAnalysisKey,
  cutoutCoverage,
  cutoutModelFileName,
  cutoutModelUrl,
  cutoutSamplePath,
  cutoutSettingsProblem,
  findCutoutEntry,
  interpolationFor,
  isCutoutActive,
  itemSourceRange,
  maxSampleIndex,
  mediaFingerprint,
  mergeCutoutIndex,
  mergeCutoutSettings,
  mergeIndexRanges,
  parseCutoutIndex,
  resolveCutoutRate,
  sampleRangeFor,
  subtractIndexRanges,
} from './cutout-core.mjs'

const has =
  (...indices: number[]) =>
  (index: number) =>
    indices.includes(index)

describe('cutout sample grid', () => {
  it('blends the two neighbouring samples by time', () => {
    expect(interpolationFor(0.25, 10, has(2, 3))).toEqual({ a: 2, b: 3, t: expect.closeTo(0.5, 6) })
    expect(interpolationFor(0.2, 10, has(2, 3))).toEqual({ a: 2, b: 2, t: 0 })
  })

  it('falls back to the nearest stored sample within one interval, else nothing', () => {
    expect(interpolationFor(0.21, 10, has(2))).toEqual({ a: 2, b: 2, t: 0 })
    expect(interpolationFor(0.29, 10, has(3))).toEqual({ a: 3, b: 3, t: 0 })
    expect(interpolationFor(0.29, 10, has(4))).toEqual({ a: 4, b: 4, t: 0 })
    expect(interpolationFor(0.25, 10, has(9))).toBeNull()
  })

  it('at every source frame ("full") a frame time hits its own sample exactly', () => {
    const rate = resolveCutoutRate('full', 30)
    expect(rate).toBe(30)
    expect(interpolationFor(45 / 30, rate, has(44, 45, 46))).toEqual({ a: 45, b: 45, t: 0 })
  })

  it('defaults to 10 per second and clamps rates', () => {
    expect(resolveCutoutRate(undefined, 25)).toBe(10)
    expect(resolveCutoutRate(500, 25)).toBe(120)
    expect(resolveCutoutRate('full', 0)).toBe(30)
  })

  it('pads a clip range by a sample each side and clamps to the media', () => {
    expect(sampleRangeFor({ start: 1, end: 2 }, 10)).toEqual([9, 21])
    expect(sampleRangeFor({ start: 0, end: 3 }, 10, maxSampleIndex(3, 10))).toEqual([0, 29])
  })

  it('reads a clip source window from sourceStart/sourceEnd or its length and speed', () => {
    const clip = { type: 'video', from: 0, durationInFrames: 60, sourceStart: 30, sourceFps: 30 }
    expect(itemSourceRange(clip, 30)).toEqual({ start: 1, end: 3 })
    expect(itemSourceRange({ ...clip, speed: 2 }, 30)).toEqual({ start: 1, end: 5 })
    expect(itemSourceRange({ ...clip, sourceEnd: 45 }, 30)).toEqual({ start: 1, end: 1.5 })
    expect(itemSourceRange({ type: 'text' }, 30)).toBeNull()
  })

  it('merges, subtracts and counts index ranges', () => {
    expect(
      mergeIndexRanges([
        [5, 7],
        [0, 2],
        [3, 4],
        [10, 10],
      ]),
    ).toEqual([
      [0, 7],
      [10, 10],
    ])
    expect(subtractIndexRanges([[0, 10]], [[3, 5]])).toEqual([
      [0, 2],
      [6, 10],
    ])
    expect(subtractIndexRanges([[0, 10]], [[0, 10]])).toEqual([])
    expect(cutoutCoverage([[0, 9]], { done: [[0, 4]] } as never)).toEqual({
      needed: 10,
      done: 5,
      missing: [[5, 9]],
    })
  })
})

describe('cutout storage keys', () => {
  const meta = { fileSize: 1000, fileLastModified: 5, width: 1920, height: 1080, duration: 3 }

  it('keys analyses by content fingerprint, model and rate', () => {
    const fingerprint = mediaFingerprint(meta)
    expect(fingerprint).toMatch(/^f[0-9a-f]{8}$/)
    expect(mediaFingerprint({ ...meta })).toBe(fingerprint)
    expect(mediaFingerprint({ ...meta, fileSize: 1001 })).not.toBe(fingerprint)
    // A lazily computed content hash must not move the key.
    expect(mediaFingerprint({ ...meta, contentHash: 'abc' } as typeof meta)).toBe(fingerprint)
    expect(cutoutAnalysisKey({ fingerprint, model: 'modnet', rate: 29.97 })).toBe(
      `${fingerprint}-modnet-r29_97`,
    )
    expect(cutoutSamplePath('k', 42)).toBe('k/s0000042.png')
  })

  it('finds the entry for a subject, following the auto decision', () => {
    const index = parseCutoutIndex({
      version: 1,
      entries: { 'fx-u2net-r10': { key: 'fx-u2net-r10', done: [[0, 3]] } },
      auto: { fx: 'object' },
    })
    expect(findCutoutEntry(index, { fingerprint: 'fx', subject: 'auto', rate: 10 })).toMatchObject({
      key: 'fx-u2net-r10',
      subject: 'object',
    })
    expect(findCutoutEntry(index, { fingerprint: 'fy', subject: 'auto', rate: 10 })).toEqual({
      key: null,
      entry: null,
      subject: null,
    })
    expect(findCutoutEntry(index, { fingerprint: 'fx', subject: 'person', rate: 10 }).key).toBe(
      'fx-modnet-r10',
    )
  })

  it('merging indexes unions sample ranges so two writers keep both', () => {
    const merged = mergeCutoutIndex(
      { version: 1, entries: { k: { key: 'k', done: [[0, 4]] } }, auto: {} },
      { version: 1, entries: { k: { key: 'k', done: [[5, 9]] } }, auto: { f: 'person' } },
    )
    expect(merged.entries.k?.done).toEqual([[0, 9]])
    expect(merged.auto).toEqual({ f: 'person' })
    expect(parseCutoutIndex({ version: 99 }).entries).toEqual({})
  })

  it('pins model URLs to a revision and names cache files by hash', () => {
    const model = CUTOUT_MODELS.modnet
    expect(cutoutModelUrl(model, 'webgpu')).toBe(
      `https://huggingface.co/Xenova/modnet/resolve/${model.revision}/onnx/model.onnx`,
    )
    expect(cutoutModelFileName(CUTOUT_MODELS.u2net, 'webgpu')).toBe('u2net-8d10d2f3bb75.onnx')
  })
})

describe('cutout settings', () => {
  it('accepts valid settings and names the bad field otherwise', () => {
    expect(cutoutSettingsProblem({ enabled: true, subject: 'person', feather: 4 })).toBeNull()
    expect(cutoutSettingsProblem({ enabled: true, subject: 'cat' })).toMatch(/^cutout\.subject/)
    expect(cutoutSettingsProblem({ enabled: true, subject: 'auto', feather: 101 })).toMatch(
      /^cutout\.feather/,
    )
    expect(cutoutSettingsProblem({ enabled: true, subject: 'auto', sampleRate: 'half' })).toMatch(
      /^cutout\.sampleRate/,
    )
  })

  it('merges op fields over the current settings with defaults for a new cutout', () => {
    expect(mergeCutoutSettings(undefined, { enabled: true })).toEqual({
      enabled: true,
      subject: 'auto',
    })
    expect(
      mergeCutoutSettings({ enabled: true, subject: 'person', feather: 3 }, { invert: true }),
    ).toEqual({ enabled: true, subject: 'person', feather: 3, invert: true })
  })

  it('only enabled video clips are cut out', () => {
    expect(isCutoutActive({ type: 'video', cutout: { enabled: true } })).toBe(true)
    expect(isCutoutActive({ type: 'video', cutout: { enabled: false } })).toBe(false)
    expect(isCutoutActive({ type: 'image', cutout: { enabled: true } })).toBe(false)
  })
})
