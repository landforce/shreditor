/**
 * Motion template actions: insert an instance of a library template, update the
 * project's copy to the library version, and change an instance's control values.
 * The editor and the headless edit service share them.
 */
import type { CompositionItem, TimelineItem } from '@/types/timeline'
import {
  chooseTemplateVariant,
  templateVariant,
  type MotionTemplate,
  type MotionTemplateVariantView,
} from '@/shared/motion-templates/template-core.mjs'
import { createClassicTrack } from '../../utils/classic-tracks'
import { compositionHasOwnedAudio } from '../../utils/dropped-composition'
import { wouldCreateCompositionCycle } from '../../utils/composition-graph'
import {
  buildTemplateAudioCompanion,
  buildTemplateInstance,
  chooseTemplateTrack,
  cloneTemplateCompositions,
  findTemplateComposition,
  freeTracks,
  planTemplateUpdate,
  resolveInstanceDuration,
  resolveTemplateControlOverrides,
  templateCompositionAspect,
  type TemplateControlValues,
} from '../../utils/motion-template-instances'
import { useItemsStore } from '../items-store'
import { useCompositionsStore, type SubComposition } from '../compositions-store'
import { useCompositionNavigationStore } from '../composition-navigation-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { execute } from './shared'

export interface InsertMotionTemplateOptions {
  from: number
  /**
   * Project canvas: picks the variant with its aspect ratio (none is an error)
   * and the instance fills it.
   */
  canvas: { width: number; height: number }
  durationInFrames?: number
  /** A specific track (the caller checks it is free); otherwise one is chosen or made. */
  trackId?: string
  controls?: TemplateControlValues
}

export interface InsertMotionTemplateResult {
  itemId: string
  audioItemId?: string
  compositionId: string
  trackId: string
  /** True when the project already had a copy of the template and the instance uses it. */
  reused: boolean
  /** The version of the project's copy (older than the library's when outdated). */
  projectVersion: number
  outdated: boolean
}

function newTrack(kind: 'video' | 'audio'): string {
  const tracks = useItemsStore.getState().tracks
  const orders = tracks.map((track) => track.order)
  const order = kind === 'video' ? Math.min(0, ...orders) - 1 : Math.max(0, ...orders) + 1
  const track = createClassicTrack({ tracks, kind, order })
  useItemsStore.getState().setTracks([...tracks, track])
  return track.id
}

/** The project's copy of the variant, or a fresh copy added to the project. */
function ensureTemplateComposition(
  template: MotionTemplateVariantView,
  existing: SubComposition | undefined,
): SubComposition {
  return existing ?? ensureVariantComposition(template).composition
}

function templateCompositionIds(): Set<string> {
  return new Set(
    useCompositionsStore
      .getState()
      .compositions.filter((composition) => composition.templateId)
      .map((composition) => composition.id),
  )
}

interface InstancePlan {
  from: number
  durationInFrames: number
  trackId?: string
  overrides?: CompositionItem['compositionControlOverrides']
  canvas: { width: number }
}

function placeInstance(
  template: MotionTemplateVariantView,
  composition: SubComposition,
  plan: InstancePlan,
): { visual: CompositionItem; audio?: TimelineItem } {
  const { items, tracks } = useItemsStore.getState()
  const trackId =
    plan.trackId ??
    chooseTemplateTrack({
      tracks,
      items,
      from: plan.from,
      durationInFrames: plan.durationInFrames,
      role: template.role,
      templateCompositionIds: templateCompositionIds(),
    }) ??
    newTrack('video')
  const hasAudio = compositionHasOwnedAudio({
    composition,
    compositionById: useCompositionsStore.getState().compositionById,
  })
  const visual = buildTemplateInstance({
    composition,
    label: template.name,
    trackId,
    from: plan.from,
    durationInFrames: plan.durationInFrames,
    canvas: plan.canvas,
    overrides: plan.overrides,
    linkedGroupId: hasAudio ? crypto.randomUUID() : undefined,
  })
  useItemsStore.getState()._addItem(visual)
  if (!hasAudio) return { visual }
  const audioTrackId =
    freeTracks({
      tracks: useItemsStore.getState().tracks,
      items: useItemsStore.getState().items,
      kind: 'audio',
      from: visual.from,
      durationInFrames: visual.durationInFrames,
    })[0]?.id ?? newTrack('audio')
  const audio = buildTemplateAudioCompanion({ composition, visual, trackId: audioTrackId })
  useItemsStore.getState()._addItem(audio)
  return { visual, audio }
}

/** Check everything that can fail before the store changes (execute has no rollback). */
function planInstance(
  template: MotionTemplateVariantView,
  existing: SubComposition | undefined,
  options: InsertMotionTemplateOptions,
): InstancePlan {
  const source = existing ?? {
    name: template.name,
    durationInFrames: template.durationInFrames,
    templateHold: template.hold,
    items: template.composition.items as TimelineItem[],
    compositionControls: template.composition.compositionControls,
  }
  if (
    existing &&
    wouldCreateCompositionCycle({
      parentCompositionId: useCompositionNavigationStore.getState().activeCompositionId,
      insertedCompositionId: existing.id,
      compositionById: useCompositionsStore.getState().compositionById,
    })
  ) {
    throw new Error(`"${template.name}" cannot be placed inside its own composition`)
  }
  return {
    from: options.from,
    durationInFrames: resolveInstanceDuration(source, options.durationInFrames),
    trackId: options.trackId,
    overrides: options.controls
      ? resolveTemplateControlOverrides(source, options.controls)
      : undefined,
    canvas: options.canvas,
  }
}

/**
 * Insert an instance of a library template: the variant matching the canvas's
 * aspect ratio (throws naming the variants there are when none does), copied into
 * the project once per version.
 */
export function insertMotionTemplate(
  family: MotionTemplate,
  options: InsertMotionTemplateOptions,
): InsertMotionTemplateResult {
  const template = chooseTemplateVariant(family, options.canvas)
  const existing = findTemplateComposition(
    useCompositionsStore.getState().compositions,
    template.id,
    template.aspect,
  )
  const plan = planInstance(template, existing, options)
  return execute(
    'INSERT_MOTION_TEMPLATE',
    () => {
      const composition = ensureTemplateComposition(template, existing)
      const { visual, audio } = placeInstance(template, composition, plan)
      useTimelineSettingsStore.getState().markDirty()
      const projectVersion = composition.templateVersion ?? template.version
      return {
        itemId: visual.id,
        ...(audio ? { audioItemId: audio.id } : {}),
        compositionId: composition.id,
        trackId: visual.trackId,
        reused: Boolean(existing),
        projectVersion,
        outdated: projectVersion < template.version,
      }
    },
    { templateId: template.id, from: options.from },
  )
}

export interface UpdateMotionTemplateResult {
  compositionId: string
  fromVersion: number
  toVersion: number
  instances: number
  droppedControls: string[]
}

/** The library variant the project's copy of a template came from. */
function projectVariant(family: MotionTemplate): MotionTemplateVariantView {
  const copy = findTemplateComposition(useCompositionsStore.getState().compositions, family.id)
  if (!copy) throw new Error(`This project has no copy of template "${family.name}"`)
  const aspect = templateCompositionAspect(copy)
  const template = templateVariant(family, aspect)
  if (!template) throw new Error(`"${family.name}" no longer has a ${aspect} version`)
  return template
}

/**
 * Replace the project's copy of a template with the library version of its
 * variant (all instances). Runs on the main timeline; null when the copy is
 * already current.
 */
export function updateMotionTemplate(family: MotionTemplate): UpdateMotionTemplateResult | null {
  if (useCompositionNavigationStore.getState().activeCompositionId !== null) {
    throw new Error('Go back to the main timeline to update a template')
  }
  const template = projectVariant(family)
  return execute(
    'UPDATE_MOTION_TEMPLATE',
    () => {
      const plan = planTemplateUpdate({
        template,
        compositions: useCompositionsStore.getState().compositions,
        rootItems: useItemsStore.getState().items,
      })
      if (!plan) return null
      useCompositionsStore.getState().setCompositions(plan.compositions)
      useItemsStore.getState().setItems(plan.rootItems)
      useTimelineSettingsStore.getState().markDirty()
      return {
        compositionId: plan.compositionId,
        fromVersion: plan.fromVersion,
        toVersion: plan.toVersion,
        instances: plan.instances,
        droppedControls: plan.droppedControls,
      }
    },
    { templateId: template.id },
  )
}

/** Set an instance's control values by control name (null resets one to the template's value). */
export function setMotionTemplateControlValues(
  itemId: string,
  values: TemplateControlValues,
): CompositionItem {
  return execute(
    'SET_TEMPLATE_CONTROLS',
    () => {
      const item = useItemsStore.getState().itemById[itemId]
      if (!item || item.type !== 'composition')
        throw new Error(`id: "${itemId}" is not a composition (template instance) item`)
      const composition = useCompositionsStore.getState().compositionById[item.compositionId]
      if (!composition) throw new Error(`id: the composition of "${itemId}" is missing`)
      const overrides = resolveTemplateControlOverrides(
        composition,
        values,
        item.compositionControlOverrides,
      )
      useItemsStore.getState()._updateItem(itemId, { compositionControlOverrides: overrides })
      useTimelineSettingsStore.getState().markDirty()
      return { ...item, compositionControlOverrides: overrides }
    },
    { itemId },
  )
}

/**
 * Make sure the project has a copy of a template variant (for dragging it onto
 * the timeline as a composition). Returns the ids added, so an abandoned drag can
 * take them out again with discardUnusedTemplateCompositions.
 */
export function ensureMotionTemplateComposition(
  family: MotionTemplate,
  canvas: { width: number; height: number },
): { composition: SubComposition; addedIds: string[] } {
  return ensureVariantComposition(chooseTemplateVariant(family, canvas))
}

function ensureVariantComposition(template: MotionTemplateVariantView): {
  composition: SubComposition
  addedIds: string[]
} {
  const existing = findTemplateComposition(
    useCompositionsStore.getState().compositions,
    template.id,
    template.aspect,
  )
  if (existing) return { composition: existing, addedIds: [] }
  const copy = cloneTemplateCompositions(template)
  for (const composition of copy.compositions)
    useCompositionsStore.getState().addComposition(composition)
  return {
    composition: copy.root,
    addedIds: copy.compositions.map((composition) => composition.id),
  }
}

/** Remove compositions a drag added when nothing ended up using them. */
export function discardUnusedTemplateCompositions(addedIds: readonly string[]): void {
  if (addedIds.length === 0) return
  const { compositions } = useCompositionsStore.getState()
  const used = [...useItemsStore.getState().items, ...compositions.flatMap((c) => c.items)].some(
    (item) => item.compositionId === addedIds[0],
  )
  if (used) return
  const added = new Set(addedIds)
  useCompositionsStore
    .getState()
    .setCompositions(compositions.filter((composition) => !added.has(composition.id)))
}

function withHold<T extends TimelineItem>(item: T, hold: SubComposition['templateHold']): T {
  const next = { ...item, templateHold: hold ? { ...hold } : undefined }
  if (!hold) delete next.templateHold
  return next
}

/**
 * After a project composition was saved to the library as a template variant:
 * tag it as that variant's current version (so it is not shown as outdated) and
 * give its instances on this level and nested ones the variant's hold.
 */
export function syncSavedTemplateComposition(
  compositionId: string,
  template: MotionTemplateVariantView,
): void {
  const hold = template.hold
  const tags = {
    templateId: template.id,
    templateVersion: template.version,
    templateAspect: template.aspect,
    templateHold: hold ? { ...hold } : undefined,
  }
  const retag = <T extends TimelineItem>(item: T): T =>
    item.compositionId === compositionId ? withHold(item, hold) : item
  const { compositions, setCompositions } = useCompositionsStore.getState()
  setCompositions(
    compositions.map((composition) =>
      composition.id === compositionId
        ? { ...composition, ...tags }
        : { ...composition, items: composition.items.map(retag) },
    ),
  )
  const items = useItemsStore.getState().items
  if (items.some((item) => item.compositionId === compositionId))
    useItemsStore.getState().setItems(items.map(retag))
  useTimelineSettingsStore.getState().markDirty()
}
