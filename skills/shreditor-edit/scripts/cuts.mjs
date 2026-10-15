// `shred cut`: several versions of one edit, side by side (docs/cuts.md).
// A cut is its own project (own canvas, revision, drafts, passes, notes,
// check and export) linked to its siblings by `project.cut = { group, label,
// order }`; the group id is the main cut's project id. Media is shared by id.
//
//   shred cut new <projectId> --label "Hook B" [--size 1920x1080] [--from <cutId>]
//   shred cut list <projectId> [--json]
//   shred cut rename <cutId> "New label"
//   shred cut remove <cutId> --yes
import fs from 'node:fs'
import path from 'node:path'
import { readMediaMetadata } from '../../../headless/lib/workspace.mjs'
import {
  cutCreatedPassRecord,
  cutGroupName,
  cutGroupOf,
  cutLabelError,
  cutLabelOf,
  cutProjectName,
  cutsInGroup,
  isMainCut,
  nextCutOrder,
  parseCanvasSize,
  portableTextOverrides,
  projectAspect,
  refitTimeline,
  textStylesForAspect,
} from '../../../src/shared/projects/cuts.mjs'

const AGENT_FILES = ['brief.yaml', 'plan.json']

const REVIEW_TEXT = {
  framing: 'cropped hard to cover the new canvas: check the subject is in frame',
  keyframed: 'has keyframes: check the motion on the new canvas',
  reanchored: 'kept its nearest edge and scaled by the short side: check its place',
  template:
    'a template instance: its composition is still the old aspect (shred motion clone --aspect, then updateTemplate)',
  compound: 'a compound clip: its composition keeps the old canvas inside',
}

const usage =
  'Usage: shred cut new <projectId> --label "..." [--size WxH] [--from <cutId>] | list <projectId> | rename <cutId> "..." | remove <cutId> --yes'

/** Every live (not trashed) project the service lists. */
async function listLiveProjects(ctx) {
  const listed = await ctx.call('GET', '/v1/projects?limit=1000')
  return listed.projects.filter((p) => !p.trashed)
}

/** The group of `project`, in cut order, from the service's project list. */
async function groupOf(ctx, id, project) {
  const group = cutGroupOf({ id, cut: project.cut })
  const members = cutsInGroup(
    (await listLiveProjects(ctx)).map((p) => ({ id: p.id, cut: p.cut })),
    group,
  )
  return { group, members }
}

const sameLabel = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase()

function assertLabelFree(members, label, exceptId) {
  const taken = members.find((m) => m.id !== exceptId && sameLabel(cutLabelOf(m), label))
  if (taken) throw new Error(`The group already has a cut "${cutLabelOf(taken)}" (${taken.id})`)
}

/** The project's newest pass record, or null. */
export function lastPass(workspace, id) {
  const dir = path.join(workspace, 'projects', id, 'agent', 'passes')
  if (!fs.existsSync(dir)) return null
  const file = fs
    .readdirSync(dir)
    .filter((f) => /^\d+\.json$/.test(f))
    .sort()
    .at(-1)
  if (!file) return null
  try {
    const record = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    return {
      n: Number(record.id ?? file.slice(0, -5)),
      label: record.label ?? '',
      createdAt: record.createdAt ?? null,
      summary: record.scorecard?.summary ?? null,
    }
  } catch {
    return null
  }
}

const scoreText = (s) => (s ? `${s.pass} pass, ${s.warn} warn, ${s.fail} fail` : 'no scorecard')

function copyAgentFiles(workspace, fromId, toId) {
  const from = path.join(workspace, 'projects', fromId, 'agent')
  const to = path.join(workspace, 'projects', toId, 'agent')
  fs.mkdirSync(path.join(to, 'passes'), { recursive: true })
  const copied = []
  for (const name of AGENT_FILES) {
    if (!fs.existsSync(path.join(from, name))) continue
    fs.copyFileSync(path.join(from, name), path.join(to, name))
    copied.push(name)
  }
  // The plan's validation record, pointed at the copy (same text, same hash).
  const state = path.join(from, 'plan.state.json')
  if (fs.existsSync(state)) {
    const record = JSON.parse(fs.readFileSync(state, 'utf8'))
    if (record.file === path.join(from, 'plan.json')) record.file = path.join(to, 'plan.json')
    fs.writeFileSync(path.join(to, 'plan.state.json'), `${JSON.stringify(record, null, 2)}\n`)
  }
  return copied
}

/**
 * The ops that give styled text the style's look for the cut's aspect, then
 * its own non-position overrides back; and the styles with no look for it.
 */
export function restyleOps(timeline, toAspect, fromAspect) {
  const plan = textStylesForAspect(timeline, toAspect, fromAspect)
  const byId = new Map((timeline.items ?? []).map((item) => [item.id, item]))
  const ops = []
  for (const entry of plan.filter((p) => p.ready)) {
    ops.push({ op: 'applyTextStyle', ids: entry.itemIds, styleId: entry.styleId })
    for (const id of entry.itemIds) {
      const item = byId.get(id)
      const kept = portableTextOverrides(item)
      if (!kept.length) continue
      const updates = Object.fromEntries(kept.map((key) => [key, item[key]]))
      ops.push({ op: 'updateItem', id, updates: { ...updates, textStyleOverrides: kept } })
    }
  }
  return { ops, missing: plan.filter((p) => !p.ready) }
}

async function newCut(ctx, [projectId]) {
  const { opt, say } = ctx
  if (!projectId) throw new Error(usage)
  const labelError = cutLabelError(opt.label)
  if (labelError) throw new Error(`${labelError}: --label "Hook B"`)
  const label = opt.label.trim()
  const fromId = opt.from ?? projectId
  if (ctx.readDrafts()[fromId])
    throw new Error(`${fromId} is a draft; make a cut from the project or one of its cuts`)
  await ctx.warnUnsaved(fromId)
  const source = await ctx.getProject(fromId)
  const { group, members } = await groupOf(ctx, fromId, source.project)
  if (fromId !== projectId) {
    const named = await ctx.getProject(projectId)
    if (cutGroupOf({ id: projectId, cut: named.project.cut }) !== group)
      throw new Error(
        `${fromId} is not a cut of ${projectId}'s group (shred cut list ${projectId})`,
      )
  }
  assertLabelFree(members, label)
  const main = members.some((m) => m.id === group) ? (await ctx.getProject(group)).project : null
  const meta = source.project.metadata
  const from = { width: meta.width, height: meta.height }
  const to = opt.size ? parseCanvasSize(opt.size) : from
  const resized = to.width !== from.width || to.height !== from.height

  const created = await ctx.call(
    'POST',
    '/v1/projects',
    {
      name: cutProjectName(cutGroupName(main, source.project), label),
      width: to.width,
      height: to.height,
      fps: meta.fps,
      ...(meta.backgroundColor ? { backgroundColor: meta.backgroundColor } : {}),
    },
    { 'Idempotency-Key': ctx.key('cut-new') },
  )
  const fresh = await ctx.getProject(created.id)
  const fit = resized
    ? refitTimeline(source.project.timeline ?? { tracks: [], items: [] }, from, to, {
        mediaSize: (mediaId) => readMediaMetadata(ctx.workspace(), mediaId),
      })
    : { timeline: source.project.timeline, covered: [], review: [] }
  const cut = { group, label, order: nextCutOrder(members) }
  let saved = await ctx.call(
    'PUT',
    `/v1/projects/${created.id}`,
    {
      project: {
        ...fresh.project,
        ...(source.project.format ? { format: source.project.format } : {}),
        ...(source.project.kit ? { kit: source.project.kit } : {}),
        cut,
        ...(fit.timeline ? { timeline: fit.timeline } : {}),
      },
      expectedRevision: fresh.revision,
    },
    { 'Idempotency-Key': ctx.key('cut-copy') },
  )
  const toAspect = projectAspect(saved.project)
  const restyle =
    resized && fit.timeline
      ? restyleOps(fit.timeline, toAspect, projectAspect(source.project))
      : { ops: [], missing: [] }
  if (restyle.ops.length) saved = await ctx.applyBatch(created.id, restyle.ops, saved.revision)
  const copied = copyAgentFiles(ctx.workspace(), fromId, created.id)
  const current = await ctx.getProject(created.id)
  const record = cutCreatedPassRecord({
    label,
    fromLabel: cutLabelOf({ id: fromId, cut: source.project.cut }),
    fromId,
    revision: current.revision,
    timeline: current.project.timeline,
    scorecard: await ctx.scorecard(current.project),
  })
  ctx.writeJsonAtomic(
    path.join(ctx.workspace(), 'projects', created.id, 'agent', 'passes', '001.json'),
    record,
  )

  say(created.id)
  say(`${ctx.editor}/editor/${created.id}`)
  say(
    `cut      "${label}" (${members.length + 1} in the group of ${group}), copied from ${cutLabelOf({ id: fromId, cut: source.project.cut })} (${fromId})`,
  )
  say(
    `canvas   ${to.width}x${to.height} (${toAspect})${resized ? `, was ${from.width}x${from.height}` : ''}`,
  )
  say(
    `shared   media by id (nothing copied); copied: format, kit, timeline${copied.length ? `, ${copied.join(', ')}` : ''}`,
  )
  if (resized) {
    say(`re-fit   ${fit.covered.length} full-bleed clip(s) set to cover the new canvas`)
    const styled = restyle.ops.filter((op) => op.op === 'applyTextStyle')
    for (const op of styled)
      say(`         text style ${op.styleId}: its ${toAspect} look on ${op.ids.length} item(s)`)
    for (const m of restyle.missing)
      say(
        `warning: text style "${m.name}" has no ${toAspect} version; its ${m.itemIds.length} item(s) were only re-anchored. Run: shred styles clone "${m.name}" --aspect ${toAspect} --project ${created.id}`,
      )
    if (fit.review.length) {
      say(`review   ${fit.review.length} item(s); open shred frames ${created.id} across them:`)
      for (const r of fit.review) say(`  ${r.id}  ${r.name}: ${REVIEW_TEXT[r.reason]}`)
    }
    if (saved.project.format)
      say(
        "note     the format's targets were written for its own canvas; read shred check with that in mind",
      )
  }
  say(`next     shred draft ${created.id} --label "..." to edit it; publish stays in this cut`)
}

async function listCuts(ctx, [projectId]) {
  const { say, opt } = ctx
  if (!projectId) throw new Error(usage)
  const { project } = await ctx.getProject(projectId)
  const { group, members } = await groupOf(ctx, projectId, project)
  const rows = []
  for (const member of members) {
    const { project: p } = await ctx.getProject(member.id)
    rows.push({
      id: member.id,
      label: cutLabelOf(member),
      main: isMainCut(member),
      width: p.metadata.width,
      height: p.metadata.height,
      aspect: projectAspect(p),
      format: p.format ? `${p.format.id}${p.format.variant ? `/${p.format.variant}` : ''}` : null,
      lastPass: lastPass(ctx.workspace(), member.id),
    })
  }
  if (opt.json) return say(JSON.stringify({ group, cuts: rows }, null, 2))
  say(`${rows.length} cut${rows.length === 1 ? '' : 's'} in group ${group}`)
  for (const r of rows) {
    const pass = r.lastPass
      ? `pass #${r.lastPass.n} "${r.lastPass.label}" (${scoreText(r.lastPass.summary)})`
      : 'no pass yet'
    say(
      `${r.id === projectId ? '*' : ' '} ${r.label.padEnd(16)} ${`${r.width}x${r.height}`.padEnd(10)} ${r.aspect.padEnd(5)} ${(r.format ?? 'no format').padEnd(18)} ${pass}  [${r.id}]${r.main ? ' main' : ''}`,
    )
  }
  if (rows.length === 1)
    say(`Make one: shred cut new ${projectId} --label "Hook B" [--size 1920x1080]`)
}

async function refuseOpenEdits(ctx, id, what) {
  const state = await ctx.editorState(id)
  if (state?.conflict || state?.dirty)
    throw new Error(
      `The editor has unsaved edits on ${id}; ${what} writes its project. Run shred sync ${id} first.`,
    )
  return state
}

async function renameCut(ctx, [id, ...words]) {
  const label = (words.length ? words.join(' ') : ctx.opt.label)?.trim()
  if (!id) throw new Error(usage)
  const labelError = cutLabelError(label)
  if (labelError) throw new Error(`${labelError}: shred cut rename ${id} "New label"`)
  const { project, revision } = await ctx.getProject(id)
  const { group, members } = await groupOf(ctx, id, project)
  assertLabelFree(members, label, id)
  await refuseOpenEdits(ctx, id, 'a rename')
  const main = isMainCut({ id, cut: project.cut })
  const groupName = main
    ? project.name
    : cutGroupName(
        members.some((m) => m.id === group) ? (await ctx.getProject(group)).project : null,
        { id, ...project },
      )
  const updates = {
    cut: { group, label, order: main ? 0 : (project.cut?.order ?? nextCutOrder(members)) },
    ...(main ? {} : { name: cutProjectName(groupName, label) }),
  }
  await ctx.call(
    'PATCH',
    `/v1/projects/${id}`,
    { updates, expectedRevision: revision },
    { 'Idempotency-Key': ctx.key('cut-rename') },
  )
  ctx.say(`${id}: cut "${cutLabelOf({ id, cut: project.cut })}" is now "${label}"`)
}

async function removeCut(ctx, [id]) {
  if (!id) throw new Error(usage)
  const { project, revision } = await ctx.getProject(id)
  const { members } = await groupOf(ctx, id, project)
  const label = cutLabelOf({ id, cut: project.cut })
  if (isMainCut({ id, cut: project.cut })) {
    throw new Error(
      members.length > 1
        ? `"${label}" is the group's main cut; it can't be removed while the group has other cuts (${members.length - 1}).`
        : `${id} has no other cuts; it is a project, not a cut (delete projects from the editor's project list).`,
    )
  }
  if (!ctx.opt.yes)
    throw new Error(
      `Removing cut "${label}" (${id}) moves it to the editor's Trash (restorable from the project list; no media is deleted). Run again with --yes to remove it.`,
    )
  const state = await refuseOpenEdits(ctx, id, 'removing it')
  if (state?.open)
    throw new Error(
      `The editor has cut "${label}" open; ask the user to switch to another cut first.`,
    )
  await ctx.call(
    'POST',
    `/v1/projects/${id}/trash`,
    { expectedRevision: revision },
    { 'Idempotency-Key': ctx.key('cut-remove') },
  )
  ctx.say(
    `Removed cut "${label}" (${id}): it is in the editor's Trash (restore it from the project list). No media was deleted.`,
  )
}

export function cutCommands(ctx) {
  return {
    new: (rest) => newCut(ctx, rest),
    list: (rest) => listCuts(ctx, rest),
    rename: (rest) => renameCut(ctx, rest),
    remove: (rest) => removeCut(ctx, rest),
  }
}

/**
 * One line naming a project's cut and its siblings (`shred project`,
 * `shred publish`), or null when it is no cut's sibling.
 */
export async function cutLine(ctx, id, project) {
  try {
    const { group, members } = await groupOf(ctx, id, project)
    if (members.length < 2) return null
    const position = members.findIndex((m) => m.id === id) + 1
    return `cut      "${cutLabelOf({ id, cut: project.cut })}" (${position} of ${members.length} in group ${group}: ${members.map(cutLabelOf).join(', ')}; shred cut list ${id})`
  } catch {
    return null
  }
}

/** `shred status`: each group with more than one cut, as "<group>: Main, Hook B". */
export async function cutGroupLines(ctx) {
  const projects = await listLiveProjects(ctx)
  const groups = new Map()
  for (const p of projects) {
    const group = cutGroupOf(p)
    groups.set(group, [...(groups.get(group) ?? []), { id: p.id, cut: p.cut }])
  }
  return [...groups]
    .filter(([, members]) => members.length > 1)
    .map(
      ([group, members]) => `${group}: ${cutsInGroup(members, group).map(cutLabelOf).join(', ')}`,
    )
}
