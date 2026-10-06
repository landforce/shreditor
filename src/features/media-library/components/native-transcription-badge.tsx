import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, Loader2, MicOff, RotateCcw } from 'lucide-react'
import type { MediaMetadata } from '@/types/storage'
import { requestNativeTranscription } from '@/infrastructure/storage/bridge-fs/bridge-transcription'
import { createLogger } from '@/shared/logging/logger'
import { cn } from '@/shared/ui/cn'
import { useMediaLibraryStore } from '../stores/media-library-store'

const logger = createLogger('NativeTranscriptionBadge')

interface NativeTranscriptionBadgeProps {
  media: MediaMetadata
  className?: string
}

/**
 * Subtle state of the bridge's background transcription on a media card:
 * queued, transcribing, no speech, or failed (click to retry). Shows nothing
 * once done, when unavailable (Settings explains), for media without audio,
 * or while an in-app transcription of the same media owns the status.
 */
export const NativeTranscriptionBadge = memo(function NativeTranscriptionBadge({
  media,
  className,
}: NativeTranscriptionBadgeProps) {
  const { t } = useTranslation()
  const appStatus = useMediaLibraryStore((s) => s.transcriptStatus.get(media.id) ?? 'idle')
  const state = media.transcription
  const retry = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      void requestNativeTranscription(media.id).catch((error) =>
        logger.warn('Native transcription retry failed', error),
      )
    },
    [media.id],
  )

  if (!state || appStatus === 'queued' || appStatus === 'transcribing') return null
  const base = cn('p-0.5 rounded bg-black/60 text-white/80', className)

  switch (state.status) {
    case 'queued':
      return (
        <div
          className={cn(base, 'pointer-events-auto')}
          title={t('media.card.nativeTranscriptQueued')}
        >
          <Clock className="w-2.5 h-2.5" />
        </div>
      )
    case 'running':
      return (
        <div className={cn(base, 'pointer-events-auto')} title={t('media.card.nativeTranscribing')}>
          <Loader2 className="w-2.5 h-2.5 animate-spin" />
        </div>
      )
    case 'none':
      if (state.reason === 'no-audio' || appStatus === 'ready') return null
      return (
        <div
          className={cn(base, 'pointer-events-auto text-white/60')}
          title={t('media.card.nativeNoSpeech')}
        >
          <MicOff className="w-2.5 h-2.5" />
        </div>
      )
    case 'failed':
      if (appStatus === 'ready') return null
      return (
        <button
          type="button"
          onClick={retry}
          className={cn(base, 'pointer-events-auto text-amber-300 hover:text-amber-200')}
          title={t('media.card.nativeTranscriptFailed', { error: state.error ?? '' })}
          aria-label={t('media.card.nativeTranscriptRetry')}
        >
          <RotateCcw className="w-2.5 h-2.5" />
        </button>
      )
    default:
      return null
  }
})
