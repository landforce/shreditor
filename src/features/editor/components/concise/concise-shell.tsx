import { lazy, memo, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { ErrorBoundary } from '@/app/error-boundary'
import { Button } from '@/components/ui/button'
import { useEditorStore } from '@/shared/state/editor'
import { importTimeline } from '@/features/editor/deps/timeline-ui'
import { PreviewArea } from '../preview-area'
import { MediaSidebar } from '../media-sidebar'
import { ConciseMediaBin } from './media-bin'

const LazyTimeline = lazy(() => importTimeline().then(({ Timeline }) => ({ default: Timeline })))
const LazyConciseContextPanel = lazy(() =>
  import('./context-panel').then(({ ConciseContextPanel }) => ({ default: ConciseContextPanel })),
)

const NARROW_BREAKPOINT = 1100
const WIDE_PREVIEW_WIDTH = 372
const WIDE_ROW_HEIGHT = 674
const NARROW_PREVIEW_WIDTH = 240
const NARROW_ROW_HEIGHT = 396
const STRIP_HEIGHT = 150
const FALLBACK_SHELL_HEIGHT = 880
const MIN_ROW_PERCENT = 20
const MAX_ROW_PERCENT = 80

type PreviewProject = React.ComponentProps<typeof PreviewArea>['project']

interface ConciseShellProps {
  project: PreviewProject
  onSave: () => void
}

function rowPercent(rowHeight: number, shellHeight: number): number {
  const percent = (rowHeight / shellHeight) * 100
  return Math.min(MAX_ROW_PERCENT, Math.max(MIN_ROW_PERCENT, percent))
}

/**
 * Concise workspace: a CapCut-style review layout for vertical shorts. A 9:16
 * preview and the agent context panel sit above a full-width timeline; below
 * 1100px the media bin collapses into a strip under the timeline.
 */
export const ConciseShell = memo(function ConciseShell({ project, onSave }: ConciseShellProps) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const leftSidebarOpen = useEditorStore((s) => s.leftSidebarOpen)
  const setLeftSidebarOpen = useEditorStore((s) => s.setLeftSidebarOpen)
  const activeTab = useEditorStore((s) => s.activeTab)
  const sidebarWidth = useEditorStore((s) => s.sidebarWidth)
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  useLayoutEffect(() => {
    const element = rootRef.current
    if (!element) return
    const update = (width: number, height: number) =>
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    const rect = element.getBoundingClientRect()
    update(rect.width, rect.height)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) update(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Concise starts with the full media sidebar closed: the bin replaces it.
  useEffect(() => {
    setLeftSidebarOpen(false)
  }, [setLeftSidebarOpen])

  useEffect(() => {
    const handleSave = () => onSaveRef.current()
    window.addEventListener('shreditor:save-project', handleSave)
    return () => window.removeEventListener('shreditor:save-project', handleSave)
  }, [])

  const narrow = size.width < NARROW_BREAKPOINT
  const previewWidth = narrow ? NARROW_PREVIEW_WIDTH : WIDE_PREVIEW_WIDTH
  const rowHeight = narrow ? NARROW_ROW_HEIGHT : WIDE_ROW_HEIGHT
  // The strip is a fixed-height row of its own below the resizable split.
  const resizableHeight = (size.height || FALLBACK_SHELL_HEIGHT) - (narrow ? STRIP_HEIGHT : 0)
  const row1Percent = rowPercent(rowHeight, Math.max(resizableHeight, 1))
  const drawerOpen = leftSidebarOpen && activeTab !== 'media'

  return (
    <div
      ref={rootRef}
      data-testid="concise-shell"
      data-narrow={narrow ? 'true' : 'false'}
      className="flex h-full w-full min-h-0 min-w-0 flex-col gap-[var(--panel-gap)]"
    >
      <ResizablePanelGroup
        key={narrow ? 'narrow' : 'wide'}
        direction="vertical"
        className="min-h-0 flex-1"
        autoSaveId={`editor:concise-layout:${narrow ? 'narrow' : 'wide'}`}
      >
        <ResizablePanel
          defaultSize={row1Percent}
          minSize={MIN_ROW_PERCENT}
          maxSize={MAX_ROW_PERCENT}
        >
          <div className="relative flex h-full min-h-0 gap-[var(--panel-gap)] overflow-hidden">
            <div
              className="editor-panel flex min-w-0 flex-shrink-0 flex-col"
              style={{ width: previewWidth }}
            >
              <ErrorBoundary level="feature">
                <PreviewArea project={project} chrome="concise" compact={narrow} />
              </ErrorBoundary>
            </div>

            <div className="editor-panel flex min-h-0 min-w-0 flex-1 flex-col">
              <div className={narrow ? 'min-h-0 flex-1' : 'min-h-0 flex-shrink-0 overflow-auto'}>
                <ErrorBoundary level="feature">
                  <Suspense fallback={null}>
                    <LazyConciseContextPanel />
                  </Suspense>
                </ErrorBoundary>
              </div>
              {!narrow && (
                <div className="min-h-0 flex-1 border-t border-border">
                  <ErrorBoundary level="feature">
                    <ConciseMediaBin layout="panel" />
                  </ErrorBoundary>
                </div>
              )}
            </div>

            {drawerOpen && (
              <div
                data-testid="concise-sidebar-drawer"
                className="editor-panel absolute inset-y-0 left-0 z-20 flex shadow-xl"
                style={{ width: sidebarWidth }}
              >
                <ErrorBoundary level="feature">
                  <MediaSidebar />
                </ErrorBoundary>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1 z-30 h-6 w-6"
                  aria-label={t('editor.concise.shell.closeDrawer')}
                  onClick={() => setLeftSidebarOpen(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </ResizablePanel>

        <ResizableHandle className="bg-transparent hover:bg-primary/40 data-[panel-group-direction=vertical]:h-[var(--panel-gap)]" />

        <ResizablePanel defaultSize={100 - row1Percent}>
          <div className="editor-panel h-full min-w-0">
            <ErrorBoundary level="feature">
              <Suspense fallback={null}>
                <LazyTimeline duration={30} />
              </Suspense>
            </ErrorBoundary>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {narrow && (
        <div className="editor-panel flex-shrink-0" style={{ height: STRIP_HEIGHT }}>
          <ErrorBoundary level="feature">
            <ConciseMediaBin layout="strip" />
          </ErrorBoundary>
        </div>
      )}
    </div>
  )
})
