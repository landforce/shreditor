import { useTranslation } from 'react-i18next'
import { Brush } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useEditorStore } from '@/shared/state/editor'
import { setCutoutPaint } from '@/infrastructure/cutout/cutout-paint'
import type { VideoItem } from '@/types/timeline'
import { setClipCutout, useCutoutStatus } from '@/features/editor/hooks/use-cutout-status'
import { CutoutStatusLine } from '../properties-sidebar/clip-panel/cutout-section'
import { Cell } from './card-parts'

/** Open the Full view with painting on for this clip (its brush tools are in the clip panel there). */
function fixMask(item: VideoItem): void {
  setCutoutPaint({ itemId: item.id })
  useEditorStore.getState().setWorkspace('edit')
}

/**
 * The shot card's background removal: one toggle and its status, and "Fix
 * mask…", which opens the Full view's brush tools. Subject, feather and the
 * rest are in the full clip panel.
 */
export function CutoutCell({ items }: { items: VideoItem[] }) {
  const { t } = useTranslation()
  const status = useCutoutStatus(items[0])
  if (items.length === 0) return null
  const enabled = items.every((item) => item.cutout?.enabled)
  return (
    <Cell title={t('editor.cutout.title')} span={2} className="@3xl:col-span-1">
      <label className="flex items-center justify-between gap-2 text-xs">
        <span>{t('editor.cutout.enable')}</span>
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => setClipCutout(items, { enabled: checked })}
          aria-label={t('editor.cutout.enable')}
          data-testid="concise-cutout-toggle"
        />
      </label>
      {enabled ? (
        <>
          <CutoutStatusLine status={status} />
          {items.length === 1 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              data-testid="concise-cutout-fix"
              onClick={() => fixMask(items[0]!)}
            >
              <Brush className="h-3 w-3" />
              {t('editor.cutout.paint.fixMask')}
            </Button>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{t('editor.cutout.hint')}</p>
      )}
    </Cell>
  )
}
