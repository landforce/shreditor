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
| `addTrack` | `kind` video/audio, `order?`, `name?`, `formatRole?` | Returns `trackId`. Only for extra layers; V1/A1 exist already. `name` and `formatRole` (a format role: `shots`, `title`, ...) make it a format track. |
| `removeTrack` | `trackId`, `removeItems?` | Fails if the track has items unless `removeItems: true` (linked companions on other tracks go too; `detail/removedItems` lists them). The last track can't be removed. |
| `addClip` | `mediaId`, `trackId?`, `from?`, `durationInFrames?` | Images default to 150 frames. Video adds a linked audio clip only if the file has audio; it goes on the first audio track free for that range (a new one if none is), so it stays in sync. `detail/created/<n>/trackId` says where. Set the source window after with `updateItem`. |
| `addText` | `text`, `from`, `durationInFrames?`, `trackId?`, `label?`, `color?`, `fontSize?`, `fontFamily?`, `fontWeight?` medium/semibold/bold, `textAlign?`, `verticalAlign?`, `styleId?` | With `styleId` (a project or library style, by id or name) the text takes the style's look, position, motion and default length; the other fields given win and are recorded as overrides. Without one, stroke, shadow, letter spacing, line height and position go in a following `updateItem` / `setTransform`. See Text styles and captions. |
| `updateItem` | `id`, `updates` | Any item field: `label`, `sourceStart`, `sourceEnd`, `volume`, text style fields (`stroke {width,color}`, `textShadow {offsetX,offsetY,blur,color}`, `letterSpacing`, `lineHeight`, `backgroundColor`), `transform`. Timing changes (`from`, `durationInFrames`, `sourceStart`, `sourceEnd`, `speed`) carry to the clip's linked companion (a video's own audio) so they stay in sync; `linked: false` changes only this item, and `detail.linked` lists what followed. Don't use it to move items between tracks; use `moveItem`. |
| `setTransform` | `id`, `transform` | Merges into the transform (creates it on clips that have none). After pulling Shreditor code changes, restart with `shred start --build`. |
| `moveItem` | `id`, `from`, `trackId?` | |
| `trimStart` / `trimEnd` | `id`, `amount` (positive frames) | `trimStart` cuts `amount` off the head; `trimEnd` **extends** the tail by `amount` (to shorten a clip, `updateItem` its `durationInFrames` and `sourceEnd`). The source window moves with it. |
| `split` | `id`, `frame` | |
| `removeItems` | `ids`, `linked?` | By default linked companions go too (as in the editor: removing a video's own audio removes the video), and `detail.linkedRemoved` names them. `linked: false` removes only the listed items: they are unlinked first, as the editor's Unlink does, so a video whose audio you remove keeps playing silently (`embeddedAudioMuted`). |
| `unlinkItems` | `ids` | Makes each listed item's link group separate items (a video and its own audio move, trim and go on their own afterwards); a video that had an audio companion gets its embedded audio muted. Returns `detail.unlinked`. |
| `addMarker` | `frame`, `id?`, `label?`, `color?` | A marker on the ruler, like the user's. `id` lets you find it again (plan beats are `plan-<beat id>`); an id in use fails. Colour defaults to amber. Returns `detail.id`. |
| `removeMarkers` | `ids` | Unknown ids fail. |
| `replaceMedia` | `id`, `mediaId`, `sourceStart?` (frames at the new media's fps, default 0), `label?` | Other media in a clip, everything else kept: id, track, `from`, `durationInFrames`, speed, transform, effects, keyframes. The source window is fitted to the clip's length at its speed; media too short for it (from `sourceStart`), of another kind (video for video, image for image, audio for audio) or not ready fails. A video's own audio follows the new media, or is removed when the new media has no sound (`detail.removedAudio`; else `detail.linked`). Label defaults to the file name. `shred template fill` uses it. |
| `addTransition` / `updateTransition` / `removeTransition` | | Crossfade between adjacent clips. Many styles forbid transitions; check the style skill. |
| `addKeyframe` / `removeKeyframes` | `itemId`, `property`, `frame`, `value`, `easing?` | Keyframe frames count from the clip's start. |
| `addEffect` | `itemId`, `gpuEffectType`, `params?` | Returns `detail.effectId`. Params are checked against the effect's ranges (`shred effects <id>`); omitted params take their defaults. |
| `updateEffect` | `itemId`, `effectId`, `params?`, `enabled?` | Merges `params` into the effect; `enabled: false` bypasses it (handy for a before/after frame). |
| `removeEffect` | `itemId`, `effectId` | |
| `addLut` | `itemId`, `lut`, `intensity?` (0..1, default 1) | Adds a `gpu-lut` effect from `<workspace>/luts/<lut>` (a file name there, e.g. `"Warm.cube"`; `shred lut list`). The LUT is embedded in the effect as the editor's LUT panel does (resampled to 33³), so later changes to the file don't touch the clip. Returns `detail.effectId`. An unknown name fails and lists what `luts/` has. |
| `setTransformParent` | | Parent one item's transform to another. |
| `createComposition` | `ids`, `name` | Groups items into a layer composition (the editor's compound clip, as a Motion composition) at the project's canvas. The items keep their ids inside it. Returns `detail.id` (the composition item on the timeline), `detail.compositionId`, `detail.items`. |
| `setCompositionControls` | `compositionId`, `controls: [{ name, targetItemId, property, defaultValue? }]` | Replaces the composition's published controls: what each instance can change. `property` is `text.text`, `text.color`, `shape.fillColor` or `shape.strokeColor` (`shape.strokeColor` needs the stroke on; text with styled spans takes none). Names are unique, case-insensitive. `defaultValue` defaults to the item's current value. Returns the controls. |
| `addTemplate` | `template` (name or id), `from?`, `durationInFrames?`, `trackId?`, `controls?: { "<control name>": value }` | Places an instance of a library template (`shred motion library`): the version (variant) for the project's aspect ratio, filling the canvas (1:1 at the same size, scaled uniformly at another resolution of that aspect). No version for the project's aspect fails, naming the versions there are and the fix (`shred motion clone <name> --aspect 16:9`); nothing is fitted silently. Returns `detail.id` (the composition item), `compositionId`, `aspect`, `templateVersion`, `reused`, `hold`. Unknown control names fail and list the valid ones. Without `trackId` it takes a free track with the template's role, else a track other template instances use, else a new track on top. Shorter than the template: hold frames go first, then the end is cut. Longer: only when the version has a hold (it animates in, holds, animates out at its own end); otherwise it fails. A project that still has an older version gets `detail.warning`; run `updateTemplate`. Refused (409 `TEMPLATE_MEDIA_MISSING`, naming the files) when the template uses media the workspace lacks. |
| `setTemplateControls` | `id`, `controls: { "<control name>": value \| null }` | Changes one instance's values; `null` resets a control to the template's own value. |
| `updateTemplate` | `template` | Replaces the project's copy with the library's latest version of the same aspect ratio: every instance moves to it and keeps the values of controls whose names still exist (`detail.droppedControls` lists the rest) and its length when the version holds (else it is cut to the template's). `detail.upToDate` when there's nothing to do. |
| `applyTextStyle` | `ids`, `styleId` | Links text items to a style (project or library, id or name; a library style is copied into the project) and gives them its look for the project's aspect; their overrides are cleared. Sets `formatRole` from the style's role when the item has none. Fails, naming the aspects the style has and the `shred styles clone` command, when it has no version for the project's aspect. |
| `upsertTextStyle` | `style` \| `fromItemId`, `name`, `role`, `id?`, `description?`, `caption?` | Adds or updates a project style (matched by `id`, else `name`; the version goes up) and restyles every item using it, skipping each item's overrides, in one undo step. `style` is one look (written as the project's aspect, or `aspect: "9:16"`) or a family (`variants`); either way it replaces only the versions for the aspects it carries, the others stay. `fromItemId` saves that text item's look as the style's version for the project's aspect and links the item. Returns `detail.styleId`, `detail.version`, `detail.style`, `detail.updatedItems`. |
| `addCaptions` | `clipId`, `styleId`, `trackId?`, `replace?` | Captions a video/audio clip from its built-in transcript, mapped through the clip's source window and speed, chunked by the `caption` rules of the style's version for the project's aspect, on the format's Captions track (else `trackId`, else a new captions track above the clip). Returns `detail.created` (ids) and `detail.trackId`. `replace: true` first removes captions made for that clip. Fails if the media has no transcript yet, nobody speaks in the clip's range, or the style has no version for the project's aspect. |

`GET /v1/capabilities` (on the service) lists the exact ops and limits for the running version.

## Motion graphics templates

A template is a composition saved to the workspace's library, `<workspace>/app/templates/<id>/template.json`, so a lower third, animated title, callout or stinger is built once and reused in every project. It is a family of **versions, one per aspect ratio** (`variants: { "9:16": {...}, "16:9": {...} }`; keys are 9:16, 16:9, 1:1, 4:5 or a reduced W:H, from `src/shared/projects/aspect.mjs`). Each version holds its root composition, the compositions it nests, its canvas and length, its optional hold, its published controls and a transparent thumbnail (`thumbnail-9x16.webp`, the hold frame or the middle). Controls are shared **by name** across versions (each version maps a name to its own item; the same name must be the same kind), so instance values carry over. The family lists the media all versions use (`media: [{ mediaId, fileName }]`; workspace media ids work across projects). Format 1 files (one composition, from before versions) still load as a family with one version and are rewritten as format 2 on the next save.

- `shred motion library [--category lower-third|title|callout|transition|overlay|other] [--json]`: name, category, role, version, id, then one line per aspect (canvas, length, hold, version) and each control with its default. `shred motion show <name|id>` adds the media (flags missing files), thumbnails and folder.
- Build a new one: add the layers (a shape bar plus text, with keyframes and text animation), `createComposition` them, `setCompositionControls` (name, title, bar colour...), apply, check frames, then `shred motion save <projectId> <compositionItemId|compositionId> --name "Lower third" --category lower-third [--role labels] [--hold 45 | --hold 40-80]`. The composition becomes the version for its aspect ratio. Saving a project copy of a library template (an instance's composition, tagged `templateId`) updates that template's version for the copy's aspect; otherwise saving under an existing name does; either way the template keeps its id, its other versions, and gets `version` + 1. `--hold` is kept from the previous save of that version unless given (`--hold none` clears it). The thumbnail comes from the service's frame renderer (`shred start` first).
- Hold: the frame (or inclusive range) where a longer instance freezes. An instance longer than its template plays the in-animation (before the hold), freezes on the hold (a range plays through, then freezes on its last frame) and plays the out-animation (after the hold) so it ends exactly at the instance's end. A shorter instance gives up hold frames first, so the in- and out-animations both play down to their combined length; below that the end is cut. Without a hold an instance can only be shorter (the end is cut). It is per instance at render time (`templateHold` on the instance, its own `durationInFrames`), so every instance still shares the one composition; preview, browser export, the native exporter's overlay route and the frame renderer all map it the same way. Change an instance's length with `updateItem { durationInFrames }`, `trimEnd`, or `addTemplate { durationInFrames }`. Template audio is not time-mapped: it plays from the instance's start and stops where the template's audio ends.
- Another aspect ratio: `shred motion clone <name|id> --aspect 16:9 [--from 9:16] [--size 1920x1080]` copies the closest version (or `--from`) into a new version: each top-level item keeps its place relative to its nearest frame edge or the centre (a bar near the bottom stays near the bottom, centred stays centred, keyframed positions move with it), sizes and font sizes scale by the short side, and controls, hold and media carry over. The size defaults to the source's short side at the new aspect. It is a starting point: `addTemplate` it in a project of that aspect, adjust the copy's items with the usual ops (look at frames), then `shred motion save <projectId> <instanceId>` writes that version back.
- Use one: `addTemplate` (above), once per instance, each with its own `controls`. The first instance copies the version into the project (`timeline.compositions[]`, tagged `templateId`/`templateVersion`/`templateAspect`/`templateHold`); later instances of that version reuse the copy, so editing it in the project changes every instance while each keeps its own control values. Move instances with `setTransform`.
- A newer library version doesn't change projects by itself: `addTemplate` still uses the project's copy and warns; `updateTemplate` moves all instances.
- Packs: `shred motion export <name|id> --out <dir|file.zip>` writes the template, its thumbnails and the media files it uses; `shred motion import <dir|file.zip>` adds every template in it, importing media the workspace lacks through the normal import path (ids remapped) and keeping a newer library version over an older pack.
- The editor's Templates tab lists the library (thumbnails on a checkerboard, aspect ratio chips with the project's highlighted, a "has a version for this project" filter, category filter, search), inserts the project's version at the playhead on click or by dragging onto the timeline, offers "Update from vN" when the project's copy is older, and picks up templates you save or import within a second. A template without the project's aspect shows "No 16:9 version yet" with "Make a 16:9 version", which clones the closest version for the project canvas, inserts it and opens it for editing. Right-click a compound clip (or a selection, which becomes one) for "Save as Template…": on a template instance it updates that template's version for the clip's aspect and shows its hold; the Hold field takes a frame or a range.

## Formats

A project's `format` (`{ id, variant, reviewedHash }`, set by `shred new --format` or `shred format set`) picks one of the four definitions in `<repo>/formats/registry.mjs`; `shred format <projectId>` prints its rules, targets and guide.

- **Roles.** Each item plays a role in the format: `speaker`, `images`, `plates`, `broll`, `shots`, `title`, `captions`, `labels`, `voice`, `music`, `sfx`. The scorecard resolves it in this order: the item's `formatRole`, caption markers (`textRole: "caption"`, subtitle items), the media's category (mapped per format: `graphics` is `images` in a Graphic Yap, `plates` in a Greenscreen), the track's role (`formatRole` on the track, which format tracks carry, or a track named like the layout), then the item type (text from frame 0, at least 2 s, top or middle is the title; other text is a label).
- **Set a role** when placement and category don't say it: `{ "op": "updateItem", "id": "<id>", "updates": { "formatRole": "title" } }`. A PNG title lockup on the Title track is already `title`; text on a picture track is never a picture.
- **Sync sound.** Linked audio from b-roll counts as sync sound, not speech (category `b-roll`); a 10 Shot fails on it, so remove the audio alone with `{ "op": "removeItems", "ids": ["<audio id>"], "linked": false }` (the video stays, silent). Without `linked: false` the video goes too. `shred build` does this for every clip when the format has no sync sound.
- **`shred check <id> [--json]`** scores the saved timeline: rules (title hook from frame 0 and its hold, captions, speech, voiceover, music, SFX, sync sound, transitions) and numeric targets (length, change rates, first image or cut, longest stretch, shot lengths, speech rate, pauses). Each check is `pass`, `warn`, `fail`, `info` (measured, no band) or `n/a` (can't measure), with frame ranges to look at. Pauses and speech rate come from the built-in transcripts mapped through each clip's source window; without one they are `n/a`. Numeric targets are guidelines and only ever warn; the rules that define the format (and kit musts) can fail. Exit code 1 means one did.

## Plans and markers

The first edit of a project is built from its plan (`agent/plan.json`, `references/brief-and-plan.md`): `shred plan <id>` validates it and records its hash, `shred draft` refuses a first pass until it validated clean, and `shred build <draftId>` applies it as one batch: per beat `addClip` at `edit[0]` for the beat's length on the format track for its role (an `addTrack` with `name`/`formatRole` first when the project lacks it), `updateItem` for the source window (`in` converted to source frames), `removeItems { linked: false }` on the camera audio when the format's `syncSound` is `none`, `addText` for planned text (`styleId` `kit:title` / `kit:overlay`, else a project style of that role), and `addMarker { id: "plan-<beat id>", label: "<role>: <takeaway>" }`. It refuses a draft with items unless `--replace` (which removes them in the same batch), and always replaces the old `plan-*` markers. `--markers-only` sends only the marker ops, on any project (the user's, for plan review: refused while the editor has unsaved edits or a pass is working). A performance plan (Graphic Yap, Greenscreen) builds the same ops from its kept lines: one `addClip` + `updateItem` source window per speaker clip, back to back on Speaker (the linked audio follows the window, so it stays in sync), the visuals' `addClip`s on their tracks (a `setTransform` for `fit`, their own audio removed), `addText`, `addMarker { id: "plan-<line id>", label: "<role>: <first words>" }` per kept line and a red `plan-src-<visual id>` marker per visual still to source. Markers are ordinary timeline markers: the editor shows them on the ruler, `shred changes` reports the user moving or relabelling them, and they ride along in drafts and passes.

## Edit templates

An edit template is the timed structure of a reference video as slots, kept in the workspace library `<workspace>/app/edit-templates/<name>.json` (`kind: "shreditor-edit-template"`, `version: 1`; design note: `docs/edit-templates.md` in the repo). It holds the `source` (a VideoDatabase video id, url and creator, or a Shreditor project id), the `format` it suggests (`id`, `variant`, `reason`), `canvas`, `durationSec`, `pacing` (shot count, cuts per minute, median, first and longest shot, words per minute, text and label counts, the title's start and hold, the shot mix by role, and the source's own `reported` metrics), the ordered `slots`, `captions` (`on`, `off` or a `span`) and the `outline` (beats, hook title, verbal hook and hook template) when the source has one.

- Slots: `shot` (`role` speaker, images, screen, broll or shots, from VDB `shot_type` and `speech`; `targetSec`, `boundary`, `framing`, `camera`, `speech`, `description`, the media `category` that fills it), `text` (`role` title or labels; `textKind` such as title_hook or list_item; `style` `kit:title`, `kit:listicle-headline`, `kit:emphasis` or `kit:overlay`; `pattern`, the hook template or e.g. `1. [POINT]`; `reference`, the original text; `anchor` `{ slot, offsetSec }`, the shot it starts in), `graphic` (`graphicKind`, `position`, `description`, `anchor`) and, from a project, `audio`. Times are seconds on the reference; lengths are targets.
- A project-derived template's slots also carry `project` (item id, track, media placeholder, source in-point, transform, volume, a video's own audio or none; a text's style id, look, transform and motion), and the template carries `project.tracks` and `project.textStyles`.
- `shred template from-vdb <dna.json|dna.md>` reads `get_video_dna` JSON (the MCP response or its `data`) or the Video DNA Markdown download (its Edit Timeline tables, mm:ss.mmm times; shot types inferred from "Photo:", "Screen recording:", framing and speech). Missing optional fields are fine; no edit timeline is an error.
- `shred plan <id> --template <name>` writes the plan from a template (references/brief-and-plan.md) and records it on the project as `agent/template.json` (name, file, hash, a copy of the template; `slots` with item ids and fill state after `new --from-template`). `shred check` then adds a **Template** section: length, cuts per minute, median shot and first cut against bands around the reference, shot mix (speaker, pictures, footage within 15 points), label count, title from frame 0 and its hold, captions. Information, not rules: close, differs, info or n/a, never a warning or a fail, with frame ranges for what differs; `--json` carries it as `template`.
- `shred new --from-template <name> --name "..."` creates the project in the template's format and canvas. From a project template it also rebuilds, in one batch of ordinary ops, the tracks the new project lacks (`addTrack`), the text styles (`upsertTextStyle`) and every slot (`addClip` of the original media + `updateItem` for window, label `<slot> · <file>`, transform, volume; the companion audio removed when the original had none; `addText` with the style). Captions are not copied. `shred template fill <id> --slot s03=<mediaId>[@inSec]` sends `replaceMedia` per slot.

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

## Scratch voiceover (TTS)

`shred tts --project <id> (--text "..." | --file script.txt) [--engine supertonic|moss] [--voice v] [--speed x] [--language code] [--name label] [--json]` speaks a script with the editor's own local engines, run in the agent service's Chrome (`POST /v1/tts`, one request at a time through the service queue), and imports the WAV like any file (category `voiceover`, transcribed in the background). It prints the `mediaId`, duration, engine/voice and the backend that ran (`webgpu` or `wasm`). The file is kept in `projects/<id>/agent/tts/`, named `scratch-vo-...`; its metadata carries `generated: { kind: 'tts', scratch: true, engine, voice, text, ... }` and the tag `scratch-tts`.

- `shred tts voices [--engine e] [--json]` lists the engines and preset voices (no cloning). **Supertonic 3** (default, voice `M3`): 31 languages (`--language`, default `auto`), speed 0.8-1.3, expressive tags `<laugh>` `<breath>` `<sigh>` inline in the text, WebGPU with a wasm fallback. **MOSS Nano** (voice `Ava`): language from the text, speed 0.5-2 (a resample, pitch moves), wasm only, slower.
- Long scripts are split by sentence (a blank line ends a paragraph, a line break ends a sentence) into requests of at most 600 characters, then joined with 0.3 s pauses (0.6 s between paragraphs).
- The first run downloads the model (~400 MB Supertonic, ~785 MB MOSS) into `~/.shreditor/models` (`SHREDITOR_MODEL_CACHE` overrides); later runs and restarts read it from disk. That first request holds the service queue while it downloads.
- Plans carry no voiceover text, so there is no per-beat mode: run `shred tts --text "<line>" --name <beat id>` per line when you want one clip per beat.
- It is a placeholder: for timing a Vlog cut before the VO is recorded. Never present it as the final voiceover.

## Text styles and captions

A text style is a named, reusable look: titles, labels, lower thirds, captions. Use styles instead of styling each item by hand; the user edits a style in the editor (the Saved styles section of a text item) and every item using it follows.

- **Where they live.** The library is `<workspace>/app/text-styles.json` (all projects, the user and you). A project keeps its own copies in `timeline.textStyles`; items point at one with `textStyleId`. Using a library style copies it in, so a project never changes when the library does. `shred styles use <projectId> <name>` again takes the library's newer look into the project (and restyles its items).
- **Built-ins.** A new library starts with the editor's 13 title presets (Clean, Poster, Outline, Lower Third, Speaker, Cinematic, Quote, Neon, Headline, Breaking, Event, Launch, Badge) and 5 caption presets (Netflix, YouTube, Bold Yellow, Outlined, TikTok) as ordinary styles with 9:16 and 16:9 versions; edit, rename or remove them like any other. They are added once (the file records `"seeded"`), so a removed one stays removed.
- **One version per aspect ratio.** A style is a family: one id, name and role, and a `variants` list with one look per aspect (`9:16`, `16:9`, `1:1`, `4:5`, others as the reduced `W:H`). A vertical title can be bigger and sit elsewhere than its landscape twin, and items stay linked to the one style. An item uses the version for its project's aspect; another resolution of the same aspect scales it uniformly (720x1280 is 2/3 of 1080x1920). Changing one version restyles only the items in projects (and compositions) of that aspect.
- **No version for this aspect.** `applyTextStyle`, `addText` with `styleId` and `addCaptions` fail with the aspects the style has and the command to fix it. `shred styles clone <name|id> --aspect 16:9 [--from 9:16]` adds a version cloned from the closest one (or `--from`) as a starting point: sizes stay the same pixels (both reference canvases have a 1080 short side), a box keeps its pixel size (fitted to the canvas) and its anchor (a box near the bottom keeps the same share of the canvas below it, a centred one stays centred), motion and caption rules are copied. Without `--project` it goes into the library; with `--project <id>` into that project's copy (taken from the library when the project has none yet, restyling its items on that aspect) and, when the library has the style without one, the library too. Then adjust it: `upsertTextStyle` with one look writes the project's aspect, or the editor's "Update style from this item" writes the item's aspect. In the editor the picker shows such a style with "No 16:9 version" and a "Make a 16:9 version" button that does the same and applies it.
- **Live link.** Changing a project style (`upsertTextStyle`, or the editor's Saved styles picker) rewrites the styled fields of every item using it, in one undo step. A field changed on one item directly is listed in its `textStyleOverrides` and kept; the editor's Reset to style clears them. Text content is never part of a style.
- **What a style holds** (`shred styles show <name>` prints one):
  - `id`, `name`, `role` (`title`, `caption`, `label`, `lower-third`, `other`), `description?`, `defaultDurationFrames?` (length of a new `addText`), `version`, `updatedAt`, and `variants`, each with:
  - `aspect`, and `style`: every text look field (`fontFamily`, `fontWeight`, `fontStyle`, `underline`, `fontSize`, `color`, `letterSpacing`, `lineHeight`, `textAlign`, `verticalAlign`, `backgroundColor`, `backgroundMode`, `backgroundRadius`, `textPadding`, `textPaddingX`, `textPaddingY`, `textShadow`, `stroke` incl. `join`). A field left out is cleared on the items (no background, no stroke).
  - Lengths (`fontSize`, `letterSpacing`, `textPadding`, `textPaddingX`, `textPaddingY`, `backgroundRadius`, shadow offsets and blur, stroke width) are **pixels on the version's reference canvas**, whose short side is 1080: 1080x1920 for 9:16, 1920x1080 for 16:9, 1080x1080, 1080x1350 for 4:5.
  - `layout?`: `xRatio`, `yRatio` (box centre from the canvas centre, +y below), `widthRatio`, `heightRatio`, as fractions of the canvas width/height. Only the axes given are styled.
  - `textMotion?` (`{in, out, loop}`, as on items), `spanStyles?` (per-line looks of a multi-span item, by index; the last repeats).
  - `caption?`: `maxWordsPerChunk`, `minWordsPerChunk?` (default 2), `maxCharsPerLine`, `maxLines`, `minChunkFrames`, `case?` (`as-is`/`upper`/`lower`), `punctuation?` (`keep`/`strip`), `breakOn?` (`phrase`, the default, or `words`). Break points are chosen for the whole clip at once, not greedily. `phrase` breaks where an editor would: at sentence and clause ends, at pauses (the longer, the stronger), before "and", "but", "because", "which" and before a preposition once the chunk has 2 words; never after "a", "the", "my", "to", "of", between "is"/"can"/"don't" and the verb, inside "$5 million", "10 percent", a name ("Tiger Woods") or "a lot of"; a lone word only when it is set off by pauses ("Done.") or punctuation. Word counts outside the range, text over `maxCharsPerLine` x `maxLines`, under `minChunkFrames` on screen or speech over 2.2 s per line cost more; chunk sizes lean even. The word rules are English (the transcript's language, else detected); other languages break on punctuation, pauses and the limits. `words` fills chunks to `maxWordsPerChunk`, breaking at pauses and punctuation. With `maxLines` over 1, lines break with `\n` at the best phrase boundary with balanced lengths (`words`: greedily at `maxCharsPerLine`). A chunk runs from its first word to its last; one shorter than `minChunkFrames` is held longer, never into the next caption or past the clip. The editor's own transcript captions use the same chunker (2 to 8 words, 42 characters, one line).
- **Older styles.** A style saved before versions (look fields at the top, no `variants`) still loads, as a one-version family: in a project as the project's aspect, in the library or a pack as 9:16. It is written back in the new shape. You may still write one look in an op or a pack; add `"aspect": "16:9"` to say which version it is.
- **Captions.** `addCaptions` makes one text item per chunk with `textRole: "caption"`, `formatRole: "captions"`, `textStyleId` and `captionSource {type: "transcript", clipId, mediaId}`. Only words whose middle falls inside the clip's source window are used, so a trimmed clip is captioned from its own range, and a sped-up clip's captions run at its speed.
- **Style packs.** A brand kit ships its styles as one file, `{ "kind": "shreditor-text-styles", "version": 1, "name"?, "styles": [...] }` with every version of each style: `shred styles import kit.json` merges it into the library (a style with the same id or name keeps its id, so linked projects stay linked; the pack's versions replace those for the same aspects, the library's other versions stay); `shred styles export [names] [--project id] --out kit.json` writes one.

```sh
shred styles list [--project <id>]          # library, or a project's copies (items using each, library state)
shred styles use <projectId> "Kit Title" "Kit Captions"
shred styles save <projectId> <itemId> --name "Hook" --role title   # an item's look, into project and library
shred styles clone "Kit Title" --aspect 16:9 --project <projectId>   # a 16:9 version from the 9:16 one
```

```json
[
  { "op": "addText", "text": "Three things nobody tells you", "from": 0, "trackId": "<title track>", "styleId": "Kit Title", "callerId": "hook" },
  { "op": "addCaptions", "clipId": "<speaker clip>", "styleId": "Kit Captions", "callerId": "caps" }
]
```

## Video Style Kit

A Video Style Kit (`kit.json`, schema v2, made outside Shreditor) holds a creator's look and editing rules: text styles for titles, captions and overlays, image and object placement, greenscreen rules, checkable `must` rules, and editing preferences. Shreditor maps it once onto a project and keeps it linked. Mapping table and limits: `docs/video-style-kit.md` in the repo.

- `shred kit apply <kit.json|kit folder> --project <id> [--force]` maps the text sections to project text styles (and library copies, described as coming from the kit): `kit:title` (role title), `kit:caption` (role caption, the default position, aboveHead), `kit:caption-low` (the belowChin position: use it when the face fills the middle), `kit:overlay` and `kit:listicle-headline` (role label) and `kit:emphasis` (a one- or two-word label in the title look). It records `project.kit` (`path`, `kitVersion`, `hash`, `appliedAt`, `brandColors` when on; drafts copy it), keeps a copy of the applied kit in `projects/<id>/agent/kit-applied.json`, and prints what mapped, what didn't and why, the fonts (the first family in each stack that is installed or in Shreditor's catalog, with licences), the kit's preferences in words, and its reference frames (never compare against ones marked placeholder).
- Applying the same kit again changes nothing. A changed kit updates the styles whose mapping changed and every item using them (live link) and prints the kit diff. A style changed in the project is kept unless the kit changed that style too (`--force` takes the kit's for all).
- `shred kit status <id>`: path, version, hash, drift (the file changed since apply, with the changed values), fonts, each kit style matching the file or not, preferences. `shred kit show <kit.json>` prints a kit in words.
- **Preferences override format defaults.** Follow them in the plan: punch-ins, tight cuts, alternate sides, sound effects, music bed (bed clip volume = `levelDb` with the voice at 0 dB; on voice clips `audioDucking { duckOthersDb: duckDb, targetTrackIds: [music track] }`), brand colours (offered as swatches in the text colour pickers). In `shred check`, `tightCuts.maxPauseMs` (or `offMaxPauseMs` when off) replaces the format's pause target.
- **`shred check` adds a Kit section**: every `must` rule by id with `pass`, `fail`, `warn`, `look` (look at the listed frames), `listen` or `n/a` (with why), and frame ranges. Geometry is measured on the rendered layout (`/layout`): `onScreenFrom`, `inZone`, `maxLines`, `count`, `bottomAbove`, `clearOf` (safe zones, `title`, `images`, `plateKeyContent`; timed regions count only frames where both are on screen; `speaker`/`face` are a look), `nearY`, `onePlacementPerVideo`, `fillsCanvas`, `hardCutsOnly`, `transparentPng` (PNG, then a look). Judgment rules are never a pass. Which items: a `kit:*` style says it; otherwise the format role (title, captions, labels = overlays; images; plates; media category `overlay` = objects). A fail exits 1 like a format fail; `shred publish` saves the results in the pass record as `kit`.
- **Save-back, only when the user asks**: `shred kit save-back <id> [--style kit:title,...] [--force]` writes the project's kit styles back into kit.json in kit units (pixels at the kit canvas, weights as numbers, the section's anchor kept), bumps `kitVersion` (patch), adds a changelog entry (`why: "from Shreditor"`), writes atomically, and refuses when kit.json changed since apply (`--force` writes over). A font family not in the kit's stack is reported, not written. Only the kit canvas's aspect is saved.
- The editor has no "Update kit" button: save-back is CLI only.

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

Text background box: `backgroundColor` (with `backgroundRadius`, `textPadding`) is one box around the text lines by default. `backgroundMode: "lines"` gives each line its own box instead (a bar behind each line, hugging that line: its width plus the horizontal padding, the font's height plus the vertical padding), as kit titles use. Padding can differ left/right and top/bottom: `textPaddingX` and `textPaddingY` (each falls back to `textPadding`; not keyframable; the text panel's link button splits or joins them). Set `backgroundMode: "box"` to fill the item's whole transform box (`width` x `height`) instead, with the text laid out inside it by `textAlign`, `verticalAlign` and `textPadding`. That builds a fixed-size chat pill or panel natively: e.g. `transform { width: 800, height: 140 }`, `backgroundColor "#ffffff"`, `backgroundRadius 70`, `textPadding 36`, `textAlign "left"`. The radius is clamped to half the shorter side.

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

## Cuts

Several versions of one edit side by side (Main, Hook B, 16:9). Each cut is its own project, so its canvas, revision, drafts, passes, notes, `shred changes`, `shred check` and export are its own; `project.cut = { group, label, order }` links it to its siblings, and the group id is the main cut's project id (a project with no `cut` is its own group's Main). Design: `docs/cuts.md` in the repo.

- `shred cut new <projectId> --label "Hook B" [--size 1920x1080] [--from <cutId>]` copies the saved state of `--from` (default: the project) into a new cut, last in the group: same media by id (nothing is copied or imported), format, kit, brief, plan (still validated) and timeline; the source is never written. It writes the cut's first pass record (`New cut "Hook B" from Main`, with the scorecard), so `shred changes` works from the start and the first `shred draft` needs no plan. It prints the id and editor URL.
- `--size` re-fits the copy: video and images that covered the old canvas cover the new one (punch-in and offset kept, clamped so no edge shows); styled text gets `applyTextStyle` for the new aspect, then its own non-position overrides back; everything else keeps its nearest frame edge or the centre and scales by the short side (keyframes too). It warns when a text style has no version for the new aspect (fix: `shred styles clone "<name>" --aspect 16:9 --project <cutId>`) and lists items to look at: hard crops, keyframed, re-anchored, template instances (still the old aspect inside: `shred motion clone --aspect`, then `updateTemplate`) and compound clips. Look at frames before the first pass on the cut.
- `shred cut list <projectId> [--json]`: every cut in the group in order, with label, size, aspect, format and the last pass with its scorecard summary.
- `shred cut rename <cutId> "..."`: the cut's label (and its project name, `<group> · <label>`); refused while the editor has unsaved edits on it. Labels are unique in a group.
- `shred cut remove <cutId> --yes`: moves the cut to the editor's Trash (`POST /v1/projects/:id/trash`; restorable from the project list), never media. Without `--yes` it only says what it would do. Main can't be removed while it has other cuts; a cut the editor has open can't be removed.
- Drafts are not cuts (`shred draft` doesn't copy `cut`), and `shred publish <draft> <cutId>` lands only in that cut; it prints which cut it was. `shred project` and `shred status` name the cut groups.
- The editor's cut switcher (beside the format chip, Concise and Full) switches cuts in the same tab, makes them (label and aspect: same, 9:16, 16:9, 1:1, 4:5) and manages them (rename, reorder, remove with confirmation). It doesn't follow your publishes: it marks a cut with a new pass, and the user switches.
- A 16:9 cut of a 9:16 format scores against the format's 9:16 targets, and kit geometry checks against the kit's canvas.

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
