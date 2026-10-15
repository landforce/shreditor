import type { ComponentType, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Ellipsis, Trash2, type LucideProps } from 'lucide-react'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import type { TimelineItem } from '@/types/timeline'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useEditorStore } from '@/shared/state/editor'
import { cn } from '@/shared/ui/cn'
import { PropertiesSidebar } from '../properties-sidebar'

export interface Verb {
  id: string
  icon: ComponentType<LucideProps>
  label: string
  onClick: () => void
  /** Tooltip; defaults to the label. */
  hint?: string
  destructive?: boolean
  disabled?: boolean
  active?: boolean
}

export function deleteVerb(label: string, ids: string[]): Verb {
  return {
    id: 'delete',
    icon: Trash2,
    label,
    onClick: () => useTimelineStore.getState().removeItems(ids),
    destructive: true,
  }
}

/** Copies each item to sit right after itself on its own track. */
export function duplicateVerb(label: string, items: TimelineItem[]): Verb {
  return {
    id: 'duplicate',
    icon: Copy,
    label,
    onClick: () =>
      useTimelineStore.getState().duplicateItems(
        items.map((entry) => entry.id),
        items.map((entry) => ({
          from: entry.from + entry.durationInFrames,
          trackId: entry.trackId,
        })),
      ),
  }
}

export function moreVerb(label: string, onClick: () => void): Verb {
  return { id: 'more', icon: Ellipsis, label, onClick }
}

/**
 * One card of the context panel: a 40px header (optional), a 56px verb strip (icon over
 * label, like mobile CapCut) and a scrolling body. The body is two columns at
 * the panel's usual 508px and three once the panel is wide.
 */
export function ContextCard({
  title,
  subtitle,
  label,
  verbs,
  children,
  testId,
}: {
  /** The header line; a card without one (the Pass card) starts at its verbs. */
  title?: string
  subtitle?: string
  /** What screen readers call the card when it has no visible title. */
  label?: string
  verbs: Verb[]
  children: ReactNode
  testId: string
}) {
  return (
    <section
      data-testid={testId}
      aria-label={title ? undefined : label}
      className="@container flex h-full min-h-0 w-full flex-col bg-panel-bg"
    >
      {title && (
        <header className="flex h-10 shrink-0 items-baseline gap-2 border-b border-border px-3 pt-2.5">
          <h2 className="shrink-0 text-[13px] font-semibold text-foreground">{title}</h2>
          {subtitle && (
            <span className="min-w-0 truncate text-xs text-muted-foreground" title={subtitle}>
              {subtitle}
            </span>
          )}
        </header>
      )}
      <div
        role="toolbar"
        className="flex h-14 shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border px-1.5 py-1"
      >
        {verbs.map((verb) => (
          <button
            key={verb.id}
            type="button"
            onClick={verb.onClick}
            disabled={verb.disabled}
            aria-pressed={verb.active}
            data-tooltip={verb.hint ?? verb.label}
            className={cn(
              'flex min-w-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-[10px] transition-colors',
              'hover:bg-secondary disabled:pointer-events-none disabled:opacity-40',
              verb.destructive ? 'text-destructive' : 'text-muted-foreground hover:text-foreground',
              verb.active && 'bg-secondary text-foreground',
            )}
          >
            <verb.icon className="h-4 w-4" />
            <span className="max-w-full truncate leading-none">{verb.label}</span>
          </button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-3 overflow-y-auto p-3 @3xl:grid-cols-3">
        {children}
      </div>
    </section>
  )
}

/** A titled block in a card's body grid. */
export function Cell({
  title,
  children,
  className,
  span,
  cellRef,
}: {
  title?: string
  children: ReactNode
  className?: string
  /** Columns taken in the two-column layout. */
  span?: 1 | 2
  cellRef?: React.Ref<HTMLDivElement>
}) {
  return (
    <div
      ref={cellRef}
      className={cn(
        'min-w-0 space-y-2 rounded-lg border border-border bg-secondary/20 p-3',
        span === 2 && 'col-span-2',
        className,
      )}
    >
      {title && (
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
      )}
      {children}
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}

/** The full existing properties sidebar, mounted inside the concise layout. */
export function PropertiesHost({ className }: { className?: string }) {
  return (
    <div className={cn('flex h-full min-h-0 w-full', className)}>
      <PropertiesSidebar embedded />
    </div>
  )
}

/** The More verb: a right-hand drawer holding the full properties sidebar. */
export function MoreDrawer({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const width = useEditorStore((s) => s.rightSidebarWidth)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="concise-more-drawer"
        className="left-auto right-0 top-0 flex h-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 p-0 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:rounded-none"
        style={{ width: `min(100vw, ${Math.max(width, 360)}px)` }}
      >
        <DialogTitle className="sr-only">{t('editor.concise.more.title')}</DialogTitle>
        <DialogDescription className="sr-only">
          {t('editor.concise.more.description')}
        </DialogDescription>
        {open && <PropertiesHost />}
      </DialogContent>
    </Dialog>
  )
}
