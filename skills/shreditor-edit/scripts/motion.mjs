// shred motion: motion graphics Claude writes as HyperFrames compositions (HTML
// with a seekable GSAP timeline), rendered to a transparent WebM and placed on
// the timeline as an overlay. The composition stays next to the project
// (`projects/<id>/motion/<slug>/`), so changing it, or its variables, is a
// re-render, not a rebuild. Guide: references/motion.md.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** The track motion overlays go on, created on top when a project has none. */
export const MOTION_TRACK = "Motion";
/** Label prefix that marks a timeline clip as a rendered motion graphic. */
export const MOTION_LABEL = "Motion: ";
/** Renders are kept inside the composition folder, so they live as long as it does. */
const RENDERS_DIR = "renders";
const PROVENANCE = "shreditor-renders.json";

/** A folder-safe name: "Lower third (v2)" -> "lower-third-v2". */
export function motionSlug(name) {
  const slug = String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("Pass --name <name> for the motion graphic");
  return slug;
}

/** "75" is frames; "2.5s" is seconds. */
export function parseAt(value, fps) {
  if (value === undefined || value === "") return undefined;
  const text = String(value).trim();
  const seconds = /^(\d+(?:\.\d+)?)s$/.exec(text);
  if (seconds) return Math.round(Number(seconds[1]) * fps);
  if (/^\d+$/.test(text)) return Number(text);
  throw new Error(`--at takes frames (75) or seconds (2.5s), got "${value}"`);
}

/**
 * A transparent starter composition at the project's canvas: a title that
 * slides in and out, with its text and accent colour as variables. Claude
 * replaces it with the real animation (the HyperFrames skills say how).
 */
export function starterComposition({
  width,
  height,
  fps,
  duration,
  title = "Title",
}) {
  const vars = JSON.stringify([
    { id: "title", type: "string", label: "Title", default: title },
    { id: "accent", type: "color", label: "Accent", default: "#f59e0b" },
  ]);
  const size = Math.round(Math.min(width, height) * 0.095);
  return `<!doctype html>
<!-- A Shreditor motion overlay. Keep the background transparent: the footage
     shows through. Canvas ${width}x${height} at ${fps} fps, the project's own. -->
<html lang="en" data-composition-variables='${vars}'>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: transparent; }
      #root { position: relative; width: 100%; height: 100%; font-family: Inter, system-ui, sans-serif; }
      #title {
        position: absolute; left: 0; right: 0; top: 46%; text-align: center;
        color: #fff; font-size: ${size}px; font-weight: 800; letter-spacing: -0.03em;
        text-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
      }
      #bar {
        position: absolute; left: 50%; top: calc(46% + ${Math.round(size * 1.25)}px);
        width: 0; height: ${Math.max(6, Math.round(size / 8))}px; transform: translateX(-50%);
        background: var(--accent);
      }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${duration}"
      data-width="${width}" data-height="${height}" data-fps="${fps}">
      <div id="bar" class="clip" data-start="0" data-duration="${duration}" data-track-index="0"></div>
      <h1 id="title" class="clip" data-start="0" data-duration="${duration}" data-track-index="1"
        data-var-text="title">${title}</h1>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      tl.fromTo('#bar', { width: 0 }, { width: ${Math.round(width * 0.5)}, duration: 0.5, ease: 'power3.out' }, 0.1)
        .fromTo('#title', { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'power3.out' }, 0.25)
        .to(['#title', '#bar'], { opacity: 0, duration: 0.35, ease: 'power2.in' }, ${Math.max(0.6, duration - 0.45)});
      window.__timelines['main'] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
}

/** The root composition's size, length and fps, read from its data-* attributes. */
export function compositionInfo(html) {
  const root = /<[^>]*data-composition-id=["'][^"']+["'][^>]*>/i.exec(
    html,
  )?.[0];
  if (!root) return null;
  const attr = (name) => {
    const m = new RegExp(`data-${name}=["']([^"']+)["']`, "i").exec(root);
    return m ? Number(m[1]) : undefined;
  };
  return {
    width: attr("width"),
    height: attr("height"),
    duration: attr("duration"),
    fps: attr("fps"),
  };
}

/** The composition folder and HTML file for a source (a folder, or an .html inside one). */
export function resolveSource(source) {
  if (!source)
    throw new Error(
      "Pass the motion composition: a HyperFrames folder or its .html",
    );
  const full = path.resolve(source);
  const stat = fs.statSync(full, { throwIfNoEntry: false });
  if (!stat) throw new Error(`No such file or folder: ${source}`);
  const dir = stat.isDirectory() ? full : path.dirname(full);
  const html = stat.isDirectory() ? path.join(full, "index.html") : full;
  if (!fs.existsSync(html)) throw new Error(`${dir} has no index.html`);
  return {
    dir,
    html,
    composition:
      path.basename(html) === "index.html" ? null : path.relative(dir, html),
  };
}

/** Problems that would make the overlay sit wrong on this project, in words. */
export function canvasWarnings(info, canvas) {
  if (!info) return ["no root composition (data-composition-id) found"];
  const out = [];
  if (info.width !== canvas.width || info.height !== canvas.height)
    out.push(
      `the composition is ${info.width}x${info.height}, the project ${canvas.width}x${canvas.height}: it will be fitted inside the canvas`,
    );
  if (!(info.duration > 0))
    out.push("the root composition has no data-duration");
  return out;
}

const hyperframes = (args, cwd, { quiet = true } = {}) =>
  spawnSync("npx", ["--yes", "hyperframes", ...args], {
    cwd,
    encoding: "utf8",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env, HYPERFRAMES_SKIP_SKILLS: "1" },
  });

/** Whether a rendered file carries an audio stream. */
function hasAudioStream(file) {
  const out = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=index",
      "-of",
      "csv=p=0",
      file,
    ],
    { encoding: "utf8" },
  );
  return out.trim().length > 0;
}

/** Seconds of a rendered file, from ffprobe. */
function probeDuration(file) {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" },
  );
  return Number(out.trim());
}

/** Render a composition to a transparent WebM in its `renders/` folder; returns the file. */
export function renderMotion({ dir, composition }, { fps, variables, say }) {
  const out = path.join(dir, RENDERS_DIR, `shreditor-${Date.now()}.webm`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args = [
    "render",
    "--format",
    "webm",
    "--fps",
    String(fps),
    "--quality",
    "looks",
  ];
  args.push("--output", out, "--quiet");
  if (composition) args.push("--composition", composition);
  if (variables) args.push("--variables", variables);
  say(
    `rendering ${path.basename(dir)} with HyperFrames (transparent WebM, ${fps} fps)…`,
  );
  const result = hyperframes(args, dir);
  if (result.status !== 0 || !fs.existsSync(out)) {
    const tail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
      .trim()
      .split("\n")
      .slice(-15);
    throw new Error(
      `HyperFrames render failed:\n${tail.join("\n")}\nRun "npx hyperframes check" in ${dir}`,
    );
  }
  return out;
}

function recordRender(dir, entry) {
  const file = path.join(dir, PROVENANCE);
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    list = [];
  }
  list.push(entry);
  fs.writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`);
}

/**
 * Ops that put a rendered overlay on the timeline (or swap one in for
 * `replace`). `muteAudio` silences a render's own sound: a composition that
 * carries the project's song (to time itself to the beats) must not play it twice.
 */
export function placementOps({
  project,
  mediaId,
  from,
  durationInFrames,
  label,
  replace,
  muteAudio,
}) {
  const tracks = project.timeline.tracks ?? [];
  const after = [
    {
      op: "updateItem",
      id: { $ref: "motion#/detail/created/0/id" },
      updates: { label },
    },
    ...(muteAudio
      ? [
          {
            op: "updateItem",
            id: { $ref: "motion#/detail/created/1/id" },
            updates: { volume: -60, label: `${label} (audio, muted)` },
            linked: false,
          },
        ]
      : []),
  ];
  if (replace) {
    const old = project.timeline.items.find((item) => item.id === replace);
    if (!old)
      throw new Error(
        `No clip ${replace} on the timeline (shred motion list <id>)`,
      );
    return [
      { op: "removeItems", ids: [old.id] },
      {
        callerId: "motion",
        op: "addClip",
        mediaId,
        trackId: old.trackId,
        from: old.from,
        durationInFrames,
      },
      ...after,
    ];
  }
  const motionTrack = tracks.find(
    (t) => t.name === MOTION_TRACK && t.kind !== "audio",
  );
  const trackOps = motionTrack
    ? []
    : [
        {
          callerId: "motionTrack",
          op: "addTrack",
          kind: "video",
          name: MOTION_TRACK,
        },
      ];
  const trackId = motionTrack
    ? motionTrack.id
    : { $ref: "motionTrack#/detail/trackId" };
  return [
    ...trackOps,
    {
      callerId: "motion",
      op: "addClip",
      mediaId,
      trackId,
      from,
      durationInFrames,
    },
    ...after,
  ];
}

export function motionCommands({
  say,
  opt,
  workspace,
  getProject,
  applyBatch,
  baseProjectId,
  importFile,
}) {
  const canvasOf = (project) => ({
    width: project.metadata?.width ?? 1080,
    height: project.metadata?.height ?? 1920,
    fps: project.metadata?.fps ?? 30,
  });

  return {
    /** Scaffold a HyperFrames project for a motion graphic, at the project's canvas. */
    async new([id]) {
      if (!id)
        throw new Error(
          "Usage: shred motion new <projectId> --name <name> [--duration 3]",
        );
      const base = baseProjectId(id);
      const slug = motionSlug(opt.name);
      const { project } = await getProject(base);
      const canvas = canvasOf(project);
      const parent = path.join(workspace(), "projects", base, "motion");
      const dir = path.join(parent, slug);
      if (fs.existsSync(dir))
        throw new Error(`${dir} exists; edit it, or pick another --name`);
      fs.mkdirSync(parent, { recursive: true });
      const init = hyperframes(
        ["init", slug, "--example", "blank", "--non-interactive"],
        parent,
      );
      if (init.status !== 0 || !fs.existsSync(path.join(dir, "index.html")))
        throw new Error(
          `hyperframes init failed:\n${(init.stderr || init.stdout || "").trim()}`,
        );
      const duration = Number(opt.duration ?? 3);
      fs.writeFileSync(
        path.join(dir, "index.html"),
        starterComposition({ ...canvas, duration, title: opt.name }),
      );
      say(`motion graphic  ${dir}`);
      say(
        `canvas          ${canvas.width}x${canvas.height} @${canvas.fps}, ${duration} s, transparent`,
      );
      say(
        "Write the animation in index.html (HyperFrames skills: /hyperframes-core, /motion-graphics),",
      );
      say(
        `check it with "npx hyperframes check", then: shred motion add <draftId> ${dir} --at <frame|2.5s>`,
      );
    },

    /** Render only: a transparent WebM next to the composition. */
    async render([source]) {
      const resolved = resolveSource(source);
      const info = compositionInfo(fs.readFileSync(resolved.html, "utf8"));
      const file = renderMotion(resolved, {
        fps: Number(opt.fps ?? info?.fps ?? 30),
        variables: opt.variables,
        say,
      });
      say(`${file}  (${probeDuration(file).toFixed(2)} s)`);
    },

    /** Render a composition and put it on a draft's timeline as an overlay (or swap a render in). */
    async add([id, source]) {
      if (!id || !source)
        throw new Error(
          "Usage: shred motion add <draftId> <motion folder|.html> [--at <frame|2.5s>] [--variables JSON] [--item <clipId>] [--keep-audio]",
        );
      const resolved = resolveSource(source);
      const { project, revision } = await getProject(id);
      const canvas = canvasOf(project);
      const info = compositionInfo(fs.readFileSync(resolved.html, "utf8"));
      for (const warning of canvasWarnings(info, canvas))
        say(`warning: ${warning}`);
      const file = renderMotion(resolved, {
        fps: canvas.fps,
        variables: opt.variables,
        say,
      });
      const durationInFrames = Math.max(
        1,
        Math.round(probeDuration(file) * canvas.fps),
      );
      const mediaId = importFile(file, baseProjectId(id));
      const slug = path.basename(resolved.dir);
      // A swapped-in render keeps the clip's place; a new one goes where --at says.
      const replaced = opt.item
        ? project.timeline.items.find((item) => item.id === opt.item)
        : null;
      const from = replaced?.from ?? parseAt(opt.at, canvas.fps) ?? 0;
      const ops = placementOps({
        project,
        mediaId,
        from,
        durationInFrames,
        label: `${MOTION_LABEL}${slug}`,
        replace: opt.item,
        muteAudio: hasAudioStream(file) && !opt["keep-audio"],
      });
      const res = await applyBatch(id, ops, revision);
      // Results come back in op order.
      const clipOp = ops.findIndex((op) => op.callerId === "motion");
      const clipId = res?.results?.[clipOp]?.detail?.created?.[0]?.id;
      recordRender(resolved.dir, {
        file,
        mediaId,
        project: baseProjectId(id),
        clipId,
        variables: opt.variables ? JSON.parse(opt.variables) : undefined,
        renderedAt: new Date().toISOString(),
      });
      say(
        `${opt.item ? "replaced" : "placed"}  ${MOTION_LABEL}${slug}  frames ${from}-${from + durationInFrames}${clipId ? `  [${clipId}]` : ""}`,
      );
      say(
        `Look at it over the footage: shred frames ${id} --at ${from + Math.round(durationInFrames / 2)}`,
      );
    },

    /** The motion graphics on a timeline, with their compositions. */
    async list([id]) {
      if (!id) throw new Error("Usage: shred motion list <projectId|draftId>");
      const { project } = await getProject(id);
      const clips = project.timeline.items.filter((item) =>
        item.label?.startsWith(MOTION_LABEL),
      );
      if (!clips.length) return say("No motion graphics on this timeline.");
      const root = path.join(
        workspace(),
        "projects",
        baseProjectId(id),
        "motion",
      );
      for (const clip of clips) {
        const slug = clip.label.slice(MOTION_LABEL.length);
        say(
          `${clip.from}-${clip.from + clip.durationInFrames}  ${clip.label}  [${clip.id}]  ${path.join(root, slug)}`,
        );
      }
    },
  };
}
