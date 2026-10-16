# Cuts

Several versions of one edit, side by side: **Main**, **Hook B** (an alternate opening), **16:9** (a landscape version). The agent publishes variants as cuts instead of overwriting the one the user is reviewing, and the user picks. The user's brief: "keep it simple enough to add to the Concise view."

## 1. Two ways to build it

### A. A cut is a project, linked to its siblings by a group id

Each cut is an ordinary project in `projects/<id>/` with one extra field, `cut: { group, label, order }`.

What the code already gives this for free:

- **Media is workspace-level.** `media/<id>/` holds the file and its metadata, transcripts and caches; a project only references media ids on its timeline, plus a bin list (`projects/<id>/media-links.json`) that the editor backfills from the timeline on open (`workspace-fs/project-media.ts`, `loadMediaForProject`). A new cut that copies the timeline shares every file with no copy and no import. Verified: drafts already work exactly this way (`shred draft` is `POST /v1/projects` + `PUT` of the copied timeline).
- **Revision checks, drafts, publish, conflicts.** All of it is per project: `saveProjectResource` checks the revision of `projects/<id>/project.json`, `drafts.json` maps a draft to its target project id, `shred publish <draft> <target>` refuses when the target moved, and the editor's reload/conflict banner watches the open project's file. A cut gets all of this unchanged, and the agent can publish to Hook B while the user is mid-edit on Main without either side conflicting.
- **Per-project agent state.** `agent/passes/`, `agent/notes.json`, `agent/plan.json`, `agent/brief.yaml`, the activity banner, `shred changes`, `shred check`, `shred frames`, `shred export` all take a project id. Notes are pinned to timecodes, so they belong to one cut's timeline anyway.
- **Canvas.** Width, height and fps are project metadata, so a 16:9 cut is just a project at 1920x1080. Text styles already have one look per aspect ratio (`variants`, `shred styles clone --aspect`), and motion templates one version per aspect (`shred motion clone --aspect`). A cut at a new size picks those up.

### B. Several timelines inside one project

FreeCut does have the start of this: `timeline.topLevelSequenceIds` promotes sub-compositions to "standalone timeline" tabs, each with its own width and height, and the export dialog can pick one (`sequences-store.ts`, `export-dialog.tsx`). It doesn't fit the agent loop:

- One `project.json`, one revision. The agent publishing Hook B would conflict with the user saving Main (and vice versa), which is the opposite of "the agent publishes variants while the user reviews".
- Every agent surface works on the Main timeline (`project.timeline.items`): the edit service ops, `shred check` and the scorecard, the plan builder, `shred changes` (diffs `timeline`), notes, `/frame`, `/layout`, native export. Each would need a sequence id threaded through, plus a per-sequence pass history and per-sequence format and kit.
- Sequences are compositions: their items live in `compositions[]` with a different shape (no root markers, in/out, kit or format), so "duplicate Main as a sequence" is a conversion, not a copy.

**Decision: A.** It reuses drafts, publish, revision checks, conflicts, notes, passes, check and export untouched, handles different aspect ratios naturally, and the new code is a small group layer on top. B would touch every one of those paths and still leave the two versions fighting over one revision.

## 2. The model

```json
"cut": { "group": "<first main project id>", "label": "Hook B", "order": 2, "main": true }
```

- **Group.** A project's group is `cut.group`, else its own id. So the group id is the first main cut's project id, and an existing project needs no write to become a group's Main: making a cut never touches the source project. The group id never changes afterwards, not even when another cut is made Main (section 4).
- **Main** is the project with `cut.main: true`; without the flag, the project whose id is the group id (`isMainCut`). `main` is stored only where it differs from that default (`cutRecord`), so groups that never used "Make main" keep their old records. Main's label is `cut.label` when it has one (after a rename), else "Main". Order 0.
- **Order.** `cut.order` (Main is 0); new cuts go last. The switcher and `shred cut list` sort by it.
- **Name.** A cut's project name is `<group name> · <label>` (the project list and export file names show it); renaming a cut renames both. Main keeps its own name.
- Validated in the contract (`headless/lib/contract.mjs`: label 1-60 chars, optional `main` boolean) and the project schema (`project-schema.ts`); `PATCH /v1/projects/:id` takes `updates.cut`.

### Shared and per cut

| | Shared | Per cut |
|---|---|---|
| Media files, metadata, transcripts, categories | workspace `media/` | the bin list (`media-links.json`, backfilled from the timeline) |
| Catalogs (`catalogs/<slug>`) | yes | |
| Text style library, template library, LUTs, grade presets | workspace `app/` | the project copies of styles (`timeline.textStyles`), copied at creation |
| Format | copied at creation | can be changed per cut (`shred format set`) |
| Kit record | copied at creation (same kit.json) | |
| Brief, plan | copied at creation (the cut starts from the same story) | edited per cut afterwards |
| Canvas, timeline, revision | | yes |
| Drafts, passes, `shred changes`, notes, scorecard, export | | yes |

Copying (not linking) the brief, plan, kit and format is deliberate: a variant is usually "the same, except": a different hook, a different aspect. Linked copies would make one cut's change silently restructure another.

## 3. Creating a cut

`shred cut new <projectId> --label "Hook B" [--size 1920x1080] [--from <cutId>]` and the switcher's **New cut…** both duplicate the saved state of a cut (`--from`, else the given project; the editor saves first):

1. A new project at the source's size, or `--size`; the format, kit and timeline copied; `cut: { group, label, order: last + 1 }`.
2. The brief and plan copied into its `agent/`, and a first pass record (`agent/passes/001.json`, label `New cut "Hook B" from Main`, with the scorecard when it has a format). That record is what `shred changes` diffs against, and it makes the next `shred draft` a later pass (the cut's first edit was its source's plan).
3. With a new size, the timeline is re-fitted (`src/shared/projects/cuts.mjs`, `refitTimeline`), and what needs review is printed:
   - **Full-bleed media** (video or image that covered the old canvas, by explicit transform or by matching its aspect with none) is set to **cover** the new canvas, keeping any punch-in and offset, clamped so it still covers.
   - **Everything else** (text, shapes, picture-in-picture, overlays, compound clips, template instances) keeps its place relative to its nearest frame edge or the centre and scales by the short side, keyframes included: the same rule as `shred motion clone` (`adaptCompositionToCanvas`).
   - **Text with a style** takes the style's look for the new aspect (`applyTextStyle`), then gets its own non-position overrides back (a colour tweak survives; a position tweak made for 9:16 doesn't). A style with no version for the new aspect is left re-anchored, with a warning naming `shred styles clone "<name>" --aspect 16:9 --project <cutId>`.
   - Review list: re-anchored items that aren't full-bleed, template instances (their composition is still the old aspect: `shred motion clone --aspect`, `updateTemplate`), compound clips, styles without the aspect, and that the format's targets were written for its own canvas.
4. Prints the cut id and its editor URL.

Aspect presets in the UI: same, 9:16, 16:9, 1:1, 4:5. A preset canvas keeps the source's short side (1080x1920 → 1920x1080).

## 4. Renaming, ordering, making Main, removing

- `shred cut rename <cutId> "..."`, or the Manage dialog. Refused while the editor has unsaved edits on that cut (the rename writes its project.json).
- Order: the Manage dialog's up/down. (CLI: not needed yet.)
- **Make main**: `shred cut main <cutId>`, or the crown in the Manage dialog. Two ways to build it:
  - *Re-point the group*: every cut's `cut.group` becomes the new Main's id. That writes every project in the group (each a revision change an open editor sees), is not atomic (a failure halfway splits the group), and changes the id the rest of the system knows the group by.
  - *Keep the group id, flag the Main* (chosen): the cut gets `cut: { group, label, order: 0, main: true }` and the group's name as its project name; the old Main gets `main: false` (when its id is the group id), the cut's old place in the order and the name `<group> · <label>` (its label, "Main" when it had none). Exactly those two projects are written, through `PATCH /v1/projects/:id` with their revisions (the editor: `updateProject`, its own revision-checked save), promotion first so a failure between the writes leaves two Mains (both sorted first) rather than none. Every other cut, the group id, drafts and pass history stay untouched, and old groups (whose Main has no `cut` field) work unchanged. Refused while the editor has unsaved edits on either cut. Renames and moves keep the flag (`cutRecord`).
  - The new Main can't be removed while the group has other cuts; the old Main now can.
- **Remove** is a soft delete: the cut goes to the editor's Trash (the `.freecut-trashed.json` marker, restorable from the project list), never any media. `shred cut remove <cutId> --yes` (without `--yes` it says what it would do and stops); the Manage dialog asks for confirmation. Main can't be removed while the group has other cuts. The cut's bin list is parked (`media-links.json` → `media-links.cut-removed.json`) so the Trash's 30-day purge can't delete media only that cut used; a restore re-links everything on its timeline when it is opened.
- Service: `POST /v1/projects/:id/trash` (revision-checked) does the trash; `GET /v1/projects` lists each project's `cut` and whether it is trashed.

## 5. Seeing cuts

- **Concise and Full toolbar: a cut switcher** beside the format chip. A project alone shows a quiet "+ Cut" ghost button. In a group it shows the current cut's label; the menu lists each cut with its size and a dot for its last pass's scorecard (fail, warn, pass; no dot without one), then **New cut…** and **Manage cuts…**.
- **Switching** navigates to that cut's project in the same tab; unsaved edits get the editor's usual Save / Discard / Cancel dialog first.
- **When the agent publishes to a cut**, the editor goes there. The editor's heartbeat to the workspace bridge (`POST /__shreditor/editor-state`, about once a second) lists the open cut's siblings (`cuts`); the reply's `cutPublish` is the newest pass published into one of them (`latestPublish`: the agent-activity record `shred publish` ends with `ended: "published"`). One newer than the editor's load, or than the last one it followed, switches the editor to that cut in the same tab, with a toast naming it, through the same path as picking it in the switcher: unsaved edits get the Save / Discard / Cancel dialog first, so nothing is discarded silently, and Cancel stays. The "new pass" mark stays as well: every 10 s the switcher checks the cuts' pass folders, and a cut with a pass newer than the editor's load shows a dot on the switcher and in the menu. The cut it switched to shows its "pass ready" bar.
- **Project list**: a group is one card, its Main's (its first cut's while Main is in the Trash), with the group's cuts listed on it in cut order, each with its label (a crown on Main) and size; a cut opens that cut. Search, sort and filter work on every project: a group shows when any of its cuts matches, where the first match sorts, with all its cuts. The count is of cards. Deleting the card moves that one project to the Trash (as before); the group's other cuts stay and the card shows the next cut. Each trashed cut is listed and restored on its own in the Trash and rejoins its group on restore.
- **Export**: the export dialog exports the open cut; download and queue file names carry the cut's label. **All cuts** (the Add to queue menu, shown for a group) exports every cut of the group one after another with the dialog's codec and quality, each at its own size, named `<project> - <cut label>` into its own `exports/`: the workspace bridge (`server/cut-export-bridge.mjs`, `POST /__shreditor/cuts/export`) runs `shred export <cutId> --out "<project> - <cut label>"` per cut, so each uses the native engine when it can, else the browser engine, and a dialog shows each cut waiting, exporting, done (with the engine and file) or failed (with why; the rest carry on). `shred export <id> --all-cuts` does the same from the CLI and prints each cut's engine and path (it refuses `--out`).
- `shred status` lists cut groups; `shred project <id>` names the cut and its siblings.

## 6. Limits

- Kit geometry checks and the format's targets were written for the kit's and format's canvas; a 16:9 cut of a 9:16 format scores against 9:16 targets. The scorecard says what it measured; read it with that in mind.
- Deleting Main from the project list leaves its cuts grouped under its id with no Main; they still switch between each other, and one can be made Main.
- "All cuts" in the editor needs the workspace bridge and the edit service (the agent-native setup); it exports each cut's saved state, so the open cut's unsaved edits are not in it (`shred export` warns).
- An editor follows publishes only while it is open on the bridge (agent-native mode): a plain browser workspace has no agent to follow.
