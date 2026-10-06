import { useTranslation } from 'react-i18next'
import { ContextMenuItem } from '@/components/ui/context-menu'
import { useSelectionStore } from '@/shared/state/selection'
import { useMotionTemplateSaveStore } from '@/shared/state/motion-template-save'
import { useItemsStore } from '../../stores/items-store'
import { createPreComp } from '../../stores/actions/composition-actions'

/** The one composition the selection is (a compound clip and its audio wrapper), if any. */
function selectedCompositionId(ids: readonly string[]): string | null {
  const selected = useItemsStore.getState().items.filter((item) => ids.includes(item.id))
  const compositionIds = new Set(selected.map((item) => item.compositionId))
  const [only] = [...compositionIds]
  return compositionIds.size === 1 && only ? only : null
}

/**
 * "Save as template…": a compound clip opens the save dialog for its
 * composition; any other selection is first grouped into a layer composition.
 */
export function SaveAsTemplateMenuItem() {
  const { t } = useTranslation()
  const onSelect = () => {
    const ids = useSelectionStore.getState().selectedItemIds
    const compositionId =
      selectedCompositionId(ids) ??
      createPreComp(undefined, ids, { editorKind: 'composite-2d' })?.compositionId
    if (compositionId) useMotionTemplateSaveStore.getState().requestSave(compositionId)
  }
  return <ContextMenuItem onClick={onSelect}>{t('motionTemplates.saveAsTemplate')}</ContextMenuItem>
}
