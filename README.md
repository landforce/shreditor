# Shreditor

Shreditor is an agent-first video editor. Your AI agent (your own Claude Code)
makes the edit through a local edit service. You preview the result in the
editor and adjust anything by hand. The agent's next pass starts from what you
saved, so your changes stick.

It runs on your machine. Projects and media are plain files in a workspace
folder on disk, footage is imported in place rather than copied, and the editor
runs in Chrome.

## How the loop works

1. **The agent catalogs your footage.** It probes each clip, makes a contact
   sheet, transcribes speech, and notes what each shot shows and where the
   good moments are.
2. **You agree the format.** The agent asks what you're making (length, format,
   audience, must-keep moments) and writes a brief and a beat plan into the
   project.
3. **The agent edits on a private draft.** It builds the pass, renders frames
   to check its own work, then publishes the finished pass to your project.
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

- **macOS** for the full flow. The Finder folder and file choosers and the
  instant APFS clones used for in-place import are macOS features. On other
  systems you can still import by path; footage is linked instead of cloned
  unless the filesystem supports clones.
- **Node.js 22** or newer.
- **Google Chrome 113+**. The editor needs WebGPU and WebCodecs (Chrome, or
  another recent Chromium such as Edge), and the agent service drives your
  installed Chrome headlessly for edits and renders.
- **ffmpeg and ffprobe** on your `PATH`, for cataloging, proxies, thumbnails
  and frame grids.
- **whisper.cpp** (optional) for transcription when cataloging: `whisper-cli`
  on your `PATH` and the model at
  `~/Library/Application Support/whisper.cpp/models/ggml-large-v3-turbo.bin`.
  Without it, cataloging skips transcripts.
- **Claude Code**, to run the agent side.

## Setup

```bash
git clone https://github.com/landforce/shreditor.git
cd shreditor
npm ci
```

To use the editor on its own:

```bash
npm run dev        # editor at http://localhost:5173
```

For agent editing, the skill's `shred` script starts everything:

```bash
node skills/shreditor-edit/scripts/shred.mjs up       # editor on :5273, agent service on :8787
node skills/shreditor-edit/scripts/shred.mjs status   # editor, service, workspace, writer lock
```

`shred up` runs the editor dev server on port 5273 and starts the agent edit
service (`headless/serve.mjs`) on `127.0.0.1:8787`. The service edits and
renders through the built app, so the first start runs `npm run build`, which
takes a while. Pass `--build` to `shred start` to rebuild after code changes.

An alias saves typing:

```bash
alias shred="node $PWD/skills/shreditor-edit/scripts/shred.mjs"
```

### Install the skill

Register the `shreditor-edit` skill with Claude Code by linking it into your
skills folder:

```bash
mkdir -p ~/.claude/skills
ln -sfn "$PWD/skills/shreditor-edit" ~/.claude/skills/shreditor-edit
```

It is a symlink, so the skill stays in step with this checkout.

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

Everything lives in one workspace folder, `~/Movies/Shreditor` by default. Set
another with `~/.shreditor/config.json` (`{"workspace": "/path/to/folder"}`),
or with the CLI:

```bash
node bin/shreditor.mjs open ~/Movies/Other   # use a folder as the workspace
node bin/shreditor.mjs where                 # print the current workspace
node bin/shreditor.mjs choose                # pick one in Finder
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
- `media/<id>/`: imported media. A clone of the original on the same APFS
  volume, or `source.link.json` pointing at the original elsewhere. Originals
  are never modified.
- `catalogs/<slug>/`: `catalog.json`, contact sheets, transcripts and playable
  proxies for formats the browser can't decode.

`~/.shreditor/` holds the config and the agent's draft records. The workspace
also has its own `README.md` describing the full layout.

## Architecture

| Piece | What it does |
| --- | --- |
| [`skills/shreditor-edit/`](skills/shreditor-edit/) | The Claude Code skill: `SKILL.md` (the loop), `references/` (op shapes, brief and plan templates), and `scripts/shred.mjs`, the only way the agent touches a project (`up`, `start`, `status`, `catalog`, `new`, `project`, `import`, `draft`, `apply`, `frames`, `publish`, `changes`). |
| [`agent/`](agent/) | Design spec for the agent: process, prompts, editing contract, rendering and structure. |
| [`server/workspace-bridge.mjs`](server/workspace-bridge.mjs) | Loopback service mounted in the Vite dev server at `/__shreditor/`. Serves the workspace folder to the editor and runs the Finder folder chooser. |
| [`server/media-bridge.mjs`](server/media-bridge.mjs) | In-place import from the Finder file chooser or by path: clone on the same volume, link otherwise. |
| [`bin/shreditor.mjs`](bin/shreditor.mjs) | `shreditor open [folder]`, `where`, `choose`, `import`. |
| [`headless/serve.mjs`](headless/serve.mjs) | The agent edit and render service on `127.0.0.1:8787`. Holds the workspace writer lock while it runs. |
| [`src/features/editor/agent-sync/`](src/features/editor/agent-sync/) | Revision-checked saves, live reload when the agent writes, and the conflict banner. |

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
