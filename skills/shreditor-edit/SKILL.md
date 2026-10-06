---
name: shreditor-edit
description: Edit video with Shreditor, where the agent makes edits and the user previews and adjusts them in the Shreditor editor. Use whenever the user wants to cut, edit, assemble, recut, caption or revise a video in Shreditor, catalog footage for an edit, "run a pass", or continue from their tweaks. Runs the whole loop - choose the format (Graphic Yap, Greenscreen, Vlog or 10 Shot), catalog footage, plan, edit, check against the format, let the user preview and adjust, iterate until done. Style comes from a separate style skill (for Landforce, landforce-vlog and the video kit); this skill is the process and the engine.
---

# Shreditor edit

You are the agent half of Shreditor: you make the edit, the user previews and adjusts it in the Shreditor editor, and each next pass starts from their saved state. The design behind this is in the Shreditor repo under `agent/`; this file is how to run it.

**Rules that are not negotiable**

1. **Every engine call goes through `shred`** (`node <this skill>/scripts/shred.mjs`). Never hand-roll HTTP calls, write `project.json`, or invent ops. If `shred` can't do something, say so and stop.
2. **Never build in the user's project.** Build on a draft (`shred draft`), verify it, then hand it over with `shred publish`. The user sees finished passes only, never work in progress.
3. **The user's tweaks are decisions.** Before every pass, `shred changes` shows what they changed; keep it. Never reapply an old plan over their edits.
4. **The format comes first, the style second, neither is yours to invent.** Choose the format with the user before anything else (step 1). Load the style skill before planning. Landforce: read `~/Dev/landforce/.claude/skills/landforce-vlog/SKILL.md` and the kit it names. No style skill: ask once, record the answer in the brief.
5. **A command succeeding is not a check.** Open every rendered image you rely on. Say plainly what you looked at, listened to, or didn't.

**Setup, every session:** `shred up` starts the editor (http://localhost:5273, a stable built copy) and the agent service, then `shred status`. Open the editor URL in your browser so you and the user see the same thing. The workspace (where projects, media and catalogs live) is `~/Movies/Shreditor` unless `~/.shreditor/config.json` says otherwise; `SHRED_WORKSPACE=<dir>` overrides both (tests and scratch work).

## The loop

### 1. Choose the format

Every edit starts here; nothing is planned or cut until the format is agreed. A format defines the whole project: canvas, named tracks, pacing, text and audio rules, and the targets `shred check` scores. There are four (`shred format list`):

| Format | Use when | Variants |
|---|---|---|
| Graphic Yap (`graphic-yap`) | Talking head in a real setting, naming things that can be shown as images | `standard` (default), `intense` |
| Greenscreen Talking Head (`greenscreen`) | Talking head shot on a green screen, or meant to be keyed | |
| Vlog (`vlog`) | B-roll with voiceover narrating over it | `fast`, `slow` (pick one) |
| 10 Shot (`ten-shot`) | Clips of a place, thing or experience; nobody talking; music | `even`, `beat`, `shaped` (rhythm) |

- If the user named one, use it; if the footage doesn't fit it, say so before editing. Otherwise catalog first (step 2): `shred catalog` prints a suggested format with its reason. Propose one format and variant with a one-line reason from the footage and get the user's yes. The decision rules and tie-breakers are in `<repo>/formats/choosing.md`.
- Record it: `shred new --name "..." --format <id> [--variant <v>]` (sets the canvas and creates the format's named tracks, each with its role), or `shred format set <projectId> <id> [--variant <v>]` on an existing project.
- `shred format <projectId>` prints the format's rules, targets, checklist and guide path. **Read the guide (`formats/<id>/guide.md`) fully before planning.** It is the source of truth; its targets and rules drive the plan. Ignore what it says about other plugin skills or tools: here every edit goes through `shred`.

### 2. Catalog the footage

- `shred catalog <folder or files> --name <slug>` probes everything, makes a contact sheet per clip, transcribes speech (whisper.cpp) and suggests a format. Output: `<workspace>/catalogs/<slug>/catalog.json` plus `sheets/` and `transcripts/`. Footage already imported is not transcribed again: its entry carries `mediaId`, the built-in transcript and any `category` with its `categorySource`.
- Every audio/video import is transcribed in the background on its own (whisper.cpp, locally, word timings), into the same transcript the editor's transcript panel and captions use. `shred transcript <mediaId>` prints its words with start/end seconds (`--json` for segments); it says `queued`/`running` while still working and `none` when there is no speech. `shred transcribe <mediaId>` runs it now. If it says unavailable, `shred setup` (then `--yes` to download the model, with the user's OK).
- Open every contact sheet and read every transcript. Add to each catalog entry: `content` (what it shows, in a few words), `best` (in-points worth using, seconds), `usable` (yes/no and why), `category`, and for talking heads where the face sits. Metadata does not tell you what a shot shows.
- `category` is what the file is for: `speaker` (talking head), `b-roll`, `graphics` (screenshots, evidence, title cards), `overlay` (transparent cutouts, animated overlays), `voiceover`, `music`, `sfx` or `other`. Every entry gets one; the scorecard maps categories to the format's roles. Apply them when you import; the editor's media pane groups by them. With a project open, the editor suggests `speaker` or `b-roll` for uncategorized video on its own (`categorySource: auto`, shown as `[speaker auto]` by `shred media --project <id>`). A suggestion is a guess from speech and frames: confirm it or correct it with `shred categorize`, which makes it yours.
- `browserPlayable: false` (PNG-codec `.mov`, DNx, MPEG-4 Part 2, AVI/MTS, AC-3/ALAC audio, ...) needs nothing from you: import makes a working copy automatically (`workingCopy` says how). ProRes reports `true`: the editor decodes it itself. Always import the original file. Transparent video keeps its alpha, so cutouts and overlays stay separate, movable layers. Originals are never touched.
- Entries with `speechNote` had no real speech (Whisper's "Thank you." on music or typing is discarded). Flag duplicates.
- Give the user a short catalog summary: what's there, what's strong, what's missing, and the format you propose.

### 3. Plan

- Ask what the format and style skill don't settle, if the user hasn't said: length, audience, the one thing the viewer should leave with, must-keep moments, and whether they want to see the plan first. One round of questions, only what changes the result.
- Import the footage you'll use, one call per category: `shred import <files> --project <id> --category <category>` (clones in place, no copying; it waits while files Chrome can't decode get their working copy, printing progress). Fix or add categories later with `shred categorize <mediaId>=<category> ...`. The open editor shows imports and category changes within a second. The user can recategorize from a media card; their choice is in `media/<id>/metadata.json` and wins.
- Write the brief (`<workspace>/projects/<id>/agent/brief.yaml`) and the beat plan (`plan.json`). Templates: `references/brief-and-plan.md`. Plan to the format's targets (length, change rate, first image or cut, title hook and hold, pauses) and its checklist; every beat has a viewer takeaway; the style skill decides look, type and placement.
- If the brief says `review.plan: true`, show the plan and wait.

### 4. Edit, check, then let the user preview and adjust

- `shred sync <id>` first: the open editor saves now, so the draft includes the user's unsaved tweaks.
- `shred draft <id>` gives you a private copy. Build there in coherent batches (assembly, then type, then callouts, then sound) with `shred apply <draftId> ops.json`. Put each item on the format track for its role (`shred new` printed them: Title, Captions, Images, Speaker, ...); add tracks only for extra layers. Items on one track can't overlap: a batch that would overlap fails whole, so place everything at free ranges. Op shapes, units and gotchas: `references/engine.md`; read it before the first batch.
- Verify on the draft: `shred frames <draftId> --at <frames> --out grid.jpg`, then open it. Sample every shot, both sides of every cut, every text entrance, and anything near the style's safe area. Fix, re-render, look again. Sound: master the voiceover (or the final mix stem) with `shred master <file> --lufs -14 --tp -1.5` and import the `.mastered.wav` it writes; clip volume can't hit a loudness target. Measure the final export with ffmpeg `ebur128` (`references/engine.md`, Loudness). Say if you couldn't listen.
- **`shred check <draftId>` before every publish.** It scores the timeline against the format and lists frame ranges for each miss. Fix every FAIL, or tell the user why it stays; WARNs are the guide's starting points: meet them or say why not. A check reading `n/a` means it couldn't measure (say a transcript is missing).
- Write `summary.md` (template in `references/brief-and-plan.md`): what this pass does, what to look at and when, checks performed, what's placeholder.
- `shred publish <draftId> <id> --label "<one line>" --summary summary.md`. It prints the scorecard and saves it with the pass. Make sure your browser is showing the editor link it prints (the user's project, not the draft); the editor reloads the pass in about a second.
- Hand over: tell the user the pass is in the editor, give the times worth watching and any scorecard misses, and invite them to adjust anything directly (trim, move, retime, swap, edit text) and save, or to tell you what to change. Then stop and wait.

### 5. Iterate until done

- When the user comes back: `shred sync <id>` (the editor saves what it holds), then `shred changes <id>` lists what they changed since your last pass. Those are decisions; build on them. Read their notes if any.
- It lists markers (added, moved, relabelled) and in/out points too. Markers are often the user's notes to you: read each label and go to its frame.
- Scope the next pass to what they asked. `shred draft <id>` again (from their current state), apply, verify, `shred check`, publish with a new label, hand over, wait.
- If `shred publish` refuses because they saved while you worked, take a new draft from their state, re-apply your ops, verify, publish.
- Repeat until they say it's done. Then export if asked: `shred sync <id>`, then `shred export <id>` (native ffmpeg render from the original media when possible, else the browser render; it prints which items went native and which the browser drew; `--codec prores|hevc` for 10-bit masters). The file lands in `<workspace>/projects/<id>/exports/`. Report the final revision, the export path and engine, the last scorecard, what was checked, and anything unresolved.

## Report format (every pass)

Pass label and revision · format and variant · what changed, in a few lines · times to watch · scorecard (fails and warns, each fixed or explained) · checks actually performed (visual, listened, measured, not checked) · placeholders and open questions.
