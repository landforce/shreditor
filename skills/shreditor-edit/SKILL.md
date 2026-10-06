---
name: shreditor-edit
description: Edit video with Shreditor, where the agent makes edits and the user previews and adjusts them in the Shreditor editor. Use whenever the user wants to cut, edit, assemble, recut, caption or revise a video in Shreditor, catalog footage for an edit, "run a pass", or continue from their tweaks. Runs the whole loop - catalog footage, agree the format, edit, let the user preview and adjust, iterate until done. Style comes from a separate style skill (for Landforce, landforce-vlog and the video kit); this skill is the process and the engine.
---

# Shreditor edit

You are the agent half of Shreditor: you make the edit, the user previews and adjusts it in the Shreditor editor, and each next pass starts from their saved state. The design behind this is in the Shreditor repo under `agent/`; this file is how to run it.

**Rules that are not negotiable**

1. **Every engine call goes through `shred`** (`node <this skill>/scripts/shred.mjs`). Never hand-roll HTTP calls, write `project.json`, or invent ops. If `shred` can't do something, say so and stop.
2. **Never build in the user's project.** Build on a draft (`shred draft`), verify it, then hand it over with `shred publish`. The user sees finished passes only, never work in progress.
3. **The user's tweaks are decisions.** Before every pass, `shred changes` shows what they changed; keep it. Never reapply an old plan over their edits.
4. **Style is not yours to invent.** Load the style skill before planning. Landforce: read `~/Dev/landforce/.claude/skills/landforce-vlog/SKILL.md` and the kit it names. No style skill: ask once, record the answer in the brief.
5. **A command succeeding is not a check.** Open every rendered image you rely on. Say plainly what you looked at, listened to, or didn't.

**Setup, every session:** `shred up` starts the editor (http://localhost:5273) and the agent service, then `shred status`. Open the editor URL in your browser so you and the user see the same thing. The workspace (where projects, media and catalogs live) is `~/Movies/Shreditor` unless `~/.shreditor/config.json` says otherwise; `SHRED_WORKSPACE=<dir>` overrides both (tests and scratch work).

## The loop

### 1. Analyze and catalog the footage

- `shred catalog <folder or files> --name <slug>` probes everything, makes a contact sheet per clip, and transcribes speech (whisper.cpp). Output: `<workspace>/catalogs/<slug>/catalog.json` plus `sheets/` and `transcripts/`.
- Open every contact sheet and read every transcript. Add to each catalog entry: `content` (what it shows, in a few words), `best` (in-points worth using, seconds), `usable` (yes/no and why), and for talking heads where the face sits. Metadata does not tell you what a shot shows.
- Files the browser can't decode (ProRes, PNG-codec `.mov`, ...) get a playable copy automatically in `proxies/`: H.264 for normal video, VP9 WebM with alpha for transparent video (cutouts, animated overlays), so those stay separate, movable layers. Import an entry's `proxy` instead of its `file`. Originals are never touched.
- Entries with `speechNote` had no real speech (Whisper's "Thank you." on music or typing is discarded). Flag duplicates.
- Give the user a short catalog summary: what's there, what's strong, what's missing.

### 2. Understand the format the user wants

- Ask what they're making, if they haven't said: format (for example VO vlog, talking-head yap, 10 shot), length, audience, the one thing the viewer should leave with, must-keep moments, music or not, and whether they want to see the plan before you build. Offer the formats their style skill defines. One round of questions, only what changes the result.
- `shred new --name "..." --size 1080x1920 --fps 30` creates the project (or use the one they name). It prints the default tracks (`V1 track-1`, `A1 track-2`). Import the footage you'll use: `shred import <files> --project <id>` (clones in place, no copying).
- Write the brief (`<workspace>/projects/<id>/agent/brief.yaml`) and the beat plan (`plan.json`). Templates: `references/brief-and-plan.md`. Every beat has a viewer takeaway; the style skill decides pacing, type and placement.
- If the brief says `review.plan: true`, show the plan and wait.

### 3. Edit, then let the user preview and adjust

- `shred draft <id>` gives you a private copy. Build there in coherent batches (assembly, then type, then callouts, then sound) with `shred apply <draftId> ops.json`. Reuse the default V1/A1 tracks; add tracks only for extra layers. Items on one track can't overlap: a batch that would overlap fails whole, so place everything at free ranges. Op shapes, units and gotchas: `references/engine.md`; read it before the first batch.
- Verify on the draft: `shred frames <draftId> --at <frames> --out grid.jpg`, then open it. Sample every shot, both sides of every cut, every text entrance, and anything near the style's safe area. Fix, re-render, look again. Sound: master the voiceover (or the final mix stem) with `shred master <file> --lufs -14 --tp -1.5` and import the `.mastered.wav` it writes; clip volume can't hit a loudness target. Measure the final export with ffmpeg `ebur128` (`references/engine.md`, Loudness). Say if you couldn't listen.
- Write `summary.md` (template in `references/brief-and-plan.md`): what this pass does, what to look at and when, checks performed, what's placeholder.
- `shred publish <draftId> <id> --label "<one line>" --summary summary.md`. Make sure your browser is showing the editor link it prints (the user's project, not the draft); the editor reloads the pass in about a second.
- Hand over: tell the user the pass is in the editor, give the times worth watching, and invite them to adjust anything directly (trim, move, retime, swap, edit text) and save, or to tell you what to change. Then stop and wait.

### 4. Iterate until done

- When the user comes back: `shred changes <id>` lists what they changed since your last pass. Those are decisions; build on them. Read their notes if any.
- Scope the next pass to what they asked. `shred draft <id>` again (from their current state), apply, verify, publish with a new label, hand over, wait.
- If `shred publish` refuses because they saved while you worked, take a new draft from their state, re-apply your ops, verify, publish.
- Repeat until they say it's done. Then export if asked (the service's render route, or the editor's Export), and report the final revision, what was checked, and anything unresolved.

## Report format (every pass)

Pass label and revision · what changed, in a few lines · times to watch · checks actually performed (visual, listened, measured, not checked) · placeholders and open questions.
