import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ClipboardCopy,
  Eye,
  EyeOff,
  MessageSquare,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { noteAnchorFor, resolveNoteSpan } from '@/shared/projects/note-anchor.mjs'
import {
  doneAgentNotes,
  openAgentNotes,
  startAgentComment,
  useAgentNotesStore,
  useNotesHandOff,
  waitingAgentNotes,
} from '@/shared/state/agent-notes'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { formatTimecodeCompact } from '@/shared/utils/time-utils'
import { cn } from '@/shared/ui/cn'
import { useTimelineCommittedZoomContext } from '../contexts/timeline-zoom-context'
import { AddAgentNoteMenuItem } from './timeline-agent-comments'
import {
  MAX_CARD_PX,
  placeNotes,
  useNotesLaneHeight,
  useNotesLaneVisible,
  type PlacedNote,
} from './timeline-notes-lane-layout'
import { useItemsStore } from '../stores/items-store'
import { useTimelineStore } from '../stores/timeline-store'
import { useZoomStore } from '../stores/zoom-store'
import { applyTimelineLiveGeometry } from '../utils/timeline-live-geometry'

/** Pixels the pointer moves before a press on the lane becomes a range drag. */
const DRAG_START_PX = 4

/** A small icon button in the tray's header cell. */
function TrayButton({
  label,
  onClick,
  disabled,
  pressed,
  testId,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
  testId: string
  children: React.ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-5 w-5 shrink-0"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      data-tooltip={label}
      // The tray sits at the timeline's left edge: a tooltip above would run off screen.
      data-tooltip-side="right"
      data-testid={testId}
    >
      {children}
    </Button>
  )
}

/** A slow amber pulse behind the tray while notes wait for the agent to pick them up. */
function WaitingPulse() {
  return (
    <span
      className="pointer-events-none absolute inset-0 animate-pulse bg-amber-400/25 dark:bg-amber-400/15"
      aria-hidden
      data-testid="timeline-notes-waiting"
    />
  )
}

/**
 * The open-note count, which is also the copy of "check my notes and edit" for
 * the user to paste to the agent: notes only reach it when it is asked to read them.
 */
function CopyForAgentButton() {
  const { t } = useTranslation()
  const { open, waiting, copied, copy } = useNotesHandOff()
  if (!open) return null
  const label = copied
    ? t('timeline.notes.copied')
    : t(waiting ? 'timeline.notes.copyWaiting' : 'timeline.notes.copy', { count: waiting })
  return (
    <Button
      size="sm"
      className="h-5 shrink-0 gap-1 rounded bg-amber-500 px-1.5 text-[10px] font-semibold text-white tabular-nums hover:bg-amber-600"
      onClick={copy}
      aria-label={label}
      data-tooltip={label}
      data-tooltip-side="right"
      data-testid="timeline-notes-copy"
    >
      {copied ? <Check className="h-3 w-3" /> : <ClipboardCopy className="h-3 w-3" />}
      {open}
    </Button>
  )
}

/**
 * The tray's cell in the track-header column: label and the open count (the
 * copy for the agent) above the show-done eye and add. It pulses, with the lane,
 * while open notes wait for the agent to pick them up.
 */
export const TimelineNotesLaneHeader = memo(function TimelineNotesLaneHeader({
  compact,
}: {
  compact: boolean
}) {
  const { t } = useTranslation()
  const visible = useNotesLaneVisible()
  const height = useNotesLaneHeight()
  const notes = useAgentNotesStore((s) => s.notes)
  const showDone = useAgentNotesStore((s) => s.showDone)
  const openCount = useMemo(() => openAgentNotes(notes).length, [notes])
  const doneCount = useMemo(() => doneAgentNotes(notes).length, [notes])
  const waiting = useMemo(() => waitingAgentNotes(notes).length, [notes])
  if (!visible) return null

  const store = useAgentNotesStore.getState()
  const toggleLabel = showDone
    ? t('timeline.notes.hideDone')
    : t('timeline.notes.showDone', { count: doneCount })
  // Concise's narrow column has no room for the word; the icon and count say it.
  const showLabel = !compact
  return (
    <div
      className={cn(
        'relative flex shrink-0 flex-col justify-center gap-1 border-b border-border bg-amber-500/[0.06]',
        compact ? 'px-1' : 'px-3',
      )}
      style={{ height }}
      data-testid="timeline-notes-header"
    >
      {waiting > 0 && <WaitingPulse />}
      <div className="relative flex min-w-0 items-center gap-1">
        {!(compact && openCount > 0) && (
          <MessageSquare
            className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
        )}
        {showLabel && (
          <span className="truncate text-xs font-semibold">{t('timeline.notes.label')}</span>
        )}
        <CopyForAgentButton />
      </div>
      <div className="relative flex shrink-0 items-center">
        <TrayButton
          label={toggleLabel}
          onClick={() => store.setShowDone(!showDone)}
          disabled={doneCount === 0 && !showDone}
          pressed={showDone}
          testId="timeline-notes-show-done"
        >
          {showDone ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
        </TrayButton>
        <TrayButton
          label={t('timeline.concise.comment.button')}
          onClick={() => startAgentComment()}
          testId="timeline-notes-add"
        >
          <Plus className="h-3 w-3" />
        </TrayButton>
      </div>
    </div>
  )
})

interface NotesLaneSurfaceProps {
  duration: number
  containerWidth: number
  initialWidth: number
}

/**
 * The lane under the ruler. Sized like the ruler (live wheel zoom resizes it
 * imperatively), so note positions line up with the clips below.
 */
export const TimelineNotesLaneSurface = memo(function TimelineNotesLaneSurface({
  duration,
  containerWidth,
  initialWidth,
}: NotesLaneSurfaceProps) {
  const visible = useNotesLaneVisible()
  const height = useNotesLaneHeight()
  const waiting = useAgentNotesStore((s) => waitingAgentNotes(s.notes).length > 0)
  const outerRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)

  const applyZoom = useCallback(() => {
    const outer = outerRef.current
    const surface = surfaceRef.current
    if (!outer || !surface) return
    applyTimelineLiveGeometry({
      outer,
      surface,
      duration,
      viewportWidth: containerWidth,
      livePixelsPerSecond: useZoomStore.getState().pixelsPerSecond,
    })
  }, [containerWidth, duration])

  useLayoutEffect(() => {
    applyZoom()
  }, [applyZoom, visible])

  useEffect(
    () =>
      useZoomStore.subscribe((state, previous) => {
        if (state.pixelsPerSecond !== previous.pixelsPerSecond) applyZoom()
      }),
    [applyZoom],
  )

  if (!visible) return null
  return (
    <div
      ref={outerRef}
      className="relative z-20 shrink-0 border-b border-border bg-amber-500/[0.06]"
      style={{ width: `${initialWidth}px`, height }}
      data-marquee-ignore
      data-testid="timeline-notes-lane"
    >
      {waiting && <WaitingPulse />}
      <div
        ref={surfaceRef}
        className="absolute inset-y-0 left-0"
        style={{ width: `${initialWidth}px`, contain: 'layout style' }}
      >
        <TimelineNotesLane />
      </div>
    </div>
  )
})

/** Note blocks, drag-to-add, the composer and a note's details. */
export const TimelineNotesLane = memo(function TimelineNotesLane() {
  const { t } = useTranslation()
  const notes = useAgentNotesStore((s) => s.notes)
  const showDone = useAgentNotesStore((s) => s.showDone)
  const composer = useAgentNotesStore((s) => s.composer)
  const items = useItemsStore((s) => s.items)
  const fps = useTimelineStore((s) => s.fps) || 30
  const { frameToPixels, pixelsToFrame } = useTimelineCommittedZoomContext()
  const laneRef = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  // The note a context menu was opened on (null: the empty tray).
  const [menuNoteId, setMenuNoteId] = useState<string | null>(null)
  const [dragSpan, setDragSpan] = useState<{ start: number; end: number } | null>(null)

  const placed = useMemo(
    () =>
      placeNotes(
        notes,
        showDone,
        (note) => resolveNoteSpan(note, items, fps),
        frameToPixels,
        MAX_CARD_PX,
      ),
    [notes, showDone, items, fps, frameToPixels],
  )
  const active = placed.find((entry) => entry.note.id === activeId) ?? null

  const frameAt = (clientX: number) => {
    const rect = laneRef.current?.getBoundingClientRect()
    return Math.max(0, pixelsToFrame(clientX - (rect?.left ?? 0)))
  }

  // Press on empty lane: a drag across it notes a stretch; a double-click notes a moment.
  const onLaneMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return
    event.preventDefault()
    event.stopPropagation()
    setActiveId(null)
    const startX = event.clientX
    const start = frameAt(startX)
    let dragging = false
    const move = (moveEvent: MouseEvent) => {
      if (!dragging && Math.abs(moveEvent.clientX - startX) < DRAG_START_PX) return
      dragging = true
      setDragSpan({ start, end: frameAt(moveEvent.clientX) })
    }
    const up = (upEvent: MouseEvent) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setDragSpan(null)
      if (!dragging) return
      const end = frameAt(upEvent.clientX)
      usePlaybackStore.getState().pause()
      useAgentNotesStore
        .getState()
        .openComposer(
          Math.min(start, end),
          useSelectionStore.getState().selectedItemIds,
          Math.max(start, end),
        )
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const onLaneDoubleClick = (event: React.MouseEvent) => {
    if (event.target !== event.currentTarget) return
    event.stopPropagation()
    const frame = frameAt(event.clientX)
    usePlaybackStore.getState().pause()
    usePlaybackStore.getState().setCurrentFrame(frame)
    useAgentNotesStore.getState().openComposer(frame, useSelectionStore.getState().selectedItemIds)
  }

  const openNote = (entry: PlacedNote) => {
    usePlaybackStore.getState().setCurrentFrame(entry.span.frame)
    setActiveId(entry.note.id)
  }
  const menuEntry = placed.find((entry) => entry.note.id === menuNoteId) ?? null

  return (
    <ContextMenu modal={false} onOpenChange={(open) => !open && setMenuNoteId(null)}>
      <ContextMenuTrigger asChild>
        <div
          ref={laneRef}
          className="absolute inset-0 cursor-crosshair"
          onMouseDown={onLaneMouseDown}
          onDoubleClick={onLaneDoubleClick}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.stopPropagation()
            if (event.target === event.currentTarget) setMenuNoteId(null)
          }}
        >
          {placed.map((entry) => (
            <NoteBlock
              key={entry.note.id}
              entry={entry}
              fps={fps}
              onOpen={() => openNote(entry)}
              onMenu={() => setMenuNoteId(entry.note.id)}
            />
          ))}

          {dragSpan && (
            <div
              className="pointer-events-none absolute inset-y-0.5 rounded-sm border border-amber-500 bg-amber-500/20"
              style={{
                left: frameToPixels(Math.min(dragSpan.start, dragSpan.end)),
                width: Math.max(2, frameToPixels(Math.abs(dragSpan.end - dragSpan.start))),
              }}
            />
          )}

          {active && (
            <Popover open onOpenChange={(open) => !open && setActiveId(null)}>
              <PopoverAnchor asChild>
                <span className="absolute inset-y-0 w-px" style={{ left: active.left }} />
              </PopoverAnchor>
              <PopoverContent align="start" className="w-72 space-y-2 p-2 text-xs">
                <NoteDetails entry={active} fps={fps} onClose={() => setActiveId(null)} />
              </PopoverContent>
            </Popover>
          )}

          {composer && (
            <Popover
              open
              onOpenChange={(open) => !open && useAgentNotesStore.getState().closeComposer()}
            >
              <PopoverAnchor asChild>
                <span
                  className="absolute inset-y-0 w-px"
                  style={{ left: frameToPixels(composer.frame) }}
                />
              </PopoverAnchor>
              <PopoverContent
                align="start"
                className="w-80 space-y-2 p-2"
                // A context menu hands focus back as it closes; that must not close
                // the composer it just opened. Escape, a click outside or Add do.
                onFocusOutside={(event) => event.preventDefault()}
              >
                <NoteComposer fps={fps} />
              </PopoverContent>
            </Popover>
          )}
          <span className="sr-only">{t('timeline.notes.laneHint')}</span>
        </div>
      </ContextMenuTrigger>
      <NotesTrayMenu entry={menuEntry} onOpen={openNote} />
    </ContextMenu>
  )
})

/** The tray's context menu: add a note, then (on a note) open, done or reopen, delete. */
function NotesTrayMenu({
  entry,
  onOpen,
}: {
  entry: PlacedNote | null
  onOpen: (entry: PlacedNote) => void
}) {
  const { t } = useTranslation()
  const store = useAgentNotesStore.getState()
  return (
    <ContextMenuContent data-testid="notes-tray-menu">
      <AddAgentNoteMenuItem />
      {entry && (
        <>
          <ContextMenuItem onSelect={() => onOpen(entry)}>
            <MessageSquare className="h-4 w-4" />
            {t('timeline.notes.open')}
          </ContextMenuItem>
          {entry.done ? (
            <ContextMenuItem onSelect={() => void store.reopen(entry.note.id)}>
              <RotateCcw className="h-4 w-4" />
              {t('timeline.notes.reopen')}
            </ContextMenuItem>
          ) : (
            <ContextMenuItem onSelect={() => void store.markDone(entry.note.id)}>
              <Check className="h-4 w-4" />
              {t('timeline.notes.markDone')}
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive"
            onSelect={() => void store.remove(entry.note.id)}
          >
            <Trash2 className="h-4 w-4" />
            {t('timeline.notes.delete')}
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  )
}

/** A note card's look: open amber, done greyed; a dashed edge when its moment moved off its clip. */
function noteBlockClass({ done, span }: PlacedNote): string {
  const lost = span.state === 'trimmed' || span.state === 'detached'
  return cn(
    'absolute top-1 bottom-1 flex flex-col gap-0.5 overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left shadow-sm',
    done
      ? 'border-muted-foreground/40 bg-muted text-muted-foreground hover:bg-muted/80'
      : 'border-amber-500 bg-amber-100 text-amber-950 hover:bg-amber-200 dark:bg-amber-500/20 dark:text-amber-50 dark:hover:bg-amber-500/30',
    lost && 'outline-dashed outline-1 outline-offset-[-1px] outline-current',
  )
}

/** A note card: timecode (or range), then up to two lines of the note. */
function NoteCardBody({ entry, fps }: { entry: PlacedNote; fps: number }) {
  const { note, span, done } = entry
  const time =
    span.endFrame === undefined
      ? formatTimecodeCompact(span.frame, fps)
      : `${formatTimecodeCompact(span.frame, fps)}–${formatTimecodeCompact(span.endFrame, fps)}`
  return (
    <>
      <span className="flex min-w-0 items-center gap-1 font-mono text-[10px] leading-none tabular-nums opacity-80">
        {done ? (
          <Check className="h-2.5 w-2.5 shrink-0" />
        ) : (
          <MessageSquare className="h-2.5 w-2.5 shrink-0" />
        )}
        <span className="truncate">{time}</span>
      </span>
      <span className="line-clamp-2 min-w-0 text-[11px] leading-tight font-medium break-words">
        {note.text}
      </span>
    </>
  )
}

const NoteBlock = memo(function NoteBlock({
  entry,
  fps,
  onOpen,
  onMenu,
}: {
  entry: PlacedNote
  fps: number
  onOpen: () => void
  onMenu: () => void
}) {
  const { t } = useTranslation()
  const { note, span, left, width, done } = entry
  return (
    <button
      type="button"
      className={noteBlockClass(entry)}
      style={{ left, width }}
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onClick={(event) => {
        event.stopPropagation()
        onOpen()
      }}
      onContextMenu={onMenu}
      aria-label={t(done ? 'timeline.notes.doneNote' : 'timeline.notes.openNote', {
        time: formatTimecodeCompact(span.frame, fps),
        text: note.text,
      })}
      data-tooltip={note.text}
      data-tooltip-side="bottom"
      data-testid={done ? 'timeline-note-done' : 'timeline-note-open'}
    >
      <NoteCardBody entry={entry} fps={fps} />
    </button>
  )
})

function NoteDetails({
  entry,
  fps,
  onClose,
}: {
  entry: PlacedNote
  fps: number
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { note, span, done } = entry
  const store = useAgentNotesStore.getState()
  const when =
    span.endFrame === undefined
      ? formatTimecodeCompact(span.frame, fps)
      : `${formatTimecodeCompact(span.frame, fps)} – ${formatTimecodeCompact(span.endFrame, fps)}`
  return (
    <>
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'rounded px-1 font-mono text-[10px] leading-4 tabular-nums',
            done
              ? 'bg-muted text-muted-foreground'
              : 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
          )}
        >
          {when}
        </span>
        <span className="font-medium">
          {done ? t('timeline.notes.statusDone') : t('timeline.notes.statusOpen')}
        </span>
      </div>
      <p className="whitespace-pre-wrap">{note.text}</p>
      {span.state === 'trimmed' && (
        <p className="text-muted-foreground">{t('timeline.notes.trimmed')}</p>
      )}
      {span.state === 'detached' && (
        <p className="text-muted-foreground">{t('timeline.notes.detached')}</p>
      )}
      {note.reply && (
        <div
          className="rounded border border-border bg-muted/40 p-1.5"
          data-testid="timeline-note-reply"
        >
          <p className="text-[10px] font-medium text-muted-foreground">
            {note.pass
              ? t('timeline.notes.replyIn', { pass: note.pass })
              : t('timeline.notes.reply')}
          </p>
          <p className="whitespace-pre-wrap">{note.reply}</p>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 pt-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-muted-foreground"
          onClick={() => {
            void store.remove(note.id)
            onClose()
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('timeline.notes.delete')}
        </Button>
        {done ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={() => {
              void store.reopen(note.id)
              onClose()
            }}
            data-testid="timeline-note-reopen"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('timeline.notes.reopen')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={() => {
              void store.markDone(note.id)
              onClose()
            }}
            data-testid="timeline-note-mark-done"
          >
            <Check className="h-3.5 w-3.5" />
            {t('timeline.notes.markDone')}
          </Button>
        )}
      </div>
    </>
  )
}

function NoteComposer({ fps }: { fps: number }) {
  const { t } = useTranslation()
  const composer = useAgentNotesStore((s) => s.composer)
  const failed = useAgentNotesStore((s) => s.failed)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // Opened from a context menu, the menu takes focus back as it closes: take it again.
  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 120)
    return () => window.clearTimeout(timer)
  }, [])
  if (!composer) return null

  const addNote = async () => {
    const text = draft.trim()
    const store = useAgentNotesStore.getState()
    if (!text || !store.composer) return
    const { frame, endFrame, itemIds } = store.composer
    const anchor = noteAnchorFor(frame, itemIds, useItemsStore.getState().items, fps)
    if (await store.add({ text, frame, endFrame, itemIds, anchor })) {
      setDraft('')
      store.closeComposer()
    }
  }

  const when =
    composer.endFrame === undefined
      ? formatTimecodeCompact(composer.frame, fps)
      : `${formatTimecodeCompact(composer.frame, fps)} – ${formatTimecodeCompact(composer.endFrame, fps)}`
  return (
    <>
      <div className="flex items-center gap-1.5 text-xs">
        <span className="rounded bg-amber-500/15 px-1 font-mono text-[10px] leading-4 text-amber-700 tabular-nums dark:text-amber-400">
          {when}
        </span>
        <span className="whitespace-nowrap font-medium">{t('timeline.concise.comment.title')}</span>
        {composer.itemIds.length > 0 && (
          <span className="ml-auto whitespace-nowrap text-muted-foreground">
            {t('timeline.concise.comment.selected', { count: composer.itemIds.length })}
          </span>
        )}
      </div>
      <Textarea
        ref={inputRef}
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void addNote()
          }
        }}
        placeholder={t('timeline.concise.comment.placeholder')}
        aria-label={t('timeline.concise.comment.title')}
        className="min-h-20 resize-none text-xs"
        data-testid="timeline-agent-comment-input"
      />
      {failed && <p className="text-xs text-destructive">{t('editor.concise.pass.noteFailed')}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {t('timeline.concise.comment.hint')}
        </span>
        <Button
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => void addNote()}
          disabled={!draft.trim()}
        >
          <Plus className="h-3.5 w-3.5" />
          {t('timeline.concise.comment.add')}
        </Button>
      </div>
    </>
  )
}
