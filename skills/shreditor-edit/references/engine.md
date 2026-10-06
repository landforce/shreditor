# Shreditor engine reference

What `shred apply` accepts and how the project behaves. Verified against the Shreditor code; if something here disagrees with what the service returns, the service wins. Report the mismatch rather than working around it.

## Units and model

- Time is **frames at the project fps** everywhere in ops (`from`, `durationInFrames`, `frame`, `amount`).
- Source windows: `sourceStart` / `sourceEnd` are frames **at the source's fps** (`sourceFps` on the item). Audio with no fps uses the project fps. A clip plays source `[sourceStart, sourceEnd)` from timeline frame `from` for `durationInFrames`.
- The canvas origin for transforms is the **canvas center**: `x`, `y` are pixel offsets from center; `width`, `height` are the item's drawn size in pixels; `rotation` degrees clockwise; `opacity` 0-1.
- Without a transform, images and video are fitted **inside** the canvas (contain). For full-bleed, set `width`/`height` to the cover size, e.g. a 4:3 photo on 1080x1920 → `width 2560, height 1920`.
- Clip volume is **dB** (-60 to +12, default 0).
- Tracks are ordered; a video track added later sits **above** earlier ones. Paint order follows tracks, not item order.

## A batch

```json
{ "ops": [
  { "callerId": "vo1", "op": "addClip", "mediaId": "<id>", "trackId": "track-2", "from": 0, "durationInFrames": 114 },
  { "callerId": "vo1u", "op": "updateItem", "id": { "$ref": "vo1#/detail/created/0/id" }, "updates": { "sourceStart": 14, "sourceEnd": 128, "label": "VO 01" } },
  { "callerId": "txt", "op": "addTrack", "kind": "video" },
  { "callerId": "t1", "op": "addText", "text": "Hook", "trackId": { "$ref": "txt#/detail/trackId" }, "from": 0, "durationInFrames": 60 }
] }
```

- **New projects already have their tracks**: a format's named layout (`shred new --format`, e.g. `track-title`, `track-images`, `track-speaker`, `track-speaker-audio`), or V1 (`track-1`) and A1 (`track-2`) without a format. `shred new` prints them. Build on those. `addTrack` only for an extra layer, never to "set up" a project.

- `callerId` names an op so later ops can reference its result. `shred` fills missing ones, but name the ones you reference.
- References: `{"$ref": "<callerId>#/detail/<path>"}`, allowed only in id fields (`id`, `ids`, `itemId`, `trackId`, `mediaId`, `leftClipId`, `rightClipId`, `effectId`). `addTrack` → `detail/trackId`; `addClip` → `detail/created/<n>/id` (video with audio creates two: video first, linked audio second); `addText` → `detail/id`.
- The whole batch applies or nothing does. `shred` sends the current revision, so a batch never lands on a project that moved underneath it.

## Ops

| Op | Fields | Notes |
|---|---|---|
| `addTrack` | `kind` video/audio, `order?` | Returns `trackId`. Only for extra layers; V1/A1 exist already. |
| `removeTrack` | `trackId`, `removeItems?` | Fails if the track has items unless `removeItems: true` (linked companions on other tracks go too; `detail/removedItems` lists them). The last track can't be removed. |
| `addClip` | `mediaId`, `trackId?`, `from?`, `durationInFrames?` | Images default to 150 frames. Video adds a linked audio clip only if the file has audio; it goes on the first audio track free for that range (a new one if none is), so it stays in sync. `detail/created/<n>/trackId` says where. Set the source window after with `updateItem`. |
| `addText` | `text`, `from`, `durationInFrames`, `trackId?`, `label?`, `color?`, `fontSize?`, `fontFamily?`, `fontWeight?` medium/semibold/bold, `textAlign?`, `verticalAlign?` | Stroke, shadow, letter spacing, line height and position go in a following `updateItem` / `setTransform`. |
| `updateItem` | `id`, `updates` | Any item field: `label`, `sourceStart`, `sourceEnd`, `volume`, text style fields (`stroke {width,color}`, `textShadow {offsetX,offsetY,blur,color}`, `letterSpacing`, `lineHeight`, `backgroundColor`), `transform`. Don't use it to move items between tracks; use `moveItem`. |
| `setTransform` | `id`, `transform` | Merges into the transform (creates it on clips that have none). After pulling Shreditor code changes, restart with `shred start --build`. |
| `moveItem` | `id`, `from`, `trackId?` | |
| `trimStart` / `trimEnd` | `id`, `amount` (positive frames) | `trimStart` cuts `amount` off the head; `trimEnd` **extends** the tail by `amount` (to shorten a clip, `updateItem` its `durationInFrames` and `sourceEnd`). The source window moves with it. |
| `split` | `id`, `frame` | |
| `removeItems` | `ids` | |
| `addTransition` / `updateTransition` / `removeTransition` | | Crossfade between adjacent clips. Many styles forbid transitions; check the style skill. |
| `addKeyframe` / `removeKeyframes` | `itemId`, `property`, `frame`, `value`, `easing?` | Keyframe frames count from the clip's start. |
| `addEffect` | `itemId`, `gpuEffectType`, `params?` | Returns `detail.effectId`. Params are checked against the effect's ranges (`shred effects <id>`); omitted params take their defaults. |
| `updateEffect` | `itemId`, `effectId`, `params?`, `enabled?` | Merges `params` into the effect; `enabled: false` bypasses it (handy for a before/after frame). |
| `removeEffect` | `itemId`, `effectId` | |
| `addLut` | `itemId`, `lut`, `intensity?` (0..1, default 1) | Adds a `gpu-lut` effect from `<workspace>/luts/<lut>` (a file name there, e.g. `"Warm.cube"`; `shred lut list`). The LUT is embedded in the effect as the editor's LUT panel does (resampled to 33³), so later changes to the file don't touch the clip. Returns `detail.effectId`. An unknown name fails and lists what `luts/` has. |
| `setTransformParent` | | Parent one item's transform to another. |

`GET /v1/capabilities` (on the service) lists the exact ops and limits for the running version.

## Formats

A project's `format` (`{ id, variant, reviewedHash }`, set by `shred new --format` or `shred format set`) picks one of the four definitions in `<repo>/formats/registry.mjs`; `shred format <projectId>` prints its rules, targets and guide.

- **Roles.** Each item plays a role in the format: `speaker`, `images`, `plates`, `broll`, `shots`, `title`, `captions`, `labels`, `voice`, `music`, `sfx`. The scorecard resolves it in this order: the item's `formatRole`, caption markers (`textRole: "caption"`, subtitle items), the media's category (mapped per format: `graphics` is `images` in a Graphic Yap, `plates` in a Greenscreen), the track's role (`formatRole` on the track, which format tracks carry, or a track named like the layout), then the item type (text from frame 0, at least 2 s, top or middle is the title; other text is a label).
- **Set a role** when placement and category don't say it: `{ "op": "updateItem", "id": "<id>", "updates": { "formatRole": "title" } }`. A PNG title lockup on the Title track is already `title`; text on a picture track is never a picture.
- **Sync sound.** Linked audio from b-roll counts as sync sound, not speech (category `b-roll`); a 10 Shot fails on it, so remove it (`removeItems`) or mute it (`volume: -60`).
- **`shred check <id> [--json]`** scores the saved timeline: rules (title hook from frame 0 and its hold, captions, speech, voiceover, music, SFX, sync sound, transitions) and numeric targets (length, change rates, first image or cut, longest stretch, shot lengths, speech rate, pauses). Each check is `pass`, `warn`, `fail`, `info` (measured, no band) or `n/a` (can't measure), with frame ranges to look at. Pauses and speech rate come from the built-in transcripts mapped through each clip's source window; without one they are `n/a`. Exit code 1 means a fail-severity check failed.

## Media categories

Each media's `category` (in `media/<id>/metadata.json`) says what it is for: `speaker`, `b-roll`, `graphics`, `overlay`, `voiceover`, `music`, `sfx`, `other`. Absent means uncategorized. `categorySource` says who set it:

- `agent`: `shred import ... --category <c>` or `shred categorize <mediaId>=<c> ...` (`none` clears, and keeps it cleared)
- `user`: the media card's Category menu
- `auto`: the editor's background analysis suggested it (video only: `speaker` when speech covers at least 30% of the clip and a person is in frame; `b-roll` for no audio, no or little speech, or speech over footage with nobody in frame). Never set over an explicit category; a newer suggestion may replace an older one
- absent with a category: explicit (set before sources were recorded)

Explicit categories (`agent`, `user`, no source) are never changed automatically, including after the project is reopened. Re-setting an auto suggestion with `shred categorize` confirms it. `shred media --project <id>` (or `GET /__shreditor/media/categories?projectId=`) lists every media's category, source and transcript state. The media pane shows Speaker, B-roll, Graphics, Overlays, Voiceover, Music, SFX, Other, then Analyzing (video waiting for its transcript), then the rest by file type; suggestions carry a small "auto" tag. Categories don't affect ops or rendering.

Categories don't affect ops or rendering; they do feed the format scorecard's roles (explicit and auto alike).

## Transcripts

Imported audio/video is transcribed in the background by whisper.cpp (`ggml-large-v3-turbo`, local) into `media/<id>/cache/ai/transcript.json`, the editor's own transcript store. Status is `transcription` in `media/<id>/metadata.json`: `queued`, `running`, `done`, `none` (`reason`: `no-audio`, `silent`, `no-speech`), `failed`, `unavailable` (whisper.cpp or the model missing; `hint` says what to run). Words are in source seconds (`start`, `end`, `confidence`); `sourceStart` for a word is `round(word.start * sourceFps)` (the project fps for audio with no fps). Times come from whisper's DTW alignment, typically within about 0.1 s of the spoken onset; check a tight cut with `shred frames` or by ear. Phantom lines Whisper invents on music, typing or silence ("Thank you.", "See you next time") are dropped. A transcript made or edited in the app is never replaced unless `shred transcribe <id> --force`.

## Same-track overlaps are errors

Two items on one track can't overlap. Any op that would make them (`addText`, `addClip`, `addItem`, `moveItem`, `updateItem` changing `from`/`durationInFrames`/`trackId`, `trimEnd` growth) fails the whole batch, nothing applied, naming the op, the track, the item in the way and both frame ranges (`[from, end)`, end exclusive):

```
EDIT_OP_FAILED Edit op "addText" failed: same-track overlap: callerId "cta" (addText) would put text "Follow for more" at frames [50, 80) on track V1 (track-1), which overlaps text "Hook line" (bc2a…) at frames [0, 60). …
```

Nothing is ever shifted to make room. Pick a free range, put the item on another track, or move/trim the other one first in the same batch. Text over footage goes on its own video track.

## Text that renders as intended

- Fonts: any font installed on the machine works by its exact family name (e.g. `Helvetica Neue`, `Avenir Next`, `Neue Haas Grotesk Display Pro`), in the weights it ships; the editor and the export draw the same installed face. Unknown names silently fall back to sans-serif in both: `Neue Haas Display` is one (the Neue Haas Display files install the family `Neue Haas Grotesk Display Pro`). Check a rendered frame; the editor can't tell you a font is missing.
- Text items are positioned like everything else (center origin). Give them an explicit `transform` `width` wide enough for the line, or long lines wrap.
- `stroke` is `{ width, color, join? }`. `width` is px outward from the glyph edge. `join` is `round` (default), `miter` (square die-cut corners; very sharp points past a miter limit of 3 are bevelled so they don't spike) or `bevel`. Text inside a transitioning compound clip draws through the GPU glyph path, which keeps round joins and caps the outline at about 8px.
- `letterSpacing` is px (at project resolution) added after every character, spaces included, as in CSS. A word gap therefore shrinks by about twice the value: -6.5 on a 124px bold title leaves roughly 30px between words, versus about 44px at 0.

Text background box: `backgroundColor` (with `backgroundRadius`, `textPadding`) hugs the text lines by default. Set `backgroundMode: "box"` to fill the item's whole transform box (`width` x `height`) instead, with the text laid out inside it by `textAlign`, `verticalAlign` and `textPadding`. That builds a fixed-size chat pill or panel natively: e.g. `transform { width: 800, height: 140 }`, `backgroundColor "#ffffff"`, `backgroundRadius 70`, `textPadding 36`, `textAlign "left"`. The radius is clamped to half the shorter side.

## Shapes: UI elements

A chat bubble, pill, card or bar is a `shape` item placed with `addItem`, with a text item on a track above it. `shapeType` is `rectangle`, `circle`, `ellipse`, `triangle`, `star`, `polygon` or `heart`; `fillColor`, `strokeColor`/`strokeWidth` style it, and `cornerRadius` (pixels, on the item, not in `transform`) rounds the outline. Verified (renders a blue rounded pill with white text, 1080x1920):

```json
{ "ops": [
  { "callerId": "top", "op": "addTrack", "kind": "video" },
  { "callerId": "pill", "op": "addItem", "item": { "type": "shape", "shapeType": "rectangle", "trackId": "track-1",
      "from": 0, "durationInFrames": 90, "label": "Chat pill", "fillColor": "#2b7cff", "cornerRadius": 60,
      "transform": { "x": 0, "y": 300, "width": 720, "height": 140 } } },
  { "callerId": "msg", "op": "addText", "text": "hey, you up?", "trackId": { "$ref": "top#/detail/trackId" },
    "from": 0, "durationInFrames": 90, "fontSize": 64, "color": "#ffffff", "fontWeight": "semibold" },
  { "callerId": "msgPos", "op": "setTransform", "id": { "$ref": "msg#/detail/id" },
    "transform": { "x": 0, "y": 300, "width": 680, "height": 120 } }
] }
```

`cornerRadius` of half the height gives a full pill. Size the shape to the text yourself; it doesn't follow the text.

## Typing text

Typing is **one text item with the `typewriter` text motion**, not a run of items swapping in. Set it with `updateItem` (`updates.textMotion`); `typewriter-erase` in the `out` slot backspaces at the end. Pass every field: missing ones fall back to generic defaults (12-frame duration, no stagger, ease-out), not the preset's.

```json
{ "callerId": "typing", "op": "updateItem", "id": "<text id>", "updates": { "textMotion": {
  "in":  { "presetId": "typewriter", "unit": "character", "durationFrames": 1, "staggerFrames": 3, "offsetFrames": 0,
           "order": "forward", "easing": "linear", "intensity": 1, "seed": 0 },
  "out": { "presetId": "typewriter-erase", "unit": "character", "durationFrames": 1, "staggerFrames": 2,
           "order": "backward", "easing": "linear", "intensity": 1, "seed": 0 } } } }
```

- Timing: character *n* (0-based, spaces don't count) appears at clip frame `offsetFrames + n × staggerFrames + durationFrames`. `staggerFrames` is the typing speed (frames per character); `offsetFrames` delays the start. The `out` slot ends at the clip's end (its `offsetFrames` counts back from there).
- If `durationFrames + staggerFrames × (characters − 1)` is longer than **half the clip**, the whole slot is squeezed to fit, so typing runs faster than asked. Make the clip long enough, or split the line.
- To cue typing to exact frames, place the item at the frame typing should start and compute from the formula; there are no per-character keyframes.
- The line is laid out at its final size from the first frame (centered text doesn't drift while it types). Verified on rendered frames: 2, 5, 8 then all 10 characters visible at frames 4, 13, 22, 30 with stagger 3.

## Colour and sound, per clip

Correction is a judgement, not a pipeline step: a clip gets it when you (or the user) can see or hear that it needs it, never by default. The user can open and change everything below in the editor (Effects and Color in the clip panel; Audio for volume, fades and EQ).

**Find candidates.** `shred qc <mediaId...> | --project <id>` measures each clip's ORIGINAL file and prints prompts: noise in the pauses, rumble, pops, hiss or harsh S sounds, clipping; dark, clipped, flat/log-looking or colour-cast picture. Thresholds are loose on purpose. A prompt means look or listen, then decide. Clips from one camera in one scene should match each other before they match a look; the style skill decides the look.

**Picture.** Colour is a GPU effect on the clip (`addEffect`), drawn in preview and export alike. `shred effects --category color` lists them with params, ranges and defaults.
- `gpu-color-wheels` is the primary corrector and what the editor's Color panel edits: `exposure` (-3..3 stops), `contrast` (0..2, 1 = none) around `pivot`, `temperature` / `tint` (-100..100: negative is cooler / greener), `saturation` (-100..100), `lift` / `gamma` / `gain` / `offset`, and hue wheels (`shadowsHue`/`shadowsAmount`, `midtonesHue`/..., `highlightsHue`/...). One per clip is usually enough.
- `gpu-curves`, `gpu-levels`, `gpu-vibrance`, `gpu-exposure`, `gpu-temperature` are there for specific jobs.
- LUTs: the workspace LUT library is `<workspace>/luts/*.cube`, shared with the user (the editor's LUT panel lists it under Library, and every `.cube` the user imports there is saved into it). `shred lut add <file.cube...> [--name x.cube]` copies 3D LUTs in (1D and malformed files are refused; an existing name with other content needs `--force` or another `--name`); `shred lut list` shows name, size and TITLE. Apply one with `{"op":"addLut","itemId":…,"lut":"Warm.cube","intensity":0.8}`. A LUT is a look, not a fix: correct first (`gpu-color-wheels`), then the LUT, and pull `intensity` down before reaching for a different LUT.
- Saved grades: `shred grade list` prints the user's grade presets (saved in the editor's Color panel; name, id, effects). `shred grade apply <id> <itemId...> --preset <name|id>` gives clips that grade the way the editor does: each clip's colour effects (`shred effects --category color`, LUTs included) are removed and the preset's added, other effects kept, all in one atomic batch. Re-running it replaces the grade again rather than stacking it.
- Work: `shred frames` before, `addEffect` with small moves, `shred frames` after (or `updateEffect … enabled:false` for the before) and open both. Fix the reason the qc prompt fired (a yellow cast → `temperature` negative, `tint` to taste; flat/log → contrast and saturation up), then stop. Highlights at white are gone: darken, don't expect detail.
- Native export draws a clip with an effect in the browser (`shred export` prints the route).

**Sound.** Audio settings are fields on the **audio** item: for video with sound, the linked audio item `addClip` created second (`detail/created/1/id`). Set them with `updateItem`; values outside the editor's ranges are rejected.
- `volume` dB (-60..12), `audioFadeIn` / `audioFadeOut` seconds.
- Low cut (rumble, handling, wind, most mic pops): `audioEqLowCutEnabled: true`, `audioEqLowCutFrequencyHz` (20..399; 80–100 for voice), `audioEqLowCutSlopeDbPerOct` (6, 12, 18, 24).
- Four bands: `audioEqLow…`, `audioEqLowMid…`, `audioEqHighMid…`, `audioEqHigh…`, each with `…Enabled`, `…Type` (`low-shelf`, `peaking`, `high-shelf`, `notch`), `…FrequencyHz` (20..22000), `…GainDb` (-20..20) and `…Q` (0.3..10.3). E.g. muddy voice: `audioEqLowMidType: "peaking"`, `…FrequencyHz: 300`, `…GainDb: -3`; harsh S sounds: a high-mid cut around 6–8 kHz. Mains hum: a `notch` at 50 or 60 Hz.
- High cut (hiss above the voice): `audioEqHighCutEnabled: true`, `audioEqHighCutFrequencyHz` (1400..22000; 10–12 kHz for voice), `audioEqHighCutSlopeDbPerOct`.
- `audioEqOutputGainDb` trims after the EQ.
- Dynamics are objects on the audio item; absent or `enabled: false` is off, and `enabled` is required when the object is present. Chain: noise reduction → EQ → compressor → de-esser → volume/fades → limiter.
  - `audioDenoise: { enabled, amount }`: RNNoise, `amount` 0–100 % wet (default 90). Lowers steady noise in pauses by about 14 dB at 80, 20 at 90; 100 can sound underwater. For hiss, room tone, fans.
  - `audioCompressor: { enabled, thresholdDb (-60..0, -18), ratio (1..20, 3), attackMs (0.1..200, 10), releaseMs (10..2000, 150), makeupDb (0..24, 0), kneeDb (0..24, 6) }`. Gentle voice: -18, 2:1, 15/150 ms, +3 makeup. Firm voice: -26, 4:1, 5/100 ms, +7 makeup, plus the limiter.
  - `audioDeEsser: { enabled, frequencyHz (3000..12000, 6000), thresholdDb (-60..0, -30), maxReductionDb (0..24, 8) }`: turns down only the band above `frequencyHz` when it gets loud.
  - `audioLimiter: { enabled, ceilingDb (-24..0, -1), releaseMs (1..1000, 60) }`: after volume and fades; holds peaks under the ceiling.
  - Plosives and rumble: the low cut at 90 Hz, 18 dB/oct (see above).
  - Noise reduction makes preview audio play about 30 ms late; export is in sync. Clips with dynamics take their audio from the browser mix in native export.
- Listen to what you changed, or say you couldn't: render an `audioOnly` WAV of the range and check it with ffmpeg, and re-run `shred qc` on mastered files.
- EQ or volume keyframes make native export take its audio from the browser mix (fine; it prints so).

## Loudness

Clip `volume` is plain gain (the per-clip limiter only holds peaks), so a loudness target (e.g. -14 LUFS integrated, true peak ≤ -1.5 dBTP) is met on the file, before import:

- `shred master <voiceover or final mix stem> [--lufs -14] [--tp -1.5] [--out file.wav]` writes `<name>.mastered.wav` next to the input (original untouched) with ffmpeg's two-pass `loudnorm` (measure, then normalize with the measured values; it limits true peak itself) and prints before/after integrated LUFS and true peak measured with `ebur128`. Import the mastered file.
- Everything playing together adds up: a -14 LUFS VO plus b-roll audio lands louder. Measure the final export (render `audioOnly` WAV, or the exported video): `ffmpeg -nostats -i out.wav -filter_complex ebur128=peak=true -f null -` and read `I:` and `Peak:` in the summary. If it misses, lower the beds, or master the exported mix and use that as the only audio.

## Export

`shred export <id> [--native|--browser] [--codec h264|hevc|prores] [--quality low|medium|high|ultra] [--out name]` writes `<workspace>/projects/<id>/exports/<name>.mp4|mov` plus `<file>.export.json`. Default: native when the plan allows (ffmpeg renders video clips from the ORIGINAL files; text, shapes, images, effects, keyframed or transitioning clips are drawn by the browser as transparent overlays and composited in track order), else the browser render with the reasons. HDR sources refuse native and do not fall back; `--browser` is the explicit opt-in. It prints each item's route; read it. ProRes and HEVC keep 10 bits from 10-bit sources. Speed, EQ, ducking, pitch or volume keyframes make the audio come from the browser mix. Design and limits: `docs/native-export.md` in the Shreditor repo.

## Gotchas

- **Files Chrome can't decode as they are** get a working copy on import (`shred import`, the editor's import): video copied into a playable container with PCM audio when only the container or audio is the problem, else HEVC Main10 (10-bit/HDR, same colour tags) or H.264 CRF 12 (8-bit, same chroma). ProRes is not converted (the editor decodes it itself). Never convert by hand; import the original. `metadata.json` `compatibility` records original, working copy, notes and checks.
- **While a copy is made** the media is `preparing`: `shred import` waits (`--no-wait` returns at once), `shred media <id>` shows `making playable copy NN%`, `ready` or `failed: why` (`--wait`, `--retry`), the editor card shows it, and `addClip` with it fails with `MEDIA_NOT_READY` (409).
- **Transparent video** (speaker cutouts, animated overlays) keeps its alpha. Put it on a track above its background; it stays a separate layer. Check transparency on a rendered frame, not just in the preview.
- **The service holds the workspace writer lock** while it runs. Import with `shred import` (it does not need the lock). Never edit `project.json` by hand.
- **Media imported while the editor is open** shows in its library within about a second (the editor polls the bridge). If it doesn't, reload the page; the timeline renders it either way.
- `shred frames` renders the **saved** project. Apply first, then render.
- `addClip` without `durationInFrames` on video uses the whole file; always pass the length you planned.
