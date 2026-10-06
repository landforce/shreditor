<!--
  Vendored from the ai-video-editor plugin: skills/vlog/SKILL.md
  source-sha256: sha256:2af3b1f236cbbbc0c3b8de29850fa74079f57cf859ea8a33e84c83ade32147dc
  Do not edit here. Change the plugin, then run: npm run formats:sync
-->

---
name: vlog
description: Edit a Vlog (VideoDatabase format) - voiceover narrating over b-roll, opened by an extremely strong text hook. Covers fast process/listicle vlogs and slower walk-through/update vlogs. Use when the user asks to cut, caption, or finish a vlog, recipe, build update, day-in-the-life, or process video with voiceover. Load ai-video-editor first for preflight and the shared processes.
---

# Vlog

VDB: "a documentary-style short-form video format that blends on-camera presence, B-roll footage, and voiceover narration to create personal yet polished storytelling." What the viewer hears and what they see are different layers; "the gap between audio and visual is where the storytelling lives."

**A Vlog always has voiceover.** VO narrates over b-roll for nearly the whole runtime. Music-only montages are a 10 Shot. Live dialogue, POV, and reaction videos are out of scope for this skill.

Evidence: 11 VO vlogs with VDB timed analysis (235k–3.4M views, median ~950k), plus Colin's rules. The biggest VO vlogs (10M–50M) have no timed analysis yet, and 5 of the 11 are food. Unmarked numbers are measured. Per-video data: [references/vdb-research.md](references/vdb-research.md) ("VO vlogs (expanded sample)"). Look comes from the style kit.

9:16 vertical short form, 1080×1920, for Reels and TikTok.

## Pick the pace

Two kinds, with nothing in between (no video cut at 26–41 cuts per minute):

| | Fast: process, recipe, listicle, essay | Slow: walk-through, build update, showcase |
|---|---|---|
| Length | ~65 s | ~95 s |
| Shots | ~60 | ~33 |
| Median shot | ~0.9 s | ~2 s |
| Cuts per minute | ~53 | ~24 |
| Longest shot | ~3.7 s | ~7.5 s, the reveal or wrap-up |
| Final shot | ~1.8 s | ~7.5 s, the reveal |

Pooled ranges: length 41–178 s, shots 19–109, cuts per minute 11–63, longest shot 2.3–16 s.

## Structure

1. **Hook, 0 to ~3 s.**
   - **Text hook on screen from frame 0** (see Text). This is the most important element of the video.
   - VO starts by 0.25 s. The opening line ends around 3 s.
   - First cut by ~1.5 s.
   - Open on the payoff (finished result) or on the subject being presented.
2. **Body.** VO carries the story; picture shows exactly what's being said.
   - Fast: one action per shot, 0.3–1.2 s each (pinch salt → drop in jar → lid on → tighten).
   - Slow: let each space or step hold ~2 s; walk the viewer through.
3. **Payoff.** The finished result or reveal, held longest.
4. **End.** Held reveal, bookend callback, or part-two tease. Spoken CTA optional.

## Text

- **Every vlog gets a text title hook**, separate from the captions. Captions and voiceover never replace it.
- **Extremely strong text hook, always.** On screen from frame 0, large, sized from the style kit. It has to stop the scroll on its own with the sound off: a specific claim, stake, or payoff, not a label ("Day 3 vlog" is a label).
- Write 3–5 hook options and pick the strongest before editing. Content Tools' hook tools or VideoDatabase `generate_hooks` can supply options.
- Hold it through the opening VO line (~3–5 s).
- After the hook, keep other text rare: an occasional label on a reveal shot at most.

## Captions

- Burn in captions over the VO for the full runtime (8/11).
- From the Whisper transcript, checked against the audio.
- Position: see ai-video-editor `references/edit.md` (Captions).

## Cuts

- Hard cuts. Jump cuts inside a process step are fine. No dissolves or whips.
- Cut on VO phrases: the picture changes when the line names something new.
- Talking to camera is rare (0% of runtime in most). Use it only if the footage has it and it earns its place.

## Audio

- VO: ~213 wpm (152–244), wall to wall, covering ~98% of runtime. No pause longer than ~0.5 s. Cut breaths and gaps.
- Music bed under the VO (10/11), never foreground.
- SFX sparingly (4/11), on actions that make a sound.
- No graphics in the sample; the b-roll is the visual.

## Avoid

- A weak or generic text hook.
- Long stretches where the picture doesn't match what the VO is saying.
- Pauses and breaths left in the VO.
- Music fighting the voice.

## Per-edit references

Pull 2–3 VO vlogs at the same pace: `search_videos` with `filters.format: "Vlog"` plus the subject. See ai-video-editor `references/formats.md`.
