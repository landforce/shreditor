#!/usr/bin/env node
// Quality evidence for working copies (server/media-compatibility.mjs).
//
//   node scripts/media-compat-quality.mjs [--assets <file>...] [--json <out.json>] [--keep]
//
// Generates a fixture per conversion class, imports each into a scratch
// workspace (SHREDITOR_WORKSPACE, else a temp dir) exactly as `shred import`
// does, and reports SSIM / PSNR against the original (alpha composited over
// grey), frame counts and the duration delta. --assets also imports real files
// read-only (link mode; sha256 checked before and after) and, for media kept as
// they are (ProRes), measures the copy a decode failure would produce.
//
// SSIM and PSNR are computed in Y'CbCr 4:4:4 10-bit (RGB originals converted
// with BT.709, the matrix the copies are tagged with); "rgb PSNR" decodes both
// to RGB with their own tags, so a wrong matrix or range shows there.
import { execFileSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { importMediaByPath } from '../server/media-bridge.mjs'
import { compatibilityArgs, prepareCompatibleMedia, probeCompatibility, compatibilityPolicy } from '../server/media-compatibility.mjs'
import { resolveMediaFile } from '../headless/lib/workspace.mjs'

const { values: opt } = parseArgs({
  options: { assets: { type: 'string', multiple: true, default: [] }, json: { type: 'string' }, keep: { type: 'boolean' } },
  allowPositionals: false,
})
const root = path.resolve(process.env.SHREDITOR_WORKSPACE || fs.mkdtempSync(path.join(os.tmpdir(), 'shred-quality-')))
fs.mkdirSync(root, { recursive: true })
const fixtures = path.join(root, 'quality-fixtures')
fs.mkdirSync(fixtures, { recursive: true })

const ff = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-y', ...args], { maxBuffer: 1 << 30 })
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const SRC = 'testsrc2=s=1920x1080:r=30:d=2'
const TAG709 = 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv'

/** Prepare a comparable stream: alpha composited over grey, then 4:4:4 10-bit or RGB. */
function chain(input, { alpha, rgbSource, target, size, relabel }) {
  const steps = []
  // YUV originals: label both sides alike so ffmpeg doesn't convert one of them.
  if (relabel && !alpha && !rgbSource && target !== 'rgb') steps.push(`[${input}:v]${relabel}`)
  else if (alpha) steps.push(`[${input}:v]format=rgba[f${input}];color=gray:s=${size}[g${input}];[g${input}][f${input}]overlay=shortest=1:format=auto`)
  else if (!steps.length) steps.push(`[${input}:v]null`)
  if (target === 'rgb') steps.push('format=gbrp')
  else steps.push(`${rgbSource || alpha ? 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,' : ''}format=yuv444p10le`)
  return `${steps.join(',')}[v${input}]`
}

function metric(original, copy, filter, { alpha, rgbSource, target, copyDecoder = [] }) {
  const size = (file) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file]).toString().trim()
  const dims = size(original)
  const tags = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_space,color_range,pix_fmt', '-of', 'json', original])).streams[0]
  const known = (v) => (v && v !== 'unknown' ? v : undefined)
  const relabel = `setparams=colorspace=${known(tags.color_space) ?? 'bt709'}:range=${tags.color_range === 'pc' || /^yuvj/.test(tags.pix_fmt) ? 'pc' : 'tv'}`
  // Copies padded to even dimensions are compared on the original's area.
  const crop = size(copy) !== dims ? `[1:v]crop=${dims.replace('x', ':')}:0:0[c];` : ''
  const second = chain(1, { alpha, rgbSource, target, size: dims, relabel })
  const graph = `${crop}${chain(0, { alpha, rgbSource, target, size: dims, relabel })};${crop ? second.replace('[1:v]', '[c]') : second};[v0][v1]${filter}`
  const result = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-i', original, ...copyDecoder, '-i', copy, '-lavfi', graph, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 })
  if (result.status !== 0) throw new Error(`metric failed: ${String(result.stderr).slice(-600)}`)
  return result.stderr
}

function measure(original, copy, { alpha = false, rgbSource = false, vp9 = false } = {}) {
  const copyDecoder = vp9 ? ['-c:v', 'libvpx-vp9'] : []
  const ssim = /SSIM .*All:([\d.]+)/.exec(metric(original, copy, 'ssim', { alpha, rgbSource, copyDecoder }))?.[1]
  const psnr = /PSNR .*average:([\d.]+|inf)/.exec(metric(original, copy, 'psnr', { alpha, rgbSource, copyDecoder }))?.[1]
  const rgb = rgbSource || alpha ? /PSNR .*average:([\d.]+|inf)/.exec(metric(original, copy, 'psnr', { alpha, rgbSource, target: 'rgb', copyDecoder }))?.[1] : undefined
  return { ssim: ssim ? Number(ssim) : null, psnr: psnr === 'inf' ? Infinity : psnr ? Number(psnr) : null, ...(rgb ? { rgbPsnr: rgb === 'inf' ? Infinity : Number(rgb) } : {}) }
}

// Decoded frames, so container framing (Annex B in TS, length-prefixed in MOV) doesn't matter.
const videoHash = (file) => String(ff('-i', file, '-map', '0:v:0', '-f', 'hash', '-hash', 'md5', '-')).trim()

const CLASSES = [
  { name: 'h264 from 8-bit RGB (PNG mov, Display P3)', file: 'png-rgb.mov', rgbSource: true, args: ['-f', 'lavfi', '-i', `${SRC},format=rgb24,setparams=color_primaries=smpte432:color_trc=iec61966-2-1`, '-c:v', 'png'] },
  { name: 'h264 from 8-bit 4:2:2 full range (MJPEG avi)', file: 'mjpeg.avi', args: ['-f', 'lavfi', '-i', `${SRC},format=yuvj422p`, '-c:v', 'mjpeg', '-q:v', '2'] },
  { name: 'h264 from MPEG-4 Part 2', file: 'mpeg4.mov', args: ['-f', 'lavfi', '-i', `${SRC},${TAG709}`, '-c:v', 'mpeg4', '-q:v', '2'] },
  { name: 'hevc Main10 from 10-bit 4:2:2 (DNxHR HQX)', file: 'dnxhr.mov', args: ['-f', 'lavfi', '-i', `${SRC},format=yuv422p10le,${TAG709}`, '-c:v', 'dnxhd', '-profile:v', 'dnxhr_hqx'] },
  { name: 'hevc Main10 from HDR PQ (DNxHR HQX, BT.2020)', file: 'dnxhr-pq.mov', args: ['-f', 'lavfi', '-i', `${SRC},format=yuv422p10le,setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc:range=tv`, '-c:v', 'dnxhd', '-profile:v', 'dnxhr_hqx'] },
  { name: 'prores-alpha from PNG with alpha', file: 'png-alpha.mov', alpha: true, rgbSource: true, args: ['-f', 'lavfi', '-i', `${SRC},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='clip(X/7,0,255)'`, '-c:v', 'png'], compareVp9: true },
  { name: 'rewrap: H.264 + AC-3 (mp4)', file: 'h264-ac3.mp4', rewrap: true, args: ['-f', 'lavfi', '-i', `${SRC},${TAG709}`, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-c:v', 'libx264', '-c:a', 'ac3'] },
  { name: 'rewrap: H.264 in MPEG-TS + MP2', file: 'h264-mp2.ts', rewrap: true, args: ['-f', 'lavfi', '-i', `${SRC},${TAG709}`, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-c:v', 'libx264', '-c:a', 'mp2'] },
  { name: 'forced (WASM decode failed): ProRes 422 HQ 10-bit', file: 'prores-hq.mov', force: true, args: ['-f', 'lavfi', '-i', `${SRC},format=yuv422p10le,${TAG709}`, '-c:v', 'prores_ks', '-profile:v', '3'] },
  { name: 'forced (WASM decode failed): ProRes 4444 alpha 12-bit', file: 'prores-4444.mov', force: true, alpha: true, args: ['-f', 'lavfi', '-i', `${SRC},format=yuva444p12le,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='clip(X*4096/1920,0,4095)'`, '-c:v', 'prores_ks', '-profile:v', '4'] },
]

/** Encode an alternative alpha plan (VP9 alpha) from the same original, for comparison. */
async function vp9AlphaAlternative(source) {
  const probed = await probeCompatibility(source)
  const plan = { ...compatibilityPolicy(probed, true), action: 'vp9-alpha', format: 'mkv', video: { codec: 'vp9', pixFmt: 'yuva420p', crf: 10 }, audio: null, audioIndex: null, notes: [] }
  const out = path.join(fixtures, `${path.basename(source)}.vp9-alpha.mkv`)
  execFileSync('ffmpeg', compatibilityArgs(plan, probed, source, out), { stdio: 'ignore' })
  return out
}

const rows = []
async function report(name, source, { alpha = false, rgbSource = false, rewrap = false, force = false, compareVp9 = false, asset = false } = {}) {
  const before = sha256(source)
  const row = { name, source: asset ? source : path.basename(source) }
  let copy
  let compatibility
  if (force) {
    const dir = path.join(root, 'media', `forced-${crypto.randomUUID()}`)
    fs.mkdirSync(dir, { recursive: true })
    const prepared = await prepareCompatibleMedia(source, dir, { force: true })
    copy = prepared.file
    compatibility = { status: 'ready', ...prepared.manifest, action: prepared.manifest.policy.action }
  } else {
    const [imported] = await importMediaByPath(root, [source], { mode: 'link', prepare: 'wait' })
    if (imported.error) throw new Error(`${name}: ${imported.error.message}`)
    compatibility = imported.metadata.compatibility
    copy = resolveMediaFile(root, imported.id)
  }
  if (!compatibility) {
    row.decision = 'keep (plays as is)'
  } else {
    row.decision = compatibility.action
    row.settings = compatibility.settings
    row.frames = compatibility.verification?.frames
    row.durationDelta = compatibility.verification?.durationDelta
    if (compatibility.verification?.audioOffsetDeltaMs !== undefined) row.audioOffsetDeltaMs = compatibility.verification.audioOffsetDeltaMs
    row.notes = compatibility.notes
    row.sizeRatio = Math.round((fs.statSync(copy).size / fs.statSync(source).size) * 100) / 100
    const vp9 = compatibility.action === 'vp9-alpha'
    if (rewrap && compatibility.action === 'rewrap') row.video = videoHash(copy) === videoHash(source) ? 'video stream copied; decoded frames bit-identical' : 'decoded frames DIFFER'
    else Object.assign(row, measure(source, copy, { alpha, rgbSource, vp9 }))
    if (compareVp9) {
      const alt = await vp9AlphaAlternative(source)
      row.vp9AlphaAlternative = measure(source, alt, { alpha, rgbSource, vp9: true })
    }
  }
  row.originalUntouched = sha256(source) === before
  rows.push(row)
  const q = row.video ?? (row.ssim !== undefined ? `SSIM ${row.ssim} PSNR ${row.psnr}${row.rgbPsnr ? ` rgbPSNR ${row.rgbPsnr}` : ''}` : '')
  console.log(`${name}\n  ${row.decision}${row.settings ? ` (${row.settings})` : ''}\n  ${q}${row.frames ? `  frames ${row.frames.join('/')}  duration delta ${row.durationDelta}s` : ''}${row.audioOffsetDeltaMs !== undefined ? `  audio offset ${row.audioOffsetDeltaMs} ms` : ''}${row.sizeRatio ? `  size x${row.sizeRatio}` : ''}${row.vp9AlphaAlternative ? `\n  VP9-alpha alternative: SSIM ${row.vp9AlphaAlternative.ssim} PSNR ${row.vp9AlphaAlternative.psnr} rgbPSNR ${row.vp9AlphaAlternative.rgbPsnr}` : ''}${row.notes?.length ? `\n  notes: ${row.notes.join('; ')}` : ''}\n  original untouched: ${row.originalUntouched}`)
}

try {
  for (const spec of CLASSES) {
    const file = path.join(fixtures, spec.file)
    ff(...spec.args, '-t', '2', file)
    await report(spec.name, file, spec)
  }
  for (const asset of opt.assets) {
    const file = path.resolve(asset)
    const probed = await probeCompatibility(file)
    const video = probed.streams.find((s) => s.codec_type === 'video')
    const alpha = /^(yuva|rgba|argb|bgra|abgr|gbrap)/.test(video?.pix_fmt ?? '')
    const rgbSource = /^(rgb|bgr|gbr|argb|abgr|rgba|bgra)/.test(video?.pix_fmt ?? '')
    await report(`asset ${path.basename(file)}`, file, { alpha, rgbSource, asset: true })
    if (!compatibilityPolicy(probed)) await report(`asset ${path.basename(file)} (forced: if its decode failed)`, file, { alpha, rgbSource, force: true, asset: true, compareVp9: false })
  }
  if (opt.json) fs.writeFileSync(opt.json, `${JSON.stringify(rows, null, 2)}\n`)
} finally {
  if (!opt.keep && !process.env.SHREDITOR_WORKSPACE) fs.rmSync(root, { recursive: true, force: true })
  else if (!opt.keep) fs.rmSync(fixtures, { recursive: true, force: true })
}
