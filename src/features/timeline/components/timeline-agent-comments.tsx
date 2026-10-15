import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'
import { startAgentComment, useAgentNotesStore } from '@/shared/state/agent-notes'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { useTimelineStore } from '../stores/timeline-store'
import { useZoomStore } from '../stores/zoom-store'

/**
 * Concise toolbar button (the N shortcut does the same): write a note for the
 * agent at the playhead. The composer opens on the Notes tray, where the note
 * then sits; `shred notes` reads it.
 */
export const AgentCommentButton = memo(function AgentCommentButton({
  btnSize,
}: {
  btnSize: React.CSSProperties
}) {
  const { t } = useTranslation()
  const hasProject = useAgentNotesStore((s) => s.projectId !== null)
  const label = t('timeline.concise.comment.button')

  return (
    <Button
      variant="ghost"
      size="icon"
      style={btnSize}
      disabled={!hasProject}
      onClick={() => startAgentComment()}
      aria-label={label}
      data-tooltip={label}
      data-testid="timeline-agent-comment-button"
    >
      <MessageSquarePlus className="w-3.5 h-3.5" />
    </Button>
  )
})

// Where the last context menu was opened, so "Add note for agent" can note the
// frame that was right-clicked. One capture listener serves every timeline menu.
let lastMenuClientX: number | null = null
if (typeof window !== 'undefined') {
  window.addEventListener(
    'contextmenu',
    (event) => {
      lastMenuClientX = event.clientX
    },
    true,
  )
}

/** The timeline frame under a screen x (follows scroll and zoom); null off the timeline. */
export function timelineFrameAtClientX(clientX: number): number | null {
  const ruler = document.querySelector<HTMLElement>('[data-timeline-committed-surface="ruler"]')
  const pixelsPerSecond = useZoomStore.getState().pixelsPerSecond
  if (!ruler || !(pixelsPerSecond > 0)) return null
  const fps = useTimelineStore.getState().fps || 30
  const offset = clientX - ruler.getBoundingClientRect().left
  if (offset < 0) return null
  return Math.round((offset / pixelsPerSecond) * fps)
}

/** Pause, move to `frame` and open the note composer there with the selected clips. */
export function noteForAgentAt(frame: number): void {
  const playback = usePlaybackStore.getState()
  playback.pause()
  playback.setCurrentFrame(frame)
  useAgentNotesStore.getState().openComposer(frame, useSelectionStore.getState().selectedItemIds)
}

/**
 * "Add note for agent", the first item of every timeline context menu. It
 * notes the right-clicked frame (or the playhead, with `atPlayhead` or off the
 * timeline), with whatever is selected.
 */
export function AddAgentNoteMenuItem({ atPlayhead = false }: { atPlayhead?: boolean }) {
  const { t } = useTranslation()
  const hasProject = useAgentNotesStore((s) => s.projectId !== null)
  return (
    <>
      <ContextMenuItem
        disabled={!hasProject}
        onSelect={() => {
          const clicked =
            atPlayhead || lastMenuClientX === null ? null : timelineFrameAtClientX(lastMenuClientX)
          const frame = clicked ?? usePlaybackStore.getState().currentFrame
          // After the menu has closed and handed focus back, so the composer keeps it.
          window.setTimeout(() => noteForAgentAt(frame), 0)
        }}
        data-testid="context-menu-add-agent-note"
      >
        <MessageSquarePlus className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        {t('timeline.notes.addForAgent')}
      </ContextMenuItem>
      <ContextMenuSeparator />
    </>
  )
}
