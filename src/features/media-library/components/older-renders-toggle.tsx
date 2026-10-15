import { useTranslation } from 'react-i18next'
import { useSupersededMotionRenders } from '../hooks/use-visible-media-items'
import { useMediaLibraryStore } from '../stores/media-library-store'

/**
 * A line under the media sections when re-renders replaced motion graphics:
 * how many older renders are hidden, and a switch to show them again.
 */
export function OlderRendersToggle() {
  const { t } = useTranslation()
  const count = useSupersededMotionRenders().size
  const show = useMediaLibraryStore((s) => s.showOlderRenders)
  const setShow = useMediaLibraryStore((s) => s.setShowOlderRenders)
  if (!count) return null
  return (
    <p className="px-3 py-2 text-[11px] text-muted-foreground">
      {show
        ? t('media.library.olderRenders.shown', { count })
        : t('media.library.olderRenders.hidden', { count })}{' '}
      <button
        type="button"
        className="font-medium text-foreground underline-offset-2 hover:underline"
        onClick={() => setShow(!show)}
      >
        {show ? t('media.library.olderRenders.hide') : t('media.library.olderRenders.show')}
      </button>
    </p>
  )
}
