// `shred cutout`: background removal on video clips (docs/background-removal.md).
//
//   shred cutout <projectId|draftId> [<itemId>...] [--subject auto|person|object] [--off]
//                [--wait] [--json]
//   shred cutout <projectId|draftId> <itemId> --stroke '<tool>:x,y;x,y;...' --at <source seconds>
//                [--size <radius>] [--clear-strokes] [--wait]
//
// With item ids it turns background removal on for those clips (one atomic
// setCutout batch; --off turns it off) and starts the analysis on the agent
// service. --wait polls until every cut-out clip's masks are stored, printing
// progress. Without item ids it prints each cut-out clip's status (and with
// --wait, analyses what is missing first). --stroke paints a correction on
// source time --at (repeat it for several): tools brush, eraser, smartBrush and
// smartEraser; points are fractions of the source frame; --size is the brush
// radius as a fraction of its short side. --clear-strokes removes them first.

const SUBJECTS = ['auto', 'person', 'object']
const TOOLS = ['brush', 'eraser', 'smartBrush', 'smartEraser']

/** `--stroke smartEraser:0.4,0.8;0.6,0.8` → an addCutoutStroke op (fields checked by the service). */
export function parseStroke(text, { id, at, size }) {
  const match = /^(\w+):(.+)$/.exec(text ?? '')
  if (!match || !TOOLS.includes(match[1]))
    throw new Error(`--stroke must be <tool>:x,y;x,y... with tool one of ${TOOLS.join(', ')}`)
  const points = match[2].split(';').map((pair) => pair.split(',').map(Number))
  if (points.some((p) => p.length !== 2 || p.some((v) => !Number.isFinite(v))))
    throw new Error(`--stroke points must be x,y pairs (fractions of the source frame): ${text}`)
  const seconds = Number(at)
  if (at === undefined || !Number.isFinite(seconds)) throw new Error('--stroke needs --at <source seconds>')
  return { op: 'addCutoutStroke', id, tool: match[1], points, at: seconds, ...(size ? { size: Number(size) } : {}) }
}

/** The ops for `shred cutout <id> <itemIds...>`: turn on (or off), then any stroke edits. */
function cutoutOps(itemIds, opt) {
  const ops = itemIds.map((itemId) => ({
    op: 'setCutout',
    id: itemId,
    enabled: !opt.off,
    ...(opt.subject ? { subject: opt.subject } : {}),
  }))
  for (const itemId of itemIds) {
    if (opt['clear-strokes']) ops.push({ op: 'clearCutoutStrokes', id: itemId })
    for (const text of opt.stroke ?? []) ops.push(parseStroke(text, { id: itemId, at: opt.at, size: opt.size }))
  }
  return ops
}
const POLL_MS = 1500

function describe(item) {
  const subject =
    item.subject === 'auto' && item.resolvedSubject ? `auto→${item.resolvedSubject}` : item.subject
  if (item.state === 'no-media') return `${item.itemId}  ${subject}  media missing`
  const model = item.model ? `  ${item.model}` : ''
  const edge = `${item.feather ? `  feather ${item.feather}px` : ''}${item.invert ? '  inverted' : ''}`
  const strokes = item.strokes ? `  ${item.strokes} strokes (${item.regionsTracked}/${item.regions} smart tracked)` : ''
  return `${item.itemId}  ${subject}${model}  ${item.rate}/s  ${item.done}/${item.needed} masks  ${item.state}${edge}${strokes}${item.label ? `  "${item.label}"` : ''}`
}

function describeJob(job) {
  if (!job) return ''
  const parts = (job.jobs ?? []).map((j) => {
    if (j.state === 'downloading')
      return `${j.mediaId}: downloading model ${Math.round(((j.received ?? 0) / Math.max(1, j.total ?? 1)) * 100)}%`
    if (j.state === 'analyzing') return `${j.mediaId}: analysing ${j.done}/${j.count}`
    if (j.state === 'tracking') return `${j.mediaId}: tracking a smart stroke (${j.done} samples)`
    if (j.state === 'error') return `${j.mediaId}: failed: ${j.error}`
    return `${j.mediaId}: ${j.state}${j.backend ? ` (${j.backend})` : ''}`
  })
  return `job ${job.id} ${job.state}${parts.length ? `: ${parts.join('; ')}` : ''}${job.error ? `: ${job.error}` : ''}`
}

/**
 * @param {string[]} args  positionals after `cutout`
 * @param {{ opt, say, call, getProject, applyBatch, sleep? }} deps
 */
// fallow-ignore-next-line complexity
export async function cutoutCommand(args, deps) {
  const { opt, say, call, getProject, applyBatch } = deps
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const [id, ...itemIds] = args
  if (!id) throw new Error('Usage: shred cutout <projectId|draftId> [<itemId>...] [--subject auto|person|object] [--off] [--wait] [--json]')
  if (opt.subject && !SUBJECTS.includes(opt.subject))
    throw new Error(`--subject must be one of ${SUBJECTS.join(', ')}`)

  if (itemIds.length) {
    const { project, revision } = await getProject(id)
    const items = new Map((project.timeline?.items ?? []).map((item) => [item.id, item]))
    for (const itemId of itemIds) {
      const item = items.get(itemId)
      if (!item) throw new Error(`No item ${itemId} in ${id}`)
      if (item.type !== 'video') throw new Error(`${itemId} is ${item.type}; background removal works on video clips`)
    }
    await applyBatch(id, cutoutOps(itemIds, opt), revision)
    if (opt.off) {
      say(`background removal off for ${itemIds.join(', ')}`)
      return
    }
  }

  const route = `/v1/cutout?project=${encodeURIComponent(id)}`
  let status = await call('GET', route)
  if (!status.items.length) {
    say(`No clips in ${id} have background removal on (shred cutout ${id} <itemId> turns it on).`)
    return
  }
  const missing = status.items.some((item) => item.state !== 'ready' && item.state !== 'no-media')
  if (missing && (itemIds.length || opt.wait)) {
    status = await call('POST', '/v1/cutout', {
      project: id,
      ...(itemIds.length ? { itemIds } : {}),
    })
    say(`analysing on the agent service (${status.job.id}); masks land in media/<id>/cache/cutout/`)
  }
  if (opt.wait && status.job) {
    let last = ''
    for (;;) {
      status = await call('GET', `${route}&job=${encodeURIComponent(status.job.id)}`)
      const line = describeJob(status.job)
      if (line !== last && !opt.json) say(line)
      last = line
      if (status.job.state !== 'running') break
      await sleep(POLL_MS)
    }
  }
  if (opt.json) {
    say(JSON.stringify(status, null, 2))
  } else {
    for (const item of status.items) say(describe(item))
    if (!opt.wait && status.job?.state === 'running')
      say(`still analysing; shred cutout ${id} --wait to wait, or look at frames once it is ready`)
  }
  const failed = status.job?.state === 'error' || status.job?.jobs?.some((j) => j.state === 'error')
  if (failed) throw new Error(`background removal failed: ${describeJob(status.job)}`)
}
