// How to install the command-line tools Shreditor needs (ffmpeg, whisper-cli)
// on each system: with Homebrew on a Mac; Homebrew, apt, dnf or pacman on
// Linux; winget on Windows. Pure: `which` says which managers are here.

/** Each tool's package name per manager; a manager that isn't listed doesn't have it. */
export const PACKAGES = {
  ffmpeg: { brew: 'ffmpeg', apt: 'ffmpeg', dnf: 'ffmpeg', pacman: 'ffmpeg', winget: 'Gyan.FFmpeg' },
  whisper: { brew: 'whisper-cpp' },
}

/**
 * argv to install `packages` with each manager; `merge`: several packages in
 * one command; `before`: run first (a fresh Debian/Ubuntu has no package lists).
 */
const MANAGERS = {
  brew: { command: 'brew', merge: true, argv: (pkgs) => ['brew', 'install', ...pkgs] },
  apt: {
    command: 'apt-get',
    merge: true,
    before: ['sudo', 'apt-get', 'update'],
    argv: (pkgs) => ['sudo', 'apt-get', 'install', '-y', ...pkgs],
  },
  dnf: { command: 'dnf', merge: true, argv: (pkgs) => ['sudo', 'dnf', 'install', '-y', ...pkgs] },
  pacman: {
    command: 'pacman',
    merge: true,
    argv: (pkgs) => ['sudo', 'pacman', '-S', '--needed', '--noconfirm', ...pkgs],
  },
  winget: {
    command: 'winget',
    merge: false,
    argv: ([id]) => [
      'winget',
      'install',
      '-e',
      '--id',
      id,
      '--accept-source-agreements',
      '--accept-package-agreements',
    ],
  },
}

// Homebrew first on Linux too: it has whisper-cpp and a current ffmpeg.
const ORDER = { darwin: ['brew'], linux: ['brew', 'apt', 'dnf', 'pacman'], win32: ['winget'] }

/** The package managers on this machine, in the order they are preferred. */
export function managersHere(platform, which) {
  return (ORDER[platform] ?? []).filter((name) => which(MANAGERS[name].command))
}

/** { manager, package } to install `tool` with, or null when no manager here has it. */
export function packageFor(tool, managers) {
  const manager = managers.find((name) => PACKAGES[tool][name])
  return manager ? { manager, package: PACKAGES[tool][manager] } : null
}

/** The fix commands for some { manager, package }s: merged per manager where it can. */
export function installCommands(items) {
  const byManager = new Map()
  for (const { manager, package: pkg } of items) {
    if (!byManager.has(manager)) byManager.set(manager, [])
    byManager.get(manager).push(pkg)
  }
  return [...byManager].flatMap(([manager, pkgs]) =>
    (MANAGERS[manager].merge ? [pkgs] : pkgs.map((pkg) => [pkg])).map((group) => {
      const { before } = MANAGERS[manager]
      const steps = [...(before ? [before] : []), MANAGERS[manager].argv(group)]
      return {
        kind: manager,
        packages: group,
        steps,
        command: steps.map((argv) => argv.join(' ')).join(' && '),
      }
    }),
  )
}

/** What to tell someone who has to install `tool` themselves. */
export function manualInstall(tool, platform) {
  const config = (example) =>
    `(or set "transcription": {"whisperCli": "${example}"} in ~/.shreditor/config.json)`
  const text = {
    darwin: {
      ffmpeg: 'Install Homebrew first, then: brew install ffmpeg',
      whisper: 'Install Homebrew first, then: brew install whisper-cpp',
    },
    linux: {
      ffmpeg:
        'Install it with your package manager (Debian/Ubuntu: sudo apt-get install ffmpeg; Fedora: enable RPM Fusion, then sudo dnf install ffmpeg; Arch: sudo pacman -S ffmpeg), or with Homebrew: brew install ffmpeg',
      whisper: `Build whisper.cpp: git clone https://github.com/ggml-org/whisper.cpp && cmake -S whisper.cpp -B whisper.cpp/build && cmake --build whisper.cpp/build -j --config Release, then put whisper.cpp/build/bin on PATH ${config('/path/to/whisper-cli')}. Or with Homebrew: brew install whisper-cpp`,
    },
    win32: {
      ffmpeg:
        'Install it with winget: winget install -e --id Gyan.FFmpeg (winget comes with the App Installer from the Microsoft Store), or unzip a build from https://www.gyan.dev/ffmpeg/builds/ and add its bin folder to PATH',
      whisper: `Download whisper-bin-x64.zip from https://github.com/ggml-org/whisper.cpp/releases, unzip it and add the folder with whisper-cli.exe to PATH ${config('C:\\\\path\\\\to\\\\whisper-cli.exe')}`,
    },
  }
  return (text[platform] ?? text.linux)[tool]
}
