# Formats

Every Shreditor edit starts by choosing one of four 9:16 formats. The format
defines the project: canvas, named track layout, rules, numeric targets, and
the scorecard the agent (`shred check`) and the editor run against the timeline.

| id            | Name                     | Variants                        |
| ------------- | ------------------------ | ------------------------------- |
| `graphic-yap` | Graphic Yap              | `standard` (default), `intense` |
| `greenscreen` | Greenscreen Talking Head | none                            |
| `vlog`        | Vlog                     | `fast`, `slow`                  |
| `ten-shot`    | 10 Shot                  | `even`, `beat`, `shaped`        |

Plain ESM, loaded by Node (`skills/.../shred.mjs`, `headless/`) and by the
editor as `@formats/<file>.mjs` (Vite alias and tsconfig path). Types are in the
`.d.mts` files next to each module.

- `registry.mjs`: `FORMATS`, `FORMAT_IDS`, `FORMAT_ROLES`, `CHOOSING_GUIDE`,
  `getFormat(idOrName)`, `resolveFormat(id, variant?)` (variant overrides
  merged), `projectFormat(project)`, `projectFormatRecord(id, variant?)` (the
  `project.format` value to store), `createFormatTracks(format, { height, idFor })`
  (the layout as timeline tracks, top to bottom, each with `formatRole`).
- `scorecard.mjs`: `scoreProject(project, { mediaById, transcripts, format, variant })` returns `{ format, variant, durationSec, checks, summary }`; pure,
  run it on every timeline change. Also `resolveItemRoles`, `trackRole`,
  `mapClipWords`, `describeTarget`.
- `suggest.mjs`: `suggestFormat(catalogEntries)`, a suggestion from footage
  per the decision guide.

## Guides

`<id>/guide.md` and `<id>/research.md` are vendored from the ai-video-editor
plugin (the source of truth), and `choosing.md` is its format decision guide.
Don't edit them here: change the plugin, then `npm run formats:sync`. The
sync refuses any file with a forbidden word, and prints REVIEW when a guide
changed since its targets were reviewed: re-check the targets in
`registry.mjs` against the new guide, then update that format's
`guide.reviewedHash`. `npm run formats:sync -- --check` writes nothing and
exits 1 when anything is stale.
