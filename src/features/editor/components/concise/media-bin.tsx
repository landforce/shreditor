import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, FolderOpen, MoreHorizontal, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useEditorStore } from '@/shared/state/editor'
import { cn } from '@/shared/ui/cn'
import {
  clearMediaDragData,
  importMediaLibraryService,
  MediaLibrary,
  setMediaDragData,
  useMediaLibraryStore,
} from '@/features/editor/deps/media-library'

export type ConciseMediaBinLayout = 'panel' | 'strip'

const FOCUS_EVENT = 'shreditor:focus-media-bin'
const FLASH_MS = 1200

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

function mediaKind(mimeType: string): string {
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.startsWith('image/')) return 'image'
  return 'video'
}

interface StripMedia {
  id: string
  fileName: string
  mimeType: string
  duration: number
  thumbnailId?: string
}

const StripTile = memo(function StripTile({ media }: { media: StripMedia }) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    void importMediaLibraryService().then(async ({ mediaLibraryService }) => {
      const url = await mediaLibraryService.getThumbnailBlobUrl(media.id, media.thumbnailId)
      if (mounted) setThumbnailUrl(url)
    })
    return () => {
      mounted = false
    }
  }, [media.id, media.thumbnailId])

  const handleDragStart = (event: React.DragEvent) => {
    event.dataTransfer.effectAllowed = 'copy'
    const dragData = {
      type: 'media-item' as const,
      mediaId: media.id,
      mediaType: mediaKind(media.mimeType),
      fileName: media.fileName,
      duration: media.duration,
    }
    event.dataTransfer.setData('application/json', JSON.stringify(dragData))
    setMediaDragData(dragData)
  }

  const duration = formatDuration(media.duration)

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={clearMediaDragData}
      title={media.fileName}
      data-media-id={media.id}
      className="relative h-[100px] w-[56px] flex-shrink-0 cursor-grab overflow-hidden rounded-md border border-border bg-secondary active:cursor-grabbing"
    >
      {thumbnailUrl && (
        <img src={thumbnailUrl} alt="" draggable={false} className="h-full w-full object-cover" />
      )}
      {duration && (
        <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[9px] leading-tight text-white">
          {duration}
        </span>
      )}
    </div>
  )
})

/**
 * The concise layout's media bin. `panel` mounts the full media library
 * (its own toolbar carries import and search); `strip` is a single
 * horizontally scrolling row of 56x100 tiles for the narrow layout.
 */
export const ConciseMediaBin = memo(function ConciseMediaBin({
  layout,
}: {
  layout: ConciseMediaBinLayout
}) {
  const { t } = useTranslation()
  const setActiveTab = useEditorStore((s) => s.setActiveTab)
  const setLeftSidebarOpen = useEditorStore((s) => s.setLeftSidebarOpen)
  const mediaItems = useMediaLibraryStore((s) => s.mediaItems)
  const searchQuery = useMediaLibraryStore((s) => s.searchQuery)
  const setSearchQuery = useMediaLibraryStore((s) => s.setSearchQuery)
  const importMedia = useMediaLibraryStore((s) => s.importMedia)
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const flashTimer = useRef<number | undefined>(undefined)
  const [flash, setFlash] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const isStrip = layout === 'strip'

  useEffect(() => {
    const handleFocus = () => {
      rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      setFlash(true)
      window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setFlash(false), FLASH_MS)
      if (isStrip) setSearchOpen(true)
      window.setTimeout(() => {
        const input = isStrip
          ? searchRef.current
          : rootRef.current?.querySelector<HTMLInputElement>('input')
        input?.focus()
      }, 0)
    }
    window.addEventListener(FOCUS_EVENT, handleFocus)
    return () => {
      window.removeEventListener(FOCUS_EVENT, handleFocus)
      window.clearTimeout(flashTimer.current)
    }
  }, [isStrip])

  const handleImport = useCallback(
    (storageMode: 'copy' | 'link') => {
      void importMedia({ storageMode }).catch(() => undefined)
    },
    [importMedia],
  )

  const openTranscript = useCallback(() => {
    setActiveTab('transcript')
    setLeftSidebarOpen(true)
  }, [setActiveTab, setLeftSidebarOpen])

  const stripItems = useMemo(() => {
    if (!isStrip) return []
    const query = searchQuery.trim().toLowerCase()
    return query
      ? mediaItems.filter((item) => item.fileName.toLowerCase().includes(query))
      : mediaItems
  }, [isStrip, mediaItems, searchQuery])

  return (
    <div
      ref={rootRef}
      data-testid="concise-media-bin"
      data-layout={layout}
      className={cn(
        'flex h-full min-h-0 min-w-0 flex-col transition-shadow',
        flash && 'ring-2 ring-inset ring-primary',
      )}
    >
      <div className="flex h-9 flex-shrink-0 items-center gap-2 border-b border-border px-2.5">
        <span className="text-xs font-medium">{t('editor.concise.shell.mediaTitle')}</span>
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
          {t('editor.concise.shell.mediaHint')}
        </span>
        <div className="flex-1" />
        {isStrip &&
          (searchOpen ? (
            <div className="relative w-36">
              <Input
                ref={searchRef}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t('editor.concise.shell.searchPlaceholder')}
                className="h-6 pr-6 text-xs"
              />
              <button
                type="button"
                aria-label={t('editor.concise.shell.closeDrawer')}
                onClick={() => {
                  setSearchQuery('')
                  setSearchOpen(false)
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              aria-label={t('editor.concise.shell.searchMedia')}
              onClick={() => setSearchOpen(true)}
            >
              <Search className="h-3.5 w-3.5" />
            </Button>
          ))}
        {isStrip && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 gap-1 px-2 text-xs"
            onClick={() => handleImport('copy')}
          >
            <FolderOpen className="h-3 w-3" />
            {t('editor.concise.shell.import')}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-6 gap-1 px-2 text-xs"
          onClick={openTranscript}
        >
          <FileText className="h-3 w-3" />
          {t('editor.concise.shell.transcript')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              aria-label={t('editor.concise.shell.mediaTools')}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => handleImport('link')}>
              {t('editor.concise.shell.importLink')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isStrip ? (
        <div className="flex min-h-0 flex-1 items-center gap-1.5 overflow-x-auto overflow-y-hidden px-2.5">
          {stripItems.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              {t('editor.concise.shell.mediaEmpty')}
            </span>
          ) : (
            stripItems.map((media) => <StripTile key={media.id} media={media} />)
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <MediaLibrary />
        </div>
      )}
    </div>
  )
})
