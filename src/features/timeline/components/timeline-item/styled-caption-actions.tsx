import { useMemo } from 'react'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu'
import type { AudioItem, TextItem, TimelineItem, VideoItem } from '@/types/timeline'
import type { TextStyleDefinition } from '@/types/text-style'
import { useLibraryTextStylesStore, useProjectTextStylesStore } from '@/shared/state/text-styles'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import { aspectKey } from '@/shared/projects/aspect.mjs'
import {
  addClonedTextStyleVariant,
  textStyleVariantFor,
} from '@/shared/typography/text-styles/text-style-family.mjs'
import { useItemsStore } from '../../stores/items-store'
import { useTimelineSettingsStore } from '../../stores/timeline-settings-store'
import { insertStyledCaptions } from '../../stores/actions/text-style-actions'
import { useProjectStore } from '../../deps/projects'
import { mediaTranscriptionService } from '../../deps/media-transcription-service'

type CaptionableClip = AudioItem | VideoItem

const overlaps = (items: TimelineItem[], trackId: string, from: number, to: number) =>
  items.some(
    (item) =>
      item.trackId === trackId && item.from < to && item.from + item.durationInFrames > from,
  )

function projectCanvas(): { width: number; height: number } {
  const metadata = useProjectStore.getState().currentProject?.metadata
  return {
    width: metadata?.width ?? DEFAULT_PROJECT_WIDTH,
    height: metadata?.height ?? DEFAULT_PROJECT_HEIGHT,
  }
}

/** The clip's earlier styled captions: regenerating replaces them. */
function previousStyledCaptions(items: TimelineItem[], clipId: string): string[] {
  return items
    .filter(
      (item) => item.type === 'text' && item.captionSource?.clipId === clipId && item.textStyleId,
    )
    .map((item) => item.id)
}

/** The format's Captions track when it is free for the captions, else a new one above the clip. */
function captionTrackFor(clip: CaptionableClip, captions: TextItem[], replaced: Set<string>) {
  const { items, tracks } = useItemsStore.getState()
  const remaining = items.filter((item) => !replaced.has(item.id))
  const from = captions[0]!.from
  const to = Math.max(...captions.map((item) => item.from + item.durationInFrames))
  const free = tracks.find(
    (track) =>
      track.formatRole === 'captions' && !track.locked && !overlaps(remaining, track.id, from, to),
  )
  if (free) return { trackId: free.id, newTrack: null }
  const clipOrder = tracks.find((track) => track.id === clip.trackId)?.order ?? 0
  const newTrack = {
    ...mediaTranscriptionService.buildCaptionTrackAbove(tracks, clipOrder),
    formatRole: 'captions' as const,
  }
  return { trackId: newTrack.id, newTrack }
}

/** The style with a version for the project's aspect (cloned from its closest when it has none). */
function fitToProject(style: TextStyleDefinition): TextStyleDefinition {
  const { width, height } = projectCanvas()
  const aspect = aspectKey(width, height)
  if (textStyleVariantFor(style, aspect)) return style
  const { style: fitted } = addClonedTextStyleVariant(style, aspect)
  return { ...fitted, version: style.version + 1, updatedAt: Date.now() }
}

/** Caption a clip from its stored transcript with a caption style. Returns the caption count. */
async function addStyledCaptions(
  clip: CaptionableClip,
  picked: TextStyleDefinition,
): Promise<number> {
  const style = fitToProject(picked)
  const transcript = clip.mediaId
    ? await mediaTranscriptionService.getTranscript(clip.mediaId)
    : null
  if (!transcript) throw new Error('no-transcript')
  const built = mediaTranscriptionService.buildStyledCaptionItems({
    clip,
    segments: transcript.segments,
    style,
    trackId: '',
    timelineFps: useTimelineSettingsStore.getState().fps,
    canvas: projectCanvas(),
  })
  if (built.length === 0) return 0
  const replaced = previousStyledCaptions(useItemsStore.getState().items, clip.id)
  const { trackId, newTrack } = captionTrackFor(clip, built, new Set(replaced))
  insertStyledCaptions(
    built.map((item) => ({ ...item, trackId })),
    style,
    newTrack,
    replaced,
  )
  return built.length
}

/**
 * "Captions with a style" in a clip's context menu: the caption styles of the
 * project and library. A style with no version for the project's aspect gets
 * one, cloned from its closest, when it is used.
 */
export function StyledCaptionActions({ t, clip }: { t: TFunction; clip?: CaptionableClip }) {
  const projectStyles = useProjectTextStylesStore((s) => s.styles)
  const libraryStyles = useLibraryTextStylesStore((s) => s.styles)
  const styles = useMemo(() => {
    const own = new Set(projectStyles.map((style) => style.id))
    return [...projectStyles, ...libraryStyles.filter((style) => !own.has(style.id))].filter(
      (style) => style.role === 'caption',
    )
  }, [libraryStyles, projectStyles])

  if (!clip) return null
  const { width, height } = projectCanvas()
  const aspect = aspectKey(width, height)
  const run = (style: TextStyleDefinition) =>
    addStyledCaptions(clip, style)
      .then((count) =>
        count > 0
          ? toast.success(t('textStyles.captionsAdded', { count, name: style.name }))
          : toast.info(t('textStyles.noSpeech')),
      )
      .catch((error: unknown) =>
        toast.error(
          error instanceof Error && error.message === 'no-transcript'
            ? t('textStyles.noTranscript')
            : String(error),
        ),
      )

  if (styles.length === 0) {
    return <ContextMenuItem disabled>{t('textStyles.noCaptionStyles')}</ContextMenuItem>
  }
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>{t('textStyles.captionsWithStyle')}</ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-48">
        {styles.map((style) => (
          <ContextMenuItem key={style.id} onClick={() => void run(style)}>
            {style.name}
            {textStyleVariantFor(style, aspect) ? null : (
              <span className="ml-1 text-[10px] text-muted-foreground">
                {t('textStyles.noVersion', { aspect })}
              </span>
            )}
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}
