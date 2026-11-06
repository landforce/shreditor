// Where things live on each operating system: Chrome, the workspace, logs,
// the Whisper model and extra folders to look for tools in. macOS keeps the
// places Shreditor has always used; Linux follows the XDG folders and Windows
// its per-user AppData folders. Pure functions of (platform, home, env) so
// tests can ask about any system from any system.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MODEL_FILE = 'ggml-large-v3-turbo.bin'

/** path.posix or path.win32, matching `platform` rather than this machine. */
export const pathFor = (platform) => (platform === 'win32' ? path.win32 : path.posix)

/**
 * Where Playwright's channel 'chrome' (the installed Google Chrome) looks,
 * in its order: the agent service launches exactly this Chrome.
 */
export function chromeCandidates(platform = process.platform, env = process.env) {
  if (platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  if (platform === 'win32') {
    const roots = [
      env.LOCALAPPDATA,
      env.PROGRAMFILES ?? env.ProgramFiles,
      env['PROGRAMFILES(X86)'] ?? env['ProgramFiles(x86)'],
    ]
    return roots
      .filter(Boolean)
      .map((root) => path.win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))
  }
  return ['/opt/google/chrome/chrome']
}

/** The installed Google Chrome, or null. */
export function findChrome({
  platform = process.platform,
  env = process.env,
  exists = fs.existsSync,
} = {}) {
  return chromeCandidates(platform, env).find((file) => exists(file)) ?? null
}

/** Where Chrome is expected, for "not found" messages. */
export function chromeExpectedAt(platform = process.platform) {
  if (platform === 'darwin') return 'not in /Applications'
  if (platform === 'win32') return 'not in Program Files or AppData\\Local'
  return 'not at /opt/google/chrome'
}

/** The default workspace: ~/Movies/Shreditor on a Mac, ~/Videos/Shreditor elsewhere. */
export function defaultWorkspace(platform = process.platform, home = os.homedir()) {
  return pathFor(platform).join(home, platform === 'darwin' ? 'Movies' : 'Videos', 'Shreditor')
}

/** Where the login items log. */
export function defaultLogDir(platform = process.platform, home = os.homedir(), env = process.env) {
  const p = pathFor(platform)
  if (platform === 'darwin') return p.join(home, 'Library', 'Logs', 'Shreditor')
  if (platform === 'win32')
    return p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'Shreditor', 'Logs')
  return p.join(env.XDG_STATE_HOME || p.join(home, '.local', 'state'), 'shreditor', 'logs')
}

/** Where the default Whisper model is kept. */
export function defaultModelPath(
  platform = process.platform,
  home = os.homedir(),
  env = process.env,
) {
  const p = pathFor(platform)
  if (platform === 'darwin')
    return p.join(home, 'Library', 'Application Support', 'whisper.cpp', 'models', MODEL_FILE)
  if (platform === 'win32')
    return p.join(
      env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'),
      'whisper.cpp',
      'models',
      MODEL_FILE,
    )
  return p.join(
    env.XDG_DATA_HOME || p.join(home, '.local', 'share'),
    'whisper.cpp',
    'models',
    MODEL_FILE,
  )
}

/** Folders package managers put tools in that a login item's or a GUI app's PATH can miss. */
export function extraToolDirs(platform = process.platform, home = os.homedir(), env = process.env) {
  if (platform === 'darwin') return ['/opt/homebrew/bin', '/usr/local/bin']
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local')
    // winget links the command-line tools it installs here.
    return [path.win32.join(local, 'Microsoft', 'WinGet', 'Links')]
  }
  return [
    '/home/linuxbrew/.linuxbrew/bin',
    path.posix.join(home, '.linuxbrew', 'bin'),
    '/usr/local/bin',
  ]
}

/** File names a command can have: Windows adds the PATHEXT extensions. */
export function executableNames(command, platform = process.platform, env = process.env) {
  if (platform !== 'win32' || path.win32.extname(command)) return [command]
  const exts = String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .filter(Boolean)
    .map((ext) => ext.toLowerCase())
  return exts.map((ext) => `${command}${ext}`)
}
