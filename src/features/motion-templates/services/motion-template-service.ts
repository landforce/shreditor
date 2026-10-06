/**
 * Editor side of the motion template library: save a composition as a
 * template, insert one at the playhead, update a project's copy.
 */
import {
  buildMotionTemplate,
  findMotionTemplate,
  templateVariant,
  type MotionTemplate,
  type MotionTemplateCategory,
  type MotionTemplateControlInput,
  type MotionTemplateHold,
  type MotionTemplateMediaRef,
  type StoredComposition,
} from '@/shared/motion-templates/template-core.mjs'
import { cloneTemplateVariant } from '@/shared/motion-templates/template-variants.mjs'
import { aspectKey } from '@/shared/projects/aspect.mjs'
import type { FormatRole } from '@formats/registry.mjs'
import { associateMediaWithProject, getMedia } from '@/infrastructure/storage'
import {
  listMotionTemplates,
  readMotionTemplate,
  saveMotionTemplate,
  writeMotionTemplateThumbnail,
} from '@/infrastructure/storage/workspace-fs/motion-templates'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import {
  buildSubCompositionInput,
  discardUnusedTemplateCompositions,
  ensureMotionTemplateComposition,
  getCurrentTimelineSnapshot,
  getEffectiveCompositions,
  importCanvasRenderOrchestrator,
  insertMotionTemplate,
  resolveMediaUrl,
  resolveMediaUrls,
  syncSavedTemplateComposition,
  useCompositionNavigationStore,
  type InsertMotionTemplateResult,
  type SubComposition,
} from '../deps/timeline'
import { useProjectStore } from '../deps/projects'
import { clearMediaDragData, setMediaDragData, useMediaLibraryStore } from '../deps/media-library'

const THUMBNAIL_EDGE = 480

/** The open project's canvas (templates pick the variant with its aspect ratio). */
export function projectCanvas(): { width: number; height: number } {
  const metadata = useProjectStore.getState().currentProject?.metadata
  return {
    width: metadata?.width ?? DEFAULT_PROJECT_WIDTH,
    height: metadata?.height ?? DEFAULT_PROJECT_HEIGHT,
  }
}

/** The open project's aspect ratio key ("9:16", "16:9", ...). */
export const projectAspect = (): string => {
  const canvas = projectCanvas()
  return aspectKey(canvas.width, canvas.height)
}

/** Thrown when a template has no variant for the project's aspect ratio. */
export class MissingTemplateVariantError extends Error {
  constructor(readonly aspect: string) {
    super(`No ${aspect} version`)
    this.name = 'MissingTemplateVariantError'
  }
}

/** Thrown when a template uses media this workspace does not have. */
export class MissingTemplateMediaError extends Error {
  constructor(readonly missing: MotionTemplateMediaRef[]) {
    super(`Missing media: ${missing.map((ref) => ref.fileName).join(', ')}`)
    this.name = 'MissingTemplateMediaError'
  }
}

export async function findMissingTemplateMedia(
  template: MotionTemplate,
): Promise<MotionTemplateMediaRef[]> {
  const found = await Promise.all(template.media.map((ref) => getMedia(ref.mediaId)))
  return template.media.filter((_, index) => !found[index])
}

/** Link the template's media to the open project so it is not reported missing. */
async function linkTemplateMedia(template: MotionTemplate, projectId: string): Promise<void> {
  if (template.media.length === 0) return
  const linked = new Set(useMediaLibraryStore.getState().mediaItems.map((media) => media.id))
  const toLink = template.media.filter((ref) => !linked.has(ref.mediaId))
  if (toLink.length === 0) return
  for (const ref of toLink) await associateMediaWithProject(projectId, ref.mediaId)
  await useMediaLibraryStore.getState().refreshMediaItems()
}

/**
 * Insert an instance at the playhead: the variant for the project's aspect ratio
 * (MissingTemplateVariantError when there is none), placed 1:1. Refuses
 * (MissingTemplateMediaError) when media is missing.
 */
export async function insertTemplateAtPlayhead(
  template: MotionTemplate,
): Promise<InsertMotionTemplateResult> {
  const aspect = projectAspect()
  if (!template.variants[aspect]) throw new MissingTemplateVariantError(aspect)
  const missing = await findMissingTemplateMedia(template)
  if (missing.length > 0) throw new MissingTemplateMediaError(missing)
  const project = useProjectStore.getState().currentProject
  if (project) await linkTemplateMedia(template, project.id)
  const result = insertMotionTemplate(template, {
    from: Math.max(0, usePlaybackStore.getState().currentFrame),
    canvas: projectCanvas(),
  })
  useSelectionStore.getState().selectItems([result.itemId])
  return result
}

/** The live compositions (the one being edited reads from the timeline). */
function liveCompositions(): SubComposition[] {
  return getEffectiveCompositions(getCurrentTimelineSnapshot())
}

/** The composition as it is now, including unsaved edits when it is open. */
export function getLiveComposition(compositionId: string): SubComposition | undefined {
  return liveCompositions().find((composition) => composition.id === compositionId)
}

function thumbnailSize(composition: Pick<SubComposition, 'width' | 'height'>) {
  const scale = THUMBNAIL_EDGE / Math.max(composition.width, composition.height)
  return {
    width: Math.max(16, Math.round(composition.width * scale)),
    height: Math.max(16, Math.round(composition.height * scale)),
  }
}

/**
 * A transparent WebP (the panel shows it on a checkerboard) of the hold frame,
 * else the middle frame (when a lower third is fully in).
 */
async function renderThumbnail(
  composition: SubComposition,
  hold?: MotionTemplateHold | null,
): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== 'function') return null
  const mediaIds = [...new Set(composition.items.flatMap((item) => item.mediaId ?? []))]
  await Promise.all(mediaIds.map((mediaId) => resolveMediaUrl(mediaId)))
  const input = buildSubCompositionInput(composition)
  const tracks = await resolveMediaUrls(input.tracks, { useProxy: false })
  const { renderSingleFrame } = await importCanvasRenderOrchestrator()
  return renderSingleFrame({
    composition: { ...input, tracks, backgroundColor: 'rgba(0, 0, 0, 0)' },
    frame: hold ? hold.start : Math.floor(composition.durationInFrames / 2),
    ...thumbnailSize(composition),
    quality: 0.85,
    format: 'image/webp',
  })
}

export interface SaveTemplateInput {
  compositionId: string
  name: string
  category: MotionTemplateCategory
  role?: FormatRole
  controls: MotionTemplateControlInput[]
  /** Where a longer instance freezes (null: none). */
  hold: MotionTemplateHold | null
}

/** The library template a save with this name would update (same name = new version). */
export async function findTemplateByName(name: string): Promise<MotionTemplate | null> {
  return findMotionTemplate(await listMotionTemplates(), name.trim())
}

/** What saving a composition updates: the template it was copied from (that variant). */
export async function findSourceTemplate(compositionId: string): Promise<MotionTemplate | null> {
  const templateId = getLiveComposition(compositionId)?.templateId
  return templateId ? readMotionTemplate(templateId) : null
}

/**
 * Save a composition as the template variant for its aspect ratio. A copy of a
 * library template updates that template's variant (and the copy is tagged as
 * its new version); otherwise a template with the same name gets a new version;
 * otherwise it is a new template.
 */
export async function saveCompositionAsTemplate(input: SaveTemplateInput): Promise<MotionTemplate> {
  const compositions = liveCompositions()
  const root = compositions.find((composition) => composition.id === input.compositionId)
  if (!root) throw new Error('The composition no longer exists')
  const previous =
    (await findSourceTemplate(input.compositionId)) ?? (await findTemplateByName(input.name))
  const mediaById = useMediaLibraryStore.getState().mediaById
  const template = buildMotionTemplate({
    rootCompositionId: input.compositionId,
    compositions: compositions as unknown as StoredComposition[],
    name: input.name,
    category: input.category,
    role: input.role,
    controls: input.controls,
    hold: input.hold,
    previous,
    mediaFileName: (mediaId) => mediaById[mediaId]?.fileName ?? mediaId,
  })
  const aspect = aspectKey(root.width, root.height)
  const thumbnail = await renderThumbnail(root, input.hold).catch(() => null)
  await saveMotionTemplate(template, previous?.version ?? 0, { [aspect]: thumbnail })
  if (root.templateId === template.id)
    syncSavedTemplateComposition(root.id, templateVariant(template, aspect)!)
  return template
}

/**
 * "Make a 16:9 version": a variant for the project's aspect ratio copied from the
 * closest one and re-laid for the canvas, saved to the library, inserted at the
 * playhead and opened for editing (Save as Template on it updates that variant).
 */
export async function makeTemplateVariantForProject(
  template: MotionTemplate,
): Promise<InsertMotionTemplateResult> {
  const canvas = projectCanvas()
  const aspect = aspectKey(canvas.width, canvas.height)
  const { template: next } = cloneTemplateVariant(template, { aspect, canvas })
  await saveMotionTemplate(next, template.version)
  const result = await insertTemplateAtPlayhead(next)
  const composition = getLiveComposition(result.compositionId)
  const variant = next.variants[aspect]!
  if (composition)
    void renderThumbnail(composition, variant.hold)
      .then((blob) => blob && writeMotionTemplateThumbnail(next.id, variant.thumbnail, blob))
      .catch(() => undefined)
  useCompositionNavigationStore
    .getState()
    .enterComposition(result.compositionId, `${next.name} (${aspect})`, result.itemId)
  return result
}

let dragAddedIds: string[] = []

/**
 * Start dragging a template onto the timeline: the project gets its copy of
 * the template now and the drag carries it as a composition, so the timeline's
 * own composition drop places it. Media must already be known to be present.
 */
export function startTemplateDrag(template: MotionTemplate, dataTransfer: DataTransfer): void {
  const { composition, addedIds } = ensureMotionTemplateComposition(template, projectCanvas())
  dragAddedIds = addedIds
  const data = {
    type: 'composition' as const,
    compositionId: composition.id,
    name: template.name,
    durationInFrames: composition.durationInFrames,
    width: composition.width,
    height: composition.height,
  }
  dataTransfer.effectAllowed = 'copy'
  dataTransfer.setData('application/json', JSON.stringify(data))
  setMediaDragData(data)
  const projectId = useProjectStore.getState().currentProject?.id
  if (projectId) void linkTemplateMedia(template, projectId)
}

/** End a drag: take the copy out again when the drop did not use it. */
export function endTemplateDrag(): void {
  clearMediaDragData()
  const added = dragAddedIds
  dragAddedIds = []
  window.setTimeout(() => discardUnusedTemplateCompositions(added), 0)
}
