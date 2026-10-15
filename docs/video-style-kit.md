# Video Style Kit (kit.json)

A Video Style Kit is a creator's look and editing rules in one JSON file, `kit.json`, made and edited outside Shreditor. Shreditor applies it to a project, keeps the project linked to it, checks edits against its rules, and can write style tweaks back into it when the user asks.

The code is in `formats/kit/` (plain ESM shared by the agent tools and the editor), the commands in `skills/shreditor-edit/scripts/kit.mjs` (`shred kit ...`), and the stock kits used as fixtures in `formats/kit-fixtures/` (`stock-kit.v3.json` is current, `stock-kit.v2.json` the one before).

## Schema notes (v2, as Shreditor reads it)

- **Units.** Pixels at `canvas` (`[1080, 1920]`). Scales are fractions, times seconds (milliseconds when the key ends in `Ms`), levels dB relative to the voice, colours `#RRGGBB`, font weights 400/500/600/700.
- **Anchors.** `top`: `y` is the top edge of the element's box, its padding and outline included; text grows down. `center`: `y` is the box's middle. `bottom`: `y` is its bottom edge; text grows up. `free`: chosen per shot. Horizontally `x` and `width` are the text box (padding included).
- **Required** (the loader names each one missing): `schemaVersion`, `kitVersion` (semver), `canvas`, `fonts` (each with a `stack`), and `titles`, `captions`, `overlays`, each with `style` (`font` naming a font, `weight`, `size`, `color`) and `placement` (`anchor`, `x`, `width`). `must` rules need an `id` and a `check.type`. Unknown fields are kept and ignored; a newer `schemaVersion` loads with a warning.
- **Sections.** `titles`, `captions`, `overlays` (text), `images`, `greenscreen`, `objects`, each with `must`, `startingPoint`, `notes`, `motion`, `variants` (`{}` or `{"16:9": {...overrides}}`). `safeZones` are named rectangles (`topUi`, `rightRail`, `bottomUi`). `referenceFrames` values are a path or `{ path, placeholder }` (lists allowed); placeholder frames are never compared against. `preferences`: `punchIns`, `tightCuts`, `alternateSides`, `sfx`, `musicBed`, `brandColors`. `changelog`: `{ date, version, change, why }`.
- **Hash.** sha256 of the kit's canonical JSON (keys sorted), so reformatting the file is not a change and any value change is.

## Mapping: kit -> Shreditor

| Kit | Shreditor |
|---|---|
| `titles` | style `kit:title` (role title, 3 s default length) and `kit:emphasis` (role label: the title look, one line, centred) |
| `captions` + `placement.positions[default]` | style `kit:caption` (role caption) |
| `captions.placement.positions.belowChin` (other positions) | `kit:caption-low` (`kit:caption-<name>`) |
| `overlays` | `kit:overlay` (role label) |
| `overlays.listicle` | `kit:listicle-headline` (role label, its size, weight, x, width, align) |
| `fonts.<name>.stack` | `fontFamily`: the first family installed on this machine (fc-list, else system_profiler) or in Shreditor's font catalog; else the kit's `resolved` |
| `weight` 400/500/600/700 | `fontWeight` normal/medium/semibold/bold |
| `size`, `lineHeight`, `letterSpacing`, `color` | `fontSize`, `lineHeight`, `letterSpacing`, `color` (pixels at the 1080 short side, as style variants are) |
| `box.color`, `box.radius` | `backgroundColor`, `backgroundRadius` |
| `box.perLine: true` | `backgroundMode: "lines"` (a box behind each line); otherwise `"text"` (one box) |
| `box.padX`, `box.padY` (+ outline width) | `textPaddingX`, `textPaddingY` (`textPadding` when equal) |
| `outline` | `stroke { width, color, join: "round" }` |
| `placement.align` | `textAlign` |
| `placement.anchor` | `verticalAlign`: top / middle / bottom (free: middle) |
| `x`, `width`, `y` + anchor | layout ratios: box centre from the canvas centre, box size. The box is as tall as the section's most lines (title `maxLines`, caption `chunking.lines`, overlay `oneShot`/`tenShot` lines) plus padding and outline; a top or bottom anchor with a `zone` reaches to the zone's far edge, so extra lines grow away from the anchor |
| `variants["16:9"]` | the style's 16:9 look, pixels at 1920x1080; without it, the 9:16 look cloned the way the editor's "Make a 16:9 version" does |
| `chunking.wordsPerChunk` (`[min, max]` or a max), `lines`, `breakOn` | caption rules `minWordsPerChunk`, `maxWordsPerChunk`, `maxLines`; `breakOn` `phrase` -> `phrase` (break where an editor would: sentence and clause ends, pauses, before "and" or "to"; never after "a", "the", "to", inside "$5 million" or a name), `pause` or `words` -> `words` (fill to the word limit, break at pauses and punctuation), anything else -> `phrase` with a note; `maxCharsPerLine` = text width / (size x 0.55); `minChunkFrames` 9 |
| `motion` cut in / cut out | no text motion |
| `preferences.tightCuts` | the scorecard's pause target (`maxPauseMs`, or `offMaxPauseMs` when off) |
| `preferences.brandColors` (on) | `project.kit.brandColors`: swatches in the text and background colour pickers |
| `preferences.*` | printed in words by `apply`, `status` and `check` for the agent's plan (music: clip volume `levelDb`, ducking `duckDb` on the voice clips) |
| `must` | the Kit section of `shred check` |

The project records `project.kit = { path, creator, kitVersion, hash, appliedAt, brandColors? }` (validated by the project schema, kept by editor saves, drafts and bundles), and keeps a copy of the kit it applied in `projects/<id>/agent/kit-applied.json` for diffs.

Re-applying is a three-way merge per style: the kit's look now, the look last applied, and the project's copy. Same kit: nothing changes. The kit changed a style: the project's copy and every item using it update. Only the project changed a style: it is kept (save-back can put it in the kit; `--force` takes the kit's).

**Not mapped, and why:** `sizeSmall` is a choice per title (it is in `kit:title`'s description and the max-lines check hint); `tiltDeg` is item rotation, not a style; highlighted caption words; `nudgeToClearSubject` and the speaker's side are per-shot decisions; images, greenscreen and objects are placed per shot (the checks measure them); objects are generated outside Shreditor; reference frames are for looking at.

## Check coverage

Each `must` rule is a row of the Kit section, by its id, with frame ranges for anything not passing.

| Check type | How | Result |
|---|---|---|
| `onScreenFrom` | the element's items cover `frame` .. `frame + minSeconds` (or to the video's end) | pass / fail |
| `inZone` | rendered box (per-line backgrounds, else the lines plus the outline; pictures: the drawn box) inside `y` | pass / fail |
| `maxLines` | rendered line count | pass / fail |
| `count` | items (a title split by a cut counts once) | pass / fail |
| `bottomAbove` | rendered box bottom | pass / fail |
| `clearOf` | overlap with safe zones, `plateKeyContent` (while a plate is up), `title` and `images` (only in frames where both are on screen) | pass / fail; `speaker`, `face` or a speaker subject: look |
| `nearY` | distance of box centres from `y` | look (with the distance) when the rule is a judgment, else pass / warn |
| `onePlacementPerVideo` | each image matched to the nearest `images.options` rect | pass / fail |
| `fillsCanvas` | plates drawn over the whole canvas, unrotated | pass / fail |
| `hardCutsOnly` | transitions touching plates | pass / fail |
| `transparentPng` | object media is PNG | fail, else look (alpha, no text) |
| `notOverFace` | judgment; images whose placement is in `except` are n/a | look |
| `matchesTranscript` | judgment (says how many captions came from the transcript) | listen |
| `readsWithoutSound`, `realSubjectIsPhoto`, `cleanCutout` | judgment | look |
| `lockedPrompt` | prompts aren't recorded on media | n/a |
| unknown types | | n/a, naming the type |

On the stock kit (v3, 26 rules) that is 15 measured rules (two of them, `object.transparent` and `object.clear`, end in a look for the part geometry can't see: alpha, the speaker), 9 judgment rules (look/listen), `greenscreen.plate-clear` as a look while plates are up, and 1 not checkable here (`object.locked-prompt`). Rules about elements that aren't on the timeline are n/a. A fail exits `shred check` with 1, like a format fail; `shred publish` stores the Kit results in the pass record (`kit`).

Positions are the kit's canvas: on a project of another aspect the position and region rules are n/a.

## Save-back

`shred kit save-back <id> [--style kit:title,...] [--force]`, only when the user asks. It writes the project's kit styles (the kit canvas's aspect) into the kit's own values: size, weight as a number, line height, letter spacing, colour, box (colour, radius, padX/padY without the outline, perLine), outline, align, x, width and the anchor's y (`kit:caption` writes the default position's y, `kit:caption-low` only its own y, `kit:listicle-headline` the listicle block). Then it bumps `kitVersion` (patch), sets `updatedAt`, appends `{ date, version, change, why: "from Shreditor" }`, writes atomically, and brings the project's styles in line with the saved kit. It refuses when the file changed since apply, unless `--force`. Styles that match the kit write nothing.

## Set

`shred kit set <id> <path> <value> [<path> <value>...] [--why "..."] [--force]`, only when the user asks, for kit values the editor has no control for (fonts, preferences, rules) or a quick change: `titles.style.size 104`, `fonts.classic.stack.0 "TikTok Sans"`, `preferences.punchIns.on false`. `path=value` works too, and is the form for a value starting with a dash (`titles.style.letterSpacing=-2`; the plain form also works there). A value is JSON when it parses, text otherwise; a string field always takes the text as is. The path must exist and the value keep its type (`null` may become a value and back), and the result must pass the kit schema. `schemaVersion`, `kitVersion`, `updatedAt` and `changelog` are the kit's own. Then it logs the change like save-back (patch bump, `updatedAt`, a changelog entry with `--why`, default "shred kit set"), writes atomically and brings the project's `kit:*` styles in line with the new kit. It refuses when the file changed since apply. `--force` allows a new key, a type change or a drifted file.

## Detach

`shred kit detach <id>`, only when the user asks: the project stops following its kit. The kit record and the applied copy (`agent/kit-applied.json`) go; the project's `kit:*` styles stay, so text using them keeps its look, and `shred check` stops checking the kit's rules.

## Limits

- The kit is applied per project; the library copies are a convenience, the project copies are what renders.
- Font licences are reported, never enforced; an installed font renders only on machines that have it.
- The 16:9 look is a clone unless the kit has a `16:9` variant; save-back writes the kit canvas's aspect only.
- Per-line backgrounds hug each line's text: in the editor preview, runs of spaces in such text collapse (the bar of a wrapped line would otherwise include the space at the wrap).
- There is no editor UI for applying, checking or saving back a kit; the agent does it with `shred`.
