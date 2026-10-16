import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Crown, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { CutGroup, CutSummary } from '@/infrastructure/storage'
import { cutLabelError } from '@/shared/projects/cuts.mjs'
import { createLogger } from '@/shared/logging/logger'
import { useCutsStore } from '@/shared/state/cuts'
import { makeMainCut, moveCut, removeCut, renameCut } from './cut-actions'

const logger = createLogger('ManageCutsDialog')

interface ManageCutsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  group: CutGroup
}

/** Make main: the crown is filled on the main cut and makes any other cut Main. */
function MakeMainButton({
  cut,
  group,
  run,
}: {
  cut: CutSummary
  group: CutGroup
  run: (work: () => Promise<void>) => Promise<void>
}) {
  const { t } = useTranslation()
  const hint = cut.main ? t('cuts.manage.isMain') : t('cuts.manage.makeMain')
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-100"
      disabled={cut.main}
      aria-label={hint}
      data-tooltip={hint}
      data-testid={cut.main ? 'cut-is-main' : 'cut-make-main'}
      onClick={() => void run(() => makeMainCut(group, cut.id))}
    >
      <Crown className={cut.main ? 'h-3.5 w-3.5 fill-current text-amber-500' : 'h-3.5 w-3.5'} />
    </Button>
  )
}

function CutRow({
  cut,
  group,
  isCurrent,
  first,
  last,
  onRemove,
  run,
}: {
  cut: CutSummary
  group: CutGroup
  isCurrent: boolean
  first: boolean
  last: boolean
  onRemove: (cut: CutSummary) => void
  run: (work: () => Promise<void>) => Promise<void>
}) {
  const { t } = useTranslation()
  const [label, setLabel] = useState(cut.label)
  useEffect(() => setLabel(cut.label), [cut.label])
  const commit = () => {
    const wanted = label.trim()
    if (wanted === cut.label) return
    const taken = group.cuts.some(
      (other) => other.id !== cut.id && other.label.toLowerCase() === wanted.toLowerCase(),
    )
    if (cutLabelError(wanted) || taken) {
      toast.error(taken ? t('cuts.new.labelTaken') : t('cuts.new.labelRequired'))
      setLabel(cut.label)
      return
    }
    void run(() => renameCut(group, cut.id, wanted))
  }
  const removeHint = cut.main
    ? t('cuts.manage.mainCantRemove')
    : isCurrent
      ? t('cuts.manage.currentCantRemove')
      : t('cuts.manage.remove')
  return (
    <li className="flex items-center gap-2" data-testid="manage-cut-row">
      <Input
        aria-label={t('cuts.manage.labelFor', { label: cut.label })}
        value={label}
        maxLength={60}
        className="h-8 flex-1"
        onChange={(event) => setLabel(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      <span className="w-20 shrink-0 font-mono text-[11px] text-muted-foreground">
        {cut.width}×{cut.height}
      </span>
      <MakeMainButton cut={cut} group={group} run={run} />
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={cut.main || first}
        aria-label={t('cuts.manage.moveUp')}
        onClick={() => void run(() => moveCut(group, cut.id, -1))}
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={cut.main || last}
        aria-label={t('cuts.manage.moveDown')}
        onClick={() => void run(() => moveCut(group, cut.id, 1))}
      >
        <ArrowDown className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        disabled={cut.main || isCurrent}
        aria-label={removeHint}
        data-tooltip={removeHint}
        onClick={() => onRemove(cut)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </li>
  )
}

/** Manage cuts: rename, reorder (Main stays first), make Main and remove, with a confirmation. */
export function ManageCutsDialog({ open, onOpenChange, projectId, group }: ManageCutsDialogProps) {
  const { t } = useTranslation()
  const refresh = useCutsStore((s) => s.refresh)
  const [removing, setRemoving] = useState<CutSummary | null>(null)
  const others = group.cuts.filter((c) => !c.main)

  const run = async (work: () => Promise<void>) => {
    try {
      await work()
    } catch (error) {
      logger.error('Changing a cut failed', error)
      toast.error(t('cuts.manage.failed'))
    } finally {
      await refresh()
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('cuts.manage.title')}</DialogTitle>
            <DialogDescription>{t('cuts.manage.description')}</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {group.cuts.map((cut) => (
              <CutRow
                key={cut.id}
                cut={cut}
                group={group}
                isCurrent={cut.id === projectId}
                first={others[0]?.id === cut.id}
                last={others.at(-1)?.id === cut.id}
                onRemove={setRemoving}
                run={run}
              />
            ))}
          </ul>
        </DialogContent>
      </Dialog>
      <AlertDialog open={removing !== null} onOpenChange={(next) => !next && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('cuts.manage.confirmTitle', { label: removing?.label ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('cuts.manage.confirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                const cut = removing
                setRemoving(null)
                if (cut) void run(() => removeCut(cut.id))
              }}
            >
              {t('cuts.manage.confirmRemove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
