/**
 * Headless ops for motion graphics templates and compositions:
 * addTemplate, updateTemplate, setTemplateControls, createComposition and
 * setCompositionControls. The Node side resolves the templates an op names
 * (app/templates/<id>/template.json) and passes them in the edit input.
 */
import type { TimelineItem } from '@/types/timeline'
import {
  findMotionTemplate,
  resolveTemplateControls,
  type MotionTemplate,
  type MotionTemplateControlInput,
} from '@/shared/motion-templates/template-core.mjs'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useCompositionsStore } from '@/features/timeline/stores/compositions-store'
import { createPreComp } from '@/features/timeline/stores/actions/composition-actions'
import {
  insertMotionTemplate,
  setMotionTemplateControlValues,
  updateMotionTemplate,
} from '@/features/timeline/stores/actions/motion-template-actions'
import {
  findTemplateComposition,
  remapCompositionIds,
  resolveInstanceDuration,
  type TemplateControlValues,
} from '@/features/timeline/utils/motion-template-instances'
import { assertNoTrackOverlap, type OverlapContext } from './track-overlap'

const TEMPLATE_OPERATION_NAMES = [
  'addTemplate',
  'updateTemplate',
  'setTemplateControls',
  'createComposition',
  'setCompositionControls',
] as const
export type TemplateOperationName = (typeof TEMPLATE_OPERATION_NAMES)[number]

type Op = Record<string, unknown> & { op: string }

interface TemplateOpContext {
  overlap: OverlapContext
  canvas: { width: number; height: number }
}

let inputTemplates: MotionTemplate[] = []

/** The templates this edit's ops may use (set per editProject call). */
export function setTemplateEditInput(templates: MotionTemplate[] | undefined): void {
  inputTemplates = templates ?? []
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined
const frames = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

function requireTemplate(ref: unknown): MotionTemplate {
  const name = text(ref)
  if (!name) throw new Error('template is required (a template name or id)')
  const template = findMotionTemplate(inputTemplates, name)
  if (!template)
    throw new Error(`template: "${name}" was not passed in by the service (shred templates list)`)
  return template
}

function requireVideoTrack(trackId: string): void {
  const track = useItemsStore.getState().tracks.find((candidate) => candidate.id === trackId)
  if (!track) throw new Error(`trackId: track "${trackId}" does not exist`)
  if (track.isGroup || (track.kind ?? 'video') !== 'video')
    throw new Error(`trackId: track "${trackId}" is not a video track`)
}

function addTemplate(op: Op, context: TemplateOpContext): unknown {
  const template = requireTemplate(op.template)
  const from = frames(op.from) ?? 0
  const trackId = text(op.trackId)
  if (trackId) {
    requireVideoTrack(trackId)
    const existing = findTemplateComposition(
      useCompositionsStore.getState().compositions,
      template.id,
    )
    assertNoTrackOverlap(context.overlap, {
      trackId,
      from,
      durationInFrames: resolveInstanceDuration(
        existing ?? { name: template.name, durationInFrames: template.durationInFrames },
        frames(op.durationInFrames),
      ),
      name: `template "${template.name}"`,
    })
  }
  const result = insertMotionTemplate(template, {
    from,
    canvas: context.canvas,
    durationInFrames: frames(op.durationInFrames),
    trackId,
    controls: op.controls as TemplateControlValues | undefined,
  })
  return {
    id: result.itemId,
    ...(result.audioItemId ? { audioId: result.audioItemId } : {}),
    compositionId: result.compositionId,
    trackId: result.trackId,
    templateId: template.id,
    templateVersion: result.projectVersion,
    libraryVersion: template.version,
    reused: result.reused,
    ...(result.outdated
      ? {
          warning: `The project uses version ${result.projectVersion} of "${template.name}"; the library has ${template.version}. Run updateTemplate to move every instance to it.`,
        }
      : {}),
  }
}

function updateTemplate(op: Op): unknown {
  const template = requireTemplate(op.template)
  const updated = updateMotionTemplate(template)
  if (!updated) return { templateId: template.id, version: template.version, upToDate: true }
  return { templateId: template.id, ...updated }
}

function setTemplateControls(op: Op): unknown {
  const id = text(op.id)
  if (!id) throw new Error('setTemplateControls requires `id`')
  const values = op.controls
  if (!values || typeof values !== 'object')
    throw new Error('setTemplateControls requires `controls`')
  const item = setMotionTemplateControlValues(id, values as TemplateControlValues)
  return { id, overrides: item.compositionControlOverrides ?? {} }
}

/** Index-wise pairing of the grouped originals with their copies inside the composition. */
function originalIdMap(removed: TimelineItem[], inner: TimelineItem[]): Map<string, string> {
  const map = new Map<string, string>()
  if (removed.length !== inner.length) return map
  for (const [index, copy] of inner.entries()) {
    const original = removed[index]!
    if (original.type !== copy.type || original.label !== copy.label) return new Map()
    map.set(copy.id, original.id)
  }
  return map
}

/**
 * Group items into a layer composition (the editor's compound-clip action). The
 * items keep their ids inside it, so later ops (setCompositionControls) can name
 * them as they were built.
 */
function createComposition(op: Op, context: TemplateOpContext): unknown {
  const ids = Array.isArray(op.ids)
    ? op.ids.filter((id): id is string => typeof id === 'string')
    : []
  const name = text(op.name)
  if (ids.length === 0 || !name) throw new Error('createComposition requires `ids` and `name`')
  const before = useItemsStore.getState().items
  for (const id of ids)
    if (!before.some((item) => item.id === id)) throw new Error(`ids: item "${id}" does not exist`)
  const wrapper = createPreComp(name, ids, { editorKind: 'composite-2d' })
  if (wrapper?.type !== 'composition')
    throw new Error('createComposition could not group those items (nothing visual selected?)')
  const store = useCompositionsStore.getState()
  const composition = store.getComposition(wrapper.compositionId)!
  const after = new Set(useItemsStore.getState().items.map((item) => item.id))
  const removed = before.filter((item) => !after.has(item.id))
  const restored = remapCompositionIds(composition, {
    items: originalIdMap(removed, composition.items),
    tracks: new Map(),
    compositions: new Map(),
  })
  store.updateComposition(composition.id, {
    ...restored,
    width: context.canvas.width,
    height: context.canvas.height,
  })
  useItemsStore.getState()._updateItem(wrapper.id, {
    compositionWidth: context.canvas.width,
    compositionHeight: context.canvas.height,
  } as Partial<TimelineItem>)
  return {
    id: wrapper.id,
    compositionId: composition.id,
    items: restored.items.map((item) => item.id),
    from: wrapper.from,
    durationInFrames: wrapper.durationInFrames,
  }
}

/** Replace a composition's published controls (what each instance can change, by name). */
function setCompositionControls(op: Op): unknown {
  const compositionId = text(op.compositionId)
  if (!compositionId) throw new Error('setCompositionControls requires `compositionId`')
  const store = useCompositionsStore.getState()
  const composition = store.getComposition(compositionId)
  if (!composition) throw new Error(`compositionId: composition "${compositionId}" does not exist`)
  const previous = composition.compositionControls?.controls ?? []
  const requested = (Array.isArray(op.controls) ? op.controls : []) as MotionTemplateControlInput[]
  const controls = resolveTemplateControls(
    composition,
    requested.map((control) => ({
      ...control,
      // Keep the id of a control that still targets the same property, so
      // instances keep their values for it.
      id: previous.find(
        (old) => old.targetItemId === control.targetItemId && old.property === control.property,
      )?.id,
    })),
    () => crypto.randomUUID(),
  )
  store.updateComposition(compositionId, {
    compositionControls: controls.length > 0 ? { version: 1, controls } : undefined,
  })
  return {
    compositionId,
    controls: controls.map(({ name, kind, property, targetItemId, defaultValue }) => ({
      name,
      kind,
      property,
      targetItemId,
      defaultValue,
    })),
  }
}

const HANDLERS: Record<TemplateOperationName, (op: Op, context: TemplateOpContext) => unknown> = {
  addTemplate,
  updateTemplate,
  setTemplateControls,
  createComposition,
  setCompositionControls,
}

/** Apply a template/composition op; throws for an op name nobody handles. */
export function applyTemplateOp(op: Op, context: TemplateOpContext): unknown {
  const handler = Object.hasOwn(HANDLERS, op.op) ? HANDLERS[op.op as TemplateOperationName] : null
  if (!handler) throw new Error(`Unknown edit op: ${String(op.op)}`)
  return handler(op, context)
}
