<!--
  Vendored from the ai-video-editor plugin: skills/ten-shot/references/vdb-research.md
  source-sha256: sha256:3f79042eb1fda7c32717bbfc20b19159f237d19308ea784ba9041dc346b4a0cd
  Do not edit here. Change the plugin, then run: npm run formats:sync
-->

# 10 Shot
VDB definition: "The 10 Shot format is a rapid-cut editing style built on 8-15 fast clips, dynamic audio, and persistent text overlays." (https://videodatabase.io/formats/10-shot)

VDB characteristics (from the format page, paraphrased by the fetch tool unless in quotes):
- Builds momentum by resetting attention over and over with quick cuts
- Fits more information and scenes than a single-shot format
- Most common in lifestyle and vibe content aimed at an emotional response
- Uses text overlays as structure, not just as captions
- Overlays and cuts need to be synced to the audio
- Works best with at least 6-8 visually distinct moments
- Fast cutting shows up repetitive footage right away
- Applications: "The format works across a wide range of topics, from food and travel to cosmetics and real estate"
- Corpus: "2549 videos in the database use this format." Top example has 14,719,566 views (@tmatproducts)

VDB classifier definition (stored on every sampled record, verbatim): "A short music driven vlog using 6-15 clips with fast paced cuts, audio that sets the mood, and a dominant text overlay that delivers the message. Uses a rapid-fire montage of B roll and distinct clips to showcase a lifestyle, experience, location, product, vibe, or theme. It never features the subject talking."

Sample: 10 analyzed videos (VDB editing analysis shots-v3, all status "ready"). The 10 come from 10 different creators.

| VDB id | creator | views | duration | shots | avg shot s | link_markdown |
|---|---|---|---|---|---|---|
| 42039 | @eloisepreen (home tour) | 3,587,692 | 8.34 | 20 | 0.42 | [VDB](https://videodatabase.io/video/42039-quick-aesthetic-home-tour-montage) \| [IG](https://www.instagram.com/p/DbXmQ4LqfbJ) |
| 42403 | @theevanrealtor (house tour) | 1,017,867 | 15.26 | 12 | 1.27 | [VDB](https://videodatabase.io/video/42403-aesthetic-mid-century-house-tour) \| [IG](https://www.instagram.com/p/DdMxlpvyp5v) |
| 39642 | @michelleylens (travel) | 809,005 | 18.04 | 12 | 1.50 | [VDB](https://videodatabase.io/video/39642-aesthetic-travel-clips-with-music) \| [IG](https://www.instagram.com/p/DcLfrmqII96) |
| 42021 | @stokewitt (western lifestyle) | 1,861,420 | 9.70 | 8 | 1.21 | [VDB](https://videodatabase.io/video/42021-western-lifestyle-aesthetic-montage) \| [IG](https://www.instagram.com/p/DbyRPUOuLEp) |
| 41315 | @annaxsitar (rainy day, performed) | 5,794,313 | 21.85 | 15 | 1.46 | [VDB](https://videodatabase.io/video/41315-aesthetic-montage-of-a-rainy-day) \| [IG](https://www.instagram.com/p/Dc9MhtbPMk9) |
| 39839 | @elfyeah (product line) | 8,131,268 | 23.20 | 24 | 0.97 | [VDB](https://videodatabase.io/video/39839-aesthetic-product-line-showcase-montage) \| [TT](https://www.tiktok.com/@elfyeah/video/7676144449155534110) |
| 37587 | @noble.design.dessau (manufacturing) | 112,217 | 8.76 | 10 | 0.88 | [VDB](https://videodatabase.io/video/37587-quick-cuts-show-product-creation) \| [IG](https://www.instagram.com/p/DZk6IuDtjq0) |
| 39304 | @anothercottonlab (street style, Paris) | 1,207,671 | 16.60 | 8 (7 camera) | 2.08 | [VDB](https://videodatabase.io/video/39304-street-style-montage-of-runners) \| [IG](https://www.instagram.com/p/DcBM71-IeSb) |
| 43366 | @tacobell (celebrity product) | 804,916 | 10.33 | 12 | 0.86 | [VDB](https://videodatabase.io/video/43366-celebrity-aesthetic-product-montage-prom) \| [IG](https://www.instagram.com/p/DdreLzrxl67) |
| 42378 | @workinglandrovers (countryside lifestyle) | 155,893 | 10.61 | 17 | 0.62 | [VDB](https://videodatabase.io/video/42378-aesthetic-montage-of-countryside-lifesty) \| [IG](https://www.instagram.com/p/DdMFy14MTtb) |

## Spec (measured)
- **Length:** Median 12.9 s, range 8.3–23.2 s. Half the sample is 8.3–10.6 s and half is 15.3–23.2 s. The long ones are the ones with a story or a list (rainy-day performance, product swatch list, street style, travel). Place/vibe montages without a narrative run 8.3–15.3 s.
- **Aspect:** VDB does not store aspect ratio. All 10 are IG Reels or TikTok posts, so presumed 9:16 vertical. This was not checked.
- **Structure (beats in order, typical timing):**
  1. **Title hook shot(s), 0 to about 2.7 s.** Title appears at frame 0 in 10/10. It sits on the first 1–4 shots.
  2. **Montage body.** One sequence in 6/10. In 4/10 it is split into topical blocks of 3–11 shots each (house: living → kitchen → baths; product: intro → swatches → accessory → keychain → CTA; rainy day: discover → coffee → couch).
  3. **Closing hold.** The last shot is longer than that video's median shot in 8/10, at 1.1–2.6x the median. Final shot is 0.65–3.67 s, median about 1.6 s.
  - Order in the place/house videos: wide or high establishing shot → main space or anchor feature → functional rooms → details or private rooms → the most distinctive or quirky feature last (42403 ends on a pink-tiled vanity, then a vintage tub).
- **Hook (first 1–3 s):**
  - The first frame is already a hero image (wide or high-angle space, landscape, or product flat lay) with the title on it. 10/10 show the title at 0.0 s.
  - The first shot runs 0.43–3.12 s, median 1.03 s.
  - Cuts in the first 3 s: 0–5, median 2.5.
  - 5/10 hold the opening shot at least 1.5x their median shot length (elf 2.37 s, michelleylens 3.12 s, anothercottonlab 2.7 s, eloisepreen 0.8 s against a 0.33 s median, tacobell 1.23 s).
  - No spoken hook in 9/10. 42039 has an audible count-in ("One, two, three") that is part of the audio.
  - VDB hook templates in the sample include "Open with a high-angle reveal looking down into [featured space], showcasing [signature architectural feature]…" and "Open on a single [bold accent piece] dominating the foreground while the entire [space] behind it is bathed in [unified color or lighting mood]."
- **Shot count / shot length / cut rhythm:**
  - Shots: median 12, range 8–24. 7/10 fall inside VDB's stated 8–15.
  - Per-video median shot length: median 0.93 s, range 0.33–2.12 s.
  - Per-video mean shot length: median 1.09 s.
  - Shortest shot: 0.20 s. Longest shot: 3.67 s.
  - Cuts per minute: median 51, range 25–137.
  - Rhythm comes in three types:
    - **Even grid.** 42378 has every shot between 0.43 and 0.70 s. 42021 is 0.93–1.43 s. 37587 is 0.67–1.32 s.
    - **Two-length alternation (beat and double-beat).** 42403 shots cluster at 0.83–1.0 s and 1.7–1.86 s.
    - **Shaped.** Long opener, then faster in the middle, then slower toward the end. 39642 goes 3.12 → 1.4–1.7 → 0.72–0.92 → 1.5–2.16. 42039 goes 0.6 → 0.2–0.3 → 0.87 at the end.
  - VDB does not measure beat sync. The "synced to audio" claim comes from VDB's page and narrative fields ("Each cut is precisely timed to the beat of the music"). The clustered durations above are consistent with a beat grid but are not proof of one.
- **Shot selection (what kinds, variety rules):**
  - Every shot is b-roll or a product close-up.
  - Every shot is a different subject or angle. Repeats inside one video are rare and are always a new angle or framing (42039 shows the turntable 4 times at different framings).
  - Place videos: one room or feature per shot, with wides and mediums ahead of details. Tally for 42403: 7 wide, 5 medium, 0 close-up. Tally for 42039: 4 wide, 14 medium, 2 close-up.
  - Lifestyle videos mix the human element (riders, dogs, people doing things) with environment and detail inserts (boot spur, antlers, a glass on a steering wheel).
  - People on camera: sometimes (the creator in 6/10). Nobody speaks in 10/10.
- **Camera and framing:**
  - Across 138 shots, 68% are static and 32% are moving, handheld or selfie.
  - Camera style is consistent within a video. 42403 is 12/12 moving (slow pushes, glides into rooms). 39642, 37587 and 43366 are 100% static.
  - Framing is mostly medium and wide. Close-ups mainly appear in the product videos.
  - Color grading is listed as an element in 5/10 (warm or moody, consistent across shots).
- **Transitions:**
  - About 94% hard cuts (120 of 128 cuts).
  - Exceptions: jump cuts used as "magic" prop swaps (37587: 5; 43366: 1), one blur transition (43366), and one not-a-change segment (39304).
  - No wipes, zooms or speed ramps were logged.
  - Split-screen styling (three stacked panels) in 5 of 12 shots of 43366 only.
- **Text overlays (role, count, timing, position):**
  - Median 1 overlay per video, which is the title.
  - Title length: median 4 words, range 3–8.
  - Position: middle in 8/10, top in 2/10.
  - How long the title stays up: the whole video in 4/10 (9.7–21.9 s); only the opening, 2.5–3.1 s, in 4/10; until 6.6 s in 1/10. In the elf video it is replaced by a new label in each section.
  - Build-on: 42039 types the title on one word per shot over the first 4 shots ("welcome" → "welcome to" → "welcome to my" → "welcome to my home…"), about 0.6 s per step.
  - Label overlays exist only in the listicle or product case (elf: 6 labels, one per item, 1.9–3.4 s each, plus a CTA).
  - Title voice is a declarative or POV line: "The West is best", "It's Gentlemen season.", "Mid century.. Left alone", "how it felt waking up to rain today".
- **Captions:** 0/10. No speech to caption.
- **Graphics:** 0 graphics in 9/10. One end-card logo in 1/10 (39304, 12.9–16.6 s, middle). No stickers, arrows, cutouts, image inserts or backgrounds. Graphics per 10 s: median 0.
- **Audio:**
  - Music in the foreground in 10/10.
  - Voiceover: 0/10. Sync sound: none logged.
  - SFX: 0/10, as logged by VDB.
  - Music type per VDB elements: "Mood Music" 8/10, "Trending Audio" 1/10. Examples: fiddle (42021), choral (42378), upbeat electronic (37587).
  - Levels and ducking are not measured by VDB.
- **Ending:**
  - Ends on a longer hold of a summary image in 8/10: sunset over a valley, two people embracing on a hilltop, full product flat lay, group shot, bathtub reveal, record player.
  - No spoken CTA in any video. On-screen CTA in 1/10 (elf, the final 2.2 s, "secure your pickle on TikTok Shop!"). Brand logo in 1/10.
  - Several end hard on the music (VDB: "The video ends suddenly on a musical beat… encourages re-watching").
- **Common failure modes visible in weaker or atypical examples:**
  - **Low variety in framing.** 37587 (112k views, outlier score 2.38, lowest in the sample) uses the same static medium two-person framing in 10/10 shots.
  - **Repeated subject.** 42378 (156k views, second lowest) shows "dog in SUV boot" 4 times and a Range Rover 4–5 times in 17 shots. VDB's page notes that fast cutting "exposes repetitive footage."
  - **Too few cuts.** 39304 has 7 camera shots at a 2.1 s median, below VDB's 8-shot floor.
  - **Too many shots.** 39839 (24) and 42039 (20) exceed VDB's 15-shot ceiling. Both still performed (8.1M and 3.6M views), so the ceiling is not a hard limit.

## Notes
- The filter that works is filters.format = "10 Shot", the exact name. Plain keyword search "10 shot" returned 9 results, none with timed analysis. Ready editing analysis exists only on newer records (IDs above about 37,000), so the sample leans toward Aug–Sep 2026 posts. Searches run: "10 shot" (views), "travel montage" (outlier_score), "restaurant" (views), "home interior architecture" (post_date), "montage" (created_at), "aesthetic" (3 months, views), "product" (created_at), "food" (created_at).
- **Stated by VDB, not measured:** the 8–15 clip definition, the 6–8 distinct-moments minimum, the 6–15 clip classifier wording, and "synced to audio."
- **Measured from the sample:** every duration, count, position, percentage and median above. VDB says its timings are "not guaranteed frame-accurate."
- **Where the sample disagreed:**
  - Title persistence is split (whole video in 4/10, about 2.7 s in 4/10).
  - Shot length is bimodal (about 0.3–0.9 s for vibe and product videos, about 1.2–2.1 s for travel, place and street style).
  - Shot count runs both above and below VDB's range in high-view posts.
- **Not available from VDB:** aspect ratio, beat timing, music BPM, audio levels and ducking, font and style of the text overlays.
- The sample has only 2 place or building tours (42039, 42403). Other candidates exist but were not used: casitamxhome has many 10 Shot home tours, but none had ready analysis. 42101, 42263 and 42255 (eloisepreen home tours) are ready but were held to 1 per creator for variety.
- AI budget: get_video include_editing_analysis only. generate_editing_brief was not called.

## Top 5 by views (user-supplied list)

Source: the user's list of the top 5 "10 Shot" videos by views. IDs found with list_creator_videos (exact username, sort views) and matched by title and views. Data from get_video with include_editing_analysis (42723, 41448, 41315, 43114 are shots-v3; 43580 is shots-v2). generate_editing_brief was not called. 41315 (@annaxsitar) is also in the mid-performer sample above, so the two samples overlap by one video.

Label key: **(m)** = measured from VDB timed analysis, by VDB or computed here from its shot timings. **(s)** = stated in VDB's narrative or classification text, not measured. View counts are VDB's stored values.

| VDB id | creator | views | duration | camera shots | changes | median shot s | cuts/min | link_markdown |
|---|---|---|---|---|---|---|---|---|
| 42723 | @rpn (warehouse → studio) | 12,245,574 | 12.98 | 16 | 15 | 0.75 | 69.3 | [VDB](https://videodatabase.io/video/42723-warehouse-idea-to-finished-studio) \| [IG](https://www.instagram.com/p/DdX1ExRts3I) |
| 41448 | @itskatesteinberg (clothes at home) | 8,233,394 | 29.24 | 16 | 15 | 1.67 | 30.8 | [VDB](https://videodatabase.io/video/41448-relatable-clothes-at-home-montage) \| [IG](https://www.instagram.com/p/DdChPkISR9b) |
| 41315 | @annaxsitar (rainy day) | 5,794,313 | 21.85 | 15 | 14 | 1.17 | 38.4 | [VDB](https://videodatabase.io/video/41315-aesthetic-montage-of-a-rainy-day) \| [IG](https://www.instagram.com/p/Dc9MhtbPMk9) |
| 43114 | @marcelodesignx (AI vs designer) | 3,445,275 | 14.51 | 18 | 17 | 0.54 | 70.3 | [VDB](https://videodatabase.io/video/43114-comparing-ai-vs-human-web-design) \| [TT](https://www.tiktok.com/@marcelodesignx/video/7688196078793002248) |
| 43580 | @tonesterpaints (paint process) | 3,425,371 | 13.03 | 7 (8 segments) | 6 | 1.35 | 32.2 | [VDB](https://videodatabase.io/video/43580-aesthetic-paint-application-process) \| [IG](https://www.instagram.com/p/Dd21dijTI_K) |

All table values (m). VDB flags "contains_missed_cut" on 4 shots of 43114 and 2 shots of 43580 (43580's last segment is "creator holding can → finished painted wall"), so the true shot counts for those two are probably higher than listed (m, flag).

## Spec (measured, top 5)
- **Length (m):** Median 14.5 s, range 13.0–29.2 s. Three are 13.0–14.5 s; two are 21.9 and 29.2 s (both are performed sequences with the creator on camera in every shot).
- **Aspect:** Not stored by VDB. 4 IG Reels, 1 TikTok; presumed 9:16, not checked.
- **Structure (m from sequence_breakdown; premise wording (s)):**
  - 5/5 have a premise and a payoff, not a pure place/vibe tour. Before → after (42723: 5 raw-warehouse shots, 0–4.8 s, then 11 finished-studio shots). Setup → list (41448: 1 setup shot 0–4.4 s, then 15 outfit shots). Setup → bad examples → pivot → good examples (43114: 1 + 3 + 1 + 13 shots; pivot at 6.2–7.5 s). Process → result (43580: prep 3, apply 3, reveal 2). Story in three blocks (41315: discover 6, coffee 4, couch 5).
  - The section change lands at 15–52% of runtime: 4.4 s of 29.2 (15%), 4.8 of 13.0 (37%), 7.5 of 14.5 (52%) (m).
  - Only 1/5 is a place (42723, a building transformation). Its "after" order: renovated stairs → desk → lounge → camera cabinet → wide with boxer → details (gas pump, chairs, jerseys, 3D printer, Porsche) → high-angle overview last (m, shot list).
- **Hook (first 1–3 s) (m):**
  - Title on screen at 0.0 s in 5/5.
  - First frame: wide of creator in raw warehouse; creator holding mug (medium); creator gasping (medium); creator at desk looking at phone (medium); close-up of paint being stirred. Creator is in the first frame in 4/5.
  - First shot: 0.67–4.40 s, median 1.87 s. 3/5 hold the opener at least 1.5x their median shot (1.96x, 2.64x, 4.69x); 43580 1.38x; 41315 0.57x.
  - Cuts in first 3 s: 0–3, median 1.
  - No verbal hook in 5/5 (VDB hook_verbal null). 42723's speech measurement reads 6 words between 0.08 and 4.4 s ("That's why I love…"), while VDB audio says voice: false. Most likely song vocals in the first track; not confirmed.
- **Shot count / shot length / cut rhythm (m):**
  - Camera shots: median 16, range 7–18. 3/5 are above VDB's stated 8–15; 1/5 (43580, 7) is below it.
  - Per-video median shot: median 1.17 s, range 0.54–1.67 s. Per-video mean shot: median 1.46 s, range 0.81–1.83 s.
  - Shortest shot 0.47 s (42723). Longest 4.40 s (41448 opener). Pooled median of all 73 segments: 1.03 s.
  - Cuts per minute: median 38, range 31–70. Two groups: 69–70 (42723, 43114) and 31–38 (the other three).
  - Rhythm across runtime, mean shot length per third of the runtime:
    - 42723: 1.00 → 0.98 → 0.58 s. The "before" section runs 0.63–1.47 s, the first five "after" shots 0.97–1.07 s, the last six 0.47–0.62 s. It speeds up.
    - 43114: 1.73 → 0.76 → 0.53 s. Setup shots 0.97–2.53 s, then 13 shots of 0.50–0.60 s from 7.53 s to the end (an even grid). VDB (s): the montage is "synchronized with a musical beat drop."
    - 43580: 1.61 → 1.02 → 4.09 s. Faster in the middle (0.70–0.93 s), then a 4.1 s closing hold.
    - 41448: 2.06 → 1.52 → 1.97 s. 4.4 s opener, then 0.87–2.5 s. Outfits come in pairs (reveal + jump-cut pose) in 5 of 8 outfits.
    - 41315: 1.23 → 1.73 → 1.40 s. Shot length follows the action (0.5–3.67 s).
  - 2/5 accelerate into a fast even grid after the pivot (the two at ~70 cuts/min).
- **Shot selection (m):**
  - Every shot is a new subject, outfit, step or angle. One subject repeats across consecutive shots by design: the 41448 outfit pairs, the 43580 brush strokes, the 42723 staircase raw → finished.
  - Creator on camera in 5/5 (4/16, 16/16, 14/15, 2/18, 2/8 shots). Creator speaks in 0/5.
  - 43114 is 16/18 screen-recording or graphic-card shots (camera "none"); the other four are camera footage.
  - Framing: 41448 is medium in 16/16 shots, all static, one room. 42723 is wide 10, medium 5, close-up 1. 41315 is medium 7, close-up 4, wide 4. 43580 is close-up 5, medium 1, wide 2 (of 8 segments).
- **Camera and framing (m):**
  - Across the 57 camera-captured shots, 33% move (handheld or moving) and 67% are static.
  - Per video: 42723 is 14/16 moving (glides, pushes, tilts). 41315 is 5/15 handheld. 41448, 43580 and the two camera shots in 43114 are 100% static.
  - Slow motion is listed as an element on 43580 (s).
- **Transitions (m):**
  - 62 of 68 boundaries are hard cuts (91%). 5 jump cuts (4 in 41448 for outfit poses, 1 in 43580). 1 not-a-change segment (43580).
  - No wipes, zooms or speed ramps logged.
- **Text overlays (m):**
  - Per video: 1, 2, 1, 3, 3. Median 2.
  - Title length: 5–10 words, median 6 ("Bro let's get the warehouse", "how it felt waking up to rain today", "Just use AI. Nobody will notice 🤡", "hot paint colors for your home:", "Mom: "Don't pack a lot, you have clothes at home!"").
  - Title position: middle 3/5, top 2/5. Labels sit in the same position as that video's title in 3/3.
  - Title duration: whole video 1/5 (41315, 21.85 s). The other 4 end at 1.87 s, 2.53 s, 4.4 s and 4.8 s, and each ends on the cut where the section changes.
  - Labels after the title in 3/5:
    - 41448: "The clothes at home:", top, 4.4 s to the end (24.8 s).
    - 43114: "AI output", top, 2.8–5.8 s; "Vs real designer", top, 6.3–7.53 s.
    - 43580: "Viola Oxblood / by Tonester", middle, 1.87–3.3 s; "Viola Oxblood", middle, 9.8 s to the end.
  - Share of runtime with text on screen: 37%, 47%, 50%, 100%, 100%.
  - Title voice: a quote or premise line ("Bro let's get the warehouse", "Mom: …"), a sarcastic claim ("Just use AI. Nobody will notice 🤡"), a list header ending in a colon ("hot paint colors for your home:"), or a POV feeling ("how it felt waking up to rain today").
- **Captions (m):** 0/5.
- **Graphics (m):** 0 graphics in 5/5. Graphics per 10 s: 0. (43114's screen recordings are logged as shots, not graphics.)
- **Audio:**
  - Music in the foreground in 5/5 (m). Voice false in 5/5 (m).
  - SFX in 1/5 (42723) (m). VDB (s) says it's "an impactful sound effect" at the before → after cut, together with "a dramatic shift to a cinematic, atmospheric music track". That makes 2 music tracks in one video (s).
  - Element tags (s): Mood Music 4/5, Trending Audio 1/5 (41448; the transcript is song lyrics).
  - Speech rate: none (no VO). Levels and ducking are not measured.
- **Ending (m):**
  - Final shot: 42723 high-angle overview, 0.62 s (0.82x median). 41448 wink over the shoulder, 2.30 s (1.38x). 41315 cozy on the sofa, 1.02 s (0.87x), after a 3.67 s blanket shot. 43114 last website, 0.55 s (1.01x). 43580 finished painted wall with the product-name label, 4.10 s (3.03x).
  - The final shot is more than 1.1x the median in 2/5. 2/5 end at full speed with no hold (42723, 43114).
  - The final image is the payoff of the premise in 5/5 (finished studio, last outfit, peak cozy, best design, finished wall). On-screen CTA 0/5. Product or brand name on the end frame 1/5 (43580).

### Top 5 vs mid-performer sample
All figures (m) unless marked. Top 5 first, mid sample (n=10) second.
- **Premise:** A setup → payoff premise in 5/5. The mid sample was mostly pure vibe/place montages (6/10 one continuous sequence).
- **Place content:** 1/5 in the top 5 is a place, vs 2/10 place tours in the mid sample. Neither sample has many place videos.
- **Length:** median 14.5 s (13.0–29.2) vs 12.9 s (8.3–23.2). None of the top 5 is under 13 s; 5/10 of the mid sample were.
- **Camera shots:** median 16 (7–18) vs 12 (8–24). Above 15: 3/5 vs 2/10.
- **Median shot:** median 1.17 s vs 0.93 s. Mean shot: median 1.46 s vs 1.09 s.
- **Cuts per minute:** median 38 (31–70) vs 51 (25–137). The top 5 split into two groups (~31–38 and ~70).
- **Rhythm:** 2/5 accelerate into an even grid after a mid-video pivot (0.47–0.62 s and 0.50–0.60 s). In the mid sample "shaped" meant long → fast → slow.
- **First shot:** median 1.87 s vs 1.03 s. Cuts in the first 3 s: median 1 vs 2.5.
- **Closing hold:** last shot more than 1.1x median in 2/5, vs longer than median in 8/10.
- **Text overlays per video:** median 2 vs 1. Labels beyond the title: 3/5 vs 1/10 (elf only).
- **Title length:** median 6 words (5–10) vs 4 (3–8).
- **Title position:** middle 3/5, top 2/5 vs middle 8/10, top 2/10.
- **Title duration:** whole video 1/5 vs 4/10. Opening only (1.9–4.8 s, ending on a section-change cut) 4/5 vs 4/10 at 2.5–3.1 s.
- **Creator on camera:** 5/5 vs 6/10. Speech: 0 in both.
- **Same framing in every shot:** 41448 (8.2M views) is 16/16 medium static in one room. In the mid sample that pattern was the lowest performer (37587, 112k).
- **Moving camera share:** 33% vs 32% (no difference). Within-video consistency: 41315 mixes 5 handheld with 10 static.
- **Hard cuts:** 91% vs 94%. Jump cuts: 5 vs 6.
- **SFX:** 1/5 vs 0/10. Music track change mid-video: 1/5 (s) vs none noted.
- **Graphics:** 0/5 vs 1/10 (end logo). Captions: 0 in both.
- **Analyzer version:** 43580 is shots-v2; all mid-sample records and the other four are v3.
- **Limits of n=5:**
  - 5 videos from 5 creators, one of which overlaps the mid sample.
  - Every top-5 median is within the mid sample's range. The cuts-per-minute split is 2 vs 3 videos.
  - There is no control for follower count. Views are from VDB's stored snapshot.
  - None of the differences above is statistically supported. They are counts only.
