<!--
  Vendored from the ai-video-editor plugin: skills/greenscreen/references/vdb-research.md
  source-sha256: sha256:43971e10261d74e65c875f2f3bee676bd1d54a86f01781c3a4b50c7a7b3c2f65
  Do not edit here. Change the plugin, then run: npm run formats:sync
-->

# Greenscreen Talking Head
VDB definition: "Greenscreen talking head videos place the creator on camera against a digital or physical green screen background, letting the visual layer do real work." (https://videodatabase.io/formats/greenscreen-talking-head)

VDB classifier definition, stated in each video's `classification.format.structuralDescription`: "A speaker addressing the camera in one or many clips layered on top of changing background images or videos that illustrate their points, with both the speaker and background visible simultaneously. The backgrounds change like presentation slides to match the narration. If the video primarily uses this low fi Greenscreen effect (even if not 100% of the time), classify it as Greenscreen Talking Head format."

VDB boundary rule, stated in the Graphic Yap definition: "If the background behind a keyed-out speaker changes it is Greenscreen Talking Head; if the video cuts away to B-roll or polished motion graphics it is Talking Head Edit; if overlays are only occasional it is Yap."

VDB characteristics (from the format page; the fetch tool summarized the page, so treat wording other than the definition as near-quote):
- One of the most versatile production formats in short-form video
- Works well for breakdowns, case studies and explainers
- "The background becomes evidence" for the creator's argument
- The creator stays present and authoritative while the visual context does the persuading
- Best when the argument benefits from visual evidence
- Effective where original footage isn't available (history, brand analysis, food science, business strategy)
- The background is a supporting element, "not decoration"
- Visual and verbal layers do different jobs at the same time
- "Background discipline" is what separates credible creators
- 1,481 videos in the database use this format
- Related: Case Study Breakdown, Rapid Fire Listicle, Hot Take

Sample: 10 analyzed videos (timed editing analysis v2/v3), 10 creators. "Shots" means VDB segments: camera cuts plus background swaps.

| VDB id | creator | views | duration | shots | avg shot s | link_markdown |
|---|---|---|---|---|---|---|
| 43614 | shaneohgolfs | 192,273 | 90.4 | 16 | 5.65 | [VDB](https://videodatabase.io/video/43614-sports-drama-story-breakdown) \| [IG](https://www.instagram.com/p/DduFSgzRxqR) |
| 41661 | tylerbenderr | 705,557 | 18.9 | 8 | 2.36 | [VDB](https://videodatabase.io/video/41661-dating-advice-using-greenscreen-backgrou) \| [IG](https://www.instagram.com/p/DdIUX_qukpZ) |
| 39645 | davidkijlstra | 258,605 | 53.9 | 25 | 2.16 | [VDB](https://videodatabase.io/video/39645-greenscreen-review-of-italian-hotel) \| [IG](https://www.instagram.com/p/DcMMJAYtWX5) |
| 37645 | fakeplasticbrands | 538,900 | 70.8 | 52 | 1.36 | [VDB](https://videodatabase.io/video/37645-speedrunning-dark-historical-aesthetics) \| [IG](https://www.instagram.com/p/DbNqH9iOEKu) |
| 37438 | betherewearthat | 198,914 | 48.7 | 11 | 4.43 | [VDB](https://videodatabase.io/video/37438-analyzing-the-viral-water-bottle-trend-c) \| [TT](https://www.tiktok.com/@betherewearthat/video/7660576725184695583) |
| 37430 | maxxingwjett | 843,363 | 36.3 | 8 | 4.54 | [VDB](https://videodatabase.io/video/37430-creator-shares-dating-experiment-data) \| [IG](https://www.instagram.com/p/DbPJvhSMlIh) |
| 41704 | angus.sewell | 426,958 | 58.2 | 26 | 2.24 | [VDB](https://videodatabase.io/video/41704-ai-content-creation-strategy-breakdown) \| [IG](https://www.instagram.com/p/DdB8LT-xC0Y) |
| 43521 | wellcopymax | 194,598 | 36.2 | 6 | 6.03 | [VDB](https://videodatabase.io/video/43521-explains-smart-marketing-upsell-strategy) \| [IG](https://www.instagram.com/p/Ddt306cRi2j) |
| 40034 | maxxrosenblum | 64,918 | 175.6 | 46 | 3.82 | [VDB](https://videodatabase.io/video/40034-investigative-breakdown-of-soccer-scanda) \| [IG](https://www.instagram.com/p/DakAT-8pyc6) |
| 41696 | douggrindstaff | 260,112 | 109.0 | 38 | 2.87 | [VDB](https://videodatabase.io/video/41696-explains-business-history-using-overlays) \| [IG](https://www.instagram.com/p/DdCekZLp25u) |

## Spec (measured)
- **Length:** median 56 s; typical 36–109 s; full range 18.9–175.6 s.
- **Aspect:** not in the analysis data. All sources are IG Reels or TikTok, so 9:16 vertical is assumed, not measured.
- **Structure (beats in order, with typical timing):**
  - **Hook** (0 to about 3.5 s): a title card plus one verbal claim sentence.
  - **Premise or setup:** ends around 9–17 s.
  - **Body:** a list or evidence run.
    - In list videos each item is 10–19 s (37645) or 1.6–6.4 s (37438).
    - In story videos it runs incident, then evidence clip, then context, then corroboration (43614).
  - **Payoff or close:** the last 4–15 s.
  - **Speech:** nearly wall to wall. Speech ratio is 0.98–1.0, longest pause ≤0.46 s, silent opening ≤0.24 s.
- **Hook (first 1-3 s):**
  - **Title card:** 10/10 open with a title-hook card from 0 s.
    - Position: top in 9/10, bottom in 1/10 (a red banner in 43614).
    - On-screen time: median 3.7 s, range 2.8–6.2 s, with one outlier at 11.3 s.
    - In 9/10 the title disappears at the first background change, which lines up with the end of the verbal hook sentence (verbal hook ends at 2.7–4.4 s).
  - **Verbal hook:** one sentence of 8–18 words. It is a superlative or curiosity claim ("one of the most embarrassing…", "best hotel you've never heard of", "smartest upsell I've ever seen") or a question.
  - **Hook background:** the most visually dense or emotional image in the piece. Examples: a celebrity photo of a confrontation, an aerial shot, a grid of products, a DM inbox, a collage.
  - **First cut:** median 3.3 s. Exceptions are a pre-roll montage (37645: 8 cuts in the first 3 s) and a text-first piece (41661: 0.27 s).
- **Shot count / shot length / cut rhythm:**
  - Segment count: median 20.5, range 6–52.
  - Median shot per video: overall median 2.95 s, range 1.13–4.95 s.
  - Mean shot per video: overall median 3.35 s.
  - Cuts per minute: median 17.9, range 8.3–43.2.
  - Longest shot: 3.8–16.5 s. The longest is usually a B-roll or evidence hold, or the final thesis line (12.2 s in 37438).
  - Shortest shot: 0.2–1.9 s.
  - **Rhythm:** narration-synced, not beat-synced. Cuts land on clause or sentence boundaries, and each new noun or claim gets a new background (e.g. each water-bottle brand named = a new plate).
  - No measured acceleration across the runtime. The exception is a deliberate fast pre-roll montage in 37645.
- **Shot selection (what kinds of shots, variety rules):**
  - Primary unit is the keyed talking head over a full-frame background. This is 100% of runtime in 6/10 videos.
  - Background types seen:
    - photos of the subject (people, places, products)
    - screenshots (DMs, articles, TikTok UI, app store listings)
    - data charts (Sankey diagrams, enforcement charts)
    - prompt or text cards
    - screen recordings
    - artworks or illustrations
    - collages
  - Backgrounds are reused when the same subject comes back (43614 rotates about 5 photos of one golfer; 37438 reuses its Stanley and Hydro Flask plates).
  - **Full-frame inserts without the keyed creator:** used in 3/10 videos.
    - 43614: 2 broadcast B-roll shots, 19.9 s, carrying the source interview audio.
    - 39645: 6 B-roll shots plus 1 on-location talking head, 16.6 s, about 31% of runtime.
    - 41704: an 18.8 s real-room selfie talking-head close with jump cuts.
  - Same-background jump cuts appear in 5/10 videos (2–9 per video). They are used to tighten delivery, not to change content.
- **Camera and framing:**
  - Greenscreen shots are static in 10/10.
  - Framing:
    - medium: 6/10 (41704 is medium in its greenscreen part)
    - close-up: 3/10 (43614, 37438, 43521)
    - wide: 1/10 (41661)
  - Creator placement: often scaled small and pushed to a lower corner or the bottom so the background reads (39645 bottom-right, 40034 lower-left, 37645 lower third, 37430 reframed to bottom).
    - Mid-video reframes or scale changes appear in 37645 and 37430.
  - The creator points up or back at the background in 5/10 videos.
  - A handheld mini or lav mic is visible on camera in 6/10 videos.
  - 3/10 are a single continuous camera take with only background swaps (37438, 37430, 41661).
- **Transitions:**
  - Hard cuts and instant background swaps are the default.
  - 1 dissolve in the whole sample (41661 at 1.47 s, a wide shot into a close-up).
  - 1 black end frame of 0.37 s (41661).
  - No other transitions recorded.
- **Text overlays (role, count, timing, position):**
  - 1 title-hook overlay per video is the norm (9/10).
  - 41661 is text-driven instead: two-line excuse/reality text pairs per background plus a share-CTA text at the end.
  - Information normally sits inside the background plate (article excerpts, DMs, chart labels, prompt cards) rather than as separate text layers.
  - Separate graphic overlays on top of the plate occur in 2/10:
    - 43614: DM screenshot at the top, 80.4–86.4 s.
    - 43521: logo banner at the top, last 1.9 s.
- **Captions:**
  - Burned-in captions in 10/10.
  - Position: middle 5/10, bottom 5/10.
  - They run the full duration. 37438 holds captions until the title card leaves (starts at 3.13 s); 39645 starts them at 0.9 s.
  - Caption style (font, word-by-word or not) is not in the timed data. Two other GSTH videos in the search pool are tagged "Dynamic Word-by-Word Captions".
- **Graphics (types, density, timing):**
  - Background changes per minute: median 13.5 (about 2.2 per 10 s), typical 10–21, range 3.3–38.2.
  - First background at 0 s in 9/10. The exception is 43521, at 7.7 s.
  - Median gap between background changes per video: 1.4–4.7 s (43521 is 26.7 s).
  - Longest stretch without a graphic change: 4.8–27.4 s.
  - No stickers, arrows, emoji or animated callouts recorded in any of the 10.
- **Audio (music / VO / sync / SFX, levels behavior):**
  - Sync voice to camera is wall to wall.
  - Speech rate: median 227 wpm, range 198–249 (9 speaking videos; 41661 has no measured speech).
  - Music: background bed in 5/10, none in 5/10. Level and ducking behavior are not measured.
  - SFX: 0/10.
  - Source-audio inserts: 43614 plays the subject's interview audio under B-roll for about 20 s.
  - Voice continues as VO over B-roll inserts (39645).
- **Ending:**
  - Explicit CTA in 5/10:
    - follow: 41704, 41696 (41696 adds a "Part 3" tease)
    - follow at mid-roll (47.5 s) plus a closing question to viewers: 43614
    - share-with-a-friend text: 41661
    - tool or sponsor name drop with logo: 43521
  - Cliffhanger: 37430 ("wish me luck", with remaining numbers on screen).
  - Ends on the thesis or summary line with no CTA: 39645, 37645, 37438, 40034.
  - In 7/10 the final background is held for the last sentence; no end card.
- **Common failure modes visible in weaker or atypical examples:**
  - 43521: one background for 16.5 s, then 54% of runtime is a non-greenscreen bedroom selfie. It has the lowest background rate (3.3/min) and lowest cut rate (8.3/min), and VDB originally classified it as Graphic Yap.
  - 41704: drops the greenscreen for its final 32%, leaving a 20.7 s stretch with no graphic.
  - 43614: backgrounds are interchangeable photos of the same person rather than evidence of each claim, with a 27.4 s stretch without a graphic.
  - 40034: title and opening shot held 11.3 s before the first cut, at 175.6 s total. It has the lowest views in the sample (64,918).
  - 37438: final background held 12.2 s, 25% of runtime.
  - These are observations. No causal link to performance was measured.

## Notes
- **Filter:** `filters.format = "Greenscreen Talking Head"` works as an exact match. All searches returned that format.
- **Coverage:** most high-view, high-outlier videos in this format are "not_backfilled" (no timed analysis), so the sample skews to videos posted Jul–Sep 2026 with views of 65k–843k. Analyzed videos were found via sort_by=post_date and a 6-month "breakdown explainer" query.
- **Numbers:**
  - All counts, timings, wpm, captions, music and framing figures are measured from the VDB timed editing analysis (shots-v2/v3).
  - The definition, classifier description, boundary rule, the 1,481 count and the characteristics list are stated by VDB.
  - VDB says timings are not guaranteed frame-accurate.
- **"Shots" mixes camera cuts and background swaps.** Camera-only shot counts are much lower (1–20), and 3 videos are one continuous take. The table uses VDB `shot_count` (segments).
- **Measurement gaps:**
  - 41661 has no measured speech (wpm null, transcript null) even though the creator holds a mic and talks to camera. It may be lip-sync or text-led.
  - 37438 and 43521 lack timestamps for the verbal hook.
- **Sample disagreements:**
  - Music is 50/50.
  - Caption position splits 5 middle / 5 bottom.
  - 3 of 10 use full-frame B-roll or real-room inserts, while the VDB classifier allows "not 100% of the time".
  - 43521 was reclassified from Graphic Yap to GSTH by the shot analyzer, so it sits on the format boundary.
- **Not measured anywhere:** aspect ratio, caption font or style, music level, ducking, keying quality and color grade.
- **Selection:** max 1 per creator was used. shaneohgolfs had many ready videos; only 43614 was included.

## Top 5 by views (user-supplied list)

> **37739 (grillguy) is excluded from the spec.** Colin's call: it is a bad example of the format (one change in 59 s, no captions). Its numbers stay below for the record; ignore them when setting targets.

Source: the user supplied the list of the 5 highest-view videos in the format, with views, duration, shots and changes (stated by user). IDs were matched via `list_creator_videos` (sort_by views). All numbers below are **measured** from the VDB timed editing analysis (shots-v2/v3, fetched 2026-10-05) unless marked **stated** (VDB summary fields or user list).

"Changes" = real visual changes: hard cuts, jump cuts, background swaps, reframes, graphic changes. VDB `not_a_change` sub-segments are excluded (this equals VDB `visual_change_count`). The user's "changes" column (12/26/13/10/2) equals VDB `segment_count`, which includes `not_a_change` segments and the start segment. "Median gap" = median interval between consecutive changes, counting the start and end of the video.

| VDB id | creator | views | duration s | camera shots | changes | changes/min | median gap s | link_markdown |
|---|---|---|---|---|---|---|---|---|
| 30687 | urdadnoel | 7,970,769 | 26.1 | 4 | 4 | 9.2 | 4.53 | [VDB](https://videodatabase.io/video/30687-creator-shares-wholesome-fan-story) \| [IG](https://www.instagram.com/p/DZBPlZpPxM1) |
| 43561 | shwinnabegobrand | 2,218,509 | 65.2 | 11 | 25 | 23.0 | 2.30 | [VDB](https://videodatabase.io/video/43561-explaining-the-genius-of-a-product) \| [IG](https://www.instagram.com/p/C3F2GfEu8HH) |
| 32418 | angus.sewell | 1,829,528 | 44.8 | 9 | 12 | 16.1 | 2.61 | [VDB](https://videodatabase.io/video/32418-debunks-ai-job-requirements-with-resourc) \| [IG](https://www.instagram.com/p/DZNyEF1Nts8) |
| 37043 | urdadnoel | 1,723,535 | 21.3 | 5 | 7 | 19.7 | 2.39 | [VDB](https://videodatabase.io/video/37043-reacting-to-using-dms-as-bookmarks) \| [IG](https://www.instagram.com/p/DbGl1C6hVc5) |
| 37739 | grillguy | 1,549,137 | 58.9 | 1 | 1 | 1.0 | 29.46 | [VDB](https://videodatabase.io/video/37739-telling-funny-stories-about-students) \| [IG](https://www.instagram.com/p/Dba_MsAB_0A) |

Per-video detail (measured):

| id | plates (bg) | plates/min | greenscreen share of runtime | longest stretch no change s | longest stretch no plate s | first change s | wpm | longest pause s | speech ratio |
|---|---|---|---|---|---|---|---|---|---|
| 30687 | 2 (+2 screenshot overlays over real room) | 4.6 (9.2 incl. overlays, stated VDB) | 43% (6.2–17.5 s) | 7.97 (scrolling screen-recording plate) | 8.7 (17.5–26.1, real room) | 6.17 | 218.6 | 0 | 0.998 |
| 43561 | 13 | 12.0 | 100% | 4.0 | 15.9 on one plate (49.2–65.2, with jump cuts + reframes inside) | 1.43 | 264.7 | 2.08 | 0.966 |
| 32418 | 6 | 8.0 | 31% (8.2–14.2, 20.7–28.8 s) | 7.23 | 16.0 (28.8–44.8, real room); VDB field states 19.07 | 2.13 | 209.2 | 0 | 0.991 |
| 37043 | 4 | 11.2 | 42% (10.1–19.1 s) | 6.03 (stitched clip) | 10.1 (opening stitch + kitchen) | 6.03 (VDB `first_cut_s` states 4.27, a `not_a_change`) | 214.1 (includes stitched speaker) | 0.56 | 0.972 |
| 37739 | 2 | 2.0 | 100% | 40.93 | 40.93 on one plate | 40.93 | 229.4 | 1.41 | 0.863 |

Format boundary (stated VDB `classification.shotAnalysis.format.previous`): all 5 were originally classified as something else and moved to Greenscreen Talking Head by the shot analyzer: 30687 Yap (90), 43561 Graphic Yap (98), 32418 Yap (90), 37043 Yap (98), 37739 Yap (98).

### Spec (measured, top 5)
- **Length:** median 44.8 s; range 21.3–65.2 s.
- **Aspect:** not in the analysis data. All 5 are IG Reels; 9:16 assumed, not measured.
- **Structure (beats in order, with typical timing):**
  - **Hook** ends 2.2–4.9 s (verbal hook end).
  - Content type: 3/5 are personal storytime or reaction (30687, 37043, 37739); 2/5 are breakdown or explainer (43561, 32418).
  - **Body:**
    - 30687: claim → proof (scrolling DMs) → detail (chat theme) → best example (trip DM) → payoff, 4 sequences.
    - 43561: reaction → research montage (7 article/post plates, 11.3–29.9 s, plate every 2.0–2.3 s) → product → virality → close.
    - 32418: hook → proof (2 job-listing plates) → objection in real room → resources (4 plates in 8.1 s) → advice in real room.
    - 37043: 8.6 s stitched third-party clip → reaction in real room → proof plates (DMs) → close in real room.
    - 37739: one plate for anecdotes 1–3 (0–40.9 s), one plate for the cancer anecdote (40.9–58.9 s).
  - **Close:** last 2.2–17.9 s.
  - **Speech:** speech ratio 0.86–1.0; longest pause 0–2.08 s (2/5 over 1 s); silent opening 0–0.4 s.
- **Hook (first 1-3 s):**
  - **Title card:** 2/5.
    - 32418: "238k. Just Claude", top, 0–8.2 s, over a real-room close-up; leaves at the first plate.
    - 37043: the stitched clip's own title, middle, 0–8.63 s; leaves when the creator appears.
    - 30687, 43561, 37739: no title text.
  - **Verbal hook:** 7–19 words (7, 7, 16, 18, 19). Types: specific-number oddity ("732 days"), third-party reaction ("my wife … audibly gasped"), accusation ("You got lied to"), quoted line from a stitched clip, challenge to commenters ("If you're gonna roast me in the comments…").
  - **Hook visual:**
    - Keyed over a plate from 0 s: 2/5 (43561 Instagram post of the product; 37739 save-the-date card).
    - Real-room selfie close-up with a DM screenshot overlay at the top: 30687.
    - Real-room close-up plus title, no plate until 8.2 s: 32418.
    - Third-party stitched clip: 37043.
  - **First change:** median 6.03 s; range 1.43–40.93 s.
- **Shot count / shot length / cut rhythm:**
  - Camera shots: median 5, range 1–11.
  - Changes per minute: median 16.1, range 1.0–23.0.
  - Median gap between changes: median 2.61 s, range 2.30–29.46 s.
  - Longest stretch with no change: 4.0–7.97 s in 4/5; 40.93 s in 37739.
  - Rhythm: changes land on clause or sentence ends (from `spoken_text` per segment).
  - 37739's single background change (40.93 s) lands on the tonal pivot "Then I got sick with cancer".
- **Shot selection (what kinds of shots, variety rules):**
  - Greenscreen share of runtime: median 43%, range 31–100%. 100% in 2/5 (43561, 37739).
  - Non-greenscreen material:
    - Real-room selfie or static close-up talking head: 3/5 (30687: 0–6.2 s and 17.5–26.1 s; 32418: 0–8.2 s, 14.2–20.7 s, 28.8–44.8 s; 37043: 8.6–10.1 s and 19.1–21.3 s).
    - Stitched third-party clip: 1/5 (37043, 0–8.6 s, 3 shots).
  - Plates per video: median 4, range 2–13. Plates per minute: median 8.0, range 2.0–12.0.
  - Plate types:
    - 30687: the creator's own Instagram DMs (a scrolling screen recording, a still chat).
    - 43561: Instagram posts and stories, a group-chat screenshot, article screenshots (one with a red circle on a stat), a brand site, a product page.
    - 32418: Google results, LinkedIn listings, Anthropic site pages, an infographic.
    - 37043: the creator's own DM screenshots.
    - 37739: the creator's personal photos.
  - Literalness: in 5/5 each plate is the exact object named in the line. The script points at it with "this/these" (e.g., "this picture and this phone case", "Find this page right here … click this enroll button", "I posted this", "like this guy", "these floating hearts").
  - Plate reuse: 43561 reuses the Rhode case story plate 3 times (11.3, 34.9, 42.4 s).
  - Jump cuts on the same plate: 43561 (12), 32418 (5, mostly in the real room), 30687 (1, real room).
- **Camera and framing:**
  - Static camera on greenscreen shots 5/5. The real-room shots in 30687 and 37043 are selfie handheld.
  - Framing: close-up is the primary framing in 5/5.
  - Speaker reframed smaller into a corner mid-video to reveal the plate: 3/5.
    - 30687: top-left at 14.1 s.
    - 43561: corner at 53.2 s, back to full size at 55.8 s.
    - 37043: lower-right at 16.7 s.
  - Placement at the start of the greenscreen: lower-right (30687), bottom (43561). Not stated for the others.
  - Points or gestures at the plate: 4/5 (30687, 32418, 37043, 37739).
  - Mic visible on camera: 2/5 (32418 wired earphone mic, 37739 handheld wireless mic).
  - Single continuous take: 1/5 (37739, 1 camera shot).
- **Transitions:**
  - Hard cuts and instant swaps 5/5.
  - No dissolves, no black frames.
  - Reframes are used as a change type in 3/5.
- **Text overlays (role, count, timing, position):**
  - Title hook: 2/5. Positions: top (32418), middle (37043). On screen 8.2 s and 8.63 s.
  - Label: 1/5. 43561 shows a bottom label repeating the spoken line ("SMART PRODUCT INNOVATION…"), 57.9–61.3 s.
  - Otherwise none.
- **Captions:**
  - Burned-in in 3/5, all bottom. 37043's run from 8.63 s only, after the stitch.
  - None in 2/5 (32418, 37739). VDB `captions_burned_in` = false for both.
- **Graphics (types, density, timing):**
  - Overlays on top of a greenscreen plate: 1/5 (the 43561 label).
  - Screenshot cards over real-room footage, top position: 30687 (0–6.2 s and 17.5–21.6 s).
  - No stickers, arrows, emoji or animated callouts. The only highlight is a red circle baked into one 43561 article plate.
- **Audio (music / VO / sync / SFX, levels behavior):**
  - Sync voice 5/5.
  - Music 0/5. SFX 0/5.
  - Speech rate: median 218.6 wpm, range 209–265.
  - 37043's first 8.6 s are third-party audio from the stitched clip.
- **Ending:**
  - Explicit CTA (follow, share, sponsor): 0/5.
  - Closing line addressed to the audience, commenters or a specific fan: 4/5.
    - 30687: "MNK.14218, I'm beating you to it today. Goodnight Pookie Bear."
    - 37043: "I see you guys. Don't think you're slick."
    - 37739: "This is a growth. It's not a booger, so stop commenting."
    - 32418: "Stop limiting yourself, dude."
  - Self-deprecating summary: 43561.
  - Callback to the hook: 2/5 (30687 repeats "goodnight Pookie Bear"; 37739 hook "roast me in the comments" → "stop commenting").
  - Ends in the real room: 3/5 (30687, 32418, 37043). Ends on a held plate: 2/5 (43561 15.9 s, 37739 18.0 s).
- **Common failure modes visible in weaker or atypical examples:**
  - Not assessable within this set. All 5 are top performers.
  - 37739 breaks every density norm (1 change in 58.9 s, no captions, no title) and still sits at 1.5M views.

### Top 5 vs mid-performer sample
All numbers measured unless noted. Mid sample = the 10 videos above (65k–843k views).
- **Classification:** 5/5 top were reclassified into the format from Yap or Graphic Yap. In the mid sample only 1/10 was (43521, from Graphic Yap).
- **Length:** top median 44.8 s (range 21.3–65.2) vs mid 56 s (18.9–175.6). No top video is over 66 s.
- **Greenscreen share:** top median 43% (100% in 2/5) vs mid 100% in 6/10. Real-room talking-head segments appear in 3/5 top vs 2/10 mid (41704, 43521).
- **Title card:** top 2/5 vs mid 10/10. Top title durations 8.2 and 8.6 s vs mid median 3.7 s. Title position is middle in 1/5 top vs 0/10 mid.
- **First background at 0 s:** top 2/5 vs mid 9/10.
- **First change:** top median 6.03 s vs mid median 3.3 s.
- **Background density:** top median 8.0 plates/min (2.0–12.0) vs mid median 13.5 (3.3–38.2).
- **Total change rate:** about the same. Top median 16.1 changes/min (1.0–23.0) vs mid median 17.9 cuts/min (8.3–43.2). Caveat: mid figures are VDB segments, which include some non-changes, so they read high.
- **Median gap:** top median 2.61 s vs mid median segment 2.95 s. Excluding 37739, top gaps are 2.3–4.5 s.
- **Longest stretch with no change:** top 4.0–7.97 s in 4/5 vs mid longest shot 3.8–16.5 s. 37739's 40.93 s is beyond anything in the mid sample.
- **Framing:** top close-up primary in 5/5 vs mid close-up in 3/10 (medium 6/10).
- **Reframe to corner:** top 3/5 vs mid 2/10 (37645, 37430).
- **Pointing at the plate:** top 4/5 vs mid 5/10.
- **Visible mic:** top 2/5 vs mid 6/10.
- **Captions:** top 3/5 vs mid 10/10. Top position is bottom 3/3 vs mid middle 5 / bottom 5.
- **Music:** top 0/5 vs mid 5/10.
- **Speech rate:** top median 218.6 wpm (209–265) vs mid 227 (198–249). The top max (264.7, 43561) is above the mid range.
- **Pauses:** top longest pause up to 2.08 s (2/5 over 1 s) vs mid ≤0.46 s.
- **Ending:** top CTA 0/5 vs mid 5/10. Top closing line addressed to audience or commenters in 4/5 vs mid 1/10 (43614's closing question).
- **Content type:** top 3/5 personal storytime or reaction using the creator's own DMs or photos as plates vs mid 0/10 (all breakdown, review or explainer).
- **Plate literalness:** top 5/5 plates are the exact object named, with "this/these" deixis. Mid sample had interchangeable plates in 43614.
- **Hook words:** top 7–19 vs mid 8–18.
- **Sample limits:** 5 videos, 2 from one creator (urdadnoel, 30687 and 37043, both 21–26 s DM stories with real-room bookends). Views are not normalized for follower count. Outlier scores are 33.3, n/a, 53.0, 10.6 and 28.7 (stated VDB). 43561 was posted 2024-02-08; the others 2026-05 to 2026-07. No causal link between any edit choice and views was measured.
