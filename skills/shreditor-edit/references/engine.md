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
  { "callerId": "v1", "op": "addTrack", "kind": "video" },
  { "callerId": "a1", "op": "addTrack", "kind": "audio" },
  { "callerId": "vo1", "op": "addClip", "mediaId": "<id>", "trackId": { "$ref": "a1#/detail/trackId" }, "from": 0, "durationInFrames": 114 },
  { "callerId": "vo1u", "op": "updateItem", "id": { "$ref": "vo1#/detail/created/0/id" }, "updates": { "sourceStart": 14, "sourceEnd": 128, "label": "VO 01" } }
] }
```

- `callerId` names an op so later ops can reference its result. `shred` fills missing ones, but name the ones you reference.
- References: `{"$ref": "<callerId>#/detail/<path>"}`, allowed only in id fields (`id`, `ids`, `itemId`, `trackId`, `mediaId`, `leftClipId`, `rightClipId`, `effectId`). `addTrack` → `detail/trackId`; `addClip` → `detail/created/<n>/id` (video with audio creates two: video first, linked audio second); `addText` → `detail/id`.
- The whole batch applies or nothing does. `shred` sends the current revision, so a batch never lands on a project that moved underneath it.

## Ops

| Op | Fields | Notes |
|---|---|---|
| `addTrack` | `kind` video/audio, `order?` | Returns `trackId`. |
| `addClip` | `mediaId`, `trackId?`, `from?`, `durationInFrames?` | Images default to 150 frames. Video adds a linked audio clip only if the file has audio. Set the source window after with `updateItem`. |
| `addText` | `text`, `from`, `durationInFrames`, `trackId?`, `label?`, `color?`, `fontSize?`, `fontFamily?`, `fontWeight?` medium/semibold/bold, `textAlign?`, `verticalAlign?` | Stroke, shadow, letter spacing, line height and position go in a following `updateItem` / `setTransform`. |
| `updateItem` | `id`, `updates` | Any item field: `label`, `sourceStart`, `sourceEnd`, `volume`, text style fields (`stroke {width,color}`, `textShadow {offsetX,offsetY,blur,color}`, `letterSpacing`, `lineHeight`, `backgroundColor`), `transform`. Don't use it to move items between tracks; use `moveItem`. |
| `setTransform` | `id`, `transform` | Merges into the transform (creates it on clips that have none). After pulling Shreditor code changes, restart with `shred start --build`. |
| `moveItem` | `id`, `from`, `trackId?` | |
| `trimStart` / `trimEnd` | `id`, `amount` (positive frames) | Trims inward and moves the source window with it. |
| `split` | `id`, `frame` | |
| `removeItems` | `ids` | |
| `addTransition` / `updateTransition` / `removeTransition` | | Crossfade between adjacent clips. Many styles forbid transitions; check the style skill. |
| `addKeyframe` / `removeKeyframes` | `itemId`, `property`, `frame`, `value`, `easing?` | Keyframe frames count from the clip's start. |
| `addEffect` / `removeEffect` | | GPU effects; see `GET /v1/capabilities`. |
| `setTransformParent` | | Parent one item's transform to another. |

`GET /v1/capabilities` (on the service) lists the exact ops and limits for the running version.

## Text that renders as intended

- Fonts: any font installed on the machine works by its family name (e.g. `Helvetica Neue`, `Neue Haas Display`); unknown names fall back. Check a rendered frame; the editor can't tell you a font is missing.
- Text items are positioned like everything else (center origin). Give them an explicit `transform` `width` wide enough for the line, or long lines wrap.
- `stroke` draws the outline the canvas way (round joins). If a style needs square-cornered die-cut edges, say it's an approximation in the summary.

## Gotchas

- **ProRes and other codecs browsers can't decode** will not play. `shred catalog` makes the playable copy for you (`proxy` in the catalog entry); import that. By hand: H.264 `-c:v libx264 -crf 16 -pix_fmt yuv420p`.
- **Transparent video** (speaker cutouts, animated overlays) goes in as VP9 WebM with alpha (`-c:v libvpx-vp9 -pix_fmt yuva420p`; the catalog does this). Put it on a track above its background; it stays a separate layer. Check transparency on a rendered frame, not just in the preview.
- **The service holds the workspace writer lock** while it runs. Import with `shred import` (it does not need the lock). Never edit `project.json` by hand.
- **Media imported while the editor is open** shows in its library after a reload. The timeline still renders it.
- `shred frames` renders the **saved** project. Apply first, then render.
- `addClip` without `durationInFrames` on video uses the whole file; always pass the length you planned.
