# Cuts

Several versions of one edit, side by side: **Main**, **Hook B** (an alternate opening), **16:9** (a landscape version). The agent publishes variants as cuts instead of overwriting the one the user is reviewing, and the user picks. The user's brief: "keep it simple enough to add to the Concise view."

## 1. Two ways to build it

### A. A cut is a project, linked to its siblings by a group id

Each cut is an ordinary project in `projects/<id>/` with one extra field, `cut: { group, label, order }`.

What the code already gives this for free:

- **Media is workspace-level.** `media/<id>/` holds the file and its metadata, transcripts and caches; a project only references media ids on its timeline, plus a bin list (`projects/<id>/media-links.json`) that the editor backfills from the timeline on open (`workspace-fs/project-media.ts`, `loadMediaForProject`). A new cut that copies the timeline shares every file with no copy and no import. Verified: drafts already work exactly this way (`shred draft` is `POST /v1/projects` + `PUT` of the copied timeline).
- **Revision checks, drafts, publish, conflicts.** All of it is per project: `saveProjectResource` checks the revision of `projects/<id>/project.json`, `drafts.json` maps a draft to its target project id, `shred publish <draft> <target>` refuses when the target moved, and the editor's reload/conflict banner watches the open project's file. A cut gets all of this unchanged, and the agent can publish to Hook B while the user is mid-edit on Main without either side conflicting.
- **Per-project agent state.** `agent/passes/`, `agent/notes.json`, `agent/plan.json`, `agent/brief.yaml`, the activity banner, `shred changes`, `shred check`, `shred frames`, `shred export` all take a project id. Notes are pinned to timecodes, so they belong to one cut's timeline anyway.
- **Canvas.** Width, height and fps are project metadata, so a 16:9 cut is just a project at 1920x1080. Text styles already have one look per aspect ratio (`variants`, `shred styles clone --aspect`), and motion templates one version per aspect (`shred templates clone --aspect`). A cut at a new size picks those up.

### B. Several timelines inside one project

FreeCut does have the start of this: `timeline.topLevelSequenceIds` promotes sub-compositions to "standalone timeline" tabs, each with its own width and height, and the export dialog can pick one (`sequences-store.ts`, `export-dialog.tsx`). It doesn't fit the agent loop:

- One `project.json`, one revision. The agent publishing Hook B would conflict with the user saving Main (and vice versa), which is the opposite of "the agent publishes variants while the user reviews".
- Every agent surface works on the Main timeline (`project.timeline.items`): the edit service ops, `shred check` and the scorecard, the plan builder, `shred changes` (diffs `timeline`), notes, `/frame`, `/layout`, native export. Each would need a sequence id threaded through, plus a per-sequence pass history and per-sequence format and kit.
- Sequences are compositions: their items live in `compositions[]` with a different shape (no root markers, in/out, kit or format), so "duplicate Main as a sequence" is a conversion, not a copy.

**Decision: A.** It reuses drafts, publish, revision checks, conflicts, notes, passes, check and export untouched, handles different aspect ratios naturally, and the new code is a small group layer on top. B would touch every one of those paths and still leave the two versions fighting over one revision.

## 2. The model

```json
"cut": { "group": "<main project id>", "label": "Hook B", "order": 2 }
```

- **Group.** A project's group is `cut.group`, else its own id. So the group id is the main cut's project id, and an existing project needs no write to become a group's Main: making a cut never touches the source project.
- **Main** is the project whose id is the group id. Its label is `cut.label` when it has one (after a rename), else "Main". Order 0.
- **Order.** `cut.order` (Main is 0); new cuts go last. The switcher and `shred cut list` sort by it.
- **Name.** A cut's project name is `<group name> · <label>` (the project list and export file names show it); renaming a cut renames both. Main keeps its own name.
- Validated in the contract (`headless/lib/contract.mjs`: label 1-60 chars) and the project schema (`project-schema.ts`); `PATCH /v1/projects/:id` takes `updates.cut`.

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
   - **Everything else** (text, shapes, picture-in-picture, overlays, compound clips, template instances) keeps its place relative to its nearest frame edge or the centre and scales by the short side, keyframes included: the same rule as `shred templates clone` (`adaptCompositionToCanvas`).
   - **Text with a style** takes the style's look for the new aspect (`applyTextStyle`), then gets its own non-position overrides back (a colour tweak survives; a position tweak made for 9:16 doesn't). A style with no version for the new aspect is left re-anchored, with a warning naming `shred styles clone "<name>" --aspect 16:9 --project <cutId>`.
   - Review list: re-anchored items that aren't full-bleed, template instances (their composition is still the old aspect: `shred templates clone --aspect`, `updateTemplate`), compound clips, styles without the aspect, and that the format's targets were written for its own canvas.
4. Prints the cut id and its editor URL.

Aspect presets in the UI: same, 9:16, 16:9, 1:1, 4:5. A preset canvas keeps the source's short side (1080x1920 → 1920x1080).

## 4. Renaming, ordering, removing

- `shred cut rename <cutId> "..."`, or the Manage dialog. Refused while the editor has unsaved edits on that cut (the rename writes its project.json).
- Order: the Manage dialog's up/down. (CLI: not needed yet.)
- **Remove** is a soft delete: the cut goes to the editor's Trash (the `.freecut-trashed.json` marker, restorable from the project list), never any media. `shred cut remove <cutId> --yes` (without `--yes` it says what it would do and stops); the Manage dialog asks for confirmation. Main can't be removed while the group has other cuts. The cut's bin list is parked (`media-links.json` → `media-links.cut-removed.json`) so the Trash's 30-day purge can't delete media only that cut used; a restore re-links everything on its timeline when it is opened.
- Service: `POST /v1/projects/:id/trash` (revision-checked) does the trash; `GET /v1/projects` lists each project's `cut` and whether it is trashed.

## 5. Seeing cuts

- **Concise and Full toolbar: a cut switcher** beside the format chip. A project alone shows a quiet "+ Cut" ghost button. In a group it shows the current cut's label; the menu lists each cut with its size and a dot for its last pass's scorecard (fail, warn, pass; no dot without one), then **New cut…** and **Manage cuts…**.
- **Switching** navigates to that cut's project in the same tab; unsaved edits get the editor's usual Save / Discard / Cancel dialog first.
- **When the agent publishes to a cut**, the editor doesn't jump: the user may be mid-review on another cut. The switcher re-reads its group when the window gains focus and every 10 s checks the cuts' pass folders; a cut with a pass newer than the editor's load shows a dot on the switcher and in the menu ("new pass"). The agent tells the user which cut to look at and points its browser at that cut's editor link (`shred publish` prints it).
- **Export**: the export dialog exports the open cut; download and queue file names carry the cut's label. Exporting every cut is one `shred export <cutId>` per cut (`shred cut list` lists them); the editor doesn't batch them.
- `shred status` lists cut groups; `shred project <id>` names the cut and its siblings.

## 6. Limits

- Kit geometry checks and the format's targets were written for the kit's and format's canvas; a 16:9 cut of a 9:16 format scores against 9:16 targets. The scorecard says what it measured; read it with that in mind.
- The project list shows cuts as separate projects (named `<group> · <label>`).
- Deleting Main from the project list leaves its cuts grouped under its id with no Main; they still switch between each other.
