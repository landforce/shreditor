import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { FORMAT_IDS, FORMAT_ROLES, getFormat } from '../../formats/registry.mjs'
import {
  TEXT_STYLE_OP_DESCRIPTIONS,
  TEXT_STYLE_OP_NAMES,
  TEXT_STYLE_OP_SCHEMAS,
} from './text-styles.mjs'
import {
  TEMPLATE_OP_DESCRIPTIONS,
  TEMPLATE_OP_NAMES,
  TEMPLATE_OP_SCHEMAS,
} from './template-contract.mjs'

export const HEADLESS_API_VERSION = 1

const id = z.string().min(1)
// Unknown direction values render the transition window BLACK — reject at the wire.
const transitionDirection = z.enum(['from-left', 'from-right', 'from-top', 'from-bottom'])
const portableIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)
const revisionSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const finite = z.number().finite()
const frame = z.number().int().nonnegative()
const positiveFrames = z.number().int().positive()
const projectObject = z.record(z.string(), z.unknown())
const params = z.record(z.string(), z.union([z.number(), z.boolean(), z.string()]))
const imageFormat = z.preprocess(
  (value) => (typeof value === 'string' ? value.toLowerCase() : value),
  z.enum(['png', 'jpg', 'jpeg', 'webp']),
)

const projectFrameFields = {
  project: id.optional(),
  projectObject: projectObject.optional(),
  frame: finite.nonnegative().optional(),
  at: finite.nonnegative().optional(),
  atSeconds: finite.nonnegative().optional(),
}

const hasExactlyOneProjectSource = (value) =>
  Boolean(value.project) !== Boolean(value.projectObject)

// Generated from the GPU effect registry (effect-catalog.test.ts keeps it in sync);
// `shred effects` prints it with params and ranges.
const EFFECT_CATALOG = JSON.parse(
  readFileSync(new URL('./effect-catalog.json', import.meta.url), 'utf8'),
)
const GPU_EFFECT_TYPES = EFFECT_CATALOG.map((entry) => entry.id)

const ANIMATABLE_PROPERTIES = [
  'x',
  'y',
  'width',
  'height',
  'anchorX',
  'anchorY',
  'rotation',
  'opacity',
  'cornerRadius',
  'cropLeft',
  'cropRight',
  'cropTop',
  'cropBottom',
  'cropSoftness',
  'volume',
  'textStyleScale',
  'fontSize',
  'lineHeight',
  'textPadding',
  'backgroundRadius',
  'textShadowOffsetX',
  'textShadowOffsetY',
  'textShadowBlur',
  'strokeWidth',
]
const animatableProperty = z.union([
  z.enum(ANIMATABLE_PROPERTIES),
  z.string().regex(/^effect:[^:]+:[^:]+:[^:]+$/, 'invalid effect keyframe property'),
])
const easing = z.enum([
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'hold',
  'cubic-bezier',
  'spring',
])
const easingConfigSchema = z
  .object({
    type: easing,
    bezier: z.object({ x1: finite, y1: finite, x2: finite, y2: finite }).strict().optional(),
    spring: z
      .object({
        tension: z.number().min(0).max(500),
        friction: z.number().min(0).max(100),
        mass: z.number().min(0.1).max(10),
      })
      .strict()
      .optional(),
  })
  .strict()
const transform = z
  .object({
    x: finite.optional(),
    y: finite.optional(),
    width: finite.positive().optional(),
    height: finite.positive().optional(),
    anchorX: finite.optional(),
    anchorY: finite.optional(),
    rotation: finite.optional(),
    opacity: finite.min(0).max(1).optional(),
    cornerRadius: finite.nonnegative().optional(),
    flipHorizontal: z.boolean().optional(),
    flipVertical: z.boolean().optional(),
    aspectRatioLocked: z.boolean().optional(),
  })
  .strict()
const effect = z
  .object({
    type: z.literal('gpu-effect'),
    gpuEffectType: z.enum(GPU_EFFECT_TYPES),
    params: params.default({}),
  })
  .strict()

const opSchemas = [
  z
    .object({
      op: z.literal('addText'),
      id: id.optional(),
      text: z.string().optional(),
      from: frame.optional(),
      durationInFrames: positiveFrames.optional(),
      trackId: id.optional(),
      label: z.string().optional(),
      color: z.string().optional(),
      fontSize: finite.positive().optional(),
      fontFamily: z.string().min(1).optional(),
      fontWeight: z.enum(['medium', 'semibold', 'bold']).optional(),
      textAlign: z.enum(['left', 'center', 'right']).optional(),
      verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
      // A project or library text style (id or name): look, layout, motion and
      // default length; the fields above win and are recorded as overrides.
      styleId: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('addItem'),
      item: z
        .object({
          type: id,
          trackId: id,
          from: frame,
          durationInFrames: positiveFrames,
          id: id.optional(),
        })
        .passthrough(),
    })
    .strict(),
  z
    .object({
      op: z.literal('updateItem'),
      id,
      updates: z
        .record(z.string(), z.unknown())
        .refine((value) => Object.keys(value).length > 0, 'updates must not be empty'),
      // Timing changes carry to linked companions (a video's own audio) unless false.
      linked: z.boolean().optional(),
    })
    .strict(),
  z.object({ op: z.literal('moveItem'), id, from: frame, trackId: id.optional() }).strict(),
  z
    .object({
      op: z.literal('removeItems'),
      ids: z.array(id).min(1),
      // false: only the listed items (a video's own audio without the video).
      linked: z.boolean().optional(),
    })
    .strict(),
  z.object({ op: z.literal('split'), id, frame }).strict(),
  z.object({ op: z.literal('trimStart'), id, amount: positiveFrames }).strict(),
  z.object({ op: z.literal('trimEnd'), id, amount: positiveFrames }).strict(),
  z
    .object({
      op: z.literal('addTransition'),
      leftClipId: id,
      rightClipId: id,
      type: z.literal('crossfade').optional(),
      durationInFrames: positiveFrames.optional(),
      presentation: id.optional(),
      direction: transitionDirection.optional(),
      timing: id.optional(),
      alignment: z.number().min(0).max(1).optional(),
      properties: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('updateTransition'),
      id,
      durationInFrames: positiveFrames.optional(),
      presentation: id.optional(),
      direction: transitionDirection.optional(),
      timing: id.optional(),
      alignment: z.number().min(0).max(1).optional(),
      properties: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  z.object({ op: z.literal('removeTransition'), id }).strict(),
  z
    .object({
      op: z.literal('addTrack'),
      kind: z.enum(['video', 'audio']).optional(),
      order: finite.optional(),
      name: id.optional(),
      formatRole: z.enum(FORMAT_ROLES).optional(),
    })
    .strict(),
  z
    .object({ op: z.literal('removeTrack'), trackId: id, removeItems: z.boolean().optional() })
    .strict(),
  z
    .object({
      op: z.literal('addClip'),
      mediaId: id,
      from: frame.optional(),
      trackId: id.optional(),
      durationInFrames: positiveFrames.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('addKeyframe'),
      itemId: id,
      property: animatableProperty,
      frame,
      value: finite,
      easing: easing.optional(),
      easingConfig: easingConfigSchema.optional(),
    })
    .strict(),
  z.object({ op: z.literal('removeKeyframes'), itemId: id, property: animatableProperty }).strict(),
  z
    .object({
      op: z.literal('setTransformParent'),
      id,
      parentItemId: id.nullable(),
      behavior: z.enum(['preserve-world', 'snap-to-parent', 'restore-local']).optional(),
      frame: frame.optional(),
    })
    .strict(),
  z.union([
    z.object({ op: z.literal('addEffect'), itemId: id, effect }).strict(),
    z
      .object({
        op: z.literal('addEffect'),
        itemId: id,
        gpuEffectType: z.enum(GPU_EFFECT_TYPES),
        params: params.optional(),
      })
      .strict(),
  ]),
  z.object({ op: z.literal('removeEffect'), itemId: id, effectId: id }).strict(),
  z
    .object({
      op: z.literal('addLut'),
      itemId: id,
      lut: z.string().regex(/^[^/\\]+\.cube$/i, 'lut must be a .cube file name in luts/'),
      intensity: z.number().min(0).max(1).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('updateEffect'),
      itemId: id,
      effectId: id,
      params: params.optional(),
      enabled: z.boolean().optional(),
    })
    .strict()
    .refine(
      (value) => value.params !== undefined || value.enabled !== undefined,
      'updateEffect needs `params` or `enabled`',
    ),
  z
    .object({
      op: z.literal('setTransform'),
      id,
      transform: transform.refine(
        (value) => Object.keys(value).length > 0,
        'transform must not be empty',
      ),
    })
    .strict(),
  z.object({ op: z.literal('unlinkItems'), ids: z.array(id).min(1) }).strict(),
  z
    .object({
      op: z.literal('addMarker'),
      frame,
      id: id.optional(),
      label: z.string().optional(),
      color: id.optional(),
    })
    .strict(),
  z.object({ op: z.literal('removeMarkers'), ids: z.array(id).min(1) }).strict(),
  ...TEMPLATE_OP_SCHEMAS,
  ...TEXT_STYLE_OP_SCHEMAS,
]

export const EDIT_OPERATION_NAMES = [
  'addText',
  'addItem',
  'updateItem',
  'moveItem',
  'removeItems',
  'split',
  'trimStart',
  'trimEnd',
  'addTransition',
  'updateTransition',
  'removeTransition',
  'addTrack',
  'removeTrack',
  'addClip',
  'addKeyframe',
  'removeKeyframes',
  'setTransformParent',
  'addEffect',
  'removeEffect',
  'updateEffect',
  'addLut',
  'setTransform',
  'unlinkItems',
  'addMarker',
  'removeMarkers',
  ...TEMPLATE_OP_NAMES,
  ...TEXT_STYLE_OP_NAMES,
]
const EDIT_OPERATION_DESCRIPTIONS = Object.fromEntries(
  EDIT_OPERATION_NAMES.map((name) => [name, samplesDescription(name)]),
)

function samplesDescription(name) {
  const descriptions = {
    addText: 'Add a text item',
    addItem: 'Add a complete timeline item',
    updateItem: 'Update an existing item',
    moveItem: 'Move an existing item',
    removeItems: 'Remove existing items atomically',
    split: 'Split an item at a frame',
    trimStart: 'Trim frames from an item start',
    trimEnd: 'Trim frames from an item end',
    addTransition: 'Add a transition between clips',
    updateTransition: 'Update an existing transition',
    removeTransition: 'Remove an existing transition',
    addTrack: 'Add a video or audio track',
    removeTrack: 'Remove a track (refused if it has items unless removeItems is true)',
    addClip: 'Add workspace media as a clip',
    addKeyframe: 'Add a property keyframe',
    removeKeyframes: 'Remove keyframes for a property',
    setTransformParent: 'Parent an item transform to another item (null detaches)',
    addEffect: 'Add a registered GPU effect',
    removeEffect: 'Remove an existing item effect',
    updateEffect: "Change an effect's params (merged) or turn it on/off",
    addLut: 'Add a gpu-lut effect from a .cube file in the workspace luts/ folder',
    setTransform: 'Update an item transform',
    unlinkItems: 'Unlink items from their linked group',
    addMarker: 'Add a timeline marker',
    removeMarkers: 'Remove markers by id',
    ...TEMPLATE_OP_DESCRIPTIONS,
    ...TEXT_STYLE_OP_DESCRIPTIONS,
  }
  return descriptions[name]
}
export const editOpSchema = z.union(opSchemas)
export const editRequestSchema = z
  .object({
    project: id.optional(),
    projectObject: projectObject.optional(),
    ops: z.array(editOpSchema).min(1),
  })
  .strict()
  .refine((v) => Boolean(v.project) !== Boolean(v.projectObject), {
    message: 'provide exactly one of project or projectObject',
    path: ['project'],
  })

// A project's format (formats/registry.mjs): the id, and a variant the format has.
const formatChoice = z
  .object({ id: z.enum(FORMAT_IDS), variant: z.string().min(1).optional() })
  .strict()
  .refine(
    (value) => !value.variant || getFormat(value.id).variants.some((v) => v.id === value.variant),
    { message: 'unknown variant for this format', path: ['variant'] },
  )
const storedFormat = formatChoice.and(z.object({ reviewedHash: z.string().optional() }))

// The Video Style Kit a project follows (shred kit apply): where it is, its
// version and hash as applied (and when, and its brand colours). The browser
// checks the whole record against the project schema when it normalizes.
const projectKit = z
  .object({ path: z.string().min(1), kitVersion: z.string().min(1), hash: z.string().min(1) })
  .passthrough()

// A project's place in a cut group (docs/cuts.md): the group's main project
// id, the cut's label and its order in the switcher.
const projectCut = z
  .object({
    group: portableIdSchema,
    label: z.string().trim().min(1).max(60),
    order: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()

export const projectCreateRequestSchema = z
  .object({
    id: portableIdSchema.optional(),
    name: z.string().trim().min(1).max(100),
    description: z.string().max(500).optional(),
    width: z.number().int().min(320).max(7680).optional(),
    height: z.number().int().min(240).max(4320).optional(),
    fps: z.number().int().min(1).max(240).optional(),
    backgroundColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
    format: formatChoice.optional(),
  })
  .strict()

const lifecycleTimelineSchema = z
  .object({
    tracks: z.array(z.unknown()),
    items: z.array(z.unknown()),
  })
  .passthrough()

const lifecycleProjectSchema = z
  .object({
    id: portableIdSchema,
    name: z.string().min(1).max(100),
    description: z.string().max(500),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    duration: z.number().finite().nonnegative(),
    schemaVersion: z.number().int().positive().optional(),
    thumbnail: z.string().optional(),
    thumbnailId: z.string().optional(),
    rootFolderName: z.string().optional(),
    metadata: z
      .object({
        width: z.number().int().min(320).max(7680),
        height: z.number().int().min(240).max(4320),
        fps: z.number().int().min(1).max(240),
        backgroundColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
      })
      .strict(),
    format: storedFormat.optional(),
    kit: projectKit.optional(),
    cut: projectCut.optional(),
    timeline: lifecycleTimelineSchema.optional(),
  })
  .strict()

export const projectSaveRequestSchema = z
  .object({
    project: lifecycleProjectSchema,
    expectedRevision: revisionSchema.optional(),
    force: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.expectedRevision) || v.force === true, {
    message: 'expectedRevision is required unless force is true',
    path: ['expectedRevision'],
  })

export const projectUpdateRequestSchema = z
  .object({
    updates: z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        width: z.number().int().min(320).max(7680).optional(),
        height: z.number().int().min(240).max(4320).optional(),
        fps: z.number().int().min(1).max(240).optional(),
        backgroundColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
        // null clears it. Recording a format doesn't touch the canvas or tracks.
        format: formatChoice.nullable().optional(),
        // The Video Style Kit record (shred kit apply); null clears it.
        kit: projectKit.nullable().optional(),
        // The project's cut label and order (shred cut rename, the editor's Manage cuts).
        cut: projectCut.optional(),
      })
      .strict()
      .refine((v) => Object.keys(v).length > 0, 'updates must not be empty'),
    expectedRevision: revisionSchema.optional(),
    force: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.expectedRevision) || v.force === true, {
    message: 'expectedRevision is required unless force is true',
    path: ['expectedRevision'],
  })

// Move a project to the editor's Trash (shred cut remove): restorable, no media deleted.
export const projectTrashRequestSchema = z
  .object({
    expectedRevision: revisionSchema.optional(),
    force: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.expectedRevision) || v.force === true, {
    message: 'expectedRevision is required unless force is true',
    path: ['expectedRevision'],
  })

export const lifecycleEditRequestSchema = z
  .object({
    ops: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
    persist: z.boolean().optional(),
    expectedRevision: revisionSchema.optional(),
    force: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const callers = new Set()
    const referenceFields = new Set([
      'id',
      'ids',
      'itemId',
      'trackId',
      'leftClipId',
      'rightClipId',
      'effectId',
      'mediaId',
      // Template ops: composition and control targets from createComposition results.
      'compositionId',
      'targetItemId',
      // Text style ops: the clip addCaptions captions, the item upsertTextStyle saves.
      'clipId',
      'fromItemId',
    ])
    for (let index = 0; index < value.ops.length; index++) {
      const callerId = value.ops[index]?.callerId
      if (typeof callerId !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(callerId)) {
        ctx.addIssue({
          code: 'custom',
          message: 'callerId is required and invalid',
          path: ['ops', index, 'callerId'],
        })
      } else if (callers.has(callerId)) {
        ctx.addIssue({
          code: 'custom',
          message: 'callerId must be unique',
          path: ['ops', index, 'callerId'],
        })
      }
      const validateRefs = (input, field, path = []) => {
        if (Array.isArray(input)) {
          input.forEach((entry, itemIndex) => validateRefs(entry, field, [...path, itemIndex]))
        } else if (input && typeof input === 'object') {
          if ('$ref' in input) {
            const keys = Object.keys(input)
            const ref = input.$ref
            const match =
              typeof ref === 'string' ? /^([A-Za-z][A-Za-z0-9_-]{0,63})#(\/.*)$/.exec(ref) : null
            if (
              keys.length !== 1 ||
              !referenceFields.has(field) ||
              !match ||
              !callers.has(match[1])
            ) {
              ctx.addIssue({
                code: 'custom',
                message: 'reference must target a prior callerId from an ID-valued field',
                path: ['ops', index, ...path],
              })
            }
            return
          }
          for (const [key, entry] of Object.entries(input)) validateRefs(entry, key, [...path, key])
        }
      }
      validateRefs(value.ops[index], undefined)
      const normalizeRefs = (input) => {
        if (Array.isArray(input)) return input.map(normalizeRefs)
        if (input && typeof input === 'object') {
          if (Object.keys(input).length === 1 && typeof input.$ref === 'string')
            return 'reference-id'
          return Object.fromEntries(
            Object.entries(input).map(([key, entry]) => [key, normalizeRefs(entry)]),
          )
        }
        return input
      }
      const { callerId: _callerId, ...wireOp } = value.ops[index]
      const parsed = editOpSchema.safeParse(normalizeRefs(wireOp))
      if (!parsed.success) {
        for (const issue of parsed.error.issues)
          ctx.addIssue({ ...issue, path: ['ops', index, ...issue.path] })
      }
      if (typeof callerId === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(callerId))
        callers.add(callerId)
    }
    if (value.persist && !value.expectedRevision && value.force !== true) {
      ctx.addIssue({
        code: 'custom',
        message: 'expectedRevision is required for persisted edits unless force is true',
        path: ['expectedRevision'],
      })
    }
  })

export const mediaProbeRequestSchema = z
  .object({
    persist: z.boolean().optional(),
    expectedRevision: revisionSchema.optional(),
    force: z.boolean().optional(),
  })
  .strict()
  .refine((value) => !value.persist || Boolean(value.expectedRevision) || value.force === true, {
    message: 'expectedRevision is required for persisted probes unless force is true',
    path: ['expectedRevision'],
  })

const RENDER_OPTIONS = {
  codecs: ['h264', 'h265', 'hevc', 'vp9', 'vp8', 'av1', 'prores'],
  engines: ['browser', 'native', 'auto'],
  containers: ['mp4', 'webm', 'mov', 'mkv', 'mp3', 'wav', 'm4a'],
  qualities: ['low', 'medium', 'high', 'ultra'],
}
export const renderRequestSchema = z
  .object({
    project: id.optional(),
    projectObject: projectObject.optional(),
    out: id.optional(),
    codec: z.enum(RENDER_OPTIONS.codecs).optional(),
    container: z.enum(RENDER_OPTIONS.containers).optional(),
    resolution: z
      .string()
      .regex(/^(\d{1,5})x(\d{1,5})$/)
      .refine((value) => {
        const [w, h] = value.split('x').map(Number)
        return w >= 16 && h >= 16 && w <= 16384 && h <= 16384
      }, 'resolution dimensions must be between 16 and 16384')
      .optional(),
    fps: finite.min(1).max(240).optional(),
    quality: z.enum(RENDER_OPTIONS.qualities).optional(),
    inSec: finite.nonnegative().optional(),
    outSec: finite.positive().optional(),
    duration: finite.positive().optional(),
    audioOnly: z.boolean().optional(),
    strict: z.boolean().optional(),
    // native: ffmpeg renders from the original media (overlays drawn by the
    // browser); auto: native when the plan allows it, else browser. Both save to
    // <workspace>/projects/<id>/exports/ and answer with JSON.
    engine: z.enum(RENDER_OPTIONS.engines).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.project) !== Boolean(v.projectObject), {
    message: 'provide exactly one of project or projectObject',
    path: ['project'],
  })
  .refine((v) => !(v.outSec !== undefined && v.duration !== undefined), {
    message: 'outSec and duration are mutually exclusive',
    path: ['outSec'],
  })
  .refine((v) => v.outSec === undefined || v.outSec > (v.inSec ?? 0), {
    message: 'outSec must be greater than inSec',
    path: ['outSec'],
  })
  .refine((v) => !v.audioOnly || !v.container || ['mp3', 'wav', 'm4a'].includes(v.container), {
    message: 'audioOnly requires an audio container',
    path: ['container'],
  })
  .refine((v) => v.audioOnly || !v.container || !['mp3', 'wav', 'm4a'].includes(v.container), {
    message: 'audio containers require audioOnly',
    path: ['container'],
  })
  .refine((v) => !v.engine || v.engine === 'browser' || (v.project && !v.audioOnly), {
    message: 'native and auto engines export a saved project (project id), video only',
    path: ['engine'],
  })
  .refine(
    (v) =>
      !v.engine ||
      v.engine === 'browser' ||
      (v.inSec === undefined && v.outSec === undefined && v.duration === undefined),
    { message: 'native and auto engines export the whole project', path: ['engine'] },
  )
  .refine((v) => v.codec !== 'prores' || (v.engine && v.engine !== 'browser'), {
    message: 'prores is only available with the native engine',
    path: ['codec'],
  })

export const frameRequestSchema = z
  .object({
    ...projectFrameFields,
    width: positiveFrames.max(16384).optional(),
    height: positiveFrames.max(16384).optional(),
    format: imageFormat.optional(),
    quality: finite.min(0).max(1).optional(),
  })
  .strict()
  .refine(hasExactlyOneProjectSource, {
    message: 'provide exactly one of project or projectObject',
    path: ['project'],
  })

export const layoutRequestSchema = z
  .object(projectFrameFields)
  .strict()
  .refine(hasExactlyOneProjectSource, {
    message: 'provide exactly one of project or projectObject',
    path: ['project'],
  })

export function normalizeRenderInput(value) {
  const out = { ...value }
  if (out.in !== undefined) out.inSec = Number(out.in)
  if (out['out-sec'] !== undefined) out.outSec = Number(out['out-sec'])
  if (out['audio-only'] !== undefined) out.audioOnly = Boolean(out['audio-only'])
  if (out.strict !== undefined) out.strict = Boolean(out.strict)
  delete out.in
  delete out['out-sec']
  delete out['audio-only']
  for (const key of ['fps', 'duration']) if (out[key] !== undefined) out[key] = Number(out[key])
  return out
}

export class ContractValidationError extends Error {
  constructor(message, fields) {
    super(message)
    this.name = 'ContractValidationError'
    this.code = 'VALIDATION_ERROR'
    this.fields = fields
  }
}

export function validate(schema, value) {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const fields = result.error.issues.map((issue) => ({
    path: issue.path.join('.') || '$',
    message: issue.message,
    code: issue.code,
  }))
  throw new ContractValidationError('Request validation failed', fields)
}

export function capabilities() {
  return {
    apiVersion: HEADLESS_API_VERSION,
    operations: EDIT_OPERATION_NAMES,
    operationDescriptions: EDIT_OPERATION_DESCRIPTIONS,
    options: {
      ...RENDER_OPTIONS,
      gpuEffects: GPU_EFFECT_TYPES,
      animatableProperties: ANIMATABLE_PROPERTIES,
    },
    schemas: {
      render: z.toJSONSchema(renderRequestSchema, { target: 'draft-7' }),
      frame: z.toJSONSchema(frameRequestSchema, { target: 'draft-7' }),
      layout: z.toJSONSchema(layoutRequestSchema, { target: 'draft-7' }),
      edit: z.toJSONSchema(editRequestSchema, { target: 'draft-7' }),
      projectCreate: z.toJSONSchema(projectCreateRequestSchema, { target: 'draft-7' }),
      projectSave: z.toJSONSchema(projectSaveRequestSchema, { target: 'draft-7' }),
      projectUpdate: z.toJSONSchema(projectUpdateRequestSchema, { target: 'draft-7' }),
      projectTrash: z.toJSONSchema(projectTrashRequestSchema, { target: 'draft-7' }),
      lifecycleEdit: z.toJSONSchema(lifecycleEditRequestSchema, { target: 'draft-7' }),
      mediaProbe: z.toJSONSchema(mediaProbeRequestSchema, { target: 'draft-7' }),
    },
    lifecycle: {
      routes: [
        'GET /v1/capabilities',
        'POST /v1/projects',
        'GET /v1/projects',
        'GET /v1/projects/:id',
        'PUT /v1/projects/:id',
        'PATCH /v1/projects/:id',
        'POST /v1/projects/:id/edit',
        'POST /v1/projects/:id/trash',
        'GET /v1/media',
        'GET /v1/media/:id',
        'POST /v1/media/:id/probe',
        'POST /v1/render',
      ],
      httpMediaUpload: false,
      deleteProject: false,
      trashProject: true,
      writerMode: 'exclusive',
      limits: {
        projectJsonBytes: 16 * 1024 * 1024,
        mediaMetadataBytes: 2 * 1024 * 1024,
        editOps: 1000,
        localMediaBytes: 20 * 1024 ** 3,
      },
      deprecatedRoutes: ['/capabilities', '/projects', '/render', '/edit'],
    },
  }
}
