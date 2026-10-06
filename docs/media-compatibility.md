# Media compatibility

Shreditor uses Mediabunny/WebCodecs and its registered ProRes WASM decoder first.
The local bridge prepares a full-resolution derivative when a workspace import
uses a video/audio codec outside the preparation policy's browser candidate list,
or when a workspace frame decoder explicitly requests native recovery. This is
an independent Shreditor implementation built on the system FFmpeg.

## Integration

- `server/media-compatibility.mjs`: FFmpeg policy, bounded process queue, cached
  derivatives, source validation, and output decode verification.
- `POST /__shreditor/media/prepare`: `{ mediaId, force?: boolean }`. Resolves an
  existing workspace original; it does not accept arbitrary executable arguments.
  Returns `{ prepared: false }` or `{ prepared: true, url, alpha, cached }`.
  Disconnecting the owning request aborts its subprocess. Other callers wait for
  a shared job and retry if its owner cancelled it.
- Native path import prepares known unsupported video inputs automatically.
  In-place Finder import calls the same service before browser metadata extraction.
- `readMediaSource` (browser) and `resolveMediaFile` (headless) both use the
  derivative manifest. `resolveMediaFile(..., { original: true })` explicitly
  accesses the original, including linked footage.
- `VideoFrameExtractor` switches from default acceleration to software, then
  hardware hints after recoverable errors, at most once per alternative per
  session. If those fail, a registered workspace source can request native
  preparation. Disposing cancels native preparation and rejects late frames.
- Browser metadata probes DOM file playback separately from custom frame-decoder
  support. A failed or absent probe is unknown, never assumed supported.

## File and color policy

Original media stays untouched. Derivatives live at
`media/<id>/cache/compatibility/<key>.mp4|mov`, with an atomically written manifest.
The cache key includes canonical source path, byte size, modification time, policy,
and policy version. It is not a content hash. Replacing a source while preserving
all those attributes is not detected; remove its compatibility cache in that case.

Opaque conversion uses full-resolution H.264/yuv420p (CRF 16) and AAC. Odd dimensions
are padded by at most one pixel. Transparent conversion uses ProRes 4444 with alpha
and PCM audio, decoded in the browser through the existing ProRes extension.
These are encoding conversions, not lossless copies. Preview and final export use
the same full-resolution derivative; low-resolution scrub proxies are separate.

FFmpeg preserves variable frame timestamps and relative A/V offsets with
`-copyts -start_at_zero` and `-fps_mode passthrough`. FFmpeg's normal autorotation
applies during conversion. Only the first video and first optional audio stream
are prepared. Alternate audio tracks and subtitle tracks are not imported by this
component.

When native preparation would be needed for HDR or BT.2020 input, it returns
`HDR_POLICY_REQUIRED`. It does not silently tone-map or label the source SDR.
Direct browser HDR decoding retains the browser's existing limitations.

## Limits and failures

- Requires local `ffmpeg` and `ffprobe`, including `libx264` and `prores_ks` for
  the corresponding conversion. A missing tool/encoder is an explicit failure.
- Native preparation: two active jobs, sixteen queued jobs, a thirty-minute
  encode deadline, and thirty-second probe/verification deadlines.
- Frame decode waits: ten seconds; timed-out frames are closed when they arrive.
- Native recovery is available for registered workspace sources in the local
  editor. A standalone browser-only deployment has no native service. Existing
  OPFS/file-handle-only sources must be brought into workspace storage to use it.
- The native policy's codec list identifies candidates, not universal support
  for every profile/device. Actual frame production can still fail.
- Existing preview decoder-pool limits and prewarm scheduling remain in place;
  this change does not introduce a new global decoded-byte memory budget.
- Broken files can fail import/preparation. Outputs are published only after a
  successful encode, stream probe, and first-frame decode. This is not a proof
  of decoding every frame on every target device.

## Verification

Use Node 22 or 24. Node 26's experimental `localStorage` behavior breaks unrelated
existing store tests. Install dependencies in the checkout (`npm ci`); symlinking
another checkout's dependencies can cause Vite to deny external WASM assets.

```sh
npm run check
npm run test:run
npm run headless:test:node
npm run build
npm run headless:test:compatibility
```

The native tests generate fixtures for cache reuse/invalidation, original
preservation, broken/cancelled input, alpha preservation, VFR timestamps, and delayed
audio. The Chrome test runs opaque MPEG-4 MOV and transparent PNG MOV through native
import, forward/backward frame requests, Shreditor composition, and actual export,
then checks rendered/exported pixels. Fixtures, browser processes, and temporary
workspaces are cleaned up by the tests.

Browser verification was run with Chrome on macOS. Other browser/OS combinations
have not been verified by these checks.

This branch passed 4,815 Vitest tests, 57 Node tests, the existing portable
headless/browser/media checks, the compatibility browser checks, type/lint checks,
production build, boundary checks, and changed-code health. Repository-wide unused
export/member checks still report existing findings; the same findings were
confirmed in a clean copy of base commit `ca2ac123`. This change introduces none.
