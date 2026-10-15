import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, MessageSquarePlus, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { openAgentNotes, startAgentComment, useAgentNotesStore } from '@/shared/state/agent-notes'
import { usePlaybackStore } from '@/shared/state/playback'
import { formatTimecodeCompact } from '@/shared/utils/time-utils'
import { useTimelineCommittedZoomContext } from '../contexts/timeline-zoom-context'
import { useTimelineStore } from '../stores/timeline-store'

/**
 * Concise toolbar button (and the N shortcut's target): write a comment for the
 * agent pinned to the playhead. It lands in the project's agent notes, which
 * `shred notes` reads.
 */
export const AgentCommentButton = memo(function AgentCommentButton({
  btnSize,
}: {
  btnSize: React.CSSProperties
}) {
  const { t } = useTranslation()
  const composer = useAgentNotesStore((s) => s.composer)
  const failed = useAgentNotesStore((s) => s.failed)
  const hasProject = useAgentNotesStore((s) => s.projectId !== null)
  const fps = useTimelineStore((s) => s.fps) || 30
  const [draft, setDraft] = useState('')
  const label = t('timeline.concise.comment.button')

  const send = async () => {
    const text = draft.trim()
    const store = useAgentNotesStore.getState()
    if (!text || !store.composer) return
    const { frame, itemIds } = store.composer
    if (await store.add({ text, frame, itemIds })) {
      setDraft('')
      store.closeComposer()
    }
  }

  return (
    <Popover
      open={composer !== null}
      onOpenChange={(open) =>
        open ? startAgentComment() : useAgentNotesStore.getState().closeComposer()
      }
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          style={btnSize}
          disabled={!hasProject}
          aria-label={label}
          data-tooltip={label}
          data-testid="timeline-agent-comment-button"
        >
          <MessageSquarePlus className="w-3.5 h-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 p-2">
        {composer && (
          <>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="rounded bg-amber-500/15 px-1 font-mono text-[10px] leading-4 text-amber-700 tabular-nums dark:text-amber-400">
                {formatTimecodeCompact(composer.frame, fps)}
              </span>
              <span className="whitespace-nowrap font-medium">
                {t('timeline.concise.comment.title')}
              </span>
              {composer.itemIds.length > 0 && (
                <span className="ml-auto whitespace-nowrap text-muted-foreground">
                  {t('timeline.concise.comment.selected', { count: composer.itemIds.length })}
                </span>
              )}
            </div>
            <Textarea
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  void send()
                }
              }}
              placeholder={t('timeline.concise.comment.placeholder')}
              aria-label={t('timeline.concise.comment.title')}
              className="min-h-20 resize-none text-xs"
              data-testid="timeline-agent-comment-input"
            />
            {failed && (
              <p className="text-xs text-destructive">{t('editor.concise.pass.noteFailed')}</p>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">
                {t('timeline.concise.comment.hint')}
              </span>
              <Button
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => void send()}
                disabled={!draft.trim()}
              >
                <Send className="h-3.5 w-3.5" />
                {t('timeline.concise.comment.send')}
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
})

/** Open comments for the agent as pins along the ruler; a click moves the playhead there. */
export const TimelineAgentCommentPins = memo(function TimelineAgentCommentPins() {
  const { t } = useTranslation()
  const notes = useAgentNotesStore((s) => s.notes)
  const { frameToPixels } = useTimelineCommittedZoomContext()
  const pins = useMemo(
    () => openAgentNotes(notes).filter((note) => note.frame !== undefined),
    [notes],
  )

  if (pins.length === 0) return null
  return (
    <div className="absolute inset-0 pointer-events-none" data-testid="timeline-agent-comments">
      {pins.map((note) => (
        <button
          key={note.id}
          type="button"
          className="pointer-events-auto absolute bottom-0.5 flex h-3.5 w-3.5 -translate-x-1/2 items-center justify-center rounded-sm bg-amber-500 text-white shadow-sm hover:bg-amber-400"
          style={{ left: `${frameToPixels(note.frame!)}px`, zIndex: 16 }}
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            usePlaybackStore.getState().setCurrentFrame(note.frame!)
          }}
          aria-label={t('timeline.concise.comment.pin', { text: note.text })}
          data-tooltip={note.text}
          data-tooltip-side="bottom"
        >
          <MessageSquare className="h-2.5 w-2.5" />
        </button>
      ))}
    </div>
  )
})
