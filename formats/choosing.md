<!--
  Vendored from the ai-video-editor plugin: skills/ai-video-editor/references/formats.md
  source-sha256: sha256:b10ca596a0d5547dc6409fb6dd93a73bdcb5abf2730e60f65db9003c276f702e
  Do not edit here. Change the plugin, then run: npm run formats:sync
-->

# Formats

Every edit starts by naming its format. Formats come from VideoDatabase's catalog (https://videodatabase.io/formats). A format is the production style: how it's shot and cut. It is separate from topic (what it's about) and concept (the creative strategy).

The format sets the pacing, cuts, graphics, text, and audio rules for the edit. The style kit sets how those things look.

All format skills are 9:16 vertical short form (1080×1920, Reels and TikTok).

## 1. Choose the format

This is the first decision on every edit. Nothing gets cut until the format is agreed.

If the user named one, use it. If the footage doesn't fit it, say so before editing.

Otherwise, look at the footage and audio first, then pick by what carries the video:

| What's there | Format |
|---|---|
| Clips of a place, thing, or experience. Nobody talking. Music. | **10 Shot** |
| B-roll with voiceover narrating over it (recorded, or the user will record it) | **Vlog** |
| Talking head shot on a green screen, or meant to be keyed | **Greenscreen Talking Head** |
| Talking head in a real setting, naming things that can be shown as images | **Graphic Yap** |

Tie-breakers:

- Talking head, and the points are things to show: green screen footage → Greenscreen; real setting → Graphic Yap.
- B-roll plus a talking head: if the voice runs over the b-roll most of the time, it's a Vlog.
- B-roll with no voice and no plan for one: 10 Shot.
- Fits none of the four: name the closest VDB format from the catalog below and say there's no skill for it yet.

Propose one format with a one-line reason drawn from the footage, and get the user's yes before planning the edit.

## 2. Load the spec

| VDB format | Skill |
|---|---|
| 10 Shot | `ten-shot` |
| Vlog | `vlog` |
| Greenscreen Talking Head | `greenscreen` |
| Graphic Yap | `graphic-yap` |

Any other VDB format: no skill yet. Build the spec for this edit with step 3, save it in the project as `format-spec.md`, and follow it.

## 3. Pull references for this edit

The format skill gives the general rules. References tune them to this video.

1. `search_videos` with `filters.format` set to the exact VDB format name, plus the topic or subject as the query. Sort by `outlier_score` or `views`.
2. Pick 2–3 that match the user's footage and goal, ideally with timed editing analysis available.
3. `get_video` with `include_editing_analysis: true` for shot list, cut timings, text and graphics. Use `generate_editing_brief` when a reusable template would help; it uses the account's AI budget, so ask first.
4. Write what this edit borrows from them in `plan.md`: shot count, pacing, hook, text and graphics density. Reference timing is a guide, not a timing to copy.

## 4. Catalog

All VDB formats, with VDB's one-line definitions:

| Format | Definition |
|---|---|
| 10 Shot | A short music driven vlog using 6-15 clips with fast paced cuts |
| Carousel | Photos or slides often with text overlays and titles edited on top |
| Cinematic Trailer | Rapid montage of high-production value, visually dramatic clips |
| Clip | Repurposed podcast clip or conversation cut and edited down to condense it |
| Faceless | Uses stock footage and/or graphics, titles, and animations |
| Graphic Yap | Raw, phone-shot talking-head video in real setting where speaker stays put |
| Greenscreen Talking Head | Speaker addressing camera layered on changing background images |
| Interview Q&A | Structured as question-and-answer session between two individuals |
| One Shot | Single shot or 2-5 similar shots with dominant text overlay |
| Performance Highlight | Single, often continuous shot focused on subject demonstrating skill |
| Prop Yap | Raw, phone-shot talking-head built around physical prop or setting |
| Quick Hit | Variety of clips that doesn't fit other formats |
| Screen Recording | Direct screen capture to demonstrate a process |
| Single Photo | Single static image or graphic |
| Single Take | Single, continuous shot with no cuts, focusing on central subject |
| Skit | Scripted/scene/skit style |
| Speaker Address | Speaker addressing camera in clips/scenes to share insight or process |
| Split Screen | Speaker occupies one portion, providing commentary to visual element |
| Street Interview | Host interviewing random person in public setting |
| Talking Head Edit | Professionally produced speaker in real, physical environment |
| Timelapse | Static camera shot recording scene over extended period |
| Vlog | Blends personal, process-oriented, and subject-focused shots into cohesive narrative (this toolkit: always voiceover) |
| Yap | Raw talking head shot on subject's phone using real-life environment |
