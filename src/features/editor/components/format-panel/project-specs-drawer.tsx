import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useCompositionNavigationStore } from '@/features/editor/deps/timeline-store'
import { useEditorStore } from '@/shared/state/editor'
import { cn } from '@/shared/ui/cn'
import { useFormatPanelStore, type NoSelectionTab } from '../../stores/format-panel-store'
import { CanvasPanel } from '../properties-sidebar/canvas-panel'
import { FormatPanel } from './format-panel'
import { NotesTab } from './notes-tab'
import { StyleTab } from './style-tab'

const TABS: { id: NoSelectionTab; labelKey: string }[] = [
  { id: 'format', labelKey: 'formats.panel.tab' },
  { id: 'style', labelKey: 'formats.specs.styleTab' },
  { id: 'canvas', labelKey: 'formats.panel.canvasTab' },
  { id: 'notes', labelKey: 'formats.specs.notesTab' },
]

function SpecsTabContent({ tab }: { tab: NoSelectionTab }) {
  if (tab === 'canvas') return <CanvasPanel />
  if (tab === 'notes') return <NotesTab />
  if (tab === 'style') return <StyleTab />
  return <FormatPanel />
}

/** Format, Style, Canvas and Notes, switched by a tab strip. */
function SpecsTabs() {
  const { t } = useTranslation()
  const tab = useFormatPanelStore((s) => s.tab)
  const setTab = useFormatPanelStore((s) => s.setTab)
  return (
    <div className="space-y-3">
      <div role="tablist" className="flex gap-1 rounded-lg bg-secondary p-1">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={cn(
              'flex-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors',
              tab === entry.id
                ? 'bg-card text-foreground shadow-[0_1px_2px_rgb(29_33_41/0.08)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(entry.labelKey)}
          </button>
        ))}
      </div>
      <SpecsTabContent tab={tab} />
    </div>
  )
}

/**
 * Project specs: the format (variant, guide, Change format, scorecard, rules),
 * the style kit, the canvas and the notes for the agent, in a right-hand drawer the top-bar
 * format chip opens, so none of it takes room in the main view. Inside a
 * composition only its canvas applies.
 */
export const ProjectSpecsDrawer = memo(function ProjectSpecsDrawer() {
  const { t } = useTranslation()
  const open = useFormatPanelStore((s) => s.specsOpen)
  const setOpen = useFormatPanelStore((s) => s.setSpecsOpen)
  const width = useEditorStore((s) => s.rightSidebarWidth)
  const inComposition = useCompositionNavigationStore((s) => s.activeCompositionId !== null)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        data-testid="project-specs-drawer"
        className="left-auto right-0 top-0 flex h-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 p-0 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:rounded-none"
        style={{ width: `min(100vw, ${Math.max(width, 380)}px)` }}
      >
        <div className="flex h-11 shrink-0 items-center border-b border-border px-4 pr-12">
          <DialogTitle className="text-sm font-semibold">{t('formats.specs.title')}</DialogTitle>
        </div>
        <DialogDescription className="sr-only">{t('formats.specs.description')}</DialogDescription>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {open && (inComposition ? <CanvasPanel /> : <SpecsTabs />)}
        </div>
      </DialogContent>
    </Dialog>
  )
})
