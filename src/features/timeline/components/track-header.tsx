import { memo, type MouseEventHandler, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Power,
  PowerOff,
  Lock,
  GripVertical,
  Radio,
  FoldHorizontal,
  Link2,
  LayoutTemplate,
  Music,
  Type,
  Video,
} from 'lucide-react'
import { isConciseWorkspace } from '@/config/editor-workspaces'
import { useEditorStore } from '@/shared/state/editor'
import { useConciseTimelineStore } from '../stores/concise-timeline-store'
import type { FormatRole } from '@formats/registry.mjs'
import { roleLabel } from '@/shared/formats/format-text'
import type { TimelineTrack } from '@/types/timeline'
import { useTrackDrag } from '../hooks/use-track-drag'
import { TIMELINE_SIDEBAR_WIDTH } from '../constants'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/config/editor-layout'
import { useItemsStore } from '../stores/items-store'
import { getTrackKind, isTrackDisabled } from '@/features/timeline/utils/classic-tracks'
import { isTrackSyncLockActive } from '../utils/track-sync-lock'

interface TrackHeaderProps {
  track: TimelineTrack
  isActive: boolean
  isSelected: boolean
  canDeleteTrack: boolean
  canDeleteEmptyTracks: boolean
  onToggleLock: () => void
  onToggleSyncLock: () => void
  onToggleDisabled: () => void
  onToggleSolo: () => void
  onSelect: (e: React.MouseEvent) => void
  onCloseGaps?: () => void
  onAddVideoTrack: () => void
  onAddAudioTrack: () => void
  onDeleteTrack: () => void
  onDeleteEmptyTracks: () => void
}

/**
 * Custom equality for TrackHeader memo - ignores callback props which are recreated each render
 */
function areTrackHeaderPropsEqual(prev: TrackHeaderProps, next: TrackHeaderProps): boolean {
  return (
    prev.track === next.track &&
    prev.isActive === next.isActive &&
    prev.isSelected === next.isSelected &&
    prev.canDeleteTrack === next.canDeleteTrack &&
    prev.canDeleteEmptyTracks === next.canDeleteEmptyTracks
  )
  // Callbacks (onToggleLock, etc.) are ignored - they're recreated each render but functionality is same
}

/**
 * The track's role in the project's format layout. The role name is left out
 * when the track is already named after it (a fresh format layout).
 */
function FormatRoleBadge({ role, trackName }: { role: FormatRole; trackName: string }) {
  const { t } = useTranslation()
  const label = roleLabel(t, role)
  const title = t('formats.timeline.roleBadge', { role: label })
  return (
    <span
      data-testid="track-format-role"
      title={title}
      aria-label={title}
      className="inline-flex shrink-0 items-center gap-0.5 rounded bg-primary-soft px-1 py-0.5 text-[10px] font-semibold leading-none text-primary-text"
    >
      <LayoutTemplate className="h-2.5 w-2.5" aria-hidden="true" />
      {label.toLowerCase() !== trackName.trim().toLowerCase() && label}
    </span>
  )
}

const COMPACT_BUTTON_STYLE = { width: 20, height: 20 } as const

/**
 * 72px label for the Concise workspace: kind icon + truncated name, with only
 * the disable and lock buttons revealed on hover.
 */
function ConciseTrackLabel({
  track,
  isTextTrack,
  trackDisabled,
  onToggleDisabled,
  onToggleLock,
}: {
  track: TimelineTrack
  isTextTrack: boolean
  trackDisabled: boolean
  onToggleDisabled: () => void
  onToggleLock: () => void
}) {
  const { t } = useTranslation()
  const kind = getTrackKind(track)
  const KindIcon = isTextTrack ? Type : kind === 'audio' ? Music : Video
  const disableLabel = trackDisabled
    ? t('timeline.trackHeader.enableTrack')
    : t('timeline.trackHeader.disableTrack')
  const lockLabel = track.locked
    ? t('timeline.trackHeader.unlockTrack')
    : t('timeline.trackHeader.lockTrack')

  return (
    <>
      <div className="flex h-full min-w-0 items-center gap-1 px-1">
        <KindIcon
          data-testid="track-kind-icon"
          data-kind={isTextTrack ? 'text' : (kind ?? 'video')}
          className="h-3 w-3 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span
          className="min-w-0 truncate text-[11px] font-semibold leading-none"
          title={track.name}
        >
          {track.name}
        </span>
      </div>
      <div
        className="absolute inset-y-0 right-0 hidden items-center gap-0.5 bg-secondary/90 px-0.5 group-hover/track:flex group-focus-within/track:flex"
        data-testid="track-compact-actions"
      >
        <Button
          variant="ghost"
          size="icon"
          className="rounded hover:bg-secondary"
          style={COMPACT_BUTTON_STYLE}
          onClick={(e) => {
            e.stopPropagation()
            onToggleDisabled()
          }}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label={disableLabel}
          data-tooltip={disableLabel}
        >
          {trackDisabled ? (
            <PowerOff className="h-3 w-3 text-primary" />
          ) : (
            <Power className="h-3 w-3 opacity-70" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="rounded hover:bg-secondary"
          style={COMPACT_BUTTON_STYLE}
          onClick={(e) => {
            e.stopPropagation()
            onToggleLock()
          }}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label={lockLabel}
          data-tooltip={lockLabel}
        >
          <Lock className={`h-3 w-3 ${track.locked ? 'text-primary' : 'opacity-70'}`} />
        </Button>
      </div>
    </>
  )
}

interface TrackHeaderBodyProps {
  track: TimelineTrack
  isActive: boolean
  isSelected: boolean
  trackDisabled: boolean
  onSelect: MouseEventHandler<HTMLDivElement>
  onMouseDown: MouseEventHandler<HTMLDivElement>
  onToggleDisabled: () => void
  onToggleLock: () => void
}

function CompactTrackHeaderBody({
  track,
  isActive,
  isSelected,
  trackDisabled,
  onSelect,
  onMouseDown,
  onToggleDisabled,
  onToggleLock,
}: TrackHeaderBodyProps) {
  const isTextTrack = useIsTextTrack(track.id)
  return (
    <div
      className={`
        group/track relative flex overflow-hidden
        cursor-grab active:cursor-grabbing
        ${isSelected ? 'bg-primary/10' : trackDisabled ? 'bg-muted/30 hover:bg-muted/40' : 'hover:bg-secondary/50'}
        ${isActive ? 'border-l-2 border-l-primary' : 'border-l-2 border-l-transparent'}
        ${trackDisabled ? 'text-muted-foreground' : ''}
        transition-colors duration-150
      `}
      style={{ height: `${track.height}px` }}
      data-testid="track-header-concise"
      onClick={onSelect}
      onMouseDown={onMouseDown}
    >
      <ConciseTrackLabel
        track={track}
        isTextTrack={isTextTrack}
        trackDisabled={trackDisabled}
        onToggleDisabled={onToggleDisabled}
        onToggleLock={onToggleLock}
      />
    </div>
  )
}

/** A 20px icon button in the full header's top row; clicks never select or drag the track. */
function TrackActionButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="rounded hover:bg-secondary"
      style={{
        width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
        height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
      }}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      onMouseDown={(e) => e.stopPropagation()}
      aria-label={label}
      data-tooltip={label}
    >
      {children}
    </Button>
  )
}

function fullRowStateClass(isSelected: boolean, isActive: boolean, trackDisabled: boolean): string {
  const background = isSelected
    ? 'bg-primary/10'
    : trackDisabled
      ? 'bg-muted/30 hover:bg-muted/40'
      : 'hover:bg-secondary/50'
  const border = isActive ? 'border-l-3 border-l-primary' : 'border-l-3 border-l-transparent'
  return `${background} ${border} ${trackDisabled ? 'text-muted-foreground' : ''}`
}

function FullTrackHeaderBody({
  track,
  isActive,
  isSelected,
  trackDisabled,
  onSelect,
  onMouseDown,
  onToggleDisabled,
  onToggleLock,
  onToggleSolo,
  onToggleSyncLock,
  onCloseGaps,
}: TrackHeaderBodyProps & {
  onToggleSolo: () => void
  onToggleSyncLock: () => void
  onCloseGaps?: () => void
}) {
  const { t } = useTranslation()
  const itemCount = useItemsStore((s) => s.itemsByTrackId[track.id]?.length ?? 0)
  const syncLockEnabled = isTrackSyncLockActive(track)
  const itemCountLabel = t('timeline.trackHeader.clipCount', { count: itemCount })
  const toggleLabel = (on: boolean, onKey: string, offKey: string) =>
    t(`timeline.trackHeader.${on ? onKey : offKey}`)
  return (
    <div
      className={`flex flex-col overflow-hidden px-1 cursor-grab active:cursor-grabbing relative ${fullRowStateClass(isSelected, isActive, trackDisabled)} transition-colors duration-150`}
      style={{ height: `${track.height}px` }}
      onClick={onSelect}
      onMouseDown={onMouseDown}
    >
      <div className="flex h-6 shrink-0 items-center gap-0.5 overflow-hidden border-b border-border/60">
        <div className="flex h-5 w-4 shrink-0 items-center justify-center">
          <GripVertical className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
        </div>
        <TrackActionButton
          label={toggleLabel(trackDisabled, 'enableTrack', 'disableTrack')}
          onClick={onToggleDisabled}
        >
          {trackDisabled ? (
            <PowerOff className="w-3 h-3 text-primary" />
          ) : (
            <Power className="w-3 h-3 opacity-70" />
          )}
        </TrackActionButton>
        <TrackActionButton
          label={toggleLabel(!!track.solo, 'unsoloTrack', 'soloTrack')}
          onClick={onToggleSolo}
        >
          <Radio className={`w-3 h-3 ${track.solo ? 'text-primary' : ''}`} />
        </TrackActionButton>
        <TrackActionButton
          label={toggleLabel(!!track.locked, 'unlockTrack', 'lockTrack')}
          onClick={onToggleLock}
        >
          <Lock className={`w-3 h-3 ${track.locked ? 'text-primary' : 'opacity-70'}`} />
        </TrackActionButton>
        <TrackActionButton
          label={toggleLabel(syncLockEnabled, 'disableSyncLock', 'enableSyncLock')}
          onClick={onToggleSyncLock}
        >
          <Link2 className={`w-3 h-3 ${syncLockEnabled ? 'text-primary' : 'opacity-70'}`} />
        </TrackActionButton>
        <TrackActionButton label={t('timeline.trackHeader.closeAllGaps')} onClick={onCloseGaps}>
          <FoldHorizontal className="w-3 h-3" />
        </TrackActionButton>
      </div>

      <div className="flex min-h-0 flex-1 items-center gap-1.5 overflow-hidden px-1.5">
        <span className="min-w-0 truncate text-xs font-semibold leading-none font-mono">
          {track.name}
        </span>
        {track.formatRole && <FormatRoleBadge role={track.formatRole} trackName={track.name} />}
        <span className="shrink-0 text-[10px] leading-none text-muted-foreground">
          {itemCountLabel}
        </span>
      </div>
    </div>
  )
}

function useIsTextTrack(trackId: string): boolean {
  return useItemsStore((s) => {
    const items = s.itemsByTrackId[trackId]
    return (
      !!items && items.length > 0 && items.every((i) => i.type === 'text' || i.type === 'subtitle')
    )
  })
}

function useCompactTrackLabel(): boolean {
  const concise = useEditorStore((s) => isConciseWorkspace(s.workspace))
  const conciseFullHeaders = useConciseTimelineStore((s) => s.conciseFullHeaders)
  return concise && !conciseFullHeaders
}

/**
 * Track Header Component
 *
 * Displays track name, controls, and handles selection.
 * Shows active state with background color.
 * Supports group tracks with collapse/expand and indentation.
 * Right-click context menu for track actions.
 * Memoized to prevent re-renders when props haven't changed.
 */
export const TrackHeader = memo(function TrackHeader({
  track,
  isActive,
  isSelected,
  canDeleteTrack,
  canDeleteEmptyTracks,
  onToggleLock,
  onToggleSyncLock,
  onToggleDisabled,
  onToggleSolo,
  onSelect,
  onCloseGaps,
  onAddVideoTrack,
  onAddAudioTrack,
  onDeleteTrack,
  onDeleteEmptyTracks,
}: TrackHeaderProps) {
  const { t } = useTranslation()
  const trackDisabled = isTrackDisabled(track)
  const useCompactLabel = useCompactTrackLabel()

  // Use track drag hook (visuals handled centrally by timeline.tsx via DOM)
  const { handleDragStart } = useTrackDrag(track)
  const bodyProps: TrackHeaderBodyProps = {
    track,
    isActive,
    isSelected,
    trackDisabled,
    onSelect,
    onMouseDown: handleDragStart,
    onToggleDisabled,
    onToggleLock,
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="relative overflow-hidden"
          style={{
            height: `${track.height}px`,
            contentVisibility: 'auto',
            containIntrinsicSize: `${useCompactLabel ? 72 : TIMELINE_SIDEBAR_WIDTH}px ${track.height}px`,
          }}
          data-track-id={track.id}
          data-track-disabled={trackDisabled ? 'true' : undefined}
        >
          {useCompactLabel ? (
            <CompactTrackHeaderBody {...bodyProps} />
          ) : (
            <FullTrackHeaderBody
              {...bodyProps}
              onToggleSolo={onToggleSolo}
              onToggleSyncLock={onToggleSyncLock}
              onCloseGaps={onCloseGaps}
            />
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={onCloseGaps}>
          {t('timeline.trackHeader.closeAllGaps')}
        </ContextMenuItem>

        <ContextMenuSeparator />
        <ContextMenuItem onClick={onAddVideoTrack}>
          {t('timeline.trackHeader.addVideoTrack')}
        </ContextMenuItem>
        <ContextMenuItem onClick={onAddAudioTrack}>
          {t('timeline.trackHeader.addAudioTrack')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!canDeleteTrack} onClick={onDeleteTrack}>
          {t('timeline.trackHeader.deleteTrack')}
        </ContextMenuItem>
        <ContextMenuItem disabled={!canDeleteEmptyTracks} onClick={onDeleteEmptyTracks}>
          {t('timeline.trackHeader.deleteEmptyTracks')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}, areTrackHeaderPropsEqual)
