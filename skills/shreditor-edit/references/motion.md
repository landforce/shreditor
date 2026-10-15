# Motion graphics

How a motion graphic (an animated title, lower third, callout, stat hit, logo sting, transition, a full-frame motion piece, or any prompt from `agent/motion-prompts.md`) gets made and put on a Shreditor timeline.

**The short version.** Claude writes it as a HyperFrames composition (HTML whose GSAP timeline is seekable), using the HyperFrames skills for the craft. `shred motion add` renders it to a transparent WebM and puts it on the timeline's Motion track. Change the HTML or its variables and run `shred motion add --item <clipId>` to swap the new render into the same clip.

Read `/hyperframes-core` (the composition contract) before writing composition HTML. For short, unnarrated pieces also read `/motion-graphics`. `/hyperframes-animation` and `/hyperframes-keyframes` have the motion craft. Use their authoring guidance; skip their intent interview, routing, studio preview, publish and render steps: here Shreditor owns the project, the timing and the render.

## Steps

1. **Scaffold** at the project's canvas and fps:

   ```sh
   shred motion new <projectId> --name "Hole 1 title" --duration 2.5
   ```

   It makes `projects/<id>/motion/<slug>/`, a HyperFrames project whose `index.html` is a transparent starter: the root composition at the canvas size and fps, `title` and `accent` variables, a title that slides in and out. Replace the animation; keep the root's `data-width`, `data-height` and `data-fps` (the canvas), and set `data-duration` to the length you need.

2. **Overlay or full frame.** An overlay (title, lower third, callout, sticker, stat) keeps `html, body` transparent so the footage shows through. A full-frame piece (an intro card, an explainer section, a whole prompt-library film) fills the root. Either way it sits on the Motion track, above the footage.

3. **Write the motion** in `index.html` (or sub-compositions). Put what the user may change in `data-composition-variables` (text, colours, numbers) and bind them with `data-var-text`, `data-var-src` or `var(--id)`: those are the graphic's controls. Keep the style kit's fonts and colours (`shred kit status <id>`) where the project has one.

4. **Time it to the edit.** The graphic's time 0 is where it will start on the timeline (`--at`). To land hits on the music, either read beats off the project's track (the editor's ruler shows the beat grid; `shred frames` at a beat to check), or cut the project's music from the placement time (`ffmpeg -ss <seconds> -i <music> -t <duration> music.wav` into the folder), add it as `<audio data-timeline-role="music" src="music.wav">`, run `npx hyperframes beats`, and drive the timeline from `beats/*.json`: those beats are on the graphic's own clock. The render's own audio is muted on the timeline (`--keep-audio` keeps it, for a graphic with its own sound effects), so the song never plays twice.

5. **Check before rendering:** `npx hyperframes check` in the folder (lint, runtime and layout). `npx hyperframes snapshot` renders key frames as PNGs to look at.

6. **Put it on a draft:**

   ```sh
   shred draft <projectId>
   shred motion add <draftId> projects/<id>/motion/<slug> --at 2.5s --variables '{"title":"Hole 1"}'
   ```

   It renders a transparent WebM into the folder's `renders/`, imports it (category `overlay`), puts it on the `Motion` track (made on top the first time) at `--at` (frames, or seconds with `s`), labels the clip `Motion: <slug>`, and logs the render in `shreditor-renders.json`. The render matches the project's fps; a composition at another size is fitted inside the canvas, and add warns.

7. **Look at it over the footage:** `shred frames <draftId> --at <frames in, mid and out>`, open the image, check placement against the style's safe area and that it never covers a face. Then `shred check`, publish and hand over as usual.

8. **Change it.** Edit the HTML, or only the variables, then swap the new render into the same clip, place and track:

   ```sh
   shred motion add <draftId> <folder> --item <clipId> --variables '{"title":"Hole 2"}'
   ```

   `shred motion list <id>` shows the motion clips with their folders. `shred motion render <folder>` renders without touching a timeline.

9. **Reuse it.** A graphic the user likes becomes a template: put the clip in a composition (`createComposition`) and `shred templates save` it (`references/engine.md`, Motion graphics templates). Its variables stay editable by re-rendering from its folder.

## From the prompt library

`agent/motion-prompts.md` holds about 40 motion prompts collected from Prompt Motion, written for a standalone HTML-to-MP4 pipeline. Most use the same sections. Map them like this:

| Prompt section | In Shreditor |
|---|---|
| `<inputs>` | Ask the user for them, once. A song they name is usually the project's music already. |
| `<direction>` | Keep it: look, type, motion rules, the banned list. The style kit wins on fonts and colours when the project has one. |
| `<structure>` | Keep it, on the project's timing: the beats of the project's music from where the graphic starts, and the canvas of the project (a prompt's 1440x1440 or 1920x1080 becomes the project's size; recompose, don't letterbox). |
| `<build>` | Keep the rules about motion being a pure function of time (springs as closed-form, values computed from `t`, no CSS transitions or timers); in HyperFrames that is the GSAP timeline the runtime seeks. Drop the steps that render (Playwright, subframes, ffmpeg, "one HTML file" packaging) and the sound-design steps unless the user wants the graphic's own sound: `shred motion add` renders. |
| `<gotchas>` | Keep them. |
| `<start>` | Do it: show the plan (states on the beat grid) before writing code when the prompt asks. |

Prompts without sections (one-liners like "an impressive slow-reveal logo") follow `/motion-graphics`. The index at the top of `motion-prompts.md` says which prompts make an overlay and which a full-frame piece, and what each needs from the user.

## Limits

- HyperFrames renders with headless Chrome; the first render downloads its browser. A render takes roughly 5 to 10 s per second of motion at 1080x1920.
- The graphic is a rendered clip on the timeline: move, trim and layer it in the editor like any clip. Its animation changes only by editing the folder and re-rendering.
- WebM (VP9 with alpha) is the overlay format: Shreditor's preview, frame renderer and export all keep its transparency. HyperFrames' MOV (ProRes 4444) does not show in Shreditor's frame renderer; don't use it here.
