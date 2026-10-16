/**
 * "All cuts" in the export dialog (docs/cuts.md, Export): every cut of the
 * open project's group, one after another, each through the agent's export
 * (`shred export`, native when possible) at its own size, named
 * "<project> - <cut label>". The workspace bridge runs it
 * (server/cut-export-bridge.mjs); this shows the progress per cut.
 */
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Circle, Layers, Loader2, XCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { useCutsStore } from '@/shared/state/cuts'
import type { CutExportJob, CutExportRow } from '../hooks/use-all-cuts-export'

/** The "All cuts" entry in the export dialog's queue menu, when the project has sibling cuts. */
export function AllCutsMenuItem({ onSelect }: { onSelect: () => void }) {
  const { t } = useTranslation()
  const count = useCutsStore((s) => s.group?.cuts.length ?? 0)
  if (count < 2) return null
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className="gap-2"
        onClick={onSelect}
        data-testid="export-all-cuts"
        data-tooltip={t('cuts.export.allCutsHint')}
        data-tooltip-side="left"
      >
        <Layers className="h-3.5 w-3.5" aria-hidden="true" />
        {t('cuts.export.allCuts')}
        <span className="ml-auto text-[11px] text-muted-foreground">{count}</span>
      </DropdownMenuItem>
    </>
  )
}

const STATUS_ICON = {
  queued: <Circle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />,
  exporting: <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />,
  done: <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />,
  failed: <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />,
} as const

function CutExportLine({ cut }: { cut: CutExportRow }) {
  const { t } = useTranslation()
  return (
    <li className="flex items-start gap-2 text-sm" data-testid={`cut-export-${cut.status}`}>
      <span className="mt-0.5 shrink-0">{STATUS_ICON[cut.status]}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{cut.label}</span>
          <span className="text-xs text-muted-foreground">
            {t(`cuts.export.status.${cut.status}`, { engine: cut.engine ?? '' })}
          </span>
        </div>
        <p className="truncate font-mono text-[11px] text-muted-foreground" title={cut.path ?? ''}>
          {cut.error ?? cut.path ?? cut.name}
        </p>
      </div>
    </li>
  )
}

/** Per-cut progress of "All cuts": queued, exporting, done (engine and file) or failed. */
export function AllCutsExportDialog({
  job,
  onClose,
}: {
  job: CutExportJob | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const finished = job?.cuts.filter((cut) => cut.status === 'done' || cut.status === 'failed')
  return (
    <Dialog open={job !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('cuts.export.title')}</DialogTitle>
          <DialogDescription>
            {t('cuts.export.progress', {
              done: finished?.length ?? 0,
              count: job?.cuts.length ?? 0,
            })}
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {job?.cuts.map((cut) => (
            <CutExportLine key={cut.id} cut={cut} />
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
