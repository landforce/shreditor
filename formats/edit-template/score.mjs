// `shred check`'s Template section: how close a timeline lands to the
// template it was planned from (cuts per minute, median and first shot, shot
// mix, text slots, the title hook at frame 0 and its hold, captions). The
// reference's timings are guidance, so this is information, never a rule:
// each check is close to the reference or differs from it, with the frame
// ranges to look at. Many edits never use a template. Pure.
import { measureTimeline } from './measure.mjs'

const MAX_RANGES = 20
const round2 = (value) => (value === null ? null : Math.round(value * 100) / 100)
const range = (startFrame, endFrame) => ({ startFrame, endFrame })
const shotRange = (shot) => range(shot.startFrame, shot.endFrame)
const textRange = (text) => range(text.startFrame, text.endFrame)

/** A band around a reference value: `share` either side, at least `floor` wide. */
const band = (ref, share, floor = 0) => {
  const spread = Math.max(Math.abs(ref) * share, floor)
  return { min: Math.max(0, ref - spread), max: ref + spread }
}
const inBand = (value, b) => value >= b.min && value <= b.max
const bandText = (b, unit, ref) =>
  `${round2(b.min)}-${round2(b.max)}${unit} (reference ${round2(ref)}${unit})`

function check(key, label, { status, value, target, detail = '', ranges = [] }) {
  return {
    key,
    label,
    status,
    value,
    target,
    detail,
    ranges: status === 'differs' ? ranges.slice(0, MAX_RANGES) : [],
  }
}
const na = (key, label, detail) =>
  check(key, label, { status: 'na', value: null, target: '-', detail })

function bandCheck(key, label, { value, ref, share, floor, unit, ranges }) {
  if (ref === null || ref === undefined) return na(key, label, 'the template has no value')
  if (value === null) return na(key, label, 'nothing to measure on the timeline')
  const b = band(ref, share, floor)
  const ok = inBand(value, b)
  return check(key, label, {
    status: ok ? 'close' : 'differs',
    value: round2(value),
    target: bandText(b, unit, ref),
    ranges: ok ? [] : ranges(value < b.min),
  })
}

const byLength = (shots, longestFirst) =>
  [...shots]
    .sort((a, b) =>
      longestFirst
        ? b.endFrame - b.startFrame - (a.endFrame - a.startFrame)
        : a.endFrame - a.startFrame - (b.endFrame - b.startFrame),
    )
    .slice(0, 3)
    .map(shotRange)

function pacingChecks(measured, pacing) {
  const { shots, fps, endFrame } = measured
  const now = measured.pacing
  const sec = (shot) => (shot.endFrame - shot.startFrame) / fps
  return [
    bandCheck('templateLength', 'Length vs reference', {
      value: now.durationSec,
      ref: pacing.durationSec,
      share: 0.2,
      floor: 2,
      unit: ' s',
      ranges: () => [range(0, endFrame)],
    }),
    bandCheck('templateCutsPerMin', 'Cuts per minute vs reference', {
      value: now.cutsPerMin,
      ref: pacing.cutsPerMin,
      share: 0.25,
      floor: 2,
      unit: '',
      // Too slow: the longest shots; too fast: the shortest.
      ranges: (low) => byLength(shots, low),
    }),
    bandCheck('templateMedianShot', 'Median shot vs reference', {
      value: now.medianShotSec,
      ref: pacing.medianShotSec,
      share: 0.3,
      floor: 0.2,
      unit: ' s',
      ranges: () => {
        const b = band(pacing.medianShotSec, 0.3, 0.2)
        return shots.filter((shot) => !inBand(sec(shot), b)).map(shotRange)
      },
    }),
    firstCutCheck(measured, pacing),
  ]
}

function firstCutCheck(measured, pacing) {
  const label = 'First cut vs reference'
  if (pacing.firstCutSec === null)
    return na('templateFirstCut', label, 'the reference has one shot')
  const value = measured.pacing.firstCutSec
  if (value === null) return na('templateFirstCut', label, 'one shot on the timeline')
  const max = Math.max(pacing.firstCutSec * 1.5, pacing.firstCutSec + 0.5)
  const ok = value <= max
  return check('templateFirstCut', label, {
    status: ok ? 'close' : 'differs',
    value: round2(value),
    target: `<= ${round2(max)} s (reference ${pacing.firstCutSec} s)`,
    ranges: [shotRange(measured.shots[0])],
  })
}

// Shot mix buckets: who or what is on screen.
const BUCKETS = {
  speaker: ['speaker'],
  pictures: ['images', 'screen'],
  footage: ['broll', 'shots'],
}
const bucketShare = (mix, roles) => roles.reduce((sum, role) => sum + (mix[role] ?? 0), 0)
const MIX_SLACK = 0.15

function mixCheck(measured, pacing) {
  const label = 'Shot mix vs reference'
  if (!measured.shots.length) return na('templateShotMix', label, 'no shots on the timeline')
  const rows = Object.entries(BUCKETS)
    .map(([bucket, roles]) => ({
      bucket,
      roles,
      now: bucketShare(measured.pacing.shotMix, roles),
      ref: bucketShare(pacing.shotMix ?? {}, roles),
    }))
    .filter((row) => row.now > 0 || row.ref > 0)
  const off = rows.filter((row) => Math.abs(row.now - row.ref) > MIX_SLACK)
  const pct = (share) => `${Math.round(share * 100)}%`
  const over = new Set(off.filter((row) => row.now > row.ref).flatMap((row) => row.roles))
  return check('templateShotMix', label, {
    status: off.length ? 'differs' : 'close',
    value: rows.map((row) => `${row.bucket} ${pct(row.now)}`).join(', '),
    target: `within ${pct(MIX_SLACK)} of ${rows.map((row) => `${row.bucket} ${pct(row.ref)}`).join(', ')}`,
    detail: off.map((row) => `${row.bucket} ${pct(row.now)} vs ${pct(row.ref)}`).join('; '),
    ranges: measured.shots.filter((shot) => over.has(shot.role)).map(shotRange),
  })
}

function labelCheck(measured, template) {
  const label = 'Text slots (labels) vs reference'
  const slots = template.slots.filter((slot) => slot.kind === 'text' && slot.role === 'labels')
  const labels = measured.texts.filter((text) => text.role === 'labels')
  const slack = Math.max(1, Math.round(slots.length * 0.3))
  const ok = Math.abs(labels.length - slots.length) <= slack
  const kinds = [...new Set(slots.map((slot) => slot.textKind))].join(', ')
  return check('templateLabels', label, {
    status: ok ? 'close' : 'differs',
    value: labels.length,
    target: `${Math.max(0, slots.length - slack)}-${slots.length + slack} (reference ${slots.length}${kinds ? `: ${kinds}` : ''})`,
    detail: slots.map((slot) => `${slot.id} "${slot.pattern}"`).join(', '),
    ranges: labels.length ? labels.map(textRange) : [range(0, measured.endFrame)],
  })
}

function titleChecks(measured, template) {
  const ref = template.slots.find((slot) => slot.kind === 'text' && slot.role === 'title')
  if (!ref) return []
  const { fps } = measured
  const title = measured.texts.find((text) => text.role === 'title')
  const holdFrames = Math.round(ref.targetSec * fps)
  const atZero = Boolean(title) && title.startFrame <= 0
  const hook = check('templateTitleAt0', 'Title hook from frame 0 (as the reference)', {
    status: ref.start <= 0.1 && !atZero ? 'differs' : 'close',
    value: title ? title.startFrame : null,
    target: ref.start <= 0.1 ? 'frame 0' : `about ${ref.start} s`,
    detail: `${ref.id} "${ref.pattern}"`,
    ranges: [title ? textRange(title) : range(0, holdFrames)],
  })
  if (!title) return [hook]
  const hold = bandCheck('templateTitleHold', 'Title hold vs reference', {
    value: (title.endFrame - title.startFrame) / fps,
    ref: ref.targetSec,
    share: 0.4,
    floor: 1,
    unit: ' s',
    ranges: () => [textRange(title)],
  })
  return [hook, hold]
}

function captionsCheck(measured, template) {
  const mode = template.captions?.mode ?? 'off'
  const captions = measured.texts.filter((text) => text.role === 'captions')
  const has = captions.length > 0
  const wanted = mode !== 'off'
  return check('templateCaptions', 'Captions as the reference', {
    status: has === wanted ? (mode === 'span' ? 'info' : 'close') : 'differs',
    value: has,
    target:
      mode === 'span' ? `a span (${template.captions.start}-${template.captions.end} s)` : mode,
    detail: `${captions.length} caption item(s)`,
    ranges: [range(0, measured.endFrame)],
  })
}

/**
 * The Template section for a project planned from `template`: checks with
 * status pass, warn, info or n/a (never fail) and frame ranges on warns.
 */
export function scoreTemplate(project, template, { mediaById = {} } = {}) {
  const measured = measureTimeline(project, { mediaById })
  const checks = [
    ...pacingChecks(measured, template.pacing),
    mixCheck(measured, template.pacing),
    labelCheck(measured, template),
    ...titleChecks(measured, template),
    captionsCheck(measured, template),
  ]
  const count = (status) => checks.filter((c) => c.status === status).length
  return {
    template: template.name,
    source: template.source,
    measured: measured.pacing,
    checks,
    summary: { close: count('close'), differs: count('differs') },
  }
}
