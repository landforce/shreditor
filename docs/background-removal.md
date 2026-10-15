# Background removal ("cutout")

Cut a speaker (or the main object) out of footage shot in a real room, with no
green screen. It works in the editor (clip panel and Concise shot card), through
the agent engine (`setCutout`, `shred cutout`), in `shred frames`, and in both
export engines.

## How it works

1. **Settings on the clip.** A video item's optional `cutout`
   (`src/types/cutout.ts`): `{ enabled, subject: 'auto'|'person'|'object',
   feather?, invert?, refine?, sampleRate?, strokes? }`. Validated by the
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
   `index.json` lists the stored sample ranges and what `auto` resolved to;
   writers merge into it (sample ranges union), so the editor and the agent
   service can both add samples. Masks are 640 px on the long edge (about
   10–25 KB each).
4. **Compositing** (`src/features/export/utils/canvas-item-renderer/cutout.ts`,
   `src/infrastructure/cutout/cutout-compositor.ts`). The clip's whole frame is
   drawn uncropped into a source-sized scratch canvas through the normal video
   renderer; a WebGL2 pass then samples the two neighbouring masks **bilinearly
   in source UV space**, blends them by time, feathers (7×7 Gaussian over the
   mask, radius in source pixels), refines the edge (smoothstep), inverts if
   asked, and multiplies the result into alpha. The masked frame is then drawn
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
| SlimSAM-77 | smart brush | Apache-2.0 | Apache-2.0 (`Xenova/slimsam-77-uniform`) | encoder 8.9 MB q8 + decoder 4.9 MB q8 | 14 MB | For the brush (not built yet, see below). |
| MobileSAM / EfficientSAM | smart brush | Apache-2.0 | Apache-2.0 | conversions exist | 10–40 MB | Alternatives to SlimSAM. |
| RobustVideoMatting | person (temporal) | GPL-3.0 | GPL-3.0 | | | **Excluded** (GPL). |
| BRIA RMBG-1.4 / 2.0 | object | | CC BY-NC 4.0 | | | **Excluded** (non-commercial). |

Licences were read from each project's repository and Hugging Face model card
(October 2026). Both chosen models are listed in `THIRD_PARTY_NOTICES.md`. **Decision for the maintainer:** U-2-Net's weights inherit the repository's Apache-2.0 by reading, not by an explicit statement; if that is not good enough, object mode can switch to BiRefNet lite once it runs, at the cost of a new model id (stored masks are keyed by model).

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
- Strokes are stored but not drawn yet (see below).
- HDR: see Limits.

## Limits and what's not done

- **Smart brush (stretch goal): not built.** The data model has `strokes`
  (`add` / `remove` / `smart`, points in source-frame fractions, source time,
  radius), validated and stored, but not drawn or tracked. What's left: a
  SlimSAM encoder/decoder runner next to `cutout-model.ts` (encoder once per
  sampled frame, decoder per prompt; up to 16 positive points from the strokes,
  keep the best-IoU candidate); tracking forward by prompting the next sample
  with interior points of the previous mask and keeping the candidate with
  IoU ≥ 0.25 against it; storing corrections as a second mask layer per sample
  (`<key>/b0000123.png`) combined at draw time (max for add, min for remove) so
  the auto mask is never overwritten; a paint overlay on the preview (like the
  mask editor) for the clip panel; and an op (`setCutoutStrokes`) for agents.
- **HDR / 10-bit:** a cut-out clip is drawn through an 8-bit RGBA canvas
  (as are effects). Native export already refuses HDR sources; ProRes/HEVC
  10-bit masters keep 10 bits for native clips, but the cut-out clip itself is
  an 8-bit overlay.
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

## Tests

- `src/shared/cutout/cutout-core.test.ts`: sample grid, interpolation,
  ranges, storage keys, index merging, settings rules.
- `src/infrastructure/cutout/cutout.test.ts`: planning per media, temporal
  smoothing, edge refinement bounds, model input sizing and normalisation.
- `src/headless/cutout-op.test.ts`: the `setCutout` op, splits keeping it, schema.
- `headless/cutout.test.mjs`: native export routing, the wire schema, the
  store's path guard and verified model cache, status, `shred cutout`.
- `headless/cutout-e2e.mjs` (`SHRED_CUTOUT_E2E=1 npm run headless:test:cutout`):
  the real model in the harness on a talking-head clip made from a pinned
  portrait image; checks the room is cut out and the face opaque in a rendered
  frame and in a native export.
