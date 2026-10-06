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

- **New projects already have V1 (`track-1`, video) and A1 (`track-2`, audio)**; `shred new` prints them. Build on those. `addTrack` only for an extra layer (text over footage, a second audio bed), never to "set up" a project.

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
| `addEffect` / `removeEffect` | | GPU effects; see `GET /v1/capabilities`. |
| `setTransformParent` | | Parent one item's transform to another. |

`GET /v1/capabilities` (on the service) lists the exact ops and limits for the running version.

## Media categories

Each media's `category` (in `media/<id>/metadata.json`) says what it is for: `speaker`, `b-roll`, `graphics`, `overlay`, `voiceover`, `music`, `sfx`, `other`. Absent means uncategorized. Set it with `shred import ... --category <c>` or `shred categorize <mediaId>=<c> ...` (`none` clears). When any media in a project has one, the editor's media pane groups by category (that order, uncategorized last) instead of by file type. Categories don't affect ops or rendering.

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

## Loudness

Clip `volume` is plain gain with no limiter, so a loudness target (e.g. -14 LUFS integrated, true peak ≤ -1.5 dBTP) is met on the file, before import:

- `shred master <voiceover or final mix stem> [--lufs -14] [--tp -1.5] [--out file.wav]` writes `<name>.mastered.wav` next to the input (original untouched) with ffmpeg's two-pass `loudnorm` (measure, then normalize with the measured values; it limits true peak itself) and prints before/after integrated LUFS and true peak measured with `ebur128`. Import the mastered file.
- Everything playing together adds up: a -14 LUFS VO plus b-roll audio lands louder. Measure the final export (render `audioOnly` WAV, or the exported video): `ffmpeg -nostats -i out.wav -filter_complex ebur128=peak=true -f null -` and read `I:` and `Peak:` in the summary. If it misses, lower the beds, or master the exported mix and use that as the only audio.

## Gotchas

- **ProRes and other codecs browsers can't decode** will not play. `shred catalog` makes the playable copy for you (`proxy` in the catalog entry); import that. By hand: H.264 `-c:v libx264 -crf 16 -pix_fmt yuv420p`.
- **Transparent video** (speaker cutouts, animated overlays) goes in as VP9 WebM with alpha (`-c:v libvpx-vp9 -pix_fmt yuva420p`; the catalog does this). Put it on a track above its background; it stays a separate layer. Check transparency on a rendered frame, not just in the preview.
- **The service holds the workspace writer lock** while it runs. Import with `shred import` (it does not need the lock). Never edit `project.json` by hand.
- **Media imported while the editor is open** shows in its library within about a second (the editor polls the bridge). If it doesn't, reload the page; the timeline renders it either way.
- `shred frames` renders the **saved** project. Apply first, then render.
- `addClip` without `durationInFrames` on video uses the whole file; always pass the length you planned.
