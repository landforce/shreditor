# Brief, plan and pass summary

All three live with the project: `<workspace>/projects/<id>/agent/`.

## brief.yaml

```yaml
project_id: ""
purpose: ""            # what the video is for
message: ""            # the one thing the viewer should leave with
audience: ""
canvas: { width: 1080, height: 1920, fps: 30 }
duration_target_seconds: null
style_skill: ""        # e.g. landforce-vlog
format: ""             # graphic-yap | greenscreen | vlog | ten-shot (same as the project's)
format_variant: ""     # e.g. standard, intense, fast, slow, even, beat, shaped
assets: []             # paths or media ids, with a word on each
must_keep: []          # lines, shots or moments that stay
audio_intent: ""       # VO only, music bed, source sound...
review: { plan: false } # true = show the plan (shred build --markers-only) before building
execution: autonomous  # or assisted (pause at each pass)
constraints: []
decisions:             # every material decision and where it came from
  - what: ""
    origin: user | accepted | reference | assumption
```

## plan.json

The first edit of every project is built from this file (`shred plan` validates it, `shred draft` refuses a first pass until it validated clean, `shred build` turns it into the first assembly). Schema v3 has two modes, set by the format:

| Mode | Formats | The plan is |
|---|---|---|
| `performance` | Graphic Yap, Greenscreen | the speaker's performance: their lines in order, each kept or cut (and why), with the visuals and text for each kept line |
| `story` | Vlog, 10 Shot | a story of beats: clips placed on the timeline to tell the arc |

`shred plan` warns when a plan's mode isn't its format's. A v3 plan without `mode` is a performance plan if it has `performance`, a story if it has `beats`, else the format's mode. v2 plans are read as story plans; v1 plans are read but don't validate.

Both start the same way: `request` (the user's ask, in their words) and `story.arc` (one or two sentences: the order of the video and why; for a speaker that is short: the talk's point and how it opens and closes) are required, and `story.structure` lists the roles used, from the format's structure (`shred format <id>`): Graphic Yap hook, body, close; Greenscreen hook, setup, body, close; Vlog hook, body, payoff, close (the guide's End, optional); 10 Shot hook, body, close, with an optional setup and payoff for a premise build. `fps` is the project's.

### Performance (Graphic Yap, Greenscreen)

Start from the scaffold: `shred plan <id> --scaffold <speaker mediaId...>` (in the order they play). It reads each speaker's built-in transcript, splits it into lines on sentence ends and on silences of the format's longest pause or more (the Video Style Kit's `tightCuts.maxPauseMs` when on), cuts each such silence as `pause` (or `dead air` from 2 s), cuts the earlier of two takes of one sentence as a `retake` with `takeOf` the later one, cuts filler-only fragments ("Um.") and restarts ("So the, so the...") as `false start`, keeps the rest, sets `padFrames` (the kit's `tightCuts.paddingFrames`, else a tenth of the pause target, 1 to 3 frames) and guesses roles (first kept line hook, last close, a setup for Greenscreen). It writes `agent/plan.json`, or `agent/plan.scaffold.json` when a plan exists, and prints the script. **It is a starting point, not an edit: review every line.**

```json
{
  "schemaVersion": 3,
  "mode": "performance",
  "fps": 30,
  "request": "Cut my bread rant into a Graphic Yap: lose the retake and the dead air",
  "story": {
    "arc": "Open on the claim, show why the fridge is wrong, give the freezer fix, end on how to do it.",
    "structure": ["hook", "body", "close"]
  },
  "performance": {
    "speaker": ["<talk mediaId>"],
    "padFrames": 3,
    "lines": [
      {
        "id": "l01", "role": "hook", "keep": true,
        "source": { "mediaId": "<talk mediaId>", "in": 0.12, "out": 2.12, "unit": "s" },
        "text": "Most people store their bread completely wrong.",
        "visuals": [{ "asset": "<loaf.png mediaId>", "at": "bread", "until": "wrong" }],
        "onScreen": { "text": "You store bread wrong", "until": { "line": "l04" } },
        "takeaway": "Your bread habit is wrong", "why": "The claim is the hook"
      },
      { "id": "l02", "keep": false, "reason": "pause", "text": "",
        "source": { "mediaId": "<talk mediaId>", "in": 2.12, "out": 4.04, "unit": "s" } },
      { "id": "l03", "role": "body", "keep": false, "reason": "retake", "takeOf": "l04",
        "source": { "mediaId": "<talk mediaId>", "in": 4.04, "out": 5.5, "unit": "s" },
        "text": "The fridge makes bread go stale.", "why": "The second take adds \"faster\" and is cleaner" },
      {
        "id": "l04", "role": "body", "keep": true,
        "source": { "mediaId": "<talk mediaId>", "in": 5.76, "out": 7.58, "unit": "s" },
        "text": "The fridge makes bread go stale faster.",
        "visuals": [{ "asset": "<fridge.png mediaId>" }]
      },
      {
        "id": "l07", "role": "body", "keep": true,
        "source": { "mediaId": "<talk mediaId>", "in": 9.94, "out": 11.5, "unit": "s" },
        "text": "so the freezer is your best friend.",
        "visuals": [{ "toSource": "a freezer drawer full of sliced bread", "at": "freezer" }]
      }
    ]
  }
}
```

- Every line: `id`, `source` (`mediaId` of a speaker clip, `in` and `out` where the line is said; `unit` `"s"` (default) or `"frames"` at the plan's fps), `text` (what is said), `keep`. Kept lines need a `role`; cut lines a `reason`: `flub`, `retake`, `pause`, `tangent`, `false start`, `dead air` or `other`. `takeaway` and `why` are optional; write a `why` for every cut you make by judgment.
- **Kept lines play in plan order, jump cut back to back.** Each clip keeps `padFrames` of its source at both ends, never reaching into another line's speech. Kept lines that run on in the source (the next starts within two pads of where this one ends) play as one clip, so there is no false cut between them. Reorder lines to restructure the talk. The length is the kept lines plus pads (`durationFrames` is optional; set it and it must agree).
- `takeOf`: the line this take competes with. Linked takes form a set and exactly one of a set is kept (two kept is an error; none kept a warning).
- The first kept line is the hook (an error otherwise); kept lines out of story order are warnings.
- A kept line's `text` should be what its transcript says between `in` and `out` (a warning quotes the transcript when it isn't): it is how the plan stays readable.
- `visuals` (kept lines): each `{ track?, asset?, toSource?, at?, until?, in?, fit?, note? }`. `asset` is a media id or a catalogued file (import it before `shred build`); without one, `toSource` says what to find or make, and the build leaves a red marker there. `track` is `images`, `plates`, `broll` or `labels` (or a format track name); by default the media's category decides (Graphic Yap: Images, Greenscreen: Plates). `at` / `until`: seconds after the line's `in`, a word or phrase the line says (`"freezer"`: from its start / to its end), `{ "word": n }` (0-based), and for `until` also `{ "line": "<kept line id>" }` to hold across lines; by default the visual covers the whole line. `in`: seconds into a video asset. `fit`: `"contain"` (default), `"cover"` (full bleed) or a transform. Two visuals on one track at once are an error.
- `onScreen` (kept lines): a string or `{ text, role?, at?, until?, style? }`, timed like a visual; `title` on the opening hook line, `labels` elsewhere, unless `role` says. Styles as in story mode.

`shred plan <id>` prints a performance plan as a script, then the To source list and the estimates (example, from a test cut):

```
v3 performance, 30 fps, 9 lines (4 kept, 5 cut), cut 7.77 s (233 frames), pad 3 frames, Graphic Yap
Ask    Cut my bread rant into a Graphic Yap: lose the retake and the dead air
Arc    Open on the claim, show why the fridge is wrong, give the freezer fix, end on how to do it.
Story  hook → body → close   (Graphic Yap: Hook → Body → Close)

 0:00.00   KEEP                   l01   hook   Most people store their bread completely wrong.
                talk.mp4 0.12-2.12 s
                + images  loaf.png  0:01.13-0:02.10
                + title   "You store bread wrong"  0:00.00-0:04.23
                takeaway  Your bread habit is wrong
(0:02.20)  CUT (pause)            l02   -      [1.92 s without words]
                talk.mp4 2.12-4.04 s
(0:02.20)  CUT (retake of l04)    l03   body   The fridge makes bread go stale.
                talk.mp4 4.04-5.50 s
                why       The second take adds "faster" and is cleaner
 0:02.20   KEEP                   l04   body   The fridge makes bread go stale faster.
                talk.mp4 5.76-7.58 s
                + images  fridge.png  0:02.20-0:04.23
...
 0:04.23   KEEP                   l07   body   so the freezer is your best friend.
                talk.mp4 9.94-11.50 s
                + images  TO SOURCE: a freezer drawer full of sliced bread  0:04.70-0:05.90

To source (1)
  l07-v1   0:04.70  images  a freezer drawer full of sliced bread   (on l07 body: "so the freezer is your best friend.")

Estimated from the plan (the format's guidelines, not quotas)
  WARN  Length                                       7.77  target 40-80 s  (ideal ~63 s)
  pass  Speech rate                                208.58  target 160-270 wpm  (27 words)
  pass  Longest pause in speech                       0.2  target <= 1 s
  ...
```

A kept line's timecode is where it starts in the cut; a cut line's (in brackets) is where the cut lands. The estimates cover length, speech rate and pauses (from the transcripts, through the planned cut), images per minute or plate changes (a visual to source counts), first image and the title hook.

`shred build <draftId>`: the kept lines' speaker clips back to back on Speaker (their own audio kept, its source window following the video's), each visual with an asset on its track at its frames, on-screen text, a marker per kept line (`<role>: <first words>`) and a red `to source (<track>): <description>` marker per placeholder, listed in the output.

### Story (Vlog, 10 Shot)

Story first: the request, then the arc, then the beats.

```json
{
  "schemaVersion": 3,
  "mode": "story",
  "fps": 30,
  "durationFrames": 420,
  "request": "the user's ask, in their words",
  "story": {
    "arc": "One or two sentences: the order of the video and why.",
    "structure": ["hook", "body", "close"]
  },
  "sources": [
    { "mediaId": "", "asset": "", "interval": [0, 0], "content": "", "why": "", "unviewed": false }
  ],
  "beats": [
    {
      "id": "b01",
      "role": "hook",
      "edit": [0, 45],
      "source": { "mediaId": "", "in": 1.2, "unit": "s" },
      "takeaway": "",
      "why": "",
      "treatment": "",
      "sound": "",
      "text": { "text": "Five colours, one street", "role": "title", "edit": [0, 90] },
      "track": "shots"
    }
  ]
}
```

- Each beat's `role` is required. A hook beat starts at frame 0.
- `edit` is `[start, end)` in timeline frames (end exclusive), as is `text.edit`.
- `source`: `mediaId` once imported (or `asset`, a file in a catalog: fine for `shred plan`, but import it before `shred build`). `in` is where the beat's clip starts in its source; `unit` says what it counts: `"s"` (seconds, as your catalog notes are) or `"frames"` (frames at the plan's fps). Stills need no `in`.
- `takeaway`: what becomes clear to the viewer in this beat; if you can't write one, the beat probably shouldn't exist. `why`: why this beat is here and in this order. Missing either is a warning.
- `text` (optional): a string, or `{ text, role, edit?, style? }`. `role` is `title` (the default on the hook) or `labels` (elsewhere); `edit` defaults to the beat's frames, so a title can hold across several beats; `style` names a text style, else `kit:title` / `kit:overlay`, else a project style of that role.
- `track` (optional): a format track's name or role. Without it the beat goes where its media's category puts it in the format (a speaker clip on Speaker, b-roll on Shots or Images...).
- `gapBefore: true` marks an intended gap before a beat (no picture); other gaps are warnings.
- Beats on one track can't overlap (an error); beats on different tracks can. The beats should end at `durationFrames`, near the brief's `duration_target_seconds` (warnings).

`shred plan <id>` prints the beat sheet, the format's targets estimated from the plan (guidelines, not quotas), errors and warnings, and writes `agent/plan.state.json` (`file`, `hash`, `validatedAt`, `schemaVersion`, `errors`, `warnings`). Example:

```
Plan  <workspace>/projects/<id>/agent/plan.json  (sha256:67749d691ac6…)
v3, 30 fps, 400 frames (13.33 s), 10 beats, 10 Shot
Ask    Cut the five colour clips into a 10 Shot of the street, about 13 seconds
Arc    Open on calm blue, climb through green, yellow and orange to red, hold the heat, then come back down to blue: a there-and-back that bookends.
Story  hook → body → close   (10 Shot: Hook shot → Premise setup? → Montage body → Premise payoff? → Ending)

b01   0:00.00-0:01.60  [0-48]      hook   shots    5-blue.mp4 @ 0.50 s
      takeaway  A calm blue street, then the heat
      why       Calmest, widest frame first so the climb reads
      text      title "Five colours, one street" 0:00.00-0:03.00
...

Estimated from the plan (the format's guidelines, not quotas)
  pass  Title hook from 0 s                           yes  target required  (Five colours, one street)
  pass  Length                                      13.33  target 13-15 s
  WARN  Shots                                          10  target 12-16 count  (10 shots; VDB: 8 to 15)
  ...

Valid. sha256:67749d691ac6… recorded in <workspace>/projects/<id>/agent/plan.state.json.
Next: shred draft <id> --label "...", then shred build <draftId>.
```

### From an edit template

`shred plan <id> --template <name> [speaker mediaId...] [--request "..."]` scaffolds the plan from an edit template (`shred template show <name>`; references/engine.md, Edit templates) into `agent/plan.json`, or `agent/plan.scaffold.json` when a plan exists, and records the template on the project (`agent/template.json`) for `shred check`'s Template section. The plan carries where it came from:

```json
"template": { "name": "kathrinmormann-44870", "hash": "sha256:…", "source": { "type": "vdb", "videoId": 44870, "url": "…" } }
```

- **Story (Vlog, 10 Shot):** one beat per shot slot at the slot's frames, `track` from the slot's role in the format, `slot` (the slot id) and `targetSeconds` (its length on the reference), a candidate `source` from the project's media by category (speaker slots: speaker media; images and screen: graphics, overlays, then b-roll; b-roll and shots: b-roll), walking through a clip so repeats take a fresh in-point. A beat with no candidate has an empty `source` and fails validation until you fill it. Text slots become beat `text` (the pattern, e.g. the hook template; the kit style when the project has a kit).
- **Performance (Graphic Yap, Greenscreen):** the speaker's lines from their transcript, exactly as `--scaffold` makes them (the project's speaker media by default). The template's cutaway shots and graphics become `visuals` (`toSource` its description, a candidate `asset` by category, a `note` naming the slot) on the kept line at the same share of the runtime, never overlapping on a track; the title hook goes on the hook line's `onScreen` held about as long as the reference's; list items and labels go on the lines at their share of the runtime.
- `request` is `--request` (else a placeholder to replace) and `story.arc` the reference's outline. Everything is a starting point: review every beat or line, replace the `[PLACEHOLDERS]`, check every candidate, then `shred plan`.
- Beats may carry `slot` and `targetSeconds` in any plan; `shred plan` prints them. The reference timings are targets: change any beat to fit the footage.

### Check

`shred check` adds a **Plan** section when the project has one. Story: beats whose clip is no longer on its planned frames (with where it plays now), beats out of order on their track, length drift. Performance: kept lines no longer on the timeline (a line counts as there when a clip of its media plays most of its source), kept lines now in a different order, cut lines that are back in (a warning; info for a pause or dead air), length drift. Warnings and info only: the user's tweaks are decisions. Update the plan (and run `shred plan`) when the story itself changes.

## summary.md (for `shred publish --summary`)

```markdown
What this pass does: <one or two sentences>

Changes
- <beat or element>: <what and why>

Look at
- 0:02:16 <what to check there>

Checks
- Visual: <frames rendered and opened>
- Audio: <listened / measured / not checked>

Placeholder or open
- <anything not final>
```
