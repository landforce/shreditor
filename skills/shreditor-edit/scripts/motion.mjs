// shred motion: motion graphics Claude writes as HyperFrames compositions (HTML
// with a seekable GSAP timeline), rendered to a transparent WebM and placed on
// the timeline as an overlay. The composition stays next to the project
// (`projects/<id>/motion/<slug>/`), so changing it, or its variables, is a
// re-render, not a rebuild. Guide: references/motion.md.

import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** The track motion overlays go on ("Motion", then "Motion 2"... when they overlap in time). */
export const MOTION_TRACK = 'Motion'
/** Label prefix that marks a timeline clip as a rendered motion graphic. */
export const MOTION_LABEL = 'Motion: '
/** The HyperFrames CLI, pinned: its flags and lint rules are part of this contract. */
const HYPERFRAMES = 'hyperframes@0.8.159'
/** Renders are kept inside the composition folder, so they live as long as it does. */
const RENDERS_DIR = 'renders'
const PROVENANCE = 'shreditor-renders.json'
/** Entries of a composition folder that are not part of what renders (dot-folders aside). */
const NOT_SOURCE = new Set([RENDERS_DIR, PROVENANCE, 'node_modules'])
/** Visual settings a re-render keeps from the clip it replaces. */
const CARRIED_FIELDS = [
  'transform',
  'crop',
  'fadeIn',
  'fadeOut',
  'effects',
  'blendMode',
  'cornerPin',
  'motionModifiers',
  'motionLayers',
]

/** A folder-safe name: "Lower third (v2)" -> "lower-third-v2". */
export function motionSlug(name) {
  const slug = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug) throw new Error('Pass --name <name> for the motion graphic')
  return slug
}

/** "75" is frames; "2.5s" is seconds. */
export function parseAt(value, fps) {
  if (value === undefined || value === '') return undefined
  const text = String(value).trim()
  const seconds = /^(\d+(?:\.\d+)?)s$/.exec(text)
  if (seconds) return Math.round(Number(seconds[1]) * fps)
  if (/^\d+$/.test(text)) return Number(text)
  throw new Error(`--at takes frames (75) or seconds (2.5s), got "${value}"`)
}

/** --duration in seconds: "3", "2.5" or "2.5s". */
export function parseDuration(value, fallback = 3) {
  if (value === undefined || value === '') return fallback
  const m = /^(\d+(?:\.\d+)?)s?$/.exec(String(value).trim())
  const seconds = m ? Number(m[1]) : NaN
  if (!(seconds > 0)) throw new Error(`--duration takes seconds (3 or 2.5s), got "${value}"`)
  return seconds
}

/** --variables as a JSON object, checked before anything renders. */
export function parseVariables(value) {
  if (value === undefined || value === '') return undefined
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new Error(`--variables is not JSON: ${error.message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`--variables takes a JSON object, e.g. '{"title":"Hole 1"}'`)
  return parsed
}

const escapeHtml = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** Escapes a value for a single-quoted attribute, leaving JSON in it readable. */
const escapeAttr = (text) => String(text).replace(/&/g, '&amp;').replace(/'/g, '&#39;')

/**
 * A transparent starter composition at the project's canvas: a title that
 * slides in and out, with its text and accent colour as variables. Claude
 * replaces it with the real animation (the HyperFrames skills say how).
 */
export function starterComposition({ width, height, fps, duration, title = 'Title' }) {
  const vars = JSON.stringify([
    { id: 'title', type: 'string', label: 'Title', default: title },
    { id: 'accent', type: 'color', label: 'Accent', default: '#f59e0b' },
  ])
  const size = Math.round(Math.min(width, height) * 0.095)
  return `<!doctype html>
<!-- A Shreditor motion overlay. Keep the background transparent: the footage
     shows through. Canvas ${width}x${height} at ${fps} fps, the project's own. -->
<html lang="en" data-composition-variables='${escapeAttr(vars)}'>
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
        data-var-text="title">${escapeHtml(title)}</h1>
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
`
}

/** The root composition's size, length and fps, read from its data-* attributes. */
export function compositionInfo(html) {
  const root = /<[^>]*data-composition-id=["'][^"']+["'][^>]*>/i.exec(html)?.[0]
  if (!root) return null
  const attr = (name) => {
    const m = new RegExp(`data-${name}=["']([^"']+)["']`, 'i').exec(root)
    return m ? Number(m[1]) : undefined
  }
  return {
    width: attr('width'),
    height: attr('height'),
    duration: attr('duration'),
    fps: attr('fps'),
  }
}

/** The HyperFrames project folder holding `from`: the nearest one with hyperframes.json. */
function projectFolder(from) {
  for (let dir = from, i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'hyperframes.json'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return from
}

/**
 * The composition folder and HTML file for a source: a HyperFrames folder, an
 * .html inside one (a sub-composition renders from its project's folder), or a
 * bare name looked up in the project's motion folder (`motionRoot`).
 */
export function resolveSource(source, { motionRoot } = {}) {
  if (!source) throw new Error('Pass the motion composition: a HyperFrames folder or its .html')
  let full = path.resolve(source)
  let stat = fs.statSync(full, { throwIfNoEntry: false })
  if (!stat && motionRoot && !source.includes(path.sep)) {
    full = path.join(motionRoot, source)
    stat = fs.statSync(full, { throwIfNoEntry: false })
  }
  if (!stat) throw new Error(`No such file or folder: ${source}`)
  const html = stat.isDirectory() ? path.join(full, 'index.html') : full
  if (!fs.existsSync(html)) throw new Error(`${full} has no index.html`)
  const dir = stat.isDirectory() ? full : projectFolder(path.dirname(full))
  const composition = path.relative(dir, html)
  return {
    dir,
    html,
    composition: composition === 'index.html' ? null : composition,
  }
}

/**
 * A graphic's name: its folder's, or a sub-composition's file name
 * (`compositions/index.html`, where /motion-graphics builds, keeps the folder's).
 */
export function motionName({ dir, composition }) {
  const file = composition ? path.basename(composition, '.html') : 'index'
  return file === 'index' ? path.basename(dir) : motionSlug(file)
}

/** Problems that would make the overlay sit wrong on this project, in words. */
export function canvasWarnings(info, canvas) {
  if (!info) return ['no root composition (data-composition-id) found']
  const out = []
  if (info.width !== canvas.width || info.height !== canvas.height)
    out.push(
      `the composition is ${info.width}x${info.height}, the project ${canvas.width}x${canvas.height}: it will be fitted inside the canvas`,
    )
  if (!(info.duration > 0)) out.push('the root composition has no data-duration')
  return out
}

const hyperframes = (args, cwd) =>
  spawnSync('npx', ['--yes', HYPERFRAMES, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, HYPERFRAMES_SKIP_SKILLS: '1' },
  })

/** Terminal colour and cursor codes in HyperFrames' output. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, 'g')

/** What a failed HyperFrames run said: the spawn error, else its last lines. */
function hyperframesFailure(result) {
  if (result.error)
    return result.error.code === 'ENOENT'
      ? 'npx not found: install Node.js (https://nodejs.org)'
      : result.error.message
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    .replace(ANSI, '')
    .trim()
    .split('\n')
    .slice(-15)
    .join('\n')
}

function ffprobe(args) {
  try {
    return execFileSync('ffprobe', ['-v', 'error', ...args], {
      encoding: 'utf8',
    }).trim()
  } catch (error) {
    if (error.code === 'ENOENT')
      throw new Error('ffprobe not found: install ffmpeg (brew install ffmpeg)')
    throw error
  }
}

/** Whether a rendered file carries an audio stream. */
function hasAudioStream(file) {
  return (
    ffprobe(['-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file])
      .length > 0
  )
}

/**
 * Frames of a render's video stream. Not the file's duration: a render with
 * sound has padded audio that runs past the last frame.
 */
function probeVideoFrames(file) {
  const frames = Number(
    ffprobe([
      '-select_streams',
      'v:0',
      '-count_packets',
      '-show_entries',
      'stream=nb_read_packets',
      '-of',
      'csv=p=0',
      file,
    ]),
  )
  if (!(frames > 0)) throw new Error(`${file} has no video frames`)
  return frames
}

/** A hash of everything that decides a render: the folder's files and the settings. */
function renderKey(dir, settings) {
  const hash = createHash('sha256').update(JSON.stringify(settings))
  const walk = (folder) => {
    for (const entry of fs
      .readdirSync(folder, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      // .hyperframes/ (check reports, caches) and other dot entries change without the graphic changing.
      if (entry.name.startsWith('.')) continue
      if (folder === dir && NOT_SOURCE.has(entry.name)) continue
      const full = path.join(folder, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) hash.update(path.relative(dir, full)).update(fs.readFileSync(full))
    }
  }
  walk(dir)
  return hash.digest('hex').slice(0, 12)
}

/**
 * Render a composition to a transparent WebM in its `renders/` folder; returns
 * the file. The name carries a hash of the sources and settings, so rendering
 * something unchanged reuses the file (and re-importing it the media item).
 */
export function renderMotion({ dir, composition }, { fps, variables, say }) {
  const vars = variables ? JSON.stringify(variables) : undefined
  const key = renderKey(dir, { fps, composition, variables: vars ?? null })
  const name = motionName({ dir, composition })
  const out = path.join(dir, RENDERS_DIR, `${name}-${key}.webm`)
  if (fs.existsSync(out)) {
    say(`${path.basename(out)} is up to date (nothing changed since it rendered)`)
    return out
  }
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const args = ['render', '--format', 'webm', '--fps', String(fps)]
  // Not --quiet: it hides why a strict render refused (shown only on failure).
  args.push('--quality', 'looks', '--output', out, '--strict')
  if (composition) args.push('--composition', composition)
  if (vars) args.push('--variables', vars, '--strict-variables')
  say(`rendering ${name} with HyperFrames (transparent WebM, ${fps} fps)…`)
  const result = hyperframes(args, dir)
  if (result.status !== 0 || !fs.existsSync(out)) {
    fs.rmSync(out, { force: true })
    throw new Error(
      `HyperFrames render failed:\n${hyperframesFailure(result)}\nRun "npx ${HYPERFRAMES} check" in ${dir}`,
    )
  }
  return out
}

function recordRender(dir, entry) {
  const file = path.join(dir, PROVENANCE)
  let list = []
  try {
    list = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    list = []
  }
  list.push(entry)
  fs.writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`)
}

/** Every render logged under a project's motion folder, oldest first, with its folder. */
export function renderLog(motionRoot) {
  const out = []
  for (const entry of fs.existsSync(motionRoot)
    ? fs.readdirSync(motionRoot, { withFileTypes: true })
    : []) {
    if (!entry.isDirectory()) continue
    const dir = path.join(motionRoot, entry.name)
    try {
      for (const r of JSON.parse(fs.readFileSync(path.join(dir, PROVENANCE), 'utf8')))
        out.push({ ...r, dir })
    } catch {
      // No renders logged in this folder.
    }
  }
  return out.sort((a, b) => String(a.renderedAt).localeCompare(String(b.renderedAt)))
}

const decodeEntities = (text) =>
  text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

/** A composition's controls: its `data-composition-variables` ({id, type, label, default}...). */
export function declaredVariables(html) {
  const m =
    /data-composition-variables='([^']*)'/.exec(html) ??
    /data-composition-variables="([^"]*)"/.exec(html)
  if (!m) return []
  try {
    const list = JSON.parse(decodeEntities(m[1]))
    return Array.isArray(list) ? list.filter((v) => v && typeof v.id === 'string') : []
  } catch {
    return []
  }
}

/**
 * A placed motion clip's composition and controls: the folder it rendered from,
 * the variables it declares, and the values its current render used (the
 * declared defaults under the values passed). Null for a clip with no logged render.
 */
export function motionClip(motionRoot, clipId) {
  const render = renderLog(motionRoot).findLast((r) => r.clipId === clipId)
  if (!render) return null
  const html = path.join(render.dir, render.composition ?? 'index.html')
  const declared = fs.existsSync(html) ? declaredVariables(fs.readFileSync(html, 'utf8')) : []
  return {
    clipId,
    folder: render.dir,
    source: render.composition ? path.join(render.dir, render.composition) : render.dir,
    variables: declared,
    values: {
      ...Object.fromEntries(declared.map((v) => [v.id, v.default])),
      ...render.variables,
    },
    renderedAt: render.renderedAt,
  }
}

const isMotionClip = (item) => item.type === 'video' && item.label?.startsWith(MOTION_LABEL)

const overlaps = (items, trackId, from, to, except) =>
  items.find(
    (item) =>
      item.trackId === trackId &&
      item.id !== except &&
      item.from < to &&
      item.from + item.durationInFrames > from,
  )

/** The motion lanes in name order: "Motion", "Motion 2", ... */
const motionTracks = (tracks) =>
  tracks
    .map((t) => ({
      t,
      n: /^Motion(?: (\d+))?$/.exec(t.kind === 'audio' ? '' : (t.name ?? '')),
    }))
    .filter(({ n }) => n)
    .sort((a, b) => Number(a.n[1] ?? 1) - Number(b.n[1] ?? 1))
    .map(({ t }) => t)

/** The clip a re-render replaces: it must be a motion graphic unless `force`. */
export function replacedClip(project, id, { force = false } = {}) {
  const old = project.timeline.items.find((item) => item.id === id)
  if (!old) throw new Error(`No clip ${id} on the timeline (shred motion list <id>)`)
  if (!isMotionClip(old) && !force)
    throw new Error(
      `${id} ("${old.label}") is not a motion graphic: --item replaces only clips shred motion placed (shred motion list <id>). --force replaces it anyway.`,
    )
  return old
}

/**
 * Ops that put a rendered overlay on the timeline, or swap one in for
 * `replace` (the old clip). A new overlay goes on the first motion lane free
 * for its frames (a new lane on top when none is). A swap keeps the old clip's
 * place and visual settings. `dropAudio` removes a render's own sound: a
 * composition that carries the project's song (to time itself to the beats)
 * must not play it twice.
 */
export function placementOps({
  project,
  mediaId,
  from,
  durationInFrames,
  label,
  replace,
  dropAudio,
}) {
  const { tracks = [], items = [], keyframes = [] } = project.timeline
  const clip = { $ref: 'motion#/detail/created/0/id' }
  const tail = [
    // The source window is the render's frames exactly (the media's length can
    // run a frame longer when the render carries padded audio).
    {
      op: 'updateItem',
      id: clip,
      updates: { label, sourceStart: 0, sourceEnd: durationInFrames },
    },
    ...(dropAudio
      ? [
          {
            op: 'removeItems',
            ids: [{ $ref: 'motion#/detail/created/1/id' }],
            linked: false,
          },
        ]
      : []),
  ]
  if (replace) {
    const to = replace.from + durationInFrames
    const hit = overlaps(items, replace.trackId, replace.from, to, replace.id)
    if (hit)
      throw new Error(
        `The new render runs ${durationInFrames} frames, into "${hit.label}" at ${hit.from} on the same track: shorten the composition or move that clip first`,
      )
    const carried = Object.fromEntries(
      CARRIED_FIELDS.filter((f) => replace[f] !== undefined).map((f) => [f, replace[f]]),
    )
    const keys = keyframes
      .filter((k) => k.itemId === replace.id)
      .flatMap((k) => k.properties ?? [])
      .flatMap((p) =>
        p.keyframes
          .filter((k) => k.frame < durationInFrames)
          .map((k) => ({
            op: 'addKeyframe',
            itemId: clip,
            property: p.property,
            frame: k.frame,
            value: k.value,
            ...(k.easing ? { easing: k.easing } : {}),
          })),
      )
    return [
      { op: 'removeItems', ids: [replace.id] },
      {
        callerId: 'motion',
        op: 'addClip',
        mediaId,
        trackId: replace.trackId,
        from: replace.from,
        durationInFrames,
      },
      ...tail,
      ...(Object.keys(carried).length
        ? [{ op: 'updateItem', id: clip, updates: carried, linked: false }]
        : []),
      ...keys,
    ]
  }
  const lanes = motionTracks(tracks)
  const lane = lanes.find((t) => !overlaps(items, t.id, from, from + durationInFrames))
  const trackOps = lane
    ? []
    : [
        {
          callerId: 'motionTrack',
          op: 'addTrack',
          kind: 'video',
          name: lanes.length ? `${MOTION_TRACK} ${lanes.length + 1}` : MOTION_TRACK,
        },
      ]
  return [
    ...trackOps,
    {
      callerId: 'motion',
      op: 'addClip',
      mediaId,
      trackId: lane ? lane.id : { $ref: 'motionTrack#/detail/trackId' },
      from,
      durationInFrames,
    },
    ...tail,
  ]
}

/** What a swap changes that the user may have set on the old clip, in words. */
function swapNotes(old, durationInFrames, project) {
  const notes = []
  if ((old.sourceStart ?? 0) > 0 || (old.trimStart ?? 0) > 0)
    notes.push('the old clip was trimmed at the head: the new one plays from its start')
  if (old.durationInFrames !== durationInFrames)
    notes.push(`length ${old.durationInFrames} -> ${durationInFrames} frames`)
  const k = (project.timeline.keyframes ?? []).find((x) => x.itemId === old.id)
  if (k?.vectorProperties?.length)
    notes.push('its position/scale keyframes did not carry over: set them again')
  return notes
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
  })
  const motionRoot = (id) => path.join(workspace(), 'projects', baseProjectId(id), 'motion')

  return {
    /** Scaffold a HyperFrames project for a motion graphic, at the project's canvas. */
    async new([id]) {
      if (!id) throw new Error('Usage: shred motion new <projectId> --name <name> [--duration 3]')
      const slug = motionSlug(opt.name)
      const duration = parseDuration(opt.duration)
      const { project } = await getProject(baseProjectId(id))
      const canvas = canvasOf(project)
      const parent = motionRoot(id)
      const dir = path.join(parent, slug)
      if (fs.existsSync(dir)) throw new Error(`${dir} exists; edit it, or pick another --name`)
      fs.mkdirSync(parent, { recursive: true })
      const init = hyperframes(['init', slug, '--example', 'blank', '--non-interactive'], parent)
      if (init.status !== 0 || !fs.existsSync(path.join(dir, 'index.html')))
        throw new Error(`hyperframes init failed:\n${hyperframesFailure(init)}`)
      fs.writeFileSync(
        path.join(dir, 'index.html'),
        starterComposition({ ...canvas, duration, title: opt.name }),
      )
      say(`motion graphic  ${dir}`)
      say(
        `canvas          ${canvas.width}x${canvas.height} @${canvas.fps}, ${duration} s, transparent`,
      )
      say('Write the animation in index.html (references/motion.md says which HyperFrames skills),')
      say(
        `check it with "npx ${HYPERFRAMES} check", then: shred motion add <draftId> ${slug} --at <frame|2.5s>`,
      )
    },

    /** Render only: a transparent WebM next to the composition. */
    async render([source]) {
      const resolved = resolveSource(source)
      const variables = parseVariables(opt.variables)
      const info = compositionInfo(fs.readFileSync(resolved.html, 'utf8'))
      const file = renderMotion(resolved, {
        fps: Number(opt.fps ?? info?.fps ?? 30),
        variables,
        say,
      })
      say(`${file}  (${probeVideoFrames(file)} frames)`)
    },

    /** Render a composition and put it on a draft's timeline as an overlay (or swap a render in). */
    async add([id, source]) {
      if (!id || !source)
        throw new Error(
          'Usage: shred motion add <draftId> <motion name|folder|.html> [--at <frame|2.5s>] [--variables JSON] [--item <clipId> [--force]] [--keep-audio]',
        )
      // Everything that can be wrong with the request fails before the render.
      const resolved = resolveSource(source, { motionRoot: motionRoot(id) })
      const parsed = parseVariables(opt.variables)
      const { project, revision } = await getProject(id)
      const canvas = canvasOf(project)
      const old = opt.item ? replacedClip(project, opt.item, { force: opt.force }) : null
      const from = old ? old.from : (parseAt(opt.at, canvas.fps) ?? 0)
      // A swap from the same composition keeps the values it rendered with, so
      // --variables names only what changes.
      const before = old ? renderLog(motionRoot(id)).findLast((r) => r.clipId === old.id) : null
      const declared = new Set(
        declaredVariables(fs.readFileSync(resolved.html, 'utf8')).map((v) => v.id),
      )
      const kept =
        before?.dir === resolved.dir && (before.composition ?? null) === resolved.composition
          ? Object.fromEntries(
              Object.entries(before.variables ?? {}).filter(([k]) => declared.has(k)),
            )
          : {}
      const variables = Object.keys(kept).length ? { ...kept, ...parsed } : parsed
      if (baseProjectId(id) === id)
        say(
          `warning: ${id} is not a draft: this edits the project directly (shred draft ${id} first)`,
        )
      const info = compositionInfo(fs.readFileSync(resolved.html, 'utf8'))
      for (const warning of canvasWarnings(info, canvas)) say(`warning: ${warning}`)

      const file = renderMotion(resolved, {
        fps: canvas.fps,
        variables,
        say,
      })
      const durationInFrames = probeVideoFrames(file)
      const slug = motionName(resolved)
      const placement = {
        project,
        from,
        durationInFrames,
        label: `${MOTION_LABEL}${slug}`,
        replace: old,
        dropAudio: !opt['keep-audio'] && hasAudioStream(file),
      }
      // Placement problems (an overlap) fail here too, before anything is imported.
      placementOps({ ...placement, mediaId: 'pending' })
      const mediaId = importFile(file, baseProjectId(id))
      const ops = placementOps({ ...placement, mediaId })
      const res = await applyBatch(id, ops, revision)
      // Results come back in op order.
      const clipOp = ops.findIndex((op) => op.callerId === 'motion')
      const clipId = res?.results?.[clipOp]?.detail?.created?.[0]?.id
      recordRender(resolved.dir, {
        file,
        mediaId,
        project: baseProjectId(id),
        clipId,
        ...(resolved.composition ? { composition: resolved.composition } : {}),
        ...(variables && Object.keys(variables).length ? { variables } : {}),
        renderedAt: new Date().toISOString(),
      })
      say(
        `${old ? 'replaced' : 'placed'}  ${MOTION_LABEL}${slug}  frames ${from}-${from + durationInFrames}${clipId ? `  [${clipId}]` : ''}`,
      )
      if (old) for (const note of swapNotes(old, durationInFrames, project)) say(`note: ${note}`)
      say(
        `Look at it over the footage: shred frames ${id} --at ${from + Math.round(durationInFrames / 2)}`,
      )
    },

    /** The motion graphics on a timeline, with their compositions. */
    async list([id]) {
      if (!id) throw new Error('Usage: shred motion list <projectId|draftId>')
      const { project } = await getProject(id)
      const clips = project.timeline.items.filter(isMotionClip)
      if (!clips.length) return say('No motion graphics on this timeline.')
      const root = motionRoot(id)
      // Where each clip came from, by the render log in each composition folder.
      const sources = new Map(
        renderLog(root).map((r) => [
          r.clipId,
          r.composition ? path.join(r.dir, r.composition) : r.dir,
        ]),
      )
      for (const clip of clips) {
        const slug = clip.label.slice(MOTION_LABEL.length)
        say(
          `${clip.from}-${clip.from + clip.durationInFrames}  ${clip.label}  [${clip.id}]  ${sources.get(clip.id) ?? path.join(root, slug)}`,
        )
      }
    },

    /** A motion clip's controls and the values its render used. */
    async vars([id, clipId]) {
      if (!id || !clipId) throw new Error('Usage: shred motion vars <id> <clipId> [--json]')
      const info = motionClip(motionRoot(id), clipId)
      if (!info) throw new Error(`No render logged for clip ${clipId} (shred motion list ${id})`)
      if (opt.json) return say(JSON.stringify(info, null, 2))
      say(`${info.source}`)
      if (!info.variables.length) say('  no variables declared (data-composition-variables)')
      for (const v of info.variables)
        say(
          `  ${v.id.padEnd(16)} ${String(v.type ?? '').padEnd(7)} ${JSON.stringify(info.values[v.id])}  ${v.label ?? ''}`,
        )
      say(
        `Change: shred motion add ${id} ${path.basename(info.folder)} --item ${clipId} --variables '{"${info.variables[0]?.id ?? 'title'}":"..."}'`,
      )
    },
  }
}
