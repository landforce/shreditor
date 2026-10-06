# Native export

`shred export` renders the final video with the system `ffmpeg` from the
**original** media files, so the output is not limited by browser decoding or by
the compatibility working copies (`docs/media-compatibility.md`). Whatever
ffmpeg cannot reproduce exactly is still drawn by the browser renderer, as
transparent overlay layers, and composited in the right stacking order. Framing
and timing match the browser export.

Originals are only read. Nothing is written next to them.

## Interface

```sh
shred export <projectId> [--native|--browser] [--codec h264|hevc|prores] \
  [--quality low|medium|high|ultra] [--out name]
```

- Default (no engine flag) is **auto**: native when the plan allows it,
  otherwise the browser render, with the reasons printed. HDR is the exception:
  auto refuses rather than fall back (see Colour).
- `--native` fails with the planner's reasons instead of falling back.
- `--browser` is the existing headless-Chrome export.
- Output goes to `<workspace>/projects/<id>/exports/<name>.<mp4|mov>`. A native
  export also writes `<file>.export.json`: every item's route and reason, the
  layer stack, timings and the verification below. `--out` with a directory
  also copies the file there.
- Service: `POST /v1/render` with `engine: "native" | "auto"` (plus `project`,
  `codec`, `quality`, `out`) answers JSON `{ engine, output, summary,
  decisions, layers, verification, timings }`; an auto fallback answers
  `{ engine: "browser", output, fallbackReasons }`. Without `engine` (or with
  `"browser"`) the route behaves as before and streams the file.

The CLI prints what went where, for example:

```
engine   native (h264; ffmpeg from the original media)
  native    video  golf A
  native    video  PiP
  native    video  chat overlay
  overlay   text   Text (text is drawn by the browser renderer)
  audio     native mix of 2 clip(s) from the originals
checked  150 frames, 5.000s, h264 yuv420p bt709/tv, aac 48000 Hz 5.000s
```

## Design

`headless/lib/native-plan.mjs` (pure, unit-tested in
`headless/native-plan.test.mjs`) reads the saved project and `ffprobe` of each
original and decides per item. `headless/lib/native-export.mjs` runs the plan.

1. **Plan.** Each visual item is `native` (ffmpeg places it from the original),
   `overlay` (the browser draws it) or not drawn (hidden track, controller,
   soft transcript subtitles). The rule is conservative: an item is native only
   when every feature it uses is reproduced exactly, otherwise it is an overlay
   and the reason is recorded.
2. **Stack.** Tracks paint in `order` descending (the lowest order is on top,
   as in `timeline-to-composition.ts`). Walking tracks bottom to top, overlay
   items join the open overlay group and a native item closes it, so each group
   is one browser pass sandwiched at the right depth. Items on one track never
   overlap in time, so a track's overlay items may share a group below that
   track's native items.
3. **Overlays.** The harness (`window.freecut.renderOverlayFrames`) renders
   only a group's items with the export renderer
   (`renderCompositionFrames` in `canvas-render-orchestrator.ts`) over a
   transparent background, only for the frame spans the group is active. Each
   frame is posted as an RGBA PNG (lossless, straight alpha; a line of text is
   about 65 KB at 1080x1920) to a loopback sink and becomes a numbered image
   sequence. The export renderer now clears the canvas before filling the
   background, which is what makes a transparent background possible; opaque
   backgrounds render exactly as before.
4. **Audio.** Mirrored natively when every clip is simple (below); otherwise the
   browser renders its own mix to WAV (PCM) and ffmpeg uses that.
5. **Composite.** One ffmpeg graph: a background colour plate, then each layer
   with `overlay` in a 4:4:4 10-bit working format, gated to the layer's frames.
   Alpha blending in Y'CbCr is linear in the encoded values, the same as the
   browser's sRGB canvas blend.
6. **Verify and publish.** `ffprobe -count_packets` must show exactly the
   project's frame count and size, the expected audio stream and an audio
   duration within one AAC frame of the video. Only then is the file renamed
   into `exports/` (staged in `exports/.native-*`, removed on success or
   failure).

### Semantics mirrored

| Model | Native rendering |
|---|---|
| Timeline frame `f` shows source time `sourceStart/sourceFps + (f-from)/fps*speed`, nudged 1e-4 frame at boundaries, and the frame whose timestamp is at or before it (`resolveVideoRenderSourceTimeSeconds`) | The planner computes that index sequence with the browser's float math, then proves it equals `first + floor(k*R)` for an exact rational `R = speed*sourceRate/fps`. ffmpeg seeks to half a frame before `first`, numbers decoded frames, gives frame `j` timestamp `ceil(j/R)` and lets `fps` duplicate or drop. Any other sequence stays in the browser. |
| Box = `transform.width/height` or the source contain-fitted to the canvas; `x`/`y` offset from the centre; the decoded frame contain-fitted inside the box; crop cuts inside it (`transform-resolver.ts`, `media-draw.ts`, `media-crop.ts`, including `refit`) | Same rects; the drawn rect is snapped to whole pixels (error recorded per layer as `snapErrorPx`, at most 0.5 px) and scaled with Lanczos; crop and canvas edges clip it. |
| Opacity 0-1, horizontal/vertical flip around the box centre | `lut` on alpha; `hflip`/`vflip`. |
| Duration = latest item end over all items, at least one second | Same. |
| Visibility: any solo track hides the rest, else `visible !== false`; layer groups pass hide/mute/solo down | Same. |
| Audio per clip: gain `item dB + track dB`, linear fades of `floor(seconds*48000)` samples at clip start and end, mono duplicated to both channels, placed at `floor(from/fps*48000)`, summed, `tanh` soft clip above 1.0, then master bus dB (`canvas-audio.ts processAudio`) | `atrim`/`asetpts` by sample count, `volume`, `afade` (triangular = linear), `pan`, `adelay` in samples, `amix normalize=0`, `aeval` soft clip, `volume`. A video's own audio is skipped when a linked audio companion carries it, as in the browser. |

## Support matrix

| Item / feature | Route |
|---|---|
| Video clip, CFR source starting at 0, square pixels, no rotation metadata, progressive | **native** |
| ... with transform x/y/width/height, contain fit, opacity, flips (default anchor), hard crop incl. `refit` | **native** |
| ... with constant speed (rational, up to 4 decimals) or a different source frame rate (24/25/50/60 into 30 ...) | **native** when the frame sequence is a constant ratio (checked), else overlay |
| ... with alpha (ProRes 4444, PNG MOV, VP9 alpha) | **native** (straight alpha) |
| ... with effects, keyframes (own or inherited by a split), motion modifiers, corner pin, blend mode, rotation, corner radius, video fade, reverse, soft crop, transitions, transform parenting | overlay (browser draws that clip from its working copy) |
| ... needing frames past the end of the source, VFR, rotation metadata, non-square pixels, interlaced, non-zero start time | overlay |
| Text, shapes, images, lottie, compound clips, subtitles, text motion | overlay |
| Any mask shape, adjustment layer, non-normal blend mode, transform parenting or transcript captions in the project | every visual item is an overlay (they read across layers) |
| Audio and video clip audio, gain, track gain, linear fades, mute, master bus | **native** mix |
| Audio with speed, reverse, pitch, EQ (clip, track or bus), ducking, volume keyframes, curved fades, solo tracks, transitions, compound clips, more than 2 channels, non-zero start | the whole mix comes from the browser (WAV PCM, 16-bit) |
| HDR or BT.2020 source (PQ, HLG, BT.2020 primaries or matrix) | refused: native never tone-maps; auto does not fall back either. `--browser` makes the browser's own SDR conversion on request. |
| Odd canvas size, non-hex background, unsupported fps | refused; auto falls back to the browser render |

## Colour and bit depth

- Output is tagged and encoded BT.709 primaries/transfer/matrix, limited range.
  Each source is converted from its own matrix and range (`bt470bg`/`smpte170m`
  as BT.601, `pc`/`yuvj*` as full range; untagged sources as BT.709 at 720p and
  above, BT.601 below). Primaries are not converted (SDR sources only).
- The working format is 4:4:4 10-bit. HEVC encodes Main10 and ProRes 10-bit
  when any native source is 10-bit or more; H.264 is always 8-bit 4:2:0.
- Overlays are 8-bit sRGB from the canvas, composited over the 10-bit base.
- Audio stays PCM float until the final encode: AAC for MP4, PCM s24le for
  ProRes MOV. Loudness mastering is separate (`shred master`).

| Codec | Quality low / medium / high / ultra | Audio |
|---|---|---|
| `h264` (libx264, slow, High) | CRF 23 / 20 / 17 / 14, 8-bit 4:2:0 | AAC 160 / 192 / 256 / 320k |
| `hevc` (libx265, medium, `hvc1`) | CRF 26 / 23 / 20 / 16, Main10 for 10-bit sources | same |
| `prores` (prores_ks) | 422 HQ 10-bit; `ultra` = 4444 10-bit | PCM s24le |

## Measured results

Proof project (1080x1920, 30 fps, 150 frames): three cuts from two originals
(ProRes 422 HQ 10-bit `golf-cart-push-in.mov`, H.264 full-range BT.601
`01-warehouse-through.mp4`), a 432x768 picture-in-picture of the H.264 source,
the transparent ProRes 4444 overlay `lf-warehouse-chat-cued.mov` with its PCM
audio at -4 dB, a 140 px text item with a 10 px stroke, and a stereo bed at
-9 dB with 0.5 s / 1 s fades. The originals were imported with `shred import`
(APFS clones); their SHA-256 matched before and after. The planner sent all
five video clips native and the text to one overlay group. Native H.264 took
4.6 s (1.6 s overlays, 2.9 s encode); the browser export about 3 s.

| Check | Native | Browser |
|---|---|---|
| Video frames / duration | 150 / 5.000 s | 150 / 5.000 s |
| Audio duration | 5.000 s | 5.077 s |
| Native vs browser, all 150 frames | SSIM min 0.980 / mean 0.989, PSNR min 35.9 / mean 38.3 dB | |
| Same, shifted by one frame (control) | SSIM mean 0.903, PSNR 27.0 dB | |
| Text overlay region, frames 10-139 | SSIM mean 0.986, PSNR 40.5 dB | |
| vs original ProRes, cut A (frames 0-9, RGB) | PSNR 46.9 dB, SSIM 0.985 | PSNR 38.7 dB, SSIM 0.979 |
| vs original ProRes, cut C (lower strip, RGB) | PSNR 48.6 dB, SSIM 0.991 | PSNR 44.2 dB, SSIM 0.993 |
| vs original H.264, cut B (lower strip, RGB) | PSNR 42.3 dB, SSIM 0.981 | PSNR 32.4 dB, SSIM 0.963 |
| ProRes HQ export vs original, 10-bit 4:2:2 YUV | PSNR 65.7 dB | n/a (8-bit only) |
| HEVC Main10 export vs original, 10-bit 4:2:0 YUV | PSNR 52.3 dB | n/a |
| Audio level, 7 windows incl. both fades | within 0.02 dB of the browser mix | |
| Integrated loudness | -21.1 LUFS | -21.1 LUFS |

The browser's slightly higher SSIM on the flat concrete strip of cut C comes
from x264's psychovisual tuning at CRF 14, not from the pipeline: the same
strip is 4.4 dB closer to the original in PSNR, and the 10-bit outputs are
65.7 dB. On cut B (a full-range BT.601 source) the browser export is visibly
yellower than the original decoded by its tags (luma mean 113.0 in a test
strip where a BT.601-to-BT.709 conversion gives 118.7); the native export
converts the matrix and range and matches the original.

A/V and frame accuracy (fixture: a 12-bit frame-index barcode with white flash
frames and 2 ms clicks at the same instants; three cuts across an H.264+AAC
file and a ProRes+PCM file, 190 frames):

| | Native | Browser |
|---|---|---|
| Frames whose barcode index differs from the expected source frame | 0 of 190 | 0 of 190 |
| Click minus flash, 4 events | 0.06, 0, 0, 0 ms | 57, 73, 52, 52 ms (audio late) |

The browser figures above (late audio, the yellow cut B, the 5.077 s audio)
were measured before two browser-export fixes:

- **A/V.** Chrome's AAC encoder puts 2112 samples (44 ms at 48 kHz) of
  priming before the audio and Mediabunny writes no edit list for it, so the
  export now marks it in the MP4/MOV edit list
  (`src/features/export/utils/isobmff-audio-priming.ts`, delay measured once
  per encoder config by `audio-encoder-delay.ts`). Separately, a clip's audio
  decode started at the packet before its source start, so a cut was late by
  up to a packet (13-16 ms on the fixture); decodes are now cut to the exact
  range by sample timestamp (`decoded-audio-range.ts`). Re-measured on an
  8 s, three-cut fixture (H.264+AAC and ProRes+PCM): click minus flash 44, 44,
  57, 57, 60, 60 ms before, 0 ms on all six after, for MP4 and MOV; the audio
  is now as long as the video. WebM/Opus exports are still about 7 ms late.
- **Colour.** Mediabunny takes a track's colour space only from a `colr` box,
  and Chrome's decoder ignores the H.264 VUI, so full-range BT.601 footage
  without `colr` decoded as BT.709. The decoder config now carries the matrix
  and range from the SPS (`src/shared/media/avc-color-space.ts`, H.264 only;
  HDR signals are left alone). Against the source decoded by its tags, RGB
  PSNR: full-range BT.601 bars 29.2 dB before, 36.5 dB after (native 39.7);
  the phone clip 32.7 dB before, 37.1 dB after (native 38.1); BT.709 limited
  bars unchanged at 41.0 dB. The few levels left come from the hardware
  decoder's full-to-limited range step. The editor preview's paused and
  scrubbed frames use the same decode and are fixed too; playback through the
  `<video>` element still shows such a file as BT.709.

`npm run headless:test:fidelity` checks both against ffmpeg-made fixtures.

A second project (speed 1.5 clip, text on a track between two video tracks, a
cropped 70%-opacity picture-in-picture from ProRes, a keyframed clip on top)
planned three native layers and two overlay groups, matched the expected
`10 + floor(1.5k)` source frames on all 60 frames, and compared to the browser
export at SSIM mean 0.998, PSNR mean 50.3 dB. Its audio (speed 1.5) came from
the browser mix, as planned.

Reproduce: build two projects like the above in a scratch workspace, export
each with `--browser` and with the default engine, and compare with ffmpeg
`ssim`/`psnr` (tag untagged originals explicitly, e.g.
`setparams=colorspace=bt709:range=tv`, or ffmpeg converts their matrix before
comparing).

## Limits

- Overlay clips (anything with effects, keyframes, transitions...) are drawn
  from the browser's decode, so they keep its working-copy and 8-bit limits.
- Sources must be CFR with a constant frame-index ratio; VFR phone footage and
  files with rotation metadata go through the overlay path.
- Placement snaps the drawn rect to whole pixels (≤ 0.5 px); scaling uses
  ffmpeg's Lanczos rather than Chrome's resampler, so scaled clips differ in
  fine detail, not in framing.
- Native audio covers gain, fades, mute and placement. Anything else makes the
  whole mix come from the browser (16-bit WAV), which still keeps it PCM.
- Whole-project exports only (no in/out range). Output resolution is the
  project's.
- Overlay frames are full-canvas PNGs: dense full-frame overlays (a full-screen
  image for minutes) cost disk in the staging folder and encode time.
- Needs `ffmpeg`/`ffprobe` with `libx264`, `libx265` and `prores_ks`.
