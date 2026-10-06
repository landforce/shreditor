# Shreditor Agent rendering specification

These are design requirements for the editing and rendering system. They do not imply that the capabilities already exist.

## Shared editable model

Define one canonical project model shared by the agent, interface, preview, and exporter. Store stable element identities, ordering, hierarchy, timing, source references, text, geometry, animation, and audio settings. Preserve fields an editing operation does not understand.

Derived timeline views, thumbnails, waveforms, and compiled render input should be rebuildable from that model. They must not become competing sources of truth. A parser that loses formatting or unsupported structure cannot safely replace the full document after a small edit.

Keep text, graphics, footage, and audio independently editable. Importing media must register actual bytes or a resolvable resource; writing an identifier alone is insufficient. Grouping should preserve identities and timing relationships.

## Time and source selection

Define units at every interface. Use seconds for user-facing time and an exact rational frame rate for frame conversion. Preserve fractional frame rates without rounded-decimal serialization. Use half-open intervals: an element active over `[start, end)` is absent at its end.

Maintain distinct clocks:

| Clock | Meaning |
|---|---|
| Source time | Position within the original media. |
| Project time | Position in the finished sequence. |
| Parent-local time | Placement within a containing scene or group. |
| Animation time | Progress relative to the owning element's start. |
| Preview-file time | Position in a rendered excerpt. |

Moving a clip changes placement while preserving its selected source moment. Trimming a leading edge must explicitly state whether it changes the source in-point, timeline window, or both. Slipping media, moving a clip, and changing playback speed must be separate operations.

For a constant playback rate, map source time through source in-point, clip start, and rate. Variable speed requires integration of the actual rate curve. Nested timing must include ancestor transformations. Store excerpt offsets so review findings can be mapped back to the full project.

Quantize picture events to representable frames. Schedule audio at the finest supported precision and disclose any quantization limits. Source duration, authored duration, and discovered duration should remain distinguishable. Holding a final video frame and ending audio at source exhaustion are different policies; neither should happen accidentally.

## Preview contract

Provide a shared runtime contract for readiness, play, pause, seek, current time, duration, frame rate, and bounded playback. Explicitly distinguish a loaded runtime from decoded assets and a painted frame. Seek must have defined completion and playback behavior.

A changed-range preview should retain project time, play `[start,end)`, and stop on the final included frame. Selection and inspection should use evaluated geometry at the current time. Runtime-only tweaks must be clearly separated from durable project mutations.

Preview and export should use the same timing, source mapping, fonts, animation evaluation, and effect settings wherever possible. Record differences that can affect appearance or sound. Interactive responsiveness does not justify silently changing the final rendering semantics.

## Render jobs

Render an immutable snapshot of a saved project revision. Include the resolved configuration and required assets. Jobs must expose identity, source revision, state, stage, progress, frame counts, output location, warnings, failure details, and cancellation state.

Use a staged pipeline: validate and compile → resolve resources and duration → prepare source frames and audio → evaluate and capture frames → encode → assemble → verify → publish. Record stage diagnostics so failures can be attributed to an asset, element, or operation.

Seek to explicit frame times instead of recording realtime playback. Wait for pending image decoding, media preparation, animation evaluation, fonts, and GPU work before capturing. Readiness timeouts must produce qualified findings or failures rather than invisible missing content.

Cancellation must propagate to resource downloads, browser sessions, decoding, and encoding. Own subprocesses and temporary directories explicitly; clean them up on success, cancellation, and failure. A cancelled job must not publish a completed artifact.

Stage output separately from its destination. Validate readability, nonempty content, dimensions, duration, frame rate, and expected streams before replacing the previous output. Compare frame count when available. Preserve the old output on failed publication and report rollback failures.

## Reproducibility and assets

Control the render clock and random seeds where supported. Uncontrolled randomness, external mutable resources, environment-dependent fonts, and asynchronous setup prevent a blanket determinism guarantee.

Resolve referenced scenes before rendering. Keep a resource inventory with asset identity, content hash, media type, duration, dimensions, channel layout, source offset, and availability. Resolve fonts by actual file rather than a family name alone. Missing fonts or assets must not silently become substitutes.

Capture resolved assets and render configuration with each job. Cache work by content and relevant configuration, including source ranges, rate, dimensions, fonts, effects, and encoding choices. Reuse should require a matching dependency identity.

If work is distributed, freeze a manifest and content-addressed assets first. Workers should consume only declared dependencies and frame ranges. Validate returned chunks against the same manifest before assembly. Matching inputs improve reproducibility but do not prove identical output across different rendering environments.

## Audio

Represent dialogue, production sound, music, and added cues independently. Each audible element needs source selection, project placement, gain, rate, fades, and any automation or effects. State whether an envelope returns final gain or multiplies a base gain.

Keep intentional source sound. Avoid duplicate playback when separating a video's audio into an independent element. Align cue transients or resolutions to the visual event rather than assuming file start is the perceptual anchor.

Use native editable controls where available. Processing that needs a derived audio file must preserve the original, selected channels, recipe, latency, and source-to-project mapping. Verify duration and lip sync before replacing playback. Compare processed and original speech over the same phrases at matched perceived loudness.

Measure and audition the final encoded mix. A configurable default for social delivery can target approximately −15 integrated loudness units, with a working range of −16 to −14 and true peak no higher than −1 decibel true peak. A supplied delivery specification overrides this default. Meter compliance does not establish intelligibility or an appropriate mix.

Check mono, low-volume playback, cue density, head/tail, and intended silence. Diagnostic listening copies must remain separate from the deliverable. Distinguish no authored audio from failed audio processing; required audio failure must block publication.

## Validation and review evidence

Separate structural validity, technical correctness, and editorial judgment. Validation findings need a code, severity, message, project revision, affected element or source location, relevant time, and an actionable explanation. Where useful, attach a frame, crop, waveform, or excerpt.

Structural checks cover identity, references, supported operations, bounds, and source mapping. Technical checks cover asset readiness, dimensions, clipping, timing, alpha, audio, encoding, and synchronization. Human or agent inspection covers narrative meaning, pacing, legibility, graphic purpose, and sound quality.

Sampling cannot establish that no one-frame flash or brief collision exists. Use targeted denser samples or playback around uncertain behavior. An accepted command or successful export is not a substitute for inspection.

Define strict and qualified-completion policies explicitly. Missing required scenes, failed scripts, dropped required effects, failed audio, truncated output, or unverifiable publication must fail. Lesser limitations may produce a completed result with visible warnings. Unsupported capabilities should return a clear limitation rather than an invented field, silent fallback, or misleading success.
