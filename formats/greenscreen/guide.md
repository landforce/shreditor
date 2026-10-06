<!--
  Vendored from the ai-video-editor plugin: skills/greenscreen/SKILL.md
  source-sha256: sha256:fa60abd01af93c2da94dc84b8d1fc32fe47a397021cd96118bcd3a0e45253dc3
  Do not edit here. Change the plugin, then run: npm run formats:sync
-->

---
name: greenscreen
description: Edit a Greenscreen Talking Head (VideoDatabase format) - the creator keyed over full-frame backgrounds that change to show exactly what they're talking about. Use when the user asks for a greenscreen edit or has talking-head footage to put over images, screenshots, DMs, or articles. Load ai-video-editor first for preflight and the shared processes.
---

# Greenscreen Talking Head

VDB: "A speaker addressing the camera in one or many clips layered on top of changing background images or videos that illustrate their points, with both the speaker and background visible simultaneously. The backgrounds change like presentation slides to match the narration."

Boundary (VDB): background changes behind a keyed speaker → Greenscreen. Cutaways to b-roll or polished motion graphics → Talking Head Edit. Only occasional overlays → Yap. The line is blurry: all of the top 5 were first classified as Yap or Graphic Yap by VDB.

Evidence: 4 of the top 5 by views (1.7M–8.0M; grillguy excluded as a bad example) plus 10 mid-performers, all with VDB timed analysis, plus Colin's rules. Unmarked numbers are measured. Per-video data: [references/vdb-research.md](references/vdb-research.md). Look comes from the style kit.

## Targets

| | Target | Range seen |
|---|---|---|
| Length | 20–65 s (top median ~45 s) | 19–176 s |
| Background (plate) changes | 8 per minute | 2–38 per minute |
| All visual changes (plates + jump cuts + reframes) | ~16–18 per minute | |
| Median gap between changes | ~2.6–3 s | |
| Speech rate | ~225 wpm | 198–265 |
| Share of runtime on greenscreen | 100% | 31–100% |

9:16 vertical short form, 1080×1920, for Reels and TikTok.

## Structure

1. **Hook, 0 to ~3.5 s.** One spoken claim, 7–19 words: superlative, curiosity, question, or "look at this". The first plate is the most visually dense or emotional one in the piece. **Always a large title hook** on screen from 0 s, top or middle, sized from the style kit. It leaves with the hook plate.
   **Always change the background when the hook ends, by ~3 s.**
2. **Setup.** Ends around 9–17 s.
3. **Body.** A list (one item per run of plates) or a story (incident → evidence → context → corroboration).
4. **Close.** A line spoken straight to the audience or the commenters (4/5 top), or the thesis line. CTA optional (0/5 top, 5/10 mid). No end card.

Stay on the greenscreen the whole video. No real-room talking-head sections.

## The background is the edit

- First plate at 0 s.
- New background for every beat or point. The plate is the literal thing being named: "look at this", "these DMs". Swap on clause or sentence ends.
- Plate types: the creator's own DMs, comments and screen recordings; photos of the subject; screenshots of articles, posts, app listings; charts; personal photos; text cards; artwork; collages.
- Real images: Google search. Concepts: ChatGPT. See ai-video-editor `references/graphics.md`.
- Reuse a plate when its subject comes back.
- Information lives inside the plate (the DM, the article excerpt) rather than as extra text layers.
- Keep the screen changing between plate swaps with jump cuts and reframes of the speaker.

## Speaker

- Keyed, static camera, close-up by default (5/5 top).
- Shrink and push the speaker to a corner when the plate needs to read (3/5 top). Reframe mid-video freely.
- Point at the plate (4/5 top).
- Hard cuts and instant swaps. No transitions.

## Text and captions

- The large title hook is the only text layer.
- Captions in 13/15 across both samples. Position: see ai-video-editor `references/edit.md` (Captions). Also keep them clear of the plate's key content.

## Audio

- Sync voice wall to wall. Cut every pause over ~0.5 s.
- No music. No SFX. Voice only.

## Avoid

- Interchangeable photos of the same person instead of the specific thing each line is about.
- Holding the hook plate past ~3 s.
- Long stretches with no visual change of any kind (plate, jump cut, or reframe).

## Per-edit references

Pull 2–3 references: `search_videos` with `filters.format: "Greenscreen Talking Head"` plus the subject. See ai-video-editor `references/formats.md`.
