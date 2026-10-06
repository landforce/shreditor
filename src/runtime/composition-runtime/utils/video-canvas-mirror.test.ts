import { describe, expect, it, vi } from 'vite-plus/test'
import { paintVideoFrameToCanvas, shouldMirrorVideoToCanvas } from './video-canvas-mirror'

function createVideo(readyState: number, videoWidth = 1080, videoHeight = 1920) {
  return { readyState, videoWidth, videoHeight } as unknown as HTMLVideoElement
}

function createCtx() {
  return {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D & {
    clearRect: ReturnType<typeof vi.fn>
    drawImage: ReturnType<typeof vi.fn>
  }
}

describe('shouldMirrorVideoToCanvas', () => {
  it('mirrors codecs that commonly decode in software (VP9 alpha always does)', () => {
    expect(shouldMirrorVideoToCanvas('vp9')).toBe(true)
    expect(shouldMirrorVideoToCanvas('vp8')).toBe(true)
    expect(shouldMirrorVideoToCanvas('av1')).toBe(true)
    expect(shouldMirrorVideoToCanvas('VP9')).toBe(true)
  })

  it('keeps hardware-decoded and unknown codecs on the native element', () => {
    expect(shouldMirrorVideoToCanvas('avc')).toBe(false)
    expect(shouldMirrorVideoToCanvas('hevc')).toBe(false)
    expect(shouldMirrorVideoToCanvas('unknown')).toBe(false)
    expect(shouldMirrorVideoToCanvas(undefined)).toBe(false)
  })
})

describe('paintVideoFrameToCanvas', () => {
  it('sizes the canvas to the video and draws the frame, keeping its alpha', () => {
    const canvas = document.createElement('canvas')
    const ctx = createCtx()
    const video = createVideo(HTMLMediaElement.HAVE_ENOUGH_DATA)

    expect(paintVideoFrameToCanvas(video, canvas, ctx)).toBe(true)
    expect([canvas.width, canvas.height]).toEqual([1080, 1920])
    expect(ctx.drawImage).toHaveBeenCalledWith(video, 0, 0, 1080, 1920)

    // Same size on the next frame: clear first so transparent pixels stay transparent.
    expect(paintVideoFrameToCanvas(video, canvas, ctx)).toBe(true)
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 1080, 1920)
    expect(ctx.drawImage).toHaveBeenCalledTimes(2)
  })

  it('skips an element without a decoded frame', () => {
    const canvas = document.createElement('canvas')
    const ctx = createCtx()

    expect(paintVideoFrameToCanvas(createVideo(HTMLMediaElement.HAVE_METADATA), canvas, ctx)).toBe(
      false,
    )
    expect(
      paintVideoFrameToCanvas(createVideo(HTMLMediaElement.HAVE_ENOUGH_DATA, 0, 0), canvas, ctx),
    ).toBe(false)
    expect(ctx.drawImage).not.toHaveBeenCalled()
  })
})
