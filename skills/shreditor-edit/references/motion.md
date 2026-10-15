# Motion graphics

How a motion graphic (an animated title, lower third, callout, stat hit, logo sting, transition, a full-frame motion piece, or any prompt from `agent/motion-prompts.md`) gets made and put on a Shreditor timeline.

**The short version.** Claude writes it as a HyperFrames composition (HTML whose GSAP timeline is seekable), using the HyperFrames skills for the craft. `shred motion add` renders it to a transparent WebM and puts it on a Motion track. Change the HTML or its variables and run `shred motion add --item <clipId>` to swap the new render into the same clip.

## Which HyperFrames skills

They are plugin skills: `hyperframes:hyperframes-core` (the composition contract: read it before writing composition HTML), `hyperframes:hyperframes-animation` and `hyperframes:hyperframes-keyframes` (motion craft), `hyperframes:hyperframes-registry` (ready-made blocks: lower thirds, titles, callouts), `hyperframes:hyperframes-cli` (`check`, `snapshot`, `beats`), `hyperframes:motion-graphics` (a whole design-led piece), `hyperframes:talking-head-recut` (overlays timed to a transcript). Use their authoring guidance. Skip their intent interview, routing, studio preview, approval, publish and render steps: here Shreditor owns the project, the timing and the render.

`hyperframes:motion-graphics` makes its own project at `videos/<name>/` unless `MOTION_GRAPHICS_DIR` says otherwise, and builds into `compositions/index.html`. Point it at the shred folder (`MOTION_GRAPHICS_DIR=<folder from shred motion new>`), then add `<name>/compositions/index.html`: it renders from the folder, labelled with the folder's name.

## Quick graphics

A title, lower third or callout needs no design pass:

- **The starter.** `shred motion new` writes a title that slides in with an accent bar, with `title` and `accent` variables. Restyle it in a few lines (font, size, place, colour), or keep it, and place it with `--variables`.
- **A registry block.** `npx hyperframes@0.8.159 catalog` lists them (lower thirds are `lt-*`). In the folder, `npx hyperframes@0.8.159 add <block>`, then follow what it prints to use it from `index.html`.

Read the animation skills only for a bespoke piece.

## Steps

1. **Scaffold** at the project's canvas and fps:

   ```sh
   shred motion new <projectId> --name "Hole 1 title" --duration 2.5
   ```

   It makes `projects/<id>/motion/<slug>/`, a HyperFrames project whose `index.html` is a transparent starter: the root composition at the canvas size and fps, `title` and `accent` variables, a title that slides in and out. It prints the folder and the slug. Replace the animation; keep the root's `data-width`, `data-height` and `data-fps` (the canvas), and set `data-duration` to the length you need. `--duration` is in seconds (`2.5` or `2.5s`).

2. **Overlay or full frame.** An overlay (title, lower third, callout, sticker, stat) keeps `html, body` transparent so the footage shows through. A full-frame piece (an intro card, an explainer section, a whole prompt-library film) fills the root. Either way it sits on a Motion track, above the footage.

3. **Write the motion** in `index.html` (or sub-compositions). Put what the user may change in `data-composition-variables` (text, colours, numbers) and bind them with `data-var-text`, `data-var-src` or `var(--id)`: those are the graphic's controls. Keep the style kit's fonts and colours (`shred kit status <id>`) where the project has one.

4. **Time it to the edit.** The graphic's time 0 is where it will start on the timeline (`--at`). To land hits on the music, either read beats off the project's track (the editor's ruler shows the beat grid; `shred frames` at a beat to check), or cut the project's music from the placement time (`ffmpeg -ss <seconds> -i <music> -t <duration> music.wav` into the folder), add it as `<audio id="music" data-timeline-role="music" src="music.wav">` (the `id` is required), run `npx hyperframes@0.8.159 beats`, and drive the timeline from `beats/*.json`: those beats are on the graphic's own clock. The render's own sound is dropped from the timeline (`--keep-audio` keeps it, for a graphic with its own sound effects), so the song never plays twice.

5. **Check before rendering:** `npx hyperframes@0.8.159 check` in the folder (lint, runtime and layout). `npx hyperframes@0.8.159 snapshot` renders key frames as PNGs to look at. The render is strict too: a lint error, or a `--variables` key the composition doesn't declare, fails it with the reason.

6. **Put it on the pass's draft:**

   ```sh
   shred draft <projectId> --label "Hole titles"
   shred motion add <draftId> hole-1-title --at 2.5s --variables '{"title":"Hole 1"}'
   ```

   (`shred draft` refuses a first pass on a project without a validated plan; `--no-plan` only when the user built the timeline by hand.) The source is the slug (looked up in the project's `motion/`), a folder, or an `.html` inside one. `--at` is frames, or seconds with `s`. Arguments are checked before anything renders. It renders a transparent WebM into the folder's `renders/` (an unchanged graphic reuses its render and media), imports it (category `overlay`), and puts it on the first Motion lane free for its frames: `Motion`, then `Motion 2`... made on top when needed, so graphics can overlap in time. The clip is labelled `Motion: <slug>` and the render logged in `shreditor-renders.json`. The render matches the project's fps and the clip its frame count; a composition at another size is fitted inside the canvas, and add warns. `add` on a project id instead of a draft edits the project directly and warns.

7. **Look at it over the footage:** `shred frames <draftId> --at <frames in, mid and out>`, open the image, check placement against the style's safe area and that it never covers a face. Then `shred check`, publish and hand over as usual.

8. **Change it.** Edit the HTML, or only the variables, then swap the new render into the same clip:

   ```sh
   shred motion add <draftId> hole-1-title --item <clipId> --variables '{"title":"Hole 2"}'
   ```

   The swap keeps the clip's track and start, and what the user set on it: position and scale, crop, fades, effects, blend mode, keyframes. It notes what it can't keep (a trimmed head plays again; linked position/scale keyframes need setting again) and a change of length. A longer render that would run into the next clip on the track fails before anything changes. `--item` takes only clips `shred motion` placed (`--force` for another clip). A swap from the same composition keeps the values the clip rendered with, so `--variables` names only what changes; `shred motion vars <id> <clipId>` shows a clip's controls and current values. `shred motion list <id>` shows the motion clips with their folders. `shred motion render <folder> [--fps 30]` renders without touching a timeline.

9. **Reuse it.** A graphic the user likes can become a library template: put the clip in a composition (`createComposition`) and `shred motion save` it (`references/engine.md`, Motion graphics templates). The template holds the rendered clip, so its HyperFrames variables aren't its controls: for another version, re-render from the original folder (`projects/<id>/motion/<slug>/`, or copy that folder into the new project's `motion/`).

## From the prompt library

`agent/motion-prompts.md` holds about 40 motion prompts collected from Prompt Motion, written for a standalone HTML-to-MP4 pipeline. Its index says what each makes and needs; nearly all are full-frame films. Five (Shape morphing, Photo print, UGC ad, Prompt Motion promo, Frame by Frame) have sections; map them like this:

| Prompt section | In Shreditor |
|---|---|
| `<inputs>` | Ask the user for them, once. A song they name is usually the project's music already. |
| `<direction>` | Keep it: look, type, motion rules, the banned list. The style kit wins on fonts and colours when the project has one. |
| `<structure>` | Keep it, on the project's timing: the beats of the project's music from where the graphic starts, and the canvas of the project (a prompt's 1440x1440 or 1920x1080 becomes the project's size; recompose, don't letterbox). |
| `<build>` | Keep the rules about motion being a pure function of time (springs as closed-form, values computed from `t`, no CSS transitions or timers); in HyperFrames that is the GSAP timeline the runtime seeks. Drop the steps that render (Playwright, subframes, ffmpeg, "one HTML file" packaging) and the sound-design steps unless the user wants the graphic's own sound: `shred motion add` renders. |
| `<gotchas>` | Keep them. |
| `<start>` | Do it: show the plan (states on the beat grid) before writing code when the prompt asks. |

The rest are freeform briefs or one-liners ("an impressive slow-reveal logo"): keep what they ask for, drop their render and tooling steps (Remotion, Python, a fixed fps), and build them with `hyperframes:motion-graphics`.

## Limits

- HyperFrames renders with headless Chrome; the first render downloads its browser. A simple title renders in a few seconds; a dense piece takes several seconds per second of motion.
- The graphic is a rendered clip on the timeline: move, trim and layer it in the editor like any clip. Its animation changes only by editing the folder and re-rendering. The editor's service re-renders a clip with new control values the same way (`server/motion-bridge.mjs`: `GET motion/clip`, `POST motion/rerender`).
- WebM (VP9 with alpha) is the overlay format: Shreditor's preview, frame renderer and export all keep its transparency. HyperFrames' MOV (ProRes 4444) does not show in Shreditor's frame renderer; don't use it here.
- Renders stay in each folder's `renders/`, one per distinct version.
