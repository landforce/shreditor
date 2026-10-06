/**
 * Paints a pooled preview <video> into a sibling canvas instead of relying on
 * the element's own compositor layer.
 *
 * Chromium on macOS (seen in Chrome 152 / the Electron browser pane) drops the
 * compositor output of a <video> whose frames are software-decoded after the
 * page's compositor surface is hidden and shown again (tab or pane switch,
 * background-tab load). The element keeps decoding and drawImage() still reads
 * correct frames, alpha included, but the layer itself paints nothing, paused
 * or playing, with no event the page can observe. VP9 with alpha always takes
 * the software (libvpx) path, so transparent WebM overlays vanished from the
 * preview while export, which decodes through mediabunny, was fine.
 * Hardware-decoded H.264/HEVC is unaffected and keeps the zero-copy element.
 */
const SOFTWARE_DECODE_PRONE_CODECS: ReadonlySet<string> = new Set(['vp8', 'vp9', 'av1'])

export function shouldMirrorVideoToCanvas(codec: string | undefined): boolean {
  return codec !== undefined && SOFTWARE_DECODE_PRONE_CODECS.has(codec.toLowerCase())
}

/**
 * Copy the element's current frame into the canvas, resizing the backing store
 * to the video's intrinsic size. Returns false when there is no frame to copy.
 */
export function paintVideoFrameToCanvas(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): boolean {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false
  const { videoWidth, videoHeight } = video
  if (videoWidth <= 0 || videoHeight <= 0) return false
  if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
    canvas.width = videoWidth
    canvas.height = videoHeight
  } else {
    ctx.clearRect(0, 0, videoWidth, videoHeight)
  }
  ctx.drawImage(video, 0, 0, videoWidth, videoHeight)
  return true
}
