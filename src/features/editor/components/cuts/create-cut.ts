/**
 * The editor's "New cut…" (docs/cuts.md): a copy of a cut's saved state as a
 * new project in the same group, optionally re-fitted for another aspect.
 * Mirrors `shred cut new`: media shared by id (the bin list copied), format,
 * kit, brief and plan copied, a first pass record written.
 */

import type { Project } from '@/types/project'
import type { TextItem } from '@/types/timeline'
import type { TextStyleDefinition } from '@/types/text-style'
import {
  associateMediaWithProject,
  createProject,
  getAllProjects,
  getMedia,
  getProject,
  getProjectMediaIds,
  readProjectStamp,
  writeNewCutAgentFiles,
} from '@/infrastructure/storage'
import {
  cutCanvasForAspect,
  cutCreatedPassRecord,
  cutGroupName,
  cutGroupOf,
  cutLabelOf,
  cutProjectName,
  cutsInGroup,
  isMainCut,
  nextCutOrder,
  portableTextOverrides,
  projectAspect,
  refitTimeline,
  type CutReviewReason,
} from '@/shared/projects/cuts.mjs'
import {
  textStyleVariantFor,
  toTextStyleFamily,
} from '@/shared/typography/text-styles/text-style-family.mjs'
import { buildApplyTextStyleUpdates } from '@/shared/typography/text-styles/text-style-resolve'

type Timeline = NonNullable<Project['timeline']>
type Canvas = { width: number; height: number }

export interface NewCutResult {
  id: string
  /** Items worth a look after a re-fit, by reason. */
  review: Array<{ id: string; name: string; reason: CutReviewReason }>
  /** Text styles with no look for the new aspect (their items were only re-anchored). */
  stylesWithoutAspect: string[]
}

export class CutLabelTakenError extends Error {}

const PROJECT_ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

function newProjectId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => PROJECT_ID_CHARS[b % 62]).join('')
}

async function mediaSizes(timeline: Timeline): Promise<Map<string, Canvas>> {
  const ids = [...new Set(timeline.items.map((item) => item.mediaId).filter(Boolean))] as string[]
  const sizes = new Map<string, Canvas>()
  await Promise.all(
    ids.map(async (id) => {
      const media = await getMedia(id).catch(() => undefined)
      if (media?.width && media.height) sizes.set(id, { width: media.width, height: media.height })
    }),
  )
  return sizes
}

/** Styled text takes its style's look for the new canvas and keeps its non-position overrides. */
function restyleText(timeline: Timeline, canvas: Canvas, fromAspect: string) {
  const toAspect = projectAspect({ metadata: canvas })
  const styles = new Map(
    (timeline.textStyles ?? []).map((style) => {
      const family = toTextStyleFamily(style, fromAspect) as TextStyleDefinition
      return [family.id, family]
    }),
  )
  const missing = new Set<string>()
  const items = timeline.items.map((item) => {
    if (item.type !== 'text' || !item.textStyleId) return item
    const style = styles.get(item.textStyleId)
    if (!style || !textStyleVariantFor(style, toAspect)) {
      missing.add(style?.name ?? item.textStyleId)
      return item
    }
    const text = item as TextItem
    const kept = portableTextOverrides(text)
    const own = Object.fromEntries(kept.map((key) => [key, (text as Record<string, unknown>)[key]]))
    return {
      ...text,
      ...buildApplyTextStyleUpdates(text, style, canvas),
      ...own,
      textStyleOverrides: kept.length ? (kept as TextItem['textStyleOverrides']) : undefined,
    }
  })
  return { timeline: { ...timeline, items } as Timeline, missing: [...missing] }
}

/**
 * Make a cut from `sourceId`'s saved state. `aspect` null keeps its canvas.
 * Throws CutLabelTakenError when the group already has the label.
 */
export async function createCut(
  sourceId: string,
  label: string,
  aspect: string | null,
): Promise<NewCutResult> {
  const source = await getProject(sourceId)
  if (!source) throw new Error(`Project not found: ${sourceId}`)
  const projects = await getAllProjects()
  const groupId = cutGroupOf(source)!
  const members = cutsInGroup(projects, groupId)
  const wanted = label.trim()
  if (members.some((m) => cutLabelOf(m).toLowerCase() === wanted.toLowerCase()))
    throw new CutLabelTakenError(wanted)
  const main = members.find((m) => isMainCut(m)) ?? null

  const from = { width: source.metadata.width, height: source.metadata.height }
  const to = aspect ? cutCanvasForAspect(aspect, from) : from
  const resized = to.width !== from.width || to.height !== from.height
  let timeline = source.timeline
  let review: NewCutResult['review'] = []
  let stylesWithoutAspect: string[] = []
  if (timeline && resized) {
    const sizes = await mediaSizes(timeline)
    const fit = refitTimeline(timeline, from, to, { mediaSize: (id) => sizes.get(id) })
    const styled = restyleText(fit.timeline, to, projectAspect(source))
    timeline = styled.timeline
    review = fit.review
    stylesWithoutAspect = styled.missing
  }

  const now = Date.now()
  const {
    thumbnail: _thumbnail,
    thumbnailId: _thumbnailId,
    rootFolderHandle: _handle,
    ...rest
  } = source
  const id = newProjectId()
  await createProject({
    ...rest,
    id,
    name: cutProjectName(cutGroupName(main, source), wanted),
    createdAt: now,
    updatedAt: now,
    metadata: { ...source.metadata, ...to },
    cut: { group: groupId, label: wanted, order: nextCutOrder(members) },
    ...(timeline ? { timeline } : {}),
  })
  for (const mediaId of await getProjectMediaIds(sourceId))
    await associateMediaWithProject(id, mediaId)
  const stamp = await readProjectStamp(id)
  await writeNewCutAgentFiles(
    sourceId,
    id,
    cutCreatedPassRecord({
      label: wanted,
      fromLabel: cutLabelOf(source),
      fromId: sourceId,
      revision: stamp?.revision ?? null,
      timeline,
      by: 'user',
    }),
  )
  return { id, review, stylesWithoutAspect }
}
