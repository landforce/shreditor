<!--
  Vendored from the ai-video-editor plugin: skills/graphic-yap/references/vdb-research.md
  source-sha256: sha256:753ed770eb360b304e508cdc7161ab48e4c510197efd3f32715caadf5cea7bd1
  Do not edit here. Change the plugin, then run: npm run formats:sync
-->

# Graphic Yap
VDB definition: "a raw, phone-shot talking-head video with a steady stream of image overlays placed above, beside or over the speaker." (https://videodatabase.io/formats/graphic-yap)

VDB characteristics (stated by VDB, from that page):
- Goal: "to keep the screen changing"
- Edit: "Silences are cut out, a new image appears every second or two"
- Timing: "the first overlay lands by second 2 to lift early retention"
- "The speaker brings the personality and the graphics show what's being said"
- "It works just as well for comparisons, this-or-that debates, and concept explainers"
- "Reading along, watching the speaker and taking in each image keeps the viewer busy enough that a simple video holds attention far longer than a plain yap would"
- "150 videos in the database use this format."

Sample: 10 analyzed videos, 10 creators, all with timed editing analysis (shots-v3). "Shots" = VDB visual segments, which include graphic changes; the camera-shot count is in parentheses. "Avg shot s" = mean segment length.

| VDB id | creator | views | duration | shots | avg shot s | link_markdown |
|---|---|---|---|---|---|---|
| 39073 | swaggylaggygolfdaddy | 9,040,706 | 77.3 | 14 (1) | 5.53 | [VDB](https://videodatabase.io/video/39073-conspiracy-theory-explained-on-golf-cour) \| [IG](https://www.instagram.com/p/DcByRFwIpJz) |
| 36660 | chloe.shih | 3,753,490 | 48.6 | 17 (17) | 2.86 | [VDB](https://videodatabase.io/video/36660-creator-shares-audience-poll-results) \| [IG](https://www.instagram.com/p/DbC5Ir8y2rS) |
| 35161 | madeleinevoge | 2,033,558 | 116.0 | 9 (7) | 12.89 | [VDB](https://videodatabase.io/video/35161-traumatic-childhood-media-listicle) \| [IG](https://www.instagram.com/p/DaI1aSsS7T8) |
| 39664 | gstaadguy | 1,485,538 | 39.4 | 18 (12) | 2.19 | [VDB](https://videodatabase.io/video/39664-mended-clothes-reveal-personal-character) \| [IG](https://www.instagram.com/p/DcLlPJtMujZ) |
| 42088 | kellybadakdesign | 1,030,730 | 69.0 | 29 (25) | 2.38 | [VDB](https://videodatabase.io/video/42088-explaining-a-niche-design-aesthetic) \| [IG](https://www.instagram.com/p/DYm4uo-B-MT) |
| 37956 | drewsxvision | 636,441 | 57.1 | 6 (6) | 9.51 | [VDB](https://videodatabase.io/video/37956-ranked-list-of-carbs-for-fat-loss) \| [IG](https://www.instagram.com/p/DbZdKA9plrN) |
| 39927 | shannonmckinstrie | 359,456 | 28.3 | 11 (6) | 2.57 | [VDB](https://videodatabase.io/video/39927-creator-explains-viral-hook-formula) \| [IG](https://www.instagram.com/p/DcL27MPuyd4) |
| 35913 | womp_tomp | 262,507 | 97.2 | 29 (1) | 3.35 | [VDB](https://videodatabase.io/video/35913-man-in-car-explains-society) \| [IG](https://www.instagram.com/p/DagnUHvulQL) |
| 33462 | alexgreifeld | 186,098 | 75.8 | 22 (2) | 3.45 | [VDB](https://videodatabase.io/video/33462-fashion-school-grad-shares-warning) \| [IG](https://www.instagram.com/p/DZVJTP3seVh) |
| 39401 | bonusfootage | 184,688 | 29.7 | 7 (1) | 4.25 | [VDB](https://videodatabase.io/video/39401-recapping-missed-online-money-eras) \| [IG](https://www.instagram.com/p/DcEF_M4ucfs) |

## Spec (measured)
- **Length:** median 63 s, range 28–116 s; middle of the sample 39–77 s.
- **Aspect:** not measured. All 10 are Instagram Reels, so assume vertical 9:16. In 35913 the speaker sits in the lower half of the vertical frame with the image in the top half.
- **Structure (beats in order, with typical timing):**
  1. Hook / premise: 0 to about 11 s (end of the first sequence ranged 6.3–25.7 s, median about 11 s).
  2. Body: one point per line, each line paired with an image. List videos (4 of 10) follow the loop "name item → show image → comment".
  3. Close: the final segment runs 1.0–20.1 s (median 6.2 s). In 6 of 10 it is speaker-only with no graphic.
- **Hook (first 1–3 s):**
  - Speech starts at 0–0.24 s in every video where it was measured; there is no silent open.
  - A graphic is on screen by 2.33 s in 7 of 10, and at frame 0 in 3 of 10 (42088, 36660, 35913).
  - 5 of 10 use title hook text at the top or middle. Three are timed: 0–5.0 s, 0–3.3 s and 3.4–4.8 s. Two stay on for the whole video (37956, 33462).
  - Cuts in the first 3 s: 0 in 5 videos, 1 in 3, 2 in 2.
  - The verbal hook is a full declarative sentence or claim, ending at about 1.6–6.2 s.
- **Shot count / shot length / cut rhythm:**
  - Segments: median 15.5 (range 6–29). Camera shots: median 6 (range 1–25).
  - 3 of 10 are one continuous take (33462, 39073, 39401). In those, every "cut" is a graphic change.
  - Median segment length per video: overall median 2.5 s, and 8 of 10 fall between 2.05 and 3.5 s. The two outliers are 9.1 and 9.3 s.
  - Mean segment length: median 3.4 s.
  - Shortest segment 0.23–4.1 s. Longest segment 4.2–43.1 s (median about 8.6 s).
  - Visual changes per minute: median 17 (range 4.1–25.9).
  - Rhythm is phrase-driven: cuts land on line or phrase ends, not on a beat (no video has beat-synced music).
  - Sub-second segments come in clusters where graphics swap rapidly, e.g. 42088 at 48.4–49.9 s with three logo swaps of 0.23, 0.43 and 0.83 s.
- **Shot selection:**
  - 9 of 10 are 100% talking head.
  - Only 36660 cuts away to b-roll: 3 handheld laptop-screen shots with voiceover, 0.4–2.7 s each.
  - 35161 ends on a non-speaking gag shot (4.1 s).
  - 39073 ends on a 20 s wide shot of the speaker doing the activity (golf swing).
  - The speaker never leaves the frame for a full-screen graphic, except brief large overlays in 39073 and 36660 that cover most of the frame.
- **Camera and framing:**
  - Camera: static (propped phone) in 7 of 10; selfie handheld in 3 of 10 (2 of those walking).
  - Framing: medium in 6, closeup in 4.
  - Settings are all real locations: bedroom/room 3, car 3, outdoors 3, kitchen 1. 0 greenscreen.
  - Props in 4 of 10 (mic, mug, bread/honey, golf club).
- **Transitions:** none. Every change is a hard jump cut or a graphic swap (boundaries: graphic_change or jump_cut; hard_cut only for the b-roll and gag cutaways).
- **Text overlays (excluding captions):**
  - Count per video: median 1.5 (range 0–6). 2 videos have none.
  - Roles: title hook (5); labels such as stats, equations, "77% voted girl" or "Niche specific ideas incoming" (3 videos); numbered list skeleton (1); pulled quote or aphorism (1); news headlines (1).
  - Labels sit on screen 1.8–5.8 s. Positions are mostly top, some middle or left.
- **Captions:**
  - Burned-in in 9 of 10; none in 39073.
  - Position: bottom 5, middle 4.
  - Captions show short phrase chunks of 1–5 words.
  - 35913 uses all caps; the others use sentence or lower case. Captions are dropped while a stat label is on screen (36660, 2 segments).
- **Graphics (types, density, timing):**
  - Count: median 11.5 per video (range 3–22).
  - Rate: median 11.4 per minute (range 5.2–26.2), about 1.9 per 10 s.
  - Totals by type (120 overall): images/photos 76, screenshots of articles, comments, analytics or posts 24, video insets 6, stickers/memes/badges 4, charts 4, text cards 3, product cutouts 3.
  - Position: top, above the head, is dominant in 6 of 10 videos. Others use middle (2), left (1) or mixed (1).
  - Each graphic is on screen about 1–3 s (alex 0.9–2.4; kelly 1.2–3.3; bonus 1.0–2.3).
  - Exceptions: explainer or template cards hold 5–10 s (39927 formula card 10.3 s); list builds stack and persist to the end (37956).
  - Gap between graphic starts: median 3.6 s (range 1.5–9.7).
  - Longest stretch without a graphic: median 11 s (range 5.3–34.8).
  - About half of segments are speaker-only. Graphics alternate with clean speaker shots rather than covering everything (35913, 33462, 42088 all alternate graphic and clean).
  - Images are literal illustrations of the noun just spoken: a named place, person, product, headline or stat.
- **Audio:**
  - Voice from the phone mic in 10 of 10.
  - Music: none in 8 of 10; quiet background bed in 2 (42088, 39664).
  - SFX in 1 of 10 (39073).
  - Speech rate: median 214 wpm (range 176–255, n=8).
  - Speech covers 88–99.8% of runtime (median about 98.5%). Longest pause 0–2.3 s; silences are cut.
- **Ending:**
  - Verbal CTA in 3 (save/follow, comment for help, "see you tomorrow").
  - Mission or summary line in 4; welcome/invitation in 1; gag or activity payoff in 2.
  - No end card in any video. Final segment median 6.2 s; graphic-free in 6 of 10.
- **Common failure modes visible in weaker or atypical examples:**
  - Graphics stall for long stretches: 37956 goes 34.8 s with no new graphic after its list completes; 35161 goes 32 s; 39073 goes 23.6 s at the end.
  - First graphic arrives late: 10.8 s (37956) and 11.0 s (35161), against VDB's "by second 2".
  - Too few graphics to "keep the screen changing": 39927 has 3 graphics, one held 10.3 s.
  - Long unbroken shots: 43.1 s in 35161, 15.9 s in 37956.
  - Missed cuts flagged by VDB: 3 segments in 35913, 1 in 35161.
  - Caveat: these traits do not track views. 35161 (2.0M) and 39073 (9.0M) are among the slowest-cut videos in the sample.

## Notes
- **Search filter:** `filters.format = "Graphic Yap"` worked as written. The query text mattered: "graphic yap" returned 5 results, "talking head image overlay" 9, "explainer" 25. The pool was taken from those three searches.
- **Label convention:** every number above is measured from the sample (VDB editing_analysis, shots-v3) unless it is marked "stated by VDB", i.e. the definition and characteristics block.
- **VDB statements vs the sample:**
  - "A new image appears every second or two": measured median gap between graphic starts is 3.6 s, and only 2 of 10 are under 2 s (37956 at 1.5 s, 39401 at 1.87 s). Single graphics do usually stay on 1–3 s, but they alternate with speaker-only segments.
  - "First overlay lands by second 2": true for 6 of 10 (7 of 10 by 2.33 s).
- **Format label history:** 8 of 10 were reclassified to Graphic Yap from "Yap" by the shot analyzer, and 42088 from "Greenscreen Talking Head". The line between Yap and Graphic Yap is VDB's analyzer judgment.
- **Shot-count ambiguity:** VDB "segments" mix camera cuts and graphic changes. For continuous-take videos (33462, 39073, 39401; 35913 has 1 camera shot) the cut rate is really the graphic-swap rate.
- **Missing data:** wpm is null for 42088 and 36660 (word timing missing). Aspect ratio and text styling (font, size) are not in the data. 35161's graphic list includes events timed past the end of the video (116–127 s), so treat its graphic timings as approximate.
- **Topic and tone skew:** 3 of 10 are list or ranking videos. Topics include politics/conspiracy (2), creator/marketing education (3), design/culture (2), fitness, nostalgia and lifestyle philosophy.

## Top 5 by views (user-supplied list)

Excluded by Colin: @reecebrah post-junk-food remedy and @douggrindstaff boring business models (too sparse).

Label convention for this section: **(stated)** = from the user-supplied list or VDB's format page. **(VDB)** = a value VDB's editing analysis reports directly (shots-v3, analyzed 2026-10-01/02). **(computed)** = derived here from VDB's timed graphic, segment and text events. "Changes" in the user list matches VDB `segment_count` in all 4 found videos (stated vs VDB: 3/3, 14/14, 1/1, 17/17); VDB's own `visual_change_count` is segment_count − 1.

| VDB id | creator | views | duration | camera shots | changes | graphics | graphics/min | first graphic s | link_markdown |
|---|---|---|---|---|---|---|---|---|---|
| 33821 | swaggylaggygolfdaddy | 25,727,576 | 51.4 | 1 | 3 | 10 | 11.7 | 1.95 | [VDB](https://videodatabase.io/video/33821-conspiracy-theory-explained-while-golfin) \| [IG](https://www.instagram.com/p/DZStJBNBWBV) |
| 39073 | swaggylaggygolfdaddy | 9,040,706 | 77.3 | 1 | 14 | 19 | 14.7 | 1.4 | [VDB](https://videodatabase.io/video/39073-conspiracy-theory-explained-on-golf-cour) \| [IG](https://www.instagram.com/p/DcByRFwIpJz) |
| 40059 | daadisnacks | 5,713,690 | 71.7 | 1 | 1 | 5 | 4.2 | 3.4 | [VDB](https://videodatabase.io/video/40059-creators-revenge-story-against-influenc) \| [TT](https://www.tiktok.com/@daadisnacks/video/7647951076582362399) |
| 36660 | chloe.shih | 3,753,490 | 48.6 | 17 | 17 | 13 | 16.0 | 0 | [VDB](https://videodatabase.io/video/36660-creator-shares-audience-poll-results) \| [IG](https://www.instagram.com/p/DbC5Ir8y2rS) |
| not found | jun_yuh | 3.4M (stated) | 13 (stated) | 1 (stated) | 2 (stated) | 4 (stated) | ~18.5 (computed from stated) | – | – |

All table values except the jun_yuh row are VDB. The jun_yuh video ("Comparing bad to best speaking") was not found: `list_creator_videos("jun_yuh")` returns 9 videos, none matching and none with timed analysis; `search_videos` with `format: "Graphic Yap"` and queries "bad to best speaking", "speaking", "articulate", "jun_yuh", "Jun Yuh speaking comparison" returned no match. Everything below is measured from the 4 found videos. 39073 and 36660 are also in the mid-performer sample above, so only 33821 and 40059 are new data.

### Why graphics outnumber changes

VDB segments do not split on every graphic swap. Of 47 graphic starts, 30 land more than 0.3 s from any segment boundary (computed):
- 33821: 8 of 10 graphic starts fall inside segment 3 (8.6–51.4 s, labelled "Creator with golf club"). The segmenter split only at the video inset (5.63 s) and the Wikipedia screenshot (8.6 s). The card sequence at 32.0, 33.5, 35.5, 36.8 s and the side-by-side at 45.8 s do not register.
- 39073: 9 of 19 starts are off-boundary. The opening run of five news screenshots (1.4, 2.9, 5.7, 7.7, 8.7 s) is all inside segment 1 (0–10.2 s).
- 40059: 0 of 5 graphics produce a segment; the video is one 71.7 s segment.
- 36660: segments come from 16 camera cuts (jump cuts and b-roll), and 8 of 13 graphics start mid-segment.
- Overlap/stacking accounts for almost none of it: 1 overlapping pair in 47 graphics (36660, comment screenshots 18.4–21.03 s plus cat meme 18.9–21.03 s) (computed). Every other graphic replaces the previous one in the same slot or follows a gap.
- VDB's `longest_without_graphic_s` is the longest gap between graphic *starts* (or from the last start to the end), not the longest stretch with nothing on screen: 33821 reports 9.0 (36.8→45.8 start gap) while the on-screen gap is 7.8 (computed); 39073 reports 23.6 (53.7→77.3) vs 20.4; 40059 reports 34.9 (36.8→71.7) vs 31.9.

### Spec (measured from the 4 found videos)
- **Length:** 48.6, 51.4, 71.7, 77.3 s; median 61.5 s (VDB/computed).
- **Aspect:** not measured (3 IG Reels, 1 TikTok).
- **Structure:**
  - 33821: fact (0–5.6 s) → video inset of source (5.6–8.6 s) → artifact explained with cards (8.6–38 s) → side-by-side proof (45.8–49 s) → golf drive (VDB events; sequence timing computed).
  - 39073: three VDB sequences: Kirk numerology 0–25.7 s, JFK parallels 25.7–57.2 s, venting + golf drive 57.2–77.3 s (VDB).
  - 40059: one sequence, 0–71.7 s: origin → follower numbers (14.3–30.7 s) → jab (36.8–39.8 s) → thank-you/mission (39.8 s to end, no graphics) (VDB events).
  - 36660: five VDB sequences: hook/problem 0–11.8 s, tool b-roll 11.8–14.3 s, comments 14.3–25.8 s, results 25.8–33.3 s, tease 33.3–48.6 s (VDB).
- **Hook (first 1–3 s):**
  - Speech starts at 0, 0.08 and 0.24 s (VDB; 36660 has no word timing).
  - First graphic at 0, 1.4, 1.95 and 3.4 s; median 1.68 s (VDB/computed). 3 of 4 by 2 s.
  - Cuts in the first 3 s: 0 in 3 videos, 1 in 36660 (2.13 s) (VDB).
  - Title hook text in 2 of 4: "You're TOO invested", middle, 0–3.27 s (36660); "to the influencer who told me I could never do it: i won", top, 0–14.1 s (40059) (VDB).
  - Verbal hook is one declarative fact that ends at 2.64 s (39073), 3.20 s (33821) and 10.0 s (40059, 28 words) (VDB).
  - First frames: speaker on a golf fairway holding a driver (both 33821 and 39073); close-up at a desk chair with title text (40059); handheld bedroom shot with two post thumbnails plus title (36660) (VDB).
- **Camera shots / segments / rhythm:**
  - Camera shots: 1, 1, 1, 17 (VDB). 3 of 4 are one continuous take.
  - Segments: 3, 14, 1, 17. Median segment length 5.63, 3.5, 71.7, 2.63 s (VDB).
  - Cuts/min (VDB): 2.34, 10.08, 0, 19.75.
  - In the continuous takes the edit is graphic swaps only; no jump cuts (VDB boundaries all graphic_change).
- **Shot selection:** 100% talking head in 3 of 4. 36660 has 3 laptop b-roll shots with voiceover, 0.37, 2.17 and 2.73 s (VDB). The 39073 final segment is a wide shot of the golf swing, 20.1 s (VDB).
- **Camera and framing:** static propped phone in 3 (golf course ×2, room/desk chair ×1). Selfie handheld in 1 (bedroom). Framing medium in 2, close-up in 1, medium/close-up mix in 1. Prop in use in 2 (golf club). No greenscreen (VDB).
- **Transitions:** none. Boundaries are graphic_change, jump_cut or hard_cut only (VDB).
- **Graphics:**
  - Count: 10, 19, 5, 13. Total 47; median 11.5 per video (VDB/computed).
  - Rate: 11.7, 14.7, 4.2, 16.0 per minute; median 13.2 (VDB/computed).
  - Types (47): images 21, screenshots 16 (YouTube stats, Google info cards, news headlines/articles, Wikipedia, IG/TT profiles, comment sections), stickers/memes/badges 3, text cards 3, video insets 2, charts 2 (VDB).
  - Position: top 34 of 47; middle 5; left 2; right 2; bottom 2; full 2 (VDB). 40059 is 5/5 top, 33821 is 9/10 top and 39073 is 16/19 top. 36660 spreads across 6 positions.
  - Time on screen: median 2.7 s, range 0.83–9.0 s. 28 of 47 are 1–3 s, 16 are over 3 s and 3 are under 1 s (computed). Longest holds: 9.0 s ("Enough is Enough" card, 33821), 8.3 s (Kirk/hats photo, 39073), 5.6 s (video inset to end, 36660).
  - Gap between graphic starts: per-video median 3.68, 2.4, 9.25, 2.99 s (computed; VDB median_gap 3.68, 2.3, 9.0, 2.7). Pooled median 3.0 s; 11 of 43 gaps are 2 s or less (computed).
  - Rapid runs: 39073 shows five news screenshots in 8.5 s (1.4–9.9 s, each 1.0–2.0 s); 33821 shows four game cards in 6 s (32.0–38.0 s, each 1.2–2.0 s) (VDB events).
  - Share of runtime with a graphic on screen: 67.6%, 66.6%, 23.3%, 69.1% (computed).
  - Longest stretch with nothing on screen: 7.8, 20.4, 31.9, 5.3 s (computed); VDB start-gap metric 9.0, 23.6, 34.9, 6.6 s. In 39073 and 40059 the longest stretch is the ending (56.9–77.3 s, 39.8–71.7 s).
  - Content: literal illustration or evidence of the noun just spoken, e.g. "Charlie's last video" → its YouTube stats; "33-hour manhunt" → three headlines saying 33 hours; "800K/1.1M followers" → the profile screenshots (VDB descriptions vs transcript).
- **Text overlays (excluding captions):**
  - Count: 0, 3, 1, 6; median 2 (VDB).
  - Roles: title hook ×2 (above). Labels: equations "4 + 7 = 11" and "11*(3 hats) = 33" (middle, 12.4/14.5–18.2 s), "first in Dallas, TX" (middle, 36.1–37.9 s), "1,480 comments to review" (left, 3.27–5.4 s), "77% voted girl 💖" (top, 28.5–30.77 s), "22% voted boy 💙" (top, 30.77–33.27 s). Emphasis: "AND GIRL", "THIS IS A LOTTA WORK" (VDB).
  - Labels on screen 1.8–5.8 s (computed).
- **Captions:** none in 3 of 4 (33821, 39073, 40059). Burned-in, bottom, in 36660 for the whole video, and dropped during the "1,480 comments" label and the 77%/22% stat segments (3.27–6.0 s, 28.5–33.27 s) (VDB).
- **Audio:**
  - Phone-mic voice in all 4. Music: none in 4 of 4. SFX flagged in 2 (33821, 39073; same creator) (VDB).
  - Speech rate 190.6, 175.6 and 162.4 wpm (36660 null) (VDB).
  - Speech ratio 84.3%, 87.7%, 98.3%. Longest pause 3.63, 2.32, 0.46 s. The two golf videos pause while she sets up and swings (VDB).
- **Ending:**
  - Activity payoff (golf drive) in 2 (33821, 39073). Gratitude/mission line in 1 (40059). Verbal and text CTA "and I'll see you tomorrow <3" plus a preview inset in 1 (36660) (VDB).
  - The ending has no graphic in 3 of 4: last 2.4 s (33821), 20.4 s (39073) and 31.9 s (40059). 36660 keeps a video inset up to the last frame (computed).
  - No end card in any (VDB).

### Top 5 vs mid-performer sample

Caveat: n = 4, not 5. Two are by one creator (swaggylaggygolfdaddy), and two (39073, 36660) are also in the mid-performer sample, so the two groups share half their data. None of the differences below is established.

| Measure | Top 4 | Mid sample (10) |
|---|---|---|
| Length median | 61.5 s | 63 s (no material difference) |
| Camera shots, median | 1 (3 of 4 single take) | 6 (3 of 10 single take) |
| Median segment length per video | 2.63–71.7 s (median 4.6) (computed) | 8 of 10 between 2.05 and 3.5 s |
| Graphics per minute, median | 13.2 (range 4.2–16.0) | 11.4 (range 5.2–26.2) |
| Graphics per video, median | 11.5 | 11.5 (no difference) |
| First graphic by 2 s | 3 of 4 (latest 3.4 s) | 6 of 10 (latest 11.0 s) |
| Gap between graphic starts, median | 3.0 pooled / per-video 2.4–9.25 (computed) | 3.6 (range 1.5–9.7) |
| Longest stretch without a graphic (VDB metric), median | 16.3 s (6.6–34.9) | 11 s (5.3–34.8) |
| Screenshots as share of graphics | 16 of 47 (34%) | 24 of 120 (20%) |
| Top position share | 34 of 47 graphics | dominant in 6 of 10 videos (per-graphic not counted) |
| Overlapping graphics | 1 pair in 47 | not measured |
| Burned-in captions | 1 of 4 | 9 of 10 |
| Title hook text | 2 of 4 (one held 14.1 s) | 5 of 10 (timed ones 1.4–5.0 s; 2 held all video) |
| Text overlays per video, median | 2 (0–6) | 1.5 (0–6) |
| Speech rate, median | 175.6 wpm (162–191, n = 3) | 214 wpm (176–255, n = 8) |
| Speech ratio | 84–98% (n = 3) | 88–99.8%, median ~98.5% |
| Longest pause | 0.46–3.63 s | 0–2.3 s |
| SFX | 2 of 4 (one creator) | 1 of 10 (same creator, 39073) |
| Music | none in 4 | none in 8 |
| Graphic-free ending | 3 of 4, 2.4–31.9 s | 6 of 10, final segment median 6.2 s |
| Activity payoff ending | 2 of 4 (one creator) | 2 of 10 (incl. 39073) |

## Dense examples (user-supplied)

Same label convention as the Top 5 section. "Changes" in the user list matches VDB `segment_count` in all 3 (50/50, 32/32, 58/58). 39179 is classified by VDB as **Talking Head Edit**, not Graphic Yap; the user counts it as "a really intense Graphic Yap". Its images are full-frame cutaways, which VDB logs as camera shots, not graphics, so its "images" column counts cutaway shots (computed from VDB shot list).

| VDB id | creator | VDB format | views | duration | camera shots | changes | images | images/min | median gap s | first image s | link_markdown |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 43830 | eloisepreen | Graphic Yap | 487,013 | 82.9 | 12 | 50 | 24 | 17.4 | 2.1 | 1.0 | [VDB](https://videodatabase.io/video/43830-creator-lists-ikea-home-decor-finds) \| [IG](https://www.instagram.com/p/DdmJVOzKmVY) |
| 43627 | thisonesnice | Graphic Yap | 318,137 | 113.9 | 1 | 32 | 42 | 22.1 | 2.41 | 0 | [VDB](https://videodatabase.io/video/43627-creator-showcases-idyllic-country-house) \| [IG](https://www.instagram.com/p/Dd3RsZdI3cB) |
| 39179 | orenmeetsworld | Talking Head Edit | 526,021 | 80.0 | 49 | 58 | 36 full-frame cutaways (VDB graphics: 0) | 27.0 | 1.33 | 1.25 | [VDB](https://videodatabase.io/video/39179-critiquing-consumerism-in-modern-hobbies) \| [IG](https://www.instagram.com/p/Db8YigGtvYP) |

### 43830 eloisepreen, "mid century modern IKEA finds" (list)

- **Hook:** title "mid century modern / IKEA / finds:" (3 lines), top, 0–3.37 s (VDB). Speech from 0.16 s. Verbal: "You love that mid century modern look for your home, but you just don't know where to start." First image 1.0 s (room inspiration photos stacking over her, middle, 1.0–2.03 s).
- **Images:** 24 (VDB by kind: product_image 15, image 7, screenshot 2). 17.4/min. On screen median 1.55 s, range 0.7–4.0 s; 4 under 1 s, 15 at 1–3 s, 5 over 3 s (computed). Position: middle 12 (over chest/upper body), top 12 (above head). No two events overlap in time; several single events are multi-image stacks (chair colourways "floating around creator", lamp cutouts, three floor lamps side by side, four vases in a row, three EKET units in a row).
- **Gaps:** between image starts median 2.1 s, min 0.7, max 9.27 s; 11 of 23 gaps ≤ 2 s (computed). Share of runtime with an image up: 55.1%. No-image stretches over 3 s: 2.03–10.27 (8.24 s, intro), 20.2–24.93 (4.73), 28.77–32.57 (3.8), 77.8–82.87 (5.07, ending) (computed). VDB `longest_without_graphic_s` 9.27.
- **Words → images:** literal product named at the moment: "this chair" → DYVLINGE screenshot (10.27 s); "sideboards, cabinet, side tables, and wardrobes" → RADMANSO screenshots 0.7–1.57 s each (16.43–20.2 s); "Theodo lamp" → FADO; "orange glazed donut lamp" → VARMBLIXT; "this shelving unit, this side table … this sofa" → BILLY 0.77 s, KONSTRUNDA 0.76 s, JATTEBO 1.77 s (56.93–61.5 s).
- **Camera:** 12 camera shots, one setup: static, medium, living room, to camera; prop lavalier mic held in hand, statement sunglasses (VDB). 11 jump cuts (8.0/min) + 38 graphic changes. Median segment 1.62 s, max 4.53 s; 35.5 cuts/min (VDB counts graphic changes as cuts). 0 missed cuts.
- **Text (excl. captions):** 3 — title hook; label "(walnut)" top 20.23–22.5 s; CTA "stay tuned for pt. 2" top 81.3–82.87 s (VDB).
- **Captions:** burned in, bottom (VDB), whole video.
- **Audio:** voice + background music, no SFX. 270.6 wpm, speech ratio 99.8%, longest pause 0 s (VDB).
- **Ending:** verbal + text CTA "stay tuned for pt. 2"; last 5.07 s have no image.

### 43627 thisonesnice, "Guess the house price: Colthouse, Cumbria" (property tour)

- **Hook:** title "Guess the house price: / 📍 Colthouse, Cumbria | UK 🇬🇧", middle, 0–113.86 s (whole video) (VDB). Speech from 0.08 s. Verbal: "This house is the epitome of, I dread to think what it would cost if it was like an hour-ish from London." First image 0 s (house exterior, 0–5.84 s). VDB hook_visual describes the layout as split-screen: photo top half, speaker bottom half.
- **Images:** 42, all `image`, all top (VDB). 22.1/min. On screen median 2.41 s, range 0.84–5.84 s; 3 under 1 s, 26 at 1–3 s, 13 over 3 s (computed). Back-to-back: each image replaces the last; 0 overlaps.
- **Gaps:** between image starts median 2.41 s, min 0.84, max 5.84 s; 14 of 41 ≤ 2 s. Image on screen 100% of runtime; longest no-image stretch 0 s (computed).
- **Words → images:** literal: "we're up north" → UK map, Lake District map, satellite map, satellite zoom (24.26–34.5 s); "lakes, hills, streams, waterfalls, Peter Rabbit" → lake, waterfall, Beatrix Potter illustration (0.84 s); "look at these gardens" → 5 garden photos; "look at this kitchen … AGA" → kitchen, AGA; "Three bathrooms, six bedrooms" → room photos. Order: house → area → maps → area lifestyle → gardens → interior room by room → price (VDB sequences).
- **Camera:** 1 camera shot (continuous take): static, medium, interior with brick fireplace, to camera, laptop on desk (VDB). 0 jump cuts; all 31 boundaries are graphic changes. 16.3 changes/min; median segment 2.9 s, max 10.5 s (segments can span several image swaps). VDB flags a missed cut in 6 of 32 segments; longest pause 0.86 s.
- **Text (excl. captions):** 1 — the title, held all video.
- **Captions:** burned in, bottom (VDB), whole video.
- **Audio:** voice + background music, no SFX. 209.9 wpm, speech ratio 95.2% (VDB).
- **Ending:** price reveal "£1.35 million" in the last segment (103.6–113.86 s); final image is the house front again (109–113.86 s), bookending the opening photo. No end card.

### 39179 orenmeetsworld, "Gear Acquisition Syndrome" (VDB: Talking Head Edit)

- **How VDB logged it:** graphics_count 0; text_overlay_count 13; camera_shot_count 49 = 58 segments − 9 graphic-change boundaries (VDB). The 36 non-speaker segments are logged as camera shots with `creator_on_camera: false`, `graphics_overlay: false`, shot types photo_or_still 21, broll 8, prop_or_product_closeup 5, other 1 (Garmin render stacked above a climber photo), graphic_or_text_card 1 (two laptops with Ableton on yellow). None of the images is logged as text; all 13 text overlays are typed punch text. So images were logged as cutaway camera shots, not as text and not omitted.
- **Speaker vs cutaways:** of 49 camera shots, 13 are the speaker, 36 are cutaways (computed). Speaker on screen 36.37 s (45.5%); cutaways 43.62 s (54.5%). Coordinator's frame check (ffmpeg, 1 fps): ~55% of frames are full-frame images, consistent. Cutaways appear in 10 runs (1–10 shots each; longest run 1.25–14.13 s, 10 shots); speaker blocks between runs 1.0–7.75 s.
- **Hook:** title "Gear Acquisition Syndrome", large serif, top, 0–2.67 s (VDB; style from coordinator frame check). Speech from 0 s: "We used to live our hobbies. Now we just buy into them." First image 1.25 s (card-table photo), hard cut.
- **Images:** 36 full-frame cutaways, 27.0/min. On screen median 1.17 s, range 0.71–1.83 s (computed). Gap between cutaway starts median 1.33 s, max 9.08 s; 26 of 35 ≤ 2 s. Longest stretch with no image 7.75 s (speaker block 46.33–54.08 s). Coordinator frame check: product shots on white, some two products stacked top/bottom.
- **Words → images:** one image per noun at the noun: "tracksmith half-tights" 5.71 s, "a Garmin Phoenix" 7.17, "Bandit socks" 8.04, "MothTech" 8.88 (Satisfy tee), "carbon-plated Alphaflys" 10.13, "Fuji X-100V" 19.75, "La Marzocco Micra" 24.58, "Blank Street" 29.08, "once I get the Osmo" 72.42.
- **Cuts:** 57 boundaries: hard_cut 46, graphic_change 9, jump_cut 2 (1.5 jump cuts/min) (VDB). 42.75 cuts/min, median segment 1.21 s, max 3.5 s, p90 1.86 s; 2 cuts in first 3 s. Median gap between any visual change 1.21 s, max 3.5 s (computed).
- **Camera:** speaker static, medium, studio desk, podcast mic, to camera (VDB + coordinator).
- **Text (excl. captions):** 13, all role title_hook (VDB): top 0–2.67 "Gear Acquisition Syndrome"; top/bottom pair 14.13–17.04 "HE HAS SPENT $1100" / "AND RAN 0 MILES"; middle "THIS IS NOT A RUNNING STORY" 17.04, "THE EXISTENTIAL QUESTION" 30.0, "GEAR ACQUISITION SYNDROME" 35.88 (on a photo), "FREE 2-DAY DELIVERY" 46.33, "IT IS OUR LITERAL BRAIN CHEMISTRY" 52.54, "AND THE BRANDS UNDERSTAND THIS PERFECTLY" 56.58, "ISN'T THAT WORTH EVERYTHING?" 67.38, "CHASING YOUR GOALS WITH WHAT YOU HAVE FIRST" 74.88–78.38; top/bottom pair "YOU'LL BE SURPRISED" / "HOW FAR YOU GET" 78.38–80.0. On screen 0.7–3.5 s each. Coordinator: large serif, top and bottom framing the head.
- **Captions:** VDB says burned in, bottom; coordinator's frames show small white captions mid-frame. Captions are off during 8 segments that carry punch text (VDB `captions_visible: false`).
- **Audio:** voice + background music, no SFX. 243.5 wpm, speech ratio 100%, longest pause 0 s (VDB).
- **Ending:** two full-frame text lines over the speaker (74.88–80.0 s), captions off. No end card.

### "Intense" in numbers (39179 vs the other Graphic Yaps)

| Measure | 39179 | 43830 | 43627 | Top 4 median |
|---|---|---|---|---|
| Changes per minute | 42.75 | 35.5 | 16.3 | – |
| Median segment s | 1.21 | 1.62 | 2.9 | 4.6 |
| Max segment s | 3.5 | 4.53 | 10.5 | – |
| Images per minute | 27.0 | 17.4 | 22.1 | 13.2 |
| Image on screen, median s | 1.17 | 1.55 | 2.41 | 2.7 |
| Gap between image starts, median s | 1.33 | 2.1 | 2.41 | 3.0 (pooled) |
| Longest no-image stretch s | 7.75 | 8.24 | 0 | 16.3 (VDB metric) |
| Text overlays | 13 | 3 | 1 | 2 |
| Speech rate wpm | 243.5 | 270.6 | 209.9 | 175.6 |
| Image covers speaker | full frame (speaker gone 54.5%) | overlay, middle/top | overlay, top half | overlay, mostly top |

### Compared with current SKILL.md targets

| SKILL.md target | Dense examples |
|---|---|
| Images 11+/min | 17.4, 22.1, 27.0 |
| Each image 1–3 s | medians 1.55, 2.41, 1.17; ranges 0.7–4.0, 0.84–5.84, 0.71–1.83 |
| Gap between image starts 1–3 s | medians 2.1, 2.41, 1.33; max 9.27, 5.84, 9.08 |
| First image by 2 s | 1.0, 0, 1.25 |
| Longest no-image stretch under ~5 s | 8.24 (intro), 0, 7.75; 43830 also leaves the last 5.07 s empty |
| Speech 160–255 wpm | 270.6 (above range), 209.9, 243.5 |
| Large title hook from 0 s, held ~3–5 s or all video for a list | 0–3.37 top; 0–113.86 middle (whole video); 0–2.67 top |
| Captions | all 3 bottom per VDB (coordinator frames put 39179's mid-frame) |
| Music usually none | background music in all 3 |
| Default build one continuous take | 1 of 3 (43627); 43830 uses 11 jump cuts; 39179 cuts to full-frame images 36 times |
| Images overlaid on the speaker | 43830 and 43627 yes; 39179 replaces the speaker with full-frame images |
