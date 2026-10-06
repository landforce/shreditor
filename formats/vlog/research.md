<!--
  Vendored from the ai-video-editor plugin: skills/vlog/references/vdb-research.md
  source-sha256: sha256:ed51802a1f235cadd4639a0eacd47ade6054081996cc4e76ad6d62e51e20650b
  Do not edit here. Change the plugin, then run: npm run formats:sync
-->

# Vlog
VDB definition: "Vlog is a documentary-style short-form video format that blends on-camera presence, B-roll footage, and voiceover narration to create personal yet polished storytelling." (https://videodatabase.io/formats/vlog)

VDB characteristics:
- Dual-channel storytelling: "The gap between audio and visual is where the storytelling lives"
- Layering: what the creator says is combined with what the viewer sees. The page says this separates Vlog from talking-head and raw selfie formats.
- "Defined by its production logic, not its subject matter"
- Subject range: "lifestyle and beauty to brand showcases and behind-the-scenes narratives", plus food, cosmetics and industrial processes
- Editorial rhythm: success depends on "how cuts sync to audio, how much visual information is packed into a short window"
- "The format rewards cutaways, close-ups, and location changes"
- "The middle of the story is as watchable as the ending"
- The page lists 5,983 videos in the format.
- Per-video classifier text (stated by VDB in get_video): "Uses a clean, 'behind-the-scenes' or personal lens with a voiceover that provides the narrative throughline or text overlay that does the same over a collection of visually appealing and well-composed B-roll clips that form the montage. May feat the subject speaking to the camera minimally to supplement the core montage of clips. When no voiceover is present an underlying music track establishes a specific mood or 'vibe.'"

Sample: 9 analyzed videos (8 typical, plus 1 atypical: 43988). All have timed editing analysis (shots-v3).

| VDB id | creator | views | duration | shots | avg shot s | link_markdown |
|---|---|---|---|---|---|---|
| 43931 | kalitaku | 1,106,865 | 104.7 s | 78 | 1.34 (med 0.82) | [VDB](https://videodatabase.io/video/43931-halloween-costume-diy-process-vlog) \| [IG](https://www.instagram.com/p/DeCPdUdy0fX) |
| 44065 | sloanealex_ | 951,500 | 95.6 s | 42 | 2.28 (med 2.07) | [VDB](https://videodatabase.io/video/44065-stanford-freshman-move-in-day-vlog) \| [TT](https://www.tiktok.com/@sloanealex_/video/7688136224053251359) |
| 44045 | barefoodtim | 436,436 | 158.3 s | 109 | 1.45 (med 1.17) | [VDB](https://videodatabase.io/video/44045-weekly-meal-prep-cooking-vlog) \| [IG](https://www.instagram.com/p/Dd_uDvruP8o) |
| 44012 | countryclubhitchhiker | 273,452 | 175.9 s | 87 | 2.02 (med 1.30) | [VDB](https://videodatabase.io/video/44012-vlogging-a-hitchhiking-golf-journey) \| [IG](https://www.instagram.com/p/Dd1dOD-MEEv) |
| 44004 | michelleylens | 272,496 | 28.6 s | 16 | 1.79 (med 1.02) | [VDB](https://videodatabase.io/video/44004-vulnerable-intro-to-travel-montage) \| [IG](https://www.instagram.com/p/Dd6a9nNiv7R) |
| 43660 | jared1s | 271,149 | 40.1 s | 19 | 2.11 (med 1.07) | [VDB](https://videodatabase.io/video/43660-full-day-of-eating-montage) \| [IG](https://www.instagram.com/p/DdozgYSJlkd) |
| 43538 | rexchexng | 266,439 | 71.5 s | 60 | 1.19 (med 0.83) | [VDB](https://videodatabase.io/video/43538-motivational-monologue-over-workout-mont) \| [IG](https://www.instagram.com/p/DdwPYswMbRd) |
| 43988 | isaacfrench_ (atypical) | 206,844 | 101.8 s | 4 | 25.4 (med 27.7) | [VDB](https://videodatabase.io/video/43988-creator-gives-tour-of-wellness-center) \| [IG](https://www.instagram.com/p/DeBNXnaR66D) |
| 44044 | anastasia.sapri | 112,093 | 24.7 s | 17 | 1.45 (med 1.37) | [VDB](https://videodatabase.io/video/44044-couples-surprise-trip-to-concert) \| [IG](https://www.instagram.com/p/DeEbKnYBqT4) |

## Spec (measured)
All figures below are measured from the sample unless they are marked "VDB-stated".

- **Length:**
  - Median 95.6 s across all 9. Range 24.7–175.9 s.
  - The sample splits into two groups:
    - Music montages with no narration: 24.7–40.1 s (44044, 44004, 43660).
    - Voiceover or talking vlogs: 71.5–175.9 s (median about 104 s).

- **Aspect:** Not measured. The analysis has no aspect field. All 9 are IG Reels or TikTok posts, so presumably 9:16 vertical.

- **Structure (beats in order, with typical timing):**
  1. Hook, 0–3.5 s. A title card and/or a spoken premise.
  2. Optional setup or context, ending around 8–18 s. Examples: a series intro, a guest reveal, the "but look at this view" turn.
  3. A body of repeating chapters. Each chapter is one sub-event: a dish, a hole, a meal, a stage of the move-in. Chapters last 6–62 s (typically 10–20 s) and hold 3–40 shots each.
     - Inside a chapter the pattern is: announce (a label or VO line), components or process in quick cuts, then the finished result held longer. Most explicit in 43660, where the result is held for 10 s with item labels.
  4. A payoff or reveal, held longer than the body shots.
  5. A sign-off or CTA in the last 2–15 s.
  - VDB sequence breakdowns show 2–12 chapters per video (median 7 in the longform group).

- **Hook (first 1–3 s):**
  - Speech starts within 0.32 s in 7 of 9. Median spoken-hook end is 3.1 s (range 1.8–4.6 s). Examples:
    - "Come move in with me to my freshman year dorm at Stanford."
    - "Here's everything I made for my teenagers this week…"
    - "Welcome to day two of…"
  - Title text on screen in 6 of 9:
    - Middle of frame in 4, top in 2 (one of the top cases is 44044's dialogue line).
    - Visible from 0–0.5 s until 3.2–4.3 s.
    - 44012 delays its title to 3.2–8.0 s, after a 2.4 s cold-open payoff shot (a putt).
  - The first frame is either:
    - the creator presenting the subject (costume, packed SUV trunk, apron, doorway), or
    - the subject itself (a mason jar being filled, a night runner).
  - Series framing appears in 2 (Day 2, Day 12).
  - First cut: median 3.17 s (range 1.9–8.9 s; 27 s in the atypical 43988).

- **Shot count / shot length / cut rhythm:**
  - Shot count: 16–109 (median 50 excluding 43988).
  - Median shot length 0.82–2.07 s (median of medians about 1.1 s).
  - Mean shot length 1.19–2.28 s.
  - Shortest shot 0.2–0.8 s. Longest shot 2.1–11.0 s (typically 6–10 s); the longest shot is always a reveal or a payoff.
  - Cuts per minute: 25.7–49.6 (median about 35).
  - Rhythm is even fast cutting inside process sequences (0.3–1.2 s per shot), broken by long holds on finished results (4–11 s).
  - Music montages (44004, 44044) cut almost evenly at about 1.0 s and 1.0–2.0 s, consistent with cutting to the beat. Beat sync itself is not measured by VDB.
  - The final shot is longer than the median shot in all 9 (median final shot about 4 s).

- **Shot selection (what kinds of shots, variety rules):**
  - B-roll dominates: 56–100% of shots (93% in 44045, 85% in 44012, 79% in 44065).
  - Talking-head shots: 0–34 per video, typically 2–11, used for the hook, check-ins and the sign-off.
  - The creator is in frame in b-roll often (performing the activity). Exception: 44045 shows the creator in only 10 of 109 shots.
  - The process gets broken into micro-steps, one action per shot. Example from 43660: pinch salt, drop in jar, lid on, tighten, lift, each 0.3–1.2 s.
  - The components or ingredients board appears before the process. The finished product closes each chapter.
  - Location changes: travel and event vlogs change location every 1–3 shots.
  - Other types seen once: screen recordings (5) and text cards (5) in 43538, and a drone shot in 44004.

- **Camera and framing:**
  - Framing is mostly medium: 64/78, 63/87 and 22/42 shots.
  - Close-ups dominate cooking: 73/109 in 44045, and most of 43660.
  - Wide shots dominate landscape and travel (44004: 11/16).
  - Camera was tagged static in most shots (the analyzer may default to static). Handheld was heavy in 44065 (26/42). Selfie-handheld was used for to-camera check-ins (6–7 per video) and for all of 43988.

- **Transitions:**
  - Hard cuts are near-universal.
  - Jump cuts appear inside talking sections: 55 of 77 cuts in 43931 (talk-heavy), 8 in 43538, 2 in 44065.
  - No dissolves, wipes or whip transitions are recorded in any of the 9.
  - One fade to black at the end (44004).

- **Text overlays (role, count, timing, position):**
  - Per video: 0–16 (median 1).
  - Roles:
    - title_hook: 0–4 s, middle.
    - Chapter or persistent labels: timestamps like "2. Breakfast, 7:44 AM" (top), and score labels like "Hole 12 Match - AS" (middle), held for the whole chapter (6–50 s).
    - Item labels on the reveal shot: 5–6 at once, spread top, left, middle, right and bottom, held for 10 s.
    - Single-word or aside punctuation: "(i'm not okay)", "GROWTH.", "before:", each about 0.9–1.6 s.
    - Closing text: "until next time x", 1.4 s.
  - When there is no VO, text overlays carry the narrative (43660 has 16 overlays and no speech).

- **Captions:**
  - Burned-in in 6 of 9; none in 3 (43931, 44065, 43660).
  - Position: bottom 3, middle 2, top 1.
  - In 44004 and 44044 the captions cover only the opening talk or dialogue (0–8.9 s and 0–3.7 s), then disappear for the music montage.
  - VDB tags "Dynamic Word-by-Word Captions" on 43988, 44045 and 43136. Caption style is not otherwise detailed in the editing analysis.

- **Graphics (types, density, timing):**
  - Rare: 3 graphic events across all 9 videos. Median 0 per minute; maximum 1.1 per minute.
  - Types:
    - Image inserts: a reference photo at 4.7–5.8 s; a "before" photo at 94.6–96.0 s (both 43931, middle, about 1.1–1.3 s).
    - Brand logo end card: 70.2–71.5 s (43538).
  - No stickers, arrows, cutouts or background swaps were recorded.

- **Audio (music / VO / sync / SFX, levels behavior):**
  - Music: background under voice in 5; foreground in 2 (the no-VO montages); none in 2 (44012 relies on sync sound, 43988 is a walk-and-talk).
  - Voice: present in 8 of 9.
    - Mostly voiceover over b-roll: 105/109 shots in 44045, 40/42 in 44065, 54/60 in 43538.
    - To-camera sync sound for the hook and check-ins.
    - Dialogue in 43931 (a FaceTime call).
  - Speech rate:
    - 175–238 wpm when narrated (median 210).
    - 84.6 wpm in 44012 (sparse reactions, longest pause 18 s).
    - 134.6 wpm in 43988.
  - Speech covers 79–99.7% of runtime in VO vlogs, with the longest pause under 1 s in 44045 and 44065. VO runs wall to wall with no breathing gaps.
  - SFX were flagged in 2 of 9 (44045, 43538).
  - In 44004 voice runs 0–8.9 s, then music only. In 44044 music lyrics are the only words after the dialogue.

- **Ending:**
  - Final shot about 1.8–11 s.
  - Types:
    - Finished reveal held (44065 room, 43660 dessert, 43931 costume).
    - Bookend callback (44045: apron off, eating a muffin).
    - Talking-head CTA (44012: "make sure you follow…"; 44065: "let me know if you want a more in-depth room tour").
    - Series cliffhanger (43931: "time to go try it on to go to part two").
    - Text card after a fade to black (44004).
    - Brand logo hold of 11 s (43538).
    - Emotional wide or embrace shot (44044).
  - A spoken CTA or next-part line is present in 4 of 9.

- **Common failure modes visible in weaker or atypical examples:**
  - 43988: 4 shots, 25 s average, 1.77 cuts per minute. This is effectively a walk-and-talk. It lacks the cutaway density VDB says the format rewards: one 3.4 s b-roll insert across 102 s, longest shot 43 s, no music, and VDB flags missed cuts inside shots.
  - 44065 (lowest outlier score, 0.35 despite 951k views):
    - VO at 238 wpm with no captions and no text after the 3.2 s title.
    - Graphics 0.
    - Chapter changes carried by VO alone.
  - 44044 (outlier 1.0): after 3.7 s the only words are song lyrics, and there is no on-screen text or narration explaining the journey.
  - With n=9 these are observations, not proven causes.

## Notes
- The exact filter that worked was `filters.format = "Vlog"`. It returned results on the first call.
- Timed editing analysis is the limiting factor:
  - Every high-view Vlog (all top-25 by views and by outlier score, 4.7M–26M views) is `not_backfilled`.
  - Only videos added around late September 2026 onward (VDB id about 43500+) had `ready` analysis.
  - The sample therefore skews toward recent, mid-performance videos (112k–1.1M views) and does not represent the format's top performers.
- I found 9 ready videos, not 10. Each creator appears once.
- The sample disagreed most on:
  - length (24.7 vs 175.9 s),
  - music level (foreground, background or none),
  - captions (6 yes, 3 no),
  - jump-cut use (heavy only in the talk-heavy 43931).
- Uncertain:
  - Aspect ratio is not in the data.
  - Beat sync is not measured. The montage rhythm claim is inferred from even shot lengths.
  - The analyzer tags most shots "static", which may understate handheld movement.
  - Caption font and style are not reported.
  - The 44044 "transcript" is song lyrics.
  - "VDB-stated" items are the definition, characteristics and classifier text above. Everything in the Spec section is measured from the 9 analyses.
- No editing briefs were generated, so no AI budget was used.

## Top 5 by views (user-supplied list)
Source: the user supplied this list (titles, views, duration, shots, cuts/min, text counts). VDB ids found with `list_creator_videos` (exact username, sort by views) and matched by title and view count. All 5 have `ready` shots-v3 analysis, fetched with `get_video(include_editing_analysis=true)`. No editing briefs generated.

Labels: **(m)** = measured by me from the shot list / measurement block; **(VDB)** = a value VDB's analysis states directly (counts_and_pacing, audio flags, classifier); **(user)** = from the user's list. Views are VDB-stated.

| VDB id | creator | views | duration | camera shots | median shot s | cuts/min | variant | link_markdown |
|---|---|---|---|---|---|---|---|---|
| 43707 | hellodimeji | 18,399,224 | 61.8 s | 14 | 3.00 | 12.6 | POV sync-dialogue vlog (no music, no VO) | [VDB](https://videodatabase.io/video/43707-toddlers-pov-during-dads-run) \| [IG](https://www.instagram.com/p/Dd6_fODsllE) |
| 43558 | brandinowang | 5,062,070 | 86.2 s | 71 | 1.03 | 48.7 | Caption-led montage over music (VO flagged, see note) | [VDB](https://videodatabase.io/video/43558-creators-2023-entrepreneurial-journey-m) \| [IG](https://www.instagram.com/p/C1pvVfuyj9a) |
| 43781 | levelvee951 | 5,021,258 | 58.0 s | 10 | 1.53 | 9.3 | Reaction/reveal with foreground music (no VO) | [VDB](https://videodatabase.io/video/43781-husband-reacts-to-wifes-makeover) \| [IG](https://www.instagram.com/p/Dd6mlRhhh2L) |
| 43584 | cheffinwithzach | 4,413,588 | 45.1 s | 41 | 0.77 | 53.3 | Music vlog with 6 s spoken open + label text (recipe) | [VDB](https://videodatabase.io/video/43584-one-pot-chicken-rice-recipe) \| [IG](https://www.instagram.com/p/DcbU6rfuGGr) |
| 37879 | buildwithbert | 3,429,199 | 177.6 s | 33 | 4.30 | 10.8 | Talk-and-walkthrough (to-camera + VO over b-roll, no music) | [VDB](https://videodatabase.io/video/37879-house-build-update-and-plans) \| [IG](https://www.instagram.com/p/DbXB9latjHl) |

Duration, shots, median shot and cuts/min are VDB counts_and_pacing values; they match the user's list. Variant labels are mine (m).

Per-video shot stats (VDB measurement.editing; thirds split by me (m)):

| id | mean s | min s | max s (what) | first cut s | cuts in thirds 1/2/3 (m) | final shot s |
|---|---|---|---|---|---|---|
| 43707 | 4.41 | 1.03 | 10.5 (sunset run, "why are you running?" exchange) | 9.37 | 3 / 4 / 6 | 2.9 |
| 43558 | 1.22 | 0.33 | 4.8 (final shot, stacking boxes) | 2.13 | 28 / 23 / 19 | 4.8 |
| 43781 | 5.80 | 0.20 | 27.0 (reveal + hug, 46.6% of runtime) | 0.90 | 6 / 2 / 1 | 3.87 (still photo) |
| 43584 | 1.10 | 0.33 | 5.17 (rice simmering, mid-video) | 0.60 | 11 / 15 / 14 | 0.9 |
| 37879 | 5.38 | 0.97 | 15.8 (backyard plans, VO over b-roll) | 2.23 | 11 / 12 / 9 | 7.83 (to-camera) |

Note on 43558: VDB flags `audio.voice = true`, tags all 71 shots `speech: voiceover`, and lists the element "Voiceover", but the speech measurement records 0 words and the transcript is null. Burned-in captions run 0–86.2 s in word-chunks ("HI", "NAME IS / BRANDON"), consistent with captioned VO. Whether the VO exists cannot be confirmed from the data.

## Spec (measured, top 5)

- **Length:** 45.1–177.6 s, median 61.8 s (m). Four of 5 are 45–86 s; only 37879 exceeds 90 s.

- **Aspect:** Not measured (no field). All 5 are IG Reels.

- **Structure (VDB sequence breakdowns, timings VDB):**
  - 43707: 4 sequences (0–18.1, 18.1–40, 40–50, 50–61.8 s) of 3–4 shots, each one exchange between father and son. No announce/result pattern; the beats are dialogue moments.
  - 43558: 7 sequences of 4–14 shots (5.4–15.2 s each), each one caption sentence/idea: intro, advice vs reality, action, hardships, shortcomings, fear/sellouts, gratitude/2024.
  - 43781: 4 sequences: reaction tease 0–2.9 s (5 shots), makeover process 2.9–27.1 s (3 shots), reveal + hug 27.1–54.1 s (1 shot), still photo 54.1–58 s. Payoff-first then flashback.
  - 43584: 6 sequences: finished dish 0–6.5 s, spice/chicken prep, searing, rice, sauce, assembly 40.1–45.1 s. Result shown first and last.
  - 37879: 6 sequences: flashback hook 0–4.6 s, to-camera intro 4.6–21.3 s, exterior 21.3–60.6 s, garage loft 60.6–133.1 s (13 shots, 72.5 s), interior 133.1–169.7 s, to-camera wrap 169.7–177.6 s.
  - Payoff-first opening (finished result or reaction before the process) in 3 of 5: 43781, 43584, 37879 (m).

- **Hook (first 1–3 s):**
  - First frame (VDB): toddler in stroller, father running behind (43707); label printer spitting shipping labels onto the floor (43558); man frozen open-mouthed in an Ulta aisle (43781); pan lid lifted on finished chicken and rice (43584); doorway into the finished interior (37879).
  - Speech start (VDB): 0.24 s (43707, dialogue), 0.32 s (43781, "What do you think?"), 0.40 s (43584, "Dishes you'd actually cook. Episode seventeen…", ends 6.18 s), 2.16 s (37879, "My name is Bert, and I'm gonna build my house.", ends 4.64 s), none measured (43558).
  - Title text: 1 of 5 has a title_hook overlay: 43707 "RUNNING WITH MY 2-YEAR-OLD TILL HE CAN RUN BESIDE ME", top, 0–9.37 s (VDB). In 43558 and 43584 the opening line is carried by the middle captions ("2023 HAS / BEEN", "dishes you'd actually cook" / "episode 17 / one pot halal cart chicken over rice") (VDB shot on_screen_text). 43781 and 37879 have no opening text.
  - Cuts in first 3 s (VDB): 0, 1, 5, 3, 1. First cut 0.6–9.37 s, median 2.13 s (m).
  - Series framing in 2 of 5: "episode 17" (43584); the recurring "My name is Bert…" line (37879).

- **Shot count / shot length / cut rhythm:**
  - Shots 10–71, median 33 (m). Median shot 0.77–4.30 s, median of medians 1.53 s (m). Mean 1.10–5.80 s. Min 0.20–1.03 s. Max 4.8–27.0 s.
  - Cuts/min splits into two groups (m): fast montage 48.7 and 53.3 (43558, 43584); slow 9.3–12.6 (43707, 43781, 37879). Nothing in between.
  - Rhythm over runtime (m): 43707 accelerates (3/4/6 cuts per third); 43558 decelerates (28/23/19); 43781 is front-loaded (6 cuts in the first 2.9 s, then 3 cuts in 55 s); 43584 and 37879 roughly even.
  - Longest shot is the payoff in 2 of 5 (43781 reveal 27 s; 43558 final 4.8 s). In the others it is a mid-video dialogue or process/explain shot (m).
  - Final shot vs the video's median shot: clearly longer in 3 (43558 4.8 vs 1.03; 43781 3.87 vs 1.53; 37879 7.83 vs 4.3), about equal in 2 (43584 0.9 vs 0.77; 43707 2.9 vs 3.0) (m).

- **Shot selection:**
  - 43707: one camera position for all 14 shots (forward-facing 360 camera on the stroller), creator on camera in 14/14, wide 12/14 (VDB).
  - 43558: b-roll 36, product close-up 26, screen recording 8, 1 black text card (15.77–16.53 s); creator on camera 12/71 (VDB).
  - 43781: b-roll 9 + 1 still photo; creator not on camera (VDB).
  - 43584: b-roll 35, product close-up 5, talking head 1 (creator tasting, 5.83–6.53 s) (VDB).
  - 37879: to-camera selfie 12, b-roll walkthrough 21 (hand pointing at where things will go) (m from VDB shot types).

- **Camera and framing (VDB counts):**
  - 43707: moving 14/14; wide 12, medium 2.
  - 43558: handheld 53, static 10, moving 5, none 3; closeup 43, wide 13, medium 12.
  - 43781: handheld 7, static 1, moving 1, none 1; medium 8, wide 2.
  - 43584: static 40/41 (overhead/counter); closeup 37, medium 4.
  - 37879: selfie_handheld 12, handheld 21; wide 16, closeup 14, medium 3 (m).

- **Transitions (VDB boundary tags):**
  - Hard cuts in all 5. No dissolves, wipes or whips recorded.
  - Jump cuts: 4 of 13 (43707, inside dialogue), 0 of 70 (43558), 4 of 9 (43781, all in the 0–2.9 s reaction stutter: shots of 0.2, 0.3, 0.2, 1.3 s), 7 of 40 (43584, inside process steps), 18 of 32 (37879, inside talk and walkthrough).
  - 43558 uses one black screen (0.77 s) at 15.77 s as a chapter break.

- **Text overlays (excluding captions):**
  - Per video: 1, 0, 0, 22, 0 (VDB counts_and_pacing). Median 0.
  - 43707: title_hook, top, 0–9.37 s (VDB).
  - 43584: 22 ingredient labels (VDB): a 9-label spice board 6.53–9.0 s (middle, top, right, bottom, left), single bottom labels 0.6–1.5 s each on each added ingredient (chicken thigh, spice mix, salt, lemon juice, olive oil, tomato paste, chicken bouillon, washed basmati rice), a 5-label sauce board 33.0–33.8 s.
  - 43558's narrative is carried entirely by on-screen word chunks that VDB classes as captions, not overlays (18 sentences in the classifier text_overlays list).

- **Captions:**
  - Burned in on 3 of 5 (VDB): 43707 bottom 0.5–58.87 s (dialogue, both speakers, uppercase); 43558 middle 0–86.23 s (whole runtime, 1–7 words per shot change); 43584 middle 0–6.53 s (opening speech only).
  - None on 43781 (8 words of speech total) and 37879 (536 words, 183.9 wpm).

- **Graphics:** 0 graphic events in all 5 (VDB). One still photo as the final shot (43781). One black text card (43558).

- **Audio (VDB flags + speech measurement):**
  - Music: none 2 (43707, 37879), background 2 (43558, 43584), foreground 1 (43781).
  - Voice: 43707 dialogue, 84.9 wpm, speech ratio 0.50, longest pause 4.96 s, last word 50.4 s (last 11.4 s wordless). 43558 0 words measured (see note). 43781 8 words, 17.1 wpm, ratio 0.03, longest pause 26.1 s. 43584 13 words, all in 0.40–6.18 s, then no speech for 38.9 s. 37879 536 words, 183.9 wpm, ratio 0.92, longest pause 2.99 s.
  - SFX flagged in 0 of 5.

- **Ending:**
  - 43707: wordless wide of the run, 2.9 s, after the "weee" downhill sprint (6.7 s).
  - 43558: final card-like wide (stacking boxes) 4.8 s with "HERE'S TO 2024…".
  - 43781: still photo of the couple, 3.87 s, after the 27 s hug.
  - 43584: final plated dish, 0.9 s.
  - 37879: to-camera wrap "that's just a little update…", 7.83 s.
  - Spoken CTA (follow / comment) in 0 of 5. Next-installment tease in 1 (37879, "I do have another series coming out", 124.9–133.1 s, not at the end).

## Top 5 vs mid-performer sample

- **Variant mix.** Mid sample: VO/talking vlogs (6) vs music montages (3). Top 5: only 1 is wall-to-wall talk (37879); 2 rely on sync sound with little or no narration (43707 dialogue, 43781 reaction); 2 are music-led with text carrying the story (43558 captions throughout, 43584 6 s spoken open then labels). The two-way VO/music split does not cover 43707 or 43781.
- **Length.** Mid: median 95.6 s, talk group 71.5–175.9 s, music group 24.7–40.1 s. Top: median 61.8 s; music-led 45.1 and 86.2 s (both longer than any mid music montage); 4 of 5 under 90 s.
- **Cuts/min.** Mid: 25.7–49.6, median ~35. Top: bimodal, 9.3–12.6 (3 videos) or 48.7–53.3 (2). None in the mid range. The 3 slow ones are below the mid minimum.
- **Median shot.** Mid: 0.82–2.07 s (median of medians ~1.1). Top: 0.77–4.30 s (median of medians 1.53). 43707 (3.0) and 37879 (4.3) exceed the mid maximum.
- **Longest shot.** Mid: 2.1–11.0 s, always reveal/payoff. Top: 4.8–27.0 s; payoff in 2 of 5 only. 43781's 27 s reveal (46.6% of runtime) has no mid equivalent.
- **First cut.** Mid: median 3.17 s. Top: median 2.13 s, range 0.6–9.37 s.
- **Hook speech start.** Mid: within 0.32 s in 7 of 9. Top: within 0.40 s in 3 of 5; 37879 at 2.16 s after a silent b-roll shot; 43558 none measured.
- **Title overlay.** Mid: on screen in 6 of 9, mostly middle, until 3.2–4.3 s. Top: overlay in 1 of 5 (top, held 9.37 s); 2 more put the opening line in middle captions.
- **Payoff-first.** Mid: 1 cold-open payoff (44012 putt). Top: 3 of 5 open on the finished result or the reaction.
- **Text overlays.** Mid median 1 (0–16). Top median 0 (0–22). Item-label boards appear in both (43660 5–6 labels held 10 s; 43584 9-label board ~2.5 s and 5-label board 0.8 s, plus single labels 0.6–1.5 s).
- **Captions.** Mid 6 of 9. Top 3 of 5. The highest-wpm top video (37879, 183.9 wpm) has none, as did mid 44065 (238 wpm), which the mid file listed as a failure mode.
- **Music.** Mid: background 5, foreground 2, none 2. Top: background 2, foreground 1, none 2.
- **Speech rate.** Mid narrated median 210 wpm (175–238). Top: only one narrated, 183.9 wpm. Sync-dialogue 43707 at 84.9 wpm with pauses to 4.96 s.
- **Jump cuts.** Mid: heavy only in talk-heavy 43931. Top: in 4 of 5; 43781 uses them as a 4-cut stutter on the reaction (0.2–1.3 s) in the first 2.9 s.
- **Camera.** Mid: mostly tagged static. Top: 43707 all moving (360 POV), 43558 mostly handheld, 37879 all handheld/selfie; static dominates only 43584.
- **Ending CTA.** Mid: spoken CTA or next-part line in 4 of 9. Top: 0 spoken CTAs at the end.
- **Graphics.** Mid 3 events across 9. Top 0 across 5.
- Caveat: n=5, from 5 different creators and 5 different setups (360 POV, product brand, salon reaction, recipe series, build series). Differences are observations; none can be attributed to performance.

## VO vlogs (expanded sample)
Scope: a Vlog here = voiceover narrating over b-roll for most of the runtime. Music-only montages and live-dialogue / POV / reaction / to-camera-led videos are excluded.

Labels: **(VDB)** = a value VDB's timed analysis states directly (counts_and_pacing, measurement.editing, measurement.speech, audio flags, shot tags, sequence_breakdown). **(m)** = computed by me from those fields (pooled medians, ranges, shares, per-section medians, counts across videos). Views are VDB-stated. All analyses fetched with `get_video(include_editing_analysis=true)`; no editing briefs generated.

Search: about 540 unique Vlog-format results screened across 25 `search_videos` calls (queries: recipe, cooking, build, renovation, house, day in the life, travel, business, small business, farm, morning routine, process, behind the scenes, week, narrated, voiceover, vlog, montage voiceover b-roll; sorted by views, outlier_score and created_at; element filter "Voiceover" on most) plus `list_creator_videos(editing_ready_only=true)` on 17 creators. About 95% of screened results were `not_backfilled` (no timed analysis), including every Vlog above ~4.5M views except the ones below. 21 ready videos were opened; 7 passed the VO test. Max 2 per creator.

Rejected after opening (reason, measured): 39378 jennaphipps 1.9M (to-camera 69% of runtime); 43887 megansheley 683k (to-camera + dialogue, VO in 4 of 25 shots); 44037 primo.cheo 314k (to-camera 34 s of 72 s, VO 18 s); 43775 seattlehanddoc 2.8M (no voice, foreground music); 39836 gisou and 42255 eloisepreen (9 s "10 Shot" format, one VO line); 43931 kalitaku (mid sample; to-camera 70 s of 105 s); 44012 (mid sample; sync sound, 84.6 wpm); 43584 cheffinwithzach (top 5; speech only 0.4–6.2 s, then music + labels, so not VO-led); 43988 (walk-and-talk, 4 shots).
Unresolved: 43558 brandinowang 5.1M and 38590 edgecleaningwa 2.2M. Both: VDB flags `voice: true`, tags every shot `speech: voiceover`, and the classifier text says "continuous studio-recorded voiceover" (43558) / "continuous spoken voiceover" (38590) (VDB-stated). But measurement.speech records 0 words and the transcript is null in both, and the full first-person script appears as on-screen caption chunks. VO cannot be confirmed from the data. Excluded from the pool. For reference only (VDB): 43558 86.2 s, 71 shots, median 1.03 s, 48.7 cuts/min, captions middle full runtime; 38590 117.9 s, 135 shots, median 0.80 s, 68.2 cuts/min, captions bottom full runtime, music background.

Pooled VO set: 7 new + 4 already in this file (37879 from the top 5; 44045, 44065, 43538 from the mid sample) = 11 videos, 9 creators.

| VDB id | creator | views | duration | shots | median shot s | cuts/min | wpm | captions | link_markdown |
|---|---|---|---|---|---|---|---|---|---|
| 37879 | buildwithbert | 3,429,199 | 177.6 s | 33 | 4.30 | 10.8 | 183.9 | none | [VDB](https://videodatabase.io/video/37879-house-build-update-and-plans) \| [IG](https://www.instagram.com/p/DbXB9latjHl) |
| 43585 (new) | cheffinwithzach | 2,923,684 | 78.5 s | 76 | 0.85 | 57.3 | 235.9 | bottom | [VDB](https://videodatabase.io/video/43585-steak-frites-recipe-step-by-step) \| [IG](https://www.instagram.com/p/Dclrn_duB13) |
| 43582 (new) | cheffinwithzach | 2,436,880 | 54.9 s | 59 | 0.80 | 63.4 | 227.4 | middle | [VDB](https://videodatabase.io/video/43582-step-by-step-thai-salad-recipe) \| [IG](https://www.instagram.com/p/DdWqSXKgS15) |
| 43589 (new) | hoda_alzubaidi | 1,400,000 | 58.5 s | 58 | 0.93 | 58.4 | 181.2 | middle | [VDB](https://videodatabase.io/video/43589-osaka-food-tour-listicle) \| [TT](https://www.tiktok.com/@hoda_alzubaidi/video/7601647821107907861) |
| 43587 (new) | hoda_alzubaidi | 1,300,000 | 41.4 s | 42 | 0.87 | 59.4 | 211.4 | none | [VDB](https://videodatabase.io/video/43587-recipe-tutorial-start-to-finish) \| [TT](https://www.tiktok.com/@hoda_alzubaidi/video/7641499902786211093) |
| 44065 | sloanealex_ | 951,500 | 95.6 s | 42 | 2.07 | 25.7 | 237.8 | none | [VDB](https://videodatabase.io/video/44065-stanford-freshman-move-in-day-vlog) \| [TT](https://www.tiktok.com/@sloanealex_/video/7688136224053251359) |
| 43742 (new) | gstaadguy | 778,715 | 52.3 s | 44 | 1.08 | 49.3 | 151.6 | bottom (from 2.5 s) | [VDB](https://videodatabase.io/video/43742-philosophical-monologue-on-luxury-lifest) \| [IG](https://www.instagram.com/p/Ddowzu7yvNF) |
| 44045 | barefoodtim | 436,436 | 158.3 s | 109 | 1.17 | 40.9 | 233.5 | middle | [VDB](https://videodatabase.io/video/44045-weekly-meal-prep-cooking-vlog) \| [IG](https://www.instagram.com/p/Dd_uDvruP8o) |
| 44052 (new) | maejeanvintage | 354,854 | 45.9 s | 19 | 1.77 | 23.6 | 213.1 | middle | [VDB](https://videodatabase.io/video/44052-jeweler-narrates-client-selection-proces) \| [IG](https://www.instagram.com/p/DdwMXAPtnaN) |
| 43538 | rexchexng | 266,439 | 71.5 s | 60 | 0.83 | 49.6 | 210.1 | middle | [VDB](https://videodatabase.io/video/43538-motivational-monologue-over-workout-mont) \| [IG](https://www.instagram.com/p/DdwPYswMbRd) |
| 43776 (new) | kylewilliamdesign | 234,806 | 91.3 s | 73 | 1.17 | 47.3 | 243.5 | bottom | [VDB](https://videodatabase.io/video/43776-diy-dollhouse-renovation-process-video) \| [IG](https://www.instagram.com/p/Dd9QyacxG6u) |

Table values are VDB measurement fields (VDB). Shots = measurement.editing.shot_count (for 43587, 43538 and 43776 this is 2–4 higher than counts_and_pacing.camera_shot_count because it counts graphic-only segments).

Per-video extras (VDB unless marked):

| id | mean s | min s | max s | first cut s | cuts in first 3 s | speech ratio | longest pause s | to-camera share (m) | final shot s | chapters (VDB) |
|---|---|---|---|---|---|---|---|---|---|---|
| 37879 | 5.38 | 0.97 | 15.8 | 2.23 | 1 | 0.92 | 2.99 | 35% | 7.83 | 6 |
| 43585 | 1.03 | 0.30 | 3.93 | 0.87 | 3 | 1.00 | 0 | 2% | 1.78 | 9 |
| 43582 | 0.93 | 0.33 | 2.60 | 0.83 | 1 | 0.99 | 0 | 0% | 0.76 | 6 |
| 43589 | 1.01 | 0.47 | 2.27 | 0.73 | 3 | 0.98 | 0.54 | 0% | 2.27 | 9 |
| 43587 | 0.99 | 0.37 | 2.63 | 0.60 | 4 | 0.99 | 0 | 0% | 2.30 | 6 |
| 44065 | 2.28 | 0.40 | 6.00 | 2.83 | 1 | 0.98 | 0.84 | 4% | 4.13 | 8 |
| 43742 | 1.19 | 0.43 | 4.43 | 2.50 | 1 | 0.93 | 0.62 | 0% | 1.35 | 6 |
| 44045 | 1.45 | 0.20 | 10.4 | 1.90 | 2 | 1.00 | 0 | 4% | 1.83 | 7 |
| 44052 | 2.41 | 1.00 | 7.47 | 1.40 | 1 | 0.98 | 0.38 | 0% | 7.47 | 4 |
| 43538 | 1.19 | 0.23 | 11.0 | 4.70 | 0 | 0.91 | 3.58 | 0% | 10.98 | 7 |
| 43776 | 1.25 | 0.25 | 3.50 | 0.58 | 4 | 0.99 | 0.58 | 0% | 1.13 | 9 |

### Spec (VO vlogs, pooled n=11)
All medians/ranges (m), computed from the (VDB) values above.

- **Length:** median 71.5 s, range 41.4–177.6 s, middle half 52–96 s.
- **Aspect:** not in the data. All 11 are IG Reels or TikTok posts.
- **Structure / chapters:**
  - VDB sequence breakdowns: 4–9 chapters per video, median 7.
  - Chapter length: median 7.9 s (range 1.6–72.5 s); in the fast group most chapters are 4–13 s. Long chapters (31–72 s) appear only in 44045 (a 62 s dish), 44065 (31 s unpacking) and 37879 (72 s loft walkthrough).
  - Chapter unit by subject: one dish (44045), one food stop (43589, 9 stops in 58.5 s, 4–10 s each), one recipe stage (43585, 43582, 43587), one room/area (37879, 44065), one client option set (44052), one build stage (43776), one argument beat (43742, 43538).
  - Order: hook (0–3.5 s, or up to 8.8 s when the hook is a montage) → numbered/sequenced chapters → result or reveal → short outro.
- **Hook (first 1–3 s):**
  - VO starts at 0–0.24 s in 10 of 11; 37879 opens on 2.2 s of silent b-roll first.
  - Spoken hook line ends at median 3.1 s (range 1.3–5.5 s). Examples: "Everything I had in Osaka" (1.5 s), "Why looking good matters." (2.2 s), "Come move in with me to my freshman year dorm at Stanford." (3.1 s), "My favorite salad right now has to be a Thai beef salad." (3.2 s).
  - First frame: the food/result or subject mid-action in 6 (43585 and 43582 searing steak, 43587 finished dish, 43589 creator eating takoyaki, 43538 runner at night, 37879 finished interior); the creator presenting in 4 (44045 apron, 44065 open trunk, 43776 at craft desk, 43742 on staircase); setup in 1 (44052 empty display case).
  - Title overlay in 3 of 11: 43587 top 0.6–5.4 s; 44065 middle 0–3.2 s; 43742 middle 0–2.5 s with a 1 s animated sparkle graphic. The other 8 put the opening line in burned-in captions only (5) or nothing (3).
  - First cut: median 1.4 s (range 0.58–4.7 s). Cuts in first 3 s: median 1 (range 0–4).
- **Shot count / shot length / cut rhythm:**
  - Shots: median 58 (range 19–109).
  - Median shot: median 1.08 s (range 0.80–4.30 s). Mean shot: median 1.19 s (0.93–5.38).
  - Shortest shot: 0.20–1.00 s. Longest shot: median 4.4 s (range 2.3–15.8 s).
  - Cuts/min: median 49.3 (range 10.8–63.4). No video falls between 25.7 and 40.9 (see subtypes).
  - Final shot is longer than the video's median shot in 9 of 11; shorter in 43582 (0.76 vs 0.80) and 43776 (1.13 vs 1.17).
  - Longest shot is the final reveal/payoff in 3 (43589 burger, 44052 client wearing ring 7.5 s, 43538 brand shot 11.0 s); in the rest it is a mid-video process shot (wine pour, slicing rolls 10.4 s, backyard walkthrough 15.8 s).
- **Pacing by section (m, from shot timings inside VDB chapters, 8 videos with full shot data):**
  - Process/body chapters: median shot 0.80–1.21 s in the fast group; 1.88 s in 44065.
  - Hook chapter vs body: shorter in 43776 (0.58 vs 1.21), 43585 (0.63 vs 0.83), 44045 (0.90 vs 1.17); longer in 43538 (2.65 vs 0.83), 43742 (1.27 vs 0.93); equal in 43582, 43589, 44065.
  - Last chapter (reveal/outro) vs body: longer in 6 of 8 (e.g. 43538 5.88 vs 0.83; 44065 3.92 vs 1.88; 43589 2.10 vs 0.93; 44045 1.83 vs 1.17).
  - Talking-head shots are short: 0.58–1.83 s median per video where present, vs b-roll 0.82–2.37 s.
- **On-camera talking head:** to-camera speech share median 0% of runtime; 0–4% in 10 of 11, 35% in 37879. Where it appears it is the hook/intro (44045, 44065, 37879), a taste-test/outro reaction (43585, 43582), or a single 0.6 s wave (43776). The creator is often in frame performing the task without speaking to camera (30/44 shots in 43742, 48/60 in 43538) but low in recipe videos (5/76 in 43585, 5/59 in 43582, 10/109 in 44045).
- **VO speech rate and pauses:**
  - wpm: median 213 (range 152–244). 8 of 11 are 210–244 wpm.
  - Speech ratio: median 0.98 (range 0.91–1.00). Longest pause: median 0.54 s (range 0–3.58 s); 0 s in 4 videos.
  - VO runs wall to wall. The only pauses over 1 s are in 37879 (2.99 s) and 43538 (3.58 s, the essay/brand piece).
- **Text overlays (non-caption):** median 0 per video (range 0–1). Roles: title_hook (3 videos, 2.5–4.8 s on screen, middle 2 / top 1); one single-word punctuation "GROWTH." (43538, middle, 0.9 s). No chapter labels, item labels or list counters in any of the 11 (contrast: 43584's 22 ingredient labels belong to the music-led recipe format, excluded).
- **Captions:** burned in on 8 of 11, all covering the full runtime (43742 from 2.5 s, after the title). Position: middle 5, bottom 3. None on 37879, 44065, 43587. VDB stores captions as one full-runtime span and does not report font, case or word-chunking; 44052's regular analysis lists them as uppercase 2–4-word chunks.
- **Graphics:** 3 events across 11 videos (median 0): a screenshot of IG comments and a story poll (43776, middle, 9.4–10.9 s), an animated sparkle around the title (43742, 1.5–2.5 s), a brand-logo end card (43538, 70.2–71.5 s). One more video uses 9 photo/still shots in the cut (43776 moodboard).
- **Transitions:** hard cuts throughout. Jump cuts: median 7 per video (range 0–26), used inside process steps (43585 26, 43589 12, 43582 9, 43587 7) and inside talk/walkthrough (37879 18). No dissolves, wipes or whips recorded.
- **Music:** background under VO in 10 of 11; none in 37879. Never foreground.
- **SFX:** flagged in 4 of 11 (43582, 44045, 43538, 43776). Type not reported.
- **Ending:**
  - Final shot median 2.3 s (range 0.76–11.0 s).
  - Types: result/reveal held (44052 7.5 s, 44065 room 4.1 s, 43587 dish 2.3 s, 43589 burger 2.3 s, 43776 room 1.1 s); taste reaction (43585 1.8 s, 43582 0.8 s); bookend to the hook shot (44045 apron off + muffin, 43742 back on the staircase); brand end card (43538 11.0 s + logo); to-camera wrap (37879 7.8 s).
  - Spoken CTA/next-part line at the end in 2 of 11 (44065 "let me know if you want a more in-depth room tour"; 43776 next-floor tease + "excited to hear how you think the attic turned out"). Last VO word lands within 0.6 s of the end in 10 of 11 (43538: 2.0 s of brand shot after the last word).

### Subtypes (m)
The cut rate splits into two groups with nothing between 25.7 and 40.9 cuts/min.

- **Fast process / listicle / essay (n=8: 43585, 43582, 43589, 43587, 43742, 44045, 43538, 43776):**
  - Length median 65 s (41.4–158.3). Shots median 59.5 (42–109).
  - Median shot 0.90 s (0.80–1.17). Cuts/min 53.4 (40.9–63.4). Longest shot 3.7 s (2.3–11.0).
  - wpm 219 (152–244). Final shot median 1.8 s.
  - One action per shot (chop, pour, sprinkle, place), closeups dominate (51–69 of shots in the two cheffinwithzach videos), mostly static camera.
  - Captions in 7 of 8.
- **Slow walkthrough / update / showcase (n=3: 37879, 44065, 44052):**
  - Length median 95.6 s (45.9–177.6). Shots median 33 (19–42).
  - Median shot 2.07 s (1.77–4.30). Cuts/min 23.6 (10.8–25.7). Longest shot 7.5 s (6.0–15.8).
  - wpm 213 (184–238). Final shot median 7.5 s (4.1–7.8), always the reveal or wrap.
  - Handheld camera moving through a space or over objects; chapters are places/rooms/option sets.
  - Captions in 1 of 3.

### Caveats
- n=11 (7 new). The slow group is n=3; its numbers are observations, not targets.
- Two creators supply 4 of the 7 new videos (cheffinwithzach, hoda_alzubaidi), and 5 of 11 pooled videos are recipe/food. The fast group is food-heavy.
- Timed analysis exists almost only for videos added from late September 2026 on, plus a few earlier ones. The highest-view VO vlogs found (16742 realiferenovation 24.1M, 39727 buildwithbert 20.4M, 22523 milktpapi 50.2M, 16871 the_avantgarde_ 10.5M, 14553 drewsxvision 9.6M) are all `not_backfilled` and are not represented. Pool views: 235k–3.4M, median 952k.
- 43585, 43582, 43589 and 43587 were analyzed with shots-v2; the rest with shots-v3. 43587 is a paid partnership (Origin Energy) and 43538 ends on a brand card.
- 37879's "voiceover" shots are live narration from behind the camera on a POV walkthrough, not a separately recorded VO (VDB tags them `voiceover`).
- Caption style, music level in dB, SFX type, beat sync and aspect ratio are not in the data.
- 43587, 44052 and 37879 numbers were read from inline tool output; the other 8 were computed from saved JSON.
