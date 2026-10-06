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

The first edit of every project is built from this file (`shred plan` validates it, `shred draft` refuses a first pass until it validated clean, `shred build` turns it into the first assembly). Write it story first: the request, then the arc, then the beats.

```json
{
  "schemaVersion": 2,
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

- `request`, `story.arc` and each beat's `role` are required (a plan without them doesn't validate). `story.structure` lists the roles you use, in order; roles come from the format's structure (`shred format <id>`): Graphic Yap hook, body, close; Greenscreen hook, setup, body, close; Vlog hook, body, payoff, close (the guide's End, optional); 10 Shot hook, body, close, with an optional setup and payoff for a premise build. A hook beat starts at frame 0.
- `fps` is the project's. `edit` is `[start, end)` in timeline frames (end exclusive), as is `text.edit`.
- `source`: `mediaId` once imported (or `asset`, a file in a catalog: fine for `shred plan`, but import it before `shred build`). `in` is where the beat's clip starts in its source; `unit` says what it counts: `"s"` (seconds, as your catalog notes are) or `"frames"` (frames at the plan's fps). Stills need no `in`.
- `takeaway`: what becomes clear to the viewer in this beat; if you can't write one, the beat probably shouldn't exist. `why`: why this beat is here and in this order. Missing either is a warning.
- `text` (optional): a string, or `{ text, role, edit?, style? }`. `role` is `title` (the default on the hook) or `labels` (elsewhere); `edit` defaults to the beat's frames, so a title can hold across several beats; `style` names a text style, else `kit:title` / `kit:overlay`, else a project style of that role.
- `track` (optional): a format track's name or role. Without it the beat goes where its media's category puts it in the format (a speaker clip on Speaker, b-roll on Shots or Images...).
- `gapBefore: true` marks an intended gap before a beat (no picture); other gaps are warnings.
- Beats on one track can't overlap (an error); beats on different tracks can (Graphic Yap images over the speaker). The beats should end at `durationFrames`, near the brief's `duration_target_seconds` (warnings).

**v1** plans (no `schemaVersion`, no `role` or `why`, `source.in` in frames) are still read and printed by `shred plan`, but don't validate: rewrite them as v2 before building.

`shred plan <id>` prints the beat sheet, the format's targets estimated from the plan (guidelines, not quotas), errors and warnings, and writes `agent/plan.state.json` (`file`, `hash`, `validatedAt`, `errors`, `warnings`). Example:

```
Plan  <workspace>/projects/<id>/agent/plan.json  (sha256:3f1c0a9e2b…)
v2, 30 fps, 300 frames (10.00 s), 10 beats, 10 Shot
Ask    Ten seconds of the colours of the street
Arc    Open on the brightest wall, run warm to cool, end on the calm blue.
Story  hook → body → close   (10 Shot: Hook shot → Premise setup? → Montage body → Premise payoff? → Ending)

b01   0:00.00-0:01.50  [0-45]  hook   shots    red.mp4 @ 0.50 s
      takeaway  The street is loud with colour
      why       Brightest, widest frame first: it stops the scroll
      text      title "Five colours, one street" 0:00.00-0:03.00
...
Estimated from the plan (the format's guidelines, not quotas)
  pass  Title hook from 0 s                           yes  target required
  WARN  Shots                                          10  target 12-16
```

`shred check` adds a **Plan** section when the project has one: beats whose clip is no longer on its planned frames (with where it plays now), beats out of order on their track, and length drift. Warnings and info only: the user's tweaks are decisions. Update the plan (and run `shred plan`) when the story itself changes.

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
