# Shreditor

Agent-first video editor built on FreeCut, a browser-based multi-track video editor. React 19 + TypeScript + Vite.

## Shreditor

- The agent side lives in `skills/shreditor-edit/` (the skill and `scripts/shred.mjs`) and `agent/` (the design spec). Read `SKILL.md` and `references/engine.md` before changing the edit loop or the ops it sends
- Agents edit projects only through `shred` and the edit service. **Never hand-write `project.json`**: it is revision-checked, and the editor reloads or raises a conflict on every external write
- Internal identifiers (the package name, the `.freecut-workspace.json` marker and similar) still say `freecut` on purpose, so existing workspaces and upstream merges keep working. Don't rename them

## Environment

- `VITE_SHOW_DEBUG_PANEL=false` hides the debug panel in dev (shown by default)

## Toolchain & dependency notes

- All production deps are exact-pinned; keep new deps exact-pinned too (no `^`/`~`). `onnxruntime-web` (dev build) and `lucide-react` (0.468.x) are pinned **deliberately** — never routine-bump either
- **Never bulk-`fallow fix`.** The `check:unused-exports` / `check:unused-class-members` allowlists are ratchet baselines, not approvals — trace per export

## Git

- Single branch: work on `main`. There is no `develop` or `staging` flow here
- Conventional commits — `type(scope): description` (e.g. `fix(timeline):`, `feat(export):`)
- `upstream` is FreeCut (walterlow/freecut). Pull its fixes with `git fetch upstream && git merge upstream/main`
