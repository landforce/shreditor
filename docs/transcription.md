# Native transcription

Every imported clip with an audio stream is transcribed in the background by
whisper.cpp in the local bridge, and stored as the editor's own transcript, so
the transcript panel, captions, transcript cuts and filler/silence removal and
the agent (`shred transcript`) all read the same words. Everything runs on this
computer; nothing is uploaded.

## Flow

1. An import finishes: `importMediaByPath` (path import, `shreditor import`)
   calls `autoTranscribe`, and the bridge sees the first `PUT` of
   `media/<id>/metadata.json` from the editor (native file chooser, browser upload).
   A CLI import hands the job to a running bridge (`SHREDITOR_PORT`, default
   5273); with none up it stays `queued` until the next bridge start.
2. `server/transcription.mjs` queues it (one job at a time, 64 queued at most),
   waits for the source file, ffprobes it, and extracts the first audio stream of
   the original media to 16 kHz mono WAV with ffmpeg.
3. Near-silent audio (peak under -50 dBFS) ends as `none` (`silent`).
4. `whisper-cli -l auto -ojf -dtw <preset> -nfa` transcribes it. Sub-word tokens
   are merged into words (`server/transcription-core.mjs`), timed by the DTW
   onsets (less 0.1 s, the measured lag) and clamped into their segment and the
   media duration. Phantom lines Whisper invents on music, typing or silence are
   dropped; nothing left means `none` (`no-speech`), never a fake transcript.
5. The envelope is written atomically to `media/<id>/cache/ai/transcript.json`.
   The editor polls the media change stamp, sees `transcription.status` turn
   `done`, and refreshes the transcript panel without a reload.

Status: `transcription` in `metadata.json`, `{ status, engine, model, language,
updatedAt, reason?, words?, error?, hint? }`, status `queued | running | done |
none | failed | unavailable`. Missing whisper-cli or model gives `unavailable`
with a hint; the import itself never fails, and in-app transcription still works.

## In-app fallback

With a project open, the editor's background analysis (Settings > AI, "Analyze
media when a project opens") makes sure every video has a transcript so it can
suggest a Speaker or B-roll category. Native transcription is preferred and
nothing is transcribed twice (`planBackgroundTranscription` in
`src/features/media-library/utils/background-transcription.ts`):

- a transcript already exists (made in the app, by the background pass or
  natively), or status is `queued`, `running`, `done` or `none`: skipped
- no status yet and the bridge's engine is available: the bridge is asked to
  transcribe it (`POST media/transcribe`)
- status `unavailable` or `failed`, no bridge, or no engine: transcribed in the
  app; that transcript is marked `origin: 'background'` and, being an app save,
  is never replaced by the bridge

Neither background transcripts nor native ones turn on captions for timeline
clips by themselves.

## Transcript format

Same `AiOutput<'transcript'>` envelope the app writes
(`workspace-fs/ai-outputs/types.ts`): `service: 'whisper.cpp'`,
`model: 'ggml-large-v3-turbo'`, `params: { source, auto: true, engine,
engineVersion, quantization: 'fp16', language, languageRequested }`, and `data`
`{ language, quantization: 'fp16', modelVariant: 'whisper-large', text,
segments: [{ text, start, end, words: [{ text, start, end, confidence }] }],
source: 'whisper.cpp' }`. Times in seconds. App saves always use service
`whisper` without `source`, so a transcript made or edited in the app is never
replaced automatically (`force` overrides).

## Routes and commands

- `POST /__shreditor/media/transcribe { mediaId, force?, cancel? }`,
  `GET /__shreditor/media/transcription?mediaId=`, `GET /__shreditor/transcription/engine`
- `shreditor transcribe <mediaId...> | --project <id> [--force]`, `shred transcribe`
- `shred transcript <mediaId> [--json]`
- `shred setup [--yes]` / `shreditor setup whisper [--yes] [--verify]`: checks
  ffmpeg, ffprobe, whisper-cli and the model; downloads
  `ggml-large-v3-turbo.bin` from huggingface.co/ggerganov/whisper.cpp only with
  `--yes`, verifying size and sha256 (`1fc70f77…2bc69`). Never installs
  packages; prints `brew install whisper-cpp` instead.

Settings (optional), `~/.shreditor/config.json` (or `$SHREDITOR_CONFIG`):
`"transcription": { "enabled", "whisperCli", "model", "language", "threads" }`;
`$SHREDITOR_WHISPER_CLI` and `$SHREDITOR_WHISPER_MODEL` override.

## Limits

- One job at a time; a 66 s clip takes about 3 s on an M5 Pro (Metal).
- Only the first audio stream. Language is detected once per file.
- Word times are typically within about 0.1 s; whisper can still misplace a word
  after a long pause. No diarization.
- The phantom filter is heuristic (stock phrases, impossible timing, text past the
  end of the audio). Rare real one-line clips such as a lone "thank you" can be
  dropped, and unusual hallucinations can get through.
- Licenses: `THIRD_PARTY_NOTICES.md`, and Settings > AI > Models and licenses.
