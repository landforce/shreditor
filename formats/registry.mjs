// The four Shreditor video formats. Choosing one is the first step of every
// edit: it sets the canvas, the named track layout, the rules and the numeric
// targets the scorecard checks (./scorecard.mjs). Plain ESM so the agent tools
// (Node) and the editor (Vite, as `@formats/registry.mjs`) share one source.
//
// Source of truth: the ai-video-editor plugin's format skills, vendored next to
// this file as <id>/guide.md and <id>/research.md by `npm run formats:sync`.
// Every target below is taken from a guide's Targets table or rules, never made
// up. `guide.reviewedHash` is the guide hash the targets were last checked
// against; the sync script reports when a guide changes so they get reviewed.
//
// The formats are specs and guidelines, not templates to fill: a numeric target
// is the range successful videos sit in, so missing one is a warning to look at,
// never a failure. Only the rules that make a video that format (title hook,
// speech or voiceover, music, nobody talking in a 10 Shot...) can fail.
//
// Target fields: min/max bound the usual band (null = open), ideal is the
// guide's point value, severity is 'warn' (a target can set another, but none
// does), source is where the number comes from
// ('measured' from the VDB sample, 'vdb' for VDB's stated rules, 'colin' for the
// owner's rules), seen is the range observed in the sample. A target with
// neither min nor max is informational.

/** Roles an item or track plays in a format. */
export const FORMAT_ROLES = Object.freeze([
  'speaker',
  'images',
  'plates',
  'broll',
  'shots',
  'title',
  'captions',
  'labels',
  'voice',
  'music',
  'sfx',
])

/** Every format is 9:16 short form. fps is Shreditor's default (the guides don't set one). */
const VERTICAL = Object.freeze({ width: 1080, height: 1920, fps: 30 })

const t = (key, label, unit, spec = {}) => ({
  key,
  label,
  unit,
  min: spec.min ?? null,
  max: spec.max ?? null,
  ideal: spec.ideal ?? null,
  severity: spec.severity ?? 'warn',
  source: spec.source ?? 'measured',
  ...(spec.seen ? { seen: spec.seen } : {}),
  ...(spec.metric ? { metric: spec.metric } : {}),
  ...(spec.note ? { note: spec.note } : {}),
})

const track = (name, kind, role) => ({ name, kind, role })

// A story section from the guide's Structure (a plan's beat roles, `shred plan`).
// Roles are shared across formats; `name` is the guide's word for it.
const part = (role, name, note, required = true) => ({ role, name, required, note })

// planMode: what a plan lays out (formats/plan/). A speaker format's plan is the
// performance (the speaker's lines, kept or cut, with the visuals for each); the
// others plan a story of beats.

/** Story roles a plan's beats can play, in story order. */
export const STRUCTURE_ROLES = Object.freeze(['hook', 'setup', 'body', 'payoff', 'close'])

const guide = (id, reviewedHash) => ({
  path: `formats/${id}/guide.md`,
  research: `formats/${id}/research.md`,
  source: `skills/${id}/SKILL.md`,
  researchSource: `skills/${id}/references/vdb-research.md`,
  reviewedHash,
})

/** The plugin's format decision guide, vendored as formats/choosing.md. */
export const CHOOSING_GUIDE = Object.freeze({
  path: 'formats/choosing.md',
  source: 'skills/ai-video-editor/references/formats.md',
  reviewedHash: 'sha256:b10ca596a0d5547dc6409fb6dd93a73bdcb5abf2730e60f65db9003c276f702e',
})

const graphicYap = {
  id: 'graphic-yap',
  name: 'Graphic Yap',
  tagline: 'A speaker in a real setting with a steady stream of images.',
  description:
    'Raw talking head in a real setting, silences cut, with a simple image or graphic for every noun placed above, beside or over the speaker. The speaker brings the personality, the images show what is said.',
  useWhen: 'Talking head in a real setting, naming things that can be shown as images.',
  guide: guide(
    'graphic-yap',
    'sha256:7023650993d81abfdf579b421de12f05f534332e1d4e5b4e70b10f599383e76a',
  ),
  canvas: VERTICAL,
  defaultVariant: 'standard',
  variants: [
    {
      id: 'standard',
      name: 'Standard',
      description: 'About 17 to 22 images per minute; the title hook is the only big text.',
      overrides: { targets: { imagesPerMin: { min: 17, max: 22 } } },
    },
    {
      id: 'intense',
      name: 'Intense',
      description:
        'About 27 images and 43 visual changes per minute, plus large punch lines on the speaker shots.',
      overrides: {
        targets: {
          imagesPerMin: { min: 27, ideal: 27 },
          visualChangesPerMin: t('visualChangesPerMin', 'Visual changes per minute', 'per min', {
            min: 43,
            ideal: 43,
          }),
        },
        checklist: ['Large punch lines on the speaker shots, around the head.'],
      },
    },
  ],
  structure: [
    part('hook', 'Hook', '0 to ~6 s: speech from 0, one declarative claim, first image by 2 s'),
    part('body', 'Body', 'one image per point; lists loop: name it, show it, comment'),
    part('close', 'Close', 'summary line, verbal CTA, or a gag or payoff shot; no end card'),
  ],
  planMode: 'performance',
  tracks: [
    track('Title', 'video', 'title'),
    track('Captions', 'video', 'captions'),
    track('Images', 'video', 'images'),
    track('Speaker', 'video', 'speaker'),
    track('Speaker audio', 'audio', 'speaker'),
    track('Music', 'audio', 'music'),
  ],
  categoryRoles: {
    speaker: 'speaker',
    'b-roll': 'images',
    graphics: 'images',
    overlay: 'images',
    voiceover: 'voice',
    music: 'music',
    sfx: 'sfx',
  },
  defaultRoles: { video: 'speaker', image: 'images', audio: 'speaker' },
  rules: {
    titleHook: { required: true, fromSec: 0, holdSec: { min: 3, max: null }, allowFullHold: true },
    captions: 'optional',
    speech: 'required',
    voiceover: 'optional',
    music: 'optional',
    sfx: 'optional',
    syncSound: 'allowed',
    transitions: 'none',
  },
  targets: [
    t('lengthSec', 'Length', 's', { min: 40, max: 80, ideal: 63, seen: [28, 116] }),
    t('imagesPerMin', 'Images per minute', 'per min', {
      min: 17,
      seen: [5, 27],
      note: 'more is better',
    }),
    t('imageOnScreenSec', 'Each image on screen (median)', 's', {
      min: 1.2,
      max: 2.4,
      seen: [1, 10],
      note: 'sub-1 s bursts are fine',
    }),
    t('imageGapSec', 'Gap between image starts (median)', 's', {
      min: 1.3,
      max: 2.4,
      seen: [1.2, 10],
      note: 'VDB: every second or two',
    }),
    t('firstImageSec', 'First image', 's', {
      max: 2,
      source: 'vdb',
      seen: [0, 11],
    }),
    t('longestNoNewImageSec', 'Longest stretch with no new image', 's', {
      max: 5,
      seen: [5, 35],
    }),
    t('speechWpm', 'Speech rate', 'wpm', { min: 160, max: 270 }),
    t('pauseMaxSec', 'Longest pause in speech', 's', {
      max: 1,
      note: 'speech from 0 s; activity pauses (a golf swing) can run 2 to 4 s',
    }),
  ],
  checklist: [
    'Large title hook from 0 s, top or middle, held about 3 s through the spoken hook (or all video for a running premise or list).',
    'Speech from 0 s; cut every silence over about 1 s.',
    'First image by 2 s, then an image for every noun; never more than about 5 s without a new image.',
    'One placement for the whole video: full bleed, over the speaker, or above the speaker.',
    'Jump cuts and image swaps only, on phrase ends. No transitions.',
    'Voice first: no music or a quiet bed, never foreground. SFX rare.',
    'Captions per the style kit.',
  ],
}

const greenscreen = {
  id: 'greenscreen',
  name: 'Greenscreen Talking Head',
  tagline: 'A keyed speaker over full-frame backgrounds that change with every point.',
  description:
    'The speaker is keyed over full-frame plates that change like slides to show exactly what is being said: DMs, comments, articles, photos. Voice only, wall to wall.',
  useWhen: 'Talking head shot on a green screen, or meant to be keyed.',
  guide: guide(
    'greenscreen',
    'sha256:fa60abd01af93c2da94dc84b8d1fc32fe47a397021cd96118bcd3a0e45253dc3',
  ),
  canvas: VERTICAL,
  defaultVariant: null,
  variants: [],
  structure: [
    part(
      'hook',
      'Hook',
      '0 to ~3.5 s: one spoken claim on the densest plate; change plate by ~3 s',
    ),
    part('setup', 'Setup', 'ends around 9 to 17 s'),
    part(
      'body',
      'Body',
      'a list (a run of plates per item) or a story: incident, evidence, context',
    ),
    part('close', 'Close', 'a line straight to the audience, or the thesis; no end card'),
  ],
  planMode: 'performance',
  tracks: [
    track('Title', 'video', 'title'),
    track('Captions', 'video', 'captions'),
    track('Speaker', 'video', 'speaker'),
    track('Plates', 'video', 'plates'),
    track('Speaker audio', 'audio', 'speaker'),
  ],
  categoryRoles: {
    speaker: 'speaker',
    'b-roll': 'plates',
    graphics: 'plates',
    overlay: 'plates',
    voiceover: 'voice',
    music: 'music',
    sfx: 'sfx',
  },
  defaultRoles: { video: 'speaker', image: 'plates', audio: 'speaker' },
  rules: {
    titleHook: {
      required: true,
      fromSec: 0,
      holdSec: { min: null, max: 3.5 },
      allowFullHold: false,
    },
    captions: 'default',
    speech: 'required',
    voiceover: 'none',
    music: 'none',
    sfx: 'none',
    syncSound: 'allowed',
    transitions: 'none',
  },
  targets: [
    t('lengthSec', 'Length', 's', { min: 20, max: 65, ideal: 45, seen: [19, 176] }),
    t('plateChangesPerMin', 'Background (plate) changes per minute', 'per min', {
      min: 8,
      ideal: 8,
      seen: [2, 38],
    }),
    t('visualChangesPerMin', 'All visual changes per minute', 'per min', {
      min: 16,
      max: 18,
      note: 'plates, jump cuts and reframes',
    }),
    t('medianChangeGapSec', 'Median gap between changes', 's', { min: 2.6, max: 3 }),
    t('speechWpm', 'Speech rate', 'wpm', { min: 198, max: 265, ideal: 225 }),
    t('plateCoveragePct', 'Share of runtime on greenscreen', '%', { min: 100, seen: [31, 100] }),
    t('firstPlateSec', 'First plate', 's', { max: 0, source: 'colin' }),
    t('firstPlateChangeSec', 'Background change after the hook', 's', {
      max: 3,
      source: 'colin',
      note: 'never hold the hook plate past about 3 s',
    }),
    t('longestNoChangeSec', 'Longest stretch with no visual change', 's', { source: 'colin' }),
    t('pauseMaxSec', 'Longest pause in speech', 's', {
      max: 0.5,
      source: 'colin',
    }),
    t('labelCount', 'Text layers besides title and captions', 'count', {
      max: 0,
      source: 'colin',
      note: 'the title hook is the only text layer',
    }),
  ],
  checklist: [
    'Large title hook from 0 s, top or middle; it leaves with the hook plate.',
    'First plate at 0 s, the most visually dense or emotional one; change the background when the hook ends, by about 3 s.',
    'A new plate for every beat: the literal thing being named. Swap on clause or sentence ends.',
    'Speaker keyed the whole video, close-up by default; shrink to a corner when the plate must read.',
    'Keep the screen changing between plates with jump cuts and reframes. Hard cuts only.',
    'Sync voice wall to wall; cut every pause over about 0.5 s. No music, no SFX.',
    'Captions (13 of 15 in the sample), clear of the plate content.',
  ],
}

const vlog = {
  id: 'vlog',
  name: 'Vlog',
  tagline: 'Voiceover narrating over b-roll, opened by an extremely strong text hook.',
  description:
    'Documentary-style short: VO carries the story wall to wall while the b-roll shows exactly what is said. Fast for process, recipe and listicle; slow for walk-throughs, build updates and showcases.',
  useWhen: 'B-roll with voiceover narrating over it (recorded, or the user will record it).',
  guide: guide('vlog', 'sha256:2af3b1f236cbbbc0c3b8de29850fa74079f57cf859ea8a33e84c83ade32147dc'),
  canvas: VERTICAL,
  defaultVariant: null,
  variants: [
    {
      id: 'fast',
      name: 'Fast',
      description:
        'Process, recipe, listicle, essay: about 60 shots, 0.9 s median, 53 cuts per minute.',
      overrides: {
        targets: {
          lengthSec: { ideal: 65 },
          shotCount: { ideal: 60 },
          cutsPerMin: { min: 41, ideal: 53 },
          medianShotSec: t('medianShotSec', 'Median shot', 's', { ideal: 0.9 }),
          longestShotSec: { ideal: 3.7 },
          finalShotSec: t('finalShotSec', 'Final shot', 's', { ideal: 1.8 }),
        },
        checklist: ['One action per shot, 0.3 to 1.2 s each.'],
      },
    },
    {
      id: 'slow',
      name: 'Slow',
      description:
        'Walk-through, build update, showcase: about 33 shots, 2 s median, 24 cuts per minute, reveal held longest.',
      overrides: {
        targets: {
          lengthSec: { ideal: 95 },
          shotCount: { ideal: 33 },
          cutsPerMin: { max: 26, ideal: 24 },
          medianShotSec: t('medianShotSec', 'Median shot', 's', { ideal: 2 }),
          longestShotSec: { ideal: 7.5, note: 'the reveal or wrap-up' },
          finalShotSec: t('finalShotSec', 'Final shot', 's', { ideal: 7.5, note: 'the reveal' }),
        },
        checklist: ['Let each space or step hold about 2 s; hold the reveal longest, at the end.'],
      },
    },
  ],
  structure: [
    part('hook', 'Hook', '0 to ~3 s: open on the payoff or the subject; first cut by ~1.5 s'),
    part('body', 'Body', 'the picture shows exactly what the VO says'),
    part('payoff', 'Payoff', 'the finished result or reveal, held longest'),
    part('close', 'End', 'held reveal, bookend callback or part-two tease', false),
  ],
  planMode: 'story',
  tracks: [
    track('Title', 'video', 'title'),
    track('Captions', 'video', 'captions'),
    track('B-roll', 'video', 'broll'),
    track('Voiceover', 'audio', 'voice'),
    track('Music', 'audio', 'music'),
    track('SFX', 'audio', 'sfx'),
  ],
  categoryRoles: {
    speaker: 'speaker',
    'b-roll': 'broll',
    graphics: 'broll',
    overlay: 'images',
    voiceover: 'voice',
    music: 'music',
    sfx: 'sfx',
  },
  defaultRoles: { video: 'broll', image: 'broll', audio: 'voice' },
  rules: {
    titleHook: { required: true, fromSec: 0, holdSec: { min: 3, max: 5 }, allowFullHold: false },
    captions: 'required',
    speech: 'required',
    voiceover: 'required',
    music: 'default',
    sfx: 'optional',
    syncSound: 'allowed',
    transitions: 'none',
  },
  targets: [
    t('lengthSec', 'Length', 's', {
      min: 41,
      max: 178,
      note: 'pooled range; the pace sets the ideal',
    }),
    t('shotCount', 'Shots', 'count', { min: 19, max: 109 }),
    t('cutsPerMin', 'Cuts per minute', 'per min', {
      min: 11,
      max: 63,
      note: 'no video cut at 26 to 41: pick fast or slow',
    }),
    t('longestShotSec', 'Longest shot', 's', { min: 2.3, max: 16 }),
    t('firstCutSec', 'First cut', 's', { max: 1.5, source: 'colin' }),
    t('voStartSec', 'VO starts', 's', { max: 0.25, source: 'colin' }),
    t('voCoveragePct', 'VO coverage of runtime', '%', { min: 98, note: 'wall to wall' }),
    t('speechWpm', 'VO rate', 'wpm', { min: 152, max: 244, ideal: 213 }),
    t('pauseMaxSec', 'Longest pause in VO', 's', { max: 0.5, source: 'colin' }),
    t('labelCount', 'Text besides title and captions', 'count', {
      source: 'colin',
      note: 'rare: an occasional label on a reveal shot at most',
    }),
  ],
  checklist: [
    'Write 3 to 5 text hooks and pick the strongest: a specific claim, stake or payoff that stops the scroll with the sound off. On screen from frame 0, held through the opening VO line (3 to 5 s).',
    'VO from 0.25 s, wall to wall; cut breaths and every pause over about 0.5 s.',
    'First cut by about 1.5 s; open on the payoff or the subject.',
    'Picture shows exactly what the VO says; cut on VO phrases. Hard cuts only.',
    'Captions over the VO for the full runtime.',
    'Music bed under the VO, never foreground. SFX sparingly, on actions that make a sound.',
  ],
}

const tenShot = {
  id: 'ten-shot',
  name: '10 Shot',
  tagline: 'A music-driven montage of about 12 to 16 clips with one dominant title.',
  description:
    'Short montage of distinct shots of a place, thing or experience, cut on the music, with one title that delivers the message. Nobody talks.',
  useWhen: 'Clips of a place, thing or experience. Nobody talking. Music.',
  guide: guide(
    'ten-shot',
    'sha256:d054b8f1dbe59e54e642b2911833912d88a0c559ff41e098d4862f5f670eed18',
  ),
  canvas: VERTICAL,
  defaultVariant: null,
  variants: [
    {
      id: 'even',
      name: 'Even grid',
      description:
        'Every shot about the same length (vibe content): 0.4 to 0.7 s, or 0.9 to 1.4 s.',
      overrides: { checklist: ['Every shot about the same length, on the beat grid.'] },
    },
    {
      id: 'beat',
      name: 'Beat / double-beat',
      description: 'Shots alternate between one and two beats (tours).',
      overrides: { checklist: ['Shots alternate between one and two beats.'] },
    },
    {
      id: 'shaped',
      name: 'Shaped',
      description: 'Long opener, faster middle, slower end (travel).',
      overrides: {
        targets: {
          openerRatio: { min: 1.5 },
          finalShotRatio: { min: 1.1, max: 2.6 },
        },
        checklist: ['Long opener, faster middle, slower closing hold on a summary image.'],
      },
    },
  ],
  structure: [
    part('hook', 'Hook shot', '0 to ~1-3 s: the hero image, title on it from frame 0'),
    part('setup', 'Premise setup', 'optional premise build: setup shots before the turn', false),
    part('body', 'Montage body', 'one run, or 2 to 4 short topical blocks'),
    part('payoff', 'Premise payoff', 'optional: the turn the setup builds to', false),
    part('close', 'Ending', 'a closing hold on a summary image, or end at full speed'),
  ],
  planMode: 'story',
  tracks: [
    track('Title', 'video', 'title'),
    track('Labels', 'video', 'labels'),
    track('Shots', 'video', 'shots'),
    track('Music', 'audio', 'music'),
  ],
  categoryRoles: {
    speaker: 'speaker',
    'b-roll': 'shots',
    graphics: 'images',
    overlay: 'images',
    voiceover: 'voice',
    music: 'music',
    sfx: 'sfx',
  },
  defaultRoles: { video: 'shots', image: 'shots', audio: 'music' },
  rules: {
    titleHook: { required: true, fromSec: 0, holdSec: { min: 1.9, max: 4.8 }, allowFullHold: true },
    captions: 'none',
    speech: 'none',
    voiceover: 'none',
    music: 'required',
    sfx: 'none',
    syncSound: 'none',
    transitions: 'none',
  },
  targets: [
    t('lengthSec', 'Length', 's', { min: 13, max: 15, seen: [8.3, 29] }),
    t('shotCount', 'Shots', 'count', { min: 12, max: 16, seen: [7, 24], note: 'VDB: 8 to 15' }),
    t('shotCountMin', 'At least 8 shots', 'count', {
      metric: 'shotCount',
      min: 8,
    }),
    t('medianShotSec', 'Median shot', 's', { ideal: 1, seen: [0.2, 3.7] }),
    // Pace is the edit's call: about 31 to 38 a minute for a slower 10 Shot, about
    // 70 for a fast one or after a premise pivot. Reported, not scored.
    t('cutsPerMin', 'Cuts per minute', 'per min', {
      seen: [25, 137],
      note: 'slower about 31 to 38, fast about 70',
    }),
    t('openerRatio', 'Opener vs median shot', 'x', {
      ideal: 1.5,
      note: 'a longer opener is common',
    }),
    t('finalShotRatio', 'Final shot vs median shot', 'x', {
      note: 'closing hold 1.1 to 2.6x, or end at full speed',
    }),
    t('titleWords', 'Title words', 'words', { min: 5, max: 7, seen: [3, 10] }),
    t('labelCount', 'Labels after the title', 'count', { max: 2, seen: [0, 7] }),
    t('graphicsCount', 'Graphics', 'count', { max: 0, seen: [0, 1] }),
  ],
  checklist: [
    'Choose the track first; mark beats and cut to them. Music only, foreground: no VO, no sync sound, no SFX.',
    'Open on the hero image with the title on it from frame 0 (one title, 5 to 7 words, middle of frame).',
    'Take the title down on the first section change (1.9 to 4.8 s) or hold it all video.',
    'Every shot a new subject or angle; never the same subject 3+ times; at least 8 shots.',
    'Hard cuts only; one rhythm per video; consistent camera movement and grade.',
    'No captions, nobody talking to camera. 0 to 2 labels after the title.',
  ],
}

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/** Every format definition, in the order the editor offers them. */
export const FORMATS = deepFreeze([graphicYap, greenscreen, vlog, tenShot])
export const FORMAT_IDS = Object.freeze(FORMATS.map((format) => format.id))

const BY_ID = new Map(FORMATS.map((format) => [format.id, format]))
const squash = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
const ALIASES = new Map([
  ...FORMATS.flatMap((format) => [
    [squash(format.id), format.id],
    [squash(format.name), format.id],
  ]),
  ['tenshot', 'ten-shot'],
  ['10shot', 'ten-shot'],
  ['gy', 'graphic-yap'],
  ['greenscreentalkinghead', 'greenscreen'],
  ['gs', 'greenscreen'],
])

/** A format definition by id (or name, e.g. "10 Shot"); undefined when unknown. */
export function getFormat(id) {
  if (typeof id !== 'string') return undefined
  return BY_ID.get(id) ?? BY_ID.get(ALIASES.get(squash(id)) ?? '')
}

const mergeTargets = (base, patches = {}) => {
  const merged = base.map((target) =>
    target.key in patches
      ? patches[target.key]
        ? { ...target, ...patches[target.key] }
        : null
      : target,
  )
  const added = Object.entries(patches)
    .filter(([key, patch]) => patch && !base.some((target) => target.key === key))
    .map(([key, patch]) => ({ ...t(key, patch.label ?? key, patch.unit ?? ''), ...patch }))
  return [...merged.filter(Boolean), ...added]
}

/**
 * A format with one variant's overrides merged in: targets patched by key (null
 * removes one, an unknown key adds it), rules merged, checklist extended. With
 * no variant the format's defaultVariant applies; formats without one resolve
 * to their base (pooled) targets. Throws on an unknown format or variant.
 */
export function resolveFormat(id, variant) {
  const format = getFormat(typeof id === 'object' ? id?.id : id)
  if (!format) throw new Error(`Unknown format "${id}". Formats: ${FORMAT_IDS.join(', ')}`)
  const chosen = findVariant(format, variant ?? format.defaultVariant)
  const overrides = chosen?.overrides ?? {}
  return {
    ...format,
    variant: chosen ? { id: chosen.id, name: chosen.name, description: chosen.description } : null,
    rules: mergeRules(format.rules, overrides.rules),
    targets: mergeTargets(format.targets, overrides.targets),
    checklist: [...format.checklist, ...(overrides.checklist ?? [])],
  }
}

function findVariant(format, variantId) {
  if (!variantId) return null
  const chosen = format.variants.find((v) => v.id === variantId)
  if (chosen) return chosen
  const known = format.variants.map((v) => v.id).join(', ') || 'none'
  throw new Error(`Unknown variant "${variantId}" for ${format.name}. Variants: ${known}`)
}

const mergeRules = (rules, patch = {}) => ({
  ...rules,
  ...patch,
  titleHook: { ...rules.titleHook, ...patch.titleHook },
})

/** The format recorded on a project, resolved; null when it has none (or an unknown one). */
export function projectFormat(project) {
  const recorded = project?.format
  if (!recorded?.id || !getFormat(recorded.id)) return null
  return resolveFormat(recorded.id, recorded.variant)
}

/** The `format` value to store on a project. */
export function projectFormatRecord(id, variant) {
  const format = resolveFormat(id, variant)
  return {
    id: format.id,
    ...(format.variant ? { variant: format.variant.id } : {}),
    reviewedHash: format.guide.reviewedHash,
  }
}

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/**
 * The format's named tracks, top to bottom (order 0 is the top lane), in the
 * timeline's track shape and tagged with `formatRole`. Ids default to
 * `track-<name>` (e.g. `track-speaker-audio`); pass `idFor(entry, index)` to
 * choose your own.
 */
export function createFormatTracks(id, { height = 100, idFor } = {}) {
  const format = typeof id === 'object' && id?.tracks ? id : getFormat(id)
  if (!format) throw new Error(`Unknown format "${id}"`)
  return format.tracks.map((entry, index) => ({
    id: idFor ? idFor(entry, index) : `track-${slug(entry.name)}`,
    name: entry.name,
    kind: entry.kind,
    formatRole: entry.role,
    height,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    order: index,
    items: [],
  }))
}
