// Native folder and file choosers, run by the bridge process so they work in
// any browser: Finder on macOS (osascript), zenity or kdialog on a Linux
// desktop, and the Windows Forms dialogs through PowerShell. Where there is
// none (a server, a container), chooserFor() is null and the editor falls back
// to a path (`shreditor open <folder>`, `shreditor import <file>`) or the
// browser's own picker.
import { execFile } from 'node:child_process'
import { findExecutable } from './transcription.mjs'

const FOLDER_PROMPT = 'Choose a Shreditor workspace folder'
const FILES_PROMPT = 'Import media into Shreditor'

const CHOOSE_FILES_SCRIPT = `
set picked to choose file with prompt "${FILES_PROMPT}" with multiple selections allowed
set out to ""
repeat with f in picked
  set out to out & POSIX path of f & linefeed
end repeat
return out`

// PowerShell: a dialog owned by a topmost window, so it isn't hidden behind the browser.
const PS_PRELUDE = `Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }`
const PS_FOLDER = `${PS_PRELUDE}
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = '${FOLDER_PROMPT}'
if ($env:SHREDITOR_START) { $d.SelectedPath = $env:SHREDITOR_START }
if ($d.ShowDialog($owner) -eq 'OK') { $d.SelectedPath } else { exit 1 }`
const PS_FILES = `${PS_PRELUDE}
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Title = '${FILES_PROMPT}'
$d.Multiselect = $true
if ($d.ShowDialog($owner) -eq 'OK') { $d.FileNames -join "\`n" } else { exit 1 }`

const powershell = (script) => [
  'powershell.exe',
  ['-NoProfile', '-NonInteractive', '-STA', '-Command', script],
]

/**
 * How to show a chooser here: { name, folder(startIn) -> [cmd, args, env?],
 * files() -> [cmd, args], cancelled(error) }, or null when there is none.
 */
export function chooserFor({
  platform = process.platform,
  env = process.env,
  which = findExecutable,
} = {}) {
  if (platform === 'darwin')
    return {
      name: 'Finder',
      folder: (startIn) => {
        const location = startIn ? ` default location POSIX file ${JSON.stringify(startIn)}` : ''
        return [
          'osascript',
          ['-e', `POSIX path of (choose folder with prompt "${FOLDER_PROMPT}"${location})`],
        ]
      },
      files: () => ['osascript', ['-e', CHOOSE_FILES_SCRIPT]],
      // -128 is "user cancelled".
      cancelled: (error) => String(error.message).includes('-128'),
    }
  if (platform === 'win32')
    return {
      name: 'Windows',
      folder: (startIn) => [...powershell(PS_FOLDER), startIn ? { SHREDITOR_START: startIn } : {}],
      files: () => powershell(PS_FILES),
      cancelled: (error) => error.code === 1,
    }
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return null
  const zenity = which('zenity')
  if (zenity)
    return {
      name: 'zenity',
      folder: (startIn) => [
        zenity,
        [
          '--file-selection',
          '--directory',
          `--title=${FOLDER_PROMPT}`,
          ...(startIn ? [`--filename=${startIn}/`] : []),
        ],
      ],
      files: () => [
        zenity,
        ['--file-selection', '--multiple', '--separator=\n', `--title=${FILES_PROMPT}`],
      ],
      cancelled: (error) => error.code === 1,
    }
  const kdialog = which('kdialog')
  if (kdialog)
    return {
      name: 'kdialog',
      folder: (startIn) => [
        kdialog,
        ['--title', FOLDER_PROMPT, '--getexistingdirectory', ...(startIn ? [startIn] : [])],
      ],
      files: () => [
        kdialog,
        ['--title', FILES_PROMPT, '--getopenfilename', '.', '--multiple', '--separate-output'],
      ],
      cancelled: (error) => error.code === 1,
    }
  return null
}

export class ChooserError extends Error {
  /** reason: 'cancelled' | 'unavailable' | 'failed' */
  constructor(reason, message) {
    super(message)
    this.reason = reason
  }
}

function show(chooser, [cmd, args, extraEnv]) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ...extraEnv }, windowsHide: true },
      (error, stdout) => {
        if (!error) return resolve(stdout)
        if (chooser.cancelled(error)) reject(new ChooserError('cancelled', 'Cancelled'))
        else reject(new ChooserError('failed', error.message))
      },
    )
  })
}

const unavailable = (what, instead) =>
  new ChooserError(
    'unavailable',
    `No ${what} chooser on this system (on a Linux desktop, install zenity); ${instead}`,
  )

/** Show a folder chooser; the picked folder's path. Throws ChooserError. */
export async function chooseFolder(startIn, options) {
  const chooser = chooserFor(options)
  if (!chooser) throw unavailable('folder', 'pass a path instead: shreditor open <folder>')
  const out = await show(chooser, chooser.folder(startIn))
  const picked = out.trim()
  if (!picked) throw new ChooserError('cancelled', 'Cancelled')
  return picked.length > 1 ? picked.replace(/[\\/]$/, '') : picked
}

/** Show a multiple-file chooser; the picked files' paths. Throws ChooserError. */
export async function chooseFiles(options) {
  const chooser = chooserFor(options)
  if (!chooser) throw unavailable('file', 'import by path instead: shreditor import <file...>')
  const out = await show(chooser, chooser.files())
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}
