<!--
  Vendored from the ai-video-editor plugin: skills/ten-shot/SKILL.md
  source-sha256: sha256:d054b8f1dbe59e54e642b2911833912d88a0c559ff41e098d4862f5f670eed18
  Do not edit here. Change the plugin, then run: npm run formats:sync
-->

---
name: ten-shot
description: Edit a 10 Shot (VideoDatabase format) - a short music-driven montage of about 12-16 distinct clips with fast cuts, one dominant text overlay, and nobody talking. Use when the user says "10 shot" or "ten shot", or hands over b-roll of a place, product, or experience for a quick-cut reel. Load ai-video-editor first for preflight and the shared processes.
---

# 10 Shot

VDB: "A short music driven vlog using 6-15 clips with fast paced cuts, audio that sets the mood, and a dominant text overlay that delivers the message. ... It never features the subject talking."

Targets are set by the top 5 10 Shots by views (3.4M–12.2M); ranges include a further 10 mid-performers. Unmarked numbers are measured; "VDB" marks VDB's stated rules. Five videos is a small sample; treat targets as starting points. Evidence and per-video data: [references/vdb-research.md](references/vdb-research.md). Look (fonts, colors, grade) comes from the style kit.

## Targets

| | Target | Range seen |
|---|---|---|
| Length | 13–15 s | 8.3–29 s |
| Shots | 12–16 | 7–24 (VDB: 8–15) |
| Shot length | ~1 s median | 0.2–3.7 s |
| Cuts per minute | ~31–38, or ~70 after a pivot | 25–137 |
| Text overlays | title + 0–2 labels | 0–7 |
| Graphics | none | 0–1 |
| Speech | none | none in 10/10 |

9:16 vertical short form, 1080×1920, for Reels and TikTok.

## Structure

1. **Hook shot, 0 to ~1–3 s.** Open on the hero image (the widest, most striking frame) with the title on it from frame 0. Holding the opener longer than the rest (1.5× the median shot) is common.
2. **Montage body.** One continuous run, or 2–4 short topical blocks for a tour or list (living → kitchen → baths).
3. **Ending.** Either a closing hold (last shot 1.1–2.6× the median, on a summary image: view, embrace, full flat lay, the quirkiest feature) or end at full speed on a beat. Top 5 split 2 hold / 2 full speed.

**Premise build (optional).** All top 5 run a setup → payoff premise (empty warehouse → finished studio, AI vs human). Pattern in 2/5: setup shots at 1–1.5 s, then after the turn an even grid of 0.5–0.6 s shots (~70 cuts/min).

Place and building order: establishing wide → anchor space or feature → functional spaces → details → the most distinctive thing last.

## Cuts

- Hard cuts only (~94% in the sample). No wipes, zooms, or speed ramps.
- Cut on the music. Pick one rhythm per video:
  - **Even grid:** every shot about the same length (vibe content, 0.4–0.7 s or 0.9–1.4 s).
  - **Beat / double-beat:** shots alternate between one and two beats (tours).
  - **Shaped:** long opener, faster middle, slower end (travel).
- Fast vibe and product montages sit around 0.3–0.9 s per shot. Travel, place, and street style sit around 1.2–2.1 s.
- Match-cut jump cuts are allowed as a deliberate trick (prop swaps), not as filler.

## Shot selection

- Every shot is a new subject or a new angle. VDB: at least 6–8 visually distinct moments. Fast cutting exposes repeats.
- Mix framings by default. One framing can work when every shot shows something new (an 8.2M video is 16/16 medium static in one room); the weakest mid sample video repeated framing and subject.
- Keep camera movement consistent within the video: all static, or all gliding.
- The creator can appear but never speaks to camera.
- Grade consistently across shots.

## Text

- One title, 5–7 words (range 3–10), declarative, POV, or premise ("how it felt waking up to rain today").
- Middle of frame (8/10 mid sample), from 0 s.
- Default: take it down on the cut where the first section changes (1.9–4.8 s in 4/5 top videos). Holding it all video is the alternative; the style kit can lock it.
- 0–2 labels after the title are fine (3/5 top videos use them, e.g. naming the two sides of a comparison).
- Optional build-on: one word per shot over the first 3–4 shots.
- Listicle or product: one label per item (1.9–3.4 s each). Otherwise no other text.
- No captions.

## Audio

- Music only, in the foreground, mood-setting. No VO, no sync sound, no SFX.
- Choose the track before cutting. Mark beats on the waveform and cut to them.

## Avoid

- The same subject shown 3+ times.
- Fewer than 8 shots (the one 7-shot top video likely has missed cuts in its analysis).
- Talking to camera (that's a different format).

## Per-edit references

Pull 2–3 references: `search_videos` with `filters.format: "10 Shot"` plus the subject. See ai-video-editor `references/formats.md`.
