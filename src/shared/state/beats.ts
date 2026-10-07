import { create } from 'zustand'
import { getOrDecodeAudio } from '@/runtime/composition-runtime/utils/audio-decode-cache'
import { createLogger } from '@/shared/logging/logger'
import { detectBeats, type BeatAnalysis } from '@/shared/audio/beat-detection'

export type { BeatAnalysis } from '@/shared/audio/beat-detection'

const log = createLogger('Beats')

/** Analysis (or its progress) per media id. Absent = never requested. */
export type BeatEntry = BeatAnalysis | 'pending' | 'failed'

interface BeatsState {
  byMediaId: Record<string, BeatEntry>
  /** Decode `src` through the preview audio cache and analyse it once per media id. */
  request: (mediaId: string, src: string | Blob) => void
}

/** Let the UI paint before a few hundred ms of DSP runs on the main thread. */
function whenIdle(task: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => task(), { timeout: 500 })
  } else {
    setTimeout(task, 0)
  }
}

export const useBeatsStore = create<BeatsState>()((set, get) => ({
  byMediaId: {},
  request: (mediaId, src) => {
    if (get().byMediaId[mediaId] !== undefined) return
    set((state) => ({ byMediaId: { ...state.byMediaId, [mediaId]: 'pending' } }))

    const fail = (error: unknown) => {
      log.warn('Beat analysis failed', { mediaId, error })
      set((state) => ({ byMediaId: { ...state.byMediaId, [mediaId]: 'failed' } }))
    }

    getOrDecodeAudio(mediaId, src)
      .then((buffer) => {
        const channelData: Float32Array[] = []
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          channelData.push(buffer.getChannelData(channel))
        }
        whenIdle(() => {
          try {
            const analysis = detectBeats({ sampleRate: buffer.sampleRate, channelData })
            set((state) => ({ byMediaId: { ...state.byMediaId, [mediaId]: analysis } }))
          } catch (error) {
            fail(error)
          }
        })
      })
      .catch(fail)
  },
}))
