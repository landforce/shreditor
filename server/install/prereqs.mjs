// What Shreditor needs on this Mac, each with a clear fix. Checks are pure
// (they read a probe), so tests stub the machine; realProbe() reads this one.
import fs from 'node:fs'
import path from 'node:path'
import { findExecutable, transcriptionConfig } from '../transcription.mjs'
import { DEFAULT_MODEL } from '../transcription-setup.mjs'
import { depsState, linkedNodeModules, staleBuild } from './build-state.mjs'

export const MIN_NODE_MAJOR = 22
// Where Playwright's channel 'chrome' looks on macOS.
export const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BREW_INSTALL =
  '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'

/** The facts the checks need, read from this machine and checkout. */
export function realProbe(repo) {
  const config = transcriptionConfig()
  return {
    nodeVersion: process.versions.node,
    chrome: fs.existsSync(CHROME_PATH) ? CHROME_PATH : null,
    which: (command) => findExecutable(command),
    whisperCli: config.whisperCli,
    model: {
      path: config.model,
      size: fs.statSync(config.model, { throwIfNoEntry: false })?.size ?? 0,
      isDefault: path.basename(config.model) === DEFAULT_MODEL.file,
    },
    deps: depsState(repo),
    depsLinkedTo: linkedNodeModules(repo),
    build: staleBuild(repo),
  }
}

const ok = (id, label, detail) => ({ id, label, ok: true, detail })
const gb = (bytes) => `${(bytes / 1e9).toFixed(1)} GB`

function brewCheck(id, label, found, formula, brew) {
  if (found) return ok(id, label, found)
  return brew
    ? {
        id,
        label,
        ok: false,
        detail: 'not found',
        fix: { kind: 'brew', formula, command: `brew install ${formula}` },
      }
    : {
        id,
        label,
        ok: false,
        detail: 'not found',
        manual: `Install Homebrew first, then: brew install ${formula}`,
      }
}

function modelCheck(model) {
  const label = 'Whisper model'
  if (model.size > 0) return ok('model', label, `${model.path} (${gb(model.size)})`)
  if (!model.isDefault)
    return {
      id: 'model',
      label,
      ok: false,
      detail: `${model.path} is missing`,
      manual:
        'Put your model file at the path set in ~/.shreditor/config.json, or remove "model" there to use the default.',
    }
  return {
    id: 'model',
    label,
    ok: false,
    detail: 'not downloaded',
    fix: {
      kind: 'model',
      command: `download ${DEFAULT_MODEL.file} (${gb(DEFAULT_MODEL.size)}) from ${DEFAULT_MODEL.url}`,
    },
  }
}

function depsCheck(probe) {
  const label = 'Dependencies (node_modules)'
  if (!probe.deps) return ok('deps', label, 'match package-lock.json')
  if (probe.depsLinkedTo)
    return {
      id: 'deps',
      label,
      ok: false,
      detail: probe.deps,
      manual: `node_modules is a link to ${probe.depsLinkedTo}; run npm ci in that checkout.`,
    }
  return {
    id: 'deps',
    label,
    ok: false,
    detail: probe.deps,
    fix: { kind: 'npm-ci', command: 'npm ci' },
  }
}

/** Every prerequisite: { id, label, ok, detail, fix?: { kind, command }, manual?: text }. */
export function checkPrereqs(probe) {
  const major = Number(probe.nodeVersion.split('.')[0])
  const brew = probe.which('brew')
  const ffmpeg = probe.which('ffmpeg')
  const ffprobe = probe.which('ffprobe')
  return [
    major >= MIN_NODE_MAJOR
      ? ok('node', `Node.js ${MIN_NODE_MAJOR}+`, `v${probe.nodeVersion}`)
      : {
          id: 'node',
          label: `Node.js ${MIN_NODE_MAJOR}+`,
          ok: false,
          detail: `v${probe.nodeVersion}`,
          manual: `Install Node.js ${MIN_NODE_MAJOR} or newer from https://nodejs.org (or: brew install node), then run this again with it.`,
        },
    probe.chrome
      ? ok('chrome', 'Google Chrome', probe.chrome)
      : {
          id: 'chrome',
          label: 'Google Chrome',
          ok: false,
          detail: 'not in /Applications',
          manual:
            'Download Chrome from https://www.google.com/chrome/ and drag it into Applications.',
        },
    brew
      ? ok('brew', 'Homebrew', brew)
      : {
          id: 'brew',
          label: 'Homebrew',
          ok: false,
          detail: 'not found',
          manual: `Install it from https://brew.sh: ${BREW_INSTALL}`,
        },
    brewCheck(
      'ffmpeg',
      'ffmpeg and ffprobe',
      ffmpeg && ffprobe ? `${ffmpeg}, ${ffprobe}` : null,
      'ffmpeg',
      brew,
    ),
    brewCheck(
      'whisper',
      'whisper-cli (whisper.cpp)',
      probe.which(probe.whisperCli),
      'whisper-cpp',
      brew,
    ),
    modelCheck(probe.model),
    depsCheck(probe),
    probe.build
      ? {
          id: 'build',
          label: 'Editor build',
          ok: false,
          detail: probe.build,
          fix: { kind: 'build', command: 'npm run build' },
        }
      : ok('build', 'Editor build', 'current'),
  ]
}

/**
 * What to do about the failures: `auto` fixes this command can run (Homebrew
 * formulas merged into one `brew install`), `manual` steps the user must take.
 * Homebrew itself is only required when a formula needs it.
 */
export function planFixes(checks) {
  const failed = checks.filter((c) => !c.ok)
  const formulas = failed.filter((c) => c.fix?.kind === 'brew').map((c) => c.fix.formula)
  const auto = [
    ...(formulas.length
      ? [{ kind: 'brew', formulas, command: `brew install ${formulas.join(' ')}` }]
      : []),
    ...failed.filter((c) => c.fix && c.fix.kind !== 'brew').map((c) => c.fix),
  ]
  const brewNeeded = failed.some((c) => c.id === 'ffmpeg' || c.id === 'whisper')
  const manual = failed.filter((c) => c.manual && (c.id !== 'brew' || brewNeeded))
  return { auto, manual }
}
