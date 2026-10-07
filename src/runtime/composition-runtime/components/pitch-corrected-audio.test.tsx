import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DEFAULT_AUDIO_EQ_SETTINGS } from '@/shared/utils/audio-eq'

const audioDecodeMocks = vi.hoisted(() => ({
  getOrDecodeAudio: vi.fn(),
  getOrDecodeAudioSliceForPlayback: vi.fn(),
}))
const clockRateMocks = vi.hoisted(() => ({ current: 1 }))

vi.mock('@/runtime/composition-runtime/deps/player', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/runtime/composition-runtime/deps/player')>()),
  useClockPlaybackRate: () => clockRateMocks.current,
}))

const playbackStateMocks = vi.hoisted(() => ({
  current: {
    frame: 0,
    fps: 30,
    playing: false,
    resolvedVolume: 1,
    resolvedPitchShiftSemitones: 0,
    resolvedAudioEqStages: [] as (typeof DEFAULT_AUDIO_EQ_SETTINGS)[],
  } as {
    frame: number
    fps: number
    playing: boolean
    transportPlaybackRate?: number
    isPreviewScrubbing?: boolean
    resolvedVolume: number
    resolvedPitchShiftSemitones: number
    resolvedAudioEqStages: (typeof DEFAULT_AUDIO_EQ_SETTINGS)[]
  },
}))

const previewAudioMocks = vi.hoisted(() => {
  const state: { current: HTMLAudioElement | null } = { current: null }
  const createAudio = () =>
    ({
      volume: 1,
      muted: false,
      playbackRate: 1,
      currentTime: 0,
      readyState: 4,
      paused: true,
      seeking: false,
      play: vi.fn().mockImplementation(function (this: { paused: boolean }) {
        this.paused = false
        return Promise.resolve()
      }),
      pause: vi.fn().mockImplementation(function (this: { paused: boolean }) {
        this.paused = true
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as HTMLAudioElement

  return {
    state,
    acquirePreviewAudioElement: vi.fn(() => {
      const audio = createAudio()
      state.current = audio
      return audio
    }),
    releasePreviewAudioElement: vi.fn(),
    markPreviewAudioElementUsesWebAudio: vi.fn(),
  }
})

const previewGraphMocks = vi.hoisted(() => {
  const sourceNode = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  }

  const graph = {
    context: {
      state: 'running' as const,
      currentTime: 0,
      resume: vi.fn(() => Promise.resolve()),
      createMediaElementSource: vi.fn(() => sourceNode),
    },
    sourceInputNode: {},
    outputGainNode: {
      gain: {
        value: 1,
      },
    },
    eqStageNodes: [],
    dispose: vi.fn(),
  }

  return {
    graph,
    sourceNode,
    createPreviewClipAudioGraph: vi.fn(() => graph),
    rampPreviewClipEq: vi.fn(),
    rampPreviewClipGain: vi.fn(),
    setPreviewClipGain: vi.fn(),
  }
})

const storeMocks = vi.hoisted(() => {
  const gizmoState = { activeGizmo: null, preview: null }
  const useGizmoStore = Object.assign(
    vi.fn((selector?: (state: typeof gizmoState) => unknown) =>
      selector ? selector(gizmoState) : gizmoState,
    ),
    {
      getState: () => gizmoState,
    },
  )

  return {
    useGizmoStore,
    usePlaybackStore: {
      getState: () => ({ isPlaying: false, previewFrame: null }),
    },
  }
})

vi.mock('../utils/audio-decode-cache', () => audioDecodeMocks)
vi.mock('./hooks/use-audio-playback-state', () => ({
  useAudioPlaybackState: vi.fn(() => playbackStateMocks.current),
}))
vi.mock('./hooks/use-preview-clip-dynamics', () => ({ usePreviewClipDynamics: vi.fn() }))
vi.mock('../utils/preview-audio-element-pool', () => previewAudioMocks)
vi.mock('../utils/preview-audio-graph', () => previewGraphMocks)
vi.mock('@/runtime/composition-runtime/deps/stores', () => storeMocks)
vi.mock('./soundtouch-worklet-audio', () => ({
  SoundTouchWorkletAudio: ({
    audioBuffer,
    sourceStartOffsetSec,
  }: {
    audioBuffer: AudioBuffer
    sourceStartOffsetSec?: number
  }) => (
    <div
      data-testid="pitch"
      data-frames={audioBuffer.length}
      data-offset={sourceStartOffsetSec ?? 0}
    />
  ),
}))

import { PitchCorrectedAudio } from './pitch-corrected-audio'

function makeAudioBuffer(durationSeconds = 8): AudioBuffer {
  const sampleRate = 22050
  const length = sampleRate * durationSeconds
  return {
    duration: durationSeconds,
    numberOfChannels: 2,
    length,
    sampleRate,
    getChannelData: () => new Float32Array(length),
  } as unknown as AudioBuffer
}

describe('PitchCorrectedAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clockRateMocks.current = 1
    playbackStateMocks.current = {
      frame: 0,
      fps: 30,
      playing: false,
      resolvedVolume: 1,
      resolvedPitchShiftSemitones: 0,
      resolvedAudioEqStages: [],
    }
  })

  it('keeps 1x playback on the native preview path', async () => {
    render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
      />,
    )

    await waitFor(() => {
      expect(previewAudioMocks.acquirePreviewAudioElement).toHaveBeenCalledWith('blob:audio')
    })

    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).not.toHaveBeenCalled()
    expect(audioDecodeMocks.getOrDecodeAudio).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="pitch"]')).toBeNull()
  })

  it('keeps the native preview graph alive while EQ stages change', async () => {
    const { rerender } = render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
        volumeMultiplier={1}
      />,
    )

    await waitFor(() => {
      expect(previewGraphMocks.createPreviewClipAudioGraph).toHaveBeenCalledTimes(1)
    })

    playbackStateMocks.current = {
      ...playbackStateMocks.current,
      resolvedAudioEqStages: [DEFAULT_AUDIO_EQ_SETTINGS],
    }

    rerender(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
        volumeMultiplier={1.01}
      />,
    )

    await waitFor(() => {
      expect(previewGraphMocks.rampPreviewClipEq).toHaveBeenLastCalledWith(
        previewGraphMocks.graph,
        [DEFAULT_AUDIO_EQ_SETTINGS],
      )
    })

    expect(previewGraphMocks.createPreviewClipAudioGraph).toHaveBeenCalledTimes(1)
    expect(previewAudioMocks.acquirePreviewAudioElement).toHaveBeenCalledTimes(1)
  })

  it('uses playback-first decode for stretched clips with media ids', async () => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(2),
      startTime: 4,
      isComplete: false,
    })
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}))

    render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={240}
        playbackRate={1.5}
        trimBefore={120}
        sourceFps={30}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledWith(
        'media-1',
        'blob:audio',
        {
          minReadySeconds: 2,
          waitTimeoutMs: 6000,
          targetTimeSeconds: 4,
        },
      )
    })

    await waitFor(() => {
      expect(document.querySelector('[data-testid="pitch"]')).toHaveAttribute(
        'data-frames',
        String(22050 * 2),
      )
      expect(document.querySelector('[data-testid="pitch"]')).toHaveAttribute('data-offset', '4')
    })

    expect(audioDecodeMocks.getOrDecodeAudio).not.toHaveBeenCalled()
  })

  it('defers decoded pitch audio until an active preview scrub settles', async () => {
    playbackStateMocks.current.isPreviewScrubbing = true
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(2),
      startTime: 0,
      isComplete: false,
    })
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}))

    const { rerender } = render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={240}
        playbackRate={1.5}
      />,
    )

    await Promise.resolve()
    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).not.toHaveBeenCalled()
    expect(audioDecodeMocks.getOrDecodeAudio).not.toHaveBeenCalled()

    playbackStateMocks.current.isPreviewScrubbing = false
    rerender(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={240}
        playbackRate={1.5}
        volumeMultiplier={1.01}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(1)
      expect(audioDecodeMocks.getOrDecodeAudio).not.toHaveBeenCalled()
    })
  })

  it('uses a synthetic decode key when pitch correction is needed without a media id', async () => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(2),
      startTime: 0,
      isComplete: false,
    })
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}))

    render(
      <PitchCorrectedAudio
        src="blob:audio"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1.25}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledWith(
        'legacy-src:blob:audio',
        'blob:audio',
        expect.objectContaining({
          minReadySeconds: 2,
          waitTimeoutMs: 6000,
        }),
      )
    })

    expect(document.querySelector('[data-testid="pitch"]')).toBeInTheDocument()
  })

  it('uses the decoded path for pitch-only shifts at 1x playback', async () => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(2),
      startTime: 0,
      isComplete: false,
    })
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}))

    render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
        audioPitchSemitones={4}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(1)
    })

    expect(document.querySelector('[data-testid="pitch"]')).toBeInTheDocument()
  })

  it('uses a reverse-ready decoded window for transient reverse shuttle', async () => {
    clockRateMocks.current = -4
    playbackStateMocks.current = {
      ...playbackStateMocks.current,
      frame: 300,
      playing: true,
      transportPlaybackRate: -4,
    }
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(6),
      startTime: 6,
      isComplete: false,
    })
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}))

    render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="nested-audio-1"
        durationInFrames={600}
        playbackRate={1}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(1)
    })
    const reverseOptions = audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[0]?.[2]
    expect(reverseOptions?.targetTimeSeconds).toBeCloseTo(10, 4)
    expect(reverseOptions?.preRollSeconds).toBe(4)
    expect(document.querySelector('[data-testid="pitch"]')).toBeInTheDocument()
  })

  it('parks a premounted element on its first sample and starts it at the cut without a seek', async () => {
    const seeks: number[] = []
    let currentTime = 0
    const audio = {
      volume: 1,
      muted: false,
      playbackRate: 1,
      readyState: 0,
      paused: true,
      seeking: false,
      play: vi.fn(() => {
        audio.paused = false
        return Promise.resolve()
      }),
      pause: vi.fn(() => {
        audio.paused = true
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    Object.defineProperty(audio, 'currentTime', {
      get: () => currentTime,
      set: (value: number) => {
        seeks.push(value)
        currentTime = value
      },
    })
    previewAudioMocks.acquirePreviewAudioElement.mockImplementationOnce(
      () => audio as unknown as HTMLAudioElement,
    )
    playbackStateMocks.current = { ...playbackStateMocks.current, frame: -1, playing: true }
    const renderAudio = (volumeMultiplier: number) => (
      <PitchCorrectedAudio
        src="blob:audio"
        itemId="item-1"
        durationInFrames={30}
        playbackRate={1}
        trimBefore={60}
        sourceFps={30}
        volumeMultiplier={volumeMultiplier}
      />
    )

    const { rerender } = render(renderAudio(1))

    // No metadata yet: it parks as soon as it can seek.
    await waitFor(() =>
      expect(audio.addEventListener).toHaveBeenCalledWith('loadedmetadata', expect.any(Function), {
        once: true,
      }),
    )
    expect(audio.play).not.toHaveBeenCalled()
    audio.readyState = 4
    const parkOnFirstSample = audio.addEventListener.mock.calls.find(
      ([type]) => type === 'loadedmetadata',
    )![1] as () => void
    parkOnFirstSample()
    expect(currentTime).toBe(2)

    const seeksBeforeCut = seeks.length
    playbackStateMocks.current = { ...playbackStateMocks.current, frame: 0 }
    rerender(renderAudio(1.01))

    await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(1))
    expect(seeks.length).toBe(seeksBeforeCut)
  })
})
