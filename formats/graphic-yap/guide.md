<!--
  Vendored from the ai-video-editor plugin: skills/graphic-yap/SKILL.md
  source-sha256: sha256:7023650993d81abfdf579b421de12f05f534332e1d4e5b4e70b10f599383e76a
  Do not edit here. Change the plugin, then run: npm run formats:sync
-->

---
name: graphic-yap
description: Edit a Graphic Yap (VideoDatabase format) - a speaker in a real setting, silences cut, with a steady stream of simple images or graphics placed above, beside, or over the speaker. Use when the user asks for a graphic yap or a talking-head edit with images overlaid. Load ai-video-editor first for preflight and the shared processes.
---

# Graphic Yap

VDB: "a raw, phone-shot talking-head video with a steady stream of image overlays placed above, beside or over the speaker." Goal: "to keep the screen changing." "The speaker brings the personality and the graphics show what's being said."

**It's just a speaker with simple images or graphics going over them.** Not Greenscreen: the speaker stays in their real setting; nothing is keyed. Not Yap: overlays are constant, not occasional.

Evidence: 4 of the top 5 Graphic Yaps by views (3.75M–25.7M; the 5th isn't in VDB yet) plus 10 mid-performers. Unmarked numbers are measured; "VDB" marks VDB's stated rules. Two top videos are one creator and two overlap the mid sample, so treat targets as starting points. Evidence: [references/vdb-research.md](references/vdb-research.md). Look comes from the style kit.

## Targets

| | Target | Range seen |
|---|---|---|
| Length | 40–80 s (median ~63 s) | 28–116 s |
| Images | 17–27 per minute, more is better | 5–27 per minute |
| Each image on screen | ~1.2–2.4 s, sub-1 s bursts OK | 1–10 s |
| Gap between image starts | ~1.3–2.4 s (VDB: "every second or two") | 1.2–10 s |
| First image | by 2 s (VDB) | 0–11 s |
| Longest stretch with no image | under ~5 s | 5–35 s |
| Speech rate | 160–270 wpm | |

9:16 vertical short form, 1080×1920, for Reels and TikTok.

## Structure

1. **Hook, 0 to ~6 s.** Speech from 0 s, no silent open. One declarative claim. First image by 2 s. **Always a large title hook** on screen from 0 s, top or middle, sized from the style kit, held ~3 s through the spoken hook, or all video for a running premise or list.
2. **Body.** One image per point, and more wherever the line names something. Lists loop: name item → show image → comment.
3. **Close.** Summary line, verbal CTA, or a gag/payoff shot. Keep images coming until the last line. No end card.

## Cuts

- One continuous take with images doing the changing, or jump cuts between lines. Both are common.
- In talking-only sections, cut every silence: no pause over ~1 s. Pauses during an activity (a golf swing) can run 2–4 s.
- Jump cuts and graphic swaps only. No transitions.
- Cut and swap on phrase ends, not on a beat.
- Bursts of rapid swaps (under 1 s each) are fine for a run of quick names or logos.

## Speaker

- Any setup: phone or camera, any mic, any real location (room, desk, car, outdoors).
- Medium or close-up.

## Images

An image for every noun.

**Placement:** full bleed, over most of the speaker, or above the speaker. The style kit and the footage's framing decide which. **Pick one and keep it consistent for the whole video.**

Two paces:

| | Standard | Intense |
|---|---|---|
| Rate | ~17–22 images per minute | ~27 images per minute, ~43 changes per minute |
| Text | Title hook | Title hook plus large punch lines on the speaker shots |

Intense example (full-bleed placement): orenmeetsworld "Gear Acquisition Syndrome" (VDB 39179; VDB files it as Talking Head Edit, and logs its images as camera shots). 57 changes in 80 s, first image at 1.25 s. Product shots on white for each brand named, editorial photos for each scene, two products stacked when two are named together. Large serif punch lines frame the head on speaker shots ("HE HAS SPENT $1100 / AND RAN 0 MILES").

- Simple images or graphics. No motion-graphics scenes or video insets.
- The more the better. Every noun worth showing gets an image: the place, person, product, headline, stat, comment.
- Each image is a literal illustration of what was just said.
- Types: photos, screenshots (articles, headlines, comments, analytics, posts), cutouts, stickers/memes.
- Evidence runs: back a claim with a rapid run of 1–2 s images (five headlines in 8.5 s, four cards in 6 s).
- Lists can stack items and keep them up to the end.
- Sourcing: real things from Google search, concepts and cutouts from ChatGPT (ai-video-editor `references/graphics.md`). Placement and motion from the style kit.

## Text and captions

- Captions follow the user's style kit: whether to use them, their style, and how they share the screen with punch lines. Placement rules: ai-video-editor `references/edit.md` (Captions).

## Audio

- Voice first. No music, or a quiet background bed. Never foreground music. SFX rare.

## Avoid

- First image later than ~2 s.
- Any stretch over ~5 s with no new image.
- One image held long while the speaker moves on to new points.
- Uncut silences and missed cuts.

## Per-edit references

Pull 2–3 references: `search_videos` with `filters.format: "Graphic Yap"` plus the subject. See ai-video-editor `references/formats.md`.
