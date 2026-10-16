# Background removal ("cutout")

Cut a speaker (or the main object) out of footage shot in a real room, with no
green screen. It works in the editor (clip panel and Concise shot card), through
the agent engine (`setCutout`, `shred cutout`), in `shred frames`, and in both
export engines.

## How it works

1. **Settings on the clip.** A video item's optional `cutout`
   (`src/types/cutout.ts`): `{ enabled, subject: 'auto'|'person'|'object',
   feather?, invert?, refine?, sampleRate?, strokes? }` (`strokes`: brush
   corrections, see Smart brush). Validated by the
   project schema and by `cutoutSettingsProblem`
   (`src/shared/cutout/cutout-core.mjs`), which the `setCutout` op shares. Split,
   trim, duplicate and linked edits carry it like any other item field.
2. **Analysis** (`src/infrastructure/cutout/`). Masks are computed from the
   clip's *source* media on a fixed grid, sample *i* at *i / rate* seconds of
   source time (default 10 per second; `sampleRate: 'full'` = every source
   frame), only over the source ranges cut-out clips play, padded by one sample
   each side. `cutout.worker.ts` decodes the samples with mediabunny, runs the
   model on onnxruntime-web (WebGPU, else wasm), stabilises the mattes over time
   and posts each one back as an 8-bit PNG. `cutout-analysis.ts` is the queue:
   one job at a time (per media, subject and rate), progress you can subscribe
   to, cancellable, and it joins duplicate requests.
3. **Storage.** Per media, in the workspace media folder like transcripts and
   filmstrips:

   ```
   media/<mediaId>/cache/cutout/index.json                  what is analysed
   media/<mediaId>/cache/cutout/<fingerprint>-<model>-r<rate>/s0000123.png
   ```

   The key holds the media's **content fingerprint** (file size, modification
   time, frame size and duration: the identity the workspace already dedupes
   imports by; `contentHash` is left out because it is computed lazily and would
   change the key the first time it appears), the model and the sample rate. A
   relinked or replaced file gets new masks; clips of the same media share them.
   `index.json` lists the stored sample ranges, what `auto` resolved to and the
   smart brush's tracked regions (`regions`); writers merge into it (sample
   ranges union), so the editor and the agent service can both add samples. Masks are 640 px on the long edge (about
   10–25 KB each).
4. **Compositing** (`src/features/export/utils/canvas-item-renderer/cutout.ts`,
   `src/infrastructure/cutout/cutout-compositor.ts`). The clip's whole frame is
   drawn uncropped into a source-sized scratch canvas through the normal video
   renderer; a WebGL2 pass then samples the two neighbouring masks **bilinearly
   in source UV space**, blends them by time, feathers (7×7 Gaussian over the
   mask, radius in source pixels), refines the edge (smoothstep), inverts if
   asked, applies the brush corrections (Smart brush) and multiplies the result
   into alpha. The masked frame is then drawn
   with the clip's own crop and transform, so crop, flip, resize, rotation,
   corner radius, effects, keyframes, masks and blend modes all apply as for an
   uncut clip. Feather, edge and invert never re-run the model. The direct GPU
   paths that draw raw frames are skipped for cut-out clips, and the preview
   keeps its rendered overlay on for them (paused and playing), redrawing as
   masks land.
5. **Export.** Browser export (`render-pipeline.ts`) analyses missing masks
   first, with progress ("Removing background n/m"), then renders on the main
   thread (it owns the workspace's mask store). Native export sends a cut-out
   clip to the overlay route with the reason `background removal`; the rest
   stays native. In the agent service every render (frames, overlays, browser
   export) analyses what it needs first: a frame only the samples around it.
6. **Models** download on first use from a URL pinned to a Hugging Face commit
   and are checked against their SHA-256 before use: in the browser through the
   shared ONNX model cache (Settings › Models and licenses lists them, and the
   model cache inspector shows "Background removal"); in the agent service
   through its cutout store, which downloads once into
   `<workspace>/app/models/cutout/` and verifies the file.

### The agent service's cutout store

`headless/lib/cutout-store.mjs` is a loopback HTTP server the harness page
uses: `GET|PUT /fs/file?path=media/<id>/cache/cutout/...` (the same API as the
editor's workspace bridge, so the page code is shared; nothing outside cutout
folders is reachable), `GET /models/<file>` (verified model cache) and
`PUT /progress` (job progress, so `GET /v1/cutout` can report it while the page
is busy). Its address rides in the harness URL (`?cutoutStore=`).

## Smart brush

Fix an automatic mask by painting. Four tools (`CutoutStroke.tool`):

| Tool | What it does |
|---|---|
| `smartBrush` | Keeps the region SlimSAM finds under the stroke, tracked through the clip (brings back an arm or a held product the auto mask lost). |
| `smartEraser` | Removes the region under the stroke, tracked through the clip (a chair, a second person). |
| `brush` / `eraser` | Discs of the brush radius along the path. They **follow the motion of a tracked smart region** whose box held the stroke on the frame it was painted on (by that region's centroid); with no such region they apply at the same spot on every frame (the UI hint says so). |

A stroke is `{ tool, at, size, points }`: `at` is the source time it was
painted on (seconds), `size` the brush radius as a fraction of the source
frame's short side, `points` `[[x, y], ...]` fractions of the source frame. At
most 64 strokes of 512 points each (`cutoutStrokeProblem`,
`src/shared/cutout/cutout-strokes.mjs`, shared by the project schema and the
ops).

**Model.** SlimSAM-77 (a pruned Segment Anything) from
`Xenova/slimsam-77-uniform`, pinned to commit `5850ab45`: the vision encoder
(fp32 on WebGPU, int8 on wasm) runs once per frame, the prompt encoder + mask
decoder (int8, wasm) once per prompt and returns three candidate masks at 256²
with their predicted IoU (`src/shared/cutout/cutout-sam.mjs` holds the model
entry and the pre/post-processing; `src/infrastructure/cutout/cutout-sam-runner.ts`
runs it). Weights download on first use and are SHA-256 checked, like the other
cutout models. Encoder outputs are kept in an LRU of 16 frames per worker
(keyed by media fingerprint and source time), so a second stroke on the same
stretch re-encodes nothing.

**Smart stroke** (`trackRegion`, `cutout-strokes.mjs`):

1. On the stroke's own sample, up to 16 points evenly spaced along the path
   (by length) prompt the decoder as positive points. Of the three candidates
   it keeps the one with the **best IoU against the painted area** (the
   stroke's discs rasterised at the mask's size), the decoder's score breaking
   ties. Picking by the decoder's own score alone keeps the whole person when
   you paint over their cardigan; the painted area says which part you meant.
   The smart eraser prompts the same way and its region is then *subtracted*
   (multiplied by 1 − r): that is where its "negative" sign goes. SlimSAM's
   negative point labels alone describe no region, so they are not used.
2. Tracking runs forward to the end of the clip's used source range, then
   backward to its start. Each next sample is prompted with up to 8 interior
   points of the previous region (deepest first by a chamfer distance
   transform, spread apart) and keeps the candidate with the best IoU against
   the previous region. A direction stops when that IoU drops below 0.25 (the
   region is lost) or a frame is missing.
3. Each region is stored as an 8-bit PNG mask beside the auto masks,
   `media/<id>/cache/cutout/<fingerprint>-slimsam-r<rate>-<strokeHash>/s0000123.png`,
   and listed in the index under `regions[<key>]` with the samples stored
   (`done`), the range tracking has been through (`covered`) and per sample the
   region's centroid, box and area (`stats`, what plain strokes follow). The
   same store and index serve the editor and the agent service; the key holds
   the stroke's hash, so editing or removing a stroke never reuses stale
   regions.

Tracking jobs run one at a time in their own worker
(`cutout-region.worker.ts`, queue in `cutout-regions.ts`), after the auto
analysis, whenever a clip's smart strokes need samples they have not covered:
in the editor's background scheduler, before browser export, and in the agent
service before every render and on `POST /v1/cutout`.

**Compositing.** At draw time, in the same WebGL2 pass, into an alpha buffer:
the auto mask (time-blended, feathered, refined, inverted), then smart-brush
regions (`max`), then smart-eraser regions (multiply by 1 − r), then the plain
strokes in painted order (brush `max`, eraser multiply by 1 − disc). Regions
blend their two neighbouring samples by time like the auto mask; a region not
stored near the frame (lost, or not tracked yet) adds nothing. Region edges use
a slightly low threshold (smoothstep 0.2–0.5) because SlimSAM's 256-pixel masks
put their soft edge a little inside the object. Strokes are drawn as distance
fields to their segments (64 points per draw, longer strokes in chunks). The
frame is then multiplied by that alpha.

**Editor.** The Full view's Remove background section has the brush: a
Painting toggle, the four tools, size, the stroke count with Clear strokes, and
tracking progress. While Painting is on, the preview takes strokes over the
clip (`cutout-paint-overlay.tsx`): stage coordinates are mapped back through
the clip's transform (position, size, rotation about its anchor, flips) and its
contain fit and crop to source fractions (`cutout-stroke-map.ts`, the same
geometry the renderer draws with), the path is thinned, and the stroke is
added at the playhead's source time as one undo step. Meanwhile the clip is
drawn with its removed area dimmed and tinted instead of transparent, so the
kept area stands out, and a badge shows tracking progress. Concise keeps the
simple toggle and adds **Fix mask…**, which switches to the Full view with
Painting on for that clip (the Concise "More" drawer is modal, so the preview
cannot be painted through it).

**Agent.** `addCutoutStroke { id, tool, points, size?, at }` and
`clearCutoutStrokes { id }` (contract, capabilities and `references/engine.md`),
and `shred cutout <id> <clip> --stroke '<tool>:x,y;x,y' --at <s> [--size r]
[--clear-strokes] [--wait]`. Status counts strokes and how many smart ones are
tracked; a clip is `ready` only when they all are.

## Models: the decision

| Model | Use | Code licence | Weights licence | ONNX (pinned) | Size | Verdict |
|---|---|---|---|---|---|---|
| **MODNet** (ZHKKKe/MODNet) | person (default, `auto` first) | Apache-2.0 | Apache-2.0 (the repo's licence covers "code, models, and demos") | `Xenova/modnet@fa2fa546` `onnx/model.onnx` sha256 `07c308cf…` | 25.9 MB fp32 | **Chosen.** Trimap-free portrait *matting* (soft hair edges), 512 short edge, runs at real-time rates on WebGPU and is usable on wasm. |
| **U-2-Net** (xuebinqin/U-2-Net) | object, and `auto` when no person | Apache-2.0 | Apache-2.0 per the repository licence (the README links the weights without a separate licence; the HF conversion is tagged `apache-2.0`) | `BritishWerewolf/U-2-Net@c08042b4` `onnx/model.onnx` sha256 `8d10d2f3…` | 176 MB fp32 | **Chosen** for objects: salient object detection at 320², simple convolutions that run on WebGPU and wasm (about 0.1–2 s per sample). Lower edge detail than BiRefNet. |
| BiRefNet lite (ZhengPeng7/BiRefNet) | object | MIT | MIT (HF model card `license: mit`) | `onnx-community/BiRefNet_lite-ONNX@de15b22b` fp16 sha256 `d39b897c…`, fp32 `56000243…` | 114.5 MB fp16 / 224 MB fp32 | **First choice, dropped after testing**: with the pinned onnxruntime-web dev build, WebGPU fails at run time ("Too many storage buffers in shader. Current: 11, Max is 10" on an Apple adapter, whose limit is 10) and wasm runs out of memory (`std::bad_alloc`) at 1024², both measured in this repo's editor and headless harness. Worth retrying when onnxruntime-web splits that op. |
| MediaPipe selfie segmentation | person, fallback | Apache-2.0 | Apache-2.0 (Google, shipped in the MediaPipe repo; `onnx-community/mediapipe_selfie_segmentation` tags apache-2.0) | `model.onnx` 462 KB | 0.46 MB | Not used: a 256² *segmentation* (hard, blocky edges) — clearly worse than MODNet for talking heads, and MODNet is small enough that an offline fallback buys little. The repo has no pattern for bundling model weights in `public/`. |
| BiRefNet portrait | person | MIT | MIT | `onnx-community/BiRefNet-portrait-ONNX` | 490 MB fp16 | Not used: too large to analyse 10 samples/s in a browser. |
| BEN2 base | object | MIT | MIT (`PramaLLC/BEN2`) | `onnx-community/BEN2-ONNX` fp16 | 219 MB | Not used: twice BiRefNet lite's size; not tested. |
| ISNet general-use (DIS) | object | Apache-2.0 | not stated upstream; the `onnx-community/ISNet-ONNX` conversion is tagged **agpl-3.0** | 176 MB | | **Excluded**: the only ready ONNX conversion carries AGPL, and the upstream weights' licence is unstated. |
| **SlimSAM-77** (czg1225/SlimSAM) | smart brush | Apache-2.0 (the SlimSAM repository's `LICENSE`) | Apache-2.0: the authors' weights `Zigeng/SlimSAM-uniform-77` and the HF port `nielsr/slimsam-77-uniform` are tagged `license: apache-2.0`, and Segment Anything, which it prunes, licenses its model under Apache-2.0 (the SA-1B *dataset*'s research licence covers the images, not the weights) | `Xenova/slimsam-77-uniform@5850ab45` (`license: apache-2.0`): `onnx/vision_encoder.onnx` sha256 `9f843327…` (WebGPU), `onnx/vision_encoder_quantized.onnx` `cce23c7b…` (wasm), `onnx/prompt_encoder_mask_decoder_quantized.onnx` `cb90b279…` | 23.3 + 4.9 MB (WebGPU) / 8.9 + 4.9 MB (wasm) | **Chosen** for the smart brush: point prompts, three candidates with predicted IoU; about 0.4 s per frame to encode on a CPU, milliseconds to decode. |
| MobileSAM / EfficientSAM | smart brush | Apache-2.0 | Apache-2.0 | conversions exist | 10–40 MB | Alternatives to SlimSAM. |
| RobustVideoMatting | person (temporal) | GPL-3.0 | GPL-3.0 | | | **Excluded** (GPL). |
| BRIA RMBG-1.4 / 2.0 | object | | CC BY-NC 4.0 | | | **Excluded** (non-commercial). |

Licences were read from each project's repository and Hugging Face model card
(October 2026; SlimSAM from github.com/czg1225/SlimSAM `LICENSE`, the
`Zigeng/SlimSAM-uniform-77`, `nielsr/slimsam-77-uniform` and
`Xenova/slimsam-77-uniform` model cards, and Segment Anything's README). The
chosen models are listed in `THIRD_PARTY_NOTICES.md` and in Settings › Models
and licenses. **Decision for the maintainer:** U-2-Net's weights inherit the repository's Apache-2.0 by reading, not by an explicit statement; if that is not good enough, object mode can switch to BiRefNet lite once it runs, at the cost of a new model id (stored masks are keyed by model).

## Temporal stability, without a recurrent model

RVM gets temporal stability from its recurrent state; we can't use it (GPL),
and single-image models flicker at the edges. Two things make up for it:

- **At analysis time**, within a contiguous run of samples, each new matte is
  pulled toward the previous (already smoothed) one by an exponential moving
  average that is **gated per pixel by motion**: where the frame's luma barely
  changed (under ~2%), up to 50% of the previous matte is kept; by ~8% change the
  gate is fully open and the new matte wins. Still edges stop shimmering, moving
  ones don't ghost (`cutout-temporal.ts`).
- **At draw time**, the two samples around the frame's source time are
  **blended by time**, so a 10/s analysis doesn't step at the edges, and a
  missing neighbour falls back to the nearest stored sample within one interval.
  For final quality set every-frame sampling (`sampleRate: 'full'`): the
  frame's own mask is used exactly.

## Compared with Concat's design

- Interpolates between the neighbouring samples instead of the nearest within
  ±250 ms; gaps fall back to a neighbour, not to an uncut frame.
- Keys masks by content fingerprint, model and rate, not by media path.
- Applies the mask on the GPU (WebGL2), in source space, not a CPU multiply.
- Brush corrections with tracked SlimSAM regions (Smart brush).
- HDR: see Limits.

## Limits and what's not done

- **Smart brush limits.** Regions come from 256-pixel masks: fine for a
  garment, a chair or a second person, too coarse for hair (use the auto mask's
  edge and `refine` there). Tracking follows one object and stops for good once
  it is lost (IoU < 0.25), even if the object comes back; paint another stroke
  on a later frame. Plain strokes follow a region's centroid, not its rotation
  or scale. Tracking runs after the auto analysis, one stroke at a time; on wasm
  (no WebGPU) the encoder takes about half a second per sample, so a 10-second
  clip at 10 samples/s takes about a minute per smart stroke. Strokes belong to
  the clip: a split copies them to both halves.
- **HDR / 10-bit.** The cutout pass keeps whatever the clip's normal path
  keeps. It works on the GPU and chooses its precision from the canvas the
  result is drawn into (`cutoutPrecision`, `cutout-compositor.ts`): for a
  `float16` 2D canvas (and a WebGL2 with `EXT_color_buffer_float` and
  `drawingBufferStorage`) the source is drawn into a matching `float16`
  scratch canvas, uploaded as `RGBA16F` half floats, masked, and written to an
  `RGBA16F` drawing buffer; otherwise it is 8-bit. Today every canvas the
  clip's normal path draws into is 8-bit (`unorm8`): the preview compositor,
  the canvas export (whose encoders are 8-bit, e.g. `hvc1.1.6` Main) and the
  browser overlays native export composites (8-bit sRGB frames over the 10-bit
  native base). So a cut-out clip renders as precisely as the same clip uncut,
  nowhere less, and the float path does not run anywhere yet. HDR sources still
  refuse native export (unchanged). What is left for real HDR/10-bit cut-outs:
  1. `float16` (and an HDR colour space) for the preview and export
     composition canvases, and drawing HDR `VideoFrame`s into them without the
     browser's SDR tone mapping;
  2. a 10-bit encoder path in browser export (Main10 or VP9 profile 2 codec
     strings fed 10-bit frames);
  3. 16-bit overlay frames for native export (for example `rgba64le` or 16-bit
     PNG) composited at 10 bits in ffmpeg, and native export of HDR sources,
     which is refused today;
  4. in the preview, an HDR-capable output canvas (an uncut clip shows HDR
     during playback only because it plays in a DOM `<video>` element; a
     cut-out clip is always drawn by the canvas renderer).

  A 10-bit SDR cut-out could instead stay native in native export by rendering
  only its alpha matte in the browser and merging it in ffmpeg (`alphamerge`);
  not done.
- Browser export of a project with a cut-out clip renders on the main thread
  (the export worker has no access to the workspace's mask store), so the editor
  is busy while it exports.
- Cut-out clips inside compound clips draw cut out when their masks exist, but
  export and the agent service only pre-analyse top-level clips; the editor
  analyses top-level clips too.
- GPU transitions draw the raw frame: a cut-out clip is shown uncut during a
  transition.
- Offline: the first use needs the network to fetch the model (cached after).

## Agent use

```sh
shred cutout <draftId> <clipId...> [--subject auto|person|object] [--wait] [--json]
shred cutout <draftId>                       # status of every cut-out clip
shred frames <draftId> --at 0,45,90          # check the edges on rendered frames
```

The op is `{ "op": "setCutout", "id": "<clip>", "enabled": true, "subject": "person", "feather": 2 }`.

Fixes: `{ "op": "addCutoutStroke", "id": "<clip>", "tool": "smartEraser", "points": [[0.4, 0.82], [0.6, 0.82]], "size": 0.04, "at": 1.5 }`
(source-frame fractions, source seconds) and `{ "op": "clearCutoutStrokes", "id": "<clip>" }`, or
`shred cutout <draftId> <clipId> --stroke 'smartEraser:0.4,0.82;0.6,0.82' --at 1.5 --size 0.04 --wait`.

## Tests

- `src/shared/cutout/cutout-core.test.ts`: sample grid, interpolation,
  ranges, storage keys, index merging, settings rules.
- `src/infrastructure/cutout/cutout.test.ts`: planning per media, temporal
  smoothing, edge refinement bounds, model input sizing and normalisation.
- `src/headless/cutout-op.test.ts`: the `setCutout` op, splits keeping it, schema.
- `headless/cutout.test.mjs`: native export routing, the wire schema, the
  store's path guard and verified model cache, status, `shred cutout`.
- `src/shared/cutout/cutout-strokes.test.ts`: prompt points along a stroke,
  thinning, the painted raster, stroke validation and hashing, region index
  merging, IoU tracking with a fake segmenter (forward, backward, stopping
  below 0.25), interior points, region stats, plain strokes following a region,
  SlimSAM input and output, and stroke-to-source mapping through transform,
  flips, rotation and crop.
- `src/infrastructure/cutout/cutout.test.ts` also: smart-stroke planning, the
  compositing order and blend modes, stroke chunking, and HDR precision and
  texture format selection.
- `src/headless/cutout-op.test.ts` also: `addCutoutStroke` and
  `clearCutoutStrokes`; `headless/cutout.test.mjs` also: their wire schemas,
  status with smart strokes, `shred cutout --stroke`.
- `headless/cutout-e2e.mjs` (`SHRED_CUTOUT_E2E=1 npm run headless:test:cutout`):
  the real models in the harness on a talking-head clip that pans across a
  pinned portrait image; checks the room is cut out and the face opaque in a
  rendered frame and in a native export, then paints a smart-eraser stroke
  over the cardigan on one frame and checks the region is tracked across the
  clip (moving with the pan) and the cardigan shows the plate on frames before
  and after the painted one while the face stays. `SHRED_CUTOUT_E2E_KEEP=1`
  keeps the rendered frames.
