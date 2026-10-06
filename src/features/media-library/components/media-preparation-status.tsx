import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Copy, Loader2, RefreshCw } from 'lucide-react'
import type { MediaMetadata } from '@/types/storage'
import { describeWorkingCopy } from '@/shared/utils/media-compatibility'
import { retryMediaPreparation } from '../deps/storage'
import { useMediaLibraryStore } from '../stores/media-library-store'

/**
 * Working-copy state on a media card (server/media-preparation.mjs): progress
 * while the bridge makes a playable copy, failure with a retry, and a badge
 * once the media plays from its working copy.
 */

function RetryButton({ mediaId }: { mediaId: string }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      className="pointer-events-auto inline-flex items-center gap-1 rounded bg-white/15 px-1.5 py-0.5 text-[9px] text-white hover:bg-white/25 disabled:opacity-50"
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation()
        setBusy(true)
        void retryMediaPreparation(mediaId)
          .then(() => useMediaLibraryStore.getState().refreshMediaItems())
          .catch((error: unknown) =>
            useMediaLibraryStore.getState().showNotification({
              type: 'error',
              message: error instanceof Error ? error.message : String(error),
            }),
          )
          .finally(() => setBusy(false))
      }}
    >
      <RefreshCw className="w-2.5 h-2.5" />
      {t('media.card.retryPlayableCopy')}
    </button>
  )
}

/** Overlay for a card whose media isn't usable yet. */
export function PreparationOverlay({
  media,
  label,
  compact = false,
}: {
  media: MediaMetadata
  label: string
  compact?: boolean
}) {
  const failed = media.compatibility?.status === 'failed'
  const title = failed ? media.compatibility?.error : media.compatibility?.detail
  const icon = 'w-4 h-4 shrink-0'
  return (
    <div
      className={`absolute inset-0 bg-black/60 flex flex-col items-center justify-center ${compact ? '' : 'gap-1 px-1 text-center leading-tight'} pointer-events-none`}
      title={title}
    >
      {failed ? (
        <AlertTriangle className={`${icon} text-amber-300`} />
      ) : (
        <Loader2 className={`${icon} text-white animate-spin`} />
      )}
      {!compact && <div className="text-[9px] text-white/60 uppercase tracking-wider">{label}</div>}
      {!compact && failed && <RetryButton mediaId={media.id} />}
    </div>
  )
}

/** "Working copy" badge with a from → to tooltip; nothing for media playing from its original. */
export function WorkingCopyBadge({
  media,
  small = false,
}: {
  media: MediaMetadata
  small?: boolean
}) {
  const label = describeWorkingCopy(media)
  if (!label) return null
  return (
    <div
      className={`${small ? 'absolute top-0.5 left-0.5 ' : ''}p-0.5 rounded bg-sky-600/90 text-white`}
      title={label}
      aria-label={label}
    >
      <Copy className="w-2.5 h-2.5" />
    </div>
  )
}

/** List-view retry, shown next to the name when the working copy failed. */
export function PreparationRetry({ media }: { media: MediaMetadata }) {
  return media.compatibility?.status === 'failed' ? <RetryButton mediaId={media.id} /> : null
}
