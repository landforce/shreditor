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
format: ""             # e.g. VO vlog, talking-head yap, 10 shot
assets: []             # paths or media ids, with a word on each
must_keep: []          # lines, shots or moments that stay
audio_intent: ""       # VO only, music bed, source sound...
review: { plan: false } # true = show the plan before building
execution: autonomous  # or assisted (pause at each pass)
constraints: []
decisions:             # every material decision and where it came from
  - what: ""
    origin: user | accepted | reference | assumption
```

## plan.json

```json
{
  "fps": 30,
  "durationFrames": 0,
  "sources": [
    { "asset": "", "interval": [0, 0], "content": "", "why": "", "unviewed": false }
  ],
  "beats": [
    {
      "id": "b01",
      "edit": [0, 76],
      "source": { "asset": "", "in": 0 },
      "takeaway": "",
      "treatment": "",
      "sound": "",
      "text": null
    }
  ]
}
```

`edit` and `source.in` are frames at the project fps. `takeaway` is what becomes clear to the viewer in this beat; if you can't write one, the beat probably shouldn't exist.

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
