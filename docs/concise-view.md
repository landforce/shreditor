# Concise view

A second editor layout for the job Shreditor users actually do: review a 9:16 cut the agent made, then adjust it. The existing layout becomes **Full**; this one is **Concise**. One toggle switches between them. Nothing is removed from the product. Every panel that leaves the Concise screen is reachable in one click from it.

Mockup: https://claude.ai/artifact/XiFNunQLf6VdF2X7AncEBr (five artboards: nothing selected, shot selected and text selected at 1600 x 1000, plus shot selected and nothing selected at half a MacBook screen, 740 x 880). Renders of the three states and of the current Full layout are in `docs/concise-view/`.

## 1. Evaluation of the current editor

Measured at 1600x1000 on the Warehouse 10 Shot project (14 s, 12 shots, 1 title, 1 music clip).

**What the user does here.** The agent builds the pass. The human then watches it, and does a handful of things: trim a shot to a beat, swap a shot, split one, delete one, fix the words or timing of a caption, change the music level, nudge a cut. Then save, and the agent continues from that. Starting from an empty timeline is the agent's job, not the user's.

**The layout is built for the other job.** FreeCut's shell is a from-scratch NLE: media bin on the left, program monitor in the middle, inspector on the right, timeline across the bottom. Every decision below follows from one observation: the footage is 9:16 and the screen is 16:9, so a bottom timeline plus two sidebars leaves the video a thin pillar.

| Surface | Today | Problem for iteration |
|---|---|---|
| Preview | 155 x 275 px inside a 490 px band | The thing being reviewed is the smallest element on screen. Around 4% of the pixels. |
| Media sidebar | 320 px, full height, 9 tabs (Media, Text, Shapes, Effects, Transitions, Lottie, Templates, Transcript, AI) | Eight of the nine tabs are authoring tools. Iteration needs the bin for one verb, Replace. |
| Properties | 288 px; Transform, Playback, Cropping, Composite, Corner Pin, each with keyframe diamonds | Numeric layout fields the agent already set. The fields a reviewer touches (speed, volume, fade, text content) are scattered across four tabs. |
| Format and scorecard | Shown only with nothing selected, in the Properties column | This is the most useful agent-companion surface and it is hidden the moment you click a clip. |
| Timeline toolbar | 25 controls: 4 tools plus slip/slide, undo/redo, in/out x3, markers x3, voiceover plus mic, snap, skim, keyframes, linked selection, zoom x4 | Iteration uses select, trim by drag, split, delete, undo, zoom. |
| Track headers | 288 px dopesheet column, 5 buttons per track | Four named format tracks need a label, not a mixer. |
| Audio meters | 84 px permanent column | Useful once per session. |
| Top toolbar | Project specs, workspace tabs, debug, docs, what's new, settings, shortcuts, language, save, render queue, export | Twelve targets for about four decisions. |
| Agent state | A transient banner while a pass runs; conflict banner on save | No persistent answer to "what did the last pass change" or "what have I changed since". |

Two notes outside the layout question. The running app is light-themed while DESIGN.md describes a dark graphite system, so one of them is stale. And the timeline's track list in this project includes a "Labels" track with no clips, which the agent's format defines; empty format tracks should collapse in Concise.

## 2. Principles for Concise

0. **Half a MacBook screen is the primary size.** The editor sits beside Claude Code. Design for about 740 x 880 first, and let a wide window be the bonus.
1. **The video gets the height.** On a 16:9 screen a 9:16 preview should run the full height of the window, on the left. Everything else lives in the right column.
2. **Context replaces inspector.** Like mobile CapCut, the panel shows verbs for what is selected, not every property, with the media bin always underneath. Nothing selected shows the pass: what you changed and a note for the agent.
3. **One click to anything.** Panels are tucked, not deleted. Each has a "More" or an overflow entry that opens the Full component in a drawer.
4. **Keyboard parity.** Every Full shortcut works in Concise, including tool shortcuts whose buttons are hidden.
5. **Format tracks are the timeline.** Lanes are the format's named tracks with 72 px labels. Shots is a tall filmstrip lane. Text lanes show the words. Empty format tracks collapse.

## 3. Layout

Top bar 44 px. Panel gap 4 px, matching the current `--panel-gap`.

```
┌───────────────────────────────────────────────────────────────────┐
│ ← Warehouse 10 Shot   10 Shot · Shaped  1 warn   Pass 4 · 2 edits   Concise|Full  ⚙  Save  Export │
├──────────┬────────────────────────────────────────────────────────┤
│          │ CONTEXT CARD  (pass / shot / text / music)             │
│ PREVIEW  ├────────────────────────────────────────────────────────┤
│ 9:16     │ MEDIA BIN                                              │
│          │ [▯][▯][▯][▯][▯][▯][▯][▯]  b-roll tiles, 9:16           │
│          │ [♪ big x audio] [♪ mastered]                           │
│transport │                                                        │
├──────────┴────────────────────────────────────────────────────────┤
│ TIMELINE  ▸ ✂ ⌫ ↶ ↷ · snap · zoom · Tracks · ⋯                    │
│ TITLE  [POV: It's finally time to…]                               │
│ SHOTS  [▓▓][▓▓▓][▓][▓▓▓▓][▓▓][▓▓▓]   short filmstrips             │
│ MUSIC  [~~~~~~~~~~~~~~~~~~~~~~~~~~~~]                             │
└───────────────────────────────────────────────────────────────────┘
```

At 1600 x 1000 the preview is 354 x 630, about 2.9 times today's area and still the largest thing on screen. The context panel sits beside it and takes the rest of the width. The timeline runs the full width underneath, 1592 px, which is 110 px per second on a 14 s short, and keeps its lanes short: shots 92 px, title 24 px, music 40 px. The horizontal split is draggable and persisted per workspace, as the current workspace layouts already are.

### Half a MacBook screen

Below about 1100 px wide the same panels reflow. Nothing that the wide layout shows is hidden.

```
┌──────────────────────────────────┐
│ ← Warehouse  10 Shot 1 warn  Concise|Full ⚙ Save 2 Export │ 44
├────────┬─────────────────────────┤
│PREVIEW │ CONTEXT CARD            │
│ 9:16   │ pass / shot / text      │ 396
│        │ two columns, scrolls    │
│ ‹ ▶ ›  │                         │
├────────┴─────────────────────────┤
│ TIMELINE  full width, short lanes│ rest
├──────────────────────────────────┤
│ MEDIA  [▯][▯][▯][▯][▯][▯] [♪][♪]  │ 150
└──────────────────────────────────┘
```

At 740 x 880 the preview is 198 x 352, the card beside it is 508 px wide and scrolls when a card is taller than the row, the timeline gets 48 px per second on a 14 s short with an 80 px shots lane, and the media bin becomes a 150 px horizontal strip of 9:16 tiles. The transport keeps play, one frame either way, the timecode and volume; start, end and the preview zoom move to the gear menu. The pass status folds into the Save button, "Save 2", with the detail on hover.

### Top bar

Left: back, project name, format chip with scorecard summary (click opens the Pass panel). Centre: pass status, "Pass 4 · 6 min ago · 2 edits unsaved". Right: Concise | Full segmented toggle, one gear menu (settings, shortcuts, language, docs, what's new, debug, audio meters), Save, Export with the render-queue count as a badge. Workspace tabs for Color and Motion are hidden in Concise; their shortcuts still work and switch to Full.

### Preview column

The program monitor at the largest 9:16 that fits. Transport below it: start, back a frame, play, forward a frame, end, timecode, volume with a small level pip, and the preview zoom. Canvas overlays stay: selection handles, snap guides, mask editing, and on-canvas text editing (double-click a title to retype it in place). The alignment strip and the proxy toggle move into the gear menu.

### Context panel

The panel is one scrolling column. Its header names what it is showing. Its first row is always a verb strip in the CapCut style: icon above label, horizontally scrolling if it must. Its last entry is always **More**, which opens the Full component for that item in a drawer over the panel.

**The media bin is always there.** The lower part of the context panel is the media library in every state: B-roll tiles at 9:16 with duration and a mark on the ones in the cut, then music, with search, Import, Transcript and an overflow for the other media tools. Dragging a tile onto a shot replaces it. The card above it changes with the selection.

**Nothing selected: the Pass card.** One row, three cells.
- Format: name and variant, the warn count, and links to the scorecard and the guide. The scorecard itself opens from here or from the chip in the top bar; it is not on the card.
- Your changes since the pass: a list derived from the undo history since load, "Trimmed shot 3 by 0.4 s", "Edited title". This is what the agent will read as decisions, so it should be visible before the user saves. Save button inline.
- Note for the next pass: one text field written to the project for the agent to read on its next pass. Not a chat. The existing AI tab chat stays reachable through the media bin's overflow.

**Shot selected: the Shot card.**
- Verbs: Split, Replace, Speed, Volume, Delete, Duplicate, More.
- Header: filmstrip of the clip, source filename, "shot 7 of 12", timeline in and out, source in and out.
- Fields: speed slider with 0.5, 1, 1.5, 2 presets; volume slider and mute; fade in and out; "Hold" (trim this shot's out point to the next beat). Beat snapping is a format concept; see section 5.
- Replace highlights the media bin below with the selected shot as the drop target. Dropping or clicking Replace keeps the shot's timing and takes the new source from its mark-in.

**Text selected: the Text card.**
- Verbs: Edit text, Style, Position, Timing, Delete, Duplicate, More.
- A multi-line text field for the content, large.
- Style: chips for the format's named text styles from the Video Style Kit, with the current one selected.
- Position: nine-point placement plus the format's layout cues (safe title zone, caption band) drawn on the preview while this card is open.
- Timing: start, end, and "Match shot" to lock it to the shot beneath.

**Music selected: the Music card.**
- Verbs: Volume, Fade, Trim, Mute, Replace, More.
- Volume slider, fade in and out, source offset nudge, waveform with the beat grid.

### Timeline

- Toolbar, 32 px: Select, Split at playhead, Delete, Undo, Redo, snap toggle, zoom to fit and a zoom slider, a **Tracks** toggle that reveals the Full 288 px track headers and all tracks, and an overflow that holds in and out, markers, voiceover, rate stretch, slip and slide, linked selection, skimming, keyframe panel and sequences. Hidden tools still answer their shortcuts.
- Ruler with the music's beat grid drawn as light ticks when the format is beat-driven.
- Lanes in format order. Shots lane is 92 px with filmstrip thumbnails and the shot number in the corner. Text lanes are 24 px pills showing the first words. Music lane 40 px with the waveform. Empty format tracks collapse to a 14 px "Labels (empty)" strip. Labels are 72 px wide with mute and lock on hover.
- Trim is ripple by default, matching CapCut and the way a reviewer thinks ("make this shot shorter"). The setting to change it is in the overflow. The beat grid on the ruler shows the drift that ripple causes downstream, and the scorecard catches it.
- Hover scrubbing on shots and the drop ghost previews stay as they are.

## 4. Where every Full control lives in Concise

| Full | Concise |
|---|---|
| Media sidebar: Media tab | Media bin, always open under the context card |
| Media sidebar: Transcript | Transcript button in the media bin header |
| Media sidebar: Text, Shapes, Effects, Transitions, Lottie, Templates, AI | Timeline toolbar **Add** menu, and the media bin's overflow |
| Properties: Video, Audio, Effects, Animation | **More** on any card opens the full PropertiesSidebar in a drawer |
| Properties: Format and Canvas | Scorecard link on the Pass card; Canvas under More |
| Timeline: trim, razor, rate stretch, slip, slide tools | Overflow; shortcuts live |
| Timeline: in and out, markers | Overflow |
| Timeline: voiceover record, mic | Overflow |
| Timeline: snap, skim, keyframe panel, linked selection | Snap stays; the rest in overflow |
| Timeline: sequences | Hidden unless the project has more than one; then a small tab row |
| Track headers | **Tracks** toggle |
| Audio meters | Level pip in transport; full meters from the gear menu |
| Workspaces: Color, Motion | Full only; Alt+2 and Alt+3 switch to Full |
| Toolbar: docs, what's new, settings, shortcuts, language, debug | Gear menu |
| Render queue | Badge on Export; click opens the queue |

## 5. Things the design needs that do not exist yet

- **Changes since pass.** A readable list from the undo stack since the last agent revision. The timeline store has the history; it needs human labels per operation type.
- **Next-pass note.** A field saved with the project that the agent reads at the start of a pass.
- **Beat grid.** The format already scores cuts against the music. The ruler needs the beat times to draw them.
- **Text style chips.** The Video Style Kit names the styles; the Text card needs them as a list with previews.
- **On-canvas text editing**, if the preview does not already support it.

## 6. Implementation shape

- Add `concise` to the workspace ids. It reuses the per-workspace persistence of timeline split, active tab and layout that Edit, Color and Motion already have. Full is the existing Edit workspace.
- The editor shell renders a second arrangement of the same panels. PreviewArea, Timeline, FormatPanel, ScorecardList, PropertiesSidebar and MediaSidebar are mounted, not rewritten. The new pieces are the context cards, the verb strip, the drawers, the compact timeline toolbar and the compact track labels.
- Two density presets in the editor layout config: `concise` (track label width 72, shots lane 92, text lane 24, music lane 40, toolbar height 32) and `concise-narrow` (shots lane 80, text lane 22, music lane 36, preview column 216, bin strip 150). The shell picks the narrow one below 1100 px of window width and on resize.
- The toggle is a segmented control in the toolbar and a shortcut. Switching keeps selection, playhead and zoom.

## 7. Implementation status

Built on the branch `claude/editor-timeline-interface-design-0ad079`.

- `concise` is a workspace id (`src/config/editor-workspaces.ts`) and the default for new sessions. `Alt+4` switches to it; the toolbar has a Concise | Full segmented control in both views, and the workspace switcher lists it.
- Shell: `src/features/editor/components/concise/concise-shell.tsx`. Reflows at 1100 px: wide puts the media bin under the context card; narrow puts it in a 150 px strip under the timeline. Row split is draggable and saved per mode.
- Context panel: `concise/context-panel.tsx` with `pass-card`, `shot-card`, `text-card`, `music-card`. "More" opens the full Properties sidebar in a drawer. Anything the cards do not cover (transitions, markers, shapes) shows the full sidebar inline.
- Changes since pass: `concise/changes-since-pass.ts` reads the undo stack after the last external change. Next-pass notes are written to `projects/<id>/agent/notes.json` by `src/infrastructure/storage/workspace-fs/agent-notes.ts`, through the shared store `src/shared/state/agent-notes.ts` (re-read every 4 s and on focus, so the agent's `read` marks clear them).
- Timeline comments: the comment button in the compact timeline header (or N) pauses and opens a composer at the playhead; the note is saved with its `frame` and the selected `itemIds`. Open timed notes show as amber pins on the ruler (`timeline-agent-comments.tsx`) and as timecode chips in the Pass card; a click seeks there. The agent reads them with `shred notes <id>` (what sits at each frame), marks them with `--read`, or gets each as it is sent with `--watch`.
- Timeline: compact header with Add, Tracks and More menus (`timeline-header.tsx`), 72 px track labels (`track-header.tsx`), per-kind lane heights (`utils/track-heights.ts`: video 80, audio 40, text 28, empty 20), and the video/audio split defaults to the video lanes' height in Concise. Split and delete share one code path with the shortcuts (`utils/editing-commands.ts`).
- Preview: `chrome="concise"` drops the title row and alignment strip; `compact` drops go-to-start/end, the shuttle indicator and the total timecode.
- Not built yet: beat grid on the ruler, drop-a-clip-to-replace (the bin hint says it, the timeline still places a new clip), on-canvas text editing, filmstrip in the Shot card (it repeats the thumbnail).
