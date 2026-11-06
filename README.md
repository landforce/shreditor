# Shreditor

Shreditor is an agent-first video editor. Your AI agent (your own Claude Code)
makes the edit through a local edit service. You preview the result in the
editor and adjust anything by hand. The agent's next pass starts from what you
saved, so your changes stick.

It runs on your machine. Projects and media are plain files in a workspace
folder on disk, footage is imported in place rather than copied, and the editor
runs in Chrome.

## How the loop works

1. **You choose the format.** Every edit is one of four 9:16 formats: Graphic
   Yap, Greenscreen Talking Head, Vlog or 10 Shot. The agent catalogs your
   footage (probes each clip, makes a contact sheet, transcribes speech) and
   suggests one; the format sets the canvas, the named tracks, and the rules
   and targets every pass is scored against. Definitions and guides live in
   `formats/`.
2. **The agent plans.** It asks what the format doesn't settle (length,
   audience, must-keep moments) and writes a brief and a beat plan into the
   project.
3. **The agent edits on a private draft.** It builds the pass, renders frames
   to check its own work, scores it against the format (`shred check`), then
   publishes the finished pass to your project.
   The editor reloads it within a second or so.
4. **You adjust.** Trim, move, retime, swap clips, or edit text directly in the
   editor, then save. Or tell the agent what to change.
5. **The agent continues from your state.** Before each pass it reads what you
   changed since its last one and treats those changes as decisions. Repeat
   until you're done, then export.

Saves are revision-checked. If the agent publishes while you have unsaved
edits, the editor shows a banner and you choose: load the new version or keep
yours. Nothing is merged silently.

## Requirements

Shreditor runs on **macOS, Linux and Windows**.

- **Node.js 22** or newer.
- **Google Chrome 113+**. The editor needs WebGPU and WebCodecs (Chrome, or
  another recent Chromium such as Edge), and the agent service drives your
  installed **Google Chrome** headlessly for edits and renders (Chromium from a
  Linux package manager isn't enough).
- **ffmpeg and ffprobe** on your `PATH`, for cataloging, proxies, thumbnails
  and frame grids.
- **whisper.cpp** (optional) for transcription when cataloging: `whisper-cli`
  on your `PATH` and the `ggml-large-v3-turbo.bin` model (where it goes on each
  system is under [Where files live](#where-files-live)). Without it,
  cataloging skips transcripts and in-app transcription still works.
- **Claude Code**, to run the agent side.

What differs by system:

|                          | macOS                                              | Linux                                                             | Windows                           |
| ------------------------ | -------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------- |
| ffmpeg, whisper.cpp      | Homebrew                                           | Homebrew, apt, dnf or pacman (whisper.cpp: Homebrew, or build it) | winget (whisper.cpp: release zip) |
| Always on (login items)  | launchd                                            | systemd user services                                             | Startup folder                    |
| Folder and file choosers | Finder                                             | zenity or kdialog on a desktop                                    | Windows dialogs                   |
| In-place import          | instant APFS clone on the same volume, else a link | clone on btrfs/XFS, else a link                                   | a link                            |

Without a chooser (a Linux server, no zenity) you import by path
(`shreditor import <file>`) or with the browser's file picker, and switch
workspaces by typing a path.

## Setup

### Install

1. Install [Google Chrome](https://www.google.com/chrome/) and Node.js 22 or
   newer, the way that suits your system:

   - **macOS**: [Homebrew](https://brew.sh), then Chrome from
     [google.com/chrome](https://www.google.com/chrome/) and Node from
     [nodejs.org](https://nodejs.org) (or `brew install node`).
   - **Linux**: Node from [nodejs.org](https://nodejs.org) or
     [nvm](https://github.com/nvm-sh/nvm). Google Chrome from its `.deb`/`.rpm`,
     or once the dependencies are installed (step 2):
     `npx playwright install --with-deps chrome`.
   - **Windows**: `winget install -e --id OpenJS.NodeJS.LTS` and
     `winget install -e --id Google.Chrome` (or the installers from
     nodejs.org and google.com/chrome). Use PowerShell for the steps below.

2. In a terminal:

   ```bash
   git clone https://github.com/landforce/shreditor.git
   cd shreditor
   npm ci
   npx shreditor install
   ```

`npx shreditor install` checks everything Shreditor needs and says what is
missing and how to fix it. It offers to install ffmpeg (and whisper.cpp where
a package manager has it) with your system's package manager: `brew install`
on a Mac; on Linux `brew install` if you have Homebrew, else
`sudo apt-get install`, `sudo dnf install` (ffmpeg needs
[RPM Fusion](https://rpmfusion.org/Configuration) on Fedora) or
`sudo pacman -S`; `winget install` on Windows. It downloads the transcription
model (1.6 GB; a copy already on your computer is reused instead) and builds
the editor. Answer `y` (or pass `--yes`). It never installs a package manager,
Chrome or Node for you.

On Linux and Windows, whisper.cpp usually isn't packaged, so `install` tells
you how to get it and carries on without it (transcripts come once
`whisper-cli` is on your `PATH`; `npx shreditor setup whisper` checks):

- **Linux**: `brew install whisper-cpp`, or build it:

  ```bash
  git clone https://github.com/ggml-org/whisper.cpp
  cmake -S whisper.cpp -B whisper.cpp/build
  cmake --build whisper.cpp/build -j --config Release
  ```

  and put `whisper.cpp/build/bin` on your `PATH`.

- **Windows**: download `whisper-bin-x64.zip` from the
  [whisper.cpp releases](https://github.com/ggml-org/whisper.cpp/releases),
  unzip it and add the folder with `whisper-cli.exe` to your `PATH`.

Or point `"transcription": {"whisperCli": "/path/to/whisper-cli"}` in
`~/.shreditor/config.json` at it.

Using Shreditor through an agent (Claude Code with the `shreditor-edit` skill)?
The agent runs this step for you the first time, and tells you if a package
manager, Chrome or Node needs installing. Run it from inside the `shreditor`
folder: from anywhere else `npx` looks for a published package and fails with
E404 (`node /path/to/shreditor/bin/shreditor.mjs install` works from anywhere).

Then it sets up two login items, the editor and the agent service, and from
then on Shreditor is always on at **http://localhost:5273**. They start when
you log in and restart on their own if they stop. The agent service listens on
`127.0.0.1:8787`, on this computer only. How:

- **macOS**: launchd agents in `~/Library/LaunchAgents/`.
- **Linux**: systemd user services in `~/.config/systemd/user/`
  (`systemctl --user status app.shreditor.editor`). They run while you are
  logged in; on a server, `loginctl enable-linger $USER` keeps them running
  without a login. Where systemd user services aren't available (a container,
  WSL without systemd), `install` says so and you start Shreditor with
  `shred up` (below) instead.
- **Windows**: scripts in your Startup folder
  (`shell:startup`) that run each one hidden and restart it if it stops. No
  administrator rights needed.

### Update, check, remove

```bash
npx shreditor update      # pull, reinstall dependencies if they changed, rebuild, restart
npx shreditor status      # login items, URLs, workspace, build vs checkout, log files
npx shreditor restart     # restart both
npx shreditor uninstall   # remove the login items (keeps your workspace, settings and logs)
```

`update` and `restart` wait while the editor has unsaved changes or the agent
is in the middle of an edit or a render, and tell you what to save first
(`--force` goes ahead anyway). `update` refuses when the checkout has local
changes.

Logs (`editor.log`, `service.log`) are in `~/Library/Logs/Shreditor/` on
macOS, `~/.local/state/shreditor/logs/` on Linux and
`%LOCALAPPDATA%\Shreditor\Logs\` on Windows. The workspace, where projects
and media live, is `~/Movies/Shreditor` on macOS and `~/Videos/Shreditor` on
Linux and Windows; to use another folder, run `npx shreditor choose` (or
`npx shreditor open <folder>`), then `npx shreditor restart`.

### Without the login items (development)

To use the editor on its own with live reload:

```bash
npm run dev        # editor at http://localhost:5173
```

For agent editing without the login items, the skill's `shred` script starts
everything:

```bash
node skills/shreditor-edit/scripts/shred.mjs up       # editor on :5273, agent service on :8787
node skills/shreditor-edit/scripts/shred.mjs status   # editor, service, workspace, writer lock
```

`shred up` serves a built copy of the editor on port 5273 (`--dev` for the dev
server) and starts the agent edit service (`headless/serve.mjs`) on
`127.0.0.1:8787`. It builds first when the build is missing or older than the
checkout; pass `--build` to rebuild anyway. `shred` commands also start the
service (and the editor) themselves when they need it, through the login item
when one is installed; `SHRED_AUTOSTART=0` turns that off. When the login
items are installed, `shred up` leaves them alone.

An alias saves typing:

```bash
alias shred="node $PWD/skills/shreditor-edit/scripts/shred.mjs"
```

(PowerShell: `function shred { node "$PWD\skills\shreditor-edit\scripts\shred.mjs" @args }`.)

### Install the skill

Register the `shreditor-edit` skill with Claude Code by linking it into your
skills folder:

```bash
mkdir -p ~/.claude/skills
ln -sfn "$PWD/skills/shreditor-edit" ~/.claude/skills/shreditor-edit
```

On Windows (PowerShell; a junction needs no administrator rights):

```powershell
New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null
New-Item -ItemType Junction -Path "$HOME\.claude\skills\shreditor-edit" -Target "$PWD\skills\shreditor-edit"
```

It is a link, so the skill stays in step with this checkout.

## Your first edit

1. Put your footage in a folder, for example `~/Movies/Footage/trip`.
2. Start Claude Code and give it a starter prompt:

   ```text
   Use the shreditor-edit skill to cut a 45 second vertical video from the
   clips in ~/Movies/Footage/trip. Catalog the footage first, ask me what you
   need to know about the format, and show me the plan before you build.
   ```

3. The agent runs `shred up`, catalogs the clips, summarizes what's there and
   asks a round of questions. Answer them and approve the plan.
4. It creates the project, builds a draft, checks rendered frames, and
   publishes the pass. Open the editor link it prints (or keep it open; it
   reloads). It tells you which moments to watch.
5. Make your changes in the editor and save. Then tell the agent what's next:

   ```text
   I tightened the intro and rewrote the title. Take another pass: hold the
   sunset shot longer and add captions.
   ```

   The agent runs `shred changes` to see your edits, keeps them, and builds
   the next pass from there.

The skill does not decide style on its own. If you have a style skill, point
the agent at it; otherwise it asks once and records the answer in the brief.

## Where files live

Everything lives in one workspace folder, `~/Movies/Shreditor` by default
(`~/Videos/Shreditor` on Linux and Windows). Set
another with `~/.shreditor/config.json` (`{"workspace": "/path/to/folder"}`),
or with the CLI:

```bash
node bin/shreditor.mjs open ~/Movies/Other   # use a folder as the workspace
node bin/shreditor.mjs where                 # print the current workspace
node bin/shreditor.mjs choose                # pick one in a folder dialog
node bin/shreditor.mjs import clip.mov --project <id>
```

`choose` asks the running editor, which it expects on port 5273 (`shred up`);
pass `--port 5173` if you started it with `npm run dev`.

The editor reads the setting on every request, so a switch applies on the next
page load. Inside the workspace:

- `projects/<id>/project.json`: the timeline. Edit it only through the editor
  or `shred`, never by hand.
- `projects/<id>/agent/`: the agent's brief, plan, and a record of each
  published pass, which `shred changes` diffs against.
- `media/<id>/`: imported media. A clone of the original on the same volume
  (APFS, btrfs, XFS), or `source.link.json` pointing at the original
  elsewhere. Originals are never modified.
- `catalogs/<slug>/`: `catalog.json`, contact sheets, transcripts and playable
  proxies for formats the browser can't decode.

`~/.shreditor/` holds the config and the agent's draft records. The Whisper
model is kept at
`~/Library/Application Support/whisper.cpp/models/ggml-large-v3-turbo.bin` on
macOS, `~/.local/share/whisper.cpp/models/` on Linux and
`%LOCALAPPDATA%\whisper.cpp\models\` on Windows (`"transcription":
{"model": "..."}` in the config moves it). The workspace
also has its own `README.md` describing the full layout.

## Architecture

| Piece                                                                | What it does                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`skills/shreditor-edit/`](skills/shreditor-edit/)                   | The Claude Code skill: `SKILL.md` (the loop), `references/` (op shapes, brief and plan templates), and `scripts/shred.mjs`, the only way the agent touches a project (`up`, `start`, `status`, `catalog`, `new`, `project`, `import`, `draft`, `apply`, `frames`, `publish`, `changes`). |
| [`agent/`](agent/)                                                   | Design spec for the agent: process, prompts, editing contract, rendering and structure.                                                                                                                                                                                                  |
| [`server/workspace-bridge.mjs`](server/workspace-bridge.mjs)         | Loopback service mounted in the Vite dev server at `/__shreditor/`. Serves the workspace folder to the editor and runs the Finder folder chooser.                                                                                                                                        |
| [`server/media-bridge.mjs`](server/media-bridge.mjs)                 | In-place import from the native file chooser or by path: clone on the same volume, link otherwise.                                                                                                                                                                                       |
| [`bin/shreditor.mjs`](bin/shreditor.mjs)                             | `shreditor open [folder]`, `where`, `choose`, `import`.                                                                                                                                                                                                                                  |
| [`headless/serve.mjs`](headless/serve.mjs)                           | The agent edit and render service on `127.0.0.1:8787`. Holds the workspace writer lock while it runs.                                                                                                                                                                                    |
| [`src/features/editor/agent-sync/`](src/features/editor/agent-sync/) | Revision-checked saves, live reload when the agent writes, and the conflict banner.                                                                                                                                                                                                      |

The editor itself is in `src/`, organized as `features/` (UI modules),
`runtime/` (playback and rendering), `infrastructure/` (GPU, audio, storage and
other platform adapters) and `shared/`. See [CLAUDE.md](CLAUDE.md) for working
conventions.

## Development

```bash
npm run dev         # editor dev server
npm run build       # production build (also what the agent service uses)
npm run lint        # Oxlint through Vite+
npm run test:run    # unit tests once
npm run verify      # full gate: checks, tests, build, headless contracts
```

## Attribution

Shreditor is built on [FreeCut](https://github.com/walterlow/freecut) by
[walterlow](https://github.com/walterlow), a browser-based multi-track video
editor. The editor, timeline, preview, effects, export and headless engine come
from FreeCut. FreeCut is MIT licensed, and its [LICENSE](LICENSE) is retained
here. [PRODUCT.md](PRODUCT.md), [DESIGN.md](DESIGN.md) and
[CHANGELOG.md](CHANGELOG.md) describe the inherited editor.

Upstream fixes are pulled in with `git fetch upstream && git merge upstream/main`.
