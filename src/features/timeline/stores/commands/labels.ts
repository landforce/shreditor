import type { TimelineCommand } from './types'

function toTitleCaseWords(input: string): string {
  return input
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function readCount(payload: Record<string, unknown> | undefined): number | null {
  if (!payload) return null

  if (typeof payload.count === 'number' && Number.isFinite(payload.count)) {
    return Math.max(1, Math.round(payload.count))
  }

  if (Array.isArray(payload.ids)) {
    return Math.max(1, payload.ids.length)
  }

  if (typeof payload.id === 'string' && payload.id.length > 0) {
    return 1
  }

  return null
}

function formatTransformLabel(command: TimelineCommand): string {
  const payload = command.payload
  const operation = typeof payload?.operation === 'string' ? payload.operation : 'transform'
  const count = readCount(payload)
  const noun = count === null || count === 1 ? 'item' : `${count} items`

  switch (operation) {
    case 'move':
      return `Move ${noun}`
    case 'resize':
      return `Resize ${noun}`
    case 'rotate':
      return `Rotate ${noun}`
    case 'opacity':
      return `Adjust opacity (${noun})`
    case 'corner_radius':
      return `Adjust corner radius (${noun})`
    default:
      return `Transform ${noun}`
  }
}

function formatProjectMetadataLabel(command: TimelineCommand): string {
  const fields = Array.isArray(command.payload?.fields)
    ? command.payload.fields.filter((field): field is string => typeof field === 'string')
    : []
  const resized = fields.includes('width') || fields.includes('height')

  if (fields.includes('fps') && resized) return 'Resize canvas and change frame rate'
  if (resized) return 'Resize canvas'
  if (fields.includes('fps')) return 'Change frame rate'
  if (fields.includes('backgroundColor')) return 'Change canvas background'
  return 'Update project settings'
}

/** A reload of the project from disk: an agent pass carries its own label. */
function formatExternalChangeLabel(command: TimelineCommand): string {
  const label = command.payload?.label
  return typeof label === 'string' && label.trim() ? label.trim() : 'Changes from the agent'
}

const LABEL_FORMATTERS: Record<string, (command: TimelineCommand) => string> = {
  UPDATE_TRANSFORM: formatTransformLabel,
  UPDATE_TRANSFORMS: formatTransformLabel,
  UPDATE_PROJECT_METADATA: formatProjectMetadataLabel,
  APPLY_AUTO_KEYFRAME_OPERATIONS: (command) => {
    const count = readCount(command.payload)
    if (count === null) return 'Auto-keyframe properties'
    return `Auto-keyframe ${count} ${count === 1 ? 'property' : 'properties'}`
  },
  APPLY_BENTO_LAYOUT: (command) => {
    const count = readCount(command.payload)
    if (count === null) return 'Apply bento layout'
    return `Apply bento layout (${count} ${count === 1 ? 'item' : 'items'})`
  },
  EXTERNAL_CHANGE: formatExternalChangeLabel,
}

const FIXED_LABELS: Record<string, string> = {
  SET_IN_POINT: 'Set In point',
  SET_OUT_POINT: 'Set Out point',
  CLEAR_IN_OUT_POINTS: 'Clear In/Out points',
  CLEAR_MARKERS: 'Clear markers',
  CLEAR_TIMELINE: 'Clear timeline',
  REMOVE_FILLER_WORDS: 'Remove filler words',
}

export function formatTimelineCommandLabel(command: TimelineCommand): string {
  const formatter = LABEL_FORMATTERS[command.type]
  if (formatter) return formatter(command)
  const fixed = FIXED_LABELS[command.type]
  if (fixed) return fixed

  const count = readCount(command.payload)
  const base = toTitleCaseWords(command.type)
  if (count !== null && count > 1) {
    return `${base} (${count})`
  }
  return base
}
