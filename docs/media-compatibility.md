# Media compatibility

Preview runs in Chrome and export runs in headless Chrome, so a clip works only
if Chrome (or the editor's own ProRes WASM decoder) decodes it. Anything that
decodes as it is is never converted. For the rest, the local bridge makes a
full-resolution **working copy** with the system FFmpeg; the original is never
modified. Implementation: `server/media-compatibility.mjs` (policy, FFmpeg,
verification) and `server/media-preparation.mjs` (background jobs, state).

## Decision table

Measured with Chrome 154 on macOS: `<video>` playback (preview) and the export
path (mediabunny + WebCodecs), headless.

| Input | Result |
| --- | --- |
| H.264 8/10-bit 4:2:0/4:2:2/4:4:4, HEVC 8/10-bit (incl. PQ/HLG, 4:2:2, 4:4:4), VP8, VP9 (incl. alpha, 4:4:4, 10-bit), AV1 8/10-bit in MOV/MP4/MKV/WebM with AAC/MP3/Opus/Vorbis/FLAC/PCM | kept |
| ProRes (any) | kept, decoded by the editor's ProRes WASM decoder (never `<video>`) |
| Playable video in AVI, MPEG-TS/PS, MXF, ... or with AC-3/E-AC-3/ALAC/DTS/MP2 audio | `rewrap`: video stream copied, audio copied or decoded to PCM (same rate, channels, sample precision). MOV, or MKV for VP8/VP9/AV1 |
| Other video, 10-bit or HDR/BT.2020 (DNxHR HQX, 10-bit MPEG-2, ...) | `hevc`: HEVC Main10 CRF 12, chroma layout and colour tags kept; HDR stays HDR |
| Other video, 8-bit (PNG/QTRLE `.mov`, MJPEG, MPEG-4 Part 2, DNxHD, ...) | `h264`: H.264 CRF 12, chroma kept (4:4:4 for RGB, converted with BT.709 and tagged) |
| Other video with alpha (PNG/QTRLE with alpha, ...) | `prores-alpha`: ProRes 4444 (10-bit, 16-bit alpha) + PCM, decoded by the WASM decoder |
| A decode failure in the browser (`force`) | same rules for any codec; a ProRes alpha source becomes `vp9-alpha` (8-bit 4:2:0, noted) |

Off macOS only plain H.264/VP8/VP9/AV1 4:2:0 are assumed; 10-bit becomes 8-bit
H.264 (noted) and HDR that needs conversion is refused with
`HDR_POLICY_REQUIRED` rather than tone-mapped. Not verified on other platforms.

Conversion details: timestamps passed through (`-copyts -start_at_zero`,
`-fps_mode passthrough`, source timescale in MOV), no B-frames (reordering broke
VFR sample durations), decoded frames relabelled with the stream's colour tags
before filtering (some decoders mislabel; FFmpeg would otherwise convert
matrices), primaries/transfer carried and never invented, odd sizes padded by
one pixel only where chroma needs it (noted). A stream copy whose timestamps
come out in decode order (packed B-frames in AVI) is re-encoded instead (noted).
Only the first video and first audio stream are prepared.

## State, UI and CLI

`media/<id>/metadata.json` `compatibility`: `status` (`preparing` with
`progress` 0..1, `ready`, `failed` with `error`), `action`, `detail`,
`original` and `derivative` (codec, profile, pix_fmt, bit depth, chroma, size,
fps, timebase, colour tags, audio), `settings`, `notes` (bit depth or chroma
reductions, audio offset changes, padding), `verification` (frame counts,
duration delta, A/V offset delta). When ready, the top-level codec/size/mimeType
describe the working copy.

- Editor: the media card shows "Making playable copy… NN%", a failure with
  Retry, and a working-copy badge whose tooltip says from → to. Preparing or
  failed media can't be dragged or dropped onto the timeline. The pane updates
  through `useProjectMediaWatcher`.
- `shred import` waits with progress (`--no-wait` returns; a detached worker
  continues). `shred media <id> [--wait] [--retry] [--json]`. `shred catalog`
  reports `browserPlayable` and `workingCopy` from the same policy; it makes no
  proxies.
- Agent service: `addClip` on preparing/failed media fails with
  `MEDIA_NOT_READY` (409).
- Bridge routes: `media/import` (`wait`), `media/ingest` (editor in-place
  import), `media/prepare` (waits; frame-decoder safety net), `media/retry`.

Jobs: two at a time per process, a per-media lock (`job.json`, pid + heartbeat)
across processes; a job whose process died is resumed by the editor's media
poll (at most every 10 s) or `shred media --wait`.

## Files and cache

Working copies live at `media/<id>/cache/compatibility/<key>.mov|mp4|mkv` with
an atomically written `manifest.json` (version 2). The key covers source path,
size, mtime and the plan; replacing a source while keeping all three is not
detected. `readMediaSource` (browser) and `resolveMediaFile` (headless) use the
manifest; `resolveMediaFile(..., { original: true })` reads the original.

## Quality evidence

`node scripts/media-compat-quality.mjs [--assets <file>...]` imports a fixture
per class (and optionally real files, read-only, sha256-checked) and reports
SSIM/PSNR (Y'CbCr 4:4:4 10-bit; RGB PSNR for RGB/alpha; alpha composited over
grey), frames and duration delta. Last run (1920x1080 fixtures):

| Class | SSIM | PSNR dB |
| --- | --- | --- |
| h264 from RGB PNG (P3 tags kept) | 0.99918 | 49.5 (RGB 44.3) |
| h264 from MJPEG 4:2:2 full range | 0.99903 | 54.5 |
| hevc from DNxHR HQX 10-bit / HDR PQ | 0.99982 | 60.1 |
| prores-alpha from PNG alpha | 0.99949 | 58.1 (VP9 alpha: 0.98542 / 34.3) |
| rewrap AC-3 MP4, TS + MP2 | decoded frames bit-identical | |
| forced ProRes 422 HQ -> hevc | 0.99985 | 60.3 |
| forced ProRes 4444 12-bit alpha -> vp9-alpha | 0.99794 | 56.2 |

All with equal frame counts and zero duration delta (rewraps 6-11 ms of container
rounding). Real files: a PNG-codec P3 graphic 0.99992 / 58.5 dB; a ProRes 422 HQ
clip and a ProRes 4444 alpha clip are kept (their forced fallbacks measure
0.99875 / 57.8 dB and 0.99983 / 61.0 dB).

## Limits

- Requires local `ffmpeg`/`ffprobe` with libx264, libx265, prores_ks, libvpx.
- Encode deadline thirty minutes; sixteen queued jobs per process.
- Drag-and-drop copies into the browser (not bridge in-place import) are not
  prepared up front; the frame decoder's native fallback covers them.
- Clips already on the timeline whose media is re-prepared keep their item until
  the editor re-resolves the source.
- AVI with packed B-frames: frame timing follows FFmpeg's interpretation (the
  first frame starts after the reorder delay); recorded in notes.

## Verification

Use Node 22 or 24. `npm run headless:test:node` and
`npm run headless:test:compatibility` (needs a build and Chrome; runs
headless): every class through native import, export-path frames, `<video>`,
composite and export; VFR frames around a timestamp gap in both paths.
