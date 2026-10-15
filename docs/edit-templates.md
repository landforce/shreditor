# Edit templates

An edit template is the timed structure of a proven video, made reusable: "cut my footage like this VideoDatabase video" or "recut last week's 10 Shot with this new footage". The agent fills it with the user's footage.

## What a template is

Structure plus targets, never mandatory timings. VideoDatabase timings are AI-labeled and not frame-accurate, and its own guidance is not to treat reference timing as mandatory for new clips. So the new cut follows its own footage and speech, and `shred check` reports how close it lands to the reference. Nothing is forced to the reference's frames.

A template file (`<workspace>/app/edit-templates/<name>.json`, next to the text style and motion template libraries) holds:

- `source`: a VideoDatabase video (id, url, platform url, creator, the input it came from) or a Shreditor project id.
- `format`: the Shreditor format and variant it suggests, with a reason. The reference's own format wins when it is one of the four. Otherwise the shot mix decides: the speaker on screen 30% or more is Graphic Yap (Greenscreen when keyed), less is Vlog, and nobody talking is 10 Shot. The variant comes from images per minute, cuts per minute or shot rhythm.
- `canvas` and `durationSec`. VideoDatabase doesn't carry a canvas, so 9:16 at 1080x1920 @30 is assumed and marked as such.
- `pacing`: what the scorecard compares against. It is measured from the slots (so the JSON and Markdown inputs agree), and the source's own numbers are kept under `reported`.
- `slots`, in time order:
  - Shots carry a role (speaker, images, screen, broll or shots), a target length, the boundary, framing and speech.
  - Texts carry a role and kit style, a pattern (the hook template, or `1. [POINT]`), the reference text, and an anchor to the shot they start in.
  - Graphics are anchored the same way.
  - Audio slots come from projects only.
- `captions` (on, off or a span) and the `outline` (beats, hook, framework) when the source has them.

`formats/edit-template/` holds the model as pure modules shared by the CLI and the tests:

- `vdb.mjs`: both VideoDatabase inputs.
- `project.mjs`: templates from a project.
- `roles.mjs`: roles and the format suggestion.
- `measure.mjs`: a timeline measured like a VDB edit timeline.
- `scaffold.mjs`: plans from a template.
- `score.mjs`: the check section.

## Why a template guides the plan instead of building

The plan (`agent/plan.json`) is already the one source of truth for a first assembly. It is validated by `shred plan`, required by `shred draft` and built by `shred build`. A template that built clips on its own would be a second build path. It would skip plan review, the plan section of `shred check`, and the performance logic that keeps a speaker's lines intact. So `shred plan <id> --template <name>` writes an ordinary plan and records the template on the project (`agent/template.json`). From there everything is the usual loop.

For a speaker format, the plan stays the speaker's performance, taken from their transcript. The template contributes the cutaways, graphics, title and list items, placed on the kept lines at the same share of the runtime. Copying the reference's 27 shot boundaries onto different speech would cut words in half.

## Whole-project reuse

`shred new --from-template` is the one place a template creates timeline items. A project-derived template is its own reference, so its structure is the point. Even then it goes through ordinary edit ops in one batch: `addTrack`, `upsertTextStyle`, `addClip` and `updateItem` for each slot, and `addText`. Every clip keeps playing its original media as a placeholder.

`shred template fill` swaps media in with the `replaceMedia` op, added for this. The op keeps the item's id, place, length, speed, transform and effects, and fits the source window to the slot. Media too short for the slot is refused rather than silently shortening the cut. `updateItem` couldn't do this safely: the service only passes media metadata and readiness for ops that place media, and a video's own audio has to follow it in the same step.

## Inputs

- `get_video_dna` with `format: "json"`, saved by the agent (the shred CLI can't call the account-authenticated MCP) under `<project>/agent/reference/vdb-<id>.json`. The full response or its `data` both work.
- The Video DNA Markdown download. It has the Edit Timeline tables (Shots, Graphics, On-screen Text, Captions) with `mm:ss.mmm` times. It has no shot type, so the type is inferred from the description ("Photo:", "Screen recording:"), the framing and the speech. It also has no hook template or outline. Its slots are the same as the JSON's apart from the title's pattern.

## Limits

- Effects, keyframes, transitions and captions are not rebuilt by `new --from-template`. Captions come from the new speech, so add them after filling.
- The proportional placement on a performance plan is a starting point. Visuals that don't fit on a line move to the next line or are listed as left out.
- Candidate media is chosen by category only. Every candidate needs checking.
