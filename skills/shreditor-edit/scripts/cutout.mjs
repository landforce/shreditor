// `shred cutout`: background removal on video clips (docs/background-removal.md).
//
//   shred cutout <projectId|draftId> [<itemId>...] [--subject auto|person|object] [--off]
//                [--wait] [--json]
//
// With item ids it turns background removal on for those clips (one atomic
// setCutout batch; --off turns it off) and starts the analysis on the agent
// service. --wait polls until every cut-out clip's masks are stored, printing
// progress. Without item ids it prints each cut-out clip's status (and with
// --wait, analyses what is missing first).

const SUBJECTS = ['auto', 'person', 'object']
const POLL_MS = 1500

function describe(item) {
  const subject =
    item.subject === 'auto' && item.resolvedSubject ? `auto→${item.resolvedSubject}` : item.subject
  if (item.state === 'no-media') return `${item.itemId}  ${subject}  media missing`
  const model = item.model ? `  ${item.model}` : ''
  const edge = `${item.feather ? `  feather ${item.feather}px` : ''}${item.invert ? '  inverted' : ''}`
  return `${item.itemId}  ${subject}${model}  ${item.rate}/s  ${item.done}/${item.needed} masks  ${item.state}${edge}${item.label ? `  "${item.label}"` : ''}`
}

function describeJob(job) {
  if (!job) return ''
  const parts = (job.jobs ?? []).map((j) => {
    if (j.state === 'downloading')
      return `${j.mediaId}: downloading model ${Math.round(((j.received ?? 0) / Math.max(1, j.total ?? 1)) * 100)}%`
    if (j.state === 'analyzing') return `${j.mediaId}: analysing ${j.done}/${j.count}`
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
    const ops = itemIds.map((itemId) => ({
      op: 'setCutout',
      id: itemId,
      enabled: !opt.off,
      ...(opt.subject ? { subject: opt.subject } : {}),
    }))
    await applyBatch(id, ops, revision)
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
