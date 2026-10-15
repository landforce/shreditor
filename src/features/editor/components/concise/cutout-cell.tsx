import { useTranslation } from 'react-i18next'
import { Switch } from '@/components/ui/switch'
import type { VideoItem } from '@/types/timeline'
import { setClipCutout, useCutoutStatus } from '@/features/editor/hooks/use-cutout-status'
import { CutoutStatusLine } from '../properties-sidebar/clip-panel/cutout-section'
import { Cell } from './card-parts'

/**
 * The shot card's background removal: one toggle and its status. Subject,
 * feather and the rest are in the full clip panel.
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
        <CutoutStatusLine status={status} />
      ) : (
        <p className="text-xs text-muted-foreground">{t('editor.cutout.hint')}</p>
      )}
    </Cell>
  )
}
