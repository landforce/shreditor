// `shreditor setup whisper` / `shred setup`: check the tools native
// transcription needs and, with consent, download the Whisper model.
// Never installs packages: it prints the install command for this system
// (Homebrew, apt, winget...: server/install/packages.mjs) instead.
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installCommands, managersHere, manualInstall, packageFor } from './install/packages.mjs'
import { cloneFile } from './media-bridge.mjs'
import { defaultModelPath, extraToolDirs } from './platform.mjs'
import { DEFAULT_MODEL_PATH, engineInfo, findExecutable, transcriptionConfig } from './transcription.mjs'

/**
 * The default model, from the official whisper.cpp repository on Hugging Face.
 * sha256 and size are the Git LFS object id and size Hugging Face publishes
 * for this file (api/models/ggerganov/whisper.cpp/tree/main).
 */
export const DEFAULT_MODEL = {
  file: 'ggml-large-v3-turbo.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin',
  size: 1_624_555_275,
  sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69',
  license: 'MIT (OpenAI Whisper weights, converted to ggml by whisper.cpp)',
}

const gb = (bytes) => `${(bytes / 1e9).toFixed(2)} GB`

export async function sha256File(file) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

/** Stream the model to `<target>.part`, verify size and sha256, then rename into place. */
export async function downloadModel(target, { fetchImpl = fetch, onProgress = () => {}, model = DEFAULT_MODEL } = {}) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const part = `${target}.part`
  const res = await fetchImpl(model.url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} from ${model.url}`)
  const hash = crypto.createHash('sha256')
  const out = fs.createWriteStream(part)
  let received = 0
  try {
    for await (const chunk of res.body) {
      hash.update(chunk)
      received += chunk.length
      if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve))
      onProgress(received, model.size)
    }
    await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())))
    const digest = hash.digest('hex')
    if (received !== model.size) throw new Error(`Size mismatch: got ${received} bytes, expected ${model.size}`)
    if (digest !== model.sha256) throw new Error(`sha256 mismatch: got ${digest}, expected ${model.sha256}`)
    fs.renameSync(part, target)
    return { bytes: received, sha256: digest }
  } catch (error) {
    out.destroy()
    fs.rmSync(part, { force: true })
    throw error
  }
}

/** Folders other whisper.cpp setups commonly keep the model in, on this system. */
export function modelDirs(platform = process.platform, home = os.homedir(), env = process.env) {
  const p = platform === 'win32' ? path.win32 : path.posix
  const common = [
    p.join(home, 'whisper.cpp', 'models'),
    p.join(home, 'Dev', 'whisper.cpp', 'models'),
    p.join(home, '.cache', 'whisper.cpp'),
    p.join(home, '.cache', 'whisper'),
    p.join(home, 'Downloads'),
  ]
  // Where a Homebrew whisper-cpp keeps models: share/ beside its bin/.
  const brewShare = extraToolDirs(platform, home, env)
    .filter((dir) => /homebrew|linuxbrew|\/usr\/local/.test(dir))
    .map((bin) => p.join(p.dirname(bin), 'share', 'whisper-cpp'))
  if (platform === 'darwin')
    return [...common.slice(0, 4), p.join(home, 'Library', 'Application Support', 'MacWhisper', 'models'), common[4], ...brewShare]
  if (platform === 'win32') return [...common, p.dirname(defaultModelPath('win32', home, env))]
  return [...common, p.dirname(defaultModelPath('linux', home, env)), '/usr/share/whisper.cpp/models', ...brewShare]
}
const MODEL_DIRS = modelDirs()

/** Lines of a command's output, or [] when it is missing, fails or is slow. */
function lines(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')
  } catch {
    return []
  }
}

/**
 * The system file index's matches for the model's file name: Spotlight on a
 * Mac, locate (plocate/mlocate) on Linux; none on Windows.
 */
function systemSearch(name) {
  const found =
    process.platform === 'darwin'
      ? lines('mdfind', ['-name', name])
      : process.platform === 'linux'
        ? lines('locate', ['-b', `\\${name}`])
        : []
  return found.filter((file) => path.basename(file) === name)
}

/**
 * A copy of the default model already on this Mac, somewhere other than
 * `target`, with the published size: its path, or null.
 */
export function findExistingModel(target, { dirs = MODEL_DIRS, search = systemSearch, model = DEFAULT_MODEL } = {}) {
  const candidates = [...dirs.map((dir) => path.join(dir, model.file)), ...search(model.file)]
  for (const file of new Set(candidates)) {
    if (path.resolve(file) === path.resolve(target)) continue
    if (fs.statSync(file, { throwIfNoEntry: false })?.size === model.size) return file
  }
  return null
}

/**
 * Put an existing copy of the model at `target` after checking its sha256:
 * a clone (APFS, btrfs, XFS: no extra disk space) on the same volume, a
 * symlink otherwise, or a copy where symlinks need rights this user lacks
 * (Windows without Developer Mode). Returns 'clone', 'link' or 'copy'; throws
 * when the copy doesn't match.
 */
export async function adoptModel(source, target, { model = DEFAULT_MODEL } = {}) {
  if ((await sha256File(source)) !== model.sha256) throw new Error(`${source} does not match the published sha256`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  try {
    await cloneFile(source, target)
    return 'clone'
  } catch {
    fs.rmSync(target, { force: true })
  }
  try {
    fs.symlinkSync(source, target)
    return 'link'
  } catch (error) {
    if (error.code !== 'EPERM') throw error
    fs.copyFileSync(source, target)
    return 'copy'
  }
}

/** How to install the missing tools here: one line per install command or manual step. */
export function installHints(tools, { platform = process.platform, which = findExecutable } = {}) {
  const missing = [!tools.ffmpeg || !tools.ffprobe ? 'ffmpeg' : null, !tools['whisper-cli'] ? 'whisper' : null].filter(Boolean)
  const managers = managersHere(platform, which)
  const packaged = missing.map((tool) => packageFor(tool, managers)).filter(Boolean)
  const manual = missing.filter((tool) => !packageFor(tool, managers))
  // A Mac without Homebrew keeps the old one-line hint.
  if (platform === 'darwin' && manual.length) return [`install with: brew install ${missing.map((t) => (t === 'whisper' ? 'whisper-cpp' : t)).join(' ')}`]
  return [
    ...installCommands(packaged).map((fix) => `install with: ${fix.command}`),
    ...manual.map((tool) => `${tool === 'whisper' ? 'whisper-cli' : tool}: ${manualInstall(tool, platform)}`),
  ]
}

/**
 * Check and report; download the default model only when `yes` is true.
 * `say` prints one line. Returns true when native transcription is ready.
 */
export async function setupWhisper({ yes = false, verify = false, say = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const config = transcriptionConfig()
  const tools = {
    ffmpeg: findExecutable('ffmpeg'),
    ffprobe: findExecutable('ffprobe'),
    'whisper-cli': findExecutable(config.whisperCli),
  }
  for (const [name, found] of Object.entries(tools)) say(`${found ? 'ok     ' : 'missing'}  ${name}${found ? `  ${found}` : ''}`)
  for (const line of installHints(tools)) say(`         ${line}`)

  let size = fs.statSync(config.model, { throwIfNoEntry: false })?.size ?? 0
  const isDefault = path.basename(config.model) === DEFAULT_MODEL.file
  const existing = size === 0 && isDefault ? findExistingModel(config.model) : null
  if (existing) {
    say(`found    model  ${existing}; checking sha256…`)
    try {
      const how = await adoptModel(existing, config.model)
      size = DEFAULT_MODEL.size
      say(`         ${{ clone: 'cloned it', link: 'linked it', copy: 'copied it' }[how]} to ${config.model} instead of downloading${how === 'link' ? ` (keep ${existing} in place)` : ''}`)
    } catch (error) {
      say(`         not used: ${error.message}`)
    }
  }
  if (size > 0) {
    let note = isDefault ? (size === DEFAULT_MODEL.size ? 'size matches the published file' : `size differs from the published ${DEFAULT_MODEL.size} bytes`) : 'custom model'
    if (verify && isDefault) {
      say('         checking sha256…')
      note = (await sha256File(config.model)) === DEFAULT_MODEL.sha256 ? 'sha256 verified' : 'sha256 DOES NOT MATCH the published file'
    }
    say(`ok       model  ${config.model}  (${gb(size)}, ${note})`)
  } else if (!isDefault) {
    say(`missing  model  ${config.model}  (custom path in ~/.shreditor/config.json; put the file there, or remove "model" to use ${DEFAULT_MODEL_PATH})`)
  } else if (!yes) {
    say(`missing  model  ${config.model}`)
    say(`         Download ${DEFAULT_MODEL.file} (${gb(DEFAULT_MODEL.size)}, ${DEFAULT_MODEL.license})`)
    say(`         from ${DEFAULT_MODEL.url}`)
    say(`         to   ${config.model}`)
    say('         and verify its sha256? Run again with --yes to download.')
  } else {
    say(`downloading ${DEFAULT_MODEL.file} (${gb(DEFAULT_MODEL.size)}) to ${config.model}`)
    let shown = 0
    const { sha256 } = await downloadModel(config.model, {
      onProgress: (received, total) => {
        const pct = Math.floor((received / total) * 10) * 10
        if (pct > shown) say(`         ${(shown = pct)}%`)
      },
    })
    say(`ok       model  ${config.model}  (sha256 ${sha256.slice(0, 12)}… verified)`)
  }
  const info = await engineInfo()
  say(info.available ? `Native transcription ready: whisper.cpp ${info.version ?? ''} with ${info.modelName}. Runs locally; nothing is uploaded.` : `Native transcription not ready (${info.missing.join(', ') || 'disabled in config'}). In-app transcription still works.`)
  return info.available
}
